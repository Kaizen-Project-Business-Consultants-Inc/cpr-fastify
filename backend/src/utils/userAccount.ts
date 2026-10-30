/** Personal-data erasure gives the account this placeholder email domain; it marks the account as erased. */
export const ERASED_EMAIL_DOMAIN = '@deleted.invalid';

/** True when the email is the placeholder given to an account whose personal data was erased. */
export const isErased = (email: string | null | undefined) => !!email && email.endsWith(ERASED_EMAIL_DOMAIN);

/** Only erasure may give an account the placeholder domain (it marks the account as erased). */
export const notReservedEmail = (email: string) => !isErased(email.toLowerCase());

/** Erased accounts are renamed `deleted_<id>`, so nobody else may take such a name. */
export const notReservedUsername = (u: string) => !/^deleted_/i.test(u);
