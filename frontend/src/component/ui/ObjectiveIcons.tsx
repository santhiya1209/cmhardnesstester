import SvgIcon, { type SvgIconProps } from '@mui/material/SvgIcon';

export function Objective10xIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M7 3.5h10v3H7z" />
        <path d="M8 6.5h8l-1.2 11.5a1 1 0 0 1-1 .9h-3.6a1 1 0 0 1-1-.9z" />
        <line x1="8.4" y1="10" x2="15.6" y2="10" />
        <line x1="8.7" y1="13" x2="15.3" y2="13" />
        <ellipse cx="12" cy="19.5" rx="2.6" ry="0.9" />
      </g>
    </SvgIcon>
  );
}

export function Objective40xIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8 2.5h8v2.5H8z" />
        <path d="M8.5 5h7l-0.6 3.5h-5.8z" />
        <path d="M9.1 8.5h5.8l-1 10.4a1 1 0 0 1-1 .9h-1.8a1 1 0 0 1-1-.9z" />
        <line x1="9.4" y1="11" x2="14.6" y2="11" />
        <line x1="9.6" y1="13.2" x2="14.4" y2="13.2" />
        <line x1="9.8" y1="15.4" x2="14.2" y2="15.4" />
        <ellipse cx="12" cy="20.2" rx="1.9" ry="0.7" />
      </g>
    </SvgIcon>
  );
}

export function IndentCenterIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 5.5 L18.5 12 L12 18.5 L5.5 12 Z" />
        <line x1="12" y1="2.5" x2="12" y2="6" />
        <line x1="12" y1="18" x2="12" y2="21.5" />
        <line x1="2.5" y1="12" x2="6" y2="12" />
        <line x1="18" y1="12" x2="21.5" y2="12" />
        <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
      </g>
    </SvgIcon>
  );
}
