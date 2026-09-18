# Using Google Forms for registrations

The site has its own registration system — forms built in the admin panel,
registrants stored in a database, a **Download Excel** button — once
Supabase is connected. That is the recommended route:
**[SUPABASE-SETUP.md](SUPABASE-SETUP.md)**.

This guide is for the other option, which still works in both modes: a
**Google Form per event**, with responses landing in a Google Sheet. Use it
if you'd rather not set up Supabase, or for a one-off event someone else is
running. In registrations mode, paste the form's link into the event's
"External form instead" box and the Register button goes straight to it.

---

## 1. Create the form (about 5 minutes, once per event)

1. Go to <https://forms.google.com> and sign in with the club's Google account.
2. **Blank form.** Title it after the event, e.g. *Shield X Tech — Registration*.
3. Add these three questions (exact settings below), then anything specific
   to that event underneath — team name, track choice, phone number, whatever
   it needs.

### Full Name
- Question type: **Short answer**
- Required: yes

### Semester
- Question type: **Dropdown**
- Options: `1`, `2`, `3`, `4`, `5`, `6`, `7`, `8`
- Required: yes

### Branch
- Question type: **Dropdown**
- Options, in this order:
  - `CSE`
  - `AI & ML`
  - `Cyber Security`
  - `Mechanical`
  - `Electrical`
  - `Bio Medical`
- Required: yes

To add or rename an option later, open the form and edit that question —
there is no code involved anywhere in this step. This is the "add and create
new options" part of the request: it happens inside Google Forms itself,
which is the actual form builder here.

### Poster (optional, on the form itself)
Google Forms can show a header image at the top of the form (Settings → the
paint-roller icon → **Header**) — upload the same poster you use on the
website there if you want it to also appear inside the form.

## 2. Point responses at a spreadsheet

In the form editor, open the **Responses** tab → click the green Sheets icon
→ **Create a new spreadsheet**. Every submission now appears there the moment
someone submits, live, from any device — that spreadsheet **is** the
database of registrants, and it already has the columns Full Name, Semester
and Branch because those are the questions you asked.

## 3. Get the link for the site

Form editor → **Send** → the link icon → tick **Shorten URL** → copy the
`forms.gle/…` link. Paste that into the CYZERA admin panel (Ctrl+Shift+A →
Form links) as you already do, with a poster if you like — the site's
"Publish link" flow is unchanged.

## 4. Download registrants as Excel

Whenever you want the list:

1. Open the response spreadsheet (Responses tab → the Sheets icon takes you
   straight there, or find it in Google Sheets).
2. **File → Download → Microsoft Excel (.xlsx)**.

That's the whole export — a real `.xlsx` file, every registrant, every
column, opens in Excel or Google Sheets, no plugin and nothing to build.

You can also just open the Sheet directly any time to see registrants live,
filter by branch or semester, or sort by submission time — everything a
"view who registered" admin screen would give you, for free, already built
by Google.

---

## One form per event, reused every year

Duplicate an existing form (⋮ menu → **Make a copy**) instead of starting from
scratch — the three fields above stay, you just update the event-specific
questions and swap the response spreadsheet.

## Want it inside the site instead?

That is what registrations mode is: the same three fields, plus anything
you add, in a form on the event's own page, with every registrant in the
admin panel and an Excel button. **[SUPABASE-SETUP.md](SUPABASE-SETUP.md)**.
