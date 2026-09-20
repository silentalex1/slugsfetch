import http from "node:http";
import { randomUUID } from "node:crypto";
import {
  createReadStream,
  existsSync,
  statSync,
  readdirSync,
  unlinkSync,
  mkdirSync,
  statfsSync,
} from "node:fs";
import { join, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import { createWriteStream, writeFileSync } from "node:fs";
import {
  runDownload,
  runRemux,
  runSlowReverb,
  probeReady,
  TMP_DIR,
  ensureYtDlp,
  REMUX_TARGETS,
  COOKIE_FILE,
  hasCookieFile,
  clearCookieFile,
} from "./ytdlp.js";
import {
  createDonationSession,
  readSession,
  handleWebhook,
  paymentsStatus,
  rateLimited,
  qualifiesForPremium,
} from "./payments.js";
import {
  claimAccount,
  authenticate,
  grantPremium,
  publicAccount,
  getHistory,
  mergeHistory,
  clearHistory,
} from "./accounts.js";

try {
  process.loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), "..", ".env"));
} catch {}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.SLUGFETCH_PORT || 8787);
const HOST = process.env.SLUGFETCH_HOST || "127.0.0.1";
const MAX_CONCURRENT = Number(process.env.SLUGFETCH_CONCURRENCY || 2);
const MAX_JOBS = 200;
const MIN_FREE_BYTES = 200 * 1024 * 1024;
const MAX_UPLOAD_BYTES = Number(process.env.SLUGFETCH_MAX_UPLOAD || 3 * 1024 * 1024 * 1024);

if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });

const jobs = new Map();
const controllers = new Map();
let active = 0;
const queue = [];
const startedAt = Date.now();

const URL_RE =
  /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,24}\b([-a-zA-Z0-9()@:%_+.~#?&/=]*)$/i;

function log(level, reqId, msg, extra) {
  const line = extra ? `${msg} ${JSON.stringify(extra)}` : msg;
  console.log(`[slugfetch-api] ${level} ${reqId || "-"} ${line}`);
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, X-Request-Id, X-Account-Token");
  res.setHeader("Access-Control-Expose-Headers", "X-Request-Id");
}

function json(res, status, body, reqId) {
  if (res.headersSent || res.writableEnded) return;
  cors(res);
  if (reqId) res.setHeader("X-Request-Id", reqId);
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(raw),
  });
  res.end(raw);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 2_000_000) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid json"));
      }
    });
    req.on("error", reject);
  });
}

function readRawBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function clientIp(req) {
  return String(req.socket?.remoteAddress || "unknown").replace(/^::ffff:/, "");
}

function freeDiskBytes() {
  try {
    if (typeof statfsSync === "function") {
      const s = statfsSync(TMP_DIR);
      return Number(s.bavail) * Number(s.bsize);
    }
  } catch {}
  return null;
}

function validateUrl(raw) {
  const mediaUrl = String(raw || "").trim();
  if (!mediaUrl || mediaUrl.length > 2048) {
    return { ok: false, error: "invalid or unsupported url" };
  }
  try {
    const u = new URL(mediaUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return { ok: false, error: "only http(s) urls are allowed" };
    }
    if (!u.hostname.includes(".")) {
      return { ok: false, error: "invalid hostname" };
    }
    if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(u.hostname)) {
      return { ok: false, error: "local urls are not allowed" };
    }
  } catch {
    return { ok: false, error: "invalid url" };
  }
  return { ok: true, url: mediaUrl };
}

