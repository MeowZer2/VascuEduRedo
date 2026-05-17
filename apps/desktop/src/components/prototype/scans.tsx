// Ported from the VascEdu design prototype (components.jsx).
// Stylized CT/CTA/3D-recon thumbnails. Each pairs a CSS radial-gradient body
// (.scan-* classes in redesign.css) with a light SVG vessel overlay.

interface ScanProps {
  wide?: boolean;
  tall?: boolean;
  label?: string;
}

export function ScanAAA({ wide = false, tall = false, label = 'AXIAL · 3.0mm' }: ScanProps & { withVessel?: boolean }) {
  return (
    <div className={`scan scan-aaa ${wide ? 'scan-wide' : ''} ${tall ? 'scan-tall' : ''}`}>
      <div className="scan-body">
        <svg className="vessel-overlay" viewBox="0 0 200 150" preserveAspectRatio="xMidYMid slice">
          <defs>
            <radialGradient id="aaa-l" cx="50%" cy="55%" r="40%">
              <stop offset="0%" stopColor="#ffe6c8" stopOpacity="0.92" />
              <stop offset="55%" stopColor="#f0a070" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#a04040" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="aaa-thrombus" cx="50%" cy="55%" r="45%">
              <stop offset="40%" stopColor="#7a3030" stopOpacity="0" />
              <stop offset="62%" stopColor="#5a2020" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#3a1818" stopOpacity="0" />
            </radialGradient>
          </defs>
          <ellipse cx="100" cy="82" rx="42" ry="36" fill="url(#aaa-thrombus)" />
          <ellipse cx="100" cy="82" rx="20" ry="18" fill="url(#aaa-l)" />
          <ellipse cx="100" cy="125" rx="22" ry="9" fill="rgba(255,255,255,0.07)" />
          <ellipse cx="100" cy="125" rx="10" ry="4" fill="rgba(0,0,0,0.4)" />
          <path d="M20 75 Q100 20 180 75 Q180 130 100 145 Q20 130 20 75 Z" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1.5" />
          <g stroke="#5dd4e6" strokeWidth="0.9" fill="none" opacity="0.85">
            <line x1="58" y1="82" x2="142" y2="82" strokeDasharray="2 2" />
            <circle cx="58" cy="82" r="2.5" fill="#5dd4e6" />
            <circle cx="142" cy="82" r="2.5" fill="#5dd4e6" />
          </g>
          <text x="100" y="76" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="6.5" fill="#9ce8f3" stroke="rgba(0,0,0,0.7)" strokeWidth="1.2" paintOrder="stroke">61.4 mm</text>
        </svg>
        <div className="scan-overlay-grid" />
      </div>
      <div className="scan-tl">L · 70/300</div>
      <div className="scan-tr">REC</div>
      <div className="scan-orient">A</div>
      <div className="scan-meta">
        <span>{label}</span>
        <span>WL 60 / WW 360</span>
      </div>
    </div>
  );
}

export function ScanCarotid({ wide = false, tall = false, label = 'CORONAL · 1.0mm' }: ScanProps) {
  return (
    <div className={`scan scan-carotid ${wide ? 'scan-wide' : ''} ${tall ? 'scan-tall' : ''}`}>
      <div className="scan-body">
        <svg className="vessel-overlay" viewBox="0 0 200 150" preserveAspectRatio="xMidYMid slice">
          <defs>
            <linearGradient id="ca-l" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#dde9ff" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#9bb6e0" stopOpacity="0.3" />
            </linearGradient>
          </defs>
          <ellipse cx="100" cy="25" rx="80" ry="22" fill="rgba(255,255,255,0.06)" />
          <path d="M85 145 L85 70 Q85 55 75 30" stroke="url(#ca-l)" strokeWidth="6" fill="none" />
          <path d="M85 70 Q92 60 95 50 Q97 47 92 42 Q90 40 95 35 Q97 30 96 22" stroke="url(#ca-l)" strokeWidth="5" fill="none" />
          <path d="M85 70 Q70 60 60 50 Q55 45 50 28" stroke="url(#ca-l)" strokeWidth="3.5" fill="none" />
          <path d="M125 145 L125 70 Q125 55 132 30" stroke="url(#ca-l)" strokeWidth="6" fill="none" opacity="0.8" />
          <path d="M125 70 Q118 60 115 50 Q113 45 118 40 Q120 35 119 22" stroke="url(#ca-l)" strokeWidth="5" fill="none" opacity="0.8" />
          <path d="M125 70 Q138 60 145 50 Q150 40 148 28" stroke="url(#ca-l)" strokeWidth="3.5" fill="none" opacity="0.8" />
          <g stroke="#e6b256" strokeWidth="1" fill="none" opacity="0.85">
            <circle cx="93" cy="42" r="7" strokeDasharray="2 2" />
          </g>
          <text x="103" y="46" fontFamily="JetBrains Mono" fontSize="6" fill="#f3d490" stroke="rgba(0,0,0,0.7)" strokeWidth="1.2" paintOrder="stroke">85%</text>
        </svg>
        <div className="scan-overlay-grid" />
      </div>
      <div className="scan-tl">R</div>
      <div className="scan-tr">CTA</div>
      <div className="scan-orient">H</div>
      <div className="scan-meta">
        <span>{label}</span>
        <span>WL 60 / WW 360</span>
      </div>
    </div>
  );
}

