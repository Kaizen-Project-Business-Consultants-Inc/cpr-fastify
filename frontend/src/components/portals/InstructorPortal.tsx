import React, { Suspense, lazy, useMemo } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import {
  Box,
} from '@mui/material';
import { ErrorBoundary } from '../common/ErrorBoundary';
import InstructorLayout from './InstructorLayout';
import { formatDisplayDate } from '../../utils/dateUtils';
import type { User } from '../../types/api';
import type { ScheduledClass } from '../../types/instructor';
import type { CombinedScheduleItem } from '../../types/instructor';
import { getErrorMessage } from '../../utils/errorMessage';

interface AvailabilityDate {
  id: number;
  date: string;
  status?: string;
  [key: string]: unknown;
}

export interface StudentAttendance {
  id?: number;
  studentid?: string;
  attended?: boolean;
  attendance?: boolean;
  [key: string]: unknown;
}

// Extended class item for accessing additional properties
interface ExtendedClassItem extends ScheduledClass {
  completed?: boolean;
  organizationname?: string;
  course_name?: string;
  studentcount?: number;
  studentsattendance?: number;
}

// Lazy load components
const InstructorDashboard = lazy(
  () => import('../instructor/InstructorDashboard')
);
const MyClassesView = lazy(
  () => import('../views/instructor/MyClassesView')
);
const AvailabilityView = lazy(
  () => import('../views/instructor/AvailabilityView')
);
const AttendanceView = lazy(
  () => import('../views/instructor/AttendanceView')
);
const ClassAttendanceView = lazy(
  () => import('../views/instructor/ClassAttendanceView')
);
const InstructorArchiveTable = lazy(
  () => import('../tables/InstructorArchiveTable')
);
const InstructorProfile = lazy(
  () => import('../views/instructor/InstructorProfile')
);
const TimesheetPage = lazy(
  () => import('../instructor/TimesheetPage')
);

const LoadingFallback = () => (
  <Box
    sx={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '60vh',
    }}
  >
    <div>Loading...</div>
  </Box>
);

interface InstructorPortalProps {
  user: User | null;
  availableDates: AvailabilityDate[];
  scheduledClasses: ScheduledClass[];
  completedClasses: ScheduledClass[];
  todayClasses?: ScheduledClass[];
  loading: boolean;
  onLogout: () => void;
  onAddAvailability: (date: string) => Promise<void>;
  onRemoveAvailability: (date: string) => Promise<void>;
  onCompleteClass: (courseId: number) => Promise<void>;
  onUpdateAttendance: (courseId: number, students: StudentAttendance[]) => Promise<void>;
  onRefreshData: () => void;
}

