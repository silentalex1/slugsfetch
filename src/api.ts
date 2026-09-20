export type DownloadMode = "auto" | "audio" | "mute";

export interface DownloadRequest {
  url: string;
  mode: DownloadMode;
  quality?: string;
  format?: string;
  container?: string;
  mobile?: boolean;
  bitrate?: string;
  startTime?: string;
  endTime?: string;
  subtitles?: boolean;
  subtitleLang?: string;
  filename?: string;
  isLocal?: boolean;
  localFile?: File;
  localName?: string;
  remuxTarget?: string;
}

export interface DownloadResult {
  ok: boolean;
  status: string;
  fileUrl?: string;
  filename?: string;
  error?: string;
  size?: number;
}

export interface ProgressInfo {
  pct: number;
  status: string;
  speed?: number;
  eta?: number;
  loaded?: number;
  total?: number;
}

type ProgressCb = (info: ProgressInfo) => void;

function apiBase(): string {
  const stored = typeof localStorage !== "undefined" ? localStorage.getItem("slugfetch-api-base") : null;
  if (stored?.trim()) return stored.replace(/\/$/, "");
  return "/api";
}

export function isValidMediaUrl(url: string): boolean {
  const t = url.trim();
  if (!t || t.length > 2048) return false;
  if (/[<>"`{}|\\^[\]]/.test(t)) return false;
  try {
    const u = new URL(t);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return !!u.hostname && u.hostname.includes(".");
  } catch {
    return false;
  }
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = setTimeout(() => resolve(), ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

let resolvedBase: string | null = null;

async function requestApi(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const base = resolvedBase || apiBase();
  try {
    const res = await fetch(`${base}${endpoint}`, options);
    if (res.ok || (res.status >= 400 && res.status < 500)) {
      resolvedBase = base;
      return res;
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
  }

  if (!base.startsWith("http")) {
    const fallback = "http://127.0.0.1:8787/api";
    const res = await fetch(`${fallback}${endpoint}`, options);
    if (res.ok) resolvedBase = fallback;
    return res;
  }
  throw new Error("cannot reach the slugfetch server. is it running?");
}

export function fileUrlFor(jobId: string): string {
  return `${resolvedBase || apiBase()}/jobs/${jobId}/file`;
}

function uploadForRemux(
  req: DownloadRequest,
  onProgress: ProgressCb,
  signal: AbortSignal
): Promise<{ id: string } | { error: string }> {
  const file = req.localFile;
  if (!file) return Promise.resolve({ error: "no file selected" });

  const base = resolvedBase || apiBase();
  const target = (req.remuxTarget || "mp4").toLowerCase();
  const params = new URLSearchParams({
    target,
    name: file.name,
    bitrate: String(parseInt(req.bitrate || "192", 10) || 192),
  });

  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${base}/remux?${params.toString()}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");

    const onAbort = () => xhr.abort();
    signal.addEventListener("abort", onAbort, { once: true });

    const started = Date.now();
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const elapsed = (Date.now() - started) / 1000;
      onProgress({
        pct: Math.max(2, Math.round((e.loaded / e.total) * 30)),
        status: "uploading",
        loaded: e.loaded,
        total: e.total,
        speed: elapsed > 0.4 ? e.loaded / elapsed : undefined,
      });
    };

    xhr.onload = () => {
      signal.removeEventListener("abort", onAbort);
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && data.ok && data.id) resolve({ id: data.id });
        else resolve({ error: data.error || `upload failed (HTTP ${xhr.status})` });
      } catch {
        resolve({ error: `upload failed (HTTP ${xhr.status})` });
      }
    };
    xhr.onerror = () => {
      signal.removeEventListener("abort", onAbort);
      resolve({ error: "cannot reach the slugfetch server. is it running?" });
    };
    xhr.onabort = () => {
      signal.removeEventListener("abort", onAbort);
      resolve({ error: "cancelled" });
    };

    xhr.send(file);
  });
}

