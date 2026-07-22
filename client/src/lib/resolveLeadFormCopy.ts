/**
 * Phase-driven subtitle/submit copy for LeadForm signup flows.
 *
 * Nested YAML under `messages` (guest / login / incomplete / ready) carries
 * subtitles and submit labels only. The form title always comes from the
 * top-level `title`, so phase changes never swap the heading.
 */

export type LeadFormPhase =
  | "guest_signup"
  | "login"
  | "logged_in_incomplete"
  | "logged_in_ready";

export type LeadFormLocale = "en" | "es";

export interface LeadFormCopyBlock {
  /** Set to null to explicitly hide the phase subtitle. */
  subtitle?: string | null;
  submit_label?: string;
  back_label?: string;
}

export interface LeadFormMessages {
  /** Set an entire stage to null to hide its subtitle. */
  guest?: LeadFormCopyBlock | null;
  login?: LeadFormCopyBlock | null;
  incomplete?: LeadFormCopyBlock | null;
  ready?: LeadFormCopyBlock | null;
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
  Record<LeadFormLocale, { subtitle: string; submit_label: string; back_label?: string }>
> = {
  guest_signup: {
    en: {
      subtitle: "Sign up to get started — if you're already logged in, we'll skip fields we already know",
      submit_label: "Submit",
    },
    es: {
      subtitle: "Regístrate para comenzar — si ya iniciaste sesión, omitiremos los campos que ya conocemos",
      submit_label: "Enviar",
    },
  },
  login: {
    en: {
      subtitle: "Use your 4Geeks account to continue",
      submit_label: "Log in",
      back_label: "Back to create account",
    },
    es: {
      subtitle: "Usa tu cuenta 4Geeks para continuar",
      submit_label: "Iniciar sesión",
      back_label: "Volver a crear cuenta",
    },
  },
  logged_in_incomplete: {
    en: {
      subtitle: "We still need a couple of details to finish.",
      submit_label: "Continue",
    },
    es: {
      subtitle: "Todavía nos faltan un par de detalles para terminar.",
      submit_label: "Continuar",
    },
  },
  logged_in_ready: {
    en: {
      subtitle: "Confirm to continue — we already have everything we need.",
      submit_label: "Confirm",
    },
    es: {
      subtitle: "Confirma para continuar — ya tenemos todo lo que necesitamos.",
      submit_label: "Confirmar",
    },
  },
};

/**
 * Resolve display copy for the current form phase.
 *
 * Title: always the top-level `title` (hidden when omitted) — phases never
 * introduce their own heading.
 * Guest subtitle: `messages.guest` → top-level `subtitle` (hidden when both omitted).
 * Other phase subtitles: `messages.<phase>` → locale defaults.
 * A null stage or null subtitle explicitly hides that phase's subtitle.
 * Submit labels: `messages.<phase>` → top-level `submit_label` → locale defaults.
 */
export function resolveLeadFormCopy(
  phase: LeadFormPhase,
  data: LeadFormCopySource,
  locale: LeadFormLocale,
): ResolvedLeadFormCopy {
  const defaults = DEFAULTS[phase][locale];
  const messages = data.messages || {};
  const title = data.title;

  if (phase === "guest_signup") {
    const block = messages.guest;
    return {
      title,
      subtitle:
        block === null || block?.subtitle === null
          ? undefined
          : block?.subtitle ?? data.subtitle,
      submit_label: block?.submit_label || data.submit_label || defaults.submit_label,
    };
  }

  if (phase === "login") {
    const block =
      messages.login === undefined ? data.login : messages.login;
    return {
      title,
      subtitle:
        block === null || block?.subtitle === null
          ? undefined
          : block?.subtitle ?? defaults.subtitle,
      submit_label: block?.submit_label || defaults.submit_label,
      back_label: block?.back_label || defaults.back_label,
    };
  }

  const block =
    phase === "logged_in_incomplete"
      ? messages.incomplete
      : messages.ready;
  return {
    title,
    subtitle:
      block === null || block?.subtitle === null
        ? undefined
        : block?.subtitle ?? defaults.subtitle,
    submit_label:
      block?.submit_label ||
      messages.guest?.submit_label ||
      data.submit_label ||
      defaults.submit_label,
  };
}
