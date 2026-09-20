import { memo, type ReactNode } from "react";
import { formatBytes, formatSpeed, formatEta, type ServerHealth } from "./api";
import type { BgColors } from "./Background";

export const cn = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

export type QueueStatus = "queued" | "processing" | "paused" | "done" | "error" | "cancelled";

export interface QueueItem {
  id: string;
  name: string;
  url: string;
  platform: string;
  kind: string;
  progress: number;
  status: QueueStatus;
  fileUrl?: string;
  filename?: string;
  error?: string;
  speed?: number;
  eta?: number;
  loaded?: number;
  total?: number;
  statusText?: string;
  isLocal?: boolean;
  localFile?: File;
  localName?: string;
  remuxTarget?: string;
  mobile?: boolean;
  saved?: boolean;
  mode?: "auto" | "audio" | "mute";
  quality?: string;
  format?: string;
}

export interface QueueActions {
  save: (item: QueueItem) => void;
  pause: (id: string) => void;
  resume: (id: string) => void;
  cancel: (id: string) => void;
  remove: (id: string) => void;
}

export const Toggle = memo(function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative w-11 h-6 rounded-full shrink-0 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950",
        checked ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ease-out",
          checked && "translate-x-5"
        )}
      />
    </button>
  );
});

export function Segment<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-xl bg-zinc-100 dark:bg-zinc-800/80 p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "px-3 py-1.5 text-sm rounded-[10px] transition-all duration-200",
            value === o.id
              ? "bg-white dark:bg-zinc-950 shadow-sm text-zinc-900 dark:text-white"
              : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const Toasts = memo(function Toasts({ items }: { items: { id: string; text: string }[] }) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-2 pointer-events-none">
      {items.map((t) => (
        <div
          key={t.id}
          className="px-4 py-2 rounded-full bg-zinc-900/95 dark:bg-white/95 text-white dark:text-zinc-900 text-xs font-medium shadow-lg backdrop-blur max-w-[90vw] truncate animate-toastIn"
        >
          {t.text}
        </div>
      ))}
    </div>
  );
});

export const ConfirmDialog = memo(function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "yes",
  cancelLabel = "no",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[70] grid place-items-center px-4 bg-zinc-950/60 backdrop-blur-sm animate-fadeIn"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm p-5 rounded-2xl border border-red-400/40 bg-white dark:bg-zinc-950 shadow-2xl animate-riseIn"
      >
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.48 0l-7.1 12.25A2 2 0 005 19z"
            />
          </svg>
          <p className="text-sm font-semibold text-red-500 tracking-wide">{title}</p>
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed mb-5">{message}</p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-sm transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 active:scale-95 text-white text-sm font-medium transition-all duration-150"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
});

export const ServerBanner = memo(function ServerBanner({
  health,
  local,
}: {
  health: ServerHealth | null;
  local?: boolean;
}) {
  if (!health || health.ok) return null;
  return (
    <div className="mb-4 px-3.5 py-2.5 rounded-xl border border-amber-400/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-xs leading-relaxed">
      {local ? (
        <>
          can't reach the slugfetch engine. start it with <span className="font-mono">npm run dev</span>, then this banner
          goes away.
        </>
      ) : (
        <>
          the download engine is offline right now, so saving and converting are paused. browsing still works and nothing
          you have saved is lost.
        </>
      )}
    </div>
  );
});

