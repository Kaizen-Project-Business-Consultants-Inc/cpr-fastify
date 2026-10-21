import { describe, it, expect } from 'vitest';
import { formatStudentCount } from '../formatters';

describe('formatStudentCount', () => {
  it('shows TBC when the number of students is not known yet', () => {
    expect(formatStudentCount(0)).toBe('TBC');
    expect(formatStudentCount(null)).toBe('TBC');
    expect(formatStudentCount(undefined)).toBe('TBC');
    expect(formatStudentCount(12)).toBe('12');
    expect(formatStudentCount('8')).toBe('8');
  });
});
