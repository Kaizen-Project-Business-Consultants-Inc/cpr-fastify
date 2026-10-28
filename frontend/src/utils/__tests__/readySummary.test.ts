import { describe, it, expect } from 'vitest';
import { readySummary } from '../readySummary';

const at = '2026-10-28T15:02:00.000Z'; // 11:02 in Toronto

describe('readySummary', () => {
  it('is null until the instructor checks in', () => {
    expect(readySummary({})).toBeNull();
    expect(readySummary({ instructor_ready_at: null })).toBeNull();
  });
  it('shows the time and distance from the venue', () => {
    expect(readySummary({ instructor_ready_at: at, instructor_ready_distance_m: 40 })).toMatch(/^Ready 11:02.*, 40 m from venue$/);
  });
  it('shows kilometres for a long distance', () => {
    expect(readySummary({ instructor_ready_at: at, instructor_ready_distance_m: 12_400 })).toMatch(/, 12\.4 km from venue$/);
  });
  it('shows only the time for a check-in with no distance', () => {
    expect(readySummary({ instructor_ready_at: at })).toMatch(/^Ready 11:02/);
    expect(readySummary({ instructor_ready_at: at })).not.toContain('venue');
  });
});
