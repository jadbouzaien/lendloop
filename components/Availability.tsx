import type { Availability as AvailabilityT } from "@/convex/lib/availability";
import { formatDate, formatRange } from "@/lib/format";
import { Badge } from "./ui";

export function AvailabilityBadge({ availability }: { availability: AvailabilityT }) {
  if (availability.status === "available") return <Badge tone="green">Available</Badge>;
  if (availability.overdue) return <Badge tone="red">Overdue since {formatDate(availability.until)}</Badge>;
  return <Badge tone="amber">On loan until {formatDate(availability.until)}</Badge>;
}

export function Bookings({ bookings }: { bookings: { startDate: string; endDate: string }[] }) {
  if (bookings.length === 0) return null;
  return (
    <p className="text-xs text-muted">
      Booked: {bookings.map((b) => formatRange(b.startDate, b.endDate)).join(", ")}
    </p>
  );
}
