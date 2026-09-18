/**
 * Extract a human-readable message from an unknown thrown value.
 *
 * Handles the shapes we actually see in this app:
 *  - axios errors: `err.response.data.error.message` / `err.response.data.message`
 *  - plain `Error` instances and anything else with a `message` string
 *  - anything else -> the supplied fallback
 *
 * Use this in `catch (err)` blocks so the binding can stay `unknown`
 * instead of being widened to `any`.
 */
export function getErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (typeof err === 'string' && err) return err;

  const e = err as
    | {
        response?: { data?: { error?: { message?: string }; message?: string } };
        message?: string;
      }
    | null
    | undefined;

  return (
    e?.response?.data?.error?.message ||
    e?.response?.data?.message ||
    e?.message ||
    fallback
  );
}

export default getErrorMessage;
