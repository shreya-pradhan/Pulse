-- Schedule type enum
create type public.schedule_type as enum ('daily', 'weekly');

-- Scheduling columns on tracked_urls
alter table public.tracked_urls
  add column schedule_type public.schedule_type not null default 'daily',
  add column schedule_time time not null default '08:00',
  add column schedule_day integer,
  add column timezone text not null default 'UTC',
  add column next_run_at timestamptz;

alter table public.tracked_urls
  add constraint tracked_urls_schedule_day_valid check (
    (schedule_type = 'daily' and schedule_day is null)
    or (schedule_type = 'weekly' and schedule_day between 0 and 6)
  );

create index tracked_urls_next_run_at_idx on public.tracked_urls (next_run_at);

-- Compute next UTC run time from schedule fields
create or replace function public.compute_next_run_at(
  p_schedule_type public.schedule_type,
  p_schedule_time time,
  p_schedule_day integer,
  p_timezone text,
  p_from timestamptz default now()
) returns timestamptz
language plpgsql
stable
as $$
declare
  local_ts timestamp;
  local_target timestamp;
  dow int;
  days_ahead int;
begin
  local_ts := p_from at time zone p_timezone;

  if p_schedule_type = 'daily' then
    local_target := date_trunc('day', local_ts) + p_schedule_time;
    if local_target <= local_ts then
      local_target := local_target + interval '1 day';
    end if;
  else
    dow := extract(dow from local_ts)::int;
    days_ahead := (p_schedule_day - dow + 7) % 7;
    local_target :=
      date_trunc('day', local_ts)
      + (days_ahead * interval '1 day')
      + p_schedule_time;
    if local_target <= local_ts then
      local_target := local_target + interval '7 days';
    end if;
  end if;

  return local_target at time zone p_timezone;
end;
$$;

-- Set next_run_at on create or schedule update
create or replace function public.set_next_run_at()
returns trigger
language plpgsql
as $$
begin
  new.next_run_at := public.compute_next_run_at(
    new.schedule_type,
    new.schedule_time,
    new.schedule_day,
    new.timezone,
    now()
  );
  return new;
end;
$$;

create trigger tracked_urls_set_next_run_at
  before insert
  or update of schedule_type, schedule_time, schedule_day, timezone
  on public.tracked_urls
  for each row
  execute function public.set_next_run_at();

-- Backfill existing rows
update public.tracked_urls
set
  schedule_type = schedule_type,
  next_run_at = public.compute_next_run_at(
    schedule_type,
    schedule_time,
    schedule_day,
    timezone,
    now()
  )
where next_run_at is null;
