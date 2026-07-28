"use client";

import { useMemo, useState } from "react";
import type { DiffSegment } from "@/lib/diff-render";
import { formatShortDate, summaryToBullets } from "@/lib/dashboard-utils";

export type ChangeEntry = {
  id: string;
  domain: string;
  path: string;
  url: string;
  label: string | null;
  summary: string;
  detectedAt: string;
  segments: DiffSegment[];
  minorCount: number;
  oldLength: number;
};

export type FrequencyRow = {
  domain: string;
  counts: number[];
  total: number;
};

const ALL = "__all__";

function heatColor(n: number): string {
  if (n <= 0) return "bg-zinc-100";
  if (n === 1) return "bg-indigo-200";
  if (n === 2) return "bg-indigo-400";
  return "bg-indigo-600";
}

function DiffText({ segment }: { segment: DiffSegment }) {
  return (
    <p className="text-sm leading-relaxed text-zinc-700">
      {segment.before && <span className="text-zinc-400">…{segment.before} </span>}
      {segment.removed && (
        <span className="rounded bg-red-50 px-1 py-0.5 text-red-700 line-through">
          {segment.removed}
        </span>
      )}
      {segment.removed && segment.added && " "}
      {segment.added && (
        <span className="rounded bg-green-50 px-1 py-0.5 text-green-800">
          {segment.added}
        </span>
      )}
      {segment.after && <span className="text-zinc-400"> {segment.after}…</span>}
    </p>
  );
}

function FrequencyGrid({
  days,
  rows,
  timezone,
}: {
  days: string[];
  rows: FrequencyRow[];
  timezone: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center">
        <p className="text-sm text-zinc-400">Nothing tracked yet.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white p-4">
      <div className="min-w-[520px]">
        <div
          className="grid items-center gap-1"
          style={{ gridTemplateColumns: `104px repeat(${days.length}, minmax(0, 1fr))` }}
        >
          <span />
          {days.map((d) => (
            <span key={d} className="text-center text-[10px] text-zinc-400">
              {new Date(d).getUTCDate()}
            </span>
          ))}

          {rows.map((row) => (
            <FrequencyRowCells key={row.domain} row={row} days={days} timezone={timezone} />
          ))}
        </div>

        <div className="mt-3 flex items-center gap-3 text-[11px] text-zinc-400">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-indigo-200" />1
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-indigo-400" />2
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-indigo-600" />3+
          </span>
        </div>
      </div>
    </div>
  );
}

function FrequencyRowCells({
  row,
  days,
  timezone,
}: {
  row: FrequencyRow;
  days: string[];
  timezone: string;
}) {
  return (
    <>
      <span className="truncate pr-2 text-xs text-zinc-600">{row.domain}</span>
      {row.counts.map((n, i) => (
        <span
          key={days[i]}
          title={`${row.domain} · ${formatShortDate(days[i], timezone)} · ${n} change${n === 1 ? "" : "s"}`}
          className={`h-5 rounded-sm ${heatColor(n)}`}
        />
      ))}
    </>
  );
}

