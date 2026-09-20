import { spawn, execFile } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, chmodSync, statSync, readdirSync, copyFileSync, unlinkSync } from "node:fs";
import { rename, unlink, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import https from "node:https";
import http from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const BIN_DIR = join(__dirname, "bin");
export const TMP_DIR = join(__dirname, "tmp");

const isWin = process.platform === "win32";
const YTDLP_NAME = isWin ? "yt-dlp.exe" : "yt-dlp";
const YTDLP_PATH = join(BIN_DIR, YTDLP_NAME);
const FFMPEG_DIR = join(BIN_DIR, "ffmpeg");
const FFMPEG_BIN = join(FFMPEG_DIR, isWin ? "ffmpeg.exe" : "ffmpeg");
const FFPROBE_BIN = join(FFMPEG_DIR, isWin ? "ffprobe.exe" : "ffprobe");

const YTDLP_URL = isWin
  ? "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp.exe"
  : "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp";

const FFMPEG_ZIP_URL = isWin
  ? "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
  : process.platform === "darwin"
    ? null
    : "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz";

function ensureDirs() {
  for (const d of [BIN_DIR, TMP_DIR, FFMPEG_DIR]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

function fetchFollow(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 10) return reject(new Error("too many redirects"));
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          "User-Agent": "slugfetch/11.4",
          Accept: "*/*",
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const next = res.headers.location.startsWith("http")
            ? res.headers.location
            : new URL(res.headers.location, url).href;
          return resolve(fetchFollow(next, redirects + 1));
        }
        if (!res.statusCode || res.statusCode >= 400) {
          res.resume();
          return reject(new Error(`download failed http ${res.statusCode}`));
        }
        resolve(res);
      }
    );
    req.on("error", reject);
  });
}

async function downloadFile(url, dest) {
  const partial = dest + ".partial";
  try {
    if (existsSync(partial)) await unlink(partial);
  } catch {}
  const res = await fetchFollow(url);
  await pipeline(res, createWriteStream(partial));
  await rename(partial, dest);
}

let lastUpdateCheck = 0;
let lastForcedUpdate = 0;
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;

function scheduleYtDlpUpdate() {
  if (!existsSync(YTDLP_PATH) || Date.now() - lastUpdateCheck < UPDATE_INTERVAL_MS) return;
  lastUpdateCheck = Date.now();
  try {
    const c = spawn(YTDLP_PATH, ["-U"], { windowsHide: true, stdio: "ignore" });
    c.on("error", () => {});
  } catch {}
}

async function forceUpdateYtDlp() {
  if (Date.now() - lastForcedUpdate < UPDATE_INTERVAL_MS) return;
  lastForcedUpdate = Date.now();
  lastUpdateCheck = Date.now();
  if (!existsSync(YTDLP_PATH)) return;
  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    const t = setTimeout(finish, 120000);
    try {
      const c = spawn(YTDLP_PATH, ["-U"], { windowsHide: true, stdio: "ignore" });
      c.on("close", () => {
        clearTimeout(t);
        finish();
      });
      c.on("error", () => {
        clearTimeout(t);
        finish();
      });
    } catch {
      clearTimeout(t);
      finish();
    }
  });
}

export async function ensureYtDlp() {
  ensureDirs();
  if (existsSync(YTDLP_PATH)) {
    try {
      if (statSync(YTDLP_PATH).size > 100000) {
        scheduleYtDlpUpdate();
        return YTDLP_PATH;
      }
    } catch {}
  }
  await downloadFile(YTDLP_URL, YTDLP_PATH);
  if (!isWin) {
    try {
      chmodSync(YTDLP_PATH, 0o755);
    } catch {}
  }
  return YTDLP_PATH;
}

function which(bin) {
  return new Promise((resolve) => {
    const cmd = isWin ? "where" : "which";
    execFile(cmd, [bin], { windowsHide: true }, (err, stdout) => {
      if (err || !stdout?.trim()) return resolve(null);
      resolve(stdout.trim().split(/\r?\n/)[0]);
    });
  });
}

function runPs(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
    );
    let err = "";
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(err || `powershell exit ${code}`));
    });
    child.on("error", reject);
  });
}

function findInDir(dir, name) {
  if (!existsSync(dir)) return null;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.name.toLowerCase() === name.toLowerCase()) return full;
    }
  }
  return null;
}

