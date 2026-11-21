import type { ActivityItem } from "@/convex/lib/activity";
import { timeAgo } from "@/lib/format";

const ICON: Record<ActivityItem["status"], string> = {
  sent: "✓",
  claimed: "…",
  pending: "…",
  failed: "!",
};

function label(item: ActivityItem) {
  const what = item.kind === "reminder" ? "Reminder" : "Notification";
  switch (item.status) {
    case "sent":
      return `${what} sent`;
    case "failed":
      return `${what} failed`;
    default:
      return `${what} in progress`;
  }
}

/** Recent automation activity on a loan, e.g. "Reminder sent 2 days ago". */
export function ActivityList({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-4 space-y-1.5 border-t border-line pt-4 text-xs text-muted">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span
            className={`inline-flex h-4 w-4 flex-none items-center justify-center rounded-full text-[10px] font-bold ${
              item.status === "failed" ? "bg-danger-soft text-danger" : item.status === "sent" ? "bg-accent-soft text-accent" : "bg-line/60"
            }`}
            aria-hidden
          >
            {ICON[item.status]}
          </span>
          <span>
            <span className="font-medium text-ink-soft">{label(item)}</span> {timeAgo(item.at)}
            {item.detail && <span className="text-muted"> · {item.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
