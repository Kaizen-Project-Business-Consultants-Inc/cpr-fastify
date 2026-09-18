import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Pagination,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tabs,
  Tab,
  Alert,
  CircularProgress,
  Grid,
} from '@mui/material';
import { hrDashboardService, InstructorProfile, OrganizationProfile, UserProfileResponse } from '../../services/hrDashboardService';
import DataTable, { DataTableRow } from '../gtacpr/DataTable';
import StatusChip from '../gtacpr/StatusChip';
import SearchBar from '../gtacpr/SearchBar';
import UserAvatar from '../gtacpr/UserAvatar';
import { GhostButton } from '../gtacpr/Buttons';
import { getErrorMessage } from '../../utils/errorMessage';

interface PersonnelManagementProps {
  onViewChange?: (view: string) => void;
}

const instructorColumns = [
  { key: 'instructor', label: 'INSTRUCTOR', width: '1.3fr' },
  { key: 'contact', label: 'CONTACT', width: '1.2fr' },
  { key: 'courses', label: 'COURSES', width: '0.8fr' },
  { key: 'lastCourse', label: 'LAST COURSE', width: '0.8fr' },
  { key: 'status', label: 'STATUS', width: '0.6fr' },
  { key: 'actions', label: '', width: '0.6fr', align: 'right' as const },
];

const orgColumns = [
  { key: 'org', label: 'ORGANIZATION', width: '1.3fr' },
  { key: 'contact', label: 'CONTACT', width: '1.2fr' },
  { key: 'courses', label: 'COURSES', width: '0.8fr' },
  { key: 'users', label: 'USERS', width: '0.5fr', align: 'right' as const },
  { key: 'lastActivity', label: 'LAST ACTIVITY', width: '0.8fr' },
  { key: 'actions', label: '', width: '0.6fr', align: 'right' as const },
];

