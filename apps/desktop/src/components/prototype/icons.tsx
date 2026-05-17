// Ported from the VascEdu design prototype (icons.jsx).
// Line-based 18x18 SVG icon set. Only the icons used by the Home, Cases, and
// Settings layouts are ported here.
import type { ReactNode } from 'react';

export interface IconProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

function Ic(path: ReactNode, opts: { sw?: number } = {}) {
  return function Icon({ size = 18, className = '', style }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth={opts.sw ?? 1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        style={style}
        aria-hidden="true"
      >
        {path}
      </svg>
    );
  };
}

export const IcStack = Ic(
  <>
    <path d="M9 2.5 2.5 5.5 9 8.5l6.5-3z" />
    <path d="M2.5 9 9 12l6.5-3" />
    <path d="M2.5 12.5 9 15.5l6.5-3" />
  </>,
);

export const IcSearch = Ic(
  <>
    <circle cx="8" cy="8" r="4.5" />
    <path d="M11.5 11.5 15 15" />
  </>,
);

export const IcArrowRight = Ic(
  <>
    <path d="M3 9h12" />
    <path d="M11 5l4 4-4 4" />
  </>,
);

export const IcArrowUpRight = Ic(
  <>
    <path d="M5.5 12.5 12.5 5.5" />
    <path d="M6.5 5.5h6v6" />
  </>,
);

export const IcPlay = Ic(
  <>
    <path d="M5 3.5v11l9-5.5z" />
  </>,
);

export const IcCheck = Ic(
  <>
    <path d="M3.5 9.5 7 13l8-8.5" />
  </>,
);

export const IcClock = Ic(
  <>
    <circle cx="9" cy="9" r="6.5" />
    <path d="M9 5v4.2l2.5 1.5" />
  </>,
);

export const IcUser = Ic(
  <>
    <circle cx="9" cy="6.5" r="2.8" />
    <path d="M3.5 15.5c1-2.6 3.2-4 5.5-4s4.5 1.4 5.5 4" />
  </>,
);

export const IcBookmark = Ic(
  <>
    <path d="M4.5 2.5h9v13l-4.5-3-4.5 3z" />
  </>,
);

export const IcLayers = Ic(
  <>
    <path d="M9 2.5 2.5 6 9 9.5 15.5 6z" />
    <path d="M2.5 12 9 15.5 15.5 12" />
  </>,
);

export const IcGrid = Ic(
  <>
    <rect x="2.5" y="2.5" width="5" height="5" rx="1" />
    <rect x="10.5" y="2.5" width="5" height="5" rx="1" />
    <rect x="2.5" y="10.5" width="5" height="5" rx="1" />
    <rect x="10.5" y="10.5" width="5" height="5" rx="1" />
  </>,
);

export const IcList = Ic(
  <>
    <path d="M3 4.5h12M3 9h12M3 13.5h12" />
    <circle cx="3" cy="4.5" r="0.4" fill="currentColor" />
  </>,
);

export const IcBranch = Ic(
  <>
    <circle cx="5" cy="4" r="1.4" />
    <circle cx="13" cy="4" r="1.4" />
    <circle cx="5" cy="14" r="1.4" />
    <path d="M5 5.4v7.2" />
    <path d="M13 5.4c0 3-3 4-8 4.6" />
  </>,
);

export const IcUpload = Ic(
  <>
    <path d="M9 3.5v9" />
    <path d="M5.5 7 9 3.5 12.5 7" />
    <path d="M3 14h12" />
  </>,
);

export const IcDownload = Ic(
  <>
    <path d="M9 3.5v9" />
    <path d="M5.5 9 9 12.5 12.5 9" />
    <path d="M3 14h12" />
  </>,
);

export const IcMoon = Ic(
  <>
    <path d="M14.5 10.5A6 6 0 1 1 7.5 3.5 4.6 4.6 0 0 0 14.5 10.5z" />
  </>,
);

export const IcSun = Ic(
  <>
    <circle cx="9" cy="9" r="3" />
    <path d="M9 2v1.5M9 14.5V16M2 9h1.5M14.5 9H16M4 4l1 1M13 13l1 1M4 14l1-1M13 5l1-1" />
  </>,
);

export const IcCog = Ic(
  <>
    <circle cx="9" cy="9" r="2.4" />
    <path d="M9 1.5v2M9 14.5v2M3.7 3.7l1.4 1.4M12.9 12.9l1.4 1.4M1.5 9h2M14.5 9h2M3.7 14.3l1.4-1.4M12.9 5.1l1.4-1.4" />
  </>,
);

