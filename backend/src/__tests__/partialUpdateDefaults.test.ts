import { describe, it, expect, vi } from 'vitest';
// The route modules pull in config at import time; stub it so only the schemas load.
vi.mock('../config/database.js', () => ({ getPool: () => ({ query: vi.fn() }) }));
vi.mock('../config/logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../config/env.js', () => ({ env: { FRONTEND_URL: 'https://example.test', BCRYPT_SALT_ROUNDS: 4 } }));
vi.mock('../services/CertReminderService.js', () => ({ CertReminderService: class {} }));
vi.mock('../services/EmailService.js', () => ({ emailService: {} }));
vi.mock('../plugins/auth.js', () => ({ requireAuth: async () => {}, requireRole: () => async () => {} }));

import { updateCourseSchema } from '../routes/admin.js';
import { updateTierSchema } from '../routes/pay-rates.js';

// zod 4 fires a .default() inside .partial() when the key is missing. A PUT that
// sends only a name must not turn into "is_active = true" or "course_bonus = 50".
describe('partial update schemas do not inject create defaults', () => {
  it('course update with only a name leaves is_active undefined', () => {
    const data = updateCourseSchema.parse({ name: 'Renamed' });
    expect(data).toEqual({ name: 'Renamed' });
    expect(data.is_active).toBeUndefined();
  });

  it('course update still honors an explicit is_active', () => {
    expect(updateCourseSchema.parse({ is_active: false }).is_active).toBe(false);
  });

  it('tier update with only a name leaves course_bonus undefined', () => {
    const data = updateTierSchema.parse({ name: 'Senior' });
    expect(data).toEqual({ name: 'Senior' });
    expect(data.course_bonus).toBeUndefined();
  });

  it('tier update still honors an explicit course_bonus and is_active', () => {
    expect(updateTierSchema.parse({ course_bonus: 75, is_active: false })).toEqual({ course_bonus: 75, is_active: false });
  });
});
