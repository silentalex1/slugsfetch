export default function SlugLogo({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path
        d="M6 28c0 5 4 9 9 9h14c5 0 9-4 9-9 0-3-1-5-4-7l-2-1c-.5-.4-1-.7-1.5-1 3-2 5-5 5-9 0-3-2-5-5-5H18c-3 0-5 2-5 5 0 4 2 7 5 9-.5.3-1 .6-1.5 1l-2 1c-3 2-4 4-4 7z"
        fill="url(#g1)"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M15 22c-1-1-2-3-2-5 0-3 2-5 5-5h10c3 0 5 2 5 5 0 2-1 4-2 5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <defs>
        <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1" gradientUnits="userSpaceOnUse">
          <stop stopColor="#34d399" />
          <stop offset="1" stopColor="#0d9488" />
        </linearGradient>
      </defs>
      <circle cx="19" cy="19" r="1.6" fill="#0f172a" />
      <circle cx="29" cy="19" r="1.6" fill="#0f172a" />
      <ellipse cx="24" cy="28.5" rx="3.2" ry="1.5" fill="#0f172a" />
    </svg>
  );
}
