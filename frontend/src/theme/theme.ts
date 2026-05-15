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

// Industrial color tokens — single source of truth for the whole app.
export const colors = {
  headingPrimary: '#1E3A5F',
  headingSecondary: '#0F6E56',
  background: '#F5F7FA',
  panel: '#FFFFFF',
  border: '#D0D7DE',
  textPrimary: '#1F2937',
  textMuted: '#6B7280',
  buttonPrimary: '#1E3A5F',
  success: '#0F6E56',
  warning: '#F59E0B',
  error: '#D32F2F',
  // Measurement overlay colors — drawn on the camera/canvas.
  autoMeasureLine: '#FFFF00',
  d1d2MeasureLine: '#800080',
  measureAngleLine: '#E040FB',
  // Back-compat alias.
  heading: '#1E3A5F',
} as const;

export const theme = createTheme({
  cssVariables: true,
  colorSchemes: { dark: true, light: true },
  shape: { borderRadius: 4 },
  typography: {
    fontFamily: SANS_STACK,
    fontSize: 13,
    htmlFontSize: 16,
    fontWeightLight: 300,
    fontWeightRegular: 400,
    fontWeightMedium: 500,
    fontWeightBold: 600,
    h1: { fontFamily: SANS_STACK, fontWeight: 700, fontSize: 22, letterSpacing: -0.2, lineHeight: 1.2, color: colors.headingPrimary },
    h2: { fontFamily: SANS_STACK, fontWeight: 700, fontSize: 19, letterSpacing: -0.15, lineHeight: 1.25, color: colors.headingPrimary },
    h3: { fontFamily: SANS_STACK, fontWeight: 600, fontSize: 16, lineHeight: 1.3, color: colors.headingPrimary },
    h4: { fontFamily: SANS_STACK, fontWeight: 600, fontSize: 14, lineHeight: 1.3, color: colors.headingSecondary },
    h5: { fontFamily: SANS_STACK, fontWeight: 600, fontSize: 13, lineHeight: 1.3, color: colors.headingSecondary },
    h6: { fontFamily: SANS_STACK, fontWeight: 600, fontSize: 12, lineHeight: 1.3, letterSpacing: 0.2, textTransform: 'uppercase', color: colors.headingSecondary },
    subtitle1: { fontFamily: SANS_STACK, fontWeight: 500, fontSize: 13, lineHeight: 1.4 },
    subtitle2: { fontFamily: SANS_STACK, fontWeight: 600, fontSize: 12, lineHeight: 1.4, color: 'inherit' },
    body1: { fontFamily: SANS_STACK, fontWeight: 400, fontSize: 13, lineHeight: 1.45 },
    body2: { fontFamily: SANS_STACK, fontWeight: 400, fontSize: 12, lineHeight: 1.45 },
    button: { fontFamily: SANS_STACK, fontWeight: 500, fontSize: 12, letterSpacing: 0.1, textTransform: 'none' },
    caption: { fontFamily: SANS_STACK, fontWeight: 400, fontSize: 11, letterSpacing: 0.2, lineHeight: 1.3 },
    overline: { fontFamily: SANS_STACK, fontWeight: 600, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', lineHeight: 1.4 },
  },
  palette: {
    mode: 'light',
    primary: {
      main: colors.buttonPrimary,
      light: '#3A5A85',
      dark: '#13243D',
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: colors.headingSecondary,
      contrastText: '#FFFFFF',
    },
    success: {
      main: colors.success,
      contrastText: '#FFFFFF',
    },
    warning: {
      main: colors.warning,
      contrastText: '#1F2937',
    },
    error: {
      main: colors.error,
      contrastText: '#FFFFFF',
    },
    background: {
      default: colors.background,
      paper: colors.panel,
    },
    divider: colors.border,
    text: {
      primary: colors.textPrimary,
      secondary: colors.textMuted,
    },
    action: {
      hover: 'rgba(30, 58, 95, 0.08)',
      selected: 'rgba(30, 58, 95, 0.16)',
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
        // Tabular numerals everywhere numeric data is displayed.
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
      styleOverrides: {
        root: {
          fontFamily: SANS_STACK,
          fontWeight: 500,
          letterSpacing: 0.1,
          textTransform: 'none',
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          fontFamily: SANS_STACK,
          fontWeight: 500,
          textTransform: 'none',
          letterSpacing: 0.1,
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          fontFamily: SANS_STACK,
          fontVariantNumeric: 'tabular-nums',
        },
        head: {
          fontWeight: 600,
          letterSpacing: 0.2,
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
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          fontFamily: SANS_STACK,
          fontSize: 11,
          fontWeight: 500,
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundColor: colors.panel,
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: colors.headingPrimary,
          color: '#FFFFFF',
        },
      },
    },
  },
});

export const fonts = {
  sans: SANS_STACK,
  mono: MONO_STACK,
};
