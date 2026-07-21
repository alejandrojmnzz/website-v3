import type { Session } from "@shared/session";
import { joinFormSettingsPath } from "@shared/joinFormSettingsPath";
import { buildSamplePayload } from "@/lib/tracking";

function getValueAtPath(obj: unknown, fieldPath: string): unknown {
  if (!fieldPath) return obj;
  const parts = fieldPath.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Builds a sample webhook payload by merging the base SAMPLE_LEAD_PAYLOAD with:
 * - YML form-settings fields (program, tags, automations, consent) extracted from
 *   `sectionSource` at the given `formSettingsPath`
 * - Session-derived fields: language, browser language, location, geo-coordinates,
 *   and all UTM / referral parameters
 *
 * Pass the result directly as `samplePayload` to WebhookCard and as the `payload`
 * body when calling the webhook test endpoint.
 *
 * `formSettingsPath` of `""` / `"."` means settings live at the section root (lead_form).
 */
export function buildWebhookSamplePayload(
  sectionSource: unknown,
  formSettingsPath: string | null | undefined,
  session: Session
): Record<string, unknown> {
  const formSettingsOverrides: Partial<Record<string, unknown>> = {};

  if (formSettingsPath != null) {
    const fp = (relative: string) => joinFormSettingsPath(formSettingsPath, relative);
    const program = getValueAtPath(sectionSource, fp("fields.program.default")) as string | undefined;
    const tags = getValueAtPath(sectionSource, fp("tags"));
    const automations = getValueAtPath(sectionSource, fp("automations")) as string | undefined;
    const consentEmail = getValueAtPath(sectionSource, fp("consent.marketing")) as boolean | undefined;
    const consentSms = getValueAtPath(sectionSource, fp("consent.sms")) as boolean | undefined;
    const consentWhatsapp = getValueAtPath(sectionSource, fp("consent.whatsapp")) as boolean | undefined;

    if (program) formSettingsOverrides.program = program;
    if (tags != null) formSettingsOverrides.tags = tags;
    if (automations) formSettingsOverrides.automations = automations;
    if (consentEmail != null) formSettingsOverrides.consent_email = consentEmail;
    if (consentSms != null) formSettingsOverrides.sms_consent = consentSms;
    if (consentWhatsapp != null) formSettingsOverrides.consent_whatsapp = consentWhatsapp;
  }

  const sessionOverrides: Partial<Record<string, unknown>> = {};

  if (session.language) sessionOverrides.language = session.language;
  if (session.browserLang) sessionOverrides.browser_lang = session.browserLang;
  if (session.location?.slug) sessionOverrides.location = session.location.slug;
  if (session.location?.region) sessionOverrides.region = session.location.region;
  if (session.location?.city) sessionOverrides.city = session.location.city;
  if (session.location?.country_code) sessionOverrides.country = session.location.country_code;
  if (session.geo?.latitude != null) sessionOverrides.latitude = String(session.geo.latitude);
  if (session.geo?.longitude != null) sessionOverrides.longitude = String(session.geo.longitude);
  if (session.utm?.utm_source) sessionOverrides.utm_source = session.utm.utm_source;
  if (session.utm?.utm_medium) sessionOverrides.utm_medium = session.utm.utm_medium;
  if (session.utm?.utm_campaign) sessionOverrides.utm_campaign = session.utm.utm_campaign;
  if (session.utm?.utm_content) sessionOverrides.utm_content = session.utm.utm_content;
  if (session.utm?.utm_term) sessionOverrides.utm_term = session.utm.utm_term;
  if (session.utm?.utm_url) sessionOverrides.utm_url = session.utm.utm_url;
  if (session.utm?.utm_placement) sessionOverrides.utm_placement = session.utm.utm_placement;
  if (session.utm?.utm_plan) sessionOverrides.utm_plan = session.utm.utm_plan;
  if (session.utm?.ppc_tracking_id) sessionOverrides.ppc_tracking_id = session.utm.ppc_tracking_id;
  if (session.utm?.referral) sessionOverrides.referral = session.utm.referral;
  if (session.utm?.coupon) sessionOverrides.coupon = session.utm.coupon;

  return buildSamplePayload({ ...formSettingsOverrides, ...sessionOverrides });
}