export const QueueCard = memo(function QueueCard({ item, actions }: { item: QueueItem; actions: QueueActions }) {
  const busy = item.status === "processing" || item.status === "queued";
  const pct = Math.max(item.status === "queued" ? 0 : 2, Math.min(100, item.progress));

  return (
    <div
      className={cn(
        "p-3.5 rounded-2xl bg-white/70 dark:bg-zinc-900/60 backdrop-blur border transition-colors duration-300",
        item.status === "error"
          ? "border-red-400/40"
          : item.status === "done"
            ? "border-emerald-400/40"
            : "border-zinc-200 dark:border-zinc-800"
      )}
    >
      <div className="flex items-center justify-between text-sm mb-2.5 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-500 capitalize shrink-0">
            {item.platform}
          </span>
          <span className="truncate" title={item.filename || item.name}>
            {item.filename || item.name}
          </span>
        </div>
        <span
          className={cn(
            "text-xs shrink-0 flex items-center gap-1.5",
            item.status === "done" && "text-emerald-600 dark:text-emerald-400",
            item.status === "error" && "text-red-500",
            item.status === "cancelled" && "text-zinc-400",
            item.status === "paused" && "text-amber-500",
            busy && "text-zinc-500"
          )}
        >
          {item.status === "processing" && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
          {item.statusText || item.status}
        </span>
      </div>

      {item.error && <p className="text-xs text-red-500 mb-2 break-words leading-relaxed">{item.error}</p>}

      <div className="h-1.5 rounded-full bg-zinc-200/80 dark:bg-zinc-800 overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500 ease-out",
            item.status === "error"
              ? "bg-red-500"
              : item.status === "done"
                ? "bg-emerald-500"
                : item.status === "paused"
                  ? "bg-amber-400"
                  : "bg-gradient-to-r from-emerald-400 to-emerald-500"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      {(item.status === "processing" || item.status === "done") && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-zinc-500 tabular-nums">
          <span>{item.progress}%</span>
          {item.total != null && item.total > 0 && (
            <span>
              {item.status === "done"
                ? formatBytes(item.total)
                : `${formatBytes(item.loaded)} / ${formatBytes(item.total)}`}
            </span>
          )}
          {item.status === "processing" && item.speed != null && item.speed > 0 && <span>{formatSpeed(item.speed)}</span>}
          {item.status === "processing" && item.eta != null && item.eta > 0 && <span>eta {formatEta(item.eta)}</span>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-2.5">
        {item.status === "done" && (
          <>
            <button
              onClick={() => actions.save(item)}
              className="px-3 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white text-xs font-medium transition-all duration-150"
            >
              {item.saved ? "save again" : "save"}
            </button>
            <button
              onClick={() => actions.remove(item.id)}
              className="px-3 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-xs transition-colors"
            >
              dismiss
            </button>
            {item.saved && <span className="text-[10px] text-emerald-600 dark:text-emerald-400">sent to your downloads</span>}
          </>
        )}
        {busy && (
          <>
            <button onClick={() => actions.pause(item.id)} className="text-xs text-amber-600 dark:text-amber-400 hover:underline">
              pause
            </button>
            <button onClick={() => actions.cancel(item.id)} className="text-xs text-zinc-400 hover:text-red-500 transition-colors">
              cancel
            </button>
          </>
        )}
        {item.status === "paused" && (
          <>
            <button onClick={() => actions.resume(item.id)} className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline">
              resume
            </button>
            <button onClick={() => actions.cancel(item.id)} className="text-xs text-zinc-400 hover:text-red-500 transition-colors">
              cancel
            </button>
          </>
        )}
        {(item.status === "error" || item.status === "cancelled") && (
          <>
            {(item.url.startsWith("http") || item.localFile) && (
              <button onClick={() => actions.resume(item.id)} className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline">
                try again
              </button>
            )}
            <button
              onClick={() => actions.remove(item.id)}
              className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              remove
            </button>
          </>
        )}
      </div>
    </div>
  );
});

export const QueuePanel = memo(function QueuePanel({
  queue,
  actions,
  onClearDone,
  title = "processing queue",
}: {
  queue: QueueItem[];
  actions: QueueActions;
  onClearDone: () => void;
  title?: string;
}) {
  if (queue.length === 0) return null;
  const active = queue.filter((i) => i.status === "processing" || i.status === "queued").length;

  return (
    <div id="queue-section" className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" opacity=".25" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v6l2 3" />
          </svg>
          {title}
          <span className="text-xs text-zinc-400 font-normal">{active} active</span>
        </div>
        <button onClick={onClearDone} className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
          clear done
        </button>
      </div>
      <div className="space-y-2">
        {queue.map((item) => (
          <QueueCard key={item.id} item={item} actions={actions} />
        ))}
      </div>
    </div>
  );
});

export const NavButton = memo(function NavButton({
  label,
  current,
  onClick,
  icon,
}: {
  label: string;
  current: boolean;
  onClick: () => void;
  icon: ReactNode;
}) {
  return (
    <div className="group relative">
      <button
        onClick={onClick}
        aria-label={label}
        className={cn(
          "p-2.5 rounded-xl transition-all duration-200",
          current
            ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
            : "text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200"
        )}
      >
        {icon}
      </button>
      <span
        className={cn(
          "pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 z-50",
          "px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap",
          "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 shadow-lg",
          "opacity-0 -translate-x-1 transition-all duration-200 ease-out",
          "group-hover:opacity-100 group-hover:translate-x-0"
        )}
      >
        {label}
      </span>
    </div>
  );
});

const NAV_ICONS: Record<string, ReactNode> = {
  save: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  ),
  remux: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  ),
  history: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  settings: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  donate: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
    </svg>
  ),
  updates: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 01-2 2v11a2 2 0 012 2h11a2 2 0 012-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  ),
  about: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
};

