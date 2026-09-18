-- =====================================================================
-- CYZERA — event registrations
--
-- Paste this whole file into Supabase → SQL Editor → Run. Safe to re-run.
--
-- The rule, enforced by Postgres and not by anything on the page:
--   * anyone may read published events and submit a registration
--   * only accounts listed in `admins` may create or edit events, or read
--     who has registered
-- Editing the site in devtools changes nothing here.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Events — each one is a registration form, built in the admin panel
-- ---------------------------------------------------------------------
create table if not exists public.events (
  id            text primary key,
  title         text        not null,
  department    text        not null default '',
  category      text        not null default 'Competition',
  description   text        not null default '',
  rules         text        not null default '',
  poster        text        not null default '',       -- data: URL or asset path
  event_date    text        not null default '',       -- 'YYYY-MM-DD'
  event_time    text        not null default '',       -- free text, e.g. '10:00 am'
  venue         text        not null default '',
  fee           text        not null default '',       -- free text, e.g. '₹150' or 'Free'
  team_size     text        not null default '',       -- free text, e.g. '3–5'
  slots         integer,                               -- null = unlimited
  status        text        not null default 'draft',  -- draft | open | closed
  external_url  text        not null default '',       -- if set, Register goes here instead
  fields        jsonb       not null default '[]'::jsonb,
  sort_order    integer     not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint events_status_valid   check (status in ('draft', 'open', 'closed')),
  constraint events_category_valid check (category in ('Competition', 'Workshop', 'Talk', 'Other')),
  constraint events_slots_positive check (slots is null or slots > 0)
);

create index if not exists events_sort_idx on public.events (sort_order, id);


-- ---------------------------------------------------------------------
-- 2. Registrations — one row per person per event
--
-- full_name / semester / branch are real columns (every form has them, and
-- admins filter and export on them). Everything else the form asked for
-- lives in `data`, keyed by the field's key.
-- ---------------------------------------------------------------------
create table if not exists public.registrations (
  id          uuid        primary key default gen_random_uuid(),
  event_id    text        not null references public.events (id) on delete cascade,
  full_name   text        not null,
  semester    text        not null,
  branch      text        not null,
  email       text,
  phone       text,
  data        jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),

  constraint registrations_name_len  check (char_length(full_name) between 2 and 120),
  constraint registrations_semester  check (semester in ('1','2','3','4','5','6','7','8')),
  constraint registrations_branch    check (branch in
    ('CSE', 'AI & ML', 'Cyber Security', 'Mechanical', 'Electrical', 'Bio Medical'))
);

create index if not exists registrations_event_idx on public.registrations (event_id, created_at);

-- The same phone number cannot register twice for the same event.
create unique index if not exists registrations_no_dupe_phone
  on public.registrations (event_id, phone)
  where phone is not null and phone <> '';


-- ---------------------------------------------------------------------
-- 3. Admins — who may manage events and see registrants
--
-- Rows are added from the SQL editor only (see SUPABASE-SETUP.md). Nothing
-- on the website can add one, so a stray sign-up still cannot see data.
-- ---------------------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text,
  note       text,
  created_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 4. Helpers
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- How many people have registered per event — readable by everyone so the
-- public page can show "slots left" without exposing who registered.
create or replace function public.event_counts()
returns table (event_id text, registered bigint)
language sql stable security definer
set search_path = public
as $$
  select event_id, count(*) from public.registrations group by event_id;
$$;

revoke all on function public.event_counts() from public;
grant execute on function public.event_counts() to anon, authenticated;

-- Refuse a registration the page should never have sent: event not open,
-- or slots exhausted. This is the check that matters; the button state on
-- the page is only a courtesy.
create or replace function public.guard_registration()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  ev public.events%rowtype;
  taken bigint;
begin
  select * into ev from public.events where id = new.event_id;
  if not found then
    raise exception 'That event does not exist.' using errcode = 'P0002';
  end if;
  if ev.status <> 'open' then
    raise exception 'Registrations for this event are closed.' using errcode = 'P0001';
  end if;
  if ev.external_url <> '' then
    raise exception 'This event registers through an external form.' using errcode = 'P0001';
  end if;
  if ev.slots is not null then
    select count(*) into taken from public.registrations where event_id = new.event_id;
    if taken >= ev.slots then
      raise exception 'No slots left for this event.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists registrations_guard on public.registrations;
