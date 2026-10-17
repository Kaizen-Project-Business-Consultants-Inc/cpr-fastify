import { describe, it, expect, afterEach, vi } from 'vitest';
import { z } from 'zod';
import { httpError, GENERIC_SERVER_ERROR } from '../utils/httpError.js';

// Database errors carry SQL and column names; they must not reach the browser.
describe('httpError', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('hides the message of an unexpected (500) error outside development', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const dbError = new Error("Unknown column 'cr.date_scheduled' in 'where clause'");

    expect(httpError(dbError)).toEqual({ statusCode: 500, message: GENERIC_SERVER_ERROR });
  });

  it('keeps the message of a 4xx error, which was written for the user', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const notFound = Object.assign(new Error('Invoice not found'), { statusCode: 404 });

    expect(httpError(notFound)).toEqual({ statusCode: 404, message: 'Invoice not found' });
  });

  it('keeps a message when the caller picks a 4xx fallback', () => {
    vi.stubEnv('NODE_ENV', 'production');

    expect(httpError(new Error('Bad prefix'), 400)).toEqual({ statusCode: 400, message: 'Bad prefix' });
  });

  it('turns bad input into a 400 that names the field', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const result = z.object({ amount: z.number().positive() }).safeParse({ amount: 0 });
    if (result.success) throw new Error('expected a validation error');

    const { statusCode, message } = httpError(result.error);
    expect(statusCode).toBe(400);
    expect(message).toMatch(/^amount: /);
  });

  it('reads the message of a plain thrown object', () => {
    expect(httpError({ statusCode: 404, message: 'Vendor not found' })).toEqual({ statusCode: 404, message: 'Vendor not found' });
  });

  it('shows the real message in development', () => {
    vi.stubEnv('NODE_ENV', 'development');

    expect(httpError(new Error('boom')).message).toBe('boom');
  });
});