const InstructorPortal: React.FC<InstructorPortalProps> = ({
  user: _user,
  availableDates,
  scheduledClasses,
  completedClasses,
  todayClasses: _todayClasses = [],
  loading,
  onLogout: _onLogout,
  onAddAvailability,
  onRemoveAvailability,
  onCompleteClass,
  onUpdateAttendance: _onUpdateAttendance,
  onRefreshData,
}) => {
  // Create combined schedule from scheduled classes and availability dates
  const combinedSchedule: CombinedScheduleItem[] = useMemo(() => {
    const combined: CombinedScheduleItem[] = [];

    // Add scheduled classes (filter out completed classes)
    scheduledClasses
      .filter((classItem) => {
        const extClass = classItem as ExtendedClassItem;
        return !(classItem.status === 'completed' ||
                 extClass.completed === true ||
                 classItem.status === 'Completed');
      })
      .forEach((classItem) => {
        const extClass = classItem as ExtendedClassItem;
        const dateStr = classItem.date.includes('T')
          ? classItem.date.split('T')[0]
          : classItem.date;

        combined.push({
          key: `class-${classItem.courseId}`,
          type: 'class' as const,
          displayDate: formatDisplayDate(dateStr),
          organizationName: extClass.organizationname || classItem.organizationName || 'Unassigned',
          location: classItem.location || 'TBD',
          courseNumber: classItem.courseId?.toString() || '',
          courseTypeName: extClass.course_name || classItem.courseType || 'CPR Class',
          studentsRegistered: extClass.studentcount || classItem.registeredStudents || 0,
          studentsAttendance: extClass.studentsattendance || classItem.studentsAttended || 0,
          notes: classItem.notes,
          status: classItem.status || 'scheduled',
          courseId: classItem.courseId,
        });
      });

    // Add availability dates
    availableDates.forEach((availability) => {
      const dateStr = availability.date.includes('T')
        ? availability.date.split('T')[0]
        : availability.date;

      combined.push({
        key: `availability-${availability.id}`,
        type: 'availability' as const,
        displayDate: formatDisplayDate(dateStr),
        organizationName: 'Available',
        location: 'Available',
        courseNumber: '',
        courseTypeName: 'Available',
        studentsRegistered: 0,
        studentsAttendance: 0,
        status: 'available',
        originalData: availability,
      });
    });

    // Sort by date
    combined.sort((a, b) => new Date(a.displayDate).getTime() - new Date(b.displayDate).getTime());
    return combined;
  }, [availableDates, scheduledClasses]);

  const handleError = (_error: Error, _errorInfo: React.ErrorInfo) => {
    // Error boundary handler — logged by ErrorBoundary itself
  };

  // Get current view from URL
  const getCurrentView = () => {
    const pathSegments = window.location.pathname.split('/');
    return pathSegments[pathSegments.length - 1] || 'dashboard';
  };

  const currentView = getCurrentView();

  if (loading) {
    return (
      <InstructorLayout currentView={currentView}>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
          <div>Loading...</div>
        </Box>
      </InstructorLayout>
    );
  }

  return (
    <ErrorBoundary onError={handleError}>
      <InstructorLayout currentView={currentView} onRefresh={onRefreshData}>
          <Suspense fallback={<LoadingFallback />}>
            <Routes>
              <Route
                path='/'
                element={<Navigate to='/instructor/dashboard' replace />}
              />
              <Route
                path='/dashboard'
                element={
                  <ErrorBoundary onError={handleError}>
                    <InstructorDashboard />
                  </ErrorBoundary>
                }
              />
              <Route
                path='/classes'
                element={
                  <ErrorBoundary onError={handleError}>
                    <MyClassesView
                      combinedSchedule={combinedSchedule}
                      onCompleteClass={(item) => {
                        if (item.courseId) {
                          onCompleteClass(item.courseId);
                        }
                      }}
                      onRemoveAvailability={async (date: string) => {
                        try {
                          await onRemoveAvailability(date);
                          return { success: true };
                        } catch (error: unknown) {
                          return {
                            success: false,
                            error: getErrorMessage(error, 'Unknown error'),
                          };
                        }
                      }}
                    />
                  </ErrorBoundary>
                }
              />
              <Route
                path='/availability'
                element={
                  <ErrorBoundary onError={handleError}>
                    <AvailabilityView
                      availableDates={availableDates}
                      scheduledClasses={scheduledClasses}
                      onAddAvailability={onAddAvailability}
                      onRemoveAvailability={onRemoveAvailability}
                    />
                  </ErrorBoundary>
                }
              />
              <Route
                path='/attendance'
                element={
                  <ErrorBoundary onError={handleError}>
                    <AttendanceView
                      onAttendanceUpdate={() => {
                        // Refresh handled by react-query invalidation
                      }}
                    />
                  </ErrorBoundary>
                }
              />
              <Route
                path='/class-attendance'
                element={
                  <ErrorBoundary onError={handleError}>
                    <ClassAttendanceView />
                  </ErrorBoundary>
                }
              />
              <Route
                path='/timesheet'
                element={
                  <ErrorBoundary onError={handleError}>
                    <TimesheetPage />
                  </ErrorBoundary>
                }
              />
              <Route
                path='/archive'
                element={
                  <ErrorBoundary onError={handleError}>
                    <InstructorArchiveTable
                      courses={completedClasses}
                    />
                  </ErrorBoundary>
                }
              />
              <Route
                path='/profile'
                element={
                  <ErrorBoundary onError={handleError}>
                    <InstructorProfile />
                  </ErrorBoundary>
                }
              />
              <Route path='*' element={<Navigate to='/instructor/dashboard' replace />} />
            </Routes>
          </Suspense>
      </InstructorLayout>
    </ErrorBoundary>
  );
};

export default InstructorPortal;