export async function ensureFfmpeg() {
  ensureDirs();
  if (existsSync(FFMPEG_BIN)) return FFMPEG_DIR;

  const system = await which("ffmpeg");
  if (system) return dirname(system);

  if (!FFMPEG_ZIP_URL) return null;

  try {
    const zipPath = join(BIN_DIR, isWin ? "ffmpeg.zip" : "ffmpeg.tar.xz");
    if (!existsSync(zipPath) || statSync(zipPath).size < 1000000) {
      await downloadFile(FFMPEG_ZIP_URL, zipPath);
    }
    const extractTo = join(BIN_DIR, "ffmpeg-extract");
    try {
      await rm(extractTo, { recursive: true, force: true });
    } catch {}
    mkdirSync(extractTo, { recursive: true });

    if (isWin) {
      await runPs(`Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${extractTo.replace(/'/g, "''")}' -Force`);
    } else {
      await new Promise((resolve, reject) => {
        const child = spawn("tar", ["-xJf", zipPath, "-C", extractTo], { stdio: "ignore" });
        child.on("close", (c) => (c === 0 ? resolve() : reject(new Error("tar failed"))));
        child.on("error", reject);
      });
    }

    const foundFfmpeg = findInDir(extractTo, isWin ? "ffmpeg.exe" : "ffmpeg");
    const foundFfprobe = findInDir(extractTo, isWin ? "ffprobe.exe" : "ffprobe");
    if (!foundFfmpeg) return null;
    mkdirSync(FFMPEG_DIR, { recursive: true });
    copyFileSync(foundFfmpeg, FFMPEG_BIN);
    if (foundFfprobe) copyFileSync(foundFfprobe, FFPROBE_BIN);
    if (!isWin) {
      try {
        chmodSync(FFMPEG_BIN, 0o755);
        if (existsSync(FFPROBE_BIN)) chmodSync(FFPROBE_BIN, 0o755);
      } catch {}
    }
    try {
      await rm(extractTo, { recursive: true, force: true });
    } catch {}
    return FFMPEG_DIR;
  } catch {
    return null;
  }
}

export async function findFfmpeg(opts = {}) {
  if (existsSync(FFMPEG_BIN)) return FFMPEG_BIN;
  const system = await which("ffmpeg");
  if (system) return system;
  if (opts.download) {
    const ensured = await ensureFfmpeg();
    if (ensured && existsSync(join(ensured, isWin ? "ffmpeg.exe" : "ffmpeg"))) {
      return join(ensured, isWin ? "ffmpeg.exe" : "ffmpeg");
    }
    if (ensured && existsSync(FFMPEG_BIN)) return FFMPEG_BIN;
  }
  return null;
}

export function detectPlatform(rawUrl) {
  let host = "";
  try {
    host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    host = String(rawUrl || "").toLowerCase();
  }
  const has = (...names) => names.some((n) => host.includes(n));
  if (has("youtube.com", "youtu.be", "youtube-nocookie.com")) return "youtube";
  if (has("spotify.com", "spotify.link")) return "spotify";
  if (has("tiktok.com")) return "tiktok";
  if (has("twitter.com", "x.com", "t.co")) return "twitter";
  if (has("instagram.com", "instagr.am")) return "instagram";
  if (has("vimeo.com")) return "vimeo";
  if (has("soundcloud.com", "snd.sc")) return "soundcloud";
  if (has("twitch.tv")) return "twitch";
  if (has("reddit.com", "redd.it")) return "reddit";
  if (has("pinterest.", "pin.it")) return "pinterest";
  if (has("snapchat.com", "snap.com")) return "snapchat";
  if (has("facebook.com", "fb.watch", "fb.com")) return "facebook";
  if (has("bilibili.com", "b23.tv")) return "bilibili";
  if (has("rutube.ru")) return "rutube";
  if (has("vk.com", "vk.ru", "vkvideo.ru")) return "vk";
  if (has("loom.com")) return "loom";
  return "generic";
}

const AUDIO_ONLY_PLATFORMS = new Set(["spotify", "soundcloud"]);

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

