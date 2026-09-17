/**
 * Date helpers. The implementations live in ./formatters (single source of truth);
 * this module re-exports them for existing imports and keeps the calendar colour helper.
 */
import { isSameDay } from 'date-fns';

export {
  DATE_FORMATS,
  parseLocalDate,
  formatDisplayDate,
  formatShortDate,
  formatISODate,
  formatLongDate,
  formatTime,
  formatDateTime,
  formatDateWithoutTimezone,
  toLocalDateString,
  getTodayDate,
} from './formatters';

/**
 * Get the colour for a calendar day based on its status.
 */
export const getDateColor = (
  date: Date,
  availableDates: Date[],
  scheduledClasses: Array<{ date: string | Date }>,
  holidays: Array<{ date: string | Date }>
) => {
  if (holidays.some((h) => isSameDay(new Date(h.date), date))) return 'red';
  if (scheduledClasses.some((c) => isSameDay(new Date(c.date), date))) return 'blue';
  if (availableDates.some((d) => isSameDay(d, date))) return 'green';
  return 'gray';
};
