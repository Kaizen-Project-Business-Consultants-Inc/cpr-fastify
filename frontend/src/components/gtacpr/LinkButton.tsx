import React from 'react';
import { ButtonBase, ButtonBaseProps } from '@mui/material';
import { RED } from './tokens';

type Props = ButtonBaseProps & {
  /** Visual weight; 'danger' for destructive row actions. */
  tone?: 'brand' | 'neutral' | 'danger';
};

/**
 * Text-style action for table rows and inline links. Renders a real <button>, so it is
 * keyboard-focusable and announced by screen readers (replaces clickable <Box>/<Typography>).
 */
const LinkButton: React.FC<Props> = ({ tone = 'brand', sx, children, ...props }) => {
  const color = tone === 'danger' ? '#B91C1C' : tone === 'neutral' ? 'text.secondary' : RED;
  return (
    <ButtonBase
      {...props}
      sx={{
        fontSize: 12.5,
        fontWeight: 600,
        color,
        lineHeight: 1.4,
        borderRadius: '4px',
        px: 0.25,
        '&:hover': { textDecoration: 'underline' },
        '&:focus-visible': { outline: `2px solid ${RED}`, outlineOffset: '2px' },
        '&.Mui-disabled': { opacity: 0.5 },
        ...sx,
      }}
    >
      {children}
    </ButtonBase>
  );
};

export default LinkButton;
