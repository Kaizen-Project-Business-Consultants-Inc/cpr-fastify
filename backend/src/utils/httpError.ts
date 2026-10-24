import { ZodError } from 'zod';

/**
 * Narrowing helpers for values caught in `catch` blocks.
 *
 * `catch (err)` gives `unknown`, but route handlers overwhelmingly want the
 * same two things out of it: an HTTP status code and a message to send back.
 * Doing that inline forced a cast in every handler; this centralises it.
 */

/** An error that carries the HTTP status it should be reported with. */
export interface HttpErrorInfo {
  statusCode: number;
  message: string;
}

/** True when `err` carries a numeric `statusCode` (service errors, Fastify errors). */
export function hasStatusCode(err: unknown): err is { statusCode: number } {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { statusCode?: unknown }).statusCode === 'number'
  );
}

/** The message of a thrown value, without assuming it is an `Error`. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  // e.g. `throw { statusCode: 404, message: 'Vendor not found' }`
  if (typeof err === 'object' && err !== null && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return String(err);
}

/** What a 500 says outside development; matches plugins/errorHandler.ts. */
export const GENERIC_SERVER_ERROR = 'An unexpected error occurred';

/**
 * Status code + message for a caught value, ready for
 * `reply.status(statusCode).send({ error: message })`.
 *
 * A 4xx keeps its message (it was written for the user). A 5xx is an
 * unexpected failure whose text can carry SQL or column names, so outside
 * development it is replaced by a generic message: log `err` before replying.
 *
 * @param err            – the caught value
 * @param fallbackStatus – status used when `err` carries none (default 500)
 */
export function httpError(err: unknown, fallbackStatus = 500): HttpErrorInfo {
  // Bad input parsed inside a try is the caller's mistake: a 400 naming the field.
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const field = first?.path.join('.');
    return { statusCode: 400, message: first ? `${field ? `${field}: ` : ''}${first.message}` : 'Validation failed' };
  }
  const statusCode = hasStatusCode(err) ? err.statusCode : fallbackStatus;
  const exposeDetail = statusCode < 500 || process.env.NODE_ENV === 'development';
  return {
    statusCode,
    message: exposeDetail ? errorMessage(err) : GENERIC_SERVER_ERROR,
  };
}
