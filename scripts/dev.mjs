import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import net from "node:net";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.SLUGFETCH_PORT || 8787);
const children = [];

function freePort(port) {
  try {
    if (process.platform === "win32") {
      const out = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf8" });
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        if (!/LISTENING/i.test(line)) continue;
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid) && pid !== "0") pids.add(pid);
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /F /T`, { stdio: "ignore" });
        } catch {}
      }
    } else {
      try {
        execSync(`fuser -k ${port}/tcp`, { stdio: "ignore" });
      } catch {}
    }
  } catch {}
}

function waitPortFree(port, tries = 20) {
  return new Promise(async (resolve) => {
    for (let i = 0; i < tries; i++) {
      const free = await new Promise((res) => {
        const s = net.createServer();
        s.once("error", () => res(false));
        s.once("listening", () => s.close(() => res(true)));
        s.listen(port, "127.0.0.1");
      });
      if (free) return resolve(true);
      freePort(port);
      await new Promise((r) => setTimeout(r, 200));
    }
    resolve(false);
  });
}

function run(command, name) {
  const child = spawn(command, {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, SLUGFETCH_PORT: String(PORT) },
  });
  child.on("exit", (code, signal) => {
    if (signal) return;
    if (code && code !== 0) console.error(`[${name}] exited with code ${code}`);
    shutdown(code || 0);
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  for (const c of children) {
    try {
      if (process.platform === "win32" && c.pid) {
        try {
          execSync(`taskkill /PID ${c.pid} /F /T`, { stdio: "ignore" });
        } catch {
          c.kill();
        }
      } else {
        c.kill("SIGTERM");
      }
    } catch {}
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

freePort(PORT);
await waitPortFree(PORT);
run(`node "${join(root, "server", "index.js")}"`, "api");
run(`npx vite --host 127.0.0.1`, "web");
