import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const variants: Record<Variant, string> = {
  primary: "bg-ink text-paper hover:bg-ink/85",
  secondary: "border border-line bg-surface text-ink hover:border-ink/30",
  danger: "border border-line bg-surface text-danger hover:border-danger/40 hover:bg-danger-soft",
  ghost: "text-ink-soft hover:text-ink",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-line bg-surface p-5 ${className}`}>{children}</div>;
}

type Tone = "green" | "amber" | "red" | "stone" | "blue";
const tones: Record<Tone, string> = {
  green: "text-accent before:bg-accent",
  amber: "text-warn before:bg-warn",
  red: "text-danger before:bg-danger",
  stone: "text-muted before:bg-muted",
  blue: "text-ink before:bg-ink",
};

/** Quiet status label: a small dot and the text, no pill. */
export function Badge({ tone = "stone", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium before:h-1.5 before:w-1.5 before:rounded-full before:content-[''] ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function TrustedBadge() {
  return (
    <span
      title="Marked as a Trusted Lender by an admin"
      className="inline-flex items-center gap-1 rounded-full border border-ink/15 px-2 py-px text-[11px] font-medium uppercase tracking-wider text-ink"
    >
      <span aria-hidden>✦</span> Trusted
    </span>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-5xl leading-none tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-3 text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** Small uppercase label above a group of items. */
export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">{children}</h2>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-8 py-12 text-center text-sm text-muted">
      {children}
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {children}
    </p>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-lg bg-line/50" />
      ))}
    </div>
  );
}

export const inputClass =
  "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-muted/70 focus:border-ink/40";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium uppercase tracking-wider text-ink-soft">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}
