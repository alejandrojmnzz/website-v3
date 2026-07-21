/**
 * Phase-driven title/subtitle/submit copy for LeadForm signup flows.
 *
 * Prefer nested YAML under `messages` (guest / login / incomplete / ready).
 * Top-level title/subtitle/submit_label remain as guest fallbacks for older forms.
 */

export type LeadFormPhase =
  | "guest_signup"
  | "login"
  | "logged_in_incomplete"
  | "logged_in_ready";

export type LeadFormLocale = "en" | "es";

export interface LeadFormCopyBlock {
  title?: string;
  subtitle?: string;
  submit_label?: string;
  back_label?: string;
}

export interface LeadFormMessages {
  guest?: LeadFormCopyBlock;
  login?: LeadFormCopyBlock;
  incomplete?: LeadFormCopyBlock;
  ready?: LeadFormCopyBlock;
}

export interface LeadFormCopySource {
  title?: string;
  subtitle?: string;
  submit_label?: string;
  messages?: LeadFormMessages;
  /** @deprecated Prefer `messages.login`. Kept as a fallback for older YAML. */
  login?: LeadFormCopyBlock;
}

export interface ResolvedLeadFormCopy {
  title: string | undefined;
  subtitle: string | undefined;
  submit_label: string;
  back_label?: string;
}

export function resolveLeadFormPhase(opts: {
  isSignup: boolean;
  loginMode: boolean;
  isLoggedIn: boolean;
  /** True when every currently visible field has a value (not only required ones). */
  allVisibleFieldsFilled: boolean;
}): LeadFormPhase {
  if (!opts.isSignup) return "guest_signup";
  if (opts.loginMode) return "login";
  if (!opts.isLoggedIn) return "guest_signup";
  return opts.allVisibleFieldsFilled ? "logged_in_ready" : "logged_in_incomplete";
}

const DEFAULTS: Record<
  LeadFormPhase,
  Record<LeadFormLocale, { title: string; subtitle: string; submit_label: string; back_label?: string }>
> = {
  guest_signup: {
    en: {
      title: "Create your account",
      subtitle: "Sign up to get started — if you're already logged in, we'll skip fields we already know",
      submit_label: "Submit",
    },
    es: {
      title: "Crea tu cuenta",
      subtitle: "Regístrate para comenzar — si ya iniciaste sesión, omitiremos los campos que ya conocemos",
      submit_label: "Enviar",
    },
  },
  login: {
    en: {
      title: "Log in",
      subtitle: "Use your 4Geeks account to continue",
      submit_label: "Log in",
      back_label: "Back to create account",
    },
    es: {
      title: "Inicia sesión",
      subtitle: "Usa tu cuenta 4Geeks para continuar",
      submit_label: "Iniciar sesión",
      back_label: "Volver a crear cuenta",
    },
  },
  logged_in_incomplete: {
    en: {
      title: "Almost there",
      subtitle: "We still need a couple of details to finish.",
      submit_label: "Continue",
    },
    es: {
      title: "Casi listo",
      subtitle: "Todavía nos faltan un par de detalles para terminar.",
      submit_label: "Continuar",
    },
  },
  logged_in_ready: {
    en: {
      title: "You're all set",
      subtitle: "Confirm to continue — we already have everything we need.",
      submit_label: "Confirm",
    },
    es: {
      title: "Todo listo",
      subtitle: "Confirma para continuar — ya tenemos todo lo que necesitamos.",
      submit_label: "Confirmar",
    },
  },
};

/**
 * Resolve display copy for the current form phase.
 *
 * Guest: `messages.guest` → top-level title/subtitle/submit_label → submit default only
 * (empty title/subtitle stay hidden when omitted).
 * Other phases: `messages.<phase>` → locale defaults (guest title/submit as soft fallback).
 */
export function resolveLeadFormCopy(
  phase: LeadFormPhase,
  data: LeadFormCopySource,
  locale: LeadFormLocale,
): ResolvedLeadFormCopy {
  const defaults = DEFAULTS[phase][locale];
  const messages = data.messages || {};

  if (phase === "guest_signup") {
    const block = messages.guest || {};
    return {
      title: block.title ?? data.title,
      subtitle: block.subtitle ?? data.subtitle,
      submit_label: block.submit_label || data.submit_label || defaults.submit_label,
    };
  }

  if (phase === "login") {
    const block = messages.login || data.login || {};
    return {
      title: block.title || defaults.title,
      subtitle: block.subtitle || defaults.subtitle,
      submit_label: block.submit_label || defaults.submit_label,
      back_label: block.back_label || defaults.back_label,
    };
  }

  const block =
    phase === "logged_in_incomplete"
      ? messages.incomplete || {}
      : messages.ready || {};
  return {
    title: block.title || messages.guest?.title || data.title || defaults.title,
    subtitle: block.subtitle || defaults.subtitle,
    submit_label:
      block.submit_label ||
      messages.guest?.submit_label ||
      data.submit_label ||
      defaults.submit_label,
  };
}
