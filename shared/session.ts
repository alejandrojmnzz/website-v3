export interface Location {
  slug: string;
  name: string;
  city: string;
  country: string;
  country_code: string;
  latitude: number;
  longitude: number;
  region: 'usa-canada' | 'latam' | 'europe' | 'online';
  default_language: 'en' | 'es';
  timezone: string;
  visibility: 'listed' | 'unlisted';
  phone?: string;
  address?: string;
  reliable?: boolean;
}

export interface UTMParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  utm_url?: string;
  utm_placement?: string;
  utm_plan?: string;
  // Normalized PPC tracking ID (captures gclid, fbclid, msclkid, ttclid, etc.)
  ppc_tracking_id?: string;
  // Referral tracking
  ref?: string;
  referral?: string;
  coupon?: string;
}

export interface GeoData {
  city?: string;
  country?: string;
  country_code?: string;
  region?: string;
  timezone?: string;
  latitude?: number;
  longitude?: number;
}

export interface DeviceData {
  deviceCategory: 'mobile' | 'tablet' | 'desktop';
  osFamily: string;
  browserFamily: string;
  viewportWidth: number;
  viewportHeight: number;
  screenWidth: number;
  screenHeight: number;
  devicePixelRatio: number;
  orientation: 'portrait' | 'landscape';
}

export interface Session {
  version: number;
  initialized: boolean;
  userId?: string;
  location: Location | null;
  language: 'en' | 'es';
  browserLang: string | null;
  geo: GeoData | null;
  utm: UTMParams;
  device?: DeviceData;
  /** First-touch pathname; write-once. */
  landing_page?: string;
  /** Pathname of the latest successful conversion. */
  conversion_page?: string;
  consent: {
    geolocation: boolean | null;
  };
  timestamp: number;
}

/** @deprecated Legacy localStorage key; consumer session now lives in cookie `4g_ctx`. */
export const SESSION_STORAGE_KEY = '4geeks_session';
export const SESSION_COOKIE_NAME = '4g_ctx';
export const CONSUMER_TOKEN_COOKIE_NAME = '4g_tok';
export const SESSION_VERSION = 4;

export const defaultSession: Session = {
  version: SESSION_VERSION,
  initialized: false,
  userId: undefined,
  location: null,
  language: 'en',
  browserLang: null,
  geo: null,
  utm: {},
  landing_page: undefined,
  conversion_page: undefined,
  consent: {
    geolocation: null,
  },
  timestamp: Date.now(),
};

export interface WorkerMessage {
  type: 'INIT_SESSION';
  payload: {
    cachedSession: Session | null;
    path: string;
    search: string;
    navigator: string;
    device: string; // JSON stringified device info from main thread
    existingUserId?: string; // 4g_user_id cookie value read by main thread
  };
}

export interface WorkerResponse {
  type: 'SESSION_READY';
  payload: Session;
}
