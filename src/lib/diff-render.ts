import { diffWords } from "diff";

export type DiffSegment = {
  kind: "replace" | "add" | "remove";
  removed: string;
  added: string;
  before: string;
  after: string;
};

export type RenderedDiff = {
  segments: DiffSegment[];
  minorCount: number;
  oldLength: number;
  newLength: number;
};

const CONTEXT_CHARS = 60;
const MAX_SEGMENTS = 6;
const MAX_SEGMENT_CHARS = 220;

/**
 * Pulls the two full texts back out of a stored patch. cleanText() collapses
 * each page to a single line, so every patch is one "-" line and one "+" line
 * holding the entire old and new page respectively.
 */
export function parsePatch(patch: string): { oldText: string; newText: string } {
  let oldText = "";
  let newText = "";

  for (const line of patch.split("\n")) {
    if (line.startsWith("---") || line.startsWith("+++")) continue;
    if (line.startsWith("-")) oldText += line.slice(1);
    else if (line.startsWith("+")) newText += line.slice(1);
  }

  return { oldText, newText };
}

const DATEISH = /\b(\d+\s*(day|days|hour|hours|minute|minutes|week|weeks|month|months)\s*ago|posted\s*\d+|\d{4}-\d{2}-\d{2})\b/i;

/**
 * Cosmetic churn we don't want dominating the view: capitalisation-only edits,
 * pure counter increments (view counts, "3 days ago" -> "4 days ago"), and
 * whitespace. These are hidden behind a count rather than dropped, so the
 * user can still tell something moved.
 */
function isMinor(removed: string, added: string): boolean {
  const a = removed.trim();
  const b = added.trim();
  if (!a || !b) return false;

  if (a.toLowerCase() === b.toLowerCase()) return true;
  if (DATEISH.test(a) && DATEISH.test(b)) return true;

  const stripDigits = (s: string) => s.replace(/[\d,.]+/g, "").trim();
  const sa = stripDigits(a);
  const sb = stripDigits(b);
  if (sa && sa === sb) return true;

  return false;
}

function clip(text: string, chars: number, fromEnd: boolean): string {
  const flat = text.replace(/\s+/g, " ");
  if (flat.length <= chars) return flat;
  return fromEnd ? flat.slice(-chars) : flat.slice(0, chars);
}

function truncate(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_SEGMENT_CHARS
    ? `${flat.slice(0, MAX_SEGMENT_CHARS)}…`
    : flat;
}

export function buildDiff(patch: string | null): RenderedDiff | null {
  if (!patch) return null;

  const { oldText, newText } = parsePatch(patch);
  if (!oldText && !newText) return null;

  const parts = diffWords(oldText, newText);
  const segments: DiffSegment[] = [];
  let minorCount = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part.added && !part.removed) continue;

    const next = parts[i + 1];
    const paired = part.removed && next?.added;
    const removed = part.removed ? part.value : "";
    const added = paired ? next.value : part.added ? part.value : "";

    if (paired) i++;

    if (isMinor(removed, added)) {
      minorCount++;
      continue;
    }

    if (segments.length < MAX_SEGMENTS) {
      segments.push({
        kind: removed && added ? "replace" : removed ? "remove" : "add",
        removed: truncate(removed),
        added: truncate(added),
        before: clip(parts[i - (paired ? 2 : 1)]?.value ?? "", CONTEXT_CHARS, true),
        after: clip(parts[i + 1]?.value ?? "", CONTEXT_CHARS, false),
      });
    }
  }

  return {
    segments,
    minorCount,
    oldLength: oldText.length,
    newLength: newText.length,
  };
}