function safeBase(name) {
  const cleaned = String(name || "")
    .replace(/[\\/:*?"<>|\r\n]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned || "output";
}

function publicJob(job) {
  return {
    id: job.id,
    type: job.type || "fetch",
    target: job.target,
    sourceName: job.sourceName,
    status: job.status,
    progress: job.progress,
    statusText: job.statusText,
    speed: job.speed,
    eta: job.eta,
    loaded: job.loaded,
    total: job.total,
    filename: job.filename,
    error: job.error,
    size: job.size,
    url: job.url,
    mode: job.mode,
    quality: job.quality,
    format: job.format,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    requestId: job.requestId,
  };
}

function patchJob(id, patch) {
  const job = jobs.get(id);
  if (!job) return;
  Object.assign(job, patch, { updatedAt: Date.now() });
}

function safeUnlink(p) {
  try {
    if (p && existsSync(p)) unlinkSync(p);
  } catch {}
}

function cleanupJobFiles(jobId, filepath, keepPath) {
  if (filepath !== keepPath) safeUnlink(filepath);
  try {
    for (const name of readdirSync(TMP_DIR)) {
      const full = join(TMP_DIR, name);
      if (name.startsWith(jobId) && full !== keepPath) safeUnlink(full);
    }
  } catch {}
}

function cleanupOld() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.updatedAt < cutoff && ["done", "error", "cancelled"].includes(job.status)) {
      cleanupJobFiles(id, job.filepath);
      jobs.delete(id);
      controllers.delete(id);
    }
  }
  try {
    for (const name of readdirSync(TMP_DIR)) {
      const full = join(TMP_DIR, name);
      try {
        if (Date.now() - statSync(full).mtimeMs > 2 * 60 * 60 * 1000) safeUnlink(full);
      } catch {}
    }
  } catch {}
}

setInterval(cleanupOld, 5 * 60 * 1000).unref();

function makeJob(body, requestId) {
  const checked = validateUrl(body.url);
  if (!checked.ok) return { error: checked.error };
  return {
    job: {
      id: randomUUID(),
      type: "fetch",
      url: checked.url,
      mode: ["auto", "audio", "mute"].includes(body.mode) ? body.mode : "auto",
      quality: String(body.quality || "1080p"),
      format: String(body.format || "mp3"),
      container: ["auto", "mp4", "webm", "mkv"].includes(body.container) ? body.container : "auto",
      bitrate: String(body.bitrate || "128kb/s"),
      startTime: body.startTime ? String(body.startTime) : undefined,
      endTime: body.endTime ? String(body.endTime) : undefined,
      mobile: !!body.mobile,
      subtitles: !!body.subtitles,
      subtitleLang: body.subtitleLang ? String(body.subtitleLang) : "en",
      status: "queued",
      progress: 0,
      statusText: "queued",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      requestId,
    },
  };
}

async function processRemuxJob(job, ac) {
  const target = job.target;
  const conf = REMUX_TARGETS[target];
  const outName = `${job.id}__${job.outputBase}.${conf.ext}`;
  const outPath = join(TMP_DIR, outName);

  const result = await runRemux({
    inputPath: job.inputPath,
    target,
    outputPath: outPath,
    bitrate: parseInt(String(job.bitrate || "192"), 10) || 192,
    signal: ac.signal,
    onProgress: (info) => {
      patchJob(job.id, {
        progress: info.pct ?? jobs.get(job.id)?.progress ?? 5,
        statusText: info.status || "converting",
      });
    },
  });

  return { filepath: result.filepath, filename: `${job.outputBase}.${conf.ext}` };
}

