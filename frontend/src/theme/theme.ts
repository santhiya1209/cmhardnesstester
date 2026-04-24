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

const HEADING_COLOR = '#082F49';

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
    h1: { fontFamily: SANS_STACK, fontWeight: 700, fontSize: 22, letterSpacing: -0.2, lineHeight: 1.2, color: HEADING_COLOR },
    h2: { fontFamily: SANS_STACK, fontWeight: 700, fontSize: 19, letterSpacing: -0.15, lineHeight: 1.25, color: HEADING_COLOR },
    h3: { fontFamily: SANS_STACK, fontWeight: 600, fontSize: 16, lineHeight: 1.3, color: HEADING_COLOR },
    h4: { fontFamily: SANS_STACK, fontWeight: 600, fontSize: 14, lineHeight: 1.3, color: HEADING_COLOR },
    h5: { fontFamily: SANS_STACK, fontWeight: 600, fontSize: 13, lineHeight: 1.3, color: HEADING_COLOR },
    h6: { fontFamily: SANS_STACK, fontWeight: 600, fontSize: 12, lineHeight: 1.3, letterSpacing: 0.2, textTransform: 'uppercase', color: HEADING_COLOR },
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
      main: '#0284C7',
      light: '#38BDF8',
      dark: '#075985',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#0EA5E9',
    },
    background: {
      default: '#F0F9FF',
      paper: '#FFFFFF',
    },
    divider: '#BAE6FD',
    text: {
      primary: '#0C1E2B',
      secondary: '#395B73',
    },
    action: {
      hover: 'rgba(2, 132, 199, 0.08)',
      selected: 'rgba(2, 132, 199, 0.16)',
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
  },
});

export const fonts = {
  sans: SANS_STACK,
  mono: MONO_STACK,
};

export const colors = {
  heading: HEADING_COLOR,
};
