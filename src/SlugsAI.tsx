import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "./ui";
import { askSlugsAI, type AiMessage, type AiContext } from "./ai";

const PRESETS = [
  "How do i use this website?",
  "Is this website free to use?",
  "What is the purpose of this website?",
];

export function SlugsAiLauncher({ onOpen, open }: { onOpen: () => void; open: boolean }) {
  return (
    <button
      onClick={onOpen}
      aria-label="open Slugs AI"
      title="Slugs AI  ·  shift + i  or  shift + s"
      className={cn(
        "fixed right-4 bottom-20 z-50 w-12 h-12 rounded-full grid place-items-center",
        "bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-500/30",
        "hover:scale-105 active:scale-95 transition-transform",
        open && "opacity-0 pointer-events-none"
      )}
    >
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" />
      </svg>
    </button>
  );
}

export function SlugsAiWidget({
  open,
  onClose,
  context,
}: {
  open: boolean;
  onClose: () => void;
  context: AiContext;
}) {
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 120);
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || busy) return;

      setInput("");
      setMessages((m) => [...m, { role: "user", text: question }]);
      setBusy(true);

      const reply = await askSlugsAI(question, context);

      setMessages((m) => [...m, { role: "ai", text: reply.text, action: reply.action }]);
      setBusy(false);
    },
    [busy, context]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[65] sm:inset-auto sm:right-4 sm:bottom-4 sm:w-[380px] flex flex-col">
      <div
        onClick={onClose}
        className="absolute inset-0 bg-zinc-950/50 backdrop-blur-sm sm:hidden"
        aria-hidden="true"
      />

      <div
        className={cn(
          "relative flex flex-col overflow-hidden animate-riseIn",
          "h-full sm:h-[520px] sm:max-h-[80vh] sm:rounded-2xl",
          "bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 shadow-2xl"
        )}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 grid place-items-center shrink-0">
              <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z" />
              </svg>
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium leading-tight">Slugs AI</p>
              <p className="text-[10px] text-zinc-500 leading-tight">
                {context.premium ? "premium account" : context.username ? `signed in as ${context.username}` : "ask me anything about slugfetch"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="close Slugs AI"
            className="w-8 h-8 grid place-items-center rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.length === 0 && (
            <div className="space-y-2">
              <p className="text-xs text-zinc-500 mb-3 leading-relaxed">
                hey, I am Slugs AI. pick a question or type your own. I can also change your settings if you ask.
              </p>
              {PRESETS.map((q) => (
                <button
                  key={q}
                  onClick={() => void send(q)}
                  className="w-full text-left px-3.5 py-2.5 rounded-xl text-sm border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 hover:border-emerald-400 dark:hover:border-emerald-500 hover:bg-emerald-500/5 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words",
                  m.role === "user"
                    ? "bg-emerald-500 text-white rounded-br-md"
                    : "bg-zinc-100 dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 rounded-bl-md"
                )}
              >
                {m.text}
                {m.action && (
                  <span className="mt-2 block text-[10px] px-2 py-1 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                    {m.action}
                  </span>
                )}
              </div>
            </div>
          ))}

          {busy && (
            <div className="flex justify-start">
              <div className="px-3.5 py-3 rounded-2xl rounded-bl-md bg-zinc-100 dark:bg-zinc-900 flex gap-1.5">
                {[0, 150, 300].map((d) => (
                  <span
                    key={d}
                    className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-pulse"
                    style={{ animationDelay: `${d}ms` }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {messages.length > 0 && (
          <div className="px-4 pb-2 flex gap-1.5 overflow-x-auto shrink-0">
            {PRESETS.map((q) => (
              <button
                key={q}
                onClick={() => void send(q)}
                className="px-2.5 py-1 rounded-lg text-[10px] whitespace-nowrap bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors shrink-0"
              >
                {q.replace(/\?$/, "")}
              </button>
            ))}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="p-3 border-t border-zinc-200 dark:border-zinc-800 flex gap-2 shrink-0"
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="ask about slugfetch"
            className="flex-1 h-10 px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm outline-none transition-all duration-200 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15"
          />
          <button
            type="submit"
            disabled={!input.trim() || busy}
            className="w-10 h-10 grid place-items-center rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95 shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14m0 0l-6-6m6 6l-6 6" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
