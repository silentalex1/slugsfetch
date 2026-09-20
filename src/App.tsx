import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Background, { defaultBg, type BgColors } from "./Background";
import {
  cn,
  Toggle,
  Segment,
  Toasts,
  ServerBanner,
  ConfirmDialog,
  QueuePanel,
  SideNav,
  MobileNav,
  BgCustomizer,
  type QueueItem,
  type QueueActions,
} from "./ui";
import SlugLogo from "./SlugLogo";
import { SlugsAiLauncher, SlugsAiWidget } from "./SlugsAI";
import type { AiSettingChange } from "./ai";
import { parseLink, platformLabel, platformBadge, extractUrls, SUPPORTED_PLATFORMS, type ParsedLink } from "./links";
import {
  downloadMedia,
  isValidMediaUrl,
  saveToDisk,
  checkHealth,
  isLocalHost,
  uploadCookies,
  clearCookies,
  getPaymentsConfig,
  startDonation,
  confirmDonation,
  formatMoney,
  claimAccount,
  fetchAccount,
  loadSession,
  saveSession,
  startSlowReverb,
  pollSlowReverb,
  pushHistory as syncHistoryToAccount,
  clearRemoteHistory,
  formatBytes,
  formatSpeed,
  formatEta,
  type DownloadMode,
  type ServerHealth,
  type PaymentsConfig,
  type DonationReceipt,
  type Account,
} from "./api";

interface HistoryItem {
  id: string;
  name: string;
  url: string;
  platform: string;
  filename: string;
  at: number;
  size?: number;
}

type Page = "save" | "remux" | "settings" | "donate" | "checkout" | "updates" | "about" | "history";
type Theme = "auto" | "light" | "dark";
type Quality = "8k" | "4k" | "1440p" | "1080p" | "720p" | "480p" | "360p" | "240p" | "144p";
type Codec = "h264+aac" | "av1+opus" | "vp9+opus";
type Container = "auto" | "mp4" | "webm" | "mkv";
type AudioFormat = "best" | "mp3" | "m4a" | "ogg" | "wav" | "opus" | "flac";
type Bitrate = "320kb/s" | "256kb/s" | "128kb/s" | "96kb/s" | "64kb/s" | "8kb/s";
type FilenameStyle = "classic" | "basic" | "pretty" | "nerdy";
type SavingMethod = "ask" | "download" | "share" | "copy";
type LocalMode = "disabled" | "preferred" | "forced";

interface Settings {
  theme: Theme;
  languageAuto: boolean;
  preferredLanguage: string;
  reduceMotion: boolean;
  reduceTransparency: boolean;
  dontOpenQueue: boolean;
  videoQuality: Quality;
  youtubeCodec: Codec;
  youtubeContainer: Container;
  allowH265: boolean;
  convertLoopingToGif: boolean;
  audioFormat: AudioFormat;
  audioBitrate: Bitrate;
  preferBetterAudio: boolean;
  preferredDub: string;
  downloadOriginalSound: boolean;
  filenameStyle: FilenameStyle;
  savingMethod: SavingMethod;
  preferredSubtitle: string;
  disableMetadata: boolean;
  localProcessing: LocalMode;
  useCustomInstance: boolean;
  useAccessKey: boolean;
  alwaysTunnel: boolean;
  dontContributeAnalytics: boolean;
  enableDebug: boolean;
  clipboardSniff: boolean;
  settingsVersion: number;
}

const SETTINGS_VERSION = 2;

const defaultSettings: Settings = {
  theme: "dark",
  languageAuto: true,
  preferredLanguage: "english",
  reduceMotion: false,
  reduceTransparency: false,
  dontOpenQueue: false,
  videoQuality: "1080p",
  youtubeCodec: "h264+aac",
  youtubeContainer: "auto",
  allowH265: false,
  convertLoopingToGif: false,
  audioFormat: "mp3",
  audioBitrate: "128kb/s",
  preferBetterAudio: false,
  preferredDub: "original",
  downloadOriginalSound: false,
  filenameStyle: "basic",
  savingMethod: "download",
  preferredSubtitle: "none",
  disableMetadata: false,
  localProcessing: "preferred",
  useCustomInstance: false,
  useAccessKey: false,
  alwaysTunnel: false,
  dontContributeAnalytics: false,
  enableDebug: false,
  clipboardSniff: true,
  settingsVersion: SETTINGS_VERSION,
};

const PERKS: { id: string; node: React.ReactNode }[] = [
  { id: "speed", node: "faster video downloads (instant)" },
  { id: "beta", node: "you get early access beta features pre-released before everyone else" },
  {
    id: "premium",
    node: (
      <>
        you get{" "}
        <a
          href="https://slugs.lol"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-500 hover:text-sky-400 underline underline-offset-2 transition-colors"
        >
          slugs.lol
        </a>{" "}
        premium - must donate above $5 for that
      </>
    ),
  },
  { id: "support", node: "faster and dedicated help if you need help." },
];

const REMUX_PROFILES = [
  { id: "mp4", label: "MP4", desc: "web & mobile", from: "mkv, mov, webm" },
  { id: "webm", label: "WebM", desc: "web streaming", from: "mp4, mov" },
  { id: "mp3", label: "MP3", desc: "audio extract", from: "mp4, wav, m4a" },
  { id: "wav", label: "WAV", desc: "archive quality", from: "mp3, m4a, opus" },
  { id: "m4a", label: "M4A", desc: "mobile audio", from: "mp3, wav" },
  { id: "mkv", label: "MKV", desc: "archiving", from: "mp4, webm" },
];

function useTheme(theme: Theme) {
  useEffect(() => {
    const root = document.documentElement;
    const apply = (dark: boolean) => {
      root.classList.toggle("dark", dark);
      root.style.colorScheme = dark ? "dark" : "light";
    };
    if (theme === "auto") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      apply(mq.matches);
      const fn = (e: MediaQueryListEvent) => apply(e.matches);
      mq.addEventListener("change", fn);
      return () => mq.removeEventListener("change", fn);
    }
    apply(theme === "dark");
  }, [theme]);

  if (typeof window !== "undefined") {
    const root = document.documentElement;
    if (theme === "auto") {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      root.classList.toggle("dark", prefersDark);
      root.style.colorScheme = prefersDark ? "dark" : "light";
    } else {
      root.classList.toggle("dark", theme === "dark");
      root.style.colorScheme = theme === "dark" ? "dark" : "light";
    }
  }
}

function readLocation() {
  return {
    path: window.location.pathname,
    hash: window.location.hash,
    search: window.location.search,
  };
}

function useRoute() {
  const [route, setRoute] = useState(readLocation);
  useEffect(() => {
    const fn = () => setRoute(readLocation());
    window.addEventListener("popstate", fn);
    window.addEventListener("hashchange", fn);
    return () => {
      window.removeEventListener("popstate", fn);
      window.removeEventListener("hashchange", fn);
    };
  }, []);
  const navigate = useCallback((to: string) => {
    const current = window.location.pathname + window.location.search + window.location.hash;
    if (to !== current) {
      window.history.pushState({}, "", to);
      setRoute(readLocation());
      window.scrollTo(0, 0);
    }
  }, []);
  return { path: route.path, hash: route.hash, search: route.search, navigate };
}