export const SideNav = memo(function SideNav({
  page,
  onNavigate,
}: {
  page: string;
  onNavigate: (p: string) => void;
}) {
  const top = [
    ["save", "save"],
    ["remux", "remux"],
    ["history", "history"],
  ];
  const bottom = [
    ["settings", "settings"],
    ["donate", "donation"],
    ["updates", "updates"],
    ["about", "about"],
  ];

  return (
    <aside className="hidden lg:flex lg:flex-col lg:items-center lg:py-3 lg:bg-zinc-100/90 dark:lg:bg-zinc-950/90 lg:backdrop-blur lg:border-r lg:border-zinc-200 dark:lg:border-zinc-800 lg:z-40 lg:w-14 lg:fixed lg:top-0 lg:left-0 lg:h-full">
      {top.map(([id, label]) => (
        <NavButton key={id} label={label} current={page === id} onClick={() => onNavigate(id)} icon={NAV_ICONS[id]} />
      ))}
      <div className="flex-1" />
      {bottom.map(([id, label]) => (
        <NavButton key={id} label={label} current={page === id} onClick={() => onNavigate(id)} icon={NAV_ICONS[id]} />
      ))}
    </aside>
  );
});

export const BgCustomizer = memo(function BgCustomizer({
  bg,
  setBg,
  defaultBg,
  open,
  setOpen,
}: {
  bg: BgColors;
  setBg: (fn: BgColors | ((b: BgColors) => BgColors)) => void;
  defaultBg: BgColors;
  open: boolean;
  setOpen: (fn: boolean | ((v: boolean) => boolean)) => void;
}) {
  const presets: BgColors[] = [
    { c1: "#34d399", c2: "#60a5fa", c3: "#e879f9" },
    { c1: "#f87171", c2: "#fbbf24", c3: "#a78bfa" },
    { c1: "#22d3ee", c2: "#2dd4bf", c3: "#84cc16" },
    { c1: "#f472b6", c2: "#c084fc", c3: "#818cf8" },
    { c1: "#fb923c", c2: "#ef4444", c3: "#f59e0b" },
    { c1: "#94a3b8", c2: "#64748b", c3: "#475569" },
  ];

  return (
    <div className="fixed bottom-6 right-2 z-50 flex flex-col items-end">
      <div
        className={cn(
          "origin-bottom-right transition-all duration-200 ease-out mb-3",
          open ? "scale-100 opacity-100 pointer-events-auto" : "scale-90 opacity-0 pointer-events-none absolute bottom-14 right-0"
        )}
      >
        <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 backdrop-blur shadow-xl w-64">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium">background</p>
            <button onClick={() => setBg(defaultBg)} className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
              reset
            </button>
          </div>
          <div className="space-y-2.5">
            {([["c1", "blob 1 color"], ["c2", "blob 2 color"], ["c3", "blob 3 color"]] as const).map(([key, label]) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">{label}</span>
                <input
                  type="color"
                  value={bg[key]}
                  onChange={(e) => setBg((b) => ({ ...b, [key]: e.target.value }))}
                  className="w-8 h-8 rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent cursor-pointer"
                  title={label}
                />
              </div>
            ))}
          </div>
          <p className="text-[10px] text-zinc-400 mt-3 mb-1.5">presets</p>
          <div className="flex gap-1.5 flex-wrap">
            {presets.map((p, i) => (
              <button
                key={i}
                onClick={() => setBg(p)}
                className="w-6 h-6 rounded-full border border-white/40 dark:border-zinc-700 hover:scale-110 transition-transform"
                style={{ background: `linear-gradient(135deg, ${p.c1}, ${p.c2}, ${p.c3})` }}
                aria-label={`preset ${i + 1}`}
              />
            ))}
          </div>
        </div>
      </div>
      <button
        onClick={() => setOpen((s) => !s)}
        className="w-11 h-11 rounded-full bg-white/90 dark:bg-zinc-950/90 border border-zinc-200 dark:border-zinc-800 backdrop-blur shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 transition-transform cursor-pointer"
        aria-label="customize background"
      >
        <svg className="w-5 h-5 text-zinc-600 dark:text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.828a2 2 0 010 2.829l-8.486 8.485M7 17h.01"
          />
        </svg>
      </button>
    </div>
  );
});
