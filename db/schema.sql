-- Email Builder (Marketo Program Cloner) — schema
-- Runs in the Email Builder's own Supabase project (xmkygnefoxhmzcdpypgy).
-- Run once in the Supabase SQL Editor.

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

-- Any signed-in team member can see templates and run history.
-- Writes happen only through the Edge Function (service role bypasses RLS);
-- templates are managed in the Supabase dashboard / SQL editor for the pilot.
drop policy if exists eb_tpl_read on eb_templates;
create policy eb_tpl_read on eb_templates for select to authenticated using (true);

drop policy if exists eb_run_read on eb_runs;
create policy eb_run_read on eb_runs for select to authenticated using (true);

-- Pilot template (verified by API smoke test 2026-07-31):
--   program 1164 = "Basic Automated Email" (tokens: SubjectLine, Headline,
--   Subheadline, Body Copy, CTA — all text)
--   folder 654 = "Automated Email Creation" (clone destination)
insert into eb_templates (name, description, marketo_program_id, dest_folder_id, sort)
values ('Basic Automated Email',
        'Clones the Basic Automated Email program: subject line, headline, subheadline, body copy, CTA.',
        1164, 654, 1);