export function ScanAccess({ wide = false, tall = false, label = 'AXIAL · 2.0mm' }: ScanProps) {
  return (
    <div className={`scan scan-dialysis ${wide ? 'scan-wide' : ''} ${tall ? 'scan-tall' : ''}`}>
      <div className="scan-body">
        <svg className="vessel-overlay" viewBox="0 0 200 150" preserveAspectRatio="xMidYMid slice">
          <ellipse cx="100" cy="75" rx="65" ry="40" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          <circle cx="78" cy="78" r="6" fill="#e0b896" opacity="0.65" />
          <circle cx="78" cy="78" r="3" fill="#ffd5b5" opacity="0.9" />
          <ellipse cx="110" cy="68" rx="10" ry="9" fill="#a3c5e0" opacity="0.6" />
          <ellipse cx="110" cy="68" rx="6" ry="5" fill="#cee2f0" opacity="0.8" />
          <path d="M85 75 Q95 72 102 70" stroke="#cee2f0" strokeWidth="2" fill="none" opacity="0.7" />
          <ellipse cx="100" cy="105" rx="18" ry="6" fill="rgba(255,255,255,0.18)" />
          <ellipse cx="100" cy="105" rx="10" ry="3" fill="rgba(0,0,0,0.4)" />
        </svg>
        <div className="scan-overlay-grid" />
      </div>
      <div className="scan-tl">L</div>
      <div className="scan-tr">US/CTA</div>
      <div className="scan-orient">A</div>
      <div className="scan-meta">
        <span>{label}</span>
        <span>WL 60 / WW 360</span>
      </div>
    </div>
  );
}

export function ScanThoracic({ wide = false, tall = false, label = 'VR · arch' }: ScanProps) {
  return (
    <div className={`scan scan-thoracic ${wide ? 'scan-wide' : ''} ${tall ? 'scan-tall' : ''}`}>
      <div className="scan-body">
        <svg className="vessel-overlay" viewBox="0 0 200 150" preserveAspectRatio="xMidYMid slice">
          <defs>
            <linearGradient id="th-arch" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffd9b8" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#a04c3c" stopOpacity="0.6" />
            </linearGradient>
          </defs>
          <path d="M70 130 Q70 70 95 50 Q120 35 135 50 Q155 70 145 130" fill="none" stroke="url(#th-arch)" strokeWidth="14" strokeLinecap="round" />
          <path d="M95 50 Q90 35 88 18" stroke="url(#th-arch)" strokeWidth="6" fill="none" />
          <path d="M115 38 Q115 25 113 12" stroke="url(#th-arch)" strokeWidth="5" fill="none" />
          <path d="M132 45 Q138 30 142 15" stroke="url(#th-arch)" strokeWidth="5" fill="none" />
          <path d="M75 90 Q70 110 75 130" stroke="rgba(230,178,86,0.55)" strokeWidth="1.5" strokeDasharray="3 2" fill="none" />
        </svg>
      </div>
      <div className="scan-tl">L · 70/300</div>
      <div className="scan-tr">CTA</div>
      <div className="scan-orient">A</div>
      <div className="scan-meta">
        <span>{label}</span>
        <span>WL 60 / WW 360</span>
      </div>
    </div>
  );
}

export function ScanPAD({ wide = false, tall = false, label = 'DSA · runoff' }: ScanProps) {
  return (
    <div className={`scan scan-pad ${wide ? 'scan-wide' : ''} ${tall ? 'scan-tall' : ''}`}>
      <div className="scan-body">
        <svg className="vessel-overlay" viewBox="0 0 200 150" preserveAspectRatio="xMidYMid slice">
          <defs>
            <linearGradient id="pad-l" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffdec4" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#c47054" stopOpacity="0.55" />
            </linearGradient>
          </defs>
          <path d="M82 5 Q80 35 78 65 Q72 80 76 110 Q78 130 76 148" stroke="url(#pad-l)" strokeWidth="5" fill="none" strokeLinecap="round" />
          <path d="M76 110 Q66 130 60 148" stroke="url(#pad-l)" strokeWidth="2.6" fill="none" />
          <path d="M76 110 Q86 130 88 148" stroke="url(#pad-l)" strokeWidth="2.6" fill="none" />
          <path d="M122 5 Q124 35 126 65 Q132 80 128 110" stroke="url(#pad-l)" strokeWidth="5" fill="none" opacity="0.85" />
          <g stroke="#e6b256" strokeWidth="1" fill="none" opacity="0.9">
            <circle cx="76" cy="80" r="8" strokeDasharray="2 2" />
          </g>
          <text x="92" y="84" fontFamily="JetBrains Mono" fontSize="6" fill="#f3d490" stroke="rgba(0,0,0,0.7)" strokeWidth="1.2" paintOrder="stroke">80%</text>
        </svg>
      </div>
      <div className="scan-tl">L</div>
      <div className="scan-tr">DSA</div>
      <div className="scan-orient">A</div>
      <div className="scan-meta">
        <span>{label}</span>
        <span>Runoff</span>
      </div>
    </div>
  );
}

