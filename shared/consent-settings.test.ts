import { describe, expect, it } from "vitest";
import {
  cardValuesToEventConsent,
  collectExtraConsentYamlFields,
  consentDefinitionToLocales,
  consentLabelFromKey,
  eventConsentToCardValues,
  extraConsentYamlFields,
  extraConsentYamlFieldsFromObject,
  getBuiltinConsentFallback,
  isBlankConsentHtml,
  localesToConsentDefinition,
  resolveConsentCopy,
  resolveConsentLocaleText,
  slugifyConsentKey,
  stripConsentHtml,
  yamlFieldFromConsentKey,
} from "./consent-settings";
import { leadFormDataSchema } from "./component-registry/_common/schema";
import { resolveFormDefaults } from "./resolveFormDefaults";

describe("slugifyConsentKey", () => {
  it("prefixes consent_ and lowercases", () => {
    expect(slugifyConsentKey("WhatsApp")).toBe("consent_whatsapp");
    expect(slugifyConsentKey("consent_email")).toBe("consent_email");
    expect(slugifyConsentKey("  Terms of Service ")).toBe("consent_terms_of_service");
  });

  it("returns empty for blank names", () => {
    expect(slugifyConsentKey("   ")).toBe("");
  });
});

describe("consentLabelFromKey", () => {
  it("uses builtin labels", () => {
    expect(consentLabelFromKey("consent_general")).toBe("General");
    expect(consentLabelFromKey("consent_sms")).toBe("SMS");
  });

  it("title-cases custom keys", () => {
    expect(consentLabelFromKey("consent_terms_of_service")).toBe("Terms Of Service");
  });
});

describe("localesToConsentDefinition / consentDefinitionToLocales", () => {
  it("stores default locale as default and others as query.locale conditions", () => {
    const def = localesToConsentDefinition(
      { en: "I agree via email.", es: "Acepto por correo." },
      "en",
    );
    expect(def).toEqual({
      default: "I agree via email.",
      conditions: [{ query: { locale: "es" }, value: "Acepto por correo." }],
    });
    expect(consentDefinitionToLocales(def, "en")).toEqual({
      en: "I agree via email.",
      es: "Acepto por correo.",
    });
  });

  it("omits empty non-default locales", () => {
    const def = localesToConsentDefinition({ en: "Hello", es: "  " }, "en");
    expect(def.conditions).toBeUndefined();
    expect(def.default).toBe("Hello");
  });

  it("keeps an empty default so the form can fall back", () => {
    const def = localesToConsentDefinition({ en: "", es: "Acepto." }, "en");
    expect(def.default).toBe("");
    expect(def.conditions).toEqual([{ query: { locale: "es" }, value: "Acepto." }]);
  });
});

describe("yamlFieldFromConsentKey / extraConsentYamlFields", () => {
  it("maps builtin settings keys to YAML fields", () => {
    expect(yamlFieldFromConsentKey("consent_general")).toBe("marketing");
    expect(yamlFieldFromConsentKey("consent_sms")).toBe("sms");
    expect(yamlFieldFromConsentKey("consent_whatsapp")).toBe("whatsapp");
    expect(yamlFieldFromConsentKey("consent_foo")).toBe("foo");
  });

  it("lists only extra channels from settings keys", () => {
    expect(
      extraConsentYamlFields([
        "consent_whatsapp",
        "consent_sms",
        "consent_email",
        "consent_general",
        "consent_terms",
      ]),
    ).toEqual(["terms"]);
  });

  it("unions settings extras with stored consent booleans", () => {
    expect(
      collectExtraConsentYamlFields(
        ["consent_terms"],
        { marketing: true, foo: true, sms_usa_only: false },
      ),
    ).toEqual(["terms", "foo"]);
  });

  it("does not treat ConsentCard UI keys as channels", () => {
    expect(
      extraConsentYamlFieldsFromObject({
        marketing: true,
        test: true,
        smsUsaOnly: false,
        showTerms: true,
        termsUrl: "/t",
        privacyUrl: "/p",
      }),
    ).toEqual(["test"]);
  });
});

