import { describe, it, expect } from 'vitest';
import { readySummary } from '../readySummary';

const at = '2026-10-28T15:02:00.000Z'; // 11:02 in Toronto

describe('readySummary', () => {
  it('is null until the instructor taps', () => {
    expect(readySummary({})).toBeNull();
  });
  it('shows a close check-in as fine', () => {
    expect(readySummary({ instructor_ready_at: at, instructor_ready_distance_m: 40, instructor_ready_accuracy_m: 20, instructor_ready_located: 1 }))
      .toMatchObject({ warn: false, text: expect.stringMatching(/^Ready 11:02.*, 40 m from venue$/) });
  });
  it('warns when far beyond the phone accuracy', () => {
    const r = readySummary({ instructor_ready_at: at, instructor_ready_distance_m: 12_400, instructor_ready_located: 1 });
    expect(r?.text).toContain('12.4 km from venue');
    expect(r?.warn).toBe(true);
  });
  it('does not warn when the distance is within what the phone can mis-report', () => {
    expect(readySummary({ instructor_ready_at: at, instructor_ready_distance_m: 900, instructor_ready_accuracy_m: 600 })?.warn).toBe(false);
  });
  it('says so when there is no location or the address is too general', () => {
    expect(readySummary({ instructor_ready_at: at })?.text).toMatch(/^Ready 11:02.*, no location shared$/);
    expect(readySummary({ instructor_ready_at: at, instructor_ready_located: 1 })?.text).toMatch(/^Ready 11:02.*, venue address too general to check$/);
  });
});
