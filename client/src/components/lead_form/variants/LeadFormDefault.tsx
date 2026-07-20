
import { useState, useEffect } from "react";
import { Check, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Turnstile } from "@marsidev/react-turnstile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useSession, useLocation as useSessionLocation, useUTM } from "@/contexts/SessionContext";
import { useSectionContext } from "@/contexts/SectionContext";
import { apiRequest } from "@/lib/queryClient";
import { PhoneInput } from "@/components/ui/phone-input";
import type { Country } from "react-phone-number-input";
import { trackFormSubmission, resolveWebhook, hashEmail, type ConversionName, type TrackingSettingsResponse } from "@/lib/tracking";
import { resolveFormDefaults } from "@shared/resolveFormDefaults";

interface FieldConfig {
  visible?: boolean;
  required?: boolean;
  default?: string;
  default_country?: string; // e.g. "ES", "US" – passed to PhoneInput defaultCountry
  helper_text?: string;
  placeholder?: string;
  show_label?: boolean;
  label?: string;
  rows?: number;
  slugs?: string[]; // For program field: limits which programs appear in the dropdown
}

export interface LeadFormData {
  variant?: "stacked" | "inline";
  conversion_name?: ConversionName;
  title?: string;
  subtitle?: string;
  submit_label?: string;
  tags?: string;
  automations?: string;
  webhook?: {
    url: string;
    method?: "POST" | "GET";
  };
  fields?: {
    email?: FieldConfig;
    first_name?: FieldConfig;
    last_name?: FieldConfig;
    phone?: FieldConfig;
    program?: FieldConfig;
    region?: FieldConfig;
    location?: FieldConfig;
    coupon?: FieldConfig;
    client_comments?: FieldConfig;
  };
  success?: {
    url?: string;
    message?: string;
  };
  consent?: {
    email?: boolean;
    sms?: boolean;
    whatsapp?: boolean;
    marketing?: boolean;
    marketing_text?: string;
    sms_text?: string;
    sms_usa_only?: boolean;
  };
  show_terms?: boolean;
  terms_url?: string;
  privacy_url?: string;
  className?: string;
  button_className?: string;
  terms_className?: string;
  turnstile?: {
    enabled?: boolean;
    theme?: "light" | "dark" | "auto";
    size?: "normal" | "compact";
  };
}

interface LeadFormProps {
  data: LeadFormData;
  termsStyle?: React.CSSProperties;
}

interface FormOptions {
  programs: Array<{ slug: string; title: string; bc_slug?: string }>;
  locations: Array<{ slug: string; name: string; city: string; country: string; region: string }>;
  regions: Array<{ slug: string; label: string }>;
}

interface FormValues {
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  program: string;
  region: string;
  location: string;
  coupon: string;
  client_comments: string;
  consent_email: boolean;
  consent_sms: boolean;
  consent_whatsapp: boolean;
}

interface ConsentSectionProps {
  consent: NonNullable<LeadFormData["consent"]>;
  form: ReturnType<typeof useForm<FormValues>>;
  locale: string;
  formOptions?: FormOptions;
  sessionLocation: { slug: string; region: string; country?: string } | null;
  consentSettings?: Record<string, string>;
}

