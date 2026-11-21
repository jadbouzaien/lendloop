/** Wordmark: serif name with a small interlocking-loop mark. */
export function Logo() {
  return (
    <span className="flex items-center gap-2.5 text-ink">
      <svg viewBox="0 0 28 16" className="h-3.5 w-auto" fill="none" aria-hidden>
        <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="20" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span className="font-display text-[1.6rem] leading-none tracking-tight">LendLoop</span>
    </span>
  );
}
