import * as cheerio from "cheerio";

const TIMEOUT_MS = 15_000;
const STRIP_SELECTORS = "nav, footer, header, script, style, noscript";

export class ScrapeError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "ScrapeError";
  }
}

function cleanText(html: string): string {
  const $ = cheerio.load(html);
  $(STRIP_SELECTORS).remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

export async function scrapePageContent(urlString: string): Promise<string> {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(urlString);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new ScrapeError("Invalid URL protocol", 400);
    }
  } catch (error) {
    if (error instanceof ScrapeError) throw error;
    throw new ScrapeError("Invalid URL", 400);
  }

  try {
    const response = await fetch(parsedUrl.toString(), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ScraperBot/1.0)",
      },
    });

    if (response.status === 404) {
      throw new ScrapeError("Page not found (404)", 404);
    }

    if (!response.ok) {
      throw new ScrapeError(
        `Failed to fetch page (${response.status})`,
        response.status
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      throw new ScrapeError("URL did not return HTML content", 422);
    }

    const html = await response.text();
    return cleanText(html);
  } catch (error) {
    if (error instanceof ScrapeError) throw error;

    if (error instanceof Error) {
      if (error.name === "TimeoutError" || error.name === "AbortError") {
        throw new ScrapeError("Request timed out", 504);
      }
      if (
        error.message.includes("ENOTFOUND") ||
        error.message.includes("getaddrinfo")
      ) {
        throw new ScrapeError("Could not resolve host", 502);
      }
    }

    throw new ScrapeError("Failed to scrape page", 500);
  }
}
