import { createTheme } from '@mui/material/styles';

const SANS_STACK = [
  '"Segoe UI Variable Text"',
  '"Segoe UI"',
  'system-ui',
  '-apple-system',
  'BlinkMacSystemFont',
  '"Helvetica Neue"',
  'Arial',
  'sans-serif',
].join(',');

const MONO_STACK = [
  '"Cascadia Mono"',
  '"Cascadia Code"',
  'Consolas',
  '"JetBrains Mono"',
  '"Roboto Mono"',
  'ui-monospace',
  'SFMono-Regular',
  'monospace',
].join(',');

export const tokens = {
  surface: {
    base: '#F5F7FA',
    raised: '#FFFFFF',
    sunken: '#EEF1F5',
    inverse: '#1E3A5F',
  },
  border: {
    subtle: '#E5E9EF',
    default: '#D0D7DE',
    strong: '#B7C2D2',
    inverse: '#13243D',
  },
  text: {
    primary: '#1F2937',
    secondary: '#4B5563',
    muted: '#6B7280',
    disabled: '#9CA3AF',
    onAccent: '#FFFFFF',
    onInverse: '#FFFFFF',
    heading: '#1F2937',
  },
  accent: {
    base: '#1E3A5F',
    hover: '#2A4D7A',
    pressed: '#13243D',
    soft: '#E8EEF6',
    contrast: '#FFFFFF',
  },
  accentSecondary: {
    base: '#0EA5E9',
    hover: '#38BDF8',
    soft: '#E6F4FB',
  },
  status: {
    success: '#0F6E56',
    warning: '#F59E0B',
    error: '#D32F2F',
    info: '#0EA5E9',
  },
  overlay: {
    autoMeasureLine: '#FFFF00',
    d1d2MeasureLine: '#800080',
    measureAngleLine: '#E040FB',
    // Multipoint pattern overlay (live stage position + generated points).
    patternPointSelected: '#FFC107',
    // Execution tri-state for the pattern points: the point being processed
    // (current) is red, already-visited points are green, not-yet-visited are
    // white. Connector links consecutive points to show the execution path.
    patternPointCurrent: '#FF5252',
    patternPointCompleted: '#4CAF50',
    patternPointPending: '#FFFFFF',
    patternConnector: 'rgba(255,255,255,0.45)',
    livePosition: '#FF5252',
  },
} as const;

export const spacing = {
  xxs: 0.25,
  xs: 0.5,
  sm: 1,
  md: 1.5,
  lg: 2,
  xl: 3,
  xxl: 4,
} as const;

export const radii = {
  none: 0,
  sm: 2,
  md: 4,
  lg: 6,
  pill: 999,
} as const;

const FW = {
  regular: 400,
  medium: 500,
  semibold: 600,
} as const;