function vimeoPlayerUrl(url) {
  const m = String(url).match(/vimeo\.com\/(?:video\/)?(\d+)(?:\/([0-9a-z]+))?/i);
  if (!m) return null;
  return m[2] ? `https://player.vimeo.com/video/${m[1]}?h=${m[2]}` : `https://player.vimeo.com/video/${m[1]}`;
}

function attemptMatrix(platform, cookieArgs, url) {
  const impersonate = ["--impersonate", "chrome"];
  const plain = (list) => list.map((args) => ({ args, url }));

  switch (platform) {
    case "youtube":
      return plain([
        [],
        ["--extractor-args", "youtube:player_client=default,tv,android,web_embedded,mediaconnect"],
        ["--extractor-args", "youtube:player_client=tv,android,ios,web_embedded", ...cookieArgs],
        ["--extractor-args", "youtube:player_client=tv,android,ios,web_embedded", ...impersonate, ...cookieArgs],
      ]);
    case "vimeo": {
      const player = vimeoPlayerUrl(url);
      const list = [];
      if (player && !/player\.vimeo\.com/i.test(url)) list.push({ args: [], url: player });
      list.push({ args: [], url });
      list.push({ args: ["--extractor-args", "vimeo:client=android"], url });
      list.push({ args: [...impersonate, ...cookieArgs], url });
      return list;
    }
    case "tiktok":
      return plain([
        [],
        ["--extractor-args", "tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com"],
        [...impersonate],
        ["--user-agent", MOBILE_UA, ...cookieArgs],
      ]);
    case "instagram":
    case "facebook":
    case "snapchat":
    case "pinterest": {
      const list = [];
      if (cookieArgs.length) list.push([...cookieArgs], [...impersonate, ...cookieArgs]);
      list.push([], [...impersonate], ["--user-agent", MOBILE_UA, ...impersonate, ...cookieArgs]);
      return plain(list);
    }
    case "twitter":
      return plain([[], ["--extractor-args", "twitter:api=syndication"], [...impersonate], [...impersonate, ...cookieArgs]]);
    case "reddit":
      return plain([[], [...impersonate], ["--user-agent", MOBILE_UA], [...cookieArgs]]);
    case "bilibili":
    case "vk":
    case "rutube":
      return plain([[], [...impersonate], [...cookieArgs]]);
    case "twitch":
      return plain([[], [...impersonate], [...cookieArgs]]);
    case "soundcloud":
    case "loom":
      return plain([[], [...impersonate], [...cookieArgs]]);
    default:
      return plain([[], [...impersonate], [...cookieArgs]]);
  }
}

function qualityToFormat(mode, quality, format, bitrate, hasFfmpeg, container) {
  const q = String(quality || "1080").replace(/p$/i, "");
  const height =
    q === "8k" || q === "4320" ? 4320 :
    q === "4k" || q === "2160" ? 2160 :
    parseInt(q, 10) || 1080;
  const br = String(parseInt(String(bitrate || "128"), 10) || 128);

  if (mode === "audio") {
    const af = !format || format === "best" ? "mp3" : format;
    if (hasFfmpeg) {
      const out = af === "flac" ? "flac" : af === "wav" ? "wav" : af === "opus" ? "opus" : af === "ogg" ? "vorbis" : "mp3";
      const ext = af === "ogg" ? "ogg" : out === "vorbis" ? "ogg" : out === "mp3" ? "mp3" : out;
      return {
        format: "bestaudio/best",
        post: ["-x", "--audio-format", out === "vorbis" ? "vorbis" : out, "--audio-quality", af === "wav" || af === "flac" ? "0" : br + "K"],
        ext: ext === "vorbis" ? "ogg" : ext,
      };
    }
    return {
      format: "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best",
      post: [],
      ext: "m4a",
    };
  }

  const box = container === "webm" || container === "mkv" ? container : "mp4";

  if (mode === "mute") {
    if (hasFfmpeg) {
      return {
        format: `bestvideo[height<=${height}][ext=mp4]/bestvideo[height<=${height}]/bestvideo/best[height<=${height}]/best`,
        post: ["--merge-output-format", box],
        ext: box,
      };
    }
    return {
      format: `best[height<=${height}][ext=mp4]/best[height<=${height}]/best`,
      post: [],
      ext: "mp4",
    };
  }

  if (hasFfmpeg) {
    const preferred =
      box === "webm"
        ? `bestvideo[height<=${height}][ext=webm]+bestaudio[ext=webm]/bestvideo[height<=${height}]+bestaudio`
        : `bestvideo[height<=${height}][vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${height}]+bestaudio`;
    return {
      format: `${preferred}/best[height<=${height}]/best`,
      post: ["--merge-output-format", box],
      ext: box,
    };
  }
  return {
    format: `best[height<=${height}][ext=mp4]/best[height<=${height}]/best`,
    post: [],
    ext: "mp4",
  };
}