async function pollJob(
  jobId: string,
  onProgress: ProgressCb,
  signal: AbortSignal,
  floor = 0
): Promise<DownloadResult> {
  const cancelRemote = () => {
    void requestApi(`/jobs/${jobId}/cancel`, { method: "POST" }).catch(() => {});
  };

  let misses = 0;
  while (true) {
    if (signal.aborted) {
      cancelRemote();
      return { ok: false, status: "cancelled", error: "cancelled" };
    }

    try {
      await sleep(400, signal);
    } catch {
      cancelRemote();
      return { ok: false, status: "cancelled", error: "cancelled" };
    }

    let job: Record<string, unknown>;
    try {
      const res = await requestApi(`/jobs/${jobId}`, { signal });
      if (!res.ok) {
        if (++misses > 12) return { ok: false, status: "error", error: "lost track of this job" };
        continue;
      }
      job = await res.json();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        cancelRemote();
        return { ok: false, status: "cancelled", error: "cancelled" };
      }
      if (++misses > 12) return { ok: false, status: "error", error: "lost connection to the server" };
      continue;
    }

    misses = 0;
    const status = String(job.status || "");
    const raw = Number(job.progress) || 0;
    const pct = floor > 0 ? Math.round(floor + (raw / 100) * (100 - floor)) : raw;

    onProgress({
      pct: status === "done" ? 100 : Math.min(99, pct),
      status: String(job.statusText || status || "processing"),
      speed: job.speed as number | undefined,
      eta: job.eta as number | undefined,
      loaded: job.loaded as number | undefined,
      total: job.total as number | undefined,
    });

    if (status === "done") {
      const size = Number(job.size) || undefined;
      onProgress({ pct: 100, status: "done", loaded: size, total: size, speed: 0, eta: 0 });
      return {
        ok: true,
        status: "done",
        fileUrl: fileUrlFor(jobId),
        filename: (job.filename as string) || undefined,
        size,
      };
    }
    if (status === "error") {
      return { ok: false, status: "error", error: (job.error as string) || "processing failed" };
    }
    if (status === "cancelled") {
      return { ok: false, status: "cancelled", error: "cancelled" };
    }
  }
}

async function processLocal(
  req: DownloadRequest,
  onProgress: ProgressCb,
  signal: AbortSignal
): Promise<DownloadResult> {
  if (!req.localFile) return { ok: false, status: "error", error: "no file selected" };

  onProgress({ pct: 2, status: "uploading" });
  const created = await uploadForRemux(req, onProgress, signal);
  if ("error" in created) {
    return created.error === "cancelled"
      ? { ok: false, status: "cancelled", error: "cancelled" }
      : { ok: false, status: "error", error: created.error };
  }

  onProgress({ pct: 32, status: "queued" });
  return pollJob(created.id, onProgress, signal, 30);
}

export async function downloadMedia(
  req: DownloadRequest,
  onProgress: ProgressCb,
  signal: AbortSignal
): Promise<DownloadResult> {
  if (req.isLocal) return processLocal(req, onProgress, signal);

  if (!isValidMediaUrl(req.url)) {
    return { ok: false, status: "error", error: "invalid or unsafe url" };
  }

  try {
    onProgress({ pct: 2, status: "queued" });

    const createRes = await requestApi("/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: req.url,
        mode: req.mode,
        quality: req.quality,
        format: req.format,
        container: req.container,
        mobile: req.mobile,
        bitrate: req.bitrate,
        startTime: req.startTime,
        endTime: req.endTime,
        subtitles: req.subtitles,
        subtitleLang: req.subtitleLang,
      }),
      signal,
    });

    if (!createRes.ok) {
      const errJson = await createRes.json().catch(() => ({}));
      return { ok: false, status: "error", error: errJson.error || `HTTP ${createRes.status}` };
    }

    const jobData = await createRes.json();
    if (!jobData.ok || !jobData.id) {
      return { ok: false, status: "error", error: jobData.error || "could not start this download" };
    }

    return await pollJob(jobData.id, onProgress, signal);
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === "AbortError") {
      return { ok: false, status: "cancelled", error: "cancelled" };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: "error", error: msg };
  }
}

export function saveToDisk(fileUrl: string, filename?: string) {
  const a = document.createElement("a");
  a.href = fileUrl;
  if (filename) a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 0);
}

export interface ServerHealth {
  ok: boolean;
  ytdlp?: boolean;
  ffmpeg?: boolean;
  cookies?: boolean;
  active?: number;
  queued?: number;
  error?: string;
}

export async function checkHealth(): Promise<ServerHealth> {
  try {
    const res = await requestApi("/health");
    if (!res.ok) return { ok: false, error: `server returned HTTP ${res.status}` };
    const data = await res.json();
    return {
      ok: !!data.ok,
      ytdlp: data.ytdlp,
      ffmpeg: data.ffmpeg,
      cookies: data.cookies,
      active: data.active,
      queued: data.queued,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "server unreachable" };
  }
}

export interface PaymentsConfig {
  configured: boolean;
  mode: "test" | "live" | null;
  live: boolean;
  ready: boolean;
  warnings: string[];
  currency: string;
  presets: number[];
  webhook: boolean;
}

