/* Email Builder configuration.
 *
 * Points at the Email Builder's own Supabase project (separate from PMPM, so
 * users are managed separately: Dashboard -> Authentication -> Add user).
 * The anon key is a public client key — safe to commit; the database is
 * protected by Row Level Security and all Marketo calls go through the
 * 'marketo' Edge Function (secrets live server-side, never here).
 */
window.EB_CONFIG = {
  SUPABASE_URL: "https://xmkygnefoxhmzcdpypgy.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhta3lnbmVmb3hobXpjZHB5cGd5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1NDQyNTEsImV4cCI6MjEwMTEyMDI1MX0.sxNHAzR61ArWM2jOrEAKTpZznPjMWv7cLk_-Y7GV1bg"
};
