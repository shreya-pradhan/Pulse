-- User plan enum
create type public.user_plan as enum ('free', 'paid');

-- Users (linked to Supabase Auth)
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  plan public.user_plan not null default 'free',
  created_at timestamptz not null default now()
);

-- Tracked URLs
create table public.tracked_urls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  url text not null,
  label text,
  created_at timestamptz not null default now()
);

-- Snapshots
create table public.snapshots (
  id uuid primary key default gen_random_uuid(),
  tracked_url_id uuid not null references public.tracked_urls (id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

-- Changes
create table public.changes (
  id uuid primary key default gen_random_uuid(),
  tracked_url_id uuid not null references public.tracked_urls (id) on delete cascade,
  diff text not null,
  summary text not null,
  detected_at timestamptz not null default now()
);

-- Indexes
create index tracked_urls_user_id_idx on public.tracked_urls (user_id);
create index snapshots_tracked_url_id_idx on public.snapshots (tracked_url_id);
create index changes_tracked_url_id_idx on public.changes (tracked_url_id);

-- Row-level security
alter table public.users enable row level security;
alter table public.tracked_urls enable row level security;
alter table public.snapshots enable row level security;
alter table public.changes enable row level security;

-- Users: own row only
create policy "Users can view own profile"
  on public.users for select
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.users for insert
  with check (auth.uid() = id);

create policy "Users can update own profile"
  on public.users for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Tracked URLs: own rows only
create policy "Users can view own tracked urls"
  on public.tracked_urls for select
  using (auth.uid() = user_id);

create policy "Users can insert own tracked urls"
  on public.tracked_urls for insert
  with check (auth.uid() = user_id);

create policy "Users can update own tracked urls"
  on public.tracked_urls for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own tracked urls"
  on public.tracked_urls for delete
  using (auth.uid() = user_id);

-- Snapshots: via owned tracked URLs
create policy "Users can view own snapshots"
  on public.snapshots for select
  using (
    exists (
      select 1
      from public.tracked_urls
      where tracked_urls.id = snapshots.tracked_url_id
        and tracked_urls.user_id = auth.uid()
    )
  );

create policy "Users can insert own snapshots"
  on public.snapshots for insert
  with check (
    exists (
      select 1
      from public.tracked_urls
      where tracked_urls.id = snapshots.tracked_url_id
        and tracked_urls.user_id = auth.uid()
    )
  );

create policy "Users can update own snapshots"
  on public.snapshots for update
  using (
    exists (
      select 1
      from public.tracked_urls
      where tracked_urls.id = snapshots.tracked_url_id
        and tracked_urls.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.tracked_urls
      where tracked_urls.id = snapshots.tracked_url_id
        and tracked_urls.user_id = auth.uid()
    )
  );

create policy "Users can delete own snapshots"
  on public.snapshots for delete
  using (
    exists (
      select 1
      from public.tracked_urls
      where tracked_urls.id = snapshots.tracked_url_id
        and tracked_urls.user_id = auth.uid()
    )
  );

-- Changes: via owned tracked URLs
create policy "Users can view own changes"
  on public.changes for select
  using (
    exists (
      select 1
      from public.tracked_urls
      where tracked_urls.id = changes.tracked_url_id
        and tracked_urls.user_id = auth.uid()
    )
  );

create policy "Users can insert own changes"
  on public.changes for insert
  with check (
    exists (
      select 1
      from public.tracked_urls
      where tracked_urls.id = changes.tracked_url_id
        and tracked_urls.user_id = auth.uid()
    )
  );

create policy "Users can update own changes"
  on public.changes for update
  using (
    exists (
      select 1
      from public.tracked_urls
      where tracked_urls.id = changes.tracked_url_id
        and tracked_urls.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.tracked_urls
      where tracked_urls.id = changes.tracked_url_id
        and tracked_urls.user_id = auth.uid()
    )
  );

create policy "Users can delete own changes"
  on public.changes for delete
  using (
    exists (
      select 1
      from public.tracked_urls
      where tracked_urls.id = changes.tracked_url_id
        and tracked_urls.user_id = auth.uid()
    )
  );
