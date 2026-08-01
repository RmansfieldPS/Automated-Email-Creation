// Edge Function: marketo — the only thing that talks to the Marketo REST API.
// Deploy via Supabase Dashboard > Edge Functions > New function ("marketo"),
// paste this file, keep "Verify JWT" ON, and set these secrets (Function > Secrets):
//   MKTO_BASE_URL      e.g. https://123-ABC-456.mktorest.com   (no trailing slash)
//   MKTO_CLIENT_ID     LaunchPoint custom service client id
//   MKTO_CLIENT_SECRET LaunchPoint custom service client secret
//   MKTO_APP_URL       optional, e.g. https://app-ab12.marketo.com (for deep links)
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { createClient } from "npm:@supabase/supabase-js@2";

const MKTO_BASE = (Deno.env.get("MKTO_BASE_URL") ?? "").replace(/\/$/, "");
const MKTO_ID = Deno.env.get("MKTO_CLIENT_ID") ?? "";
const MKTO_SECRET = Deno.env.get("MKTO_CLIENT_SECRET") ?? "";
const MKTO_APP = (Deno.env.get("MKTO_APP_URL") ?? "").replace(/\/$/, "");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ---- Marketo auth (token cached across warm invocations) ----
let cached: { token: string; exp: number } | null = null;

async function mktoToken(): Promise<string> {
  if (cached && Date.now() < cached.exp) return cached.token;
  const r = await fetch(
    `${MKTO_BASE}/identity/oauth/token?grant_type=client_credentials` +
      `&client_id=${encodeURIComponent(MKTO_ID)}&client_secret=${encodeURIComponent(MKTO_SECRET)}`,
  );
  const j = await r.json();
  if (!j.access_token) throw new Error("Marketo auth failed: " + JSON.stringify(j));
  // expires_in is seconds (~3600); refresh 5 min early
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in - 300) * 1000 };
  return cached.token;
}

async function mkto(path: string, init?: RequestInit): Promise<any> {
  const token = await mktoToken();
  const r = await fetch(`${MKTO_BASE}/rest${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  const j = await r.json();
  if (j.success === false) {
    throw new Error(`Marketo error on ${path}: ` + JSON.stringify(j.errors ?? j));
  }
  return j;
}

// Marketo asset POSTs take x-www-form-urlencoded params
function form(params: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  };
}

// ---- actions ----

async function getTokens(programId: number) {
  // NOTE: /program/{id}/tokens.json returns 610 on this instance — the folder
  // endpoint with folderType=Program is the one that works (verified 2026-07-31).
  const j = await mkto(`/asset/v1/folder/${programId}/tokens.json?folderType=Program`);
  const first = j.result?.[0];
  const tokens = Array.isArray(first?.tokens) ? first.tokens : (j.result ?? []);
  return tokens.map((t: any) => ({ name: t.name, type: t.type, value: t.value ?? "" }));
}

async function createProgram(
  svc: ReturnType<typeof createClient>,
  user: { id: string; email?: string },
  body: any,
) {
  const { templateId, programName, tokens } = body;
  if (!templateId || !programName?.trim()) throw new Error("templateId and programName are required");

  const { data: tpl, error: tplErr } = await svc
    .from("eb_templates").select("*").eq("id", templateId).eq("active", true).single();
  if (tplErr || !tpl) throw new Error("Template not found or inactive");

  const run: any = {
    template_id: tpl.id,
    created_by: user.id,
    created_by_email: user.email ?? null,
    program_name: programName.trim(),
    token_values: tokens ?? [],
    status: "ok",
  };

  try {
    // 1. clone the source program into the destination folder.
    // Marketo occasionally throws a transient 611 "System error" on clone —
    // one retry after a short pause clears it (observed 2026-07-31).
    const cloneParams = form({
      name: programName.trim(),
      description: "Created via Email Builder by " + (user.email ?? "unknown"),
      folder: JSON.stringify({ id: tpl.dest_folder_id, type: "Folder" }),
    });
    let cloneRes: any;
    try {
      cloneRes = await mkto(`/asset/v1/program/${tpl.marketo_program_id}/clone.json`, cloneParams);
    } catch (e) {
      if (!String(e).includes('"611"')) throw e;
      await new Promise((r) => setTimeout(r, 3000));
      cloneRes = await mkto(`/asset/v1/program/${tpl.marketo_program_id}/clone.json`, cloneParams);
    }
    const newId = cloneRes.result?.[0]?.id;
    if (!newId) throw new Error("Clone returned no program id: " + JSON.stringify(cloneRes));
    run.new_program_id = newId;

    // 2. write each token onto the clone (sequential — keeps well under rate limits).
    // Same instance quirk as reads: token writes go through the folder endpoint
    // with folderType=Program, not /program/{id}/tokens.json.
    const written: string[] = [];
    for (const t of tokens ?? []) {
      if (t.value === undefined || t.value === null || t.value === "") continue; // keep template default
      await mkto(
        `/asset/v1/folder/${newId}/tokens.json`,
        form({ folderType: "Program", name: t.name, type: t.type, value: String(t.value) }),
      );
      written.push(t.name);
    }

    await svc.from("eb_runs").insert(run);
    return {
      programId: newId,
      tokensWritten: written,
      url: MKTO_APP ? `${MKTO_APP}/#PG${newId}A1` : null,
    };
  } catch (e) {
    run.status = "error";
    run.error = String(e?.message ?? e);
    await svc.from("eb_runs").insert(run);
    throw e;
  }
}

// ---- entry ----

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    if (!MKTO_BASE || !MKTO_ID || !MKTO_SECRET) {
      throw new Error("Marketo secrets not configured (MKTO_BASE_URL / MKTO_CLIENT_ID / MKTO_CLIENT_SECRET)");
    }

    // Identify the caller (JWT already verified by the platform when Verify JWT is on)
    const authHeader = req.headers.get("Authorization") ?? "";
    const anon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await anon.auth.getUser();
    if (userErr || !user) throw new Error("Not signed in");

    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    let result: unknown;
    switch (body.action) {
      case "ping": {
        await mktoToken();
        result = { ok: true, base: MKTO_BASE, user: user.email };
        break;
      }
      case "tokens": {
        if (!body.programId) throw new Error("programId required");
        result = { tokens: await getTokens(Number(body.programId)) };
        break;
      }
      case "create": {
        result = await createProgram(svc, user, body);
        break;
      }
      default:
        throw new Error("Unknown action: " + body.action);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