function parseProgressLine(line) {
  const pct = line.match(/(\d+(?:\.\d+)?)%/);
  const speed = line.match(/at\s+([0-9.]+[KMG]?i?B\/s)/i) || line.match(/([0-9.]+[KMG]?i?B\/s)/i);
  const eta = line.match(/ETA\s+([0-9:]+)/i);
  const total = line.match(/of\s+~?([0-9.]+[KMG]?i?B)/i);
  const loaded = line.match(/^\s*\[download\]\s+([0-9.]+[KMG]?i?B)\s+of/i);

  const parseSize = (s) => {
    if (!s) return undefined;
    const m = String(s).match(/([0-9.]+)\s*([KMG])?i?B/i);
    if (!m) return undefined;
    const n = parseFloat(m[1]);
    const u = (m[2] || "").toUpperCase();
    if (u === "G") return n * 1024 * 1024 * 1024;
    if (u === "M") return n * 1024 * 1024;
    if (u === "K") return n * 1024;
    return n;
  };

  const parseEta = (s) => {
    if (!s) return undefined;
    const parts = s.split(":").map(Number);
    if (parts.some((x) => Number.isNaN(x))) return undefined;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0];
  };

  return {
    pct: pct ? Math.min(99, Math.max(1, parseFloat(pct[1]))) : undefined,
    speed: speed ? parseSize(speed[1].replace(/\/s$/i, "")) : undefined,
    eta: eta ? parseEta(eta[1]) : undefined,
    total: total ? parseSize(total[1]) : undefined,
    loaded: loaded ? parseSize(loaded[1]) : undefined,
  };
}

function findOutputByPrefix(prefix) {
  try {
    const files = readdirSync(TMP_DIR)
      .filter((n) => n.startsWith(prefix) && !n.endsWith(".part") && !n.endsWith(".ytdl") && !n.endsWith(".temp") && !/\.f\d+\./.test(n))
      .map((n) => join(TMP_DIR, n))
      .filter((p) => {
        try {
          return statSync(p).isFile() && statSync(p).size > 0;
        } catch {
          return false;
        }
      })
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    return files[0] || null;
  } catch {
    return null;
  }
}

function resolveFinalUrl(url, redirects = 0) {
  return new Promise((resolve) => {
    if (redirects > 8) return resolve(url);
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(
      url,
      { headers: { "User-Agent": "Mozilla/5.0", Accept: "*/*" } },
      (res) => {
        const loc = res.headers.location;
        res.resume();
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc) {
          const next = loc.startsWith("http") ? loc : new URL(loc, url).href;
          return resolve(resolveFinalUrl(next, redirects + 1));
        }
        resolve(url);
      }
    );
    req.on("error", () => resolve(url));
    req.setTimeout(10000, () => {
      req.destroy();
      resolve(url);
    });
  });
}

