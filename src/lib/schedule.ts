import { SupabaseClient } from "@supabase/supabase-js";

export type ScheduleType = "daily" | "weekly";

export type ScheduleInput = {
  scheduleType: ScheduleType;
  scheduleTime: string;
  scheduleDay: number | null;
  timezone: string;
};

export const WEEKDAYS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
] as const;

export const COMMON_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Asia/Kolkata",
  "Asia/Tokyo",
  "Australia/Sydney",
];

export function getBrowserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function normalizeScheduleTime(time: string): string {
  const match = time.match(/^(\d{1,2}):(\d{2})/);
  if (!match) {
    throw new Error("schedule_time must be in HH:MM format");
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) {
    throw new Error("schedule_time is invalid");
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
}

export function validateSchedule(input: ScheduleInput): string | null {
  if (!["daily", "weekly"].includes(input.scheduleType)) {
    return "schedule_type must be daily or weekly";
  }

  try {
    normalizeScheduleTime(input.scheduleTime);
  } catch (err) {
    return err instanceof Error ? err.message : "Invalid schedule_time";
  }

  if (!input.timezone.trim()) {
    return "timezone is required";
  }

  if (input.scheduleType === "weekly") {
    if (
      input.scheduleDay === null ||
      input.scheduleDay < 0 ||
      input.scheduleDay > 6
    ) {
      return "schedule_day must be 0-6 for weekly schedules";
    }
  } else if (input.scheduleDay !== null) {
    return "schedule_day must be null for daily schedules";
  }

  return null;
}

export function toScheduleRow(input: ScheduleInput) {
  return {
    schedule_type: input.scheduleType,
    schedule_time: normalizeScheduleTime(input.scheduleTime),
    schedule_day: input.scheduleType === "weekly" ? input.scheduleDay : null,
    timezone: input.timezone.trim(),
  };
}

export async function computeNextRunAt(
  supabase: SupabaseClient,
  input: ScheduleInput,
  from?: Date
): Promise<string> {
  const row = toScheduleRow(input);

  const { data, error } = await supabase.rpc("compute_next_run_at", {
    p_schedule_type: row.schedule_type,
    p_schedule_time: row.schedule_time,
    p_schedule_day: row.schedule_day,
    p_timezone: row.timezone,
    p_from: (from ?? new Date()).toISOString(),
  });

  if (error) {
    throw new Error(`Failed to compute next_run_at: ${error.message}`);
  }

  return data as string;
}

export function formatInTimezone(
  iso: string | null,
  timezone: string
): string | null {
  if (!iso) return null;

  return new Date(iso).toLocaleString("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function formatScheduleResponse(
  nextRunAt: string | null,
  timezone: string
) {
  return {
    next_run_at: nextRunAt,
    next_run_at_local: formatInTimezone(nextRunAt, timezone),
  };
}
