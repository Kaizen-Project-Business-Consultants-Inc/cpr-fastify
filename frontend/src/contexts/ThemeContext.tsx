import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { ThemeProvider, createTheme, Theme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

/* ────────────────────────────────────────────────────────────────────────
   GTACPR BRAND RE-SKIN — color & font tokens only.
   No layout, component structure, or functionality is changed. Every screen
   keeps its current behavior; only the palette and typeface are swapped to
   match the GTACPR design system (Stage 3).

   Brand tokens applied:
     red    #CC1F1F   primary / CTAs / active states
     rdk    #9B1515   hover/active on red
     rlt    #FFF0F0   tinted fills (used by components, not the theme)
     grays  #F9FAFB #F3F4F6 #E5E7EB #9CA3AF #4B5563 #1F2937 #111827
     error  #A3122B   deliberately not the brand red, so errors don't read as CTAs
     font   Inter, self-hosted via @fontsource/inter (imported in main.tsx)
──────────────────────────────────────────────────────────────────────── */

// Theme context type
interface ThemeContextType {
  isDarkMode: boolean;
  toggleTheme: () => void;
  theme: Theme;
}

// Create context
const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Custom hook to use theme context
export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

// Theme provider props
interface ThemeProviderProps {
  children: ReactNode;
}

// Shared font stack — GTACPR uses Inter
const FONT_STACK = ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Arial', 'sans-serif'].join(',');

// Shared typography scale (unchanged from original, font family swapped to Inter)
const typography = {
  fontFamily: FONT_STACK,
  h1: { fontSize: '2.5rem', fontWeight: 700, lineHeight: 1.2 },
  h2: { fontSize: '2rem', fontWeight: 700, lineHeight: 1.2 },
  h3: { fontSize: '1.75rem', fontWeight: 700, lineHeight: 1.2 },
  h4: { fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.2 },
  h5: { fontSize: '1.25rem', fontWeight: 700, lineHeight: 1.2 },
  h6: { fontSize: '1rem', fontWeight: 700, lineHeight: 1.2 },
  subtitle1: { fontSize: '1rem', fontWeight: 500, lineHeight: 1.5 },
  subtitle2: { fontSize: '0.875rem', fontWeight: 500, lineHeight: 1.5 },
  body1: { fontSize: '1rem', lineHeight: 1.5 },
  body2: { fontSize: '0.875rem', lineHeight: 1.5 },
  button: { fontSize: '0.875rem', fontWeight: 700, textTransform: 'none' as const },
};

// Shared transitions (unchanged)
const transitions = {
  duration: {
    shortest: 150, shorter: 200, short: 250, standard: 300,
    complex: 375, enteringScreen: 225, leavingScreen: 195,
  },
  easing: {
    easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
    easeOut: 'cubic-bezier(0.0, 0, 0.2, 1)',
    easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
    sharp: 'cubic-bezier(0.4, 0, 0.6, 1)',
  },
};

// ── LIGHT THEME ──────────────────────────────────────────────────────────
const lightTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#CC1F1F',        // was #1976d2 — GTACPR brand red
      light: '#E04A4A',       // was #42a5f5
      dark: '#9B1515',        // was #1565c0 — --rdk
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#4B5563',        // was #9c27b0 — neutral slate, keeps red the only accent
      light: '#6B7280',
      dark: '#1F2937',
      contrastText: '#ffffff',
    },
    error: {
      main: '#A3122B',        // darker crimson, kept distinct from the brand red so errors don't look like buttons
      light: '#D14157',
      dark: '#7A0D20',
      contrastText: '#ffffff',
    },
    warning: {
      main: '#ED6C02',
      light: '#FF9800',
      dark: '#E65100',
      contrastText: '#ffffff',
    },
    info: {
      main: '#2563EB',        // GTACPR accent blue (trust bar)
      light: '#3B82F6',
      dark: '#1D4ED8',
      contrastText: '#ffffff',
    },
    success: {
      main: '#16A34A',        // GTACPR accent green
      light: '#22C55E',
      dark: '#15803D',
      contrastText: '#ffffff',
    },
    background: {
      default: '#F9FAFB',     // was #f8f9fa — --g50
      paper: '#FFFFFF',
    },
    text: {
      primary: '#1F2937',     // was #2c3e50 — --g800
      secondary: '#4B5563',   // was #6c757d — --g600
    },
    divider: '#E5E7EB',       // was rgba(0,0,0,.12) — --g200
  },
  typography,
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: 8,
          fontWeight: 700,
          padding: '8px 16px',
          '&:focus': {
            outline: '2px solid #CC1F1F',   // was #1976d2
            outlineOffset: '2px',
          },
        },
        contained: {
          boxShadow: 'none',
          '&:hover': { boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.1)' },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { borderRadius: 10, boxShadow: '0px 1px 3px rgba(0, 0, 0, 0.08)' },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: { borderRadius: 10, boxShadow: '0px 1px 3px rgba(0, 0, 0, 0.08)' },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottom: '1px solid #F3F4F6', padding: '12px 16px' },
        head: { fontWeight: 700, backgroundColor: '#111827', color: '#ffffff' },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: { '&:hover': { backgroundColor: '#F9FAFB' } },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: { boxShadow: '0px 1px 3px rgba(0, 0, 0, 0.05)' },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: { borderRight: '1px solid #E5E7EB' },
      },
    },
    MuiListItem: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          margin: '4px 8px',
          '&.Mui-selected': {
            backgroundColor: 'rgba(204, 31, 31, 0.08)',   // was rgba(25,118,210,.08)
            '&:hover': { backgroundColor: 'rgba(204, 31, 31, 0.12)' },
          },
          '&:focus': { outline: '2px solid #CC1F1F', outlineOffset: '2px' },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          '&:hover': { backgroundColor: 'rgba(0, 0, 0, 0.04)' },
          '&:focus': { outline: '2px solid #CC1F1F', outlineOffset: '2px' },
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            '&:focus-within': { outline: '2px solid #CC1F1F', outlineOffset: '2px' },
          },
        },
      },
    },
  },
  shape: { borderRadius: 8 },
  transitions,
});

