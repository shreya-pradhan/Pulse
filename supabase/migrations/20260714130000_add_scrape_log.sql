-- Durable, queryable record of every scrape attempt (manual or scheduled,
-- success or failure) — net._http_response is transient (auto-pruned after
-- a few hours) and snapshots only records successes, so neither answers
-- "which URLs were scraped when, and what happened."
create table public.scrape_log (
  id uuid primary key default gen_random_uuid(),
  tracked_url_id uuid references public.tracked_urls (id) on delete set null,
  url text not null,
  triggered_by text not null check (triggered_by in ('manual', 'cron')),
  status text not null check (status in ('success', 'error')),
  error_message text,
  created_at timestamptz not null default now()
);

create index scrape_log_tracked_url_id_idx on public.scrape_log (tracked_url_id);
create index scrape_log_created_at_idx on public.scrape_log (created_at desc);

alter table public.scrape_log enable row level security;

create policy "Users can view own scrape log"
  on public.scrape_log for select
  using (
    exists (
      select 1
      from public.tracked_urls
      where tracked_urls.id = scrape_log.tracked_url_id
        and tracked_urls.user_id = auth.uid()
    )
  );