create trigger registrations_guard
  before insert on public.registrations
  for each row execute function public.guard_registration();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists events_touch on public.events;
create trigger events_touch
  before update on public.events
  for each row execute function public.touch_updated_at();


-- ---------------------------------------------------------------------
-- 5. Row Level Security
-- ---------------------------------------------------------------------
alter table public.events        enable row level security;
alter table public.registrations enable row level security;
alter table public.admins        enable row level security;

-- events
drop policy if exists "published events are public"  on public.events;
drop policy if exists "admins see every event"       on public.events;
drop policy if exists "admins insert events"         on public.events;
drop policy if exists "admins update events"         on public.events;
drop policy if exists "admins delete events"         on public.events;

create policy "published events are public" on public.events
  for select to anon, authenticated using (status <> 'draft' or public.is_admin());
create policy "admins insert events" on public.events
  for insert to authenticated with check (public.is_admin());
create policy "admins update events" on public.events
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins delete events" on public.events
  for delete to authenticated using (public.is_admin());

-- registrations
drop policy if exists "anyone can register"          on public.registrations;
drop policy if exists "admins read registrations"    on public.registrations;
drop policy if exists "admins delete registrations"  on public.registrations;

create policy "anyone can register" on public.registrations
  for insert to anon, authenticated with check (true);   -- the trigger does the real checking
create policy "admins read registrations" on public.registrations
  for select to authenticated using (public.is_admin());
create policy "admins delete registrations" on public.registrations
  for delete to authenticated using (public.is_admin());

-- admins
drop policy if exists "see your own admin row" on public.admins;
create policy "see your own admin row" on public.admins
  for select to authenticated using (user_id = auth.uid());


-- ---------------------------------------------------------------------
-- 6. Starter events (only if the table is empty). Drafts — open them from
--    the admin panel once the details are filled in.
-- ---------------------------------------------------------------------
insert into public.events (id, title, department, category, description, status, sort_order, fields)
select * from (values
  ('shield-x-tech', 'Shield X Tech', 'Cyber Security', 'Competition',
   'One form, four tracks: Treasure Hunt, AI Image Generation, AI Video and eSports.',
   'draft', 0,
   '[{"key":"phone","label":"Phone number","type":"tel","required":true},
     {"key":"track","label":"Track","type":"select","required":true,
      "options":["Treasure Hunt","AI Image Generation","AI Video","eSports"]},
     {"key":"team_name","label":"Team name (if any)","type":"text","required":false}]'::jsonb),
  ('cyber-escape-room', 'Cyber Escape Room', 'Cyber Security', 'Competition',
   'Teams of 3–5. Cryptography, steganography, forensics and OSINT, one lock at a time.',
   'draft', 1,
   '[{"key":"phone","label":"Phone number","type":"tel","required":true},
     {"key":"team_name","label":"Team name","type":"text","required":true},
     {"key":"team_members","label":"Other team members (names)","type":"textarea","required":true}]'::jsonb),
  ('kastral-tech-fest', 'Kastral Tech Fest', 'Cyber Security', 'Competition',
   'Chess, Ludo, PES, Videography, Photography and Human Firewall.',
   'draft', 2,
   '[{"key":"phone","label":"Phone number","type":"tel","required":true},
     {"key":"events","label":"Events you are entering","type":"checkbox","required":true,
      "options":["Chess","Ludo","PES","Videography","Photography","Human Firewall"]}]'::jsonb),
  ('membership', 'CYZERA Membership', 'Cyber Security', 'Other',
   'Join the club. Open to all branches and years; no prior security background needed.',
   'draft', 3,
   '[{"key":"phone","label":"Phone number","type":"tel","required":true},
     {"key":"email","label":"Email","type":"email","required":true}]'::jsonb)
) as seed(id, title, department, category, description, status, sort_order, fields)
where not exists (select 1 from public.events);
