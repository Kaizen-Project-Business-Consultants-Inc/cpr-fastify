import { OrganizationRepository, Organization, OrganizationProfileStats } from '../repositories/OrganizationRepository.js';

/** An organization request that can't be done. `statusCode` is the HTTP status to answer with (400 by default). */
export class OrgError extends Error {
  constructor(message: string, public statusCode: number = 400) {
    super(message);
    this.name = 'OrgError';
  }
}

/** An organization's own profile and course lists, and the organization list for admins. Throws OrgError. */
export class OrganizationService {
  constructor(private orgRepo: OrganizationRepository) {}

  async getOrganization(orgId: number): Promise<Organization> {
    const org = await this.orgRepo.findById(orgId);
    if (!org) throw new OrgError('Organization not found', 404);
    return org;
  }

  /** The org's own record plus the counts its Profile cards show. */
  async getProfile(orgId: number): Promise<Organization & OrganizationProfileStats> {
    const org = await this.getOrganization(orgId);
    return { ...org, ...(await this.orgRepo.getProfileStats(orgId)) };
  }

  async updateProfile(orgId: number, data: { name: string; address: string; contactPhone: string; contactEmail: string }): Promise<Organization> {
    const org = await this.orgRepo.updateProfile(orgId, data);
    if (!org) throw new OrgError('Organization not found', 404);
    return org;
  }

  async getCourses(orgId: number, page: number, limit: number, dateRange?: { from?: string; to?: string }) {
    const safeLimit = Math.min(limit, 100);
    const offset = (page - 1) * safeLimit;
    return this.orgRepo.getOrgCourses(orgId, { archived: false, limit: safeLimit, offset, from: dateRange?.from, to: dateRange?.to });
  }

  async getArchivedCourses(orgId: number, dateRange?: { from?: string; to?: string }) {
    return this.orgRepo.getOrgCourses(orgId, { archived: true, limit: 500, offset: 0, from: dateRange?.from, to: dateRange?.to });
  }

  async listOrganizations(options: { search?: string; page: number; limit: number }) {
    const safeLimit = Math.min(options.limit, 100);
    const offset = (options.page - 1) * safeLimit;
    return this.orgRepo.findWithStats({ search: options.search, limit: safeLimit, offset });
  }
}