export const theme = createTheme({
  cssVariables: true,
  shape: { borderRadius: radii.md },
  spacing: 8,
  typography: {
    fontFamily: SANS_STACK,
    fontSize: 13,
    htmlFontSize: 16,
    fontWeightLight: FW.regular,
    fontWeightRegular: FW.regular,
    fontWeightMedium: FW.medium,
    fontWeightBold: FW.semibold,
    h1: { fontFamily: SANS_STACK, fontWeight: FW.semibold, fontSize: 22, letterSpacing: -0.2, lineHeight: 1.2, color: tokens.text.heading },
    h2: { fontFamily: SANS_STACK, fontWeight: FW.semibold, fontSize: 19, letterSpacing: -0.15, lineHeight: 1.25, color: tokens.text.heading },
    h3: { fontFamily: SANS_STACK, fontWeight: FW.semibold, fontSize: 16, lineHeight: 1.3, color: tokens.text.heading },
    h4: { fontFamily: SANS_STACK, fontWeight: FW.semibold, fontSize: 14, lineHeight: 1.3, color: tokens.text.heading },
    h5: { fontFamily: SANS_STACK, fontWeight: FW.semibold, fontSize: 13, lineHeight: 1.3, color: tokens.text.heading },
    h6: { fontFamily: SANS_STACK, fontWeight: FW.semibold, fontSize: 12, lineHeight: 1.3, letterSpacing: 0.2, textTransform: 'uppercase', color: tokens.text.secondary },
    subtitle1: { fontFamily: SANS_STACK, fontWeight: FW.medium, fontSize: 13, lineHeight: 1.4 },
    subtitle2: { fontFamily: SANS_STACK, fontWeight: FW.semibold, fontSize: 12, lineHeight: 1.4, color: 'inherit' },
    body1: { fontFamily: SANS_STACK, fontWeight: FW.regular, fontSize: 13, lineHeight: 1.45 },
    body2: { fontFamily: SANS_STACK, fontWeight: FW.regular, fontSize: 12, lineHeight: 1.45 },
    button: { fontFamily: SANS_STACK, fontWeight: FW.medium, fontSize: 12, letterSpacing: 0.1, textTransform: 'none' },
    caption: { fontFamily: SANS_STACK, fontWeight: FW.regular, fontSize: 11, letterSpacing: 0.2, lineHeight: 1.3 },
    overline: { fontFamily: SANS_STACK, fontWeight: FW.semibold, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', lineHeight: 1.4 },
  },
  palette: {
    mode: 'light',
    primary: {
      main: tokens.accent.base,
      light: tokens.accent.hover,
      dark: tokens.accent.pressed,
      contrastText: tokens.accent.contrast,
    },
    secondary: {
      main: tokens.status.success,
      contrastText: '#FFFFFF',
    },
    success: {
      main: tokens.status.success,
      contrastText: '#FFFFFF',
    },
    warning: {
      main: tokens.status.warning,
      contrastText: tokens.text.primary,
    },
    error: {
      main: tokens.status.error,
      contrastText: '#FFFFFF',
    },
    info: {
      main: tokens.status.info,
      contrastText: '#FFFFFF',
    },
    background: {
      default: tokens.surface.base,
      paper: tokens.surface.raised,
    },
    divider: tokens.border.default,
    text: {
      primary: tokens.text.primary,
      secondary: tokens.text.secondary,
      disabled: tokens.text.disabled,
    },
    action: {
      hover: 'rgba(30, 58, 95, 0.06)',
      selected: 'rgba(30, 58, 95, 0.12)',
      focus: 'rgba(30, 58, 95, 0.18)',
      disabled: tokens.text.disabled,
      disabledBackground: tokens.surface.sunken,
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          fontFeatureSettings: '"ss01", "cv01", "cv11", "tnum"',
          fontVariantNumeric: 'tabular-nums',
          textRendering: 'optimizeLegibility',
        },
        'table, .MuiTableCell-root, code, kbd, samp, pre': {
          fontVariantNumeric: 'tabular-nums',
        },
      },
    },
    MuiTypography: {
      styleOverrides: {
        root: {
          fontVariantNumeric: 'tabular-nums',
        },
      },
    },
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
      styleOverrides: {
        root: {
          fontFamily: SANS_STACK,
          fontWeight: FW.medium,
          letterSpacing: 0.1,
          textTransform: 'none',
          borderRadius: radii.md,
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: radii.md,
        },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          fontFamily: SANS_STACK,
          fontWeight: FW.medium,
          textTransform: 'none',
          borderRadius: radii.md,
          borderColor: tokens.border.default,
          color: tokens.text.secondary,
          '&.Mui-selected': {
            backgroundColor: tokens.accent.soft,
            color: tokens.accent.base,
            borderColor: tokens.accent.base,
          },
          '&.Mui-selected:hover': {
            backgroundColor: tokens.accent.soft,
          },
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          fontFamily: SANS_STACK,
          fontWeight: FW.medium,
          textTransform: 'none',
          letterSpacing: 0.1,
          minHeight: 40,
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        root: {
          minHeight: 40,
        },
        indicator: {
          height: 2,
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          fontFamily: SANS_STACK,
          fontVariantNumeric: 'tabular-nums',
          borderColor: tokens.border.subtle,
        },
        head: {
          fontWeight: FW.semibold,
          letterSpacing: 0.2,
          backgroundColor: tokens.surface.sunken,
          color: tokens.text.secondary,
        },
      },
    },
    MuiInputBase: {
      styleOverrides: {
        root: {
          fontFamily: SANS_STACK,
          fontVariantNumeric: 'tabular-nums',
        },
        input: {
          fontFamily: SANS_STACK,
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: radii.md,
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: tokens.border.default,
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: tokens.border.strong,
          },
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        size: 'small',
        variant: 'outlined',
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          fontFamily: SANS_STACK,
          fontSize: 11,
          fontWeight: FW.medium,
          backgroundColor: tokens.text.primary,
        },
        arrow: {
          color: tokens.text.primary,
        },
      },
    },
    MuiPaper: {
      defaultProps: {
        elevation: 0,
      },
      styleOverrides: {
        root: {
          backgroundColor: tokens.surface.raised,
          backgroundImage: 'none',
        },
        outlined: {
          borderColor: tokens.border.default,
        },
      },
    },
    MuiCard: {
      defaultProps: {
        elevation: 0,
        variant: 'outlined',
      },
      styleOverrides: {
        root: {
          borderColor: tokens.border.default,
          borderRadius: radii.md,
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: radii.md,
        },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: tokens.border.subtle,
        },
      },
    },
    MuiAppBar: {
      defaultProps: {
        elevation: 0,
        color: 'default',
      },
      styleOverrides: {
        root: {
          backgroundColor: tokens.surface.inverse,
          color: tokens.text.onInverse,
        },
      },
    },
  },
});

export const fonts = {
  sans: SANS_STACK,
  mono: MONO_STACK,
};
