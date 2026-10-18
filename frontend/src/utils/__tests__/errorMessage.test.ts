import { describe, it, expect } from 'vitest';
import { getErrorMessage } from '../errorMessage';

describe('getErrorMessage', () => {
  it('reads a plain-string server error, which most routes send', () => {
    expect(getErrorMessage({ response: { data: { error: 'Username or email already exists' } }, message: 'Request failed with status code 400' }))
      .toBe('Username or email already exists');
  });
  it('reads a structured server error', () => {
    expect(getErrorMessage({ response: { data: { error: { code: 'X', message: 'Nope' } } } })).toBe('Nope');
  });
  it('falls back to data.message, then the error message, then the fallback', () => {
    expect(getErrorMessage({ response: { data: { message: 'From message' } } })).toBe('From message');
    expect(getErrorMessage(new Error('Boom'))).toBe('Boom');
    expect(getErrorMessage(null, 'Fallback')).toBe('Fallback');
  });
});
