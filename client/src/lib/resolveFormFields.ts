/**
 * Signup-aware field resolution for LeadForm.
 *
 * When a form has `is_signup: true` and the visitor is logged in, identity
 * fields already present on their profile are hidden from the UI but still
 * prefilled and submitted with the payload.
 */

export type IdentityField = "email" | "first_name" | "last_name";

export interface KnownProfileValues {
  email?: string;
  first_name?: string;
  last_name?: string;
}

export interface ResolvedIdentityFields {
  /** Identity fields to hide because the profile already provides them. */
  hidden: Set<IdentityField>;
  /** Values to prefill into the form (also submitted while hidden). */
  prefill: KnownProfileValues;
}

const IDENTITY_FIELDS: IdentityField[] = ["email", "first_name", "last_name"];

export function resolveFormFields(
  signupActive: boolean,
  profile: KnownProfileValues | null,
): ResolvedIdentityFields {
  const hidden = new Set<IdentityField>();
  const prefill: KnownProfileValues = {};

  if (!signupActive || !profile) return { hidden, prefill };

  for (const field of IDENTITY_FIELDS) {
    const value = profile[field]?.trim();
    if (value) {
      hidden.add(field);
      prefill[field] = value;
    }
  }

  return { hidden, prefill };
}