async function processJob(job) {
  active++;
  const ac = new AbortController();
  controllers.set(job.id, ac);
  patchJob(job.id, { status: "processing", progress: 2, statusText: "starting", error: undefined });
  log("info", job.requestId, "job start", { id: job.id, type: job.type, url: job.url, mode: job.mode });

  const free = freeDiskBytes();
  if (free != null && free < MIN_FREE_BYTES) {
    patchJob(job.id, {
      status: "error",
      statusText: "error",
      error: "not enough disk space (need ~200MB free)",
    });
    controllers.delete(job.id);
    active--;
    pump();
    return;
  }

  const outTemplate = join(TMP_DIR, `${job.id}__%(title).100B.%(ext)s`);

  try {
    let result;
    if (job.type === "slowreverb") {
      const out = await runSlowReverb({
        inputPath: job.inputPath,
        outputPath: job.outputPath,
        speed: job.speed,
        reverb: job.reverb,
        signal: ac.signal,
        onProgress: (info) => {
          patchJob(job.id, {
            progress: info.pct ?? jobs.get(job.id)?.progress ?? 5,
            statusText: info.status || "slowing",
          });
        },
      });
      result = { filepath: out.filepath, filename: `${job.outputBase}.mp3` };
    } else if (job.type === "remux") {
      result = await processRemuxJob(job, ac);
    } else {
      await ensureYtDlp();
      patchJob(job.id, { progress: 5, statusText: "extracting" });

      result = await runDownload({
        url: job.url,
        mode: job.mode,
        quality: job.quality,
        format: job.format,
        container: job.container,
        mobile: job.mobile,
        bitrate: job.bitrate,
        startTime: job.startTime,
        endTime: job.endTime,
        subtitles: job.subtitles,
        subtitleLang: job.subtitleLang,
        outTemplate,
        jobId: job.id,
        signal: ac.signal,
        onProgress: (info) => {
          patchJob(job.id, {
            progress: info.pct ?? jobs.get(job.id)?.progress ?? 10,
            statusText: info.status || "downloading",
            speed: info.speed,
            eta: info.eta,
            loaded: info.loaded,
            total: info.total,
          });
        },
      });
    }

    if (!result.filepath || !existsSync(result.filepath)) {
      throw new Error("output file missing after download");
    }

    const size = statSync(result.filepath).size;
    if (size < 256) throw new Error("downloaded file is empty or too small");
    if (job.type === "remux") safeUnlink(job.inputPath);

    patchJob(job.id, {
      status: "done",
      progress: 100,
      statusText: "done",
      filepath: result.filepath,
      filename: result.filename || basename(result.filepath),
      size,
      total: size,
      loaded: size,
      speed: 0,
      eta: 0,
    });
    log("info", job.requestId, "job done", { id: job.id, size, filename: result.filename });
  } catch (e) {
    if (e?.code === "CANCELLED" || ac.signal.aborted) {
      patchJob(job.id, { status: "cancelled", progress: 0, statusText: "cancelled", error: "cancelled" });
      log("info", job.requestId, "job cancelled", { id: job.id });
    } else {
      const msg = e instanceof Error ? e.message : String(e);
      const friendly = /DRM protected/i.test(msg)
        ? "this one is DRM protected, it can't be saved"
        : /Private video|only works when logged-in|Sign in|login required|not a bot|account credentials/i.test(msg)
          ? "this is private or needs a login on that platform"
          : /has been removed|no longer available|does not exist|Video unavailable/i.test(msg)
            ? "that post is gone or was taken down"
            : /Unsupported URL|No video|Unable to extract|no video formats/i.test(msg)
              ? "nothing downloadable was found at that link"
              : /HTTP Error 429|Too Many Requests/i.test(msg)
                ? "the platform is rate limiting us, try again in a minute"
                : /HTTP Error 403|Forbidden/i.test(msg)
                  ? "the platform blocked this request, try again"
                  : /geo|not available in your country/i.test(msg)
                    ? "this is blocked in this region"
                    : /ffmpeg|conversion/i.test(msg)
                      ? `conversion failed: ${msg.slice(0, 200)}`
                      : msg.slice(0, 400);
      patchJob(job.id, { status: "error", statusText: "error", error: friendly });
      log("error", job.requestId, "job failed", { id: job.id, error: friendly });
    }
    cleanupJobFiles(job.id, job.filepath, job.type === "remux" ? job.inputPath : null);
  } finally {
    controllers.delete(job.id);
    active--;
    pump();
  }
}

function pump() {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const id = queue.shift();
    const job = jobs.get(id);
    if (!job || job.status !== "queued") continue;
    void processJob(job);
  }
}

function enqueue(job) {
  if (jobs.size >= MAX_JOBS) {
    const oldest = [...jobs.entries()]
      .filter(([, j]) => ["done", "error", "cancelled"].includes(j.status))
      .sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    for (const [id, j] of oldest.slice(0, 20)) {
      cleanupJobFiles(id, j.filepath);
      jobs.delete(id);
    }
  }
  jobs.set(job.id, job);
  queue.push(job.id);
  pump();
}

