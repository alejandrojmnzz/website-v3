/**
 * Shared icon name normalization (no React / no lucide imports).
 * Used by the public runtime (`icons.ts`) and `scripts/generate-icon-map.ts`.
 */

/** PascalCase names backed by @/components/custom-icons (also in picker list). */
export const CUSTOM_ICON_NAMES = [
  "Rigobot",
  "RigobotIconTiny",
  "Briefcase",
  "ChecklistVerify",
  "CodeWindow",
  "Contract",
  "FolderCheck",
  "Graduation",
  "GrowthChart",
  "HandsGroup",
  "Handshake",
  "Interview",
  "JobSearch",
  "Matplotlib",
  "Mentor2",
  "Monitor",
  "Optimization",
  "PeopleGroup",
  "Rocket",
  "Security",
  "Slack",
  "BrandSlack",
  "StairsWithFlag",
  "Target",
  "4GeeksAvatar",
  "CustomTarget",
] as const;

/** Legacy Tabler-style names (Icon-prefixed) in YAML → Lucide export names. */
export const TABLER_TO_LUCIDE: Record<string, string> = {
  IconRocket: "Rocket",
  IconUsers: "Users",
  Briefcase: "Briefcase",
  IconShield: "Shield",
  IconMinus: "Minus",
  IconHeart: "Heart",
  IconHome: "Home",
  IconMap: "Map",
  IconGlobe: "Globe",
  IconDownload: "Download",
  IconShare: "Share2",
  IconLock: "Lock",
  IconLockOpen: "LockOpen",
  IconKey: "Key",
  IconUserPlus: "UserPlus",
  IconUserCheck: "UserCheck",
  IconCreditCard: "CreditCard",
  IconWallet: "Wallet",
  IconCash: "Banknote",
  IconCoin: "Coins",
  IconCurrency: "DollarSign",
  IconCurrencyDollar: "DollarSign",
  IconCurrencyEuro: "Euro",
  IconReceipt: "Receipt",
  IconCalculator: "Calculator",
  IconChart: "BarChart2",
  IconChartBar: "BarChart2",
  IconChartLine: "LineChart",
  IconChartPie: "PieChart",
  IconAdjustmentsHorizontal: "Settings2",
  IconLayoutKanban: "Kanban",
  IconTerminal2: "Terminal",
  IconShieldLock: "ShieldCheck",
  IconMath: "Sigma",
  IconPresentation: "Presentation",
  IconTransfer: "ArrowLeftRight",
  IconDiscount: "BadgePercent",
  IconBrandLinkedin: "Linkedin",
  IconBriefcase: "Briefcase",
  IconClock: "Clock",
  IconCode: "Code",
  IconMail: "Mail",
  IconStar: "Star",
  IconTrendingUp: "TrendingUp",
  IconBrain: "Brain",
  IconTrendingDown: "TrendingDown",
  IconTarget: "Target",
  IconAward: "Trophy",
  IconTrophy: "Trophy",
  IconMedal: "Medal",
  IconCertificate: "Award",
  IconBadge: "Badge",
  IconBookmark: "Bookmark",
  IconTags: "Tags",
  IconFileText: "FileText",
  IconClipboard: "Clipboard",
  IconNotes: "NotebookPen",
  IconArchive: "Archive",
  IconRotate: "RotateCw",
  IconRepeat: "Repeat",
  IconMenu: "Menu",
  IconSort: "ArrowUpDown",
  IconZoomIn: "ZoomIn",
  IconZoomOut: "ZoomOut",
  IconMaximize: "Maximize2",
  IconMinimize: "Minimize2",
  IconFullscreen: "Maximize",
  IconMessage: "MessageSquare",
  IconMessages: "MessagesSquare",
  IconBell: "Bell",
  IconBellRinging: "BellRing",
  IconHelp: "HelpCircle",
  IconBulb: "Lightbulb",
  IconLightbulb: "Lightbulb",
  IconFlame: "Flame",
  IconBolt: "Zap",
  IconZap: "Zap",
  IconServer: "Server",
  IconDevices: "Laptop",
  IconDeviceTablet: "Tablet",
  IconHeadphones: "Headphones",
  IconHeadset: "Headset",
  IconMicrophone: "Mic",
  IconVolume: "Volume2",
  IconVolumeOff: "VolumeX",
  IconWifi: "Wifi",
  IconSun: "Sun",
  IconMoon: "Moon",
  IconSchool: "School",
  IconNotebook: "Notebook",
  IconBackpack: "Backpack",
  IconGraduationCap: "GraduationCap",
  IconRobot: "Bot",
  IconActivity: "Activity",
  IconPulse: "Activity",
  IconApi: "Webhook",
  IconBrandPython: "Code",
  IconBrandJavascript: "Code",
  IconBrandTypescript: "Code",
  IconBrandHtml5: "Code",
  IconBrandCss3: "Code",
  IconBrandReact: "Code",
  IconBrandNextjs: "Code",
  IconBrandNodejs: "Server",
  IconBrandNpm: "Package",
  IconBrandBun: "Package",
  IconBrandTailwind: "Palette",
  IconBrandBootstrap: "Code",
  IconBrandSass: "Code",
  IconBrandVue: "Code",
  IconBrandAngular: "Code",
  IconBrandSvelte: "Code",
  IconBrandDeno: "Server",
  IconBrandRust: "Code",
  IconBrandGolang: "Code",
  IconBrandSwift: "Code",
  IconBrandKotlin: "Code",
  IconBrandPhp: "Code",
  IconBrandLaravel: "Code",
  IconBrandDjango: "Code",
  IconBrandFlask: "Code",
  IconBrandOpenai: "Sparkles",
  IconBrandAws: "Cloud",
  IconBrandAzure: "Cloud",
  IconBrandGoogleCloud: "Cloud",
  IconBrandFirebase: "Flame",
  IconBrandVercel: "Globe",
  IconBrandCloudflare: "Shield",
  IconBrandDigitalocean: "Cloud",
  IconBrandMongodb: "Database",
  IconBrandMysql: "Database",
  IconBrandSupabase: "Database",
  IconBrandPrisma: "Database",
  IconBrandGitlab: "GitBranch",
  IconBrandBitbucket: "GitBranch",
  IconBrandGit: "Git",
  IconBrandDocker: "Container",
  IconBrandKubernetes: "Cloud",
  IconBrandTerraform: "Layers",
  IconBrandVscode: "Code",
  IconBrandFigma: "Figma",
  IconBrandSketch: "PenTool",
  IconBrandNotion: "FileText",
  IconBrandTwitter: "Twitter",
  IconBrandX: "X",
  IconBrandFacebook: "Facebook",
  IconBrandInstagram: "Instagram",
  IconBrandYoutube: "Youtube",
  IconBrandTiktok: "Video",
  IconBrandDiscord: "MessageCircle",
  IconBrandSlack: "MessageSquare",
  IconBrandZoom: "Video",
  IconBrandTelegram: "Send",
  IconBrandWhatsapp: "MessageCircle",
  IconBrandSpotify: "Music",
  IconBrandReddit: "MessageSquare",
  IconBrandGoogle: "Globe",
  IconBrandApple: "Apple",
  IconBrandMicrosoft: "Monitor",
  IconBrandMeta: "Globe",
  IconBrandAmazon: "ShoppingCart",
  IconBrandNetflix: "Tv",
  IconBrandPaypal: "CreditCard",
  IconBrandStripe: "CreditCard",
  IconBrandShopify: "ShoppingBag",
  IconBrandWordpress: "Globe",
  IconBrandMedium: "FileText",
};

