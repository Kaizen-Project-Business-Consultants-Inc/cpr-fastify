import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { instructorApi } from './api';
import { useAuth } from '../contexts/AuthContext';
import { handleError } from './errorHandler';

// Query keys for React Query
export const INSTRUCTOR_QUERY_KEYS = {
  availability: ['instructor', 'availability'],
  classes: ['instructor', 'classes'],
  classesToday: ['instructor', 'classes', 'today'],
  classesCompleted: ['instructor', 'classes', 'completed'],
  classesActive: ['instructor', 'classes', 'active'],
  classStudents: (courseId: number) => ['instructor', 'classes', courseId, 'students'],
} as const;

// Data extractors
const extractData = <T>(response: { data?: { data?: T } | T } | T): T => {
  const resp = response as { data?: { data?: T } | T };
  if (resp && typeof resp === 'object' && 'data' in resp) {
    const inner = resp.data as { data?: T } | T;
    if (inner && typeof inner === 'object' && 'data' in inner) {
      return (inner as { data: T }).data;
    }
    return inner as T;
  }
  return response as T;
};

// Hook for instructor availability
export const useInstructorAvailability = () => {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: INSTRUCTOR_QUERY_KEYS.availability,
    queryFn: async () => {
      const response = await instructorApi.getAvailability();
      const extractedData = extractData(response);
      return extractedData;
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

// Hook for instructor classes
export const useInstructorClasses = () => {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: INSTRUCTOR_QUERY_KEYS.classes,
    queryFn: async () => {
      const response = await instructorApi.getClassesActive();
      const extractedData = extractData(response);
      return extractedData;
    },
    enabled: !!user?.id,
    staleTime: 0, // Force refetch every time
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });
};

// Hook for today's classes
export const useTodayClasses = () => {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: INSTRUCTOR_QUERY_KEYS.classesToday,
    queryFn: async () => {
      const response = await instructorApi.getClassesToday();
      return extractData(response);
    },
    enabled: !!user?.id,
    staleTime: 1 * 60 * 1000, // 1 minute
  });
};

// Hook for completed classes
export const useCompletedClasses = () => {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: INSTRUCTOR_QUERY_KEYS.classesCompleted,
    queryFn: async () => {
      const response = await instructorApi.getClassesCompleted();
      return extractData(response);
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

// Hook for class students
export const useClassStudents = (courseId: number) => {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: INSTRUCTOR_QUERY_KEYS.classStudents(courseId),
    queryFn: async () => {
      const response = await instructorApi.getClassStudents(courseId);
      return extractData(response);
    },
    enabled: !!user?.id && !!courseId,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
};

// Mutations
export const useAddAvailability = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (date: string) => {
      const response = await instructorApi.addAvailability(date);
      return extractData(response);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INSTRUCTOR_QUERY_KEYS.availability });
    },
    onError: (error) => handleError(error, { component: 'instructorService', action: 'add availability' }),
  });
};

export const useRemoveAvailability = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (date: string) => {
      const response = await instructorApi.removeAvailability(date);
      return extractData(response);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INSTRUCTOR_QUERY_KEYS.availability });
    },
    onError: (error) => handleError(error, { component: 'instructorService', action: 'remove availability' }),
  });
};

// Utility function to refresh all instructor data
export const useRefreshInstructorData = () => {
  const queryClient = useQueryClient();
  
  return () => {
    queryClient.invalidateQueries({ queryKey: ['instructor'] });
    queryClient.invalidateQueries({ queryKey: INSTRUCTOR_QUERY_KEYS.classes });
    queryClient.invalidateQueries({ queryKey: INSTRUCTOR_QUERY_KEYS.classesActive });
    queryClient.invalidateQueries({ queryKey: INSTRUCTOR_QUERY_KEYS.classesCompleted });
    queryClient.invalidateQueries({ queryKey: INSTRUCTOR_QUERY_KEYS.classesToday });
  };
}; 