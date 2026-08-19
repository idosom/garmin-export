/** Inline icon set — no icon font, no network requests. */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 16, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconOverview = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </Icon>
);

export const IconActivities = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 12h4l3 7 4-16 3 9h4" />
  </Icon>
);

export const IconTraining = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 20V9M10 20V4M16 20v-7M22 20V11" />
  </Icon>
);

export const IconHealth = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 1 0-7.1 7.1l8.8 8.8 8.8-8.8a5 5 0 0 0 0-7.1Z" />
  </Icon>
);

export const IconCalendar = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </Icon>
);

export const IconExplorer = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h4l2 2.5h7A1.5 1.5 0 0 1 20 8v10a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18Z" />
  </Icon>
);

export const IconUpload = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 16V4M8 8l4-4 4 4" />
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </Icon>
);

export const IconSun = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Icon>
);

export const IconMoon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
  </Icon>
);

export const IconMonitor = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </Icon>
);

export const IconClose = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

export const IconChevronRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 5l7 7-7 7" />
  </Icon>
);

export const IconSearch = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </Icon>
);

export const IconLock = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4" y="10" width="16" height="10" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </Icon>
);

export const IconAlert = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3 2.5 20h19Z" />
    <path d="M12 10v4M12 17h.01" />
  </Icon>
);

export const IconInfo = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Icon>
);

export const IconMap = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 7Z" />
    <path d="M9 4v13M15 7v12.5" />
  </Icon>
);

export const IconTrash = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16M10 11v6M14 11v6" />
    <path d="M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Icon>
);

export const IconChat = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v10a1.5 1.5 0 0 1-1.5 1.5H9l-4.5 4v-4H5.5A1.5 1.5 0 0 1 4 15.5Z" />
  </Icon>
);

export const IconSend = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 12 20 4l-6 16-3-7-7-1Z" />
  </Icon>
);

export const IconTrophy = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 4h10v5a5 5 0 0 1-10 0Z" />
    <path d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3M9 20h6M12 14v6" />
  </Icon>
);

/* ------------------------------------------------------------ sport icons */

const SPORT_PATHS: Record<string, React.ReactNode> = {
  run: <path d="M13 4.5a1.5 1.5 0 1 0 0-.01M11.5 21l1.5-5-3-2.5.8-4.5 3.2 2 3 1M7 21l3-4.5M5 9.5l3-1.5 2.3-.8" />,
  bike: (
    <>
      <circle cx="5.5" cy="17" r="3.2" />
      <circle cx="18.5" cy="17" r="3.2" />
      <path d="M9 17l3.5-7h3M13.5 5.5h3M5.5 17l5-6.5 3 6.5h5" />
    </>
  ),
  swim: <path d="M2 18c2 0 2-1.4 4-1.4S8 18 10 18s2-1.4 4-1.4S16 18 18 18s2-1.4 4-1.4M6 12l5-3.5 4 3M16.5 6.5a1.4 1.4 0 1 0 0-.01" />,
  walk: <path d="M13.5 4.5a1.4 1.4 0 1 0 0-.01M11 21l1.5-6-2.5-2.5.7-4 3 1.7 2.3 1.4M9 21l2-4.5M14 21l1.5-4" />,
  hike: <path d="M4 21l4-8 3 2.5 2-6.5M13.5 4.5a1.4 1.4 0 1 0 0-.01M15 21l-1-6.5 3-2.5 2 9" />,
  strength: <path d="M3 9v6M6 7v10M18 7v10M21 9v6M6 12h12" />,
  cardio: <path d="M3 12h4l2-4 3 8 2.5-6 1.5 4 2-2h4" />,
  row: <path d="M4 20 20 4M8 6l4 4M14 12l4 4M6 12l-2 2 4 4 2-2" />,
  ski: <path d="M3 20h18M6 18 14 5M9 20l9-11M17 6.5a1.4 1.4 0 1 0 0-.01" />,
  yoga: <path d="M12 5.5a1.5 1.5 0 1 0 0-.01M12 9v5M6 20l6-6 6 6M8 12h8" />,
  other: <circle cx="12" cy="12" r="8" />,
};

export function SportIcon({ icon, size = 16, ...rest }: IconProps & { icon: string }) {
  return <Icon size={size} {...rest}>{SPORT_PATHS[icon] ?? SPORT_PATHS.other}</Icon>;
}
