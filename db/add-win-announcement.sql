-- Adds the PRO Win Announcement template (2026-09-09).
-- Marketo program 1238 "EM-2026-08-PS-Pro-Brand-PRO Win Announcement Automated Test"
-- (11 fillable tokens; the 'First Name Proper Caps' script token is filtered out
-- by the app). Clones land in folder 654 "Automated Email Creation".
-- Run once in the Supabase SQL Editor.

insert into eb_templates (name, description, marketo_program_id, dest_folder_id, sort)
values ('PRO Win Announcement',
        'Customer win announcement: subject, hero, intro, body copy, CTA. First-name personalization stays automatic.',
        1238, 654, 2);
