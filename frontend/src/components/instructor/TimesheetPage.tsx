import React, { useState } from 'react';
import { Box, Tabs, Tab } from '@mui/material';
import TimesheetSubmission from './TimesheetSubmission';
import TimesheetHistory from './TimesheetHistory';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div role="tabpanel" hidden={value !== index} id={`timesheet-tabpanel-${index}`} aria-labelledby={`timesheet-tab-${index}`} {...other}>
      {value === index && <Box sx={{ pt: 3 }}>{children}</Box>}
    </div>
  );
}

const TimesheetPage: React.FC = () => {
  const [tabValue, setTabValue] = useState(0);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const handleTimesheetSubmitted = () => {
    setTabValue(1);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <Box sx={{ borderBottom: 1, borderColor: (theme) => theme.palette.divider }}>
        <Tabs
          value={tabValue}
          onChange={handleTabChange}
          aria-label="timesheet tabs"
          sx={{
            '& .MuiTab-root': { textTransform: 'none', fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.secondary, minHeight: 42 },
            '& .Mui-selected': { color: '#CC1F1F !important' },
            '& .MuiTabs-indicator': { backgroundColor: '#CC1F1F' },
          }}
        >
          <Tab label="Submit Timesheet" id="timesheet-tab-0" aria-controls="timesheet-tabpanel-0" />
          <Tab label="Timesheet History" id="timesheet-tab-1" aria-controls="timesheet-tabpanel-1" />
        </Tabs>
      </Box>

      <TabPanel value={tabValue} index={0}>
        <TimesheetSubmission onTimesheetSubmitted={handleTimesheetSubmitted} />
      </TabPanel>
      <TabPanel value={tabValue} index={1}>
        <TimesheetHistory />
      </TabPanel>
      {/* Payment History tab hidden 2026-10-17 (owner's choice): it reads instructor payment
          requests, which have no backend yet. PaymentHistory.tsx stays for when that is built. */}
    </Box>
  );
};

export default TimesheetPage;