function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem("slugfetch-history");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function App() {
  const { path, hash, search, navigate } = useRoute();
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      const raw = localStorage.getItem("slugfetch-settings");
      if (!raw) return defaultSettings;
      const stored = JSON.parse(raw) as Partial<Settings>;
      const merged = { ...defaultSettings, ...stored };
      if (merged.settingsVersion !== SETTINGS_VERSION) {
        merged.savingMethod = "download";
        merged.settingsVersion = SETTINGS_VERSION;
      }
      return merged;
    } catch {
      return defaultSettings;
    }
  });
  const [url, setUrl] = useState("");
  const [batchText, setBatchText] = useState("");
  const [batchMode, setBatchMode] = useState(false);
  const [mode, setMode] = useState<DownloadMode>("auto");
  const [quality, setQuality] = useState<Quality>("1080p");
  const [audioFmt, setAudioFmt] = useState<AudioFormat>("mp3");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [mobileAudio, setMobileAudio] = useState(false);
  const [trimStart, setTrimStart] = useState("");
  const [trimEnd, setTrimEnd] = useState("");
  const [wantSubs, setWantSubs] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>(loadHistory);
  const [files, setFiles] = useState<File[]>([]);
  const [remuxTarget, setRemuxTarget] = useState("mp4");
  const [dragOver, setDragOver] = useState(false);
  const [showSupported, setShowSupported] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [parsed, setParsed] = useState<ParsedLink | null>(null);
  const [isPasting, setIsPasting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [bg, setBg] = useState<BgColors>(() => {
    try {
      const raw = localStorage.getItem("slugfetch-bg");
      return raw ? { ...defaultBg, ...JSON.parse(raw) } : defaultBg;
    } catch {
      return defaultBg;
    }
  });
  const [showBgPanel, setShowBgPanel] = useState(false);
  const [toasts, setToasts] = useState<{ id: string; text: string }[]>([]);
  const [health, setHealth] = useState<ServerHealth | null>(null);
  const [payments, setPayments] = useState<PaymentsConfig | null>(null);
  const [donateAmount, setDonateAmount] = useState(1000);
  const [donateCustom, setDonateCustom] = useState("");
  const [donateRecurring, setDonateRecurring] = useState(false);
  const [donateError, setDonateError] = useState("");
  const [receipt, setReceipt] = useState<DonationReceipt | null>(null);
  const [donateCancelled, setDonateCancelled] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [accountName, setAccountName] = useState("");
  const [accountPass, setAccountPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [confirmWipe, setConfirmWipe] = useState<null | "reset" | "clear">(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [slugsAiOpen, setSlugsAiOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const batchFileRef = useRef<HTMLInputElement>(null);
  const cookieFileRef = useRef<HTMLInputElement>(null);
  const queueRef = useRef<QueueItem[]>([]);
  const historyRef = useRef<HistoryItem[]>([]);
  const syncedRef = useRef<string>("");
  const queueLock = useRef(false);
  const abortRef = useRef<Map<string, AbortController>>(new Map());
  const pauseRef = useRef<Set<string>>(new Set());

  queueRef.current = queue;

  const page: Page =
    path === "/" ? "save" :
    path === "/remux" ? "remux" :
    path === "/history" ? "history" :
    path.startsWith("/settings") ? "settings" :
    path.startsWith("/about") ? "about" :
    path.startsWith("/updates") ? "updates" :
    path === "/donate" ? "donate" :
    path === "/checkout" ? "checkout" :
    "save";

  const setPage = (p: Page) => {
    const to: Record<Page, string> = {
      save: "/",
      remux: "/remux",
      history: "/history",
      settings: "/settings/appearance",
      donate: "/donate",
      checkout: "/checkout",
      updates: "/updates#betarelease-0.1.0",
      about: "/about/general",
    };
    navigate(to[p]);
  };

  useTheme(settings.theme);

  useEffect(() => {
    localStorage.setItem("slugfetch-settings", JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.shiftKey && e.key.toLowerCase() === "i") || (e.key === "?" && !e.ctrlKey && !e.metaKey)) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
        e.preventDefault();
        setSlugsAiOpen((v) => !v);
      }
      if (e.key === "Escape" && slugsAiOpen) setSlugsAiOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slugsAiOpen]);

  const slugsAiContext = useMemo(() => ({
    username: account?.username ?? null,
    premium: !!account?.premium,
    theme: settings.theme,
    quality: settings.videoQuality,
    audioFormat: settings.audioFormat,
    autoSave: settings.savingMethod === "download",
    apply: (change: AiSettingChange) => {
      if (change.kind === "theme" && (change.value === "dark" || change.value === "light")) {
        setSettings((s) => ({ ...s, theme: change.value as Theme }));
        return `theme → ${change.value}`;
      }
      if (change.kind === "quality" && typeof change.value === "string") {
        setSettings((s) => ({ ...s, videoQuality: change.value as Quality }));
        setQuality(change.value as Quality);
        return `quality → ${change.value}`;
      }
      if (change.kind === "audioFormat" && typeof change.value === "string") {
        setSettings((s) => ({ ...s, audioFormat: change.value as AudioFormat }));
        setAudioFmt(change.value as AudioFormat);
        return `audio format → ${change.value}`;
      }
      if (change.kind === "mobile" && change.value === true) {
        setMobileAudio(true);
        return "mobile audio on";
      }
      if (change.kind === "autoSave") {
        setSettings((s) => ({ ...s, savingMethod: change.value ? "download" : "queue" as SavingMethod }));
        return change.value ? "auto-save on" : "auto-save off";
      }
      return null;
    },
  }), [account, settings.theme, settings.videoQuality, settings.audioFormat, settings.savingMethod]);

  useEffect(() => {
    localStorage.setItem("slugfetch-bg", JSON.stringify(bg));
  }, [bg]);

  useEffect(() => {
    historyRef.current = history;
    localStorage.setItem("slugfetch-history", JSON.stringify(history.slice(0, 100)));
  }, [history]);

  useEffect(() => {
    setParsed(url.trim() ? parseLink(url) : null);
  }, [url]);

  useEffect(() => {
    setQuality(settings.videoQuality);
    setAudioFmt(settings.audioFormat);
  }, [settings.videoQuality, settings.audioFormat]);

  useEffect(() => {
    if (queue.length > 0 && !settings.dontOpenQueue) {
      document.getElementById("queue-section")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [queue.length, settings.dontOpenQueue]);

  useEffect(() => {
    if (!settings.clipboardSniff) return;
    const onFocus = async () => {
      if (document.visibilityState !== "visible") return;
      if (url.trim() || batchMode) return;
      try {
        const text = (await navigator.clipboard.readText()).trim();
        if (!text || !isValidMediaUrl(text)) return;
        const link = parseLink(text);
        if (link.platform !== "unknown") setUrl(text);
      } catch {
        void 0;
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [settings.clipboardSniff, url, batchMode]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".slugfetch-menu")) setShowMenu(false);
    };
    if (showMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showMenu]);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));

  const toast = useCallback((text: string) => {
    const id = crypto.randomUUID();
    setToasts((t) => [...t.slice(-2), { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  useEffect(() => {
    let alive = true;
    const ping = async () => {
      const h = await checkHealth();
      if (alive) setHealth(h);
    };
    void ping();
    const t = setInterval(ping, 20000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const patchQueue = useCallback((id: string, patch: Partial<QueueItem>) => {
    setQueue((q) => {
      const next = q.map((i) => (i.id === id ? { ...i, ...patch } : i));
      queueRef.current = next;
      return next;
    });
  }, []);

  const pushHistory = useCallback((item: QueueItem) => {
    setHistory((h) => {
      const entry: HistoryItem = {
        id: crypto.randomUUID(),
        name: item.name,
        url: item.url,
        platform: item.platform,
        filename: item.filename || item.name,
        at: Date.now(),
        size: item.total,
      };
      const rest = entry.url ? h.filter((x) => x.url !== entry.url) : h;
      return [entry, ...rest].slice(0, 100);
    });
  }, []);

  const processQueue = useCallback(async () => {
    if (queueLock.current) return;
    queueLock.current = true;
    try {
      while (true) {
        const next = queueRef.current.find((i) => i.status === "queued" && !pauseRef.current.has(i.id));
        if (!next) break;

        if (pauseRef.current.has(next.id)) {
          patchQueue(next.id, { status: "paused" });
          continue;
        }

        const controller = new AbortController();
        abortRef.current.set(next.id, controller);
        patchQueue(next.id, { status: "processing", progress: 0, statusText: "starting", error: undefined });

        const resolvedMode: DownloadMode =
          next.mode || (mode === "auto" ? (next.kind === "audio" ? "audio" : "auto") : mode);

        try {
          const result = await downloadMedia(
            {
              url: next.url,
              mode: resolvedMode,
              quality: next.quality || quality,
              format: next.format || audioFmt,
              container: settings.youtubeContainer,
              mobile: next.mobile ?? mobileAudio,
              bitrate: settings.audioBitrate,
              startTime: trimStart.trim() || undefined,
              endTime: trimEnd.trim() || undefined,
              subtitles: wantSubs,
              subtitleLang: settings.preferredSubtitle,
              isLocal: next.isLocal,
              localFile: next.localFile,
              localName: next.localName,
              remuxTarget: next.remuxTarget,
            },
            (info) => {
              if (pauseRef.current.has(next.id)) {
                controller.abort();
                return;
              }
              patchQueue(next.id, {
                progress: info.pct,
                statusText: info.status,
                speed: info.speed,
                eta: info.eta,
                loaded: info.loaded,
                total: info.total,
                status: "processing",
              });
            },
            controller.signal
          );

          abortRef.current.delete(next.id);

          if (pauseRef.current.has(next.id)) {
            patchQueue(next.id, { status: "paused", statusText: "paused" });
            continue;
          }

          if (result.ok) {
            const autoSave = settings.savingMethod === "download";
            const done: Partial<QueueItem> = {
              status: "done",
              progress: 100,
              fileUrl: result.fileUrl,
              filename: result.filename,
              total: result.size ?? next.total,
              loaded: result.size ?? next.total,
              statusText: autoSave ? "saved" : "ready",
              speed: 0,
              eta: 0,
              saved: autoSave,
            };
            patchQueue(next.id, done);
            pushHistory({ ...next, ...done, filename: result.filename || next.name } as QueueItem);
            if (autoSave && result.fileUrl) {
              saveToDisk(result.fileUrl, result.filename);
              toast(`saved ${result.filename || next.name}`);
            }
          } else if (result.status === "cancelled") {
            patchQueue(next.id, {
              status: pauseRef.current.has(next.id) ? "paused" : "cancelled",
              progress: 0,
              statusText: pauseRef.current.has(next.id) ? "paused" : "cancelled",
            });
          } else {
            patchQueue(next.id, { status: "error", error: result.error || "download failed", statusText: "error" });
          }
        } catch (e: unknown) {
          abortRef.current.delete(next.id);
          if (pauseRef.current.has(next.id)) {
            patchQueue(next.id, { status: "paused", statusText: "paused" });
          } else {
            const msg = e instanceof Error ? e.message : String(e);
            patchQueue(next.id, { status: "error", error: msg, statusText: "error" });
          }
        }
      }
    } finally {
      queueLock.current = false;
      if (queueRef.current.some((i) => i.status === "queued" && !pauseRef.current.has(i.id))) {
        queueMicrotask(() => {
          void processQueue();
        });
      }
    }
  }, [
    mode,
    quality,
    audioFmt,
    settings.audioBitrate,
    settings.preferredSubtitle,
    settings.savingMethod,
    settings.youtubeContainer,
    mobileAudio,
    trimStart,
    trimEnd,
    wantSubs,
    patchQueue,
    pushHistory,
    toast,
  ]);

  useEffect(() => {
    if (queue.some((i) => i.status === "queued" && !pauseRef.current.has(i.id))) {
      void processQueue();
    }
  }, [queue, processQueue]);

  const addToQueue = (link: ParsedLink, overrides?: Partial<QueueItem>) => {
    const item: QueueItem = {
      id: crypto.randomUUID(),
      name: link.title || link.raw,
      url: link.raw,
      platform: platformLabel(link.platform),
      kind: link.kind,
      progress: 0,
      status: "queued",
      mode,
      quality,
      format: audioFmt,
      mobile: mobileAudio,
      ...overrides,
    };
    setQueue((q) => {
      const next = [...q, item];
      queueRef.current = next;
      return next;
    });
  };

  const handlePaste = async () => {
    setIsPasting(true);
    try {
      const text = await navigator.clipboard.readText();
      if (batchMode) setBatchText((t) => (t ? t + "\n" + text : text));
      else setUrl(text);
    } catch {
      void 0;
    } finally {
      setIsPasting(false);
    }
  };

  const handleDownload = () => {
    if (batchMode) {
      const urls = extractUrls(batchText);
      if (!urls.length) return;
      setIsDownloading(true);
      for (const u of urls) {
        if (!isValidMediaUrl(u)) continue;
        const link = parseLink(u);
        addToQueue(link);
      }
      setBatchText("");
      setTimeout(() => setIsDownloading(false), 400);
      return;
    }
    const link = parseLink(url);
    if (!isValidMediaUrl(url)) return;
    setIsDownloading(true);
    addToQueue(link);
    setUrl("");
    setTimeout(() => setIsDownloading(false), 400);
  };

  const cancelItem = useCallback((id: string) => {
    pauseRef.current.delete(id);
    abortRef.current.get(id)?.abort();
    abortRef.current.delete(id);
    patchQueue(id, { status: 'cancelled', statusText: 'cancelled', progress: 0 });
  }, [patchQueue]);

  const pauseItem = useCallback((id: string) => {
    pauseRef.current.add(id);
    abortRef.current.get(id)?.abort();
    patchQueue(id, { status: 'paused', statusText: 'paused' });
  }, [patchQueue]);

  const resumeItem = useCallback((id: string) => {
    pauseRef.current.delete(id);
    patchQueue(id, { status: 'queued', progress: 0, statusText: 'queued', error: undefined, saved: false });
  }, [patchQueue]);

  const removeItem = useCallback((id: string) => {
    pauseRef.current.delete(id);
    abortRef.current.get(id)?.abort();
    abortRef.current.delete(id);
    setQueue((q) => {
      const next = q.filter((i) => i.id !== id);
      queueRef.current = next;
      return next;
    });
  }, []);

  const saveItem = useCallback((item: QueueItem) => {
    if (!item.fileUrl) {
      toast('that file is no longer on the server, run it again');
      return;
    }
    saveToDisk(item.fileUrl, item.filename);
    patchQueue(item.id, { saved: true, statusText: "saved" });
    toast(`saved ${item.filename || item.name}`);
  }, [patchQueue, toast]);

  const slowReverbItem = useCallback(
    async (item: QueueItem, speed: number, reverb: number) => {
      const session = loadSession();
      if (!session) {
        toast("sign in to use slow + reverb");
        return;
      }
      if (!account?.premium) {
        toast("slow + reverb is premium, donate above $5 to unlock it");
        return;
      }
      const srcJob = item.fileUrl?.match(/\/jobs\/([^/]+)\/file/)?.[1];
      if (!srcJob) {
        toast("that download is no longer on the server, run it again");
        return;
      }
      const id = crypto.randomUUID();
      const base = (item.filename || item.name).replace(/\.[^.]+$/, "");
      const next: QueueItem = {
        id,
        name: `${base} (slowed)`,
        url: "",
        platform: "slow + reverb",
        kind: "audio",
        progress: 0,
        status: "processing",
        statusText: "queued",
        mode: "audio",
      };
      setQueue((q) => {
        const nq = [next, ...q];
        queueRef.current = nq;
        return nq;
      });
      const controller = new AbortController();
      abortRef.current.set(id, controller);
      const started = await startSlowReverb({
        jobId: srcJob,
        speed,
        reverb,
        account: session.username,
        token: session.token,
      });
      if (!started.ok || !started.id) {
        abortRef.current.delete(id);
        patchQueue(id, { status: "error", error: started.error || "could not start", statusText: "error" });
        return;
      }
      const result = await pollSlowReverb(
        started.id,
        (info) => {
          patchQueue(id, {
            progress: info.pct,
            statusText: info.status,
            speed: info.speed,
            eta: info.eta,
            loaded: info.loaded,
            total: info.total,
            status: "processing",
          });
        },
        controller.signal
      );
      abortRef.current.delete(id);
      if (result.ok) {
        const autoSave = settings.savingMethod === "download";
        patchQueue(id, {
          status: "done",
          progress: 100,
          fileUrl: result.fileUrl,
          filename: result.filename,
          total: result.size,
          loaded: result.size,
          statusText: autoSave ? "saved" : "ready",
          speed: 0,
          eta: 0,
          saved: autoSave,
        });
        if (autoSave && result.fileUrl) {
          saveToDisk(result.fileUrl, result.filename);
          toast(`saved ${result.filename || next.name}`);
        }
      } else if (result.status === "cancelled") {
        patchQueue(id, { status: "cancelled", progress: 0, statusText: "cancelled" });
      } else {
        patchQueue(id, { status: "error", error: result.error || "slowdown failed", statusText: "error" });
      }
    },
    [account, patchQueue, toast, settings.savingMethod]
  );

  const clearDone = useCallback(() => {
    setQueue((q) => {
      const next = q.filter((i) => i.status !== 'done' && i.status !== 'cancelled' && i.status !== 'error');
      queueRef.current = next;
      return next;
    });
  }, []);

  const handleRemux = (list: FileList | null) => {
    if (!list?.length) return;
    const arr = Array.from(list);
    const accepted: File[] = [];

    for (const f of arr) {
      if (f.size === 0) {
        toast(`${f.name} is empty`);
        continue;
      }
      if (f.size > 3 * 1024 * 1024 * 1024) {
        toast(`${f.name} is larger than 3 GB`);
        continue;
      }
      accepted.push(f);
      const base = f.name.replace(/\.[^.]+$/, "");
      const item: QueueItem = {
        id: crypto.randomUUID(),
        name: f.name,
        url: "",
        platform: "local file",
        kind: f.type.startsWith("audio") ? "audio" : "video",
        progress: 0,
        status: "queued",
        statusText: "queued",
        total: f.size,
        isLocal: true,
        localFile: f,
        localName: `${base}.${remuxTarget}`,
        remuxTarget,
        mode: f.type.startsWith("audio") ? "audio" : "auto",
      };
      setQueue((q) => {
        const next = [...q, item];
        queueRef.current = next;
        return next;
      });
    }

    if (accepted.length) setFiles(accepted);
    if (fileRef.current) fileRef.current.value = "";
  };

  const resolvedDonation = useMemo(() => {
    if (donateCustom.trim()) {
      const dollars = Number(donateCustom);
      if (!Number.isFinite(dollars) || dollars <= 0) return null;
      const cents = Math.round(dollars * 100);
      return cents >= 100 && cents <= 999999 ? cents : null;
    }
    return donateAmount;
  }, [donateCustom, donateAmount]);

  const checkoutParams = useMemo(() => {
    const params = new URLSearchParams(search);
    const amount = Number(params.get("amount"));
    return {
      amount: Number.isFinite(amount) && amount >= 100 && amount <= 999999 ? Math.round(amount) : null,
      recurring: params.get("recurring") === "1",
    };
  }, [search]);

  const checkoutAmount = checkoutParams.amount;
  const checkoutRecurring = checkoutParams.recurring;

  useEffect(() => {
    if (page !== "donate" && page !== "checkout") return;
    let alive = true;
    void getPaymentsConfig().then((c) => {
      if (alive) setPayments(c);
    });
    return () => {
      alive = false;
    };
  }, [page]);

  useEffect(() => {
    const session = loadSession();
    if (!session) return;
    let alive = true;
    void fetchAccount(session).then(async (a) => {
      if (!alive) return;
      if (!a) {
        saveSession(null);
        return;
      }
      setAccount(a);
      setAccountName(a.username);

      const merged = await syncHistoryToAccount(session, historyRef.current);
      if (alive && merged) {
        syncedRef.current = JSON.stringify(merged);
        setHistory(merged);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!account) return;
    const session = loadSession();
    if (!session) return;

    const snapshot = JSON.stringify(history);
    if (snapshot === syncedRef.current) return;

    const timer = setTimeout(() => {
      void syncHistoryToAccount(session, history).then((merged) => {
        if (merged) syncedRef.current = JSON.stringify(merged);
      });
    }, 1200);

    return () => clearTimeout(timer);
  }, [history, account]);

  useEffect(() => {
    if (page !== "donate") return;
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    const sessionId = params.get("session_id");

    setDonateCancelled(status === "cancelled");

    if (status === "success" && sessionId) {
      let alive = true;
      void confirmDonation(sessionId).then((r) => {
        if (!alive) return;
        if (r) {
          setReceipt(r);
          if (r.paid) toast("thank you for supporting slugfetch");
        }
      });
      return () => {
        alive = false;
      };
    }
  }, [page, path, toast]);


  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.shiftKey && (e.key === "I" || e.key === "i") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const el = e.target as HTMLElement | null;
        if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
        e.preventDefault();
        setAiOpen((v) => !v);
      }
      if (e.key === "Escape") {
        setAiOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const applyAiSetting = useCallback((change: AiSettingChange): string | null => {
    if (change.kind === "theme") {
      update("theme", change.value as Theme);
      return `theme set to ${change.value}`;
    }
    if (change.kind === "quality") {
      update("videoQuality", change.value as Quality);
      setQuality(change.value as Quality);
      return `quality set to ${change.value}`;
    }
    if (change.kind === "audioFormat") {
      update("audioFormat", change.value as AudioFormat);
      setAudioFmt(change.value as AudioFormat);
      return `audio format set to ${change.value}`;
    }
    if (change.kind === "autoSave") {
      update("savingMethod", change.value ? "download" : "ask");
      return change.value ? "auto download on" : "auto download off";
    }
    if (change.kind === "mobile") {
      setMobileAudio(!!change.value);
      if (change.value) {
        setMode("audio");
        setAudioFmt("m4a");
      }
      return change.value ? "mobile audio on" : "mobile audio off";
    }
    return null;
  }, []);
  const runWipe = () => {
    const mode = confirmWipe;
    setConfirmWipe(null);
    if (!mode) return;

    for (const item of queueRef.current) {
      abortRef.current.get(item.id)?.abort();
    }
    abortRef.current.clear();
    pauseRef.current.clear();
    setQueue([]);
    queueRef.current = [];
    setHistory([]);
    setFiles([]);

    const session = loadSession();
    if (session) {
      syncedRef.current = "[]";
      void clearRemoteHistory(session);
    }

    if (mode === "reset") {
      setSettings(defaultSettings);
      localStorage.removeItem("slugfetch-settings");
      localStorage.removeItem("slugfetch-history");
      toast("settings and downloads cleared");
      return;
    }

    localStorage.clear();
    window.location.reload();
  };

  const goToCheckout = () => {
    setDonateError("");
    if (resolvedDonation == null) {
      setDonateError("enter an amount between 1 and 9,999");
      return;
    }
    navigate(`/checkout?amount=${resolvedDonation}&recurring=${donateRecurring ? "1" : "0"}`);
  };

  const handleCheckout = async () => {
    setCheckoutError("");
    const name = accountName.trim();

    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,23}$/.test(name)) {
      setCheckoutError("usernames are 3 to 24 characters, letters, numbers, dot, dash or underscore");
      return;
    }
    if (accountPass.length < 8) {
      setCheckoutError("passwords need at least 8 characters");
      return;
    }
    if (checkoutAmount == null) {
      setCheckoutError("pick an amount on the donate page first");
      return;
    }

    setCheckoutBusy(true);
    const claimed = await claimAccount(name, accountPass);
    if (!claimed.ok || !claimed.token || !claimed.account) {
      setCheckoutBusy(false);
      setCheckoutError(claimed.error || "could not create that account");
      return;
    }

    const session = { username: claimed.account.username, token: claimed.token };
    saveSession(session);
    setAccount(claimed.account);

    const merged = await syncHistoryToAccount(session, historyRef.current);
    if (merged) {
      syncedRef.current = JSON.stringify(merged);
      setHistory(merged);
    }

    const res = await startDonation({
      amount: checkoutAmount,
      currency: payments?.currency,
      recurring: checkoutRecurring,
      account: claimed.account.username,
      token: claimed.token,
    });

    if (res.ok && res.url) {
      window.location.href = res.url;
      return;
    }
    setCheckoutBusy(false);
    setCheckoutError(res.error || "could not open checkout");
  };

  const importBatchFile = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    setBatchMode(true);
    setBatchText((t) => (t ? t + "\n" + text : text));
  };

  const queueActions = useMemo<QueueActions>(
    () => ({
      save: saveItem,
      pause: pauseItem,
      resume: resumeItem,
      cancel: cancelItem,
      remove: removeItem,
      slowReverb: (item, speed, reverb) => void slowReverbItem(item, speed, reverb),
    }),
    [saveItem, pauseItem, resumeItem, cancelItem, removeItem, slowReverbItem]
  );


  const topRightMenu = (
    <div className="fixed top-3 right-4 z-40 slugfetch-menu">
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="flex items-center gap-2 h-9 px-3 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/80 backdrop-blur hover:bg-zinc-50 dark:hover:bg-zinc-900 hover:border-emerald-400 dark:hover:border-emerald-500 active:scale-95 transition-all shadow-sm cursor-pointer"
        aria-label="slugfetch menu"
      >
        <span className="text-sm font-medium">slugfetch</span>
        <svg className={`w-4 h-4 transition-transform ${showMenu ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <div
        className={cn(
          "absolute right-0 mt-2 w-80 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-md shadow-xl transition-all duration-200 ease-out origin-top-right overflow-hidden",
          showMenu ? "opacity-100 scale-100 pointer-events-auto" : "opacity-0 scale-95 pointer-events-none"
        )}
      >
        <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <p className="text-xs font-medium text-zinc-500">processing queue</p>
          {queue.length > 0 && (
            <button onClick={clearDone} className="text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
              clear done
            </button>
          )}
        </div>
        <div className="p-3 max-h-80 overflow-y-auto">
          {queue.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-6">queue is empty</p>
          ) : (
            <div className="space-y-3">
              {queue.map((item) => (
                <div key={item.id} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-100 dark:bg-zinc-800 capitalize shrink-0">{item.platform}</span>
                      <span className="truncate text-xs">{item.name}</span>
                    </div>
                    <span
                      className={cn(
                        "text-[10px] shrink-0",
                        item.status === "done" && "text-emerald-500",
                        item.status === "error" && "text-red-500",
                        item.status === "cancelled" && "text-zinc-400",
                        item.status === "paused" && "text-amber-500",
                        (item.status === "processing" || item.status === "queued") && "text-zinc-500"
                      )}
                    >
                      {item.statusText || item.status}
                    </span>
                  </div>
                  <div className="h-1 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width] duration-500 ease-out",
                        item.status === "error" ? "bg-red-500" : item.status === "done" ? "bg-emerald-500" : "bg-emerald-400"
                      )}
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                  {item.status === "processing" && (
                    <p className="text-[10px] text-zinc-400 tabular-nums">
                      {item.progress}%{item.speed ? ` · ${formatSpeed(item.speed)}` : ""}
                      {item.eta ? ` · ${formatEta(item.eta)}` : ""}
                    </p>
                  )}
                  {item.status === "done" && (
                    <div className="flex gap-1">
                      <button onClick={() => saveItem(item)} className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25 transition-colors">save</button>
                      <button onClick={() => removeItem(item.id)} className="text-[10px] px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">dismiss</button>
                    </div>
                  )}
                  {(item.status === "processing" || item.status === "queued") && (
                    <div className="flex gap-1">
                      <button onClick={() => pauseItem(item.id)} className="text-[10px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-600">pause</button>
                      <button onClick={() => cancelItem(item.id)} className="text-[10px] px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">cancel</button>
                    </div>
                  )}
                  {item.status === "paused" && (
                    <div className="flex gap-1">
                      <button onClick={() => resumeItem(item.id)} className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-600">resume</button>
                      <button onClick={() => cancelItem(item.id)} className="text-[10px] px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">cancel</button>
                    </div>
                  )}
                  {(item.status === "error" || item.status === "cancelled") && (
                    <button onClick={() => removeItem(item.id)} className="text-[10px] px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">remove</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="p-2 border-t border-zinc-200 dark:border-zinc-800 flex justify-between">
          <button onClick={() => setPage("save")} className="text-[11px] px-2 py-1 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors">home</button>
          <button onClick={() => setPage("history")} className="text-[11px] px-2 py-1 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors">history</button>
          <button onClick={() => setPage("remux")} className="text-[11px] px-2 py-1 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors">remux</button>
          <button onClick={() => setPage("settings")} className="text-[11px] px-2 py-1 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors">settings</button>
        </div>
      </div>
    </div>
  );

  if (path === "/about/terms") {
    return (
      <div className="min-h-screen text-zinc-900 dark:text-zinc-100 font-sans antialiased relative">
        <Background colors={bg} />
        {topRightMenu}
        <BgCustomizer bg={bg} setBg={setBg} defaultBg={defaultBg} open={showBgPanel} setOpen={setShowBgPanel} />
      <main className={cn("ml-14 min-h-screen relative transition-all duration-200", showBgPanel && "mr-72")}>
          <div className="max-w-2xl mx-auto py-14 px-6">
             <button onClick={() => { setPage("save"); }} className="mb-8 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              back
            </button>
            <h1 className="text-3xl font-semibold mb-2">terms of ethics of use</h1>
            <p className="text-sm text-zinc-500 mb-10">please read carefully</p>
            <div className="space-y-8 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              <section>
                <p>these terms are applicable only when using the official instance. in other cases, you may need to contact the instance hoster for accurate info.</p>
              </section>
              <section>
                <p>saving functionality simplifies downloading content from the internet and we take zero liability for what the saved content is used for.</p>
              </section>
              <section>
                <p>processing servers operate like advanced proxies and don't ever write any requested content to disk. everything is handled in RAM and permanently purged once the tunnel is completed. we have no downloading logs and cannot identify anyone.</p>
              </section>
              <section>
                <p>you (end user) are responsible for what you do with our tools, how you use and distribute resulting content. please be mindful when using content of others and always credit original creators.</p>
              </section>
            </div>
            <div className="mt-12 pt-6 border-t border-zinc-200 dark:border-zinc-800">
              <button onClick={() => setPage("save")} className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium transition-colors">
                i understand
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-zinc-900 dark:text-zinc-100 font-sans antialiased relative">
      <Background colors={bg} />
      <SideNav page={page} onNavigate={(p) => setPage(p as Page)} />
      <MobileNav page={page} onNavigate={(p) => setPage(p as Page)} />
      <MobileNav page={page} onNavigate={(p) => setPage(p as Page)} />
      {topRightMenu}
      <BgCustomizer bg={bg} setBg={setBg} defaultBg={defaultBg} open={showBgPanel} setOpen={setShowBgPanel} />
      <Toasts items={toasts} />
      <SlugsAiLauncher open={aiOpen} onOpen={() => setAiOpen(true)} />
      <SlugsAiWidget
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        context={{
          username: account?.username ?? null,
          premium: !!account?.premium,
          theme: settings.theme,
          quality,
          audioFormat: audioFmt,
          autoSave: settings.savingMethod === "download",
          apply: applyAiSetting,
        }}
      />
      <ConfirmDialog
        open={confirmWipe !== null}
        title="[ warning ]"
        message="this will clear everything, your saved converted downloads, your remix's, etc. Do you wish to continue?"
        onCancel={() => setConfirmWipe(null)}
        onConfirm={runWipe}
      />
      <main className={cn("ml-14 min-h-screen relative transition-all duration-200", showBgPanel && "mr-72")}>
        {page === "save" && (
          <div className="flex flex-col items-center justify-center min-h-screen px-4 py-16 sm:py-20 sm:px-6">
            <div className="w-full max-w-xl">
              <div className="flex flex-col items-center mb-6">
                <div className="w-28 h-28 flex items-center justify-center text-zinc-800 dark:text-zinc-200 mb-3">
                  <SlugLogo className="w-28 h-28" />
                </div>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center max-w-sm">the BEST downloadable videos and audio content.</p>
              </div>

              <ServerBanner health={health} local={isLocalHost()} />

              <div className="flex items-center justify-between mb-2">
                <button
                  onClick={() => setBatchMode((b) => !b)}
                  className={cn("text-xs px-2.5 py-1 rounded-lg transition-colors", batchMode ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800")}
                >
                  {batchMode ? "single link" : "batch mode"}
                </button>
                <button onClick={() => batchFileRef.current?.click()} className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
                  import txt/csv
                </button>
                <input ref={batchFileRef} type="file" accept=".txt,.csv,.text" className="hidden" onChange={(e) => void importBatchFile(e.target.files?.[0] || null)} />
              </div>

              {!batchMode ? (
                <div className="relative mb-4">
                  {parsed && parsed.platform !== "unknown" && (
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 z-10 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 tracking-wide">
                      {platformBadge(parsed.platform)}
                    </span>
                  )}
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleDownload();
                    }}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="paste the link here"
                    className={cn(
                      "w-full h-12 pr-[104px] rounded-2xl border bg-white/70 dark:bg-zinc-900/70 backdrop-blur text-base",
                      "border-zinc-200 dark:border-zinc-700 outline-none transition-all duration-200",
                      "hover:border-zinc-300 dark:hover:border-zinc-600",
                      "focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15",
                      parsed && parsed.platform !== "unknown" ? "pl-12" : "pl-4"
                    )}
                  />
                  <div className="absolute right-2 top-2 flex items-center gap-1">
                    {url && (
                      <button
                        onClick={() => setUrl("")}
                        aria-label="clear link"
                        className="h-8 w-8 grid place-items-center rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                    <button
                      onClick={handlePaste}
                      disabled={isPasting}
                      className={cn(
                        "h-8 px-3 rounded-lg bg-zinc-200/80 dark:bg-zinc-800 text-sm font-medium hover:bg-zinc-300 dark:hover:bg-zinc-700 active:scale-95 transition-all duration-150",
                        isPasting && "opacity-70 cursor-not-allowed"
                      )}
                    >
                      {isPasting ? "pasting" : "paste"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mb-4">
                  <textarea
                    value={batchText}
                    onChange={(e) => setBatchText(e.target.value)}
                    placeholder={"paste multiple urls, one per line\nhttps://...\nhttps://..."}
                    rows={5}
                    className="w-full p-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white/70 dark:bg-zinc-900/70 backdrop-blur focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-mono resize-y"
                  />
                  <p className="mt-1 text-[10px] text-zinc-400">{extractUrls(batchText).length} valid url(s) detected</p>
                </div>
              )}

              {parsed && isValidMediaUrl(url) && !batchMode && (
                <div className="mb-3 flex items-center gap-2 text-xs text-zinc-500">
                  <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium capitalize">{parsed.platform}</span>
                  <span className="capitalize">{parsed.kind}</span>
                  {parsed.isShort && <span className="px-2 py-0.5 rounded-md bg-zinc-200 dark:bg-zinc-800">short</span>}
                </div>
              )}
              {url.trim() && !isValidMediaUrl(url) && !batchMode && (
                <div className="mb-3 text-xs text-red-500">invalid url. please enter a valid http(s) media link.</div>
              )}

              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="inline-flex rounded-xl bg-zinc-100 dark:bg-zinc-800/80 p-0.5">
                  {(["auto", "audio", "mute"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMode(m)}
                      title={m === "auto" ? "video with sound" : m === "audio" ? "audio only" : "video without sound"}
                      className={cn(
                        "px-3.5 py-1.5 rounded-[10px] text-sm font-medium capitalize transition-all duration-200",
                        mode === m
                          ? "bg-white dark:bg-zinc-950 shadow-sm text-zinc-900 dark:text-white"
                          : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <button
                  onClick={handleDownload}
                  disabled={
                    isDownloading ||
                    (batchMode ? extractUrls(batchText).length === 0 : !isValidMediaUrl(url))
                  }
                  className={cn(
                    "h-10 px-6 rounded-xl text-white font-medium inline-flex items-center gap-2",
                    "bg-emerald-500 hover:bg-emerald-600 active:scale-[0.98]",
                    "shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30",
                    "disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none disabled:active:scale-100",
                    "transition-all duration-200"
                  )}
                >
                  {isDownloading && (
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity=".25" />
                      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                  )}
                  {isDownloading ? "queuing" : batchMode ? "queue all" : "download"}
                </button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {mode !== "audio" ? (
                  <select
                    value={quality}
                    onChange={(e) => setQuality(e.target.value as Quality)}
                    className="h-8 px-2 rounded-lg text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
                  >
                    {(["8k", "4k", "1440p", "1080p", "720p", "480p", "360p", "240p", "144p"] as Quality[]).map((q) => (
                      <option key={q} value={q}>{q}</option>
                    ))}
                  </select>
                ) : (
                  <>
                    <select
                      value={audioFmt}
                      onChange={(e) => setAudioFmt(e.target.value as AudioFormat)}
                      className="h-8 px-2 rounded-lg text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
                    >
                      {(["best", "mp3", "m4a", "ogg", "wav", "opus", "flac"] as AudioFormat[]).map((f) => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                    <select
                      value={settings.audioBitrate}
                      onChange={(e) => update("audioBitrate", e.target.value as Bitrate)}
                      className="h-8 px-2 rounded-lg text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
                    >
                      {(["320kb/s", "256kb/s", "128kb/s", "96kb/s", "64kb/s"] as Bitrate[]).map((b) => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                  </>
                )}
                <button
                  onClick={() => {
                    const next = !mobileAudio;
                    setMobileAudio(next);
                    if (next) {
                      setMode("audio");
                      setAudioFmt("m4a");
                    }
                  }}
                  title="aac in an m4a container at 44.1 kHz stereo, what iphones and android players expect"
                  className={cn(
                    "h-8 px-2.5 rounded-lg text-xs inline-flex items-center gap-1.5 transition-all duration-200",
                    mobileAudio
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/40"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  )}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <rect x="7" y="2.5" width="10" height="19" rx="2.5" strokeWidth={2} />
                    <path strokeLinecap="round" strokeWidth={2} d="M11 18.5h2" />
                  </svg>
                  mobile
                </button>
                <button
                  onClick={() => setShowAdvanced((s) => !s)}
                  className="h-8 px-2.5 rounded-lg text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                >
                  {showAdvanced ? "hide options" : "clip · subs"}
                </button>
              </div>

              {showAdvanced && (
                <div className="mt-3 p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50 space-y-3">
                  <div>
                    <p className="text-xs text-zinc-500 mb-1.5">trim / clip (optional, hh:mm:ss or seconds)</p>
                    <div className="flex gap-2">
                      <input value={trimStart} onChange={(e) => setTrimStart(e.target.value)} placeholder="start" className="flex-1 h-8 px-2 rounded-lg text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700" />
                      <input value={trimEnd} onChange={(e) => setTrimEnd(e.target.value)} placeholder="end" className="flex-1 h-8 px-2 rounded-lg text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700" />
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm">download subtitles</p>
                      <p className="text-xs text-zinc-500">embed / save .srt when available</p>
                    </div>
                    <Toggle checked={wantSubs} onChange={setWantSubs} />
                  </div>
                  {wantSubs && (
                    <select
                      value={settings.preferredSubtitle}
                      onChange={(e) => update("preferredSubtitle", e.target.value)}
                      className="w-full h-8 px-2 rounded-lg text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
                    >
                      {["none", "en", "es", "fr", "de", "pt", "ja", "ko", "zh", "ru", "ar"].map((l) => (
                        <option key={l} value={l}>{l === "none" ? "auto / any" : l}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              <div className="mt-6">
                <button
                  onClick={() => setShowSupported((s) => !s)}
                  className="w-full flex items-center justify-between gap-2 px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/70 backdrop-blur text-sm font-medium hover:border-emerald-400 dark:hover:border-emerald-500 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    supported services
                    <span className="text-xs text-zinc-400 font-normal">{SUPPORTED_PLATFORMS.length} platforms</span>
                  </span>
                  <svg className={cn("w-4 h-4 text-zinc-400 transition-transform", showSupported && "rotate-180")} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </button>
                <div className={cn("grid transition-all duration-300 ease-out", showSupported ? "grid-rows-[1fr] opacity-100 mt-2" : "grid-rows-[0fr] opacity-0")}>
                  <div className="overflow-hidden">
                    <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur">
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                        {SUPPORTED_PLATFORMS.map((p) => (
                          <span
                            key={p.platform}
                            title={p.needsAuth ? "needs your cookies.txt for private or gated posts" : undefined}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-zinc-100 dark:bg-zinc-800 capitalize hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                          >
                            <span
                              className={cn(
                                "w-1.5 h-1.5 rounded-full shrink-0",
                                p.needsAuth && !health?.cookies
                                  ? "bg-amber-400"
                                  : p.kind === "audio"
                                    ? "bg-fuchsia-500"
                                    : "bg-emerald-500"
                              )}
                            />
                            {p.label}
                          </span>
                        ))}
                      </div>
                      <p className="mt-3 text-[10px] text-zinc-400 leading-relaxed">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 align-middle mr-1" /> video
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-fuchsia-500 align-middle mx-1 ml-3" /> audio
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 align-middle mx-1 ml-3" /> needs a
                        signed-in cookies.txt (
                        <button onClick={() => setPage("settings")} className="underline underline-offset-2 hover:text-zinc-600 dark:hover:text-zinc-300">
                          set it up
                        </button>
                        )
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-center gap-3">
                <button onClick={() => setPage("remux")} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
                  <span>remux a file</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
                </button>
                <button onClick={() => setPage("history")} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
                  history
                </button>
              </div>

              <QueuePanel queue={queue} actions={queueActions} onClearDone={clearDone} premium={!!account?.premium} />

              <div className="mt-10 text-center">
                <button onClick={() => navigate("/about/terms")} className="text-xs text-zinc-400 dark:text-zinc-500 underline underline-offset-4 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
                  by continuing, to use this service. you agree to terms of ethics of use.
                </button>
              </div>
            </div>
          </div>
        )}

        {page === "remux" && (
          <div className="flex flex-col items-center justify-center min-h-screen px-4 py-12">
            <div className="w-full max-w-lg">
              <div className="mb-6 flex flex-col items-center text-center">
                <div className="w-20 flex items-center justify-center text-zinc-700 dark:text-zinc-300 mb-2">
                  <SlugLogo className="w-20 h-20" />
                </div>
                <h1 className="text-xl font-semibold">remux & convert</h1>
                <p className="text-sm text-zinc-500 mt-1">
                  ffmpeg conversion on your own slugfetch engine · nothing is sent to third parties
                </p>
              </div>

              <ServerBanner health={health} local={isLocalHost()} />

              <p className="text-xs text-zinc-500 mb-2">target format</p>
              <div className="grid grid-cols-3 gap-2 mb-4">
                {REMUX_PROFILES.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setRemuxTarget(p.id)}
                    className={cn(
                      "p-2.5 rounded-xl border text-left transition-colors",
                      remuxTarget === p.id
                        ? "border-emerald-500 bg-emerald-500/10"
                        : "border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50 hover:border-zinc-400"
                    )}
                  >
                    <p className="text-sm font-medium">{p.label}</p>
                    <p className="text-[10px] text-zinc-500">{p.desc}</p>
                  </button>
                ))}
              </div>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  handleRemux(e.dataTransfer.files);
                }}
                onClick={() => fileRef.current?.click()}
                className={cn(
                  "border-2 border-dashed rounded-2xl p-12 cursor-pointer text-center backdrop-blur transition-colors",
                  dragOver
                    ? "border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30"
                    : "border-zinc-300 dark:border-zinc-700 hover:border-emerald-500 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/20 bg-white/40 dark:bg-zinc-900/40"
                )}
              >
                <svg className="w-10 h-10 mx-auto mb-3 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                <p className="text-lg font-medium mb-1">drop files here</p>
                <p className="text-sm text-zinc-500">or click to browse · mp4, webm, mov, mkv, mp3, ogg, opus, wav, m4a</p>
                <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-2">converting to {remuxTarget.toUpperCase()}</p>
                <input ref={fileRef} type="file" multiple accept=".mp4,.webm,.mp3,.ogg,.opus,.wav,.m4a,.mov,.mkv,.avi" className="hidden" onChange={(e) => handleRemux(e.target.files)} />
              </div>

              {files.length > 0 && (
                <p className="mt-4 text-xs text-zinc-500 text-center">
                  {files.length} file{files.length > 1 ? "s" : ""} sent to convert → {remuxTarget.toUpperCase()}
                </p>
              )}

              <QueuePanel queue={queue} actions={queueActions} onClearDone={clearDone} title="conversion queue" premium={!!account?.premium} />

              <div className="mt-8 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                <div className="px-3 py-2 bg-zinc-100/80 dark:bg-zinc-900/80 text-xs font-medium">conversion matrix</div>
                <div className="divide-y divide-zinc-200 dark:divide-zinc-800 text-xs">
                  {REMUX_PROFILES.map((p) => (
                    <div key={p.id} className="flex items-center justify-between px-3 py-2">
                      <span className="text-zinc-500">{p.from}</span>
                      <span className="text-zinc-400">→</span>
                      <span className="font-medium">{p.label} · {p.desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-8 space-y-4 text-sm text-zinc-600 dark:text-zinc-400">
                <div>
                  <h4 className="font-medium text-zinc-900 dark:text-zinc-100 mb-1">what does remux do?</h4>
                  <p>
                    remux rewraps your file into another container, keeping the original streams when they already fit, and
                    re-encoding only when they don't. it fixes players that refuse a file and pulls clean audio out of video.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {page === "history" && (
          <div className="max-w-2xl mx-auto py-12 px-6">
            <div className="flex items-center justify-between mb-2">
              <h1 className="text-2xl font-semibold">history</h1>
              {history.length > 0 && (
                <button
                  onClick={() => {
                    setHistory([]);
                    localStorage.removeItem("slugfetch-history");
                    const session = loadSession();
                    if (session) {
                      syncedRef.current = "[]";
                      void clearRemoteHistory(session);
                      toast("history cleared on this device and your account");
                    }
                  }}
                  className="text-xs text-red-500 hover:underline"
                >
                  clear all
                </button>
              )}
            </div>
            <p className="text-xs text-zinc-500 mb-8 flex items-center gap-1.5">
              {account ? (
                <>
                  <svg className="w-3.5 h-3.5 text-emerald-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"
                    />
                  </svg>
                  saved to <span className="text-zinc-700 dark:text-zinc-300 font-medium">{account.username}</span>, it
                  follows you to any browser you sign in on
                </>
              ) : (
                <>this device only. it is saved to your account once you make one, and survives a cache clear.</>
              )}
            </p>

            {history.length === 0 ? (
              <p className="text-sm text-zinc-500 text-center py-16">no downloads yet. successful saves appear here.</p>
            ) : (
              <div className="space-y-2">
                {history.map((h) => (
                  <div key={h.id} className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-100 dark:bg-zinc-800 capitalize">{h.platform}</span>
                        <span className="text-sm truncate">{h.name}</span>
                      </div>
                      <p className="text-[10px] text-zinc-400 truncate">{new Date(h.at).toLocaleString()}{h.size ? ` · ${formatBytes(h.size)}` : ""}</p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {h.url.startsWith("http") && (
                        <button
                          onClick={() => {
                            setPage("save");
                            setUrl(h.url);
                            setBatchMode(false);
                          }}
                          className="px-2.5 py-1 rounded-lg text-xs bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25 transition-colors"
                        >
                          re-download
                        </button>
                      )}
                      <button
                        onClick={() => setHistory((list) => list.filter((x) => x.id !== h.id))}
                        className="px-2.5 py-1 rounded-lg text-xs bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                      >
                        remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {page === "settings" && (
          <div className="max-w-3xl mx-auto py-10 px-6">
            <h1 className="text-2xl font-semibold mb-8">settings</h1>
            <div className="space-y-10">
              <section>
                <h2 className="text-sm font-medium text-zinc-500 mb-3">appearance</h2>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm mb-2">theme</p>
                    <Segment
                      options={[
                        { id: "auto", label: "auto" },
                        { id: "light", label: "light" },
                        { id: "dark", label: "dark" },
                      ]}
                      value={settings.theme}
                      onChange={(v) => update("theme", v)}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm">clipboard auto-detect</p>
                      <p className="text-xs text-zinc-500">prefill link field when a media url is copied</p>
                    </div>
                    <Toggle checked={settings.clipboardSniff} onChange={(v) => update("clipboardSniff", v)} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm">automatic language</p>
                      <p className="text-xs text-zinc-500">use browser language when available</p>
                    </div>
                    <Toggle checked={settings.languageAuto} onChange={(v) => update("languageAuto", v)} />
                  </div>
                </div>
              </section>

              <section>
                <h2 className="text-sm font-medium text-zinc-500 mb-3">accessibility</h2>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm">reduce motion</p>
                      <p className="text-xs text-zinc-500">disable animations when possible</p>
                    </div>
                    <Toggle checked={settings.reduceMotion} onChange={(v) => update("reduceMotion", v)} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm">don't open the queue automatically</p>
                      <p className="text-xs text-zinc-500">keep queue closed when new items arrive</p>
                    </div>
                    <Toggle checked={settings.dontOpenQueue} onChange={(v) => update("dontOpenQueue", v)} />
                  </div>
                </div>
              </section>

              <section>
                <h2 className="text-sm font-medium text-zinc-500 mb-3">video</h2>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm mb-2">preferred quality</p>
                    <div className="flex flex-wrap gap-1">
                      {(["8k", "4k", "1440p", "1080p", "720p", "480p", "360p", "240p", "144p"] as Quality[]).map((q) => (
                        <button
                          key={q}
                          onClick={() => update("videoQuality", q)}
                          className={cn("px-2.5 py-1 rounded-md text-xs font-medium", settings.videoQuality === q ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "bg-zinc-100 dark:bg-zinc-800")}
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm mb-2">container</p>
                    <Segment
                      options={[
                        { id: "auto", label: "auto" },
                        { id: "mp4", label: "mp4" },
                        { id: "webm", label: "webm" },
                        { id: "mkv", label: "mkv" },
                      ]}
                      value={settings.youtubeContainer}
                      onChange={(v) => update("youtubeContainer", v)}
                    />
                  </div>
                </div>
              </section>

              <section>
                <h2 className="text-sm font-medium text-zinc-500 mb-3">audio</h2>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm mb-2">format</p>
                    <Segment
                      options={[
                        { id: "best", label: "best" },
                        { id: "mp3", label: "mp3" },
                        { id: "ogg", label: "ogg" },
                        { id: "wav", label: "wav" },
                        { id: "opus", label: "opus" },
                        { id: "flac", label: "flac" },
                      ]}
                      value={settings.audioFormat}
                      onChange={(v) => update("audioFormat", v)}
                    />
                  </div>
                  <div>
                    <p className="text-sm mb-2">bitrate</p>
                    <div className="flex flex-wrap gap-1">
                      {(["320kb/s", "256kb/s", "128kb/s", "96kb/s", "64kb/s", "8kb/s"] as Bitrate[]).map((b) => (
                        <button
                          key={b}
                          onClick={() => update("audioBitrate", b)}
                          className={cn("px-2.5 py-1 rounded-md text-xs font-medium", settings.audioBitrate === b ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "bg-zinc-100 dark:bg-zinc-800")}
                        >
                          {b}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              <section>
                <h2 className="text-sm font-medium text-zinc-500 mb-3">saving</h2>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm mb-2">when a file finishes</p>
                    <Segment
                      options={[
                        { id: "download", label: "download it" },
                        { id: "ask", label: "wait for me" },
                      ]}
                      value={settings.savingMethod === "download" ? "download" : "ask"}
                      onChange={(v) => update("savingMethod", v)}
                    />
                    <p className="text-xs text-zinc-500 mt-2">
                      {settings.savingMethod === "download"
                        ? "finished files drop straight into your browser downloads at 100%."
                        : "finished files wait in the queue until you press save."}
                    </p>
                  </div>
                </div>
              </section>

              <section>
                <h2 className="text-sm font-medium text-zinc-500 mb-3">platform sign-in</h2>
                <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50 space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm flex items-center gap-2">
                        cookies.txt
                        <span
                          className={cn(
                            "px-1.5 py-0.5 rounded text-[10px] font-medium",
                            health?.cookies
                              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                              : "bg-zinc-200 dark:bg-zinc-800 text-zinc-500"
                          )}
                        >
                          {health?.cookies ? "loaded" : "not set"}
                        </span>
                      </p>
                      <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                        instagram, facebook, snapchat and private vimeo links only open for a signed-in session. export a
                        netscape cookies.txt from a browser where you are logged in and drop it here. it stays on your own
                        machine, next to the engine.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => cookieFileRef.current?.click()}
                      className="px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-sm transition-colors"
                    >
                      {health?.cookies ? "replace file" : "load cookies.txt"}
                    </button>
                    {health?.cookies && (
                      <button
                        onClick={async () => {
                          await clearCookies();
                          setHealth(await checkHealth());
                          toast("cookies removed");
                        }}
                        className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 text-sm hover:bg-red-500/20 transition-colors"
                      >
                        remove
                      </button>
                    )}
                    <input
                      ref={cookieFileRef}
                      type="file"
                      accept=".txt,text/plain"
                      className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (f) {
                          const r = await uploadCookies(f);
                          toast(r.ok ? "cookies loaded" : r.error || "could not read that file");
                          setHealth(await checkHealth());
                        }
                        e.target.value = "";
                      }}
                    />
                  </div>
                </div>
              </section>

              <section>
                <h2 className="text-sm font-medium text-zinc-500 mb-3">advanced</h2>
                <div className="space-y-4">
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
                        const a = document.createElement("a");
                        a.href = URL.createObjectURL(blob);
                        a.download = "slugfetch-settings.json";
                        a.click();
                      }}
                      className="px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-sm"
                    >
                      export
                    </button>
                    <button
                      onClick={() => setConfirmWipe("reset")}
                      className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 text-sm hover:bg-red-500/20 transition-colors"
                    >
                      reset
                    </button>
                    <button
                      onClick={() => setConfirmWipe("clear")}
                      className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 text-sm hover:bg-red-500/20 transition-colors"
                    >
                      clear cache
                    </button>
                  </div>
                </div>
              </section>
            </div>
          </div>
        )}

        {page === "donate" && (
          <div className="max-w-2xl mx-auto py-16 px-6">
            <div className="text-center mb-10">
              <h1 className="text-3xl font-semibold mb-2">support a safe and open internet</h1>
              <p className="text-zinc-500">donate or share the joy of slugfetch with a friend</p>
            </div>

            {receipt && (
              <div
                className={cn(
                  "mb-6 p-5 rounded-2xl border text-center animate-riseIn",
                  receipt.paid
                    ? "border-emerald-400/40 bg-emerald-500/10"
                    : "border-amber-400/40 bg-amber-500/10"
                )}
              >
                {receipt.paid ? (
                  <>
                    <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-emerald-500 grid place-items-center">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <p className="font-medium">
                      thank you{receipt.amount ? ` for the ${formatMoney(receipt.amount, receipt.currency)}` : ""}
                      {receipt.recurring ? " a month" : ""}
                    </p>
                    <p className="text-xs text-zinc-500 mt-1">
                      {receipt.email ? `a receipt is on its way to ${receipt.email}.` : "a receipt has been emailed to you."}
                    </p>
                    {receipt.unlocked?.premium && (
                      <p className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-400 text-xs font-medium">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
                          />
                        </svg>
                        premium unlocked on {receipt.unlocked.username}
                      </p>
                    )}
                    {receipt.account && !receipt.unlocked?.premium && receipt.premium === false && (
                      <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
                        premium needs a donation above {formatMoney(500, receipt.currency)}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    that payment is still processing. it will finish on stripe's side, nothing more to do here.
                  </p>
                )}
                <button
                  onClick={() => {
                    setReceipt(null);
                    navigate("/donate");
                  }}
                  className="mt-3 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 underline underline-offset-4"
                >
                  close
                </button>
              </div>
            )}

            {donateCancelled && !receipt && (
              <div className="mb-6 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50 text-center text-sm text-zinc-500">
                checkout was cancelled, nothing was charged.
              </div>
            )}

            {payments && !payments.configured && (
              <div className="mb-6 px-4 py-3 rounded-xl border border-amber-400/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-xs leading-relaxed">
                payments are not wired up yet. add <span className="font-mono">STRIPE_SECRET_KEY</span> to your{" "}
                <span className="font-mono">.env</span> and restart the engine, then this form goes live.
              </div>
            )}

            {payments?.mode === "test" && (
              <div className="mb-6 px-4 py-3 rounded-xl border border-sky-400/40 bg-sky-500/10 text-sky-700 dark:text-sky-300 text-xs leading-relaxed">
                stripe test mode. real cards are declined here on purpose. use{" "}
                <span className="font-mono">4242 4242 4242 4242</span> with any future expiry and any cvc.
              </div>
            )}

            {payments?.live && payments.warnings.length > 0 && (
              <div className="mb-6 px-4 py-3 rounded-xl border border-red-400/40 bg-red-500/10 text-red-600 dark:text-red-400 text-xs leading-relaxed">
                <p className="font-medium mb-1">live mode is not set up correctly</p>
                <ul className="list-disc pl-4 space-y-1">
                  {payments.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {account && (
              <div className="mb-6 px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50 flex items-center justify-between gap-3">
                <p className="text-xs text-zinc-500 truncate">
                  signed in as <span className="text-zinc-800 dark:text-zinc-200 font-medium">{account.username}</span>
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  {account.premium && (
                    <span className="px-2 py-0.5 rounded-md bg-sky-500/15 text-sky-600 dark:text-sky-400 text-[10px] font-medium">
                      premium
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      saveSession(null);
                      setAccount(null);
                      setAccountName("");
                      setAccountPass("");
                    }}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-medium text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                  >
                    logout
                  </button>
                </div>
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-4 mb-8">
              <div className="p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50">
                <div className="flex items-center justify-between mb-4">
                  <p className="font-medium">donation</p>
                  <div className="inline-flex rounded-lg bg-zinc-100 dark:bg-zinc-800 p-0.5">
                    {([false, true] as const).map((r) => (
                      <button
                        key={String(r)}
                        onClick={() => setDonateRecurring(r)}
                        className={cn(
                          "px-2.5 py-1 text-[11px] rounded-md transition-all duration-200",
                          donateRecurring === r
                            ? "bg-white dark:bg-zinc-950 shadow-sm text-zinc-900 dark:text-white"
                            : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                        )}
                      >
                        {r ? "monthly" : "one-time"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2 mb-3">
                  {(payments?.presets || [500, 1000, 1500, 3000]).map((cents) => (
                    <button
                      key={cents}
                      onClick={() => {
                        setDonateAmount(cents);
                        setDonateCustom("");
                      }}
                      className={cn(
                        "px-2 py-2 rounded-xl text-sm font-medium border transition-all duration-200",
                        donateAmount === cents && !donateCustom
                          ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : "border-zinc-200 dark:border-zinc-800 bg-zinc-100/60 dark:bg-zinc-800/60 hover:border-zinc-300 dark:hover:border-zinc-700"
                      )}
                    >
                      {formatMoney(cents, payments?.currency)}
                    </button>
                  ))}
                </div>

                <div className="relative mb-4">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
                    {formatMoney(0, payments?.currency).replace(/[\d.,\s]/g, "") || "$"}
                  </span>
                  <input
                    value={donateCustom}
                    onChange={(e) => setDonateCustom(e.target.value.replace(/[^\d.]/g, "").slice(0, 9))}
                    inputMode="decimal"
                    placeholder="custom amount"
                    className="w-full h-10 pl-7 pr-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white/70 dark:bg-zinc-900/70 text-sm outline-none transition-all duration-200 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15"
                  />
                </div>

                {donateError && <p className="text-xs text-red-500 mb-3 leading-relaxed">{donateError}</p>}

                <button
                  onClick={goToCheckout}
                  disabled={!payments?.configured || resolvedDonation == null}
                  className={cn(
                    "w-full h-11 rounded-xl text-white font-medium inline-flex items-center justify-center gap-2",
                    "bg-emerald-500 hover:bg-emerald-600 active:scale-[0.99]",
                    "shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30",
                    "disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none disabled:active:scale-100",
                    "transition-all duration-200"
                  )}
                >
                  {resolvedDonation == null
                    ? "pick an amount"
                    : `continue with ${formatMoney(resolvedDonation, payments?.currency)}${
                        donateRecurring ? " / month" : ""
                      }`}
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </button>

                {resolvedDonation != null && resolvedDonation <= 500 && (
                  <p className="mt-2 text-[10px] text-amber-600 dark:text-amber-400 text-center leading-relaxed">
                    premium needs a donation above {formatMoney(500, payments?.currency)}
                  </p>
                )}

                <div className="mt-3 flex items-center justify-center gap-1.5 text-[10px] text-zinc-400">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                  card details are handled by stripe, never by slugfetch
                </div>
              </div>

              <div className="p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50">
                <p className="font-medium mb-3">share slugfetch</p>
                <p className="text-xs text-zinc-500 mb-4 leading-relaxed">
                  free is easier to keep free when more people use it. send a friend the link.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(window.location.origin);
                      toast("link copied");
                    }}
                    className="px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-sm transition-colors"
                  >
                    copy link
                  </button>
                  {typeof navigator !== "undefined" && "share" in navigator && (
                    <button
                      onClick={() => {
                        void navigator
                          .share({ title: "slugfetch", url: window.location.origin })
                          .catch(() => undefined);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-sm transition-colors"
                    >
                      share
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="mb-8 p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50">
              <p className="font-medium mb-4">what we offer:</p>
              <ul className="space-y-3">
                {PERKS.map((perk) => (
                  <li key={perk.id} className="flex items-start gap-2.5 text-sm text-zinc-600 dark:text-zinc-400">
                    <svg
                      className="w-4 h-4 mt-0.5 text-emerald-500 shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="leading-relaxed">{perk.node}</span>
                  </li>
                ))}
              </ul>
            </div>

            <p className="text-sm text-zinc-500 leading-relaxed text-center">
              slugfetch helps producers, educators, video makers and many others do what they love. no ads, no trackers.
            </p>
          </div>
        )}

        {page === "checkout" && (
          <div className="max-w-md mx-auto py-16 px-6">
            <button
              onClick={() => setPage("donate")}
              className="mb-8 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              back
            </button>

            <div className="text-center mb-8">
              <h1 className="text-2xl font-semibold mb-2">set up your account</h1>
              <p className="text-sm text-zinc-500 leading-relaxed">
                {checkoutAmount == null
                  ? "pick an amount on the donate page first"
                  : `premium unlocks on this account right after your ${formatMoney(
                      checkoutAmount,
                      payments?.currency
                    )}${checkoutRecurring ? " monthly" : ""} donation clears`}
              </p>
            </div>

            {checkoutAmount != null && (
              <div className="mb-6 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{checkoutRecurring ? "monthly support" : "one-time donation"}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {checkoutAmount > 500 ? "includes slugs.lol premium" : "below the premium threshold"}
                  </p>
                </div>
                <p className="text-xl font-semibold tabular-nums">
                  {formatMoney(checkoutAmount, payments?.currency)}
                  {checkoutRecurring && <span className="text-xs text-zinc-500 font-normal"> /mo</span>}
                </p>
              </div>
            )}

            {account && (
              <div className="mb-4 px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50 flex items-center justify-between gap-3">
                <p className="text-xs text-zinc-500 truncate">
                  signed in as <span className="text-zinc-800 dark:text-zinc-200 font-medium">{account.username}</span>
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  {account.premium && (
                    <span className="px-2 py-0.5 rounded-md bg-sky-500/15 text-sky-600 dark:text-sky-400 text-[10px] font-medium">
                      premium
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      saveSession(null);
                      setAccount(null);
                      setAccountName("");
                      setAccountPass("");
                    }}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-medium text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                  >
                    logout
                  </button>
                </div>
              </div>
            )}

            <div className="p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50 space-y-4">
              <div>
                <label htmlFor="account-username" className="block text-sm mb-1.5">
                  enter your account username
                </label>
                <input
                  id="account-username"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value.replace(/\s/g, "").slice(0, 24))}
                  autoComplete="username"
                  spellCheck={false}
                  placeholder="username"
                  className="w-full h-11 px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white/70 dark:bg-zinc-900/70 text-sm outline-none transition-all duration-200 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15"
                />
              </div>

              <div>
                <label htmlFor="account-password" className="block text-sm mb-1.5">
                  enter account password
                </label>
                <div className="relative">
                  <input
                    id="account-password"
                    type={showPass ? "text" : "password"}
                    value={accountPass}
                    onChange={(e) => setAccountPass(e.target.value.slice(0, 200))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleCheckout();
                    }}
                    autoComplete="new-password"
                    placeholder="at least 8 characters"
                    className="w-full h-11 pl-3 pr-16 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white/70 dark:bg-zinc-900/70 text-sm outline-none transition-all duration-200 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-7 px-2 rounded-lg text-[11px] text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    {showPass ? "hide" : "show"}
                  </button>
                </div>
              </div>

              {checkoutError && <p className="text-xs text-red-500 leading-relaxed">{checkoutError}</p>}

              <button
                onClick={handleCheckout}
                disabled={checkoutBusy || checkoutAmount == null || !payments?.configured}
                className={cn(
                  "w-full h-11 rounded-xl text-white font-medium inline-flex items-center justify-center gap-2",
                  "bg-emerald-500 hover:bg-emerald-600 active:scale-[0.99]",
                  "shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30",
                  "disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none disabled:active:scale-100",
                  "transition-all duration-200"
                )}
              >
                {checkoutBusy && (
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity=".25" />
                    <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                )}
                {checkoutBusy ? "setting things up" : "create account, continue purchase"}
              </button>

              <p className="text-[10px] text-zinc-400 leading-relaxed text-center">
                already have an account? use the same username and password and this signs you in instead.
              </p>
            </div>

            <div className="mt-4 flex items-center justify-center gap-1.5 text-[10px] text-zinc-400">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
              your password is hashed before it is stored, card details go straight to stripe
            </div>
          </div>
        )}

        {page === "updates" && (
          <div className="max-w-2xl mx-auto py-12 px-6">
            <h1 className="text-2xl font-semibold mb-8">updates</h1>
            <article className="mb-12">
              <p className="text-sm text-zinc-500 mb-1">11.3 · stability release</p>
              <h2 className="text-xl font-medium mb-4">queue fix, batch downloads, history & more</h2>
              <ul className="list-disc pl-5 space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                <li>fixed infinite processing loop so downloads complete and save</li>
                <li>batch url queue, progress speed/eta, pause & cancel</li>
                <li>quality & bitrate selectors, trim tool, subtitle toggle</li>
                <li>clipboard sniffing, platform badges, local history</li>
                <li>remux dropzone with conversion profiles</li>
              </ul>
            </article>
            {hash === "#betarelease-0.1.0" && (
              <article className="mb-12">
                <p className="text-sm text-zinc-500 mb-1">beta release 0.1.0</p>
                <h2 className="text-xl font-medium mb-4">the very first slugfetch build</h2>
                <p className="text-zinc-600 dark:text-zinc-400">first beta with link-based saving and animated aurora background.</p>
              </article>
            )}
          </div>
        )}

        {page === "about" && (
          <div className="max-w-2xl mx-auto py-12 px-6">
            <h1 className="text-2xl font-semibold mb-2">about</h1>
            <p className="text-sm text-zinc-500 mb-8">the BEST downloadable videos and audio content.</p>
            <section className="mb-10">
              <h2 className="font-medium mb-2">what is slugfetch?</h2>
              <p className="text-zinc-600 dark:text-zinc-400 text-sm leading-relaxed">
                slugfetch helps you save anything from your favorite websites: video, audio, photos or gifs. just paste the link and you are ready to rock. no ads, trackers, paywalls or other nonsense.
              </p>
            </section>
            <section className="mb-10">
              <h2 className="font-medium mb-2">privacy</h2>
              <p className="text-zinc-600 dark:text-zinc-400 text-sm leading-relaxed">
                requests are anonymous. remux and conversion run on your device whenever possible. history stays in local storage only.
              </p>
            </section>
          </div>
        )}
      </main>
      <SlugsAiLauncher open={slugsAiOpen} onOpen={() => setSlugsAiOpen(true)} />
      <SlugsAiWidget open={slugsAiOpen} onClose={() => setSlugsAiOpen(false)} context={slugsAiContext} />
    </div>
  );
}

export default App;
