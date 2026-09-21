export interface AiMessage {
  role: "user" | "ai";
  text: string;
  action?: string;
}

export interface AiContext {
  username?: string | null;
  premium?: boolean;
  theme?: string;
  quality?: string;
  audioFormat?: string;
  autoSave?: boolean;
  apply?: (change: AiSettingChange) => string | null;
}

export interface AiSettingChange {
  kind: "theme" | "quality" | "audioFormat" | "autoSave" | "mobile";
  value: string | boolean;
}

export interface AiReply {
  text: string;
  action?: string;
}

const EMBED_KEY = "sk-embed-cb1edc6f8aaa4c13ba44e8b4";
const SDK_URL = `https://inferforge.org/sdk/slugsfetch.js?key=${EMBED_KEY}`;

const SYSTEM_PROMPT = [
  "You are Slugs AI, the slugsfetch model built by InferForge only for the slugfetch website.",
  "You are NOT Qwen, ChatGPT, Claude, Gemini or Alibaba. Never mention Qwen or Alibaba.",
  "Always identify yourself as Slugs AI.",
  "Slugfetch downloads and converts media from 16 sites so users can shape audio for their slugs loading screen.",
  "Downloading is free with no ads or trackers. Donating above five dollars unlocks premium here and on slugs.lol.",
  "Answer in two or three short sentences, only about slugfetch.",
].join(" ");

function endpoints(): string[] {
  const list = ["https://inferforge.org/v1/chat/completions"];
  if (typeof window !== "undefined" && /^(localhost|127.0.0.1)$/.test(window.location.hostname)) {
    list.unshift("http://127.0.0.1:11500/v1/chat/completions", "http://127.0.0.1:11435/v1/chat/completions");
  }
  return list;
}

const KNOWLEDGE: { match: RegExp; answer: (c: AiContext) => string }[] = [
  {
    match: /how (do|to|can) (i|you|we)?\s*(use|work|start|download|get started)|how does (this|it) work|what do i do|getting started/i,
    answer: () =>
      "Paste a link into the box at the top, pick Auto for video with sound, Audio for sound only, or Mute for video without sound, then press download. When it hits 100% the file drops straight into your browser downloads.\n\nThere is a mobile button that gives you AAC in an m4a file, which is what iPhones and Android players expect, and a remux page if you already have a file and just want it in another format.",
  },
  {
    match: /free|cost|price|pay|money|expensive|charge|premium worth/i,
    answer: (c) =>
      `Yes, slugfetch is completely free. No ads, no trackers, no paywall on downloading.${
        c.premium
          ? "\n\nYou already have premium, so instant downloads, beta features, dedicated help and slow and reverb are all unlocked for you."
          : "\n\nIf you want to support it you can donate. Donating above $5 unlocks premium, which also gives you premium on slugs.lol, plus instant downloads, early access to beta features before everyone else, dedicated support and the slow and reverb tool."
      }`,
  },
  {
    match: /purpose|why (does|do).*(exist|made)|what is this (site|website|for)|point of (this|the site)/i,
    answer: () =>
      "Slugfetch exists so you can convert music and audio exactly how you like it, then bring that audio into your slugs startup loading screen.\n\nYou can use slugfetch just for that, or use it as a general downloader and converter for any of the 16 sites it supports.",
  },
  {
    match: /(am i|do i have|check).*(premium|pro|paid)|my (premium|account) status/i,
    answer: (c) =>
      !c.username
        ? "You are not signed in, so there is no account to check yet. Premium lives on an account, which you make on the donate page."
        : c.premium
          ? `Yes, ${c.username} has premium. That covers instant downloads, beta features, dedicated help, slow and reverb, and premium on slugs.lol.`
          : `${c.username} does not have premium yet. Any donation above $5 turns it on straight away, here and on slugs.lol.`,
  },
  {
    match: /account|sign ?up|sign ?in|log ?in|register|username|password/i,
    answer: () =>
      "Pick an amount on the donate page and press continue. That takes you to the checkout page where you enter a username and password, then press create account and continue purchase.\n\nThe account is made before payment and premium switches on once the payment clears. Your password is hashed before it is stored, and card details go straight to Stripe, never to slugfetch.\n\nYou do not need an account to download, only to hold premium and sync your history.",
  },
  {
    match: /slow|reverb|slowed|pitch|speed/i,
    answer: (c) =>
      `Slow and reverb slows audio down and adds reverb, the sound people use for slowed edits. Download a track, then use the slow and reverb control on the finished item and set the speed with the slider. Lower is slower and heavier.${
        c.premium ? "" : "\n\nIt is a premium feature, so it needs a donation above $5 on your account."
      }`,
  },
  {
    match: /mobile|phone|iphone|android|m4a|aac/i,
    answer: () =>
      "Press the mobile button next to the mode buttons. It forces AAC inside an m4a container at 44.1 kHz stereo, which every iPhone and Android player handles natively, so the file just works without converting again.",
  },
  {
    match: /(what|which) (sites|platforms|services)|support(ed)?|does (youtube|spotify|tiktok|instagram)/i,
    answer: () =>
      "Sixteen platforms: YouTube, Spotify, TikTok, Twitter/X, Instagram, Vimeo, SoundCloud, Twitch, Reddit, Pinterest, Snapchat, Facebook, Bilibili, Rutube, VK and Loom.\n\nInstagram, Facebook and Snapchat usually need a cookies.txt loaded in settings for anything private.",
  },
  {
    match: /fail|error|not work|broken|cannot|can't download|wont download|offline|engine/i,
    answer: () =>
      "A few things cause that. The post may be private or need a sign in, the media may have been removed, or the platform may be rate limiting.\n\nIf it is a private Instagram, Facebook or Snapchat link, export a cookies.txt from a browser where you are logged in and load it in settings under platform sign in.\n\nIf the banner says the engine is offline, downloads are paused until it comes back. Nothing you have saved is lost.",
  },
  {
    match: /history|saved|previous download/i,
    answer: (c) =>
      c.username
        ? "Your history is synced to your account, so it follows you to any browser you sign in on and survives a cache clear. Open it from history in the sidebar."
        : "History is on this device only right now. Make an account and it saves to the account instead, so it follows you anywhere you sign in.",
  },
  {
    match: /remux|convert|format|mp4|webm|mkv|flac|wav|ogg/i,
    answer: () =>
      "For video you can take mp4, webm or mkv up to 8K. For audio, mp3, m4a, ogg, wav, opus or flac.\n\nIf you already have a file, open the remux page from the button under the download form, pick a target format and drop the file in.",
  },
  {
    match: /clip|trim|cut|subtitle|caption/i,
    answer: () =>
      "Press clip and subs under the download form. You can set a start and end time using seconds or hh:mm:ss, and turn on subtitles with a language of your choice.",
  },
  {
    match: /safe|privacy|secure|data|track|store my/i,
    answer: () =>
      "Your password is hashed before it is stored and never kept in plain text. Card details go straight to Stripe on their own page, so slugfetch never sees them. No ads, no trackers.",
  },
  {
    match: /slugs\.lol|slugs lol|sister site/i,
    answer: () =>
      "slugs.lol is the sister site. Premium on slugfetch gives you premium there too, and the audio you make here is meant to be used as your slugs startup loading screen sound.",
  },
  {
    match: /^(hi|hey|hello|yo|sup)\b|who are you|what can you do|help/i,
    answer: () =>
      "Hey, I am Slugs AI. I can explain how slugfetch works, check whether you have premium, change your settings for you, and help sort out a download that is not cooperating.\n\nWhat do you need?",
  },
];

