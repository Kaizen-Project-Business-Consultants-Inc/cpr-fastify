import React from 'react';
import { IconButton, Tooltip } from '@mui/material';
import { LightMode, DarkMode } from '@mui/icons-material';
import { useTheme } from '../../contexts/ThemeContext';

interface ThemeToggleProps {
  size?: 'small' | 'medium' | 'large';
}

const ThemeToggle: React.FC<ThemeToggleProps> = ({
  size = 'medium',
}) => {
  const { isDarkMode, toggleTheme } = useTheme();

  const handleToggle = () => {
    toggleTheme();
  };

  const tooltipTitle = isDarkMode ? 'Switch to light mode' : 'Switch to dark mode';
  const ariaLabel = isDarkMode ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <Tooltip title={tooltipTitle} arrow>
      <IconButton
        onClick={handleToggle}
        size={size}
        aria-label={ariaLabel}
        sx={{
          color: 'inherit',
          '&:focus': {
            outline: '2px solid currentColor',
            outlineOffset: '2px',
          },
        }}
      >
        {isDarkMode ? (
          <LightMode 
            aria-hidden="true"
            sx={{ 
              fontSize: size === 'small' ? '1.2rem' : size === 'large' ? '1.8rem' : '1.5rem' 
            }} 
          />
        ) : (
          <DarkMode 
            aria-hidden="true"
            sx={{ 
              fontSize: size === 'small' ? '1.2rem' : size === 'large' ? '1.8rem' : '1.5rem' 
            }} 
          />
        )}
      </IconButton>
    </Tooltip>
  );
};

export default ThemeToggle;
