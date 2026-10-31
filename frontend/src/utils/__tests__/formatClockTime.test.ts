import { describe, it, expect } from 'vitest';
import { formatClockTime } from '../formatters';

describe('formatClockTime', () => {
  it('shows a class start or end time the way people say it', () => {
    expect(formatClockTime('11:00:00')).toBe('11:00 AM');
    expect(formatClockTime('13:00:00')).toBe('1:00 PM');
    expect(formatClockTime('15:30')).toBe('3:30 PM');
    expect(formatClockTime('09:05:00')).toBe('9:05 AM');
  });

  it('handles midnight and noon', () => {
    expect(formatClockTime('00:00:00')).toBe('12:00 AM');
    expect(formatClockTime('12:00:00')).toBe('12:00 PM');
  });

  it('gives nothing for a missing or unreadable time', () => {
    expect(formatClockTime(null)).toBe('');
    expect(formatClockTime(undefined)).toBe('');
    expect(formatClockTime('')).toBe('');
    expect(formatClockTime('soon')).toBe('');
    expect(formatClockTime('25:00:00')).toBe('');
    expect(formatClockTime('10:75:00')).toBe('');
  });
});
