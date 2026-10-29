/** Inline icon set — no icon library, no network, fully themeable. */

import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 20, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...props,
  };
}

export const IconPulse = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2 12.5h4l2.2-6.4 3.6 12.6 2.6-8.2 1.8 3.9H22" />
  </svg>
);

export const IconSend = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4.5 12 20 4.5 13.2 20l-2.3-6.4L4.5 12Z" />
  </svg>
);

export const IconBack = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

export const IconPlus = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconLock = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.6" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </svg>
);

export const IconShield = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3.2 5 6v5.4c0 4.2 2.9 7.6 7 9.4 4.1-1.8 7-5.2 7-9.4V6l-7-2.8Z" />
    <path d="m9.2 12.2 2 2 3.6-3.9" />
  </svg>
);

export const IconSettings = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </svg>
);

export const IconCheck = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m4.8 12.6 4.6 4.6L19.2 7" />
  </svg>
);

export const IconClock = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.4" />
    <path d="M12 7.6V12l3 1.8" />
  </svg>
);

export const IconAlert = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 7.6v5M12 16.2h.01" />
  </svg>
);

export const IconTrash = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4.8 7h14.4M9.6 7V5.4A1.4 1.4 0 0 1 11 4h2a1.4 1.4 0 0 1 1.4 1.4V7M6.4 7l.8 11.4A2 2 0 0 0 9.2 20h5.6a2 2 0 0 0 2-1.6L17.6 7" />
  </svg>
);

export const IconCopy = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="9" y="9" width="11" height="11" rx="2.4" />
    <path d="M15 6.2A2.2 2.2 0 0 0 12.8 4H6.2A2.2 2.2 0 0 0 4 6.2v6.6A2.2 2.2 0 0 0 6.2 15" />
  </svg>
);

export const IconDownload = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 4v10.5M7.8 10.6 12 14.8l4.2-4.2" />
    <path d="M4.8 18.4h14.4" />
  </svg>
);

export const IconSparkle = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9L12 3.5Z" />
    <path d="M18.4 16.6l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z" />
  </svg>
);

export const IconRefresh = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M20 11.4a8 8 0 1 0-2.2 6.2" />
    <path d="M20 5v6.4h-6.4" />
  </svg>
);

export const IconChevron = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9 5l7 7-7 7" />
  </svg>
);

export const IconClose = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const IconFire = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3.2c3 3.4 5.6 5.9 5.6 9.4a5.6 5.6 0 1 1-11.2 0c0-1.6.7-2.9 1.7-4.1.5 1.4 1.2 2.2 2.2 2.6-.4-3.1.4-5.8 1.7-7.9Z" />
  </svg>
);

export const IconWifi = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4.2 9.4a12.5 12.5 0 0 1 15.6 0M7 12.6a8.4 8.4 0 0 1 10 0M9.9 15.8a4.3 4.3 0 0 1 4.2 0" />
    <circle cx="12" cy="19" r="0.9" fill="currentColor" stroke="none" />
  </svg>
);

export const IconInfo = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 11v5.4M12 8h.01" />
  </svg>
);
