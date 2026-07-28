export function formatDate(iso: string | null, timeZone?: string): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: timeZone ?? undefined,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: timeZone ? "short" : undefined,
  });
}

export function formatShortDate(iso: string, timeZone?: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: timeZone ?? undefined,
    month: "short",
    day: "numeric",
  });
}

export function summaryToBullets(summary: string): string[] {
  return summary
    .split("\n")
    .map((line) => line.replace(/^[\s•\-*]+/, "").trim())
    .filter(Boolean);
}

/** Extracts a clean domain label from a full URL, e.g. "firecrawl.dev" */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Path portion of a URL, e.g. "/pricing/serp" — "/" for a bare domain. */
export function pathOf(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
}
