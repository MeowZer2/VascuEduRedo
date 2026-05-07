<# 
VascEdu Windows setup script.

From the repository root, run:
  powershell -ExecutionPolicy Bypass -File .\setup.ps1

For a faster dependency-only run that skips verification checks:
  powershell -ExecutionPolicy Bypass -File .\setup.ps1 -SkipChecks
#>

param(
  [switch]$SkipChecks
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Add-UserPath {
  param([string]$PathToAdd)

  if (-not (Test-Path $PathToAdd)) {
    return
  }

  $currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $parts = @()
  if ($currentUserPath) {
    $parts = $currentUserPath -split ";" | Where-Object { $_ }
  }

  if ($parts -notcontains $PathToAdd) {
    $newPath = ($parts + $PathToAdd) -join ";"
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
  }

  if (($env:Path -split ";") -notcontains $PathToAdd) {
    $env:Path = "$PathToAdd;$env:Path"
  }
}

function Test-Command {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-WingetInstall {
  param(
    [string]$Id,
    [string]$Name,
    [string]$Override = ""
  )

  if (-not (Test-Command "winget")) {
    throw "winget is required to install $Name. Install App Installer from the Microsoft Store, then rerun this script."
  }

  Write-Step "Installing $Name"
  $args = @(
    "install",
    "--id", $Id,
    "-e",
    "--accept-package-agreements",
    "--accept-source-agreements"
  )

  if ($Override) {
    $args += @("--override", $Override)
  }

  & winget @args
}

function Ensure-Node {
  if (Test-Command "node") {
    Write-Host "Node already installed: $(node --version)"
    return
  }

  Invoke-WingetInstall -Id "OpenJS.NodeJS.LTS" -Name "Node.js LTS"
}

function Ensure-Pnpm {
  $userNpm = Join-Path $env:APPDATA "npm"
  Add-UserPath $userNpm

  if (Test-Command "pnpm.cmd") {
    Write-Host "pnpm already installed: $(pnpm.cmd --version)"
    return
  }

  Write-Step "Installing pnpm 9.12.0"
  npm.cmd install -g pnpm@9.12.0 --prefix $userNpm
  Add-UserPath $userNpm
  Write-Host "pnpm installed: $(pnpm.cmd --version)"
}

function Ensure-Rust {
  $cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
  Add-UserPath $cargoBin

  if ((Test-Command "rustc") -and (Test-Command "cargo")) {
    Write-Host "Rust already installed: $(rustc --version)"
    Write-Host "Cargo already installed: $(cargo --version)"
    return
  }

  Invoke-WingetInstall -Id "Rustlang.Rustup" -Name "Rustup"
  Add-UserPath $cargoBin

  if (Test-Command "rustup") {
    rustup default stable
  }
}

function Ensure-Msvc {
  $hasMsvc = (Get-Command "cl.exe" -ErrorAction SilentlyContinue) -or
    (Test-Path "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe") -or
    (Test-Path "$env:ProgramFiles\Microsoft Visual Studio\2022")

  if ($hasMsvc) {
    Write-Host "MSVC / Visual Studio Build Tools detected."
    return
  }

  Invoke-WingetInstall `
    -Id "Microsoft.VisualStudio.2022.BuildTools" `
    -Name "Visual Studio 2022 Build Tools with C++ workload" `
    -Override "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
}

function Ensure-WebView2 {
  $webView2Roots = @(
    "${env:ProgramFiles(x86)}\Microsoft\EdgeWebView\Application",
    "$env:ProgramFiles\Microsoft\EdgeWebView\Application"
  )

  if ($webView2Roots | Where-Object { Test-Path $_ }) {
    Write-Host "WebView2 Runtime detected."
    return
  }

  Invoke-WingetInstall -Id "Microsoft.EdgeWebView2Runtime" -Name "Microsoft Edge WebView2 Runtime"
}

Write-Host "VascEdu setup"
Write-Host "This installs the tools and dependencies needed for the React/Vite/Tauri desktop app."

Write-Step "Checking system dependencies"
Ensure-Node
Ensure-Pnpm
Ensure-Rust
Ensure-Msvc
Ensure-WebView2

Write-Step "Installing project dependencies"
pnpm.cmd install --frozen-lockfile

Write-Step "Fetching Rust dependencies"
Push-Location "apps\desktop\src-tauri"
cargo fetch
Pop-Location

if (-not $SkipChecks) {
  Write-Step "Running TypeScript check"
  pnpm.cmd typecheck

  Write-Step "Running Rust check"
  Push-Location "apps\desktop\src-tauri"
  cargo check
  Pop-Location

  Write-Step "Checking Tauri environment"
  pnpm.cmd -C apps/desktop exec tauri info
}

Write-Step "Done"
Write-Host "Run web mode with:      pnpm dev:web"
Write-Host "Run desktop mode with:  pnpm dev"