function fetchJson(url) {
  return new Promise((resolve) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(
      url,
      { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            resolve(null);
          }
        });
        res.on("error", () => resolve(null));
      }
    );
    req.on("error", () => resolve(null));
    req.setTimeout(10000, () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function spotifyQuery(url) {
  let target = url;
  if (/spotify\.link|spotify\.app\.link/i.test(url)) {
    target = await resolveFinalUrl(url);
  }
  if (!/open\.spotify\.com\//i.test(target)) return null;
  const data = await fetchJson(`https://open.spotify.com/oembed?url=${encodeURIComponent(target)}`);
  const title = data && data.title ? String(data.title).trim() : "";
  return title || null;
}

export const COOKIE_FILE = join(BIN_DIR, "cookies.txt");

export function hasCookieFile() {
  try {
    return existsSync(COOKIE_FILE) && statSync(COOKIE_FILE).size > 32;
  } catch {
    return false;
  }
}

export function clearCookieFile() {
  try {
    if (existsSync(COOKIE_FILE)) unlinkSync(COOKIE_FILE);
    return true;
  } catch {
    return false;
  }
}

function cookieBrowser() {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const candidates = isWin
    ? [["firefox", join(process.env.APPDATA || "", "Mozilla", "Firefox", "Profiles")]]
    : process.platform === "darwin"
      ? [
          ["firefox", join(home, "Library", "Application Support", "Firefox", "Profiles")],
          ["safari", join(home, "Library", "Cookies")],
        ]
      : [
          ["firefox", join(home, ".mozilla", "firefox")],
          ["chromium", join(home, ".config", "chromium")],
        ];
  for (const [name, dir] of candidates) {
    try {
      if (dir && existsSync(dir) && readdirSync(dir).length) return name;
    } catch {}
  }
  return null;
}

function cleanupPrefix(prefix) {
  try {
    for (const n of readdirSync(TMP_DIR)) {
      if (n.startsWith(prefix)) {
        try {
          unlinkSync(join(TMP_DIR, n));
        } catch {}
      }
    }
  } catch {}
}

function attemptDownload(bin, args, prefix, fmtExt, signal, onProgress) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });

    let stdout = "";
    let stderr = "";
    let killed = false;
    let stage = 0;
    let lastPct = 0;

    const scale = (raw) => {
      const span = stage >= 2 ? [62, 92] : [6, 62];
      const v = span[0] + (Math.max(0, Math.min(100, raw)) / 100) * (span[1] - span[0]);
      lastPct = Math.max(lastPct, Math.round(v));
      return lastPct;
    };

    const onAbort = () => {
      killed = true;
      try {
        if (isWin) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        else {
          child.kill("SIGTERM");
          setTimeout(() => {
            try {
              child.kill("SIGKILL");
            } catch {}
          }, 1500);
        }
      } catch {}
    };

    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    const handleLine = (line) => {
      if (!line.trim()) return;
      if (/^\s*\[download\]\s+Destination:/i.test(line)) stage++;
      const p = parseProgressLine(line);
      if (p.pct != null || p.speed != null) {
        onProgress?.({
          pct: scale(p.pct ?? 0),
          status: "downloading",
          speed: p.speed,
          eta: p.eta,
          loaded: p.loaded,
          total: p.total,
        });
      } else if (/Merger|ExtractAudio|VideoConvertor|VideoRemuxer|Post-process|Embedding/i.test(line)) {
        lastPct = Math.max(lastPct, 94);
        onProgress?.({ pct: lastPct, status: "converting", speed: 0, eta: 0 });
      } else if (/Extracting URL|Downloading webpage|Downloading .*API|player/i.test(line)) {
        onProgress?.({ pct: Math.max(lastPct, 5), status: "extracting" });
      }
    };

    const pump = (buf, into) => {
      const text = buf.toString();
      if (into === "out") stdout += text;
      else stderr += text;
      for (const line of text.split(/[\r\n]+/)) handleLine(line);
    };

    child.stdout.on("data", (buf) => pump(buf, "out"));
    child.stderr.on("data", (buf) => pump(buf, "err"));

    child.on("error", (err) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      reject(err);
    });

    child.on("close", (code) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      if (killed || signal?.aborted) {
        return reject(Object.assign(new Error("cancelled"), { code: "CANCELLED" }));
      }

      let filepath =
        findOutputByPrefix(prefix) ||
        stdout
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l && (l.includes("/") || l.includes("\\") || /\.\w{2,5}$/.test(l)))
          .map((l) => l.replace(/^["']|["']$/g, ""))
          .reverse()
          .find((p) => existsSync(p));

      if (code !== 0 && !filepath) {
        const msg =
          stderr
            .split(/\r?\n/)
            .filter((l) => /ERROR/i.test(l))
            .pop() ||
          stderr.trim().slice(-500) ||
          `yt-dlp exited with code ${code}`;
        return reject(new Error(msg.replace(/^ERROR:\s*/i, "").trim()));
      }

      if (!filepath || !existsSync(filepath)) {
        return reject(new Error("download finished but no output file was found"));
      }

      const base = filepath.split(/[/\\]/).pop() || "";
      const pretty = base.startsWith(`${prefix}__`) ? base.slice(prefix.length + 2) : base;

      resolve({
        filepath,
        filename: pretty || base,
        ext: filepath.split(".").pop() || fmtExt,
      });
    });
  });
}

