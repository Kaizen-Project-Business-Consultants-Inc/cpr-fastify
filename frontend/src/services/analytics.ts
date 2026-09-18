/**
 * @fileoverview Analytics Service for Instructor Portal
 * Provides comprehensive tracking of user interactions, performance metrics, and errors
 * Supports multiple analytics providers and includes development/production modes
 *
 * @author CPR Training Portal Team
 * @version 1.0.0
 */

/**
 * Interface for analytics events
 * @interface AnalyticsEvent
 */
interface AnalyticsEvent {
  /** The name of the event being tracked */
  event: string;
  /** Additional properties associated with the event */
  properties?: Record<string, unknown>;
  /** ISO timestamp when the event occurred */
  timestamp?: string;
  /** Unique identifier for the user */
  userId?: string | number;
  /** Unique session identifier */
  sessionId?: string;
}

/**
 * Interface for performance metrics
 * @interface PerformanceMetric
 */
interface PerformanceMetric {
  /** Name of the performance metric */
  name: string;
  /** Numeric value of the metric (usually in milliseconds) */
  value: number;
  /** ISO timestamp when the metric was recorded */
  timestamp: string;
  /** Additional metadata about the metric */
  metadata?: Record<string, unknown>;
}

/**
 * Analytics Service class for tracking user interactions and performance
 * Provides a unified interface for multiple analytics providers
 *
 * @class AnalyticsService
 *
 * @example
 * ```typescript
 * import analytics from './services/analytics';
 *
 * // Set user
 * analytics.setUser(123, { role: 'instructor' });
 *
 * // Track events
 * analytics.track('button_clicked', { button: 'save' });
 * analytics.trackPageView('dashboard');
 *
 * // Track errors
 * analytics.trackError(new Error('Something went wrong'), 'component_name');
 * ```
 */
class AnalyticsService {
  /** Whether analytics tracking is enabled */
  private isEnabled: boolean;
  /** Unique session identifier */
  private sessionId: string;
  /** Current user identifier */
  private userId: string | number | null = null;
  /** Queue for events before initialization */
  private queue: AnalyticsEvent[] = [];
  /** Whether the service has been initialized */
  private isInitialized = false;

  /**
   * Creates an instance of AnalyticsService
   * Automatically initializes if enabled
   */
  constructor() {
    this.isEnabled =
      import.meta.env.PROD || import.meta.env.VITE_ANALYTICS_ENABLED === 'true';
    this.sessionId = this.generateSessionId();

    if (this.isEnabled) {
      this.initialize();
    }
  }

  /**
   * Generates a unique session identifier
   *
   * @private
   * @returns {string} Unique session ID
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Initializes the analytics service
   * Sets up tracking providers and processes queued events
   *
   * @private
   */
  private initialize() {
    // Initialize analytics (Google Analytics, Mixpanel, etc.)
    // eslint-disable-next-line no-console
    console.log('[Analytics] Service initialized', {
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
    });

    // Track page load performance
    this.trackPageLoad();

    this.isInitialized = true;

    // Process queued events
    this.processQueue();
  }

  /**
   * Sets the current user for analytics tracking
   * Associates all future events with this user
   *
   * @param {string | number} userId - Unique identifier for the user
   * @param {Record<string, unknown>} [properties] - Additional user properties
   *
   * @example
   * ```typescript
   * analytics.setUser(123, {
   *   role: 'instructor',
   *   email: 'instructor@example.com'
   * });
   * ```
   */
  setUser(userId: string | number, _properties?: Record<string, unknown>) {
    this.userId = userId;

    if (this.isEnabled) {

      // TODO: Integrate with actual analytics service
      // gtag('config', 'GA_MEASUREMENT_ID', { user_id: userId });
      // mixpanel.identify(userId);
    }
  }