/** Small allowlist of Lucide slugs (kebab-case) for CMS validation / docs. */
export const CURATED_LUCIDE_ICONS = [
  "circle-dollar-sign",
  "briefcase-business",
  "bot",
  "brain",
  "book-open",
  "check",
  "code-xml",
  "dumbbell",
  "globe",
  "mail",
  "lock-open",
  "lock",
  "trending-up",
  "user",
  "share",
  "puzzle",
  "link",
  "key-round",
  "clock",
  "chart-no-axes-combined",
  "notebook-pen",
] as const;

/** @deprecated Use CURATED_LUCIDE_ICONS */
export const TABLER_ICON_NAMES = CURATED_LUCIDE_ICONS;

/** Lucide slug → React export (e.g. circle-dollar-sign → CircleDollarSign). */
export function kebabToPascal(kebab: string): string {
  return kebab
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}

/** React export → lucide.dev slug (e.g. CircleDollarSign → circle-dollar-sign, BarChart2 → bar-chart-2). */
export function pascalToKebab(pascal: string): string {
  return pascal
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-zA-Z])(\d+)/g, "$1-$2")
    .toLowerCase();
}

/**
 * Normalize YAML/picker icon strings for loading.
 * - "circle-dollar-sign" → CircleDollarSign (Lucide)
 * - "Rocket" / "rocket" → Rocket (Lucide or custom if listed)
 * - "IconRocket" → TABLER_TO_LUCIDE lookup, else strip "Icon" prefix
 * - "Rigobot" → custom (isCustom: true)
 */
export function normalizeIconNameForLoad(
  name: string,
): { normalized: string; isCustom: boolean } {
  if (!name) return { normalized: "", isCustom: false };

  const trimmed = name.trim();
  const capitalizedName = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);

  if ((CUSTOM_ICON_NAMES as readonly string[]).includes(capitalizedName)) {
    return { normalized: capitalizedName, isCustom: true };
  }

  if (trimmed.startsWith("Icon")) {
    const lucideName = TABLER_TO_LUCIDE[trimmed];
    if (lucideName) return { normalized: lucideName, isCustom: false };
    return { normalized: trimmed.slice(4), isCustom: false };
  }

  if (trimmed.includes("-")) {
    return { normalized: kebabToPascal(trimmed), isCustom: false };
  }

  return { normalized: capitalizedName, isCustom: false };
}