function isFatalError(err) {
  const m = err instanceof Error ? err.message : String(err || "");
  return /(?:video|track|content) is DRM protected|has been removed|no longer available|does not exist|Unsupported URL|is not a valid URL|account (?:has been )?terminated|copyright grounds|live event will begin|members-only/i.test(
    m
  );
}

function needsFormatProbe(err) {
  const m = err instanceof Error ? err.message : String(err || "");
  return /format is DRM protected|Requested format is not available|check-formats/i.test(m);
}

function isStaleExtractorError(err) {
  if (!err) return false;
  const m = err instanceof Error ? err.message : String(err);
  return /Unable to extract|Failed to extract|nsig|signature|player response|no video formats|Unable to download (?:API|JSON)/i.test(m);
}

export function runDownload(opts) {
  const {
    url,
    mode = "auto",
    quality = "1080",
    format = "mp3",
    bitrate = "128",
    startTime,
    endTime,
    subtitles,
    subtitleLang,
    outTemplate,
    jobId,
    signal,
    onProgress,
  } = opts;

  return new Promise(async (resolve, reject) => {
    let bin;
    try {
      bin = await ensureYtDlp();
    } catch (e) {
      return reject(e);
    }

    onProgress?.({ pct: 3, status: "preparing" });
    let ffmpegPath = null;
    try {
      ffmpegPath = await findFfmpeg({ download: true });
    } catch {
      ffmpegPath = null;
    }
    const hasFfmpeg = !!ffmpegPath;
    const platform = detectPlatform(url);
    const effectiveMode = AUDIO_ONLY_PLATFORMS.has(platform) && mode !== "mute" ? "audio" : mode;
    const fmt = qualityToFormat(effectiveMode, quality, format, bitrate, hasFfmpeg, opts.container);

    const prefix = jobId || `dl_${Date.now()}`;
    const template = outTemplate || join(TMP_DIR, `${prefix}__%(title).100B.%(ext)s`);

    let target = url;
    if (platform === "spotify") {
      onProgress?.({ pct: 4, status: "resolving" });
      try {
        const q = await spotifyQuery(url);
        if (q) target = `ytsearch1:${q.replace(/["']/g, "")}`;
      } catch {}
      if (target === url) {
        return reject(new Error("could not resolve this spotify link, try the track page url"));
      }
    }

    const args = [
      "--no-playlist",
      "--no-warnings",
      "--newline",
      "--progress",
      "--windows-filenames",
      "--no-mtime",
      "--retries", "8",
      "--fragment-retries", "8",
      "--extractor-retries", "3",
      "--file-access-retries", "3",
      "-N", "8",
      "--http-chunk-size", "10M",
      "--force-ipv4",
      "--geo-bypass",
      "--no-check-certificates",
      "-o",
      template,
      "-f",
      fmt.format,
      ...fmt.post,
    ];

    if (startTime || endTime) {
      const s = startTime || "0";
      const e = endTime || "";
      args.push("--download-sections", `*${s}-${e}`);
      args.push("--force-keyframes-at-cuts");
    }

    if (subtitles && hasFfmpeg) {
      args.push("--write-subs", "--write-auto-subs", "--embed-subs", "--sub-format", "srt/best");
      if (subtitleLang && subtitleLang !== "none") args.push("--sub-langs", `${subtitleLang}.*`);
      else args.push("--sub-langs", "en.*,en");
    }

    if (ffmpegPath) {
      args.push("--ffmpeg-location", dirname(ffmpegPath));
    }

    const cookieArgs = [];
    if (hasCookieFile()) {
      cookieArgs.push("--cookies", COOKIE_FILE);
    } else {
      try {
        const cb = cookieBrowser();
        if (cb) cookieArgs.push("--cookies-from-browser", cb);
      } catch {}
    }

    const attempts = attemptMatrix(platform, cookieArgs, target);

    let lastErr = null;
    let drmErr = null;
    let probeFormats = false;
    for (let i = 0; i < attempts.length; i++) {
      if (signal?.aborted) {
        return reject(Object.assign(new Error("cancelled"), { code: "CANCELLED" }));
      }
      if (i > 0) {
        onProgress?.({ pct: 6, status: "retrying" });
        cleanupPrefix(prefix);
      }
      const extra = probeFormats ? ["--check-formats"] : [];
      if (i === attempts.length - 1 && isStaleExtractorError(lastErr)) {
        onProgress?.({ pct: 6, status: "updating engine" });
        await forceUpdateYtDlp();
      }
      try {
        const attempt = attempts[i];
        const res = await attemptDownload(
          bin,
          [...args, ...attempt.args, ...extra, "--", attempt.url || target],
          prefix,
          fmt.ext,
          signal,
          onProgress
        );
        return resolve(res);
      } catch (e) {
        if (e?.code === "CANCELLED" || signal?.aborted) {
          return reject(Object.assign(new Error("cancelled"), { code: "CANCELLED" }));
        }
        lastErr = e;
        if (!drmErr && /DRM protected/i.test(e?.message || "")) drmErr = e;
        if (!probeFormats && needsFormatProbe(e)) {
          probeFormats = true;
          i--;
          continue;
        }
        if (isFatalError(e)) break;
      }
    }
    reject(drmErr || lastErr || new Error("download failed"));
  });
}

