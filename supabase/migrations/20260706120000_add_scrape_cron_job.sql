-- Schedules the scrape dispatcher to run every 15 minutes, replacing the
-- Vercel cron (which is limited to daily on the Hobby plan).
--
-- Prerequisite (run once, manually, in the Supabase SQL Editor — do NOT
-- commit this to git since it embeds the real secret value):
--
--   select vault.create_secret('<your CRON_SECRET value>', 'cron_secret');
--
-- This lets the job authenticate to /api/cron/scrape without the secret
-- ever appearing in a tracked file or in `cron.job`'s plaintext command text.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

select cron.schedule(
  'pulse-scrape-tick',
  '*/15 * * * *',
  $$
  select net.http_get(
    url := 'https://pulse-chi-sepia.vercel.app/api/cron/scrape',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    )
  );
  $$
);

-- Verify with:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 20;
--   select * from net._http_response order by created desc limit 20;
