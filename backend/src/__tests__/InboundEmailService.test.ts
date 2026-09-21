import { describe, it, expect, vi } from 'vitest';

// These tests only exercise pure parsing functions, but the module under
// test also imports config/database.js and config/env.js at the top level
// (for the DB-touching parts) — mock both so import doesn't crash on
// missing real DB_*/JWT_* env vars in the test runner.
vi.mock('../config/database.js', () => ({ getPool: () => ({ query: vi.fn() }) }));
vi.mock('../config/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../config/env.js', () => ({ env: { ANTHROPIC_API_KEY: undefined, RESEND_API_KEY: undefined, RESEND_WEBHOOK_SECRET: undefined } }));

import { normalizeDateText, resolveCourseType, parseTemplate } from '../services/InboundEmailService.js';

describe('normalizeDateText', () => {
  it('accepts ISO dates', () => {
    expect(normalizeDateText('2026-10-05')).toBe('2026-10-05');
  });

  it('accepts M/D/YYYY', () => {
    expect(normalizeDateText('10/5/2026')).toBe('2026-10-05');
  });

  it('accepts "Month D, YYYY"', () => {
    expect(normalizeDateText('October 5, 2026')).toBe('2026-10-05');
    expect(normalizeDateText('Oct 5 2026')).toBe('2026-10-05');
  });

  it('rejects an impossible calendar date instead of silently rolling over', () => {
    expect(normalizeDateText('2026-02-30')).toBeNull();
    expect(normalizeDateText('13/40/2026')).toBeNull();
  });

  it('rejects unparseable text rather than guessing', () => {
    expect(normalizeDateText('next Tuesday')).toBeNull();
    expect(normalizeDateText('')).toBeNull();
  });
});

describe('resolveCourseType', () => {
  const classTypes = [
    { id: 1, name: 'CPR-C' },
    { id: 2, name: 'Standard First Aid' },
    { id: 3, name: 'Basic First Aid' },
  ];

  it('matches an exact name case-insensitively', () => {
    expect(resolveCourseType('cpr-c', classTypes)).toMatchObject({ id: 1, confidence: 1 });
  });

  it('matches a substring with high confidence', () => {
    expect(resolveCourseType('standard first aid course please', classTypes)).toMatchObject({ id: 2 });
  });

  it('does not confuse similarly-named types', () => {
    const match = resolveCourseType('basic first aid', classTypes);
    expect(match?.id).toBe(3);
  });

  it('returns null for empty input', () => {
    expect(resolveCourseType('', classTypes)).toBeNull();
  });
});

describe('parseTemplate', () => {
  it('extracts all four fields from a well-formed template email', () => {
    const body = `Hi,\n\nCourse: CPR-C\nDate: 2026-10-05\nStudents: 12\nLocation: 123 Main St\n\nThanks`;
    expect(parseTemplate(body)).toEqual({
      courseTypeText: 'CPR-C',
      scheduledDate: '2026-10-05',
      location: '123 Main St',
      registeredStudents: 12,
    });
  });

  it('is case-insensitive on the labels', () => {
    const body = `course: CPR-C\ndate: 2026-10-05\nstudents: 5\nlocation: Office`;
    expect(parseTemplate(body)).not.toBeNull();
  });

  it('returns null if any required label is missing', () => {
    const body = `Course: CPR-C\nDate: 2026-10-05\nLocation: Office`;
    expect(parseTemplate(body)).toBeNull();
  });

  it('leaves scheduledDate/registeredStudents null rather than guessing when malformed', () => {
    const body = `Course: CPR-C\nDate: sometime in October\nStudents: a dozen\nLocation: Office`;
    expect(parseTemplate(body)).toEqual({
      courseTypeText: 'CPR-C',
      scheduledDate: null,
      location: 'Office',
      registeredStudents: null,
    });
  });
});