function contentDisposition(filename) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16));
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function mimeFor(filename) {
  const ext = extname(filename).toLowerCase();
  return (
    {
      ".mp3": "audio/mpeg",
      ".m4a": "audio/mp4",
      ".wav": "audio/wav",
      ".ogg": "audio/ogg",
      ".opus": "audio/opus",
      ".flac": "audio/flac",
      ".webm": "video/webm",
      ".mkv": "video/x-matroska",
      ".mp4": "video/mp4",
    }[ext] || "application/octet-stream"
  );
}

const DIST_DIR = join(__dirname, "..", "dist");

const STATIC_MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

function serveStatic(res, path) {
  if (!existsSync(DIST_DIR)) return false;
  const rel = path === "/" ? "index.html" : path.replace(/^\/+/, "");
  if (rel.includes("..")) return false;

  let file = join(DIST_DIR, rel);
  if (!existsSync(file) || !statSync(file).isFile()) {
    file = join(DIST_DIR, "index.html");
    if (!existsSync(file)) return false;
  }

  const ext = extname(file).toLowerCase();
  const isIndex = basename(file) === "index.html";
  res.writeHead(200, {
    "Content-Type": STATIC_MIME[ext] || "application/octet-stream",
    "Content-Length": statSync(file).size,
    "Cache-Control": isIndex ? "no-cache" : "public, max-age=604800",
  });
  createReadStream(file).pipe(res);
  return true;
}

