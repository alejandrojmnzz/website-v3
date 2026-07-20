/**
 * Resolves effective form defaults by merging conversion event defaults into the form section.
 * Form-level YML values always take precedence; missing fields fall back to event defaults.
 *
 * This merge happens at read/resolve time — no YML files are modified.
 */

export interface ConsentDefaults {
  marketing?: boolean;
  sms?: boolean;
  whatsapp?: boolean;
  sms_usa_only?: boolean;
  marketing_text?: string;
  sms_text?: string;
  show_terms?: boolean;
  terms_url?: string;
  privacy_url?: string;
}

export interface ConversionEventDefaults {
  name: string;
  automations?: string;
  tags?: string[];
  consent?: ConsentDefaults;
  webhook?: {
    url: string;
    method?: "POST" | "GET";
    auth_header?: string;
  };
  success?: {
    message?: string;
    url?: string;
  };
}

/**
 * Deep-merges conversion event defaults into a form section's settings.
 * The `formSettingsPath` indicates the path within the section where form
 * settings live (e.g. "form" or "settings.form"). For fields under
 * `formSettingsPath.consent.*`, form-level values win; event defaults fill gaps.
 *
 * For automations and tags: form-level value wins if set; event default is the fallback.
 *
 * Returns a new section object (shallow copy at top level).
 */
export function resolveFormDefaults(
  formSection: Record<string, unknown>,
  conversionEvent: ConversionEventDefaults | null | undefined,
  formSettingsPath: string = "form"
): Record<string, unknown> {
  if (!conversionEvent) return formSection;

  const get = (obj: Record<string, unknown>, path: string): unknown => {
    const keys = path.split(".");
    let cur: unknown = obj;
    for (const key of keys) {
      if (cur == null || typeof cur !== "object") return undefined;
      cur = (cur as Record<string, unknown>)[key];
    }
    return cur;
  };

  const set = (
    obj: Record<string, unknown>,
    path: string,
    value: unknown
  ): Record<string, unknown> => {
    const keys = path.split(".");
    const result = { ...obj };
    let cur: Record<string, unknown> = result;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      cur[key] = cur[key] != null && typeof cur[key] === "object"
        ? { ...(cur[key] as Record<string, unknown>) }
        : {};
      cur = cur[key] as Record<string, unknown>;
    }
    cur[keys[keys.length - 1]] = value;
    return result;
  };

  let result = { ...formSection };

  if (conversionEvent.automations !== undefined) {
    const existing = get(result, `${formSettingsPath}.automations`);
    if (existing === undefined || existing === null || existing === "") {
      result = set(result, `${formSettingsPath}.automations`, conversionEvent.automations);
    }
  }

  if (conversionEvent.tags !== undefined && conversionEvent.tags.length > 0) {
    const existing = get(result, `${formSettingsPath}.tags`);
    const hasFormTags =
      (Array.isArray(existing) && existing.length > 0) ||
      (typeof existing === "string" && existing.trim() !== "");
    if (!hasFormTags) {
      result = set(result, `${formSettingsPath}.tags`, conversionEvent.tags);
    }
  }

  if (conversionEvent.webhook?.url) {
    const existingUrl = get(result, `${formSettingsPath}.webhook.url`);
    if (!existingUrl) {
      result = set(result, `${formSettingsPath}.webhook`, conversionEvent.webhook);
    }
  }

  if (conversionEvent.success) {
    const existingUrl = get(result, `${formSettingsPath}.success.url`);
    const existingMessage = get(result, `${formSettingsPath}.success.message`);
    const hasFormSuccess =
      (typeof existingUrl === "string" && existingUrl.trim() !== "") ||
      (typeof existingMessage === "string" && existingMessage.trim() !== "");
    if (!hasFormSuccess) {
      const success: { message?: string; url?: string } = {};
      if (conversionEvent.success.url?.trim()) success.url = conversionEvent.success.url.trim();
      if (conversionEvent.success.message?.trim()) success.message = conversionEvent.success.message.trim();
      if (success.url || success.message) {
        result = set(result, `${formSettingsPath}.success`, success);
      }
    }
  }

  if (conversionEvent.consent) {
    const consentDefaults = conversionEvent.consent;
    const consentFields: Array<keyof ConsentDefaults> = [
      "marketing",
      "sms",
      "whatsapp",
      "sms_usa_only",
      "marketing_text",
      "sms_text",
    ];
    for (const field of consentFields) {
      if (consentDefaults[field] !== undefined) {
        const existing = get(result, `${formSettingsPath}.consent.${field}`);
        if (existing === undefined || existing === null) {
          result = set(result, `${formSettingsPath}.consent.${field}`, consentDefaults[field]);
        }
      }
    }
    if (consentDefaults.show_terms !== undefined) {
      const existing = get(result, `${formSettingsPath}.show_terms`);
      if (existing === undefined || existing === null) {
        result = set(result, `${formSettingsPath}.show_terms`, consentDefaults.show_terms);
      }
    }
    if (consentDefaults.terms_url) {
      const existing = get(result, `${formSettingsPath}.terms_url`);
      if (!existing) {
        result = set(result, `${formSettingsPath}.terms_url`, consentDefaults.terms_url);
      }
    }
    if (consentDefaults.privacy_url) {
      const existing = get(result, `${formSettingsPath}.privacy_url`);
      if (!existing) {
        result = set(result, `${formSettingsPath}.privacy_url`, consentDefaults.privacy_url);
      }
    }
  }

  return result;
}
