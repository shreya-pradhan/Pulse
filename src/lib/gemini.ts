/**
 * Gemini's shared-capacity models return 503 "experiencing high demand"
 * intermittently — measured at roughly 1 in 5 calls for gemini-flash-latest.
 * Without a retry that surfaces as a dead-end error on the report button, and
 * worse in the cron path: the snapshot is already saved by the time the diff
 * runs, so a failed summarisation advances next_run_at against fresh content
 * and the change is lost for good.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);
const DEFAULT_ATTEMPTS = 3;
const BASE_DELAY_MS = 700;

/** The SDK stringifies the HTTP status into the message, e.g. "[503 Service Unavailable]". */
function statusOf(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const match = error.message.match(/\[(\d{3})\b/);
  return match ? Number(match[1]) : null;
}

export function isTransientGeminiError(error: unknown): boolean {
  const status = statusOf(error);
  return status !== null && TRANSIENT_STATUSES.has(status);
}

/**
 * Retries only on transient statuses. A permanent failure (bad key, removed
 * model, zero quota) fails immediately rather than burning the backoff budget.
 */
export async function withGeminiRetry<T>(
  call: () => Promise<T>,
  attempts: number = DEFAULT_ATTEMPTS
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await call();
    } catch (error) {
      lastError = error;

      const status = statusOf(error);
      if (status !== null && !TRANSIENT_STATUSES.has(status)) throw error;
      if (attempt === attempts - 1) break;

      const delay = BASE_DELAY_MS * 2 ** attempt + Math.random() * 300;
      console.warn(
        `[gemini] ${status ?? "unknown"} on attempt ${attempt + 1}/${attempts}, retrying in ${Math.round(delay)}ms`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Tries each model in order, retrying transient failures within a model before
 * moving on. Covers both failure modes this app has actually hit: a model going
 * 503 under load, and a pinned model being withdrawn entirely (gemini-2.0-flash-lite
 * lost its free-tier quota, gemini-1.5-flash was removed outright). List the
 * model you trust most first.
 */
export async function generateWithFallback(
  apiKey: string,
  models: readonly string[],
  prompt: string
): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  let lastError: unknown;

  for (const name of models) {
    try {
      const model = genAI.getGenerativeModel({ model: name });
      const result = await withGeminiRetry(() => model.generateContent(prompt));
      return result.response.text().trim();
    } catch (error) {
      lastError = error;
      console.warn(
        `[gemini] ${name} failed (${error instanceof Error ? error.message.slice(0, 120) : "unknown"}), trying next model`
      );
    }
  }

  throw lastError;
}
