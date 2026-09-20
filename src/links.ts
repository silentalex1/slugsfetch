export type Platform =
  | "youtube"
  | "spotify"
  | "tiktok"
  | "twitter"
  | "instagram"
  | "vimeo"
  | "soundcloud"
  | "twitch"
  | "reddit"
  | "pinterest"
  | "snapchat"
  | "facebook"
  | "bilibili"
  | "rutube"
  | "vk"
  | "loom"
  | "unknown";

export type MediaKind = "video" | "audio" | "playlist" | "mixed" | "unknown";

export interface ParsedLink {
  platform: Platform;
  kind: MediaKind;
  id: string | null;
  title: string;
  isShort: boolean;
  raw: string;
}

const PATTERNS: { platform: Platform; re: RegExp; kind: MediaKind; group: number }[] = [
  { platform: "youtube", re: /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/|youtube\.com\/live\/)([\w-]{11})/, kind: "video", group: 1 },
  { platform: "youtube", re: /youtube\.com\/playlist\?list=([\w-]+)/, kind: "playlist", group: 1 },
  { platform: "youtube", re: /music\.youtube\.com\/watch\?v=([\w-]{11})/, kind: "audio", group: 1 },
  { platform: "spotify", re: /open\.spotify\.com\/(track|album|playlist|episode|show)\/([\w]+)/, kind: "audio", group: 2 },
  { platform: "spotify", re: /spotify\.link\/([\w]+)/, kind: "audio", group: 1 },
  { platform: "tiktok", re: /tiktok\.com\/@[\w.\-]+\/video\/(\d+)/, kind: "video", group: 1 },
  { platform: "tiktok", re: /(?:vm|vt)\.tiktok\.com\/([\w]+)/, kind: "video", group: 1 },
  { platform: "tiktok", re: /tiktok\.com\/t\/([\w]+)/, kind: "video", group: 1 },
  { platform: "twitter", re: /(?:twitter|x)\.com\/[\w]+\/status\/(\d+)/, kind: "video", group: 1 },
  { platform: "twitter", re: /(?:twitter|x)\.com\/i\/status\/(\d+)/, kind: "video", group: 1 },
  { platform: "instagram", re: /instagram\.com\/(?:reel|reels|p|tv|stories)\/([\w-]+)/, kind: "video", group: 1 },
  { platform: "vimeo", re: /vimeo\.com\/(?:video\/)?(\d+)/, kind: "video", group: 1 },
  { platform: "soundcloud", re: /soundcloud\.com\/([\w-]+\/[\w-]+)/, kind: "audio", group: 1 },
  { platform: "soundcloud", re: /on\.soundcloud\.com\/([\w]+)/, kind: "audio", group: 1 },
  { platform: "twitch", re: /twitch\.tv\/videos\/(\d+)/, kind: "video", group: 1 },
  { platform: "twitch", re: /clips\.twitch\.tv\/([\w-]+)/, kind: "video", group: 1 },
  { platform: "twitch", re: /twitch\.tv\/[\w]+\/clip\/([\w-]+)/, kind: "video", group: 1 },
  { platform: "reddit", re: /reddit\.com\/r\/[\w]+\/comments\/([\w]+)/, kind: "video", group: 1 },
  { platform: "reddit", re: /v\.redd\.it\/([\w]+)/, kind: "video", group: 1 },
  { platform: "pinterest", re: /pinterest\.[\w.]+\/pin\/([\w-]+)/, kind: "video", group: 1 },
  { platform: "pinterest", re: /pin\.it\/([\w]+)/, kind: "video", group: 1 },
  { platform: "snapchat", re: /snapchat\.com\/(?:add|spotlight|p)\/([\w-]+)/, kind: "video", group: 1 },
  { platform: "facebook", re: /facebook\.com\/(?:watch\/?\?v=|reel\/|[\w.]+\/videos\/|share\/v\/|share\/r\/)(\d+)/, kind: "video", group: 1 },
  { platform: "facebook", re: /fb\.watch\/([\w-]+)/, kind: "video", group: 1 },
  { platform: "bilibili", re: /bilibili\.com\/video\/(BV[\w]+|av\d+)/, kind: "video", group: 1 },
  { platform: "bilibili", re: /b23\.tv\/([\w]+)/, kind: "video", group: 1 },
  { platform: "rutube", re: /rutube\.ru\/(?:video|shorts)\/([\w]+)/, kind: "video", group: 1 },
  { platform: "vk", re: /vk\.com\/(?:video|clip|wall)[\w-]*(-?\d+_\d+)/, kind: "video", group: 1 },
  { platform: "loom", re: /loom\.com\/(?:share|v)\/([\w-]+)/, kind: "video", group: 1 },
];