export const REMUX_TARGETS = {
  mp4: { ext: "mp4", kind: "video" },
  webm: { ext: "webm", kind: "video" },
  mkv: { ext: "mkv", kind: "video" },
  mp3: { ext: "mp3", kind: "audio" },
  wav: { ext: "wav", kind: "audio" },
  m4a: { ext: "m4a", kind: "audio" },
  ogg: { ext: "ogg", kind: "audio" },
  flac: { ext: "flac", kind: "audio" },
};

function ffprobeInfo(input) {
  return new Promise((resolve) => {
    const bin = existsSync(FFPROBE_BIN) ? FFPROBE_BIN : "ffprobe";
    execFile(
      bin,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type,codec_name",
        "-of",
        "json",
        input,
      ],
      { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve({ duration: 0, video: null, audio: null });
        try {
          const data = JSON.parse(stdout);
          const streams = data.streams || [];
          resolve({
            duration: Number(data.format?.duration) || 0,
            video: streams.find((s) => s.codec_type === "video")?.codec_name || null,
            audio: streams.find((s) => s.codec_type === "audio")?.codec_name || null,
          });
        } catch {
          resolve({ duration: 0, video: null, audio: null });
        }
      }
    );
  });
}

function remuxPlans(target, info, bitrateKbps) {
  const br = `${parseInt(String(bitrateKbps || 192), 10) || 192}k`;
  const vcopy = ["-c:v", "copy"];
  const acopy = ["-c:a", "copy"];

  switch (target) {
    case "mp4": {
      const videoOk = /^(h264|hevc|mpeg4|av1)$/i.test(info.video || "");
      const audioOk = /^(aac|mp3|alac)$/i.test(info.audio || "");
      const plans = [];
      if (info.video && videoOk && audioOk) plans.push([...vcopy, ...acopy, "-movflags", "+faststart"]);
      if (info.video && videoOk) plans.push([...vcopy, "-c:a", "aac", "-b:a", br, "-movflags", "+faststart"]);
      plans.push([
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", br, "-movflags", "+faststart",
      ]);
      return plans;
    }
    case "mkv": {
      const plans = [[...vcopy, ...acopy]];
      plans.push(["-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-c:a", "aac", "-b:a", br]);
      return plans;
    }
    case "webm": {
      const plans = [];
      if (/^(vp8|vp9|av1)$/i.test(info.video || "") && /^(opus|vorbis)$/i.test(info.audio || "")) {
        plans.push([...vcopy, ...acopy]);
      }
      plans.push([
        "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "34", "-row-mt", "1", "-cpu-used", "5",
        "-c:a", "libopus", "-b:a", br,
      ]);
      return plans;
    }
    case "mp3":
      return [["-vn", "-c:a", "libmp3lame", "-b:a", br, "-id3v2_version", "3"]];
    case "wav":
      return [["-vn", "-c:a", "pcm_s16le", "-ar", "44100"]];
    case "m4a": {
      const plans = [];
      if (/^aac$/i.test(info.audio || "")) plans.push(["-vn", "-c:a", "copy", "-movflags", "+faststart"]);
      plans.push(["-vn", "-c:a", "aac", "-b:a", br, "-movflags", "+faststart"]);
      return plans;
    }
    case "ogg":
      return [["-vn", "-c:a", "libvorbis", "-b:a", br]];
    case "flac":
      return [["-vn", "-c:a", "flac"]];
    default:
      return [[...vcopy, ...acopy]];
  }
}

