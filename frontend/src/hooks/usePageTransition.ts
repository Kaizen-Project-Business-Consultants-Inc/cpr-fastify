import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';

interface TransitionConfig {
  type: 'fade' | 'slideUp' | 'slideDown' | 'slideLeft' | 'slideRight' | 'grow' | 'scale';
  duration: number;
  delay: number;
}

interface PageTransitionState {
  isTransitioning: boolean;
  currentPage: string;
  previousPage: string;
  transitionConfig: TransitionConfig;
}

const defaultTransitionConfig: TransitionConfig = {
  type: 'fade',
  duration: 300,
  delay: 0,
};

// Route-specific transition configurations
const routeTransitions: Record<string, TransitionConfig> = {
  '/login': { type: 'fade', duration: 400, delay: 0 },
  '/dashboard': { type: 'slideUp', duration: 350, delay: 100 },
  '/admin': { type: 'slideLeft', duration: 300, delay: 50 },
  '/accounting': { type: 'slideRight', duration: 300, delay: 50 },
  '/organization': { type: 'grow', duration: 400, delay: 0 },
  '/instructor': { type: 'scale', duration: 350, delay: 100 },
  '/vendor': { type: 'slideUp', duration: 300, delay: 0 },
  '/superadmin': { type: 'grow', duration: 400, delay: 100 },
  '/sysadmin': { type: 'slideLeft', duration: 300, delay: 50 },
  '/hr': { type: 'fade', duration: 300, delay: 0 },
};

export const usePageTransition = () => {
  const location = useLocation();
  const [state, setState] = useState<PageTransitionState>({
    isTransitioning: false,
    currentPage: location.pathname,
    previousPage: '',
    transitionConfig: defaultTransitionConfig,
  });

  // Get transition config for current route
  const getTransitionConfig = useCallback((pathname: string): TransitionConfig => {
    // Find the best matching route
    const matchingRoute = Object.keys(routeTransitions).find(route => 
      pathname.startsWith(route)
    );
    
    return matchingRoute ? routeTransitions[matchingRoute] : defaultTransitionConfig;
  }, []);

  // Handle route changes
  useEffect(() => {
    if (location.pathname !== state.currentPage) {
      // Drives a timed transition animation (sets a timer below to flip isTransitioning
      // back off) — a real effect, not simple render-time derivation.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState(prevState => ({
        isTransitioning: true,
        previousPage: prevState.currentPage,
        currentPage: location.pathname,
        transitionConfig: getTransitionConfig(location.pathname),
      }));

      // Reset transitioning state after animation
      const timer = setTimeout(() => {
        setState(prevState => ({
          ...prevState,
          isTransitioning: false,
        }));
      }, getTransitionConfig(location.pathname).duration + 100);

      return () => clearTimeout(timer);
    }
    return () => {};
  }, [location.pathname, state.currentPage, getTransitionConfig]);

  // Get transition type based on route direction
  const getTransitionType = useCallback((from: string, to: string): TransitionConfig['type'] => {
    const config = getTransitionConfig(to);
    
    // Add logic for directional transitions if needed
    if (from.includes('admin') && to.includes('accounting')) {
      return 'slideRight';
    }
    if (from.includes('accounting') && to.includes('admin')) {
      return 'slideLeft';
    }
    
    return config.type;
  }, [getTransitionConfig]);

  // Check if page is transitioning
  const isTransitioning = state.isTransitioning;

  // Get current transition config
  const currentTransitionConfig = state.transitionConfig;

  // Get transition type for current route
  const transitionType = getTransitionType(state.previousPage, state.currentPage);

  return {
    isTransitioning,
    currentPage: state.currentPage,
    previousPage: state.previousPage,
    transitionConfig: currentTransitionConfig,
    transitionType,
    getTransitionConfig,
  };
};

export default usePageTransition;
