import { CATEGORIES, CONDITIONS } from "@/convex/lib/validators";

const categoryLabels = new Map<string, string>(CATEGORIES.map((c) => [c.value, c.label]));
const conditionLabels = new Map<string, string>(CONDITIONS.map((c) => [c.value, c.label]));

export const categoryLabel = (value: string) => categoryLabels.get(value) ?? value;
export const conditionLabel = (value: string) => conditionLabels.get(value) ?? value;

const dateFmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });

export function formatDate(iso: string) {
  return dateFmt.format(new Date(`${iso}T00:00:00Z`));
}

export function formatRange(start: string, end: string) {
  return start === end ? formatDate(start) : `${formatDate(start)} → ${formatDate(end)}`;
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "2 days ago", "just now", … */
export function timeAgo(ms: number, now = Date.now()) {
  const seconds = Math.round((ms - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), "hour");
  return rtf.format(Math.round(seconds / 86_400), "day");
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
