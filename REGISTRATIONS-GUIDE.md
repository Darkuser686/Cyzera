# Collecting registrations, and getting them into Excel

Short version: **use a Google Form for each event, with the fields below.**
Responses land in a Google Sheet automatically, and Sheets has a built-in
"Download as Excel" button. That gets you everything asked for — a real
database of registrants, an admin view of who signed up, and an Excel export
— with nothing for you to host or maintain.

---

## Why not a database built into the site?

Worth being upfront about this, because it shapes everything below.

CYZERA is a **static site** — HTML, CSS and JS files with no server. That was
a deliberate choice made earlier (a server and a custom database were tried
and then explicitly removed). A static site can display information, but it
cannot **collect and store data from strangers' browsers** — there is nowhere
for that data to go. Every visitor's browser is isolated from every other
visitor's; nothing you type into a page here reaches anyone else unless
something with a server is standing between you and them.

So "let people register, and let the admin see who registered from any
device" always needs *something* to hold that shared data. Google's own
form-and-spreadsheet combo is that something — proven, free, and it already
does exactly this job for millions of clubs and colleges. This is the same
reason the site's registration cards have always pointed at `forms.gle`
links rather than a form built into the page itself.

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

## If you outgrow this

If the club later wants registrant data to appear *inside* the CYZERA site
itself — a live admin dashboard on the page, rather than a separate Google
Sheet — that is possible, but it means bringing back a real backend
(something like Supabase, which this project has used before). That is a
different trade-off than the one made when the server was removed, so it is
worth a deliberate decision rather than something to slide back into. Ask,
and it can be wired up again.
