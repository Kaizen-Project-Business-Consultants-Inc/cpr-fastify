import React, { useState, useEffect } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Button,
  Box,
  Typography,
  Chip,
  CircularProgress,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Grid,
  Divider,
} from '@mui/material';
import { Receipt as InvoiceIcon, Visibility as ViewIcon, CheckCircle as PresentIcon, Cancel as AbsentIcon } from '@mui/icons-material';
import { formatCurrency } from '../../utils/formatters';
import { formatDisplayDate } from '../../utils/dateUtils';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

const ReadyForBillingTable = ({
  courses,
  onCreateInvoice,
  isLoading,
  error,
}: {
  courses: any;
  onCreateInvoice: any;
  isLoading: any;
  error: any;
}) => {
  const { user } = useAuth();
  const [creatingInvoice, setCreatingInvoice] = useState<Record<string, boolean>>({});
  const [selectedCourse, setSelectedCourse] = useState<any>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [students, setStudents] = useState<any[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [invoiceSuccess, setInvoiceSuccess] = useState(false);

  const fetchStudents = async (courseId: any) => {
    if (!courseId) {
      console.error('No course ID provided for fetching students');
      setStudents([]);
      return;
    }
    
    setLoadingStudents(true);
    let endpoint = ''; // Declare endpoint outside try block
    
    try {
      // Debug user information
      
      // Use different endpoints based on user role
      if (user?.role === 'instructor') {
        // For instructors, use the instructor endpoint
        endpoint = `/instructor/classes/${courseId}/students`;
      } else {
        // For accounting users, use the accounting endpoint
        endpoint = `/accounting/courses/${courseId}/students`;
      }
      
      const response = await api.get(endpoint);
      
      // Normalize the data format based on the endpoint used
      let normalizedStudents = response.data.data || [];
      if (user?.role === 'instructor') {
        // Transform instructor endpoint format to match accounting format
        normalizedStudents = normalizedStudents.map((student: any) => ({
          id: student.studentId,
          firstName: student.firstName,
          lastName: student.lastName,
          email: student.email,
          attended: student.attendance,
          attendanceMarked: student.attendanceMarked,
        }));
      }
      
      setStudents(normalizedStudents);
    } catch (error: any) {
      console.error('[ReadyForBillingTable] Error fetching students:', error);
      console.error('[ReadyForBillingTable] Error details:', {
        status: error.response?.status,
        message: error.response?.data?.error?.message,
        endpoint: endpoint
      });
      setStudents([]);
    } finally {
      setLoadingStudents(false);
    }
  };

  const handleViewInvoice = (course: any) => {
    if (!course || !course.courseId) {
      console.error('Invalid course data for invoice preview:', course);
      return;
    }
    setSelectedCourse(course);
    setPreviewOpen(true);
    fetchStudents(course.courseId);
  };

  const handleCreateInvoice = async () => {
    if (!selectedCourse) return;

    setCreatingInvoice(prev => ({ ...prev, [selectedCourse.courseId]: true }));
    setInvoiceSuccess(false);

    try {
      await onCreateInvoice(selectedCourse.courseId);

      // Show success state briefly before closing
      setInvoiceSuccess(true);
      setTimeout(() => {
        setPreviewOpen(false);
        setSelectedCourse(null);
        setStudents([]);
        setInvoiceSuccess(false);
      }, 1500); // Show success for 1.5 seconds
    } catch (error: any) {
      console.error('❌ [INVOICE] Invoice creation failed in table component:', error);
      // Error handling is done in the parent component, but we keep the dialog open
      // so the user can see the error message and try again if needed
    } finally {
      setCreatingInvoice(prev => ({ ...prev, [selectedCourse.courseId]: false }));
    }
  };

  const handleClosePreview = () => {
    setPreviewOpen(false);
    setSelectedCourse(null);
    setStudents([]);
    setInvoiceSuccess(false);
  };

  const presentCount = students.filter(s => s.attended).length;
  const absentCount = students.filter(s => s.attended === false).length;

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity='error' sx={{ mt: 2 }}>
        {error}
      </Alert>
    );
  }

  if (!courses || !Array.isArray(courses) || courses.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 4 }}>
        <Typography variant='body1' color='textSecondary'>
          No courses ready for billing at this time.
        </Typography>
        <Typography variant='body2' color='textSecondary' sx={{ mt: 1 }}>
          Completed courses marked as "Ready for Billing" by Course Admin will
          appear here.
        </Typography>
      </Box>
    );
  }

  return (
    <>
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Date Completed</TableCell>
              <TableCell>Organization</TableCell>
              <TableCell>Course Name</TableCell>
              <TableCell>Location</TableCell>
              <TableCell>Instructor</TableCell>
              <TableCell align='center'>Students Attended</TableCell>
              <TableCell align='right'>Rate/Student</TableCell>
              <TableCell align='right'>Base Cost</TableCell>
              <TableCell align='right'>Tax (HST)</TableCell>
              <TableCell align='right'>Total</TableCell>
              <TableCell align='center'>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {courses.map(course => {
              if (!course) {
                return (
                  <TableRow key="invalid-course">
                    <TableCell colSpan={11} align="center">
                      <Typography variant="body2" color="error.main">
                        Invalid course data
                      </Typography>
                    </TableCell>
                  </TableRow>
                );
              }
              
              return (
                <TableRow key={course.courseId}>
                  <TableCell>{formatDisplayDate(course.dateCompleted)}</TableCell>
                  <TableCell>
                    <Typography variant='body2' fontWeight='medium'>
                      {course.organizationName}
                    </Typography>
                    <Typography variant='caption' color='textSecondary'>
                      {course.contactEmail}
                    </Typography>
                  </TableCell>
                  <TableCell>{course.courseTypeName}</TableCell>
                  <TableCell>{course.location}</TableCell>
                  <TableCell>{course.instructorName}</TableCell>
                  <TableCell align='center'>
                    <Chip
                      label={course.studentsAttended}
                      size='small'
                      color='primary'
                      variant='outlined'
                    />
                  </TableCell>
                  <TableCell align='right'>
                    {course.ratePerStudent ?
                      formatCurrency(course.ratePerStudent) :
                      <Typography variant="body2" color="error.main">
                        Not Set
                      </Typography>
                    }
                  </TableCell>
                  <TableCell align='right'>
                    {course.ratePerStudent && course.studentsAttended ?
                      formatCurrency(course.ratePerStudent * course.studentsAttended) :
                      <Typography component="span" color="error.main">
                        N/A
                      </Typography>
                    }
                  </TableCell>
                  <TableCell align='right'>
                    {course.ratePerStudent && course.studentsAttended ?
                      formatCurrency((course.ratePerStudent * course.studentsAttended) * 0.13) :
                      <Typography component="span" color="error.main">
                        N/A
                      </Typography>
                    }
                  </TableCell>
                  <TableCell align='right'>
                    <Typography variant='body2' fontWeight='bold' color='primary'>
                      {course.ratePerStudent && course.studentsAttended ?
                        formatCurrency((course.ratePerStudent * course.studentsAttended) * 1.13) :
                        <Typography component="span" color="error.main">
                          N/A
                        </Typography>
                      }
                    </Typography>
                  </TableCell>
                  <TableCell align='center'>
                    <Button
                      variant='outlined'
                      color='primary'
                      size='small'
                      startIcon={<ViewIcon />}
                      onClick={() => handleViewInvoice(course)}
                    >
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Invoice Preview Dialog */}
      <Dialog 
        open={previewOpen} 
        onClose={handleClosePreview}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <InvoiceIcon color="primary" />
            Invoice Preview
          </Box>
        </DialogTitle>
        <DialogContent>
          {selectedCourse && selectedCourse.organizationName && (
            <Box sx={{ mt: 2 }}>
              {/* Course Details */}
              <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                  <Typography variant="h6" gutterBottom>Course Information</Typography>
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="body2" color="textSecondary">Organization</Typography>
                    <Typography variant="body1" fontWeight="medium">{selectedCourse.organizationName}</Typography>
                  </Box>
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="body2" color="textSecondary">Course Type</Typography>
                    <Typography variant="body1">{selectedCourse.courseTypeName || 'N/A'}</Typography>
                  </Box>
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="body2" color="textSecondary">Location</Typography>
                    <Typography variant="body1">{selectedCourse.location || 'N/A'}</Typography>
                  </Box>
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="body2" color="textSecondary">Instructor</Typography>
                    <Typography variant="body1">{selectedCourse.instructorName || 'N/A'}</Typography>
                  </Box>
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="body2" color="textSecondary">Date Completed</Typography>
                    <Typography variant="body1">{selectedCourse.dateCompleted ? formatDisplayDate(selectedCourse.dateCompleted) : 'N/A'}</Typography>
                  </Box>
                </Grid>

                <Grid item xs={12} md={6}>
                  <Typography variant="h6" gutterBottom>Billing Summary</Typography>
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="body2" color="textSecondary">Students Registered</Typography>
                    <Typography variant="body1" fontWeight="medium">{selectedCourse.registeredStudents || 0}</Typography>
                  </Box>
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="body2" color="textSecondary">Students Attended</Typography>
                    <Typography variant="body1" fontWeight="medium" color="success.main">{selectedCourse.studentsAttended || 0}</Typography>
                  </Box>
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="body2" color="textSecondary">Students Absent</Typography>
                    <Typography variant="body1" fontWeight="medium" color="error.main">
                      {(selectedCourse.registeredStudents || 0) - (selectedCourse.studentsAttended || 0)}
                    </Typography>
                  </Box>
                  <Divider sx={{ my: 2 }} />
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="body2" color="textSecondary">Rate per Student</Typography>
                    <Typography variant="body1" fontWeight="medium">
                      {selectedCourse.ratePerStudent ?
                        formatCurrency(selectedCourse.ratePerStudent) :
                        <Typography component="span" color="error.main">
                          Pricing not configured
                        </Typography>
                      }
                    </Typography>
                  </Box>
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="body2" color="textSecondary">Subtotal</Typography>
                    <Typography variant="body1" fontWeight="medium">
                      {selectedCourse.ratePerStudent ?
                        formatCurrency((selectedCourse.studentsAttended || 0) * selectedCourse.ratePerStudent) :
                        <Typography component="span" color="error.main">
                          N/A
                        </Typography>
                      }
                    </Typography>
                  </Box>
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="body2" color="textSecondary">HST (13%)</Typography>
                    <Typography variant="body1" fontWeight="medium">
                      {selectedCourse.ratePerStudent ?
                        formatCurrency(((selectedCourse.studentsAttended || 0) * selectedCourse.ratePerStudent) * 0.13) :
                        <Typography component="span" color="error.main">
                          N/A
                        </Typography>
                      }
                    </Typography>
                  </Box>
                  <Divider sx={{ my: 2 }} />
                  <Box>
                    <Typography variant="h6" color="primary" fontWeight="bold">
                      {selectedCourse.ratePerStudent && selectedCourse.totalAmount ?
                        `Total: ${formatCurrency(selectedCourse.totalAmount)}` :
                        <Typography component="span" color="error.main">
                          Pricing not configured
                        </Typography>
                      }
                    </Typography>
                  </Box>
                </Grid>
              </Grid>
              
              <Divider sx={{ my: 3 }} />
              
              {/* Student Attendance List */}
              <Box sx={{ mt: 3 }}>
                <Typography variant="h6" gutterBottom>Student Attendance List</Typography>
                <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                  Only students marked as "Present" will be billed. This list will be included in the final invoice.
                </Typography>
                
                {loadingStudents ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                    <CircularProgress />
                  </Box>
                ) : students.length > 0 ? (
                  <>
                    <TableContainer component={Paper} sx={{ mb: 2 }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Student Name</TableCell>
                            <TableCell>Email</TableCell>
                            <TableCell align="center">Attendance Status</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {students.map((student) => (
                            <TableRow key={student.id}>
                              <TableCell>
                                <Typography variant="body2" fontWeight="medium">
                                  {student.firstName} {student.lastName}
                                </Typography>
                              </TableCell>
                              <TableCell>
                                <Typography variant="body2" color="textSecondary">
                                  {student.email || 'No email'}
                                </Typography>
                              </TableCell>
                              <TableCell align="center">
                                <Chip
                                  icon={student.attended ? <PresentIcon /> : <AbsentIcon />}
                                  label={student.attended ? 'Present' : 'Absent'}
                                  color={student.attended ? 'success' : 'error'}
                                  size="small"
                                  variant="outlined"
                                />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                    
                    {/* Attendance Summary */}
                    <Box sx={{ 
                      p: 2, 
                      bgcolor: 'grey.50', 
                      borderRadius: 1,
                      border: '1px solid',
                      borderColor: 'grey.300'
                    }}>
                      <Typography variant="body2" fontWeight="medium">
                        <Box component="span" sx={{ color: 'success.main' }}>
                          Present: {presentCount}
                        </Box>
                        {' | '}
                        <Box component="span" sx={{ color: 'error.main' }}>
                          Absent: {absentCount}
                        </Box>
                        {' | '}
                        <Box component="span">
                          Total: {students.length}
                        </Box>
                      </Typography>
                    </Box>
                  </>
                ) : (
                  <Box sx={{ 
                    p: 2, 
                    bgcolor: 'grey.50', 
                    borderRadius: 1,
                    textAlign: 'center'
                  }}>
                    <Typography variant="body2" color="textSecondary">
                      No student attendance data available
                    </Typography>
                  </Box>
                )}
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          {invoiceSuccess && (
            <Alert severity="success" sx={{ flex: 1, mr: 2 }}>
              ✅ Invoice created successfully! The course has been moved to the Organizational Receivables Queue. This dialog will close automatically.
            </Alert>
          )}
          <Button onClick={handleClosePreview} disabled={creatingInvoice[selectedCourse?.courseId]}>
            {invoiceSuccess ? 'Close Now' : 'Cancel'}
          </Button>
          <Button
            variant="contained"
            color="primary"
            onClick={handleCreateInvoice}
            disabled={creatingInvoice[selectedCourse?.courseId] || !selectedCourse?.ratePerStudent || invoiceSuccess}
            startIcon={creatingInvoice[selectedCourse?.courseId] ? <CircularProgress size={20} /> : <InvoiceIcon />}
          >
            {creatingInvoice[selectedCourse?.courseId] ? 'Creating Invoice...' :
             !selectedCourse?.ratePerStudent ? 'Pricing Not Configured' :
             invoiceSuccess ? 'Invoice Created!' : 'Create Invoice'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default ReadyForBillingTable;