function detectSettingChange(question: string): { change: AiSettingChange; reply: string } | null {
  const q = question.toLowerCase();

  if (/\b(dark|night)\b/.test(q) && /(mode|theme|switch|turn|set|make)/.test(q)) {
    return { change: { kind: "theme", value: "dark" }, reply: "Switched you to the dark theme." };
  }
  if (/\blight\b/.test(q) && /(mode|theme|switch|turn|set|make)/.test(q)) {
    return { change: { kind: "theme", value: "light" }, reply: "Switched you to the light theme." };
  }
  if (/\b(8k|4k|1440p|1080p|720p|480p|360p|240p|144p)\b/.test(q)) {
    const match = q.match(/\b(8k|4k|1440p|1080p|720p|480p|360p|240p|144p)\b/);
    const value = match ? match[1] : "1080p";
    return { change: { kind: "quality", value }, reply: `Set your preferred video quality to ${value}.` };
  }
  if (/\b(mp3|m4a|flac|wav|opus|ogg)\b/.test(q) && /(set|use|switch|change|want|make|prefer)/.test(q)) {
    const match = q.match(/\b(mp3|m4a|flac|wav|opus|ogg)\b/);
    const value = match ? match[1] : "mp3";
    return { change: { kind: "audioFormat", value }, reply: `Set your audio format to ${value}.` };
  }
  if (/mobile/.test(q) && /(turn on|enable|set|use|switch)/.test(q)) {
    return { change: { kind: "mobile", value: true }, reply: "Turned on mobile audio, so downloads come out as AAC in m4a." };
  }
  if (/(stop|disable|turn off|dont|don't|do not).*(auto|automatic).*(down|save)/.test(q)) {
    return { change: { kind: "autoSave", value: false }, reply: "Finished files will now wait in the queue until you press save." };
  }
  if (/(turn on|enable|start).*(auto|automatic).*(down|save)/.test(q)) {
    return { change: { kind: "autoSave", value: true }, reply: "Finished files will now save to your downloads automatically." };
  }
  return null;
}

function localAnswer(question: string, context: AiContext): AiReply {
  const setting = detectSettingChange(question);
  if (setting && context.apply) {
    const applied = context.apply(setting.change);
    if (applied) return { text: setting.reply, action: applied };
  }

  for (const entry of KNOWLEDGE) {
    if (entry.match.test(question)) return { text: entry.answer(context) };
  }

  const math = question.match(/(-?\d+(?:\.\d+)?)\s*([+\-*/x×])\s*(-?\d+(?:\.\d+)?)/);
  if (math) {
    const a = Number(math[1]);
    const b = Number(math[3]);
    const op = math[2];
    const value =
      op === "+" ? a + b : op === "-" ? a - b : op === "/" ? (b === 0 ? null : a / b) : a * b;
    if (value !== null && Number.isFinite(value)) {
      return {
        text: `That is ${Number(value.toFixed(6))}. I am Slugs AI though, so what I am really good at is slugfetch. Want a hand downloading something, or shall I check your premium?`,
      };
    }
  }

  const topic = question.trim().replace(/[?!.]+$/, "").slice(0, 60);
  return {
    text: `${topic ? `"${topic}" is outside what I cover.` : "That is outside what I cover."} I am Slugs AI, so I stick to slugfetch: downloading and converting from 16 sites, premium and slugs.lol, accounts, settings and fixing failed downloads.\n\nTell me what you are trying to grab and I will walk you through it.`,
  };
}

let sdkReady: Promise<boolean> | null = null;

function loadSdk(): Promise<boolean> {
  if (sdkReady) return sdkReady;
  sdkReady = new Promise<boolean>((resolve) => {
    if (typeof document === "undefined") return resolve(false);
    if ((window as unknown as Record<string, unknown>).slugsfetch) return resolve(true);

    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
    setTimeout(() => resolve(!!(window as unknown as Record<string, unknown>).slugsfetch), 4000);
  });
  return sdkReady;
}

function contextLine(context: AiContext): string {
  const bits = [
    context.username ? `The user is signed in as ${context.username}.` : "The user is not signed in.",
    context.premium ? "They have premium." : "They do not have premium.",
  ];
  return bits.join(" ");
}

const SLUG_TERMS =
  /slug|download|convert|remux|premium|donat|account|mp3|m4a|mp4|audio|video|format|history|setting|youtube|spotify|tiktok|reverb|mobile|subtitle|queue|stripe/i;

const TIE_BACKS = [
  "Back on slugfetch though, want me to help you grab or convert something?",
  "That aside, I am Slugs AI, so tell me what you want to download and I will sort it.",
  "Anyway, slugfetch is my thing. Need a hand with a download, premium or your settings?",
];

function cleanReply(text: string, question: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < 2) return null;
  if (/\b(qwen|alibaba|openai|chatgpt|anthropic|bert|meta ai|llama)\b/i.test(trimmed)) return null;
  if (/\b(architecture|transformer|neural network|training data|corpus|parameters)\b/i.test(trimmed)) return null;

  if (!SLUG_TERMS.test(trimmed) && !SLUG_TERMS.test(question)) {
    const tie = TIE_BACKS[Math.floor(Math.random() * TIE_BACKS.length)];
    return `${trimmed}\n\n${tie}`;
  }
  return trimmed;
}

