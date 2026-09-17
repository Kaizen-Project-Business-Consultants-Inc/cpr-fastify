import React from 'react';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Button,
} from '@mui/material';
import {
  EventAvailable as EventAvailableIcon,
  Assignment as AssignmentIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

interface ActionItem {
  icon: React.ReactNode;
  title: string;
  buttonText: string;
  route: string;
  color: 'primary' | 'info' | 'success' | 'warning' | 'error';
}

interface QuickActionsGridProps {
  actions?: ActionItem[];
}

const QuickActionsGrid: React.FC<QuickActionsGridProps> = ({ 
  actions = [
    {
      icon: <EventAvailableIcon />,
      title: 'Set Availability',
      buttonText: 'Manage Schedule',
      route: '/instructor/availability',
      color: 'primary'
    },
    {
      icon: <AssignmentIcon />,
      title: 'Timesheet Management',
      buttonText: 'Submit Timesheet',
      route: '/instructor/timesheet',
      color: 'info'
    }
  ]
}) => {
  const navigate = useNavigate();

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Quick Actions
      </Typography>
      <Grid container spacing={2}>
        {actions.map((action, index) => (
          <Grid item xs={12} sm={6} md={4} key={index}>
            <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <CardContent sx={{ 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center', 
                gap: 2,
                flex: 1,
                py: 3
              }}>
                <Box sx={{ 
                  color: `${action.color}.main`,
                  fontSize: '2.5rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  {action.icon}
                </Box>
                <Typography variant="subtitle1" sx={{ textAlign: 'center', fontWeight: 500 }}>
                  {action.title}
                </Typography>
                <Button
                  variant="contained"
                  fullWidth
                  color={action.color}
                  onClick={() => navigate(action.route)}
                  sx={{ mt: 'auto' }}
                >
                  {action.buttonText}
                </Button>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};

export default QuickActionsGrid; 