  /**
   * Tracks a custom event with optional properties
   *
   * @param {string} event - Name of the event to track
   * @param {Record<string, unknown>} [properties] - Additional event properties
   *
   * @example
   * ```typescript
   * analytics.track('class_completed', {
   *   classId: 123,
   *   duration: 3600,
   *   studentsCount: 15
   * });
   * ```
   */
  track(event: string, properties?: Record<string, unknown>) {
    const analyticsEvent: AnalyticsEvent = {
      event,
      properties: {
        ...properties,
        sessionId: this.sessionId,
        url: window.location.href,
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString(),
      },
      userId: this.userId || undefined,
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
    };

    if (!this.isInitialized) {
      this.queue.push(analyticsEvent);
      return;
    }

    if (this.isEnabled) {

      // TODO: Send to actual analytics service
      // gtag('event', event, properties);
      // mixpanel.track(event, properties);
    }
  }

  /**
   * Track page views
   */
  trackPageView(page: string, properties?: Record<string, unknown>) {
    this.track('page_view', {
      page,
      ...properties,
    });
  }

  /**
   * Track instructor-specific actions
   */
  trackInstructorAction(action: string, properties?: Record<string, unknown>) {
    this.track('instructor_action', {
      action,
      portal: 'instructor',
      ...properties,
    });
  }

  /**
   * Track organization-specific actions
   */
  trackOrganizationAction(action: string, properties?: Record<string, unknown>) {
    this.track('organization_action', {
      action,
      portal: 'organization',
      ...properties,
    });
  }

  /**
   * Track course admin-specific actions
   */
  trackCourseAdminAction(action: string, properties?: Record<string, unknown>) {
    this.track('course_admin_action', {
      action,
      portal: 'course_admin',
      ...properties,
    });
  }

  /**
   * Track class management actions
   */
  trackClassAction(
    action: string,
    classId?: number,
    properties?: Record<string, unknown>
  ) {
    this.track('class_action', {
      action,
      classId,
      portal: 'instructor',
      ...properties,
    });
  }

  /**
   * Track availability management
   */
  trackAvailabilityAction(
    action: string,
    date?: string,
    properties?: Record<string, unknown>
  ) {
    this.track('availability_action', {
      action,
      date,
      portal: 'instructor',
      ...properties,
    });
  }

  /**
   * Track errors
   */
  trackError(error: Error, context?: string, properties?: Record<string, unknown>) {
    this.track('error_occurred', {
      error: error.message,
      stack: error.stack,
      context,
      portal: 'instructor',
      ...properties,
    });
  }

  /**
   * Track performance metrics
   */
  trackPerformance(_metric: PerformanceMetric) {
    if (this.isEnabled) {

      // TODO: Send to performance monitoring service
      // Sentry.addBreadcrumb({ message: `Performance: ${metric.name}`, data: metric });
    }
  }

  /**
   * Track page load performance
   */
  private trackPageLoad() {
    if (typeof window !== 'undefined' && window.performance) {
      const navigation = performance.getEntriesByType(
        'navigation'
      )[0] as PerformanceNavigationTiming;

      if (navigation) {
        this.trackPerformance({
          name: 'page_load_time',
          value: navigation.loadEventEnd - navigation.loadEventStart,
          timestamp: new Date().toISOString(),
          metadata: {
            domContentLoaded:
              navigation.domContentLoadedEventEnd -
              navigation.domContentLoadedEventStart,
            firstPaint: navigation.loadEventStart - navigation.fetchStart,
            portal: 'instructor',
          },
        });
      }
    }
  }

  /**
   * Track component render performance
   */
  trackComponentRender(componentName: string, renderTime: number) {
    this.trackPerformance({
      name: 'component_render_time',
      value: renderTime,
      timestamp: new Date().toISOString(),
      metadata: {
        component: componentName,
        portal: 'instructor',
      },
    });
  }

  /**
   * Process queued events
   */
  private processQueue() {
    while (this.queue.length > 0) {
      const event = this.queue.shift();
      if (event) {
        this.track(event.event, event.properties);
      }
    }
  }

  /**
   * Flush any pending analytics data
   */
  flush() {
    if (this.isEnabled) {
      // TODO: Implement actual flush logic for analytics service
    }
  }
}

// Create singleton instance
const analytics = new AnalyticsService();

export default analytics;
