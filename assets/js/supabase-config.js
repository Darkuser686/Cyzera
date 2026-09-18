/* ============================================================
   CYZERA — Supabase connection

   Fill in the two values from your Supabase dashboard:
     Project Settings → API → "Project URL", and the "anon public" key.

   Both are SAFE to commit and to serve publicly. The anon key only grants
   what the Row Level Security policies in supabase/schema.sql allow — read
   published events, submit a registration — and nothing else until an admin
   signs in.

   NEVER put the "service_role" key here. That one bypasses every policy.

   Leave both blank and the site runs in its older mode: registration cards
   link out to Google Forms listed in assets/js/data.js, and nothing is
   collected on the site itself.
   ============================================================ */

window.CYZERA_SUPABASE = {
  url: '',      // e.g. 'https://abcdefghijklm.supabase.co'
  anonKey: ''   // e.g. 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
};