function ConsentSection({ consent, form, locale, formOptions, sessionLocation, consentSettings }: ConsentSectionProps) {
  const selectedLocationSlug = form.watch("location");
  
  const isUSALocation = (): boolean => {
    if (consent.sms_usa_only === false) return true;
    
    if (selectedLocationSlug && formOptions?.locations) {
      const selectedLoc = formOptions.locations.find(loc => loc.slug === selectedLocationSlug);
      if (selectedLoc) {
        return selectedLoc.country === "United States" || 
               selectedLoc.slug.endsWith("-usa") ||
               selectedLoc.region === "north-america";
      }
    }
    
    if (sessionLocation) {
      if (sessionLocation.country === "United States" || 
          sessionLocation.country === "US" ||
          sessionLocation.slug?.endsWith("-usa")) {
        return true;
      }
      if (sessionLocation.region === "north-america") {
        return true;
      }
    }
    
    return false;
  };

  const showSmsConsent = consent.sms && (!consent.sms_usa_only || isUSALocation());

  const defaultMarketingText = consentSettings?.consent_general || (locale === "es"
    ? "Acepto recibir información a través de correo electrónico, WhatsApp y/u otros canales sobre talleres, eventos, cursos y otros materiales de marketing. Nunca compartiremos tu información de contacto y puedes cancelar fácilmente en cualquier momento."
    : "I agree to receive information through email, WhatsApp and/or other channels about workshops, events, courses, and other marketing materials. We'll never share your contact information, and you can easily opt out at any moment.");

  const defaultSmsText = consentSettings?.consent_sms || (locale === "es"
    ? "Acepto recibir mensajes SMS/texto sobre talleres, eventos, cursos y otros materiales de marketing. Pueden aplicarse tarifas de mensajes y datos. Responde STOP para cancelar, HELP para ayuda. Puedes recibir hasta 4-6 mensajes de texto por mes. Nunca compartiremos tu información de contacto y puedes cancelar fácilmente en cualquier momento."
    : "I agree to receive SMS/text messages about workshops, events, courses, and other marketing materials. Message and data rates may apply. Reply STOP to unsubscribe, HELP for help. You may receive up to 4–6 text messages per month. We will never share your contact information, and you can easily opt out at any moment.");

  const defaultEmailText = consentSettings?.consent_email || (locale === "es"
    ? "Acepto recibir información por correo electrónico sobre talleres, eventos, cursos y otros materiales de marketing. Nunca compartiremos tu información de contacto y puedes cancelar fácilmente en cualquier momento."
    : "I agree to receive information via email about workshops, events, courses, and other marketing materials. We'll never share your contact information, and you can easily opt out at any moment.");

  const defaultWhatsappText = consentSettings?.consent_whatsapp || (locale === "es"
    ? "Acepto recibir información a través de WhatsApp sobre talleres, eventos, cursos y otros materiales de marketing. Nunca compartiremos tu información de contacto y puedes cancelar fácilmente en cualquier momento."
    : "I agree to receive information via WhatsApp about workshops, events, courses, and other marketing materials. We'll never share your contact information, and you can easily opt out at any moment.");

  return (
    <div className="space-y-4">
      {consent.marketing && (
        <FormField
          control={form.control}
          name="consent_email"
          rules={{ 
            validate: (value) => value === true || (locale === "es" 
              ? "Por favor marca esta casilla para continuar" 
              : "Please check this box to continue")
          }}
          render={({ field, fieldState }) => (
            <FormItem className="flex flex-col space-y-2">
              <label className="flex flex-row items-start space-x-3 cursor-pointer">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    data-testid="checkbox-consent-marketing"
                  />
                </FormControl>
                <div className="space-y-1 leading-none">
                  <span className="text-xs text-muted-foreground cursor-pointer">
                    {consent.marketing_text || defaultMarketingText}
                  </span>
                </div>
              </label>
              {fieldState.error && (
                <p className="text-sm text-destructive" data-testid="text-consent-error">
                  {fieldState.error.message}
                </p>
              )}
            </FormItem>
          )}
        />
      )}

      {!consent.marketing && consent.email && (
        <FormField
          control={form.control}
          name="consent_email"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-3 space-y-0">
              <label className="flex flex-row items-start space-x-3 cursor-pointer">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    data-testid="checkbox-consent-email"
                  />
                </FormControl>
                <div className="space-y-1 leading-none">
                  <span className="text-xs text-muted-foreground cursor-pointer">
                    {defaultEmailText}
                  </span>
                </div>
              </label>
            </FormItem>
          )}
        />
      )}

      {showSmsConsent && (
        <FormField
          control={form.control}
          name="consent_sms"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-3 space-y-0">
              <label className="flex flex-row items-start space-x-3 cursor-pointer">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    data-testid="checkbox-consent-sms"
                  />
                </FormControl>
                <div className="space-y-1 leading-none">
                  <span className="text-xs text-muted-foreground cursor-pointer">
                    {consent.sms_text || defaultSmsText}
                  </span>
                </div>
              </label>
            </FormItem>
          )}
        />
      )}

      {!consent.marketing && consent.whatsapp && (
        <FormField
          control={form.control}
          name="consent_whatsapp"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-3 space-y-0">
              <label className="flex flex-row items-start space-x-3 cursor-pointer">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    data-testid="checkbox-consent-whatsapp"
                  />
                </FormControl>
                <div className="space-y-1 leading-none">
                  <span className="text-xs text-muted-foreground cursor-pointer">
                    {defaultWhatsappText}
                  </span>
              </div>
            </label>
            </FormItem>
          )}
        />
      )}
    </div>
  );
}

