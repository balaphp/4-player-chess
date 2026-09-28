import type { ReactNode } from 'react';

// Small line icons drawn in the current text colour, so a button's state
// colours its icon too.
function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

type Props = { size?: number };
const slash = <path d="M4 4l16 16" />;

const mic = (
  <>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <path d="M12 18v3" />
  </>
);
const camera = (
  <>
    <rect x="3" y="6" width="12" height="12" rx="2" />
    <path d="M15 10.5l6-3.5v10l-6-3.5z" />
  </>
);
const speaker = <path d="M4 9v6h4l5 4V5L8 9z" />;
const eye = (
  <>
    <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </>
);

export const MicIcon = (p: Props) => <Icon {...p}>{mic}</Icon>;
export const MicOffIcon = (p: Props) => (
  <Icon {...p}>
    {mic}
    {slash}
  </Icon>
);
export const CameraIcon = (p: Props) => <Icon {...p}>{camera}</Icon>;
export const CameraOffIcon = (p: Props) => (
  <Icon {...p}>
    {camera}
    {slash}
  </Icon>
);
export const PhoneIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M6 3h3l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2z" />
  </Icon>
);
export const HangUpIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M3 14.5c5.5-5 12.5-5 18 0l-2.5 2.5-3.5-1.5V13a10 10 0 0 0-6 0v2.5L5.5 17z" />
  </Icon>
);
export const SpeakerIcon = (p: Props) => (
  <Icon {...p}>
    {speaker}
    <path d="M16.5 9a4 4 0 0 1 0 6" />
  </Icon>
);
export const SpeakerOffIcon = (p: Props) => (
  <Icon {...p}>
    {speaker}
    <path d="M16 9.5l5 5M21 9.5l-5 5" />
  </Icon>
);
export const EyeIcon = (p: Props) => <Icon {...p}>{eye}</Icon>;
export const EyeOffIcon = (p: Props) => (
  <Icon {...p}>
    {eye}
    {slash}
  </Icon>
);
export const SendIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M4 12l16-8-6 16-3-7z" />
  </Icon>
);