async function remoteAnswer(question: string, context: AiContext): Promise<string | null> {
  const body = JSON.stringify({
    model: "slugsfetch",
    messages: [
      { role: "system", content: `${SYSTEM_PROMPT} ${contextLine(context)}` },
      { role: "user", content: question },
    ],
    max_tokens: 160,
    temperature: 0.3,
  });

  for (const url of endpoints()) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${EMBED_KEY}` },
        body,
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (typeof text === "string") {
        const cleaned = cleanReply(text, question);
        if (cleaned) return cleaned;
      }
    } catch {
      continue;
    }
  }

  try {
    const ok = await loadSdk();
    const sdk = (window as unknown as Record<string, unknown>).InferForge as
      | { instance?: { chat?: (q: string) => Promise<string> } }
      | undefined;
    if (ok && typeof sdk?.instance?.chat === "function") {
      const raw = await sdk.instance.chat(`${SYSTEM_PROMPT}\n\nUser: ${question}`);
      if (typeof raw === "string") return cleanReply(raw, question);
    }
  } catch {
    return null;
  }

  return null;
}

export async function askSlugsAI(question: string, context: AiContext): Promise<AiReply> {
  const setting = detectSettingChange(question);
  if (setting && context.apply) {
    const applied = context.apply(setting.change);
    if (applied) return { text: setting.reply, action: applied };
  }

  for (const entry of KNOWLEDGE) {
    if (entry.match.test(question)) return { text: entry.answer(context) };
  }

  const remote = await remoteAnswer(question, context);
  if (remote) return { text: remote };

  return localAnswer(question, context);
}
