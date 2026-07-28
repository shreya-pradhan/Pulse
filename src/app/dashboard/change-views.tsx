"use client";

import { useMemo, useState } from "react";
import { formatShortDate, summaryToBullets } from "@/lib/dashboard-utils";

export type ChangeEntry = {
  id: string;
  domain: string;
  path: string;
  url: string;
  label: string | null;
  summary: string;
  detectedAt: string;
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

type TimelineItem = {
  key: string;
  domain: string;
  summary: string;
  paths: string[];
  detectedAt: string;
};

/**
 * A single site-wide edit (a banner, say) lands as one change row per tracked
 * page. Collapse identical summaries from the same domain on the same day into
 * one entry listing every page it touched.
 */
function toTimeline(changes: ChangeEntry[]): TimelineItem[] {
  const merged = new Map<string, TimelineItem>();

  for (const change of changes) {
    const day = change.detectedAt.slice(0, 10);
    const key = `${change.domain}|${day}|${change.summary}`;
    const existing = merged.get(key);

    if (existing) {
      if (!existing.paths.includes(change.path)) existing.paths.push(change.path);
    } else {
      merged.set(key, {
        key,
        domain: change.domain,
        summary: change.summary,
        paths: [change.path],
        detectedAt: change.detectedAt,
      });
    }
  }

  return Array.from(merged.values());
}

function Timeline({
  changes,
  timezone,
  showDomain,
}: {
  changes: ChangeEntry[];
  timezone: string;
  showDomain: boolean;
}) {
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
              {showDomain && <span className="text-zinc-500">{item.domain}</span>}
              {showDomain && " · "}
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
  const [domain, setDomain] = useState(ALL);

  const visible = useMemo(
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
            <h2 className="text-base font-semibold text-zinc-900">Timeline</h2>
            <p className="mt-0.5 text-sm text-zinc-500">
              {domain === ALL
                ? "All competitors, site-wide edits merged"
                : `${domain} · site-wide edits merged`}
            </p>
          </div>

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
        </div>

        <div className="mt-4">
          <Timeline changes={visible} timezone={timezone} showDomain={domain === ALL} />
        </div>
      </section>
    </>
  );
}
