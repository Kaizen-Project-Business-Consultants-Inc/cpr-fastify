/** The organization form both the wizard and the edit dialog use. */
export interface OrganizationForm {
  name: string;
  contactPerson: string;
  contactPosition: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  organizationComments: string;
}

/**
 * POST/PUT /sysadmin/organizations take the organizations table's own column
 * names, so the form's camelCase fields are mapped here (anything else is
 * dropped by the server's schema).
 */
export function toOrganizationBody(form: OrganizationForm) {
  return {
    name: form.name.trim(),
    contact_name: form.contactPerson,
    contact_position: form.contactPosition,
    contact_email: form.contactEmail.trim(),
    contact_phone: form.contactPhone,
    address: form.address,
    address_city: form.city,
    address_province: form.province,
    address_postal_code: form.postalCode,
    country: form.country,
    organization_comments: form.organizationComments,
  };
}
