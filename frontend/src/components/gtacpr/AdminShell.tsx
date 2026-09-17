import React, { ReactNode, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  Box,
  Typography,
  Drawer,
  ButtonBase,
  IconButton,
  useMediaQuery,
  useTheme as useMuiTheme,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import ThemeToggle from '../common/ThemeToggle';
import { RED, RED_DARK, SIDEBAR_BG, SIDEBAR_BORDER, SIDEBAR_TEXT, SIDEBAR_TEXT_MUTED, SIDEBAR_HOVER, SIDEBAR_DOT } from './tokens';

const SIDEBAR_WIDTH = 248;

export interface ShellNavItem {
  label: string;
  path: string;
}

export interface AdminShellProps {
  eyebrow: string;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  portalName?: string;
  navItems: ShellNavItem[];
  basePath: string;
  subtitle?: string;
  onNavigate?: (path: string) => void;
  activePath?: string;
}

const AdminShell: React.FC<AdminShellProps> = ({
  eyebrow,
  title,
  actions,
  children,
  portalName = 'Admin Console',
  navItems,
  basePath,
  subtitle,
  onNavigate,
  activePath,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const muiTheme = useMuiTheme();
  const isMobile = useMediaQuery(muiTheme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (path: string) => {
    if (activePath) return path === activePath;
    const segments = location.pathname.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1];
    if (path === basePath) {
      return lastSegment === basePath || location.pathname.endsWith('/' + basePath);
    }
    if (path.startsWith('/')) return location.pathname === path || location.pathname.startsWith(path + '/');
    return lastSegment === path || location.pathname.endsWith('/' + path);
  };

  const handleNavClick = (path: string) => {
    if (isMobile) setMobileOpen(false);
    if (onNavigate) {
      onNavigate(path);
    } else {
      navigate(path);
    }
  };

  const userInitial = (user?.firstName?.[0] || user?.username?.[0] || 'A').toUpperCase();
  const userName = user?.firstName
    ? `${user.firstName} ${user.lastName || ''}`.trim()
    : user?.username || 'User';
  const userEmail = user?.email || '';

  const handleLogout = () => {
    if (isMobile) setMobileOpen(false);
    logout();
    navigate('/');
  };

  const sidebarContent = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Brand block */}
      <Box
        sx={{
          padding: '20px 22px',
          borderBottom: `1px solid ${SIDEBAR_BORDER}`,
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}
      >
        <Box
          sx={{
            width: 34,
            height: 34,
            borderRadius: '8px',
            backgroundColor: RED,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Typography sx={{ color: SIDEBAR_TEXT, fontSize: '16px', fontWeight: 800 }}>G</Typography>
        </Box>
        <Box>
          <Typography
            sx={{
              fontSize: '15px',
              fontWeight: 800,
              color: SIDEBAR_TEXT,
              letterSpacing: '-0.01em',
              lineHeight: 1.2,
            }}
          >
            GTACPR
          </Typography>
          <Typography
            sx={{
              fontSize: '9.5px',
              fontWeight: 600,
              color: SIDEBAR_TEXT_MUTED,
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              lineHeight: 1.2,
            }}
          >
            {portalName}
          </Typography>
        </Box>
      </Box>

      {/* Subtitle (e.g. org name) */}
      {subtitle && (
        <Box sx={{ padding: '10px 22px', borderBottom: `1px solid ${SIDEBAR_BORDER}` }}>
          <Typography
            sx={{
              fontSize: '11px',
              fontWeight: 600,
              color: SIDEBAR_TEXT_MUTED,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {subtitle}
          </Typography>
        </Box>
      )}

      {/* Nav list */}
      <Box component="nav" aria-label="Sidebar" sx={{ padding: '14px 12px', flex: 1, overflowY: 'auto' }}>
        {navItems.map((item) => {
          const active = isActive(item.path);
          return (
            <ButtonBase
              key={item.path}
              onClick={() => handleNavClick(item.path)}
              aria-current={active ? 'page' : undefined}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: '11px',
                padding: '9px 12px',
                borderRadius: '8px',
                width: '100%',
                justifyContent: 'flex-start',
                mb: '2px',
                backgroundColor: active ? RED : 'transparent',
                '&:hover': {
                  backgroundColor: active ? RED_DARK : SIDEBAR_HOVER,
                },
                '&:focus-visible': {
                  outline: `2px solid ${RED}`,
                  outlineOffset: '2px',
                },
              }}
            >
              <Box
                sx={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  backgroundColor: active ? SIDEBAR_TEXT : SIDEBAR_DOT,
                  flexShrink: 0,
                }}
              />
              <Typography
                sx={{
                  fontSize: '13.5px',
                  fontWeight: active ? 700 : 500,
                  color: active ? SIDEBAR_TEXT : SIDEBAR_TEXT_MUTED,
                  lineHeight: 1.3,
                  textAlign: 'left',
                }}
              >
                {item.label}
              </Typography>
            </ButtonBase>
          );
        })}
      </Box>

      {/* Help & support */}
      <Box sx={{ padding: '0 12px 2px' }}>
        <ButtonBase
          component="a"
          href="mailto:admin@kpbc.ca?subject=CPR%20Training%20Portal%20support"
          aria-label="Email support"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: '11px',
            padding: '9px 12px',
            borderRadius: '8px',
            width: '100%',
            justifyContent: 'flex-start',
            '&:hover': { backgroundColor: SIDEBAR_HOVER },
            '&:focus-visible': { outline: `2px solid ${RED}`, outlineOffset: '2px' },
          }}
        >
          <Box sx={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: SIDEBAR_DOT, flexShrink: 0 }} />
          <Typography sx={{ fontSize: '13.5px', fontWeight: 500, color: SIDEBAR_TEXT_MUTED }}>
            Help &amp; Support
          </Typography>
        </ButtonBase>
      </Box>

      {/* Logout */}
      <Box sx={{ padding: '0 12px 8px' }}>
        <ButtonBase
          onClick={handleLogout}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: '11px',
            padding: '9px 12px',
            borderRadius: '8px',
            width: '100%',
            justifyContent: 'flex-start',
            '&:hover': { backgroundColor: SIDEBAR_HOVER },
            '&:focus-visible': {
              outline: `2px solid ${RED}`,
              outlineOffset: '2px',
            },
          }}
        >
          <Box
            sx={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              backgroundColor: SIDEBAR_DOT,
              flexShrink: 0,
            }}
          />
          <Typography sx={{ fontSize: '13.5px', fontWeight: 500, color: SIDEBAR_TEXT_MUTED }}>
            Logout
          </Typography>
        </ButtonBase>
      </Box>

      {/* User block */}
      <Box
        sx={{
          padding: '16px 18px',
          borderTop: `1px solid ${SIDEBAR_BORDER}`,
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}
      >
        <Box
          sx={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            backgroundColor: RED,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Typography sx={{ color: SIDEBAR_TEXT, fontSize: '13px', fontWeight: 700 }}>
            {userInitial}
          </Typography>
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            sx={{
              fontSize: '13px',
              fontWeight: 600,
              color: SIDEBAR_TEXT,
              lineHeight: 1.3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {userName}
          </Typography>
          {userEmail && (
            <Typography
              sx={{
                fontSize: '11px',
                color: SIDEBAR_TEXT_MUTED,
                lineHeight: 1.3,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {userEmail}
            </Typography>
          )}
        </Box>
        <Box sx={{ ml: 'auto' }}>
          <ThemeToggle size="small" />
        </Box>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {/* Skip-to-content link for keyboard users */}
      <Box
        component="a"
        href="#main-content"
        sx={{
          position: 'absolute',
          left: '-9999px',
          top: 'auto',
          width: '1px',
          height: '1px',
          overflow: 'hidden',
          '&:focus': {
            position: 'fixed',
            top: 8,
            left: 8,
            width: 'auto',
            height: 'auto',
            padding: '8px 16px',
            backgroundColor: RED,
            color: '#fff',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 700,
            zIndex: 9999,
            outline: 'none',
          },
        }}
      >
        Skip to main content
      </Box>

      {/* Sidebar — permanent on desktop, temporary on mobile */}
      <Drawer
        variant={isMobile ? 'temporary' : 'permanent'}
        open={isMobile ? mobileOpen : true}
        onClose={() => setMobileOpen(false)}
        ModalProps={{ keepMounted: true }}
        aria-label="Main navigation"
        sx={{
          width: isMobile ? 0 : SIDEBAR_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: SIDEBAR_WIDTH,
            boxSizing: 'border-box',
            backgroundColor: SIDEBAR_BG,
            borderRight: 'none',
          },
        }}
      >
        {sidebarContent}
      </Drawer>

      {/* Main content */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        {/* Top header */}
        <Box
          component="header"
          sx={{
            backgroundColor: (theme) => theme.palette.background.paper,
            borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
            padding: { xs: '14px 16px', md: '18px 32px' },
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            {isMobile && (
              <IconButton
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation"
                size="small"
                sx={{ mr: 0.5 }}
              >
                <MenuIcon />
              </IconButton>
            )}
            <Box>
              <Typography
                sx={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: (theme) => theme.palette.text.secondary,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  lineHeight: 1,
                  mb: 0.5,
                }}
              >
                {eyebrow}
              </Typography>
              <Typography
                component="h1"
                sx={{
                  fontSize: '21px',
                  fontWeight: 800,
                  color: (theme) => theme.palette.text.primary,
                  letterSpacing: '-0.015em',
                  lineHeight: 1.2,
                }}
              >
                {title}
              </Typography>
            </Box>
          </Box>
          {actions && (
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
              {actions}
            </Box>
          )}
        </Box>

        {/* Content area */}
        <Box
          component="main"
          id="main-content"
          sx={{
            backgroundColor: (theme) => theme.palette.background.default,
            padding: { xs: '20px 16px', md: '28px 32px' },
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: '24px',
            overflowY: 'auto',
          }}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
};

export default AdminShell;
