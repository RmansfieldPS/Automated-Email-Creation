-- Email Builder — COMPLETE setup, idempotent. Safe to run on a fresh project
-- or re-run on an existing one.
--
-- Use this when standing the app up in a NEW Supabase project (e.g. after the
-- old one was paused past recovery). It replaces running schema.sql +
-- add-win-announcement.sql + upgrade-open-signup.sql separately.
--
-- After running, remember the parts that do NOT live in SQL:
--   1. js/config.js  -> new SUPABASE_URL + anon key
--   2. Edge Function 'marketo' (supabase/functions/marketo/index.ts), Verify JWT ON
--   3. Function secrets: MKTO_BASE_URL, MKTO_CLIENT_ID, MKTO_CLIENT_SECRET,
--      MKTO_APP_URL, and optionally MKTO_IMAGE_FOLDER_ID
--   4. Auth settings: allow signups ON, confirm email OFF

create table if not exists eb_templates (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  description         text,
  marketo_program_id  int  not null,          -- the source program to clone
  dest_folder_id      int  not null,          -- Marketo folder id clones land in
  active              boolean not null default true,
  sort                int not null default 0,
  created_at          timestamptz not null default now()
);

create table if not exists eb_runs (
  id                  uuid primary key default gen_random_uuid(),
  template_id         uuid references eb_templates(id) on delete set null,
  created_by          uuid,                   -- auth.users id
  created_by_email    text,
  program_name        text not null,
  new_program_id      int,                    -- Marketo id of the clone (null on failure)
  token_values        jsonb not null default '[]'::jsonb,
  status              text not null default 'ok' check (status in ('ok','error')),
  error               text,
  created_at          timestamptz not null default now()
);

alter table eb_templates enable row level security;
alter table eb_runs      enable row level security;

-- Signup is open, so the access boundary is the email domain. The Edge
-- Function enforces the same rule for every Marketo action.
drop policy if exists eb_tpl_read on eb_templates;
create policy eb_tpl_read on eb_templates for select to authenticated
  using ((auth.jwt() ->> 'email') ilike '%@partssource.com');

drop policy if exists eb_run_read on eb_runs;
create policy eb_run_read on eb_runs for select to authenticated
  using ((auth.jwt() ->> 'email') ilike '%@partssource.com');

-- Templates (Marketo ids verified 2026-11-19). Insert only if missing so this
-- file stays safe to re-run.
insert into eb_templates (name, description, marketo_program_id, dest_folder_id, sort)
select 'Basic Automated Email',
       'Clones the Basic Automated Email program: subject line, headline, subheadline, body copy, CTA.',
       1164, 654, 1
where not exists (select 1 from eb_templates where marketo_program_id = 1164);

insert into eb_templates (name, description, marketo_program_id, dest_folder_id, sort)
select 'PRO Win Announcement',
       'Customer win announcement: subject, hero, intro, body copy, CTA. First-name personalization stays automatic.',
       1238, 654, 2
where not exists (select 1 from eb_templates where marketo_program_id = 1238);
