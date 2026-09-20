export interface BgColors {
  c1: string;
  c2: string;
  c3: string;
}

export const defaultBg: BgColors = { c1: "#34d399", c2: "#60a5fa", c3: "#e879f9" };

function hexA(hex: string, a: number) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

export default function Background({ colors }: { colors: BgColors }) {
  return (
    <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden bg-white dark:bg-zinc-950">
      <div className="absolute inset-0 opacity-80 dark:opacity-90">
        <div className="absolute -top-40 -left-32 w-[42rem] h-[42rem] rounded-full blur-[120px] animate-aurora1" style={{ backgroundColor: hexA(colors.c1, 0.32) }} />
        <div className="absolute top-1/3 -right-40 w-[38rem] h-[38rem] rounded-full blur-[120px] animate-aurora2" style={{ backgroundColor: hexA(colors.c2, 0.28) }} />
        <div className="absolute -bottom-48 left-1/4 w-[44rem] h-[44rem] rounded-full blur-[130px] animate-aurora3" style={{ backgroundColor: hexA(colors.c3, 0.24) }} />
      </div>
      <div className="absolute inset-0 opacity-[0.025] dark:opacity-[0.04]" style={{
        backgroundImage: "linear-gradient(rgba(0,0,0,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,.5) 1px, transparent 1px)",
        backgroundSize: "44px 44px",
      }} />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-white/60 dark:to-zinc-950/70" />
    </div>
  );
}
