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
  url: 'https://jynxbhnmmipiuwsugwcf.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp5bnhiaG5tbWlwaXV3c3Vnd2NmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3NDExOTksImV4cCI6MjEwNTMxNzE5OX0.e18YKtrsi3JGF6mJ4RwmbokOzsdJFPC9EjH3Pm5ozjA'
};