function runFfmpeg(bin, args, duration, signal, onProgress) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let killed = false;

    const onAbort = () => {
      killed = true;
      try {
        if (isWin) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        else child.kill("SIGKILL");
      } catch {}
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.on("data", (buf) => {
      for (const line of buf.toString().split(/\r?\n/)) {
        const m = line.match(/^out_time_ms=(\d+)/);
        if (m && duration > 0) {
          const sec = Number(m[1]) / 1_000_000;
          const pct = Math.max(5, Math.min(98, Math.round((sec / duration) * 100)));
          onProgress?.({ pct, status: "converting" });
        } else if (/^progress=end/.test(line)) {
          onProgress?.({ pct: 99, status: "finishing" });
        }
      }
    });

    child.stderr.on("data", (buf) => {
      stderr += buf.toString();
      if (stderr.length > 200000) stderr = stderr.slice(-100000);
    });

    child.on("error", (err) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      reject(err);
    });

    child.on("close", (code) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      if (killed || signal?.aborted) {
        return reject(Object.assign(new Error("cancelled"), { code: "CANCELLED" }));
      }
      if (code !== 0) {
        const line =
          stderr.split(/\r?\n/).filter((l) => l.trim() && !/^\s*(configuration|lib\w+|built with)/i.test(l)).pop() ||
          `ffmpeg exited with code ${code}`;
        return reject(new Error(line.slice(0, 300)));
      }
      resolve();
    });
  });
}

export async function runRemux(opts) {
  const { inputPath, target, outputPath, bitrate, signal, onProgress } = opts;
  const bin = await findFfmpeg({ download: true });
  if (!bin) throw new Error("ffmpeg is not available on this server");
  if (!existsSync(inputPath)) throw new Error("uploaded file is missing");

  onProgress?.({ pct: 3, status: "inspecting" });
  const info = await ffprobeInfo(inputPath);
  const wantsAudioOnly = REMUX_TARGETS[target]?.kind === "audio";
  if (wantsAudioOnly && !info.audio) throw new Error("this file has no audio track to extract");
  if (!wantsAudioOnly && !info.video && !info.audio) throw new Error("unreadable media file");

  const plans = remuxPlans(target, info, bitrate);
  let lastErr = null;

  for (let i = 0; i < plans.length; i++) {
    if (signal?.aborted) throw Object.assign(new Error("cancelled"), { code: "CANCELLED" });
    try {
      safeRemove(outputPath);
      onProgress?.({ pct: 5, status: i === 0 ? "converting" : "re-encoding" });
      await runFfmpeg(
        bin,
        [
          "-hide_banner",
          "-nostdin",
          "-y",
          "-progress", "pipe:1",
          "-nostats",
          "-i", inputPath,
          ...plans[i],
          outputPath,
        ],
        info.duration,
        signal,
        onProgress
      );
      if (existsSync(outputPath) && statSync(outputPath).size > 256) {
        return { filepath: outputPath, size: statSync(outputPath).size, duration: info.duration };
      }
      lastErr = new Error("conversion produced an empty file");
    } catch (e) {
      if (e?.code === "CANCELLED" || signal?.aborted) throw e;
      lastErr = e;
    }
  }
  throw lastErr || new Error("conversion failed");
}

function safeRemove(p) {
  try {
    if (p && existsSync(p)) unlinkSync(p);
  } catch {}
}

export async function probeReady() {
  ensureDirs();
  let ytdlp = false;
  try {
    await ensureYtDlp();
    ytdlp = true;
  } catch {
    ytdlp = false;
  }
  let ffmpeg = false;
  try {
    ffmpeg = !!(await findFfmpeg());
  } catch {
    ffmpeg = false;
  }
  return { ytdlp, ffmpeg, bin: YTDLP_PATH, ffmpegBin: ffmpeg ? FFMPEG_BIN : null };
}