describe("eventConsentToCardValues / cardValuesToEventConsent", () => {
  it("round-trips extra channels as first-class YAML keys", () => {
    const card = eventConsentToCardValues({
      marketing: true,
      sms: false,
      whatsapp: false,
      sms_usa_only: true,
      show_terms: true,
      terms_url: "/terms",
      test: true,
      marketing_text: "Keep me",
    });
    expect(card.test).toBe(true);
    expect(card.smsUsaOnly).toBe(true);
    expect((card as { extras?: unknown }).extras).toBeUndefined();

    expect(
      cardValuesToEventConsent(card, { marketing_text: "Keep me" }),
    ).toEqual({
      marketing: true,
      sms: false,
      whatsapp: false,
      sms_usa_only: true,
      show_terms: true,
      terms_url: "/terms",
      marketing_text: "Keep me",
      test: true,
    });
  });
});

describe("resolveConsentLocaleText", () => {
  it("prefers the active locale then fallback", () => {
    expect(resolveConsentLocaleText({ en: "EN", es: "ES" }, "es", "fb")).toBe("ES");
    expect(resolveConsentLocaleText({ en: "EN" }, "es", "fb")).toBe("fb");
    expect(resolveConsentLocaleText("", "en", "fb")).toBe("fb");
    expect(resolveConsentLocaleText("plain", "en", "fb")).toBe("plain");
  });

  it("treats empty rich-text HTML as blank", () => {
    expect(isBlankConsentHtml("<p><br></p>")).toBe(true);
    expect(isBlankConsentHtml("<p>I agree</p>")).toBe(false);
    expect(resolveConsentLocaleText({ en: "<p><br></p>" }, "en", "fb")).toBe("fb");
  });
});

describe("builtin consent fallbacks", () => {
  it("returns the hardcoded EN/ES copy", () => {
    expect(getBuiltinConsentFallback("consent_email", "en")).toMatch(/email/i);
    expect(getBuiltinConsentFallback("consent_email", "es")).toMatch(/correo/i);
    expect(getBuiltinConsentFallback("consent_foo", "en")).toBe("");
  });

  it("strips tags for previews", () => {
    expect(stripConsentHtml('<p>I agree to the <a href="/t">Terms</a>.</p>')).toBe("I agree to the Terms .");
  });

  it("resolveConsentCopy uses the builtin when the variable is empty", () => {
    expect(resolveConsentCopy("consent_email", { en: "" }, "en")).toBe(
      getBuiltinConsentFallback("consent_email", "en"),
    );
  });

  it("does not invent copy for extra channels without a variable", () => {
    expect(resolveConsentCopy("consent_test", undefined, "en")).toBe("");
    expect(resolveConsentCopy("consent_test", { en: "" }, "es")).toBe("");
  });
});

describe("lead form schema extras", () => {
  it("keeps extra consent booleans on parse", () => {
    const parsed = leadFormDataSchema.parse({
      consent: { marketing: true, terms: true },
    });
    expect(parsed.consent).toEqual({ marketing: true, terms: true });
  });

  it("keeps extra consent booleans on the site schema used at runtime", async () => {
    const { leadFormDataSchema: siteSchema } = await import(
      "../site_4geeks-com/component-registry/_common/schema"
    );
    const parsed = siteSchema.parse({
      consent: { marketing: true, test: true },
    });
    expect(parsed.consent).toEqual({ marketing: true, test: true });
  });
});

describe("resolveFormDefaults extras", () => {
  it("fills extra consent channels from the conversion event", () => {
    const result = resolveFormDefaults(
      {},
      { name: "download_guide", consent: { marketing: true, terms: true } },
      "form",
    );
    expect((result.form as Record<string, unknown>).consent).toEqual({
      marketing: true,
      terms: true,
    });
  });
});