export function ScanMesenteric({ wide = false, tall = false, label = 'CORONAL · 1.5mm' }: ScanProps) {
  return (
    <div className={`scan scan-mesenteric ${wide ? 'scan-wide' : ''} ${tall ? 'scan-tall' : ''}`}>
      <div className="scan-body">
        <svg className="vessel-overlay" viewBox="0 0 200 150" preserveAspectRatio="xMidYMid slice">
          <defs>
            <linearGradient id="mes-l" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffd9b8" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#a04c5a" stopOpacity="0.5" />
            </linearGradient>
          </defs>
          <path d="M100 8 L100 142" stroke="url(#mes-l)" strokeWidth="8" strokeLinecap="round" />
          <path d="M96 70 Q70 72 50 78" stroke="url(#mes-l)" strokeWidth="3.5" fill="none" />
          <path d="M104 70 Q130 72 150 78" stroke="url(#mes-l)" strokeWidth="3.5" fill="none" />
          <path d="M100 55 Q120 50 130 42" stroke="url(#mes-l)" strokeWidth="3.5" fill="none" />
          <path d="M100 40 Q118 36 126 28" stroke="url(#mes-l)" strokeWidth="3" fill="none" />
          <ellipse cx="40" cy="82" rx="14" ry="20" fill="rgba(220,200,180,0.18)" stroke="rgba(220,200,180,0.4)" strokeWidth="1" />
          <ellipse cx="160" cy="82" rx="14" ry="20" fill="rgba(220,200,180,0.18)" stroke="rgba(220,200,180,0.4)" strokeWidth="1" />
          <circle cx="84" cy="71" r="5" stroke="#e6b256" strokeWidth="1" fill="none" strokeDasharray="2 2" />
          <circle cx="116" cy="71" r="5" stroke="#e6b256" strokeWidth="1" fill="none" strokeDasharray="2 2" />
        </svg>
      </div>
      <div className="scan-tl">A</div>
      <div className="scan-tr">CTA</div>
      <div className="scan-orient">H</div>
      <div className="scan-meta">
        <span>{label}</span>
        <span>WL 60 / WW 360</span>
      </div>
    </div>
  );
}

export function ScanVenous({ wide = false, tall = false, label = 'VENOGRAM' }: ScanProps) {
  return (
    <div className={`scan scan-venous ${wide ? 'scan-wide' : ''} ${tall ? 'scan-tall' : ''}`}>
      <div className="scan-body">
        <svg className="vessel-overlay" viewBox="0 0 200 150" preserveAspectRatio="xMidYMid slice">
          <defs>
            <linearGradient id="ven-l" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#c5d9f0" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#5a78a8" stopOpacity="0.4" />
            </linearGradient>
          </defs>
          <path d="M100 5 L100 75" stroke="url(#ven-l)" strokeWidth="11" strokeLinecap="round" />
          <path d="M100 75 Q80 90 60 110 Q55 125 56 145" stroke="url(#ven-l)" strokeWidth="9" fill="none" />
          <path d="M100 75 Q120 90 140 110 Q145 125 144 145" stroke="url(#ven-l)" strokeWidth="9" fill="none" />
          <path d="M82 86 Q70 100 65 116" stroke="rgba(60,80,120,0.7)" strokeWidth="6" fill="none" />
          <g stroke="#e6b256" strokeWidth="1.2" fill="none" opacity="0.9">
            <circle cx="86" cy="82" r="7" strokeDasharray="2 2" />
          </g>
          <path d="M70 75 Q90 70 110 78" stroke="rgba(230,140,100,0.55)" strokeWidth="3" fill="none" />
        </svg>
      </div>
      <div className="scan-tl">L</div>
      <div className="scan-tr">VENO</div>
      <div className="scan-orient">A</div>
      <div className="scan-meta">
        <span>{label}</span>
        <span>contrast</span>
      </div>
    </div>
  );
}

// Renders the matching scan for a category id (handles legacy aliases).
export function ScanFor({ categoryId, ...props }: ScanProps & { categoryId: string }) {
  if (categoryId === 'aaa' || categoryId === 'aneurysm') return <ScanAAA {...props} />;
  if (categoryId === 'carotid' || categoryId === 'cerebrovascular') return <ScanCarotid {...props} />;
  if (categoryId === 'dialysis-access' || categoryId === 'dialysis') return <ScanAccess {...props} />;
  if (categoryId === 'thoracic') return <ScanThoracic {...props} />;
  if (categoryId === 'pad' || categoryId === 'peripheral-arterial-disease') return <ScanPAD {...props} />;
  if (categoryId === 'mesenteric-renal' || categoryId === 'mesenteric') return <ScanMesenteric {...props} />;
  if (categoryId === 'venous') return <ScanVenous {...props} />;
  return <ScanAAA {...props} />;
}
