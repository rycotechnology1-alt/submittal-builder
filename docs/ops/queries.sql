-- Submittal Builder admin queries.
--
-- These are the canned SQL snippets we run against the production database
-- when triaging pilot issues. No admin UI ships at MVP per scope.
-- Run via `psql $DATABASE_URL_DIRECT -f docs/ops/queries.sql -v ON_ERROR_STOP=1`
-- or paste them into a SQL console one at a time.
--
-- Naming convention: every query is prefixed with `\echo` so the operator
-- sees which one ran when the file is piped through psql.

\echo '== failed processing jobs in last 24h =='
select id,
       package_id,
       source_pdf_id,
       kind,
       attempts,
       status,
       error,
       started_at,
       finished_at
from processing_jobs
where status = 'failed'
  and coalesce(finished_at, created_at) > now() - interval '24 hours'
order by coalesce(finished_at, created_at) desc
limit 100;

\echo '== oldest queued/running processing jobs =='
select id,
       package_id,
       source_pdf_id,
       kind,
       attempts,
       status,
       extract(epoch from (now() - created_at)) as age_seconds
from processing_jobs
where status in ('queued', 'running')
order by created_at asc
limit 50;

\echo '== packages stuck in processing for over an hour =='
select id,
       workspace_id,
       project_id,
       status,
       updated_at,
       extract(epoch from (now() - updated_at)) as seconds_in_status
from packages
where status = 'processing'
  and updated_at < now() - interval '1 hour'
order by updated_at asc;

\echo '== failed exports in the last 24h =='
select id,
       package_id,
       error,
       created_at,
       updated_at,
       extract(epoch from (updated_at - created_at)) as failed_after_seconds
from exports
where status = 'failed'
  and created_at > now() - interval '24 hours'
order by created_at desc;

\echo '== slowest exports (top 25) =='
select id,
       package_id,
       byte_size,
       page_count,
       extract(epoch from (updated_at - created_at)) as render_seconds
from exports
where status = 'ready'
order by render_seconds desc nulls last
limit 25;

\echo '== source PDFs in error state =='
select id,
       workspace_id,
       package_id,
       processing_status,
       processing_error,
       updated_at
from source_pdfs
where processing_status = 'error'
order by updated_at desc
limit 100;

\echo '== pg-boss dead-letter (failed jobs) =='
-- pg-boss owns this table; we just read it. Useful when our processing_jobs
-- audit row is missing because pg-boss rejected the job before our handler
-- ran. `job` is the queue name (ocr, classify, extract, batch_order, render_export).
select id,
       name as queue,
       state,
       retrycount,
       startedon,
       completedon,
       output
from pgboss.job
where state in ('failed', 'expired')
  and createdon > now() - interval '24 hours'
order by completedon desc nulls last
limit 50;

\echo '== workspace activity in last 7 days =='
select w.id,
       w.name,
       count(distinct p.id) filter (where p.created_at > now() - interval '7 days') as new_projects,
       count(distinct pk.id) filter (where pk.created_at > now() - interval '7 days') as new_packages,
       count(distinct e.id) filter (where e.created_at > now() - interval '7 days') as new_exports
from workspaces w
left join projects p on p.workspace_id = w.id and p.deleted_at is null
left join packages pk on pk.workspace_id = w.id and pk.deleted_at is null
left join exports e on e.package_id = pk.id
group by w.id, w.name
order by new_exports desc nulls last, new_packages desc nulls last
limit 50;

\echo '== prompt-cache eligibility audit (per-attempt error breakdown) =='
select kind,
       status,
       attempts,
       count(*) as job_count
from processing_jobs
where created_at > now() - interval '24 hours'
group by kind, status, attempts
order by kind, status, attempts;
