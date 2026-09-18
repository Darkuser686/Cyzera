# Switching on registrations (Supabase)

This turns the site from "cards that link out to Google Forms" into a real
registration system: events you build in the admin panel, a form on each
event's page, a database of everyone who registered, and a **Download Excel**
button. About 15 minutes, free, no card, nothing to host yourself.

Until you do this the site keeps working exactly as it does now.

---

## 1. Create the project

1. <https://supabase.com> → sign in with GitHub → **New project**.
2. Name it anything, pick a database password (save it — you'll rarely need
   it), choose the region nearest Kerala (**Mumbai / ap-south-1**).
3. Wait for it to finish setting up.

## 2. Create the tables and the security rules

**SQL Editor → New query** → paste the whole of
[`supabase/schema.sql`](supabase/schema.sql) → **Run**.

That creates three tables and locks them down:

| Who | Can see events | Can register | Can build events | Can see who registered |
|---|---|---|---|---|
| Any visitor | published ones | yes | no | no |
| Signed in, not an admin | published ones | yes | no | no |
| Admin | all, incl. drafts | yes | yes | yes |

Those rules live in Postgres. Editing the page in devtools does not get past
them. It also seeds four draft events (Shield X Tech, Cyber Escape Room,
Kastral Tech Fest, Membership) for you to finish and open.

## 3. Create your admin account

**Authentication → Users → Add user → Create new user.** Your real email, a
proper password, tick **Auto Confirm User**.

## 4. Make that account an admin

Signing in is not the same as being allowed in. **SQL Editor**, with your
address:

```sql
insert into public.admins (user_id, email, note)
select id, email, 'club secretary'
from auth.users
where email = 'you@example.com'
on conflict (user_id) do nothing;
```

Nothing on the website can add a row here — only this editor can. A stray
sign-up still sees nothing.

## 5. Lock down sign-ups

**Authentication → Providers → Email:** turn **Enable Sign Ups** off, and set
**Minimum password length** to 10 or more.

## 6. Point the site at the project

**Project Settings → API.** Copy **Project URL** and the **anon public** key
into `assets/js/supabase-config.js`:

```js
window.CYZERA_SUPABASE = {
  url: 'https://YOUR-PROJECT.supabase.co',
  anonKey: 'eyJhbGciOi...'
};
```

Both are safe to commit and to serve publicly — the anon key only grants what
the policies in step 2 allow. **Never** put the `service_role` key here.

Bump the `?v=` number in `index.html`, commit, push. Done.

## 7. Check it worked

1. Open the site → **Registrations**. You should see event cards (once you
   open at least one event — the seeds start as drafts).
2. **Ctrl + Shift + A** → sign in with your email and password.
3. **Events & forms** → Edit one of the drafts, fill in the details, set
   status to **Open**, save.
4. Visit its page as a visitor, register.
5. Back in admin → **Registrations** → your entry is there → **Download
   Excel**.

---

## Using the admin panel

**Events & forms** — every event is its own registration form.

- Details: title, department, category, description, rules (one per line),
  date, time, venue, fee, team size, slots, a poster.
- **Slots**: leave blank for unlimited. When set, the page shows "N slots
  left" and the database refuses the first registration past the limit —
  even from someone calling the API directly.
- **Questions on the form**: works like Google Forms. Every form always asks
  **Full name**, **Semester** (1–8) and **Branch** (CSE, AI & ML, Cyber
  Security, Mechanical, Electrical, Bio Medical). Add anything else: short
  answer, paragraph, email, phone, number, dropdown, multiple choice,
  checkboxes. Reorder, make required or optional, remove. Options for a
  dropdown go one per line.
- **External form instead**: paste a Google Forms link and the Register
  button goes there rather than showing the built-in form. Useful for an
  event someone else runs.
- **Status**: Draft (hidden), Open (accepting), Closed (listed, not
  accepting).

**Registrations** — pick an event or "All events". Search across every
column. Columns are the three fixed questions plus whatever that event
asked. **Download Excel** gives a real `.xlsx`; **CSV** if you prefer.
Delete a row with ✕.

**Settings** — change your password.

## What is and isn't protected

**Protected.** Every write and every read of registrant data is checked by
the database against the policies in `schema.sql`. Slots and open/closed
status are enforced by a trigger in the database, not by the page. The same
phone number cannot register twice for one event. Only accounts in `admins`
can do any admin action, and only the SQL editor can add one.

**Worth knowing.** Ctrl+Shift+A and the hidden `#/admin` route are
convenience — assume people will find the admin page and rely on the
password. The admin session token sits in the tab's `sessionStorage`; it
clears when the tab closes, so sign out on shared machines.

## Locked out?

**Authentication → Users** → your user → **Send password recovery**, or
delete the user and repeat steps 3–4.

## Troubleshooting

| Symptom | Cause |
|---|---|
| "Could not reach the database" | URL wrong in `supabase-config.js`, or offline |
| "signed in, but it is not a CYZERA admin" | Step 4 not done, or a different email |
| Saving an event fails with a row-level security error | Same — the account is not in `admins` |
| Registrations page says no events | Every event is still a draft — open one |
| Visitor gets "No slots left" on an empty event | Slots set to 0 — leave blank for unlimited |
| Changes don't appear | Bump `?v=` in `index.html`, then hard-reload (Ctrl+Shift+R) |
