"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  COMMON_TIMEZONES,
  getBrowserTimezone,
  WEEKDAYS,
  type ScheduleType,
} from "@/lib/schedule";
import type { SuggestedUrl } from "@/app/api/suggest-urls/route";
import { deleteTrackedUrl } from "./actions";

export type TrackedUrlCard = {
  id: string;
  label: string | null;
  url: string;
  lastChecked: string | null;
  lastChange: string | null;
  nextRunAt: string | null;
  scheduleType: ScheduleType;
  scheduleTime: string;
  scheduleDay: number | null;
  timezone: string;
};

export type ChangeHistoryItem = {
  id: string;
  label: string | null;
  url: string;
  summary: string;
  detectedAt: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string | null, timeZone?: string): string {
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

function summaryToBullets(summary: string): string[] {
  return summary
    .split("\n")
    .map((line) => line.replace(/^[\s•\-*]+/, "").trim())
    .filter(Boolean);
}

/** Extracts a clean domain label from a full URL, e.g. "firecrawl.dev" */
function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Groups cards by domain, preserving insertion order. */
function groupByDomain(cards: TrackedUrlCard[]): Map<string, TrackedUrlCard[]> {
  const map = new Map<string, TrackedUrlCard[]>();
  for (const card of cards) {
    const d = domainOf(card.url);
    if (!map.has(d)) map.set(d, []);
    map.get(d)!.push(card);
  }
  return map;
}

/** Parses a comma-separated string of URLs into an array of trimmed URLs. */
function parseCustomUrls(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

type RunResult =
  | { status: "initial" }
  | { status: "unchanged" }
  | { status: "no_meaningful_change" }
  | { status: "changes"; summary: string }
  | { status: "error"; message: string };

// ─── Shared form primitives ──────────────────────────────────────────────────

const inputCls =
  "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";

function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500">
          {label}
        </label>
        {hint && <span className="text-xs text-zinc-400">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

// ─── Priority badge ──────────────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: SuggestedUrl["priority"] }) {
  const styles = {
    high:   "bg-red-50 text-red-700 border-red-100",
    medium: "bg-amber-50 text-amber-700 border-amber-100",
    low:    "bg-zinc-100 text-zinc-500 border-zinc-200",
  } as const;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${styles[priority]}`}>
      {priority}
    </span>
  );
}

// ─── Shared schedule picker ──────────────────────────────────────────────────

type ScheduleState = {
  scheduleType: ScheduleType;
  scheduleTime: string;
  scheduleDay: number;
  timezone: string;
};

function SchedulePicker({
  value,
  onChange,
}: {
  value: ScheduleState;
  onChange: (next: ScheduleState) => void;
}) {
  const browserTimezone = useMemo(() => getBrowserTimezone(), []);
  const timezoneOptions = useMemo(() => {
    const opts = [...COMMON_TIMEZONES];
    if (!opts.includes(browserTimezone)) opts.unshift(browserTimezone);
    return opts;
  }, [browserTimezone]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Frequency">
          <select
            value={value.scheduleType}
            onChange={(e) => onChange({ ...value, scheduleType: e.target.value as ScheduleType })}
            className={inputCls}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </FormField>
        <FormField label="Time">
          <input
            type="time"
            required
            value={value.scheduleTime}
            onChange={(e) => onChange({ ...value, scheduleTime: e.target.value })}
            className={inputCls}
          />
        </FormField>
      </div>
      {value.scheduleType === "weekly" && (
        <FormField label="Day of week">
          <select
            value={value.scheduleDay}
            onChange={(e) => onChange({ ...value, scheduleDay: Number(e.target.value) })}
            className={inputCls}
          >
            {WEEKDAYS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </FormField>
      )}
      <FormField label="Timezone">
        <select
          value={value.timezone}
          onChange={(e) => onChange({ ...value, timezone: e.target.value })}
          className={inputCls}
        >
          {timezoneOptions.map((tz) => (
            <option key={tz} value={tz}>{tz}</option>
          ))}
        </select>
      </FormField>
    </div>
  );
}

// ─── Add Competitor modal ────────────────────────────────────────────────────

type ModalStep = "domain" | "select" | "saving";

function AddCompetitorModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (newCards: TrackedUrlCard[]) => void;
}) {
  const router = useRouter();
  const browserTimezone = useMemo(() => getBrowserTimezone(), []);

  const [step, setStep] = useState<ModalStep>("domain");
  const [domain, setDomain] = useState("");
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestedUrl[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customUrlsRaw, setCustomUrlsRaw] = useState("");
  const [customUrlsError, setCustomUrlsError] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<ScheduleState>({
    scheduleType: "daily",
    scheduleTime: "08:00",
    scheduleDay: 1,
    timezone: browserTimezone,
  });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, startSaveTransition] = useTransition();

  if (!open) return null;

  // ── Step 1: fetch suggestions ────────────────────────────────────────────
  const handleFindPages = async (e: React.FormEvent) => {
    e.preventDefault();
    setFetchError(null);
    setLoadingSuggestions(true);
    try {
      const res = await fetch("/api/suggest-urls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      const data = await res.json();
      if (!res.ok) { setFetchError(data.error ?? "Failed to fetch suggestions"); return; }
      const list: SuggestedUrl[] = data.suggestions ?? [];
      setSuggestions(list);
      setSelected(new Set(list.map((s) => s.url))); // pre-check all 3
      setStep("select");
    } catch {
      setFetchError("Network error — please try again");
    } finally {
      setLoadingSuggestions(false);
    }
  };

  // ── Step 2: validate custom URLs then save ───────────────────────────────
  const handleSave = () => {
    setSaveError(null);
    setCustomUrlsError(null);

    // Parse & validate custom URLs
    const customList = parseCustomUrls(customUrlsRaw);
    const invalidCustom = customList.filter((u) => {
      try { new URL(u); return false; } catch { return true; }
    });
    if (invalidCustom.length > 0) {
      setCustomUrlsError(`Invalid URL${invalidCustom.length > 1 ? "s" : ""}: ${invalidCustom.join(", ")}`);
      return;
    }

    const suggestedToSave = suggestions.filter((s) => selected.has(s.url));
    const customToSave = customList.map((u) => ({ url: u, reason: null }));

    if (suggestedToSave.length === 0 && customToSave.length === 0) {
      setSaveError("Select at least one page or add a custom URL");
      return;
    }

    setStep("saving");
    startSaveTransition(async () => {
      const allToSave = [
        ...suggestedToSave.map((s) => ({ url: s.url, label: s.reason })),
        ...customToSave.map((s) => ({ url: s.url, label: s.reason })),
      ];

      const results = await Promise.allSettled(
        allToSave.map((s) =>
          fetch("/api/urls", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url: s.url,
              label: s.label,
              schedule_type: schedule.scheduleType,
              schedule_time: schedule.scheduleTime,
              schedule_day: schedule.scheduleType === "weekly" ? schedule.scheduleDay : null,
              timezone: schedule.timezone,
            }),
          }).then((r) => r.json())
        )
      );

      const failures = results.filter((r) => r.status === "rejected");
      if (failures.length > 0) {
        setSaveError(`${failures.length} page(s) failed to save`);
        setStep("select");
        return;
      }

      // Map API responses → TrackedUrlCard so the dashboard updates immediately
      const newCards: TrackedUrlCard[] = results
        .filter((r): r is PromiseFulfilledResult<Record<string, unknown>> => r.status === "fulfilled")
        .map((r) => ({
          id:           r.value.id as string,
          label:        (r.value.label as string | null) ?? null,
          url:          r.value.url as string,
          lastChecked:  null,
          lastChange:   null,
          nextRunAt:    (r.value.next_run_at as string | null) ?? null,
          scheduleType: r.value.schedule_type as ScheduleType,
          scheduleTime: String(r.value.schedule_time).slice(0, 5),
          scheduleDay:  (r.value.schedule_day as number | null) ?? null,
          timezone:     r.value.timezone as string,
        }));

      onSaved(newCards);
      handleClose();
      router.refresh();
    });
  };

  const toggleUrl = (url: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  };

  const handleClose = () => {
    setStep("domain");
    setDomain("");
    setSuggestions([]);
    setSelected(new Set());
    setCustomUrlsRaw("");
    setCustomUrlsError(null);
    setFetchError(null);
    setSaveError(null);
    onClose();
  };

  const totalToSave = selected.size + parseCustomUrls(customUrlsRaw).filter((u) => {
    try { new URL(u); return true; } catch { return false; }
  }).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={handleClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-zinc-100 px-6 py-4">
          <div>
            {step === "domain" && (
              <>
                <h2 className="text-base font-semibold text-zinc-900">Add competitor</h2>
                <p className="mt-0.5 text-sm text-zinc-500">Enter a domain to discover pages worth monitoring.</p>
              </>
            )}
            {(step === "select" || step === "saving") && (
              <>
                <h2 className="text-base font-semibold text-zinc-900">Select pages to track</h2>
                <p className="mt-0.5 text-sm text-zinc-500">
                  Top suggestions for{" "}
                  <span className="font-medium text-zinc-700">{domain}</span>
                </p>
              </>
            )}
          </div>
          <button onClick={handleClose} className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── Step: domain ── */}
        {step === "domain" && (
          <form onSubmit={handleFindPages} className="space-y-4 px-6 py-5">
            <FormField label="Competitor domain">
              <input
                type="text"
                required
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="firecrawl.dev"
                autoFocus
                className={inputCls}
              />
            </FormField>

            {fetchError && (
              <div className="flex gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
                <svg className="mt-0.5 h-4 w-4 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <span>{fetchError}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-zinc-100 pt-4">
              <button type="button" onClick={handleClose} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
                Cancel
              </button>
              <button
                type="submit"
                disabled={loadingSuggestions}
                className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {loadingSuggestions ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Analyzing…
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                    </svg>
                    Find pages
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* ── Step: select ── */}
        {(step === "select" || step === "saving") && (
          <div className="space-y-5 px-6 py-5">

            {/* Suggested URL checkboxes */}
            {suggestions.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">
                  Suggested pages
                </p>
                <div className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200">
                  {suggestions.map((s) => {
                    const checked = selected.has(s.url);
                    return (
                      <label
                        key={s.url}
                        className={`flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-zinc-50 ${checked ? "bg-indigo-50/40" : "bg-white"}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleUrl(s.url)}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-600"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-zinc-800">{s.reason}</span>
                            <PriorityBadge priority={s.priority} />
                          </div>
                          <span className="mt-0.5 block truncate text-xs text-zinc-400">{s.url}</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Custom URL input */}
            <div>
              <FormField
                label="Add your own URLs"
                hint="optional"
              >
                <textarea
                  rows={2}
                  value={customUrlsRaw}
                  onChange={(e) => { setCustomUrlsRaw(e.target.value); setCustomUrlsError(null); }}
                  placeholder="https://example.com/pricing, https://example.com/features"
                  className={`${inputCls} resize-none`}
                />
              </FormField>
              <p className="mt-1.5 text-xs text-zinc-400">Separate multiple URLs with commas.</p>
              {customUrlsError && (
                <p className="mt-1.5 text-xs text-red-600">{customUrlsError}</p>
              )}
            </div>

            {/* Schedule */}
            <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Check schedule — applies to all selected pages
              </p>
              <SchedulePicker value={schedule} onChange={setSchedule} />
            </div>

            {saveError && (
              <div className="flex gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
                <svg className="mt-0.5 h-4 w-4 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <span>{saveError}</span>
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-zinc-100 pt-4">
              <button
                type="button"
                onClick={() => { setStep("domain"); setSuggestions([]); setSelected(new Set()); setSaveError(null); setCustomUrlsRaw(""); setCustomUrlsError(null); }}
                disabled={isSaving}
                className="flex items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-700 disabled:opacity-40"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                </svg>
                Back
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving || totalToSave === 0}
                className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {isSaving ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Saving…
                  </>
                ) : (
                  `Track ${totalToSave} page${totalToSave !== 1 ? "s" : ""}`
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Run result panel ────────────────────────────────────────────────────────

function RunResultPanel({ result }: { result: RunResult }) {
  if (result.status === "error") return (
    <div className="mt-4 flex gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
      <svg className="mt-0.5 h-4 w-4 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
      </svg>
      <span>{result.message}</span>
    </div>
  );
  if (result.status === "initial") return (
    <div className="mt-4 flex gap-2 rounded-lg bg-indigo-50 px-3 py-2.5 text-sm text-indigo-800">
      <svg className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
      </svg>
      <span>First snapshot saved. Run again later to detect changes.</span>
    </div>
  );
  if (result.status === "unchanged") return (
    <div className="mt-4 flex gap-2 rounded-lg bg-zinc-100 px-3 py-2.5 text-sm text-zinc-600">
      <svg className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>No changes detected since the last check.</span>
    </div>
  );
  if (result.status === "no_meaningful_change") return (
    <div className="mt-4 flex gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
      <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
      </svg>
      <span>Content changed, but no meaningful differences (pricing, features, or messaging).</span>
    </div>
  );
  return (
    <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-3 py-3 text-sm text-green-900">
      <div className="flex items-center gap-1.5">
        <svg className="h-4 w-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="font-medium">Changes detected</span>
      </div>
      <ul className="mt-2 space-y-1">
        {summaryToBullets(result.summary).map((bullet, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Tracked URL card ────────────────────────────────────────────────────────

function TrackedUrlCardItem({
  card,
  displayTimezone,
  onDelete,
  onRunComplete,
}: {
  card: TrackedUrlCard;
  displayTimezone: string;
  onDelete: (id: string) => void;
  onRunComplete: () => void;
}) {
  const [isDeleting, startDeleteTransition] = useTransition();
  const [isRunning, setIsRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);

  const handleDelete = () => {
    if (!confirm(`Stop tracking "${card.label ?? card.url}"?`)) return;
    startDeleteTransition(async () => {
      await deleteTrackedUrl(card.id);
      onDelete(card.id);
    });
  };

  const handleRunNow = async () => {
    setIsRunning(true);
    setRunResult(null);
    try {
      const scrapeRes = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: card.url, tracked_url_id: card.id }),
      });
      const scrapeData = await scrapeRes.json();
      if (!scrapeRes.ok) throw new Error(scrapeData.error ?? "Scrape failed");

      const { current, previous } = scrapeData as { current: string; previous: string | null };
      if (previous === null) { setRunResult({ status: "initial" }); onRunComplete(); return; }
      if (previous === current) { setRunResult({ status: "unchanged" }); onRunComplete(); return; }

      const diffRes = await fetch("/api/diff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ today: current, yesterday: previous }),
      });
      const diffData = await diffRes.json();
      if (!diffRes.ok) throw new Error(diffData.error ?? "Diff failed");

      if (diffData.summary === "NO_CHANGE" || !diffData.diff) {
        setRunResult({ status: "no_meaningful_change" });
      } else {
        setRunResult({ status: "changes", summary: diffData.summary });
      }
      onRunComplete();
    } catch (err) {
      setRunResult({ status: "error", message: err instanceof Error ? err.message : "Run failed" });
    } finally {
      setIsRunning(false);
    }
  };

  const scheduleLabel =
    card.scheduleType === "daily"
      ? `Daily · ${card.scheduleTime.slice(0, 5)}`
      : `Weekly · ${WEEKDAYS.find((d) => d.value === card.scheduleDay)?.label ?? "—"} · ${card.scheduleTime.slice(0, 5)}`;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-zinc-900">{card.label ?? "Untitled"}</h3>
          <a
            href={card.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 flex items-center gap-1 truncate text-sm text-zinc-400 hover:text-indigo-600"
          >
            <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
            </svg>
            <span className="truncate">{card.url}</span>
          </a>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button
            onClick={handleRunNow}
            disabled={isRunning || isDeleting}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-50"
          >
            {isRunning ? (
              <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
              </svg>
            )}
            {isRunning ? "Running…" : "Run"}
          </button>
          <button
            onClick={handleDelete}
            disabled={isDeleting || isRunning}
            className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
          >
            {isDeleting ? "…" : "Delete"}
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        <svg className="h-3.5 w-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-xs text-zinc-500">{scheduleLabel} · {card.timezone}</span>
      </div>

      <div className="mt-4 grid grid-cols-3 divide-x divide-zinc-100 rounded-lg border border-zinc-100 bg-zinc-50">
        {[
          { label: "Last checked", value: formatDate(card.lastChecked, displayTimezone) },
          { label: "Last change",  value: formatDate(card.lastChange,  displayTimezone) },
          { label: "Next run",     value: formatDate(card.nextRunAt,   displayTimezone) },
        ].map((stat) => (
          <div key={stat.label} className="px-3 py-2.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">{stat.label}</p>
            <p className="mt-0.5 text-xs font-medium leading-snug text-zinc-700">{stat.value}</p>
          </div>
        ))}
      </div>

      {runResult && <RunResultPanel result={runResult} />}
    </div>
  );
}

// ─── Domain section header ────────────────────────────────────────────────────

function DomainSection({
  domain,
  cards,
  displayTimezone,
  onDelete,
  onRunComplete,
}: {
  domain: string;
  cards: TrackedUrlCard[];
  displayTimezone: string;
  onDelete: (id: string) => void;
  onRunComplete: () => void;
}) {
  return (
    <section>
      {/* Domain header */}
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-100">
          {/* favicon */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
            alt=""
            className="h-4 w-4 rounded-sm"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        </div>
        <span className="text-sm font-semibold text-zinc-800">{domain}</span>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500">
          {cards.length} page{cards.length !== 1 ? "s" : ""}
        </span>
        <div className="h-px flex-1 bg-zinc-100" />
      </div>

      {/* Cards grid */}
      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((card) => (
          <TrackedUrlCardItem
            key={card.id}
            card={card}
            displayTimezone={displayTimezone}
            onDelete={onDelete}
            onRunComplete={onRunComplete}
          />
        ))}
      </div>
    </section>
  );
}

// ─── Dashboard root ──────────────────────────────────────────────────────────

export default function DashboardContent({
  trackedUrls,
  changeHistory,
}: {
  trackedUrls: TrackedUrlCard[];
  changeHistory: ChangeHistoryItem[];
}) {
  const router = useRouter();
  const displayTimezone = useMemo(() => getBrowserTimezone(), []);
  const [modalOpen, setModalOpen] = useState(false);
  const [cards, setCards] = useState(trackedUrls);

  const domainGroups = useMemo(() => groupByDomain(cards), [cards]);

  const handleDelete = (id: string) => {
    setCards((prev) => prev.filter((c) => c.id !== id));
    router.refresh();
  };

  return (
    <>
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-zinc-900">Tracked pages</h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            {cards.length === 0
              ? "No pages monitored yet"
              : `${cards.length} page${cards.length !== 1 ? "s" : ""} across ${domainGroups.size} competitor${domainGroups.size !== 1 ? "s" : ""}`}
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add competitor
        </button>
      </div>

      {/* Empty state */}
      {cards.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-zinc-200 bg-white p-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-zinc-100 bg-zinc-50">
            <svg className="h-6 w-6 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <p className="mt-4 text-sm font-medium text-zinc-900">No competitors tracked yet</p>
          <p className="mt-1 text-sm text-zinc-500">Add a competitor domain to discover pages worth monitoring.</p>
          <button
            onClick={() => setModalOpen(true)}
            className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Add your first competitor
          </button>
        </div>
      ) : (
        /* Domain-grouped sections */
        <div className="mt-6 space-y-8">
          {Array.from(domainGroups.entries()).map(([domain, domainCards]) => (
            <DomainSection
              key={domain}
              domain={domain}
              cards={domainCards}
              displayTimezone={displayTimezone}
              onDelete={handleDelete}
              onRunComplete={() => router.refresh()}
            />
          ))}
        </div>
      )}

      {/* Change history */}
      <section className="mt-14">
        <div className="flex items-baseline justify-between">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">Change history</h2>
            <p className="mt-0.5 text-sm text-zinc-500">Meaningful changes detected across your tracked pages</p>
          </div>
          {changeHistory.length > 0 && (
            <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
              {changeHistory.length}
            </span>
          )}
        </div>

        {changeHistory.length === 0 ? (
          <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-8 text-center">
            <p className="text-sm text-zinc-400">No changes detected yet.</p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {changeHistory.map((change) => (
              <article key={change.id} className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-medium text-zinc-900">{change.label ?? "Untitled"}</h3>
                    <a
                      href={change.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-sm text-zinc-400 hover:text-indigo-600"
                    >
                      <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                      </svg>
                      {change.url}
                    </a>
                  </div>
                  <time className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-500">
                    {formatDate(change.detectedAt, displayTimezone)}
                  </time>
                </div>
                <ul className="mt-3 space-y-1.5 border-t border-zinc-100 pt-3">
                  {summaryToBullets(change.summary).map((bullet, i) => (
                    <li key={i} className="flex gap-2 text-sm text-zinc-700">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        )}
      </section>

      <AddCompetitorModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={(newCards) => setCards((prev) => [...newCards, ...prev])}
      />
    </>
  );
}
