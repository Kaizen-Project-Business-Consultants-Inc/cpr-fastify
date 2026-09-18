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
  return String(err);
}

/**
 * Status code + message for a caught value, ready for
 * `reply.status(statusCode).send({ error: message })`.
 *
 * @param err            – the caught value
 * @param fallbackStatus – status used when `err` carries none (default 500)
 */
export function httpError(err: unknown, fallbackStatus = 500): HttpErrorInfo {
  return {
    statusCode: hasStatusCode(err) ? err.statusCode : fallbackStatus,
    message: errorMessage(err),
  };
}