const PersonnelManagement: React.FC<PersonnelManagementProps> = ({ onViewChange: _onViewChange }) => {
  const [tabValue, setTabValue] = useState(0);
  const [instructors, setInstructors] = useState<InstructorProfile[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instructorPagination, setInstructorPagination] = useState({ page: 1, limit: 10, total: 0, pages: 0 });
  const [organizationPagination, setOrganizationPagination] = useState({ page: 1, limit: 10, total: 0, pages: 0 });
  const [instructorSearch, setInstructorSearch] = useState('');
  const [organizationSearch, setOrganizationSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<UserProfileResponse['data'] | null>(null);
  const [userDetailsDialog, setUserDetailsDialog] = useState(false);

  const loadInstructors = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await hrDashboardService.getInstructors(instructorPagination.page, instructorPagination.limit, instructorSearch);
      setInstructors(data.instructors);
      setInstructorPagination(data.pagination);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load instructors'));
    } finally {
      setLoading(false);
    }
  }, [instructorPagination.page, instructorPagination.limit, instructorSearch]);

  const loadOrganizations = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await hrDashboardService.getOrganizations(organizationPagination.page, organizationPagination.limit, organizationSearch);
      setOrganizations(data.organizations);
      setOrganizationPagination(data.pagination);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load organizations'));
    } finally {
      setLoading(false);
    }
  }, [organizationPagination.page, organizationPagination.limit, organizationSearch]);

  useEffect(() => { loadInstructors(); }, [loadInstructors]);
  useEffect(() => { loadOrganizations(); }, [loadOrganizations]);

  const handleViewUserDetails = async (userId: number) => {
    try {
      const userData = await hrDashboardService.getUserProfile(userId);
      setSelectedUser(userData);
      setUserDetailsDialog(true);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load user details'));
    }
  };

  const formatDate = (dateString: string) => new Date(dateString).toLocaleDateString();

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {error && <Alert severity="error" sx={{ mb: 0 }} onClose={() => setError(null)}>{error}</Alert>}

      <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper }}>
        <Box sx={{ borderBottom: 1, borderColor: (theme) => theme.palette.divider, px: 3, pt: 1 }}>
          <Tabs
            value={tabValue}
            onChange={(_, v) => setTabValue(v)}
            sx={{
              '& .MuiTab-root': { textTransform: 'none', fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.secondary, minHeight: 42 },
              '& .Mui-selected': { color: '#CC1F1F !important' },
              '& .MuiTabs-indicator': { backgroundColor: '#CC1F1F' },
            }}
          >
            <Tab label="Instructors" />
            <Tab label="Organizations" />
          </Tabs>
        </Box>

        {/* Instructors Tab */}
        {tabValue === 0 && (
          <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                Instructor Profiles ({instructorPagination.total})
              </Typography>
              <SearchBar
                value={instructorSearch}
                onChange={v => { setInstructorSearch(v); setInstructorPagination(p => ({ ...p, page: 1 })); }}
                placeholder="Search instructors..."
              />
            </Box>

            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}><CircularProgress size={24} /></Box>
            ) : (
              <DataTable columns={instructorColumns} shownCount={instructors.length} totalCount={instructorPagination.total}>
                {instructors.map((instructor) => (
                  <DataTableRow key={instructor.id} columns={instructorColumns}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <UserAvatar initials={instructor.username.charAt(0).toUpperCase()} size={32} />
                      <Box>
                        <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{instructor.username}</Typography>
                        <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>ID: {instructor.id}</Typography>
                      </Box>
                    </Box>
                    <Box>
                      <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{instructor.email}</Typography>
                      {instructor.phone && <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>{instructor.phone}</Typography>}
                    </Box>
                    <Box>
                      <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary }}>Total: {instructor.totalCourses}</Typography>
                      <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>Completed: {instructor.completedCourses}</Typography>
                    </Box>
                    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                      {instructor.lastCourseDate ? formatDate(instructor.lastCourseDate) : '—'}
                    </Typography>
                    <StatusChip kind={instructor.activeCourses > 0 ? 'active' : 'inactive'} label={instructor.activeCourses > 0 ? 'Active' : 'Inactive'} />
                    <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                      <Box onClick={() => handleViewUserDetails(instructor.id)} sx={{ fontSize: 12, fontWeight: 600, color: '#CC1F1F', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}>View</Box>
                    </Box>
                  </DataTableRow>
                ))}
              </DataTable>
            )}

            {instructorPagination.pages > 1 && (
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                <Pagination count={instructorPagination.pages} page={instructorPagination.page} onChange={(_, p) => setInstructorPagination(prev => ({ ...prev, page: p }))} />
              </Box>
            )}
          </Box>
        )}

        {/* Organizations Tab */}
        {tabValue === 1 && (
          <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                Organization Profiles ({organizationPagination.total})
              </Typography>
              <SearchBar
                value={organizationSearch}
                onChange={v => { setOrganizationSearch(v); setOrganizationPagination(p => ({ ...p, page: 1 })); }}
                placeholder="Search organizations..."
              />
            </Box>

            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}><CircularProgress size={24} /></Box>
            ) : (
              <DataTable columns={orgColumns} shownCount={organizations.length} totalCount={organizationPagination.total}>
                {organizations.map((org) => (
                  <DataTableRow key={org.id} columns={orgColumns}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <UserAvatar initials={org.name.charAt(0).toUpperCase()} size={32} />
                      <Box>
                        <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{org.name}</Typography>
                        <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>ID: {org.id}</Typography>
                      </Box>
                    </Box>
                    <Box>
                      <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{org.contactEmail}</Typography>
                      {org.contactPhone && <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>{org.contactPhone}</Typography>}
                    </Box>
                    <Box>
                      <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary }}>Total: {org.totalCourses}</Typography>
                      <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>Completed: {org.completedCourses}</Typography>
                    </Box>
                    <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary, textAlign: 'right' }}>{org.totalUsers}</Typography>
                    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                      {org.lastCourseDate ? formatDate(org.lastCourseDate) : '—'}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                      <Box onClick={() => handleViewUserDetails(org.id)} sx={{ fontSize: 12, fontWeight: 600, color: '#CC1F1F', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}>View</Box>
                    </Box>
                  </DataTableRow>
                ))}
              </DataTable>
            )}

            {organizationPagination.pages > 1 && (
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                <Pagination count={organizationPagination.pages} page={organizationPagination.page} onChange={(_, p) => setOrganizationPagination(prev => ({ ...prev, page: p }))} />
              </Box>
            )}
          </Box>
        )}
      </Box>

      {/* User Details Dialog */}
      <Dialog open={userDetailsDialog} onClose={() => setUserDetailsDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>User Profile Details</DialogTitle>
        <DialogContent>
          {selectedUser && (
            <Box sx={{ pt: 1 }}>
              <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                  <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1 }}>Basic Information</Typography>
                  {([
                    ['Username', selectedUser.user.username],
                    ['Email', selectedUser.user.email],
                    ['Role', selectedUser.user.role],
                    ...(selectedUser.user.phone ? [['Phone', String(selectedUser.user.phone)]] : []),
                    ['Created', formatDate(selectedUser.user.createdAt)],
                  ] as [string, string][]).map(([label, value]) => (
                    <Box key={String(label)} sx={{ display: 'flex', borderBottom: (theme) => `1px solid ${theme.palette.divider}`, py: 0.75 }}>
                      <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.secondary, width: 100 }}>{label}</Typography>
                      <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary }}>{value}</Typography>
                    </Box>
                  ))}
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1 }}>Profile Changes History</Typography>
                  <Box sx={{ maxHeight: 200, overflow: 'auto' }}>
                    {selectedUser.profileChanges.length > 0 ? (
                      selectedUser.profileChanges.map((change: { id: number; fieldName: string; newValue: string; status: string; createdAt: string }) => (
                        <Box key={change.id} sx={{ p: 1.5, bgcolor: (theme) => theme.palette.background.default, borderRadius: '8px', mb: 1 }}>
                          <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary }}><strong>{change.fieldName}:</strong> {change.newValue}</Typography>
                          <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>Status: {change.status} — {formatDate(change.createdAt)}</Typography>
                        </Box>
                      ))
                    ) : (
                      <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>No profile changes found</Typography>
                    )}
                  </Box>
                </Grid>
              </Grid>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <GhostButton onClick={() => setUserDetailsDialog(false)}>Close</GhostButton>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default PersonnelManagement;
