import { ConvexError } from "convex/values";

export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "CONFLICT";

export type AppErrorData = { code: AppErrorCode; message: string };

/** Errors thrown with this helper reach the client with a safe, typed payload. */
export function appError(code: AppErrorCode, message: string) {
  return new ConvexError<AppErrorData>({ code, message });
}
