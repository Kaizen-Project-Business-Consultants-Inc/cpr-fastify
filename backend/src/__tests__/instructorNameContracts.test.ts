import { describe, it, expect, vi, beforeEach } from 'vitest';

// Full-flow E2E 2026-10-21: the organization's My Courses and Course Admin's
// Confirmed/Completed lists showed the instructor's login ("instructor")
// instead of their name ("Pat Lee"), unlike every other screen.
const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock('../config/database.js', () => ({ getPool: () => ({ query: mockQuery }) }));
vi.mock('../config/logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { CourseRequestRepository } from '../repositories/CourseRequestRepository.js';

const FULL_NAME = "COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name,''),' ',COALESCE(u.last_name,''))), ''), u.username)";
const sqlOf = (i: number) => String(mockQuery.mock.calls[i][0]);

describe('instructor shown by name, not login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue([[{ total: 0 }]]);
  });

  it('organization My Courses', async () => {
    await new OrganizationRepository().getOrgCourses(1, { archived: false, limit: 25, offset: 0 });

    expect(sqlOf(0)).toContain(`${FULL_NAME} as instructor,`);
    expect(sqlOf(0)).not.toContain('u.username as instructor');
  });

  it('course admin course lists', async () => {
    await new CourseRequestRepository().findCompleted();

    expect(sqlOf(0)).toContain(`${FULL_NAME} as instructorName`);
    expect(sqlOf(0)).toContain(`${FULL_NAME} as instructor_name`);
    expect(sqlOf(0)).not.toContain('u.username as instructor');
  });
});
