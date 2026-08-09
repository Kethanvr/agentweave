import { createHash, timingSafeEqual } from "node:crypto";
import { AppError } from "./http";

export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function secretsMatch(candidate: string, expectedHash: string | null): boolean {
  if (!candidate || !expectedHash) return false;
  const actual = Buffer.from(hashSecret(candidate), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function assertSafeExternalUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError("HTTP step URL is invalid", "INVALID_STEP");
  }

  if (url.protocol !== "https:") {
    throw new AppError("HTTP steps require HTTPS", "UNSAFE_HTTP_TARGET");
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost") ||
    hostname.startsWith("127.")
  ) {
    throw new AppError("Loopback HTTP targets are blocked", "UNSAFE_HTTP_TARGET");
  }

  return url;
}
