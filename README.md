# Email Builder — Marketo Program Cloner

Internal PartsSource Marketing tool: pick a template, fill in a dynamic form
(one field per Marketo **My Token**), and the app clones the Marketo program
and writes your values onto the clone. Human still QAs + approves in Marketo.

**Architecture:** buildless static site (same pattern as PMPM) + its own
Supabase project (`xmkygnefoxhmzcdpypgy` — users managed in Authentication →
Add user, Auto Confirm ON) + one Supabase **Edge Function** (`marketo`)
that holds the Marketo credentials and is the only thing that calls Marketo.

```
Browser (Netlify static)  →  Edge Function 'marketo' (JWT-gated, holds secrets)  →  Marketo REST
                          →  Supabase Postgres (eb_templates, eb_runs)
```

## Setup (one time)

### 1. Marketo (already done — verified by smoke test 2026-07-31)
- API user: `marketingtech@partssource.com` (LaunchPoint custom service).
- REST endpoint: `https://278-GLN-894.mktorest.com`
- App URL (deep links): `https://app-mlm2002.marketo.com`
- Template program: **1164 "Basic Automated Email"** — tokens `SubjectLine`,
  `Headline`, `Subheadline`, `Body Copy`, `CTA` (all `text`).
- Clone destination: **folder 654 "Automated Email Creation"**.

**Instance quirks (baked into the code — don't "fix" them back):**
- `GET/POST /asset/v1/program/{id}/tokens.json` returns **610** here. Token
  reads/writes must use `/asset/v1/folder/{id}/tokens.json` with
  `folderType=Program`.
- Folder ids in Marketo UI URLs (`MF1416A1`) are **not** REST API folder ids —
  always resolve folders via the API (`/asset/v1/folders.json`), not the URL.
- Clone can throw a transient **611 System error**; the Edge Function retries
  once after 3s.

### 2. Smoke test (rerun any time credentials/templates change)
```powershell
.\tools\smoke-test.ps1 -BaseUrl "https://278-GLN-894.mktorest.com" -ClientId "..." -ClientSecret "..." -ProgramId 1164
# add: -CloneTo 654            to test a real clone + token write
# add: -Cleanup                to auto-delete the test clone afterward
```

### 3. Supabase (dashboard, same project as PMPM)
1. SQL Editor → run `db/schema.sql`.
2. Edge Functions → **New function** named `marketo`, paste
   `supabase/functions/marketo/index.ts`, keep **Verify JWT** ON, deploy.
3. On the function, add secrets:
   - `MKTO_BASE_URL` = `https://278-GLN-894.mktorest.com`
   - `MKTO_CLIENT_ID` = (LaunchPoint client id)
   - `MKTO_CLIENT_SECRET` = (LaunchPoint client secret)
   - `MKTO_APP_URL` = `https://app-mlm2002.marketo.com`
4. Templates: `db/schema.sql` already inserts the pilot template
   (program 1164 → folder 654). Add more rows later for new templates —
   with 2+ active templates the picker screen appears automatically.

> **Never put the client secret in this repo or in any js/ file.** It lives
> only in the Edge Function secrets.

### 4. Hosting
Push to GitHub, add as a new Netlify site (no build command, publish dir = root).
GitHub Pages is blocked by the corporate firewall — use Netlify, same as PMPM.

## Token types → form controls
text → input · rich text → built-in rich text editor (toolbar + `</>` raw HTML
view; visual output is sanitized to email-safe tags) · date → date picker ·
number/score → number. Text tokens whose NAME contains "Image URL" also get an
**Upload image** button: the file goes to Marketo Design Studio (folder 976
"Email Builder Uploads" — override via `MKTO_IMAGE_FOLDER_ID` secret) and the
returned public URL fills the field. Fields are pre-filled with the template's
current values; blank = keep template default.

## Pilot scope
In: clone + token fill + audit log. Out: email editing/preview, approvals,
smart campaign activation, sends. Templates are the leverage point — the more
of the email is tokenized, the more the form can drive.
