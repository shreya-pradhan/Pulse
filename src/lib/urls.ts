export function parseTrackedUrl(raw: string): string {
  const trimmed = raw.trim();
  const parsed = new URL(trimmed);

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("URL must use http or https");
  }

  return parsed.toString();
}