export default function LeadForm({ data, termsStyle }: LeadFormProps) {
  const landingLocations: string[] | undefined = undefined;
  const { slug, contentType } = useSectionContext();
  const programContext = contentType === "program" ? slug : undefined;
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "es" ? "es" : "en";
  const { session } = useSession();
  const sessionLocation = useSessionLocation();
  const utm = useUTM();
  const [isSuccess, setIsSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileError, setTurnstileError] = useState<string | null>(null);
  const [showTurnstileModal, setShowTurnstileModal] = useState(false);
  const [pendingFormData, setPendingFormData] = useState<FormValues | null>(null);

  const turnstileEnabled = data.turnstile?.enabled ?? true;

  const { data: turnstileSiteKey } = useQuery<{ siteKey: string }>({
    queryKey: ["/api/turnstile/site-key"],
    enabled: turnstileEnabled,
  });

  const { data: trackingSettings } = useQuery<TrackingSettingsResponse>({
    queryKey: ["/api/settings/tracking"],
  });

  const { data: legalSettings } = useQuery<{ legal_terms_url: string; legal_privacy_url: string }>({
    queryKey: ["/api/settings/legal"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: consentSettings } = useQuery<Record<string, string>>({
    queryKey: ["/api/settings/consent"],
    staleTime: 5 * 60 * 1000,
  });

  const variant = data.variant || "stacked";
  const fields = data.fields || {};

  // Apply per-event defaults via resolveFormDefaults (form-level YAML values always win)
  const eventEntry = data.conversion_name
    ? trackingSettings?.conversion_events?.find((e) => e.name === data.conversion_name)
    : undefined;

  const resolvedData: LeadFormData = (() => {
    if (!eventEntry) return data;
    const wrapped = resolveFormDefaults(
      { _f: data } as Record<string, unknown>,
      {
        name: eventEntry.name,
        automations: eventEntry.automations,
        tags: eventEntry.tags,
        consent: eventEntry.consent,
        webhook: eventEntry.webhook,
        success: eventEntry.success,
      },
      "_f"
    );
    return wrapped._f as LeadFormData;
  })();

  const consent: NonNullable<LeadFormData["consent"]> = resolvedData.consent ?? {};
  const showTerms = resolvedData.show_terms ?? true;
  const effectiveTags = (() => {
    const t = resolvedData.tags;
    if (Array.isArray(t) && (t as string[]).length) return (t as string[]).join(",");
    if (typeof t === "string" && t) return t;
    return "website-lead";
  })();
  const effectiveAutomations = resolvedData.automations || "strong";
  // Effective terms/privacy URLs: form YAML wins; event default fills gap; legal settings fallback
  const effectiveTermsUrl = resolvedData.terms_url || null;
  const effectivePrivacyUrl = resolvedData.privacy_url || null;

  const hasLandingLocations = landingLocations && landingLocations.length > 0;
  const singleLandingLocation = hasLandingLocations && landingLocations.length === 1 ? landingLocations[0] : null;
  const multipleLandingLocations = hasLandingLocations && landingLocations.length > 1 ? landingLocations : null;

  const { data: formOptions } = useQuery<FormOptions>({
    queryKey: ["/api/form-options", locale],
  });

  const landingRegions = (() => {
    if (!hasLandingLocations || !formOptions?.locations) return null;
    const regionSlugs = new Set<string>();
    for (const locSlug of landingLocations!) {
      const found = formOptions.locations.find(l => l.slug === locSlug);
      if (found) regionSlugs.add(found.region);
    }
    return regionSlugs.size > 0 ? Array.from(regionSlugs) : null;
  })();

  const singleLandingRegion = landingRegions && landingRegions.length === 1 ? landingRegions[0] : null;
  const multipleLandingRegions = landingRegions && landingRegions.length > 1 ? landingRegions : null;

  const getFieldConfig = (fieldName: keyof NonNullable<LeadFormData["fields"]>): FieldConfig => {
    const defaults: Record<string, FieldConfig> = {
      email: { visible: true, required: true },
      first_name: { visible: false, required: false },
      last_name: { visible: false, required: false },
      phone: { visible: false, required: false },
      program: { visible: false, required: false, default: "auto" },
      region: { visible: false, required: false, default: "auto" },
      location: { visible: false, required: false, default: "auto" },
      coupon: { visible: false, required: false, default: "auto" },
      client_comments: { visible: false, required: false },
    };
    const baseConfig = { ...defaults[fieldName], ...fields[fieldName] };

    if (fieldName === "location" && hasLandingLocations) {
      if (singleLandingLocation) {
        return { ...baseConfig, visible: false, default: singleLandingLocation };
      }
      if (multipleLandingLocations) {
        return { ...baseConfig, visible: true, required: true, default: "" };
      }
    }

    if (fieldName === "region" && hasLandingLocations) {
      if (singleLandingRegion) {
        return { ...baseConfig, visible: false, required: false, default: singleLandingRegion };
      }
      if (multipleLandingRegions) {
        return { ...baseConfig, visible: true, required: true, default: "" };
      }
    }

    return baseConfig;
  };
  const resolveDefault = (fieldName: string, configDefault?: string): string => {
    if (!configDefault || configDefault !== "auto") {
      return configDefault || "";
    }

    switch (fieldName) {
      case "program":
        return programContext || "";
      case "location":
        if (singleLandingLocation) return singleLandingLocation;
        return sessionLocation?.slug || "";
      case "region":
        if (singleLandingRegion) return singleLandingRegion;
        return sessionLocation?.region || "";
      case "coupon":
        return utm.coupon || "";
      default:
        return "";
    }
  };

  const programFieldSlugs = getFieldConfig("program").slugs;
  const visiblePrograms = (() => {
    if (!formOptions?.programs) return [];
    // An empty slugs array is treated the same as "not configured" — show all programs.
    // This avoids an empty dropdown when slugs is accidentally set to [].
    if (!programFieldSlugs || programFieldSlugs.length === 0) return formOptions.programs;
    return programFieldSlugs
      .map(slug => formOptions.programs.find(p => p.slug === slug || p.bc_slug === slug))
      .filter((p): p is NonNullable<typeof p> => p !== undefined);
  })();

  const form = useForm<FormValues>({
    defaultValues: {
      email: "",
      first_name: resolveDefault("first_name", getFieldConfig("first_name").default),
      last_name: resolveDefault("last_name", getFieldConfig("last_name").default),
      phone: resolveDefault("phone", getFieldConfig("phone").default),
      program: resolveDefault("program", getFieldConfig("program").default),
      region: resolveDefault("region", getFieldConfig("region").default),
      location: resolveDefault("location", getFieldConfig("location").default),
      coupon: resolveDefault("coupon", getFieldConfig("coupon").default),
      client_comments: "",
      consent_email: false,
      consent_sms: false,
      consent_whatsapp: false,
    },
  });

  useEffect(() => {
    if (singleLandingLocation) {
      form.setValue("location", singleLandingLocation);
    } else if (sessionLocation && !form.getValues("location")) {
      form.setValue("location", sessionLocation.slug);
    }
    if (singleLandingRegion) {
      form.setValue("region", singleLandingRegion);
    } else if (sessionLocation?.region && !form.getValues("region")) {
      form.setValue("region", sessionLocation.region);
    }
    if (utm.coupon && !form.getValues("coupon")) {
      form.setValue("coupon", utm.coupon);
    }
    if (programContext && !form.getValues("program")) {
      form.setValue("program", programContext);
    }
  }, [sessionLocation, utm, programContext, form, singleLandingLocation, singleLandingRegion]);

  useEffect(() => {
    if (!programFieldSlugs?.length || !formOptions?.programs) return;
    const currentValue = form.getValues("program");
    if (!currentValue) return;
    const isValid = visiblePrograms.some(p => (p.bc_slug || p.slug) === currentValue);
    if (!isValid) {
      form.setValue("program", "");
    }
  }, [visiblePrograms, programFieldSlugs, formOptions?.programs, form]);

  const submitMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      // Map consent fields to backend field names
      const { consent_email, consent_sms, consent_whatsapp, ...restValues } = values;
      
      // When marketing consent is enabled, derive both email and whatsapp from consent_email checkbox
      const effectiveEmailConsent = consent_email || false;
      const effectiveWhatsappConsent = consent.marketing ? effectiveEmailConsent : (consent_whatsapp || false);
      const payload = {
        ...restValues,
        // Consent fields mapped to backend names
        consent_email: effectiveEmailConsent,
        sms_consent: consent_sms || false,
        consent_whatsapp: effectiveWhatsappConsent,
        location: singleLandingLocation || values.location || sessionLocation?.slug || resolveDefault("location", getFieldConfig("location").default),
        region: singleLandingRegion || values.region || sessionLocation?.region || resolveDefault("region", getFieldConfig("region").default),
        coupon: values.coupon || utm.coupon || resolveDefault("coupon", getFieldConfig("coupon").default),
        program: values.program || formOptions?.programs.find(p => p.slug === programContext)?.bc_slug || programContext || resolveDefault("program", getFieldConfig("program").default),
        language: session.language,
        browser_lang: session.browserLang,
        latitude: session.geo?.latitude?.toString(),
        longitude: session.geo?.longitude?.toString(),
        city: session.geo?.city,
        country: session.geo?.country,
        utm_url: window.location.href,
        utm_source: utm.utm_source,
        utm_medium: utm.utm_medium,
        utm_campaign: utm.utm_campaign,
        utm_content: utm.utm_content,
        utm_term: utm.utm_term,
        utm_placement: utm.utm_placement,
        utm_plan: utm.utm_plan,
        ppc_tracking_id: utm.ppc_tracking_id,
        referral: utm.referral || utm.ref,
        tags: effectiveTags,
        automations: effectiveAutomations,
        conversion_name: data.conversion_name,
        token: turnstileToken,
      };

      // Webhook priority: per-form (YAML) → per-event → global.
      // Any configured level sends the full lead payload instead of Breathecode.
      // Global webhook: server reads credentials from settings (auth_header never exposed to client).
      // Per-form / per-event: client supplies the URL; no auth credentials at those levels.
      const formWebhook = data.webhook?.url ? data.webhook : null;
      const eventWebhook = data.conversion_name
        ? (trackingSettings?.conversion_events?.find(e => e.name === data.conversion_name)?.webhook ?? null)
        : null;
      const globalWebhook = trackingSettings?.webhook?.url ? trackingSettings.webhook : null;

      const webhookOverride = formWebhook ?? eventWebhook ?? null;

      if (webhookOverride || globalWebhook) {
        const body: Record<string, unknown> = { payload };
        if (webhookOverride) {
          // Pass URL/method for per-form or per-event webhooks; server needs no credentials
          body.webhook = { url: webhookOverride.url, method: webhookOverride.method || "POST" };
        }
        // When no override, server reads global URL/method/auth_header from settings
        return fetch("/api/leads/webhook-delivery", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }

      return apiRequest("POST", "/api/leads", payload);
    },
    onSuccess: async (_response, variables) => {
      // Track conversion if conversion_name is defined
      if (!data.conversion_name) {
        console.error(
          '[LeadForm] Missing conversion_name in form configuration. ' +
          'Add conversion_name to the form YAML to enable tracking.'
        );
      }
      if (data.conversion_name) {
        await trackFormSubmission(
          data.conversion_name,
          {
            email: variables.email,
            program: variables.program || programContext,
            location: variables.location || sessionLocation?.slug,
          }
        );

        // The secondary curated webhook is only fired when ALL three webhook levels
        // are unconfigured (i.e., primary submission went to Breathecode).
        // When any webhook level was used above, the full payload was already delivered.
        const hasAnyWebhook = !!(
          (data.webhook?.url) ||
          (data.conversion_name && trackingSettings?.conversion_events?.find(e => e.name === data.conversion_name)?.webhook?.url) ||
          trackingSettings?.webhook?.url
        );
        if (!hasAnyWebhook) {
          try {
            const resolvedWebhook = resolveWebhook(data.webhook ?? null, data.conversion_name, trackingSettings ?? null);
            if (resolvedWebhook) {
              const webhookPayload: Record<string, unknown> = {
                conversion_name: data.conversion_name,
                program: variables.program || programContext,
                location: variables.location || sessionLocation?.slug,
                utm_source: utm.utm_source,
                utm_medium: utm.utm_medium,
                utm_campaign: utm.utm_campaign,
                utm_content: utm.utm_content,
                utm_term: utm.utm_term,
              };
              if (variables.email) {
                webhookPayload.email_hash = await hashEmail(variables.email);
              }
              fetch("/api/conversion-webhook", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  url: resolvedWebhook.url,
                  method: resolvedWebhook.method || "POST",
                  payload: webhookPayload,
                }),
              }).catch((err) => console.warn("[LeadForm] Webhook delivery failed (non-blocking):", err));
            }
          } catch (err) {
            console.warn("[LeadForm] Webhook resolution failed (non-blocking):", err);
          }
        }
      }

      if (resolvedData.success?.url) {
        window.location.href = resolvedData.success.url;
      } else {
        setIsSuccess(true);
        setSuccessMessage(resolvedData.success?.message || (locale === "es" 
          ? "¡Gracias! Te contactaremos pronto." 
          : "Thanks! We'll contact you soon."));
      }
    },
    onError: (error: Error) => {
      console.error("Lead submission error:", error);
      
      // Default user-friendly error message
      const defaultErrorMessage = locale === "es" 
        ? "Hubo un problema al enviar tu información. Por favor intenta de nuevo." 
        : "There was a problem submitting your information. Please try again.";

      // Try to parse the error message to extract details
      let errorMessage = error.message;
      try {
        // Error format: "400: {json}"
        const jsonMatch = error.message.match(/^\d+:\s*(.+)$/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1]);
          if (parsed.details) {
            // Check if details contains HTML (API error page)
            if (typeof parsed.details === 'string' && 
                (parsed.details.includes('<!DOCTYPE') || parsed.details.includes('<html'))) {
              errorMessage = defaultErrorMessage;
            } else {
              // Details may be a JSON string itself
              try {
                const details = JSON.parse(parsed.details);
                errorMessage = details.detail || details.message || parsed.error || defaultErrorMessage;
              } catch {
                errorMessage = parsed.details || parsed.error || defaultErrorMessage;
              }
            }
          } else if (parsed.error) {
            errorMessage = parsed.error;
          }
        }
      } catch {
        // Keep original message if parsing fails, but check for HTML
        if (errorMessage.includes('<!DOCTYPE') || errorMessage.includes('<html')) {
          errorMessage = defaultErrorMessage;
        }
      }
      
      // Final safety check: if message is too long or contains HTML tags, use default
      if (errorMessage.length > 200 || /<[^>]+>/.test(errorMessage)) {
        errorMessage = defaultErrorMessage;
      }

      setTurnstileError(errorMessage);
    },
  });

  const onSubmit = (values: FormValues) => {
    setTurnstileError(null);
    
    // If turnstile is enabled and we don't have a token yet, show the modal and wait
    if (turnstileEnabled && !turnstileToken) {
      setPendingFormData(values);
      setShowTurnstileModal(true);
      return;
    }
    
    submitMutation.mutate(values);
  };

  // Auto-submit when turnstile token is received and we have pending form data
  useEffect(() => {
    if (turnstileToken && pendingFormData) {
      setShowTurnstileModal(false);
      submitMutation.mutate(pendingFormData);
      setPendingFormData(null);
    }
  }, [turnstileToken, pendingFormData]);

  const filteredLocations = formOptions?.locations.filter(loc => {
    if (multipleLandingLocations) {
      if (!multipleLandingLocations.includes(loc.slug)) return false;
      const selectedRegion = form.watch("region");
      if (selectedRegion && getFieldConfig("region").visible) {
        return loc.region === selectedRegion;
      }
      return true;
    }
    const selectedRegion = form.watch("region");
    if (!selectedRegion || !getFieldConfig("region").visible) return true;
    return loc.region === selectedRegion;
  }) || [];

  // Watch all form values to determine if required fields are filled
  const watchedValues = form.watch();
  
  const allRequiredFieldsFilled = (() => {
    const requiredFields: (keyof FormValues)[] = [];
    
    if (getFieldConfig("email").visible && getFieldConfig("email").required) {
      requiredFields.push("email");
    }
    if (getFieldConfig("first_name").visible && getFieldConfig("first_name").required) {
      requiredFields.push("first_name");
    }
    if (getFieldConfig("last_name").visible && getFieldConfig("last_name").required) {
      requiredFields.push("last_name");
    }
    if (getFieldConfig("phone").visible && getFieldConfig("phone").required) {
      requiredFields.push("phone");
    }
    if (getFieldConfig("program").visible && getFieldConfig("program").required) {
      requiredFields.push("program");
    }
    if (getFieldConfig("region").visible && getFieldConfig("region").required) {
      requiredFields.push("region");
    }
    if (getFieldConfig("location").visible && getFieldConfig("location").required) {
      requiredFields.push("location");
    }
    if (getFieldConfig("client_comments").visible && getFieldConfig("client_comments").required) {
      requiredFields.push("client_comments");
    }
    
    // Check if all required fields have values
    return requiredFields.every(field => {
      const value = watchedValues[field];
      if (typeof value === "string") {
        // For email, also validate format
        if (field === "email") {
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
        }
        return value.trim() !== "";
      }
      return !!value;
    });
  })();

  const isInline = variant === "inline";

  if (isSuccess) {
    // Inline variant: compact horizontal success message
    if (isInline) {
      return (
        <div className="flex items-center gap-2 mb-4" data-testid="lead-form-success">
          <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
            <Check className="w-4 h-4 text-green-500" />
          </div>
          <p className="text-foreground text-sm" data-testid="text-success-message">
            {successMessage}
          </p>
        </div>
      );
    }

    // Stacked variant: centered success message
    return (
      <div className="text-center" data-testid="lead-form-success">
        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-green-500/20 flex items-center justify-center">
          <Check className="w-6 h-6 text-green-500" />
        </div>
        <p className="text-foreground" data-testid="text-success-message">
          {successMessage}
        </p>
      </div>
    );
  }

  const emailConfig = getFieldConfig("email");

  const hasVisibleFieldsBeyondEmailAndFirstName = 
    getFieldConfig("last_name").visible ||
    getFieldConfig("phone").visible ||
    getFieldConfig("program").visible ||
    getFieldConfig("region").visible ||
    getFieldConfig("location").visible ||
    getFieldConfig("coupon").visible ||
    getFieldConfig("client_comments").visible;

  const firstNameConfig = getFieldConfig("first_name");

  if (isInline && !hasVisibleFieldsBeyondEmailAndFirstName) {
    return (
      <div className={data.className} data-testid="lead-form">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <div className="flex gap-2 items-start flex-wrap">
              {firstNameConfig.visible && (
                <FormField
                  control={form.control}
                  name="first_name"
                  rules={{ required: firstNameConfig.required ? (locale === "es" ? "Nombre requerido" : "First name is required") : false }}
                  render={({ field }) => (
                    <FormItem className="flex-1 min-w-[140px]">
                      <FormControl>
                        <Input 
                          placeholder={firstNameConfig.placeholder || (locale === "es" ? "Tu nombre" : "Your name")} 
                          {...field} 
                          data-testid="input-first-name"
                        />
                      </FormControl>
                      <FormMessage className="text-white bg-destructive/90 px-2 py-0.5 rounded text-xs inline-block" />
                    </FormItem>
                  )}
                />
              )}
              <FormField
                control={form.control}
                name="email"
                rules={{ 
                  required: emailConfig.required ? (locale === "es" ? "Correo requerido" : "Email is required") : false,
                  pattern: {
                    value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                    message: locale === "es" ? "Correo inválido" : "Invalid email address"
                  }
                }}
                render={({ field }) => (
                  <FormItem className="flex-1 min-w-[180px]">
                    <FormControl>
                      <Input 
                        type="email" 
                        placeholder={emailConfig.placeholder || (locale === "es" ? "tu@email.com" : "you@email.com")} 
                        {...field} 
                        data-testid="input-email"
                      />
                    </FormControl>
                    <FormMessage className="text-white bg-destructive/90 px-2 py-0.5 rounded text-xs inline-block" />
                  </FormItem>
                )}
              />
              <Button 
                type="submit" 
                disabled={submitMutation.isPending}
                data-testid="button-submit"
              >
                {submitMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  data.submit_label || (locale === "es" ? "Enviar" : "Submit")
                )}
              </Button>
            </div>
            {turnstileEnabled && turnstileSiteKey?.siteKey && showTurnstileModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
                <div className="bg-card p-card-padding rounded-card shadow-card">
                  <Turnstile
                    siteKey={turnstileSiteKey.siteKey}
                    onSuccess={(token: string) => setTurnstileToken(token)}
                    onError={() => {
                      setTurnstileError(locale === "es" ? "Error de verificación" : "Verification error");
                      setShowTurnstileModal(false);
                      setPendingFormData(null);
                    }}
                    onExpire={() => setTurnstileToken(null)}
                    options={{
                      theme: data.turnstile?.theme || "auto",
                      size: data.turnstile?.size || "compact",
                    }}
                  />
                </div>
              </div>
            )}
            {turnstileError && (
              <p className="text-sm text-destructive mt-2" data-testid="text-turnstile-error">
                {turnstileError}
              </p>
            )}
            {emailConfig.helper_text && (
              <p className="text-sm text-muted-foreground mt-2" data-testid="text-email-helper">
                {emailConfig.helper_text}
              </p>
            )}
            {allRequiredFieldsFilled && consent.email && (
              <FormField
                control={form.control}
                name="consent_email"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 mt-3">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-consent-email"
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <Label className="text-xs text-muted-foreground cursor-pointer" htmlFor="consent_email">
                        {locale === "es"
                          ? "Acepto recibir información por correo electrónico sobre talleres, eventos, cursos y otros materiales de marketing."
                          : "I agree to receive information via email about workshops, events, courses, and other marketing materials."
                        }
                      </Label>
                    </div>
                  </FormItem>
                )}
              />
            )}
          </form>
        </Form>
      </div>
    );
  }

  return (
    <div className={data.className} data-testid="lead-form">
      {data.title && (
        <h2 
          className="mb-2 text-center text-foreground"
          data-testid="text-form-title"
        >
          {data.title}
        </h2>
      )}
      {data.subtitle && (
        <p 
          className="text-body text-muted-foreground text-center mb-6"
          data-testid="text-form-subtitle"
        >
          {data.subtitle}
        </p>
      )}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-4">
            {/* First + Last name on same row - NEW ORDER: Name -> Phone -> Email */}
            {(getFieldConfig("first_name").visible || getFieldConfig("last_name").visible) && (
              <div className={`grid gap-3 ${getFieldConfig("first_name").visible && getFieldConfig("last_name").visible ? "grid-cols-2" : "grid-cols-1"}`}>
                {getFieldConfig("first_name").visible && (
                  <FormField
                    control={form.control}
                    name="first_name"
                    rules={{ required: getFieldConfig("first_name").required ? (locale === "es" ? "Nombre requerido" : "First name is required") : false }}
                    render={({ field }) => (
                      <FormItem className="space-y-2 mt-[2px] mb-[2px]">
                        {getFieldConfig("first_name").show_label && (
                          <FormLabel>{getFieldConfig("first_name").label || (locale === "es" ? "Nombre" : "First name")}</FormLabel>
                        )}
                        <FormControl>
                          <Input 
                            placeholder={getFieldConfig("first_name").placeholder || (locale === "es" ? "Nombre" : "First name")}
                            {...field} 
                            data-testid="input-first-name" 
                          />
                        </FormControl>
                        <FormMessage className="text-white bg-destructive/90 px-2 py-0.5 rounded text-xs inline-block" />
                      </FormItem>
                    )}
                  />
                )}
                {getFieldConfig("last_name").visible && (
                  <FormField
                    control={form.control}
                    name="last_name"
                    rules={{ required: getFieldConfig("last_name").required ? (locale === "es" ? "Apellido requerido" : "Last name is required") : false }}
                    render={({ field }) => (
                      <FormItem className="space-y-2 mt-[2px] mb-[2px]">
                        {getFieldConfig("last_name").show_label && (
                          <FormLabel>{getFieldConfig("last_name").label || (locale === "es" ? "Apellido" : "Last name")}</FormLabel>
                        )}
                        <FormControl>
                          <Input 
                            placeholder={getFieldConfig("last_name").placeholder || (locale === "es" ? "Apellido" : "Last name")}
                            {...field} 
                            data-testid="input-last-name" 
                          />
                        </FormControl>
                        <FormMessage className="text-white bg-destructive/90 px-2 py-0.5 rounded text-xs inline-block" />
                      </FormItem>
                    )}
                  />
                )}
              </div>
            )}

            {/* Phone with country code */}
            {getFieldConfig("phone").visible && (
              <FormField
                control={form.control}
                name="phone"
                rules={{ required: getFieldConfig("phone").required ? (locale === "es" ? "Teléfono requerido" : "Phone is required") : false }}
                render={({ field }) => (
                  <FormItem className="space-y-2 mt-[2px] mb-[2px]">
                    {getFieldConfig("phone").show_label && (
                      <FormLabel>{getFieldConfig("phone").label || (locale === "es" ? "Teléfono" : "Phone")}</FormLabel>
                    )}
                    <FormControl>
                      <PhoneInput
                        value={field.value}
                        onChange={field.onChange}
                        defaultCountry={
                          (getFieldConfig("phone").default_country ||
                            session?.geo?.country_code ||
                            "US") as Country
                        }
                        placeholder={getFieldConfig("phone").placeholder || (locale === "es" ? "Teléfono" : "Phone number")}
                        data-testid="input-phone"
                      />
                    </FormControl>
                    {getFieldConfig("phone").helper_text && (
                      <p className="text-sm text-muted-foreground">{getFieldConfig("phone").helper_text}</p>
                    )}
                    <FormMessage className="text-white bg-destructive/90 px-2 py-0.5 rounded text-xs inline-block" />
                  </FormItem>
                )}
              />
            )}

            {/* Email */}
            {getFieldConfig("email").visible && (
              <FormField
                control={form.control}
                name="email"
                rules={{ 
                  required: getFieldConfig("email").required ? (locale === "es" ? "Correo requerido" : "Email is required") : false,
                  pattern: {
                    value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                    message: locale === "es" ? "Correo inválido" : "Invalid email address"
                  }
                }}
                render={({ field }) => (
                  <FormItem className="space-y-2 mt-[2px] mb-[2px]">
                    {getFieldConfig("email").show_label && (
                      <FormLabel>{getFieldConfig("email").label || (locale === "es" ? "Correo electrónico" : "Email")}</FormLabel>
                    )}
                    <FormControl>
                      <Input 
                        type="email" 
                        placeholder={getFieldConfig("email").placeholder || (locale === "es" ? "Escribe tu correo, ej: usuario@dominio.com" : "Type your email, ex: username@domain.com")} 
                        {...field} 
                        data-testid="input-email"
                      />
                    </FormControl>
                    <FormMessage className="text-white bg-destructive/90 px-2 py-0.5 rounded text-xs inline-block" />
                  </FormItem>
                )}
              />
            )}

            {(getFieldConfig("region").visible || getFieldConfig("location").visible) && (
              <div className="grid grid-cols-2 gap-3">
                {getFieldConfig("region").visible && (
                  <FormField
                    control={form.control}
                    name="region"
                    rules={{ required: getFieldConfig("region").required ? (locale === "es" ? "Región requerida" : "Region is required") : false }}
                    render={({ field }) => (
                      <FormItem>
                        {getFieldConfig("region").show_label && (
                          <FormLabel>{getFieldConfig("region").label || (locale === "es" ? "Región" : "Region")}</FormLabel>
                        )}
                        <Select onValueChange={field.onChange} value={field.value} disabled={!!singleLandingRegion}>
                          <FormControl>
                            <SelectTrigger data-testid="select-region">
                              <SelectValue placeholder={locale === "es" ? "Selecciona una región" : "Select a region"} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {(singleLandingRegion
                              ? formOptions?.regions.filter(r => r.slug === singleLandingRegion)
                              : multipleLandingRegions
                                ? formOptions?.regions.filter(r => multipleLandingRegions.includes(r.slug))
                                : formOptions?.regions
                            )?.map((region) => (
                              <SelectItem key={region.slug} value={region.slug}>
                                {region.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {getFieldConfig("region").helper_text && (
                          <p className="text-sm text-muted-foreground">{getFieldConfig("region").helper_text}</p>
                        )}
                        <FormMessage className="text-white bg-destructive/90 px-2 py-0.5 rounded text-xs inline-block" />
                      </FormItem>
                    )}
                  />
                )}

                {getFieldConfig("location").visible && (
                  <FormField
                    control={form.control}
                    name="location"
                    rules={{ required: getFieldConfig("location").required ? (locale === "es" ? "Campus requerido" : "Campus is required") : false }}
                    render={({ field }) => (
                      <FormItem>
                        {getFieldConfig("location").show_label && (
                          <FormLabel>{getFieldConfig("location").label || (locale === "es" ? "Campus" : "Campus")}</FormLabel>
                        )}
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-location">
                              <SelectValue placeholder={locale === "es" ? "Selecciona un campus" : "Select a campus"} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {formOptions?.regions.map((region) => {
                              const regionLocations = filteredLocations.filter(loc => loc.region === region.slug);
                              if (regionLocations.length === 0) return null;
                              return (
                                <SelectGroup key={region.slug}>
                                  <SelectLabel>{region.label}</SelectLabel>
                                  {regionLocations.map((loc) => {
                                    const countryLabel = loc.country && loc.country !== "Unknown"
                                      ? loc.country
                                      : region.label;
                                    return (
                                      <SelectItem key={loc.slug} value={loc.slug}>
                                        {loc.name} - {countryLabel}
                                      </SelectItem>
                                    );
                                  })}
                                </SelectGroup>
                              );
                            })}
                          </SelectContent>
                        </Select>
                        {getFieldConfig("location").helper_text && (
                          <p className="text-sm text-muted-foreground">{getFieldConfig("location").helper_text}</p>
                        )}
                        <FormMessage className="text-white bg-destructive/90 px-2 py-0.5 rounded text-xs inline-block" />
                      </FormItem>
                    )}
                  />
                )}
              </div>
            )}

            {getFieldConfig("program").visible && (
              <FormField
                control={form.control}
                name="program"
                rules={{ required: getFieldConfig("program").required ? (locale === "es" ? "Programa requerido" : "Program is required") : false }}
                render={({ field }) => (
                  <FormItem>
                    {getFieldConfig("program").show_label && (
                      <FormLabel>{getFieldConfig("program").label || (locale === "es" ? "Programa" : "Program")}</FormLabel>
                    )}
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-program">
                          <SelectValue placeholder={locale === "es" ? "Selecciona un programa" : "Select a program"} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {visiblePrograms.map((program) => (
                          <SelectItem key={program.slug} value={program.bc_slug || program.slug}>
                            {program.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {getFieldConfig("program").helper_text && (
                      <p className="text-sm text-muted-foreground">{getFieldConfig("program").helper_text}</p>
                    )}
                    <FormMessage className="text-white bg-destructive/90 px-2 py-0.5 rounded text-xs inline-block" />
                  </FormItem>
                )}
              />
            )}

            {getFieldConfig("coupon").visible && (
              <FormField
                control={form.control}
                name="coupon"
                render={({ field }) => (
                  <FormItem>
                    {getFieldConfig("coupon").show_label && (
                      <FormLabel>{getFieldConfig("coupon").label || (locale === "es" ? "Código de cupón" : "Coupon Code")}</FormLabel>
                    )}
                    <FormControl>
                      <Input 
                        placeholder={getFieldConfig("coupon").placeholder || (locale === "es" ? "Código de cupón" : "Coupon Code")}
                        {...field} 
                        data-testid="input-coupon" 
                      />
                    </FormControl>
                    {getFieldConfig("coupon").helper_text && (
                      <p className="text-sm text-muted-foreground">{getFieldConfig("coupon").helper_text}</p>
                    )}
                    <FormMessage className="text-white bg-destructive/90 px-2 py-0.5 rounded text-xs inline-block" />
                  </FormItem>
                )}
              />
            )}
          </div>

          {getFieldConfig("client_comments").visible && (
            <FormField
              control={form.control}
              name="client_comments"
              render={({ field }) => (
                <FormItem>
                  {getFieldConfig("client_comments").show_label && (
                    <FormLabel>{getFieldConfig("client_comments").label || (locale === "es" ? "Comentarios" : "Comments")}</FormLabel>
                  )}
                  <FormControl>
                    <Textarea 
                      className="min-h-[100px]" 
                      placeholder={getFieldConfig("client_comments").placeholder || (locale === "es" ? "Comentarios" : "Comments")}
                      rows={getFieldConfig("client_comments").rows}
                      {...field} 
                      data-testid="textarea-client-comments"
                    />
                  </FormControl>
                  {getFieldConfig("client_comments").helper_text && (
                    <p className="text-sm text-muted-foreground">{getFieldConfig("client_comments").helper_text}</p>
                  )}
                  <FormMessage className="text-white bg-destructive/90 px-2 py-0.5 rounded text-xs inline-block" />
                </FormItem>
              )}
            />
          )}

          {allRequiredFieldsFilled && (consent.email || consent.sms || consent.whatsapp || consent.marketing) && (
            <ConsentSection 
              consent={consent}
              form={form}
              locale={locale}
              formOptions={formOptions}
              sessionLocation={sessionLocation}
              consentSettings={consentSettings}
            />
          )}

          {turnstileEnabled && turnstileSiteKey?.siteKey && showTurnstileModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
              <div className="bg-card p-6 rounded-card shadow-card">
                <Turnstile
                  siteKey={turnstileSiteKey.siteKey}
                  onSuccess={(token: string) => setTurnstileToken(token)}
                  onError={() => {
                    setTurnstileError(locale === "es" ? "Error de verificación" : "Verification error");
                    setShowTurnstileModal(false);
                    setPendingFormData(null);
                  }}
                  onExpire={() => setTurnstileToken(null)}
                  options={{
                    theme: data.turnstile?.theme || "auto",
                    size: data.turnstile?.size || "normal",
                  }}
                />
              </div>
            </div>
          )}

          {turnstileError && (
            <p className="text-sm text-destructive text-center" data-testid="text-turnstile-error">
              {turnstileError}
            </p>
          )}

          <Button 
            type="submit" 
            className={`w-full ${data.button_className || ""}`}
            disabled={submitMutation.isPending}
            data-testid="button-submit"
          >
            {submitMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              data.submit_label || (locale === "es" ? "Enviar" : "Submit")
            )}
          </Button>

          {showTerms && (
            <p className={`text-xs text-center ${data.terms_className || "text-muted-foreground"}`} style={termsStyle} data-testid="text-terms">
              {locale === "es" ? "Al registrarte, aceptas los " : "By signing up, you agree to the "}
              <a 
                href={effectiveTermsUrl || legalSettings?.legal_terms_url || (locale === "es" ? "/es/terminos-y-condiciones" : "/en/terms-conditions")} 
                className="underline hover:text-foreground"
                target="_blank"
                rel="noopener noreferrer"
                data-testid="link-terms"
              >
                {locale === "es" ? "Términos y Condiciones" : "Terms and Conditions"}
              </a>
              {locale === "es" ? " y la " : " and "}
              <a 
                href={effectivePrivacyUrl || legalSettings?.legal_privacy_url || (locale === "es" ? "/es/politicas-de-privacidad" : "/en/privacy-policy")} 
                className="underline hover:text-foreground"
                target="_blank"
                rel="noopener noreferrer"
                data-testid="link-privacy"
              >
                {locale === "es" ? "Política de Privacidad" : "Privacy Policy"}
              </a>
            </p>
          )}
        </form>
      </Form>
    </div>
  );
}