export interface DonationReceipt {
  paid: boolean;
  status: string;
  paymentStatus: string;
  amount?: number;
  currency?: string;
  recurring?: boolean;
  email?: string | null;
  account?: string | null;
  premium?: boolean;
  unlocked?: Account | null;
}

export async function getPaymentsConfig(): Promise<PaymentsConfig | null> {
  try {
    const res = await requestApi("/donate/config");
    if (!res.ok) return null;
    const data = await res.json();
    return data.ok ? (data as PaymentsConfig) : null;
  } catch {
    return null;
  }
}

export interface Account {
  username: string;
  premium: boolean;
  premiumSince: number | null;
  createdAt: number;
}

export interface StoredSession {
  username: string;
  token: string;
}

const SESSION_KEY = "slugfetch-account";

export function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.username && parsed?.token ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSession(session: StoredSession | null) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    return;
  }
}

export async function claimAccount(
  username: string,
  password: string
): Promise<{ ok: boolean; created?: boolean; account?: Account; token?: string; error?: string }> {
  try {
    const res = await requestApi("/account/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return { ok: false, error: data.error || `could not sign in (HTTP ${res.status})` };
    return { ok: true, created: data.created, account: data.account, token: data.token };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "could not reach the server" };
  }
}

export async function fetchAccount(session: StoredSession): Promise<Account | null> {
  try {
    const res = await requestApi(`/account/${encodeURIComponent(session.username)}`, {
      headers: { "X-Account-Token": session.token },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.ok ? data.account : null;
  } catch {
    return null;
  }
}

export interface RemoteHistoryItem {
  id: string;
  name: string;
  url: string;
  platform: string;
  filename: string;
  at: number;
  size?: number;
}

export async function fetchHistory(session: StoredSession): Promise<RemoteHistoryItem[] | null> {
  try {
    const res = await requestApi(`/account/${encodeURIComponent(session.username)}/history`, {
      headers: { "X-Account-Token": session.token },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.ok && Array.isArray(data.history) ? data.history : null;
  } catch {
    return null;
  }
}

export async function pushHistory(
  session: StoredSession,
  history: RemoteHistoryItem[]
): Promise<RemoteHistoryItem[] | null> {
  try {
    const res = await requestApi(`/account/${encodeURIComponent(session.username)}/history`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Account-Token": session.token },
      body: JSON.stringify({ history }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.ok && Array.isArray(data.history) ? data.history : null;
  } catch {
    return null;
  }
}

export async function clearRemoteHistory(session: StoredSession): Promise<boolean> {
  try {
    const res = await requestApi(`/account/${encodeURIComponent(session.username)}/history`, {
      method: "DELETE",
      headers: { "X-Account-Token": session.token },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function startDonation(opts: {
  amount: number;
  currency?: string;
  recurring?: boolean;
  account?: string;
  token?: string;
}): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const res = await requestApi("/donate/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok || !data.url) {
      return { ok: false, error: data.error || `checkout failed (HTTP ${res.status})` };
    }
    return { ok: true, url: data.url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "could not reach the payment server" };
  }
}

export async function confirmDonation(sessionId: string): Promise<DonationReceipt | null> {
  try {
    const res = await requestApi(`/donate/session/${encodeURIComponent(sessionId)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.ok ? (data as DonationReceipt) : null;
  } catch {
    return null;
  }
}

export function formatMoney(cents?: number, currency = "usd"): string {
  if (cents == null || !Number.isFinite(cents)) return "";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

export async function uploadCookies(file: File): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await requestApi("/cookies", { method: "POST", body: await file.text() });
    const data = await res.json().catch(() => ({}));
    return res.ok && data.ok ? { ok: true } : { ok: false, error: data.error || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "upload failed" };
  }
}

export async function clearCookies(): Promise<boolean> {
  try {
    const res = await requestApi("/cookies", { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}

export function setApiBase(base: string) {
  localStorage.setItem("slugfetch-api-base", base.replace(/\/$/, ""));
}

export function getApiBase(): string {
  return apiBase();
}

export function formatBytes(n?: number): string {
  if (n == null || !Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatSpeed(bps?: number): string {
  if (bps == null || !Number.isFinite(bps) || bps <= 0) return "—";
  return `${(bps / (1024 * 1024)).toFixed(2)} MB/s`;
}

export function formatEta(sec?: number): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "—";
  if (sec < 60) return `${Math.ceil(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.ceil(sec % 60);
  if (m < 60) return `${m}m ${s}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
