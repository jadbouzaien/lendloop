import { appError } from "./errors";

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Trim, strip control characters and enforce length bounds. */
export function cleanText(
  value: string,
  field: string,
  { min, max }: { min: number; max: number },
): string {
  const cleaned = value.replace(CONTROL_CHARS, "").trim();
  if (cleaned.length < min) {
    throw appError(
      "INVALID_INPUT",
      min <= 1 ? `${field} is required.` : `${field} must be at least ${min} characters.`,
    );
  }
  if (cleaned.length > max) {
    throw appError("INVALID_INPUT", `${field} must be at most ${max} characters.`);
  }
  return cleaned;
}