// ── DARK THEME ───────────────────────────────────────────────────────────
const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#E04A4A',        // was #90caf9 — lighter red reads better on dark
      light: '#F08A8A',
      dark: '#CC1F1F',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#9CA3AF',        // was #ce93d8 — neutral on dark
      light: '#D1D5DB',
      dark: '#6B7280',
      contrastText: '#111827',
    },
    error: {
      main: '#F08A8A',
      light: '#F4A8A8',
      dark: '#CC1F1F',
      contrastText: '#111827',
    },
    warning: {
      main: '#FFA726', light: '#FFB74D', dark: '#F57C00', contrastText: '#111827',
    },
    info: {
      main: '#60A5FA', light: '#93C5FD', dark: '#2563EB', contrastText: '#111827',
    },
    success: {
      main: '#4ADE80', light: '#86EFAC', dark: '#16A34A', contrastText: '#111827',
    },
    background: { default: '#111827', paper: '#1F2937' },
    text: { primary: '#F9FAFB', secondary: 'rgba(249, 250, 251, 0.7)' },
    divider: 'rgba(255, 255, 255, 0.12)',
  },
  typography,
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: 8,
          fontWeight: 700,
          padding: '8px 16px',
          '&:focus': { outline: '2px solid #E04A4A', outlineOffset: '2px' },   // was #90caf9
        },
        contained: {
          boxShadow: 'none',
          '&:hover': { boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.2)' },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { borderRadius: 10, boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.2)' },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: { borderRadius: 10, boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.2)' },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottom: '1px solid rgba(255, 255, 255, 0.12)', padding: '12px 16px' },
        head: { fontWeight: 700, backgroundColor: 'rgba(255, 255, 255, 0.05)' },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: { '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.04)' } },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: { boxShadow: '0px 1px 3px rgba(0, 0, 0, 0.2)' },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: { borderRight: '1px solid rgba(255, 255, 255, 0.12)' },
      },
    },
    MuiListItem: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          margin: '4px 8px',
          '&.Mui-selected': {
            backgroundColor: 'rgba(224, 74, 74, 0.12)',   // was rgba(144,202,249,.08)
            '&:hover': { backgroundColor: 'rgba(224, 74, 74, 0.18)' },
          },
          '&:focus': { outline: '2px solid #E04A4A', outlineOffset: '2px' },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.04)' },
          '&:focus': { outline: '2px solid #E04A4A', outlineOffset: '2px' },
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            '&:focus-within': { outline: '2px solid #E04A4A', outlineOffset: '2px' },
          },
        },
      },
    },
  },
  shape: { borderRadius: 8 },
  transitions,
});

// Theme provider component (unchanged)
export const CustomThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) return savedTheme === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem('theme')) setIsDarkMode(e.matches);
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  const toggleTheme = () => setIsDarkMode(!isDarkMode);

  const theme = isDarkMode ? darkTheme : lightTheme;
  const contextValue: ThemeContextType = { isDarkMode, toggleTheme, theme };

  return (
    <ThemeContext.Provider value={contextValue}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeContext.Provider>
  );
};

export default ThemeContext;