function DiffList({ changes, timezone }: { changes: ChangeEntry[]; timezone: string }) {
  if (changes.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center">
        <p className="text-sm text-zinc-400">No changes detected yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {changes.map((change) => (
        <article key={change.id} className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-medium text-zinc-900">
                {change.label ?? "Untitled"}
                <span className="ml-1.5 font-normal text-zinc-400">· {change.domain}{change.path}</span>
              </h3>
            </div>
            <time className="shrink-0 text-xs text-zinc-400">
              {formatShortDate(change.detectedAt, timezone)}
            </time>
          </div>

          {change.segments.length > 0 ? (
            <div className="mt-3 space-y-2.5 border-t border-zinc-100 pt-3">
              {change.segments.map((segment, i) => (
                <DiffText key={i} segment={segment} />
              ))}
            </div>
          ) : (
            <ul className="mt-3 space-y-1.5 border-t border-zinc-100 pt-3">
              {summaryToBullets(change.summary).map((bullet, i) => (
                <li key={i} className="flex gap-2 text-sm text-zinc-700">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-3 text-xs text-zinc-400">
            {change.segments.length > 0 && (
              <>
                {change.segments.length} segment{change.segments.length === 1 ? "" : "s"} ·{" "}
                {change.oldLength.toLocaleString()} characters scanned
              </>
            )}
            {change.minorCount > 0 && (
              <span className="text-amber-600">
                {change.segments.length > 0 ? " · " : ""}
                {change.minorCount} minor hidden
              </span>
            )}
          </p>
        </article>
      ))}
    </div>
  );
}

type TimelineItem = {
  key: string;
  summary: string;
  paths: string[];
  detectedAt: string;
};

/**
 * A single site-wide edit (a banner, say) lands as one change row per tracked
 * page. Collapse identical summaries on the same day into one entry listing
 * every page it touched.
 */
function toTimeline(changes: ChangeEntry[]): TimelineItem[] {
  const merged = new Map<string, TimelineItem>();

  for (const change of changes) {
    const day = change.detectedAt.slice(0, 10);
    const key = `${day}|${change.summary}`;
    const existing = merged.get(key);

    if (existing) {
      if (!existing.paths.includes(change.path)) existing.paths.push(change.path);
    } else {
      merged.set(key, {
        key,
        summary: change.summary,
        paths: [change.path],
        detectedAt: change.detectedAt,
      });
    }
  }

  return Array.from(merged.values());
}

function Timeline({ changes, timezone }: { changes: ChangeEntry[]; timezone: string }) {
  const items = useMemo(() => toTimeline(changes), [changes]);

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center">
        <p className="text-sm text-zinc-500">No changes recorded yet.</p>
        <p className="mt-1 text-xs text-zinc-400">
          The first scan of a page is its baseline — changes appear from the second scan onward.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      {items.map((item, i) => (
        <div key={item.key} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-500" />
            {i < items.length - 1 && <span className="mt-1 w-px flex-1 bg-zinc-200" />}
          </div>
          <div className={i < items.length - 1 ? "flex-1 pb-5" : "flex-1"}>
            <ul className="space-y-1">
              {summaryToBullets(item.summary).map((bullet, j) => (
                <li key={j} className="text-sm text-zinc-700">
                  {bullet}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-xs text-zinc-400">
              {item.paths.join(", ")} · {formatShortDate(item.detectedAt, timezone)}
              {item.paths.length > 1 && ` · ${item.paths.length} pages, 1 edit`}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ChangeViews({
  changes,
  days,
  frequency,
  domains,
  timezone,
}: {
  changes: ChangeEntry[];
  days: string[];
  frequency: FrequencyRow[];
  domains: string[];
  timezone: string;
}) {
  const [showTimeline, setShowTimeline] = useState(false);
  const [domain, setDomain] = useState(ALL);

  const timelineChanges = useMemo(
    () => (domain === ALL ? changes : changes.filter((c) => c.domain === domain)),
    [changes, domain]
  );

  return (
    <>
      <section>
        <h2 className="text-base font-semibold text-zinc-900">Change history</h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          {changes.length === 0
            ? "No changes detected yet"
            : `${changes.length} change${changes.length === 1 ? "" : "s"} across ${frequency.length} competitor${frequency.length === 1 ? "" : "s"} · last ${days.length} days`}
        </p>
        <div className="mt-4">
          <FrequencyGrid days={days} rows={frequency} timezone={timezone} />
        </div>
      </section>

      <section className="mt-12">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">
              {showTimeline ? "Timeline" : "Inline diff"}
            </h2>
            <p className="mt-0.5 text-sm text-zinc-500">
              {showTimeline
                ? "Grouped by competitor, site-wide edits merged"
                : "Exactly what changed on the page, word by word"}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {showTimeline && (
              <select
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              >
                <option value={ALL}>All domains</option>
                {domains.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() => setShowTimeline((prev) => !prev)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                showTimeline
                  ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                  : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 5.25h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5" />
              </svg>
              Timeline
            </button>
          </div>
        </div>

        <div className="mt-4">
          {showTimeline ? (
            <Timeline changes={timelineChanges} timezone={timezone} />
          ) : (
            <DiffList changes={changes} timezone={timezone} />
          )}
        </div>
      </section>
    </>
  );
}
