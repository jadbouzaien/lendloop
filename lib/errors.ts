import { ConvexError } from "convex/values";
import type { AppErrorData } from "@/convex/lib/errors";

/** Show server-provided messages for expected errors, a generic one otherwise. */
export function errorMessage(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data as Partial<AppErrorData> | string;
    if (typeof data === "string") return data;
    if (data?.message) return data.message;
  }
  return "Something went wrong. Please try again.";
}
