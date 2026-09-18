import React, { useState, useEffect, ReactNode } from 'react';
import { Box, Fade, Slide, Grow, useTheme } from '@mui/material';

interface PageTransitionProps {
  children: ReactNode;
  type?: 'fade' | 'slideUp' | 'slideDown' | 'slideLeft' | 'slideRight' | 'grow' | 'scale';
  duration?: number;
  delay?: number;
}

const PageTransition: React.FC<PageTransitionProps> = ({
  children,
  type = 'fade',
  duration = 300,
  delay = 0,
}) => {
  const theme = useTheme();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, delay);

    return () => clearTimeout(timer);
  }, [delay]);

  const getTransitionProps = () => {
    const baseProps = {
      in: isVisible,
      timeout: duration,
      easing: theme.transitions.easing.easeInOut,
    };

    switch (type) {
      case 'fade':
        return {
          ...baseProps,
          children: (
            <Fade {...baseProps}>
              <Box>{children}</Box>
            </Fade>
          ),
        };

      case 'slideUp':
        return {
          ...baseProps,
          children: (
            <Slide direction="up" {...baseProps}>
              <Box>{children}</Box>
            </Slide>
          ),
        };

      case 'slideDown':
        return {
          ...baseProps,
          children: (
            <Slide direction="down" {...baseProps}>
              <Box>{children}</Box>
            </Slide>
          ),
        };

      case 'slideLeft':
        return {
          ...baseProps,
          children: (
            <Slide direction="left" {...baseProps}>
              <Box>{children}</Box>
            </Slide>
          ),
        };

      case 'slideRight':
        return {
          ...baseProps,
          children: (
            <Slide direction="right" {...baseProps}>
              <Box>{children}</Box>
            </Slide>
          ),
        };

      case 'grow':
        return {
          ...baseProps,
          children: (
            <Grow {...baseProps}>
              <Box>{children}</Box>
            </Grow>
          ),
        };

      case 'scale':
        return {
          ...baseProps,
          children: (
            <Box
              sx={{
                transform: isVisible ? 'scale(1)' : 'scale(0.9)',
                opacity: isVisible ? 1 : 0,
                transition: `all ${duration}ms ${theme.transitions.easing.easeInOut}`,
              }}
            >
              {children}
            </Box>
          ),
        };

      default:
        return {
          ...baseProps,
          children: (
            <Fade {...baseProps}>
              <Box>{children}</Box>
            </Fade>
          ),
        };
    }
  };

  const transitionProps = getTransitionProps();

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        '& > *': {
          width: '100%',
          height: '100%',
        },
      }}
    >
      {transitionProps.children}
    </Box>
  );
};

export default PageTransition;