export const IcInfo = Ic(
  <>
    <circle cx="9" cy="9" r="6.5" />
    <path d="M9 8v5" />
    <circle cx="9" cy="5.5" r="0.4" fill="currentColor" />
  </>,
);

export const IcAlert = Ic(
  <>
    <path d="M9 2.5 16 14.5H2z" />
    <path d="M9 7v4" />
    <circle cx="9" cy="13" r="0.4" fill="currentColor" />
  </>,
);

export const IcPlus = Ic(
  <>
    <path d="M9 3v12M3 9h12" />
  </>,
);

export const IcSlice = Ic(
  <>
    <ellipse cx="9" cy="9" rx="6.5" ry="2.5" />
    <path d="M2.5 9c0 1.5 2.9 2.5 6.5 2.5" />
  </>,
);

export const IcKey = Ic(
  <>
    <circle cx="6" cy="9" r="2.5" />
    <path d="M8.5 9H15.5" />
    <path d="M13 9V12M15 9V11" />
  </>,
);

export const IcAnatomyAAA = Ic(
  <>
    <path d="M9 1.5v3.5" />
    <path d="M7 5h4l1 3-1.5 4h-3L6 8z" />
    <path d="M9 12v4" />
    <path d="M9 16l-2 .5M9 16l2 .5" />
  </>,
  { sw: 1.4 },
);

export const IcAnatomyCarotid = Ic(
  <>
    <path d="M7 2v5" />
    <path d="M11 2v4" />
    <path d="M7 7c0 2 .5 4 2 5 1.5-1 2-3 2-5" />
    <path d="M9 12v4" />
  </>,
  { sw: 1.4 },
);

export const IcAnatomyAccess = Ic(
  <>
    <path d="M3 9h6" />
    <path d="M9 9c1.5 0 3-1 4-2.5" />
    <path d="M9 9c1.5 0 3 1 4 2.5" />
    <circle cx="13" cy="6.5" r="1" />
    <circle cx="13" cy="11.5" r="1" />
  </>,
  { sw: 1.4 },
);

export const IcAnatomyThoracic = Ic(
  <>
    <path d="M5 14V8c0-2.8 1.7-4.5 4-4.5s4 1.7 4 4.5v6" />
    <path d="M6 4.5v2M9 3.5v2M12 4.5v2" />
    <path d="M5 14h8" />
  </>,
  { sw: 1.4 },
);

export const IcAnatomyPAD = Ic(
  <>
    <path d="M6 2v6c0 1 .5 1.5 1 2.5l-.5 5" />
    <path d="M12 2v6c0 1-.5 1.5-1 2.5l.5 5" />
    <path d="M6.5 16h-1M11.5 16h1" />
  </>,
  { sw: 1.4 },
);

export const IcAnatomyVisceral = Ic(
  <>
    <path d="M9 2v6" />
    <path d="M9 8c-1.5 0-3 .5-4 2" />
    <path d="M9 8c1.5 0 3 .5 4 2" />
    <ellipse cx="4" cy="12" rx="1.8" ry="2.8" />
    <ellipse cx="14" cy="12" rx="1.8" ry="2.8" />
    <path d="M9 8v8" />
  </>,
  { sw: 1.4 },
);

export const IcAnatomyVenous = Ic(
  <>
    <path d="M5 2v14" />
    <path d="M13 2v14" />
    <path d="M5 5l-1.5-1M5 5l-1.5 1" />
    <path d="M5 10l-1.5-1M5 10l-1.5 1" />
    <path d="M13 7l1.5-1M13 7l1.5 1" />
    <path d="M13 12l1.5-1M13 12l1.5 1" />
  </>,
  { sw: 1.4 },
);

// Maps a category id to its anatomy glyph (handles legacy aliases).
export const ANAT_ICON: Record<string, (props: IconProps) => JSX.Element> = {
  aaa: IcAnatomyAAA,
  aneurysm: IcAnatomyAAA,
  cerebrovascular: IcAnatomyCarotid,
  carotid: IcAnatomyCarotid,
  'dialysis-access': IcAnatomyAccess,
  dialysis: IcAnatomyAccess,
  thoracic: IcAnatomyThoracic,
  pad: IcAnatomyPAD,
  'peripheral-arterial-disease': IcAnatomyPAD,
  'mesenteric-renal': IcAnatomyVisceral,
  mesenteric: IcAnatomyVisceral,
  venous: IcAnatomyVenous,
};

export function anatomyIcon(categoryId: string): (props: IconProps) => JSX.Element {
  return ANAT_ICON[categoryId] ?? IcAnatomyAAA;
}