async function handle(req, res) {
  const reqId = req.headers["x-request-id"] || randomUUID().slice(0, 8);
  cors(res);
  res.setHeader("X-Request-Id", reqId);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  try {
    if (req.method === "GET" && (path === "/api/health" || path === "/health")) {
      const ready = await probeReady();
      const free = freeDiskBytes();
      return json(
        res,
        200,
        {
          ok: true,
          service: "slugfetch-api",
          version: "11.4.0",
          uptimeMs: Date.now() - startedAt,
          active,
          queued: queue.length,
          jobs: jobs.size,
          freeDiskBytes: free,
          cookies: hasCookieFile(),
          payments: paymentsStatus(),
          ...ready,
        },
        reqId
      );
    }

    if (req.method === "GET" && path === "/api/jobs") {
      const list = [...jobs.values()]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 100)
        .map(publicJob);
      return json(res, 200, { ok: true, jobs: list, active, queued: queue.length }, reqId);
    }

    if (req.method === "POST" && path === "/api/jobs/batch") {
      const body = await readBody(req);
      const urls = Array.isArray(body.urls) ? body.urls : [];
      if (!urls.length) return json(res, 400, { ok: false, error: "urls array required" }, reqId);
      if (urls.length > 50) return json(res, 400, { ok: false, error: "max 50 urls per batch" }, reqId);
      const created = [];
      const errors = [];
      for (const u of urls) {
        const made = makeJob({ ...body, url: u }, reqId);
        if (made.error) {
          errors.push({ url: u, error: made.error });
          continue;
        }
        enqueue(made.job);
        created.push(publicJob(made.job));
      }
      return json(res, 201, { ok: true, jobs: created, errors }, reqId);
    }

    if (req.method === "POST" && path === "/api/donate/webhook") {
      const raw = await readRawBody(req, 1024 * 1024);
      try {
        const result = handleWebhook(raw, req.headers["stripe-signature"]);
        const donation = result.donation;
        if (donation?.account && qualifiesForPremium(donation.amount) && donation.paymentStatus === "paid") {
          const account = grantPremium(donation.account, {
            amount: donation.amount,
            currency: donation.currency,
            sessionId: donation.sessionId,
          });
          if (account) log("info", reqId, "premium unlocked via webhook", { username: account.username });
        }
        log("info", reqId, "stripe webhook", { type: result.type });
        return json(res, 200, { ok: true, received: true, type: result.type }, reqId);
      } catch (e) {
        const status = e.status || 400;
        log("error", reqId, `webhook rejected: ${e.message}`);
        return json(res, status, { ok: false, error: e.message }, reqId);
      }
    }

    if (req.method === "POST" && path === "/api/account/claim") {
      const ip = clientIp(req);
      if (rateLimited(`account:${ip}`)) {
        return json(res, 429, { ok: false, error: "too many attempts, wait a few minutes" }, reqId);
      }
      const body = await readBody(req);
      const result = await claimAccount(body.username, body.password);
      if (result.error) {
        return json(res, result.status || 400, { ok: false, error: result.error }, reqId);
      }
      log("info", reqId, result.created ? "account created" : "account signed in", {
        username: result.account.username,
      });
      return json(
        res,
        result.created ? 201 : 200,
        {
          ok: true,
          created: result.created,
          token: result.account.token,
          account: publicAccount(result.account),
        },
        reqId
      );
    }

    const historyMatch = path.match(/^\/api\/account\/([^/]+)\/history$/);
    if (historyMatch) {
      const token = String(req.headers["x-account-token"] || "");
      const account = authenticate(decodeURIComponent(historyMatch[1]), token);
      if (!account) return json(res, 401, { ok: false, error: "not signed in" }, reqId);

      if (req.method === "GET") {
        return json(res, 200, { ok: true, history: getHistory(account.username) }, reqId);
      }

      if (req.method === "POST") {
        const body = await readBody(req);
        const merged = mergeHistory(account.username, body.history);
        log("info", reqId, "history synced", { username: account.username, entries: merged?.length ?? 0 });
        return json(res, 200, { ok: true, history: merged || [] }, reqId);
      }

      if (req.method === "DELETE") {
        clearHistory(account.username);
        log("info", reqId, "history cleared", { username: account.username });
        return json(res, 200, { ok: true, history: [] }, reqId);
      }
    }

    const accountMatch = path.match(/^\/api\/account\/([^/]+)$/);
    if (req.method === "GET" && accountMatch && accountMatch[1] !== "claim") {
      const token = String(req.headers["x-account-token"] || url.searchParams.get("token") || "");
      const account = authenticate(decodeURIComponent(accountMatch[1]), token);
      if (!account) return json(res, 401, { ok: false, error: "not signed in" }, reqId);
      return json(res, 200, { ok: true, account: publicAccount(account) }, reqId);
    }

    if (req.method === "POST" && path === "/api/donate/session") {
      const ip = clientIp(req);
      if (rateLimited(ip)) {
        return json(res, 429, { ok: false, error: "too many attempts, wait a few minutes" }, reqId);
      }
      const body = await readBody(req);
      const linked = body.account && body.token ? authenticate(body.account, body.token) : null;
      if (body.account && !linked) {
        return json(res, 401, { ok: false, error: "that account session expired, sign in again" }, reqId);
      }
      try {
        const session = await createDonationSession({
          amount: body.amount,
          currency: body.currency,
          recurring: body.recurring,
          account: linked?.username,
          ip,
        });
        log("info", reqId, "checkout session created", {
          id: session.id,
          amount: session.amount,
          currency: session.currency,
          recurring: session.recurring,
        });
        return json(res, 201, { ok: true, url: session.url, id: session.id }, reqId);
      } catch (e) {
        const status = e.status || (e.type && String(e.type).startsWith("Stripe") ? 502 : 500);
        const message =
          status === 502 ? `stripe rejected the request: ${e.message}` : e.message || "could not start checkout";
        log("error", reqId, `checkout failed: ${e.message}`);
        return json(res, status, { ok: false, error: message }, reqId);
      }
    }

    const donateMatch = path.match(/^\/api\/donate\/session\/([^/]+)$/);
    if (req.method === "GET" && donateMatch) {
      try {
        const session = await readSession(donateMatch[1]);
        let unlocked = null;
        if (session.paid && session.premium && session.account) {
          const account = grantPremium(session.account, {
            amount: session.amount,
            currency: session.currency,
            sessionId: session.id,
          });
          if (account) {
            unlocked = publicAccount(account);
            log("info", reqId, "premium unlocked", { username: account.username, amount: session.amount });
          }
        }
        return json(res, 200, { ok: true, ...session, unlocked }, reqId);
      } catch (e) {
        const status = e.status || 502;
        return json(res, status, { ok: false, error: e.message || "could not read that session" }, reqId);
      }
    }

    if (req.method === "GET" && path === "/api/donate/config") {
      return json(res, 200, { ok: true, ...paymentsStatus() }, reqId);
    }

    if (path === "/api/cookies") {
      if (req.method === "GET") {
        return json(res, 200, { ok: true, present: hasCookieFile() }, reqId);
      }
      if (req.method === "DELETE") {
        const removed = clearCookieFile();
        log("info", reqId, "cookies cleared");
        return json(res, 200, { ok: removed, present: hasCookieFile() }, reqId);
      }
      if (req.method === "POST") {
        const chunks = [];
        let size = 0;
        let tooBig = false;
        req.on("data", (c) => {
          size += c.length;
          if (size > 5 * 1024 * 1024) {
            tooBig = true;
            req.destroy();
            return;
          }
          chunks.push(c);
        });
        await new Promise((resolve) => {
          req.on("end", resolve);
          req.on("close", resolve);
          req.on("error", resolve);
        });
        if (tooBig) return json(res, 413, { ok: false, error: "cookie file is too large" }, reqId);

        const text = Buffer.concat(chunks).toString("utf8");
        if (!/^#\s*(HTTP Cookie File|Netscape HTTP Cookie File)/im.test(text) && !/\t/.test(text)) {
          return json(
            res,
            400,
            { ok: false, error: "that doesn't look like a netscape cookies.txt export" },
            reqId
          );
        }
        writeFileSync(COOKIE_FILE, text, "utf8");
        log("info", reqId, "cookies saved", { bytes: text.length });
        return json(res, 200, { ok: true, present: hasCookieFile() }, reqId);
      }
    }

    if (req.method === "POST" && path === "/api/slowreverb") {
      const body = await readBody(req);
      const account = body.account && body.token ? authenticate(body.account, body.token) : null;
      if (!account) {
        return json(res, 401, { ok: false, error: "sign in to use slow and reverb" }, reqId);
      }
      if (!account.premium) {
        return json(res, 403, { ok: false, error: "slow and reverb is a premium feature, donate above $5 to unlock it" }, reqId);
      }

      const source = jobs.get(String(body.jobId || ""));
      if (!source || source.status !== "done" || !source.filepath || !existsSync(source.filepath)) {
        return json(res, 409, { ok: false, error: "that download is no longer available, run it again" }, reqId);
      }

      const speed = Math.min(1, Math.max(0.5, Number(body.speed) || 0.8));
      const reverb = Math.min(1, Math.max(0, Number(body.reverb ?? 0.35)));
      const id = randomUUID();
      const base = safeBase(basename(source.filename || "audio").replace(/\.[^.]+$/, ""));
      const outPath = join(TMP_DIR, `${id}__${base} (slowed).mp3`);

      const job = {
        id,
        type: "slowreverb",
        url: "",
        sourceName: source.filename,
        speed,
        reverb,
        inputPath: source.filepath,
        outputPath: outPath,
        outputBase: `${base} (slowed)`,
        mode: "audio",
        format: "mp3",
        status: "queued",
        progress: 0,
        statusText: "queued",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        requestId: reqId,
      };
      enqueue(job);
      log("info", reqId, "slow reverb queued", { id, speed, reverb, user: account.username });
      return json(res, 201, { ok: true, ...publicJob(job) }, reqId);
    }

    if (req.method === "POST" && path === "/api/remux") {
      const target = String(url.searchParams.get("target") || "mp4").toLowerCase();
      if (!REMUX_TARGETS[target]) {
        req.resume();
        return json(res, 400, { ok: false, error: `unsupported target format: ${target}` }, reqId);
      }

      const rawName = decodeURIComponent(url.searchParams.get("name") || "input");
      const sourceName = rawName.replace(/[\\/:*?"<>|\r\n]+/g, "_").slice(-180) || "input";
      const srcExt = (extname(sourceName) || ".bin").toLowerCase();
      const outputBase = safeBase(basename(sourceName, extname(sourceName)));
      const bitrate = String(url.searchParams.get("bitrate") || "192");

      const declared = Number(req.headers["content-length"] || 0);
      if (declared && declared > MAX_UPLOAD_BYTES) {
        req.resume();
        return json(res, 413, { ok: false, error: "file is too large (max 3GB)" }, reqId);
      }

      const free = freeDiskBytes();
      if (free != null && declared && free < declared + MIN_FREE_BYTES) {
        req.resume();
        return json(res, 507, { ok: false, error: "not enough disk space on the server" }, reqId);
      }

      const id = randomUUID();
      const inputPath = join(TMP_DIR, `${id}.src${srcExt}`);

      let written = 0;
      let aborted = null;
      const sink = createWriteStream(inputPath);
      req.on("data", (c) => {
        written += c.length;
        if (written > MAX_UPLOAD_BYTES && !aborted) {
          aborted = "file is too large (max 3GB)";
          req.destroy();
        }
      });

      try {
        await pipeline(req, sink);
      } catch (e) {
        safeUnlink(inputPath);
        return json(res, aborted ? 413 : 400, { ok: false, error: aborted || "upload failed" }, reqId);
      }

      if (written < 256) {
        safeUnlink(inputPath);
        return json(res, 400, { ok: false, error: "uploaded file is empty" }, reqId);
      }

      const job = {
        id,
        type: "remux",
        url: "",
        target,
        sourceName,
        outputBase,
        inputPath,
        bitrate,
        mode: REMUX_TARGETS[target].kind === "audio" ? "audio" : "auto",
        format: target,
        status: "queued",
        progress: 0,
        statusText: "queued",
        total: written,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        requestId: reqId,
      };
      enqueue(job);
      log("info", reqId, "remux queued", { id, target, bytes: written, name: sourceName });
      return json(res, 201, { ok: true, ...publicJob(job) }, reqId);
    }

    if (req.method === "POST" && (path === "/api/jobs" || path === "/api/" || path === "/api")) {
      const body = await readBody(req);
      const made = makeJob(body, reqId);
      if (made.error) return json(res, 400, { ok: false, error: made.error }, reqId);
      enqueue(made.job);
      log("info", reqId, "job queued", { id: made.job.id, url: made.job.url });
      return json(res, 201, { ok: true, ...publicJob(made.job) }, reqId);
    }

    const jobMatch = path.match(/^\/api\/jobs\/([^/]+)(?:\/(file|cancel|pause|resume))?$/);
    if (jobMatch) {
      const id = jobMatch[1];
      const action = jobMatch[2];
      const job = jobs.get(id);
      if (!job) return json(res, 404, { ok: false, error: "job not found" }, reqId);

      if (req.method === "GET" && !action) {
        return json(res, 200, { ok: true, ...publicJob(job) }, reqId);
      }

      if (req.method === "GET" && action === "file") {
        if (job.status !== "done" || !job.filepath || !existsSync(job.filepath)) {
          return json(res, 409, { ok: false, error: "file not ready" }, reqId);
        }
        const st = statSync(job.filepath);
        let filename = job.filename || basename(job.filepath);
        const actualExt = extname(job.filepath) || (job.mode === "audio" ? ".mp3" : ".mp4");
        if (!/\.(mp4|mp3|m4a|webm|wav|ogg|opus|flac|mkv|mov|avi)$/i.test(filename)) {
          filename = `${filename}${actualExt}`;
        }
        cors(res);
        res.setHeader("X-Request-Id", reqId);
        res.writeHead(200, {
          "Content-Type": mimeFor(filename),
          "Content-Length": st.size,
          "Content-Disposition": contentDisposition(filename),
          "Accept-Ranges": "none",
          "Cache-Control": "no-store",
        });
        try {
          await pipeline(createReadStream(job.filepath), res);
        } catch (e) {
          log("info", reqId, "file transfer ended early", { id, reason: e?.message });
          res.destroy();
        }
        return;
      }

      if (req.method === "POST" && action === "cancel") {
        controllers.get(id)?.abort();
        if (job.status === "queued") {
          const idx = queue.indexOf(id);
          if (idx >= 0) queue.splice(idx, 1);
          patchJob(id, { status: "cancelled", statusText: "cancelled", progress: 0, error: "cancelled" });
        }
        cleanupJobFiles(id, jobs.get(id)?.filepath);
        return json(res, 200, { ok: true, ...publicJob(jobs.get(id)) }, reqId);
      }

      if (req.method === "POST" && action === "pause") {
        controllers.get(id)?.abort();
        if (job.status === "queued") {
          const idx = queue.indexOf(id);
          if (idx >= 0) queue.splice(idx, 1);
        }
        patchJob(id, { status: "paused", statusText: "paused" });
        return json(res, 200, { ok: true, ...publicJob(jobs.get(id)) }, reqId);
      }

      if (req.method === "POST" && action === "resume") {
        if (["paused", "error", "cancelled"].includes(job.status)) {
          if (job.type === "remux" && (!job.inputPath || !existsSync(job.inputPath))) {
            return json(res, 409, { ok: false, error: "upload expired, add the file again" }, reqId);
          }
          cleanupJobFiles(id, job.filepath, job.type === "remux" ? job.inputPath : null);
          patchJob(id, {
            status: "queued",
            progress: 0,
            statusText: "queued",
            error: undefined,
            filepath: undefined,
            filename: undefined,
            size: undefined,
          });
          queue.push(id);
          pump();
        }
        return json(res, 200, { ok: true, ...publicJob(jobs.get(id)) }, reqId);
      }

      if (req.method === "DELETE" && !action) {
        controllers.get(id)?.abort();
        const idx = queue.indexOf(id);
        if (idx >= 0) queue.splice(idx, 1);
        cleanupJobFiles(id, job.filepath);
        jobs.delete(id);
        controllers.delete(id);
        return json(res, 200, { ok: true }, reqId);
      }
    }

    if (req.method === "GET" && !path.startsWith("/api/") && serveStatic(res, path)) return;

    return json(res, 404, { ok: false, error: "not found" }, reqId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("error", reqId, msg);
    if (res.headersSent || res.writableEnded) {
      res.destroy();
      return;
    }
    return json(res, 500, { ok: false, error: msg, requestId: reqId }, reqId);
  }
}

process.on("uncaughtException", (err) => {
  log("error", "-", `uncaught: ${err?.message || err}`);
});
process.on("unhandledRejection", (err) => {
  log("error", "-", `unhandled rejection: ${err?.message || err}`);
});

function listen(port, attempt = 0) {
  const server = http.createServer((req, res) => {
    res.on("error", () => {});
    req.on("error", () => {});
    void handle(req, res).catch((e) => {
      log("error", "-", `handler crash: ${e?.message || e}`);
      if (!res.headersSent) json(res, 500, { ok: false, error: "internal error" });
      else res.destroy();
    });
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && attempt < 3) {
      console.log(`[slugfetch-api] port ${port} busy, retrying…`);
      setTimeout(() => listen(port, attempt + 1), 400 * (attempt + 1));
      return;
    }
    console.error(`[slugfetch-api] failed to bind ${HOST}:${port}:`, err.message);
    process.exit(1);
  });

  server.listen(port, HOST, async () => {
    console.log(`[slugfetch-api] http://${HOST}:${port}`);
    try {
      const ready = await probeReady();
      console.log(`[slugfetch-api] yt-dlp=${ready.ytdlp} ffmpeg=${ready.ffmpeg}`);
    } catch (e) {
      console.log("[slugfetch-api] probe failed:", e?.message || e);
    }

    const pay = paymentsStatus();
    if (!pay.configured) {
      console.log("[slugfetch-api] payments: off (no STRIPE_SECRET_KEY)");
    } else if (pay.live) {
      console.log("[slugfetch-api] payments: LIVE MODE, real cards will be charged");
      for (const w of pay.warnings) console.log(`[slugfetch-api] payments warning: ${w}`);
    } else {
      console.log("[slugfetch-api] payments: test mode, real cards will be declined");
    }
  });

  const shutdown = () => {
    for (const c of controllers.values()) c.abort();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

listen(PORT);
