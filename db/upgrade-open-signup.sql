-- Open self-signup hardening (2026-09-15).
-- Signup is now open in the app, so read access is tightened from "any
-- authenticated user" to "any authenticated @partssource.com user".
-- (The Edge Function enforces the same domain rule for all Marketo actions.)
-- Run once in the Supabase SQL Editor.

drop policy if exists eb_tpl_read on eb_templates;
create policy eb_tpl_read on eb_templates for select to authenticated
  using ((auth.jwt() ->> 'email') ilike '%@partssource.com');

drop policy if exists eb_run_read on eb_runs;
create policy eb_run_read on eb_runs for select to authenticated
  using ((auth.jwt() ->> 'email') ilike '%@partssource.com');