const HOST_PLATFORMS: { search: string; platform: Platform; kind: MediaKind }[] = [
  { search: "youtube", platform: "youtube", kind: "video" },
  { search: "youtu.be", platform: "youtube", kind: "video" },
  { search: "spotify", platform: "spotify", kind: "audio" },
  { search: "tiktok", platform: "tiktok", kind: "video" },
  { search: "twitter", platform: "twitter", kind: "video" },
  { search: "x.com", platform: "twitter", kind: "video" },
  { search: "t.co", platform: "twitter", kind: "video" },
  { search: "instagram", platform: "instagram", kind: "video" },
  { search: "instagr.am", platform: "instagram", kind: "video" },
  { search: "vimeo", platform: "vimeo", kind: "video" },
  { search: "soundcloud", platform: "soundcloud", kind: "audio" },
  { search: "twitch", platform: "twitch", kind: "video" },
  { search: "reddit", platform: "reddit", kind: "video" },
  { search: "redd.it", platform: "reddit", kind: "video" },
  { search: "pinterest", platform: "pinterest", kind: "video" },
  { search: "pin.it", platform: "pinterest", kind: "video" },
  { search: "snapchat", platform: "snapchat", kind: "video" },
  { search: "snap.com", platform: "snapchat", kind: "video" },
  { search: "facebook", platform: "facebook", kind: "video" },
  { search: "fb.watch", platform: "facebook", kind: "video" },
  { search: "fb.com", platform: "facebook", kind: "video" },
  { search: "bilibili", platform: "bilibili", kind: "video" },
  { search: "b23.tv", platform: "bilibili", kind: "video" },
  { search: "rutube", platform: "rutube", kind: "video" },
  { search: "vk.com", platform: "vk", kind: "video" },
  { search: "vk.ru", platform: "vk", kind: "video" },
  { search: "loom", platform: "loom", kind: "video" },
];

const PLATFORM_LABELS: Record<Platform, string> = {
  youtube: "youtube",
  spotify: "spotify",
  tiktok: "tiktok",
  twitter: "twitter / x",
  instagram: "instagram",
  vimeo: "vimeo",
  soundcloud: "soundcloud",
  twitch: "twitch",
  reddit: "reddit",
  pinterest: "pinterest",
  snapchat: "snapchat",
  facebook: "facebook",
  bilibili: "bilibili",
  rutube: "rutube",
  vk: "vk",
  loom: "loom",
  unknown: "unknown",
};

const PLATFORM_BADGE: Record<Platform, string> = {
  youtube: "YT",
  spotify: "SP",
  tiktok: "TT",
  twitter: "X",
  instagram: "IG",
  vimeo: "VM",
  soundcloud: "SC",
  twitch: "TW",
  reddit: "RD",
  pinterest: "PIN",
  snapchat: "SNAP",
  facebook: "FB",
  bilibili: "BL",
  rutube: "RT",
  vk: "VK",
  loom: "LM",
  unknown: "WEB",
};

export function platformLabel(p: Platform): string {
  return PLATFORM_LABELS[p] ?? "unknown";
}

export function platformBadge(p: Platform): string {
  return PLATFORM_BADGE[p] ?? "WEB";
}

export function parseLink(input: string): ParsedLink {
  const raw = input.trim();
  if (!raw) {
    return { platform: "unknown", kind: "unknown", id: null, title: raw, isShort: false, raw };
  }

  for (const p of PATTERNS) {
    const m = raw.match(p.re);
    if (m) {
      const id = m[p.group] ?? null;
      return {
        platform: p.platform,
        kind: p.kind,
        id,
        title: `${PLATFORM_LABELS[p.platform]} ${id ?? ""}`.trim(),
        isShort: p.platform === "youtube" && raw.includes("/shorts/"),
        raw,
      };
    }
  }

  let host = "unknown";
  try {
    const u = new URL(raw);
    host = u.hostname.toLowerCase().replace(/^www\./, "");
    for (const hp of HOST_PLATFORMS) {
      if (host.includes(hp.search)) {
        return {
          platform: hp.platform,
          kind: hp.kind,
          id: null,
          title: `${PLATFORM_LABELS[hp.platform]} link`,
          isShort: hp.platform === "youtube" && raw.includes("/shorts/"),
          raw,
        };
      }
    }
  } catch {
    host = raw.slice(0, 32);
  }

  return { platform: "unknown", kind: "unknown", id: null, title: host, isShort: false, raw };
}

export function extractUrls(text: string): string[] {
  const lines = text.split(/[\r\n,;]+/).map((l) => l.trim()).filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const m = line.match(/https?:\/\/[^\s"'<>]+/gi);
    if (m) {
      for (const u of m) {
        const clean = u.replace(/[.,;:!?)]+$/, "");
        if (!seen.has(clean)) {
          seen.add(clean);
          out.push(clean);
        }
      }
    } else if (/^https?:\/\//i.test(line) && !seen.has(line)) {
      seen.add(line);
      out.push(line);
    }
  }
  return out;
}

export const SUPPORTED_PLATFORMS: {
  platform: Platform;
  label: string;
  kind: MediaKind;
  needsAuth?: boolean;
}[] = [
  { platform: "youtube", label: "youtube", kind: "video" },
  { platform: "spotify", label: "spotify", kind: "audio" },
  { platform: "tiktok", label: "tiktok", kind: "video" },
  { platform: "twitter", label: "twitter / x", kind: "video" },
  { platform: "instagram", label: "instagram", kind: "video", needsAuth: true },
  { platform: "vimeo", label: "vimeo", kind: "video" },
  { platform: "soundcloud", label: "soundcloud", kind: "audio" },
  { platform: "twitch", label: "twitch", kind: "video" },
  { platform: "reddit", label: "reddit", kind: "video" },
  { platform: "pinterest", label: "pinterest", kind: "video" },
  { platform: "snapchat", label: "snapchat", kind: "video", needsAuth: true },
  { platform: "facebook", label: "facebook", kind: "video", needsAuth: true },
  { platform: "bilibili", label: "bilibili", kind: "video" },
  { platform: "rutube", label: "rutube", kind: "video" },
  { platform: "vk", label: "vk", kind: "video" },
  { platform: "loom", label: "loom", kind: "video" },
];
