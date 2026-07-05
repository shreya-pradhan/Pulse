import { NextRequest, NextResponse } from "next/server";
import {
  formatScheduleResponse,
  type ScheduleInput,
  toScheduleRow,
  validateSchedule,
} from "@/lib/schedule";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { parseTrackedUrl } from "@/lib/urls";

async function getAuthenticatedSupabase() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  await supabase.from("users").upsert(
    { id: user.id, email: user.email },
    { onConflict: "id" }
  );

  return { supabase, user };
}

function parseSchedule(body: Record<string, unknown>): ScheduleInput {
  return {
    scheduleType: body.schedule_type as ScheduleInput["scheduleType"],
    scheduleTime: String(body.schedule_time ?? "08:00"),
    scheduleDay:
      body.schedule_day === null || body.schedule_day === undefined
        ? null
        : Number(body.schedule_day),
    timezone: String(body.timezone ?? "UTC"),
  };
}

function mapUrlResponse(
  row: Record<string, unknown>,
  displayTimezone: string
) {
  const nextRunAt = (row.next_run_at as string | null) ?? null;
  const timezone = (row.timezone as string) ?? displayTimezone;

  return {
    id: row.id,
    url: row.url,
    label: row.label,
    schedule_type: row.schedule_type,
    schedule_time: row.schedule_time,
    schedule_day: row.schedule_day,
    timezone: row.timezone,
    ...formatScheduleResponse(nextRunAt, displayTimezone || timezone),
  };
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedSupabase();
  if ("error" in auth) return auth.error;

  const { supabase, user } = auth;

  try {
    const body = await request.json();
    const label = typeof body.label === "string" ? body.label.trim() : "";
    const schedule = parseSchedule(body);
    const scheduleError = validateSchedule(schedule);

    if (scheduleError) {
      return NextResponse.json({ error: scheduleError }, { status: 400 });
    }

    let url: string;
    try {
      url = parseTrackedUrl(String(body.url ?? ""));
    } catch {
      return NextResponse.json({ error: "Please enter a valid URL" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("tracked_urls")
      .insert({
        user_id: user.id,
        url,
        label: label || null,
        ...toScheduleRow(schedule),
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(mapUrlResponse(data, schedule.timezone), {
      status: 201,
    });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await getAuthenticatedSupabase();
  if ("error" in auth) return auth.error;

  const { supabase, user } = auth;

  try {
    const body = await request.json();
    const id = body.id;

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};

    if (body.label !== undefined) {
      updates.label =
        typeof body.label === "string" && body.label.trim()
          ? body.label.trim()
          : null;
    }

    if (body.url !== undefined) {
      try {
        updates.url = parseTrackedUrl(String(body.url));
      } catch {
        return NextResponse.json(
          { error: "Please enter a valid URL" },
          { status: 400 }
        );
      }
    }

    const hasScheduleFields =
      body.schedule_type !== undefined ||
      body.schedule_time !== undefined ||
      body.schedule_day !== undefined ||
      body.timezone !== undefined;

    let displayTimezone = String(body.timezone ?? "UTC");

    if (hasScheduleFields) {
      const { data: existing, error: fetchError } = await supabase
        .from("tracked_urls")
        .select("schedule_type, schedule_time, schedule_day, timezone")
        .eq("id", id)
        .eq("user_id", user.id)
        .single();

      if (fetchError || !existing) {
        return NextResponse.json({ error: "URL not found" }, { status: 404 });
      }

      const schedule = parseSchedule({
        schedule_type: body.schedule_type ?? existing.schedule_type,
        schedule_time: body.schedule_time ?? existing.schedule_time,
        schedule_day:
          body.schedule_day !== undefined
            ? body.schedule_day
            : existing.schedule_day,
        timezone: body.timezone ?? existing.timezone,
      });

      const scheduleError = validateSchedule(schedule);
      if (scheduleError) {
        return NextResponse.json({ error: scheduleError }, { status: 400 });
      }

      Object.assign(updates, toScheduleRow(schedule));
      displayTimezone = schedule.timezone;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("tracked_urls")
      .update(updates)
      .eq("id", id)
      .eq("user_id", user.id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: "URL not found" }, { status: 404 });
    }

    return NextResponse.json(
      mapUrlResponse(data, displayTimezone || data.timezone)
    );
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
