# CYZERA — club website

Site for **CYZERA**, the cyber security and digital innovation club of
Al Azhar College of Engineering and Technology, Thodupuzha, Idukki.

A static website — HTML, CSS and JavaScript, hosted on GitHub Pages. It runs
in one of two modes, chosen by whether `assets/js/supabase-config.js` is
filled in:

| | **Static mode** (config blank — what's live now) | **Registrations mode** (Supabase connected) |
|---|---|---|
| Registrations page | cards linking out to Google Forms | event cards → event page → built-in form |
| Who registered | in your Google Sheet | in the admin panel, searchable, **Download Excel** |
| Building a form | in Google Forms | in the admin panel, like Google Forms |
| Backend | none | Supabase (free tier), which you set up once |

To switch on registrations mode → **[SUPABASE-SETUP.md](SUPABASE-SETUP.md)**.
About 15 minutes.

---

## The admin panel

Not linked from the navigation or the footer, and typing `#/admin` in the
address bar does **not** open it. It opens with **Ctrl + Shift + A**.

The username is `Cyzera_Admin`. The password is **deliberately not written in
this repository** — only a SHA-256 hash of it lives in
`assets/js/auth-config.js`, so publishing the code does not publish the
password. Ask whoever set the site up, or reset it from **Settings**.

Sign in and you can add, edit, reorder, open/close and delete registration
links, each with an optional **poster image** (upload a JPG or PNG — it is
resized and compressed automatically, then click the poster on the public
page to see it full size). Changes are live in that browser straight away.
To publish them to everyone: **Publish → Download data.js**, replace
`assets/js/data.js`, push.

To change the login, use **Settings** — it generates a hash line to paste into
`assets/js/auth-config.js`.

**Be clear-eyed about this login.** There is no server, so the check runs in the
browser and anyone who opens developer tools can work around it. It keeps the
panel out of a casual visitor's way; it is not a lock. Nothing sensitive sits
behind it — an intruder could only change the links on their own screen,
because publishing for real means committing `data.js`.

## Editing the links by hand

Open `assets/js/data.js` and edit the list:

```js
{
  id: 'f-shieldxtech',
  title: 'Shield X Tech — General Registration',
  event: 'Shield X Tech',
  description: 'One form, all four tracks.',
  url: 'https://forms.gle/YOUR-LINK-HERE',
  deadline: '',            // optional, 'YYYY-MM-DD'
  status: 'open'           // 'open' or 'closed'
}
```

A link shows as **open** only when `status` is `'open'` **and** `url` is a real
`https://` address. `poster` is optional — a `data:` URL (what the admin panel
writes) or a path like `assets/img/posters/name.jpg` if you add the file
yourself. Save, push, done.

---

## Collecting registrants (name, semester, branch) and an Excel export

Two ways, and they can coexist:

**Registrations mode** (recommended) — connect Supabase and every event gets
its own form built in the admin panel. Every form asks Full name, Semester
and Branch, plus whatever you add. Registrants appear in the admin panel
with a **Download Excel** button. The database enforces slots, open/closed
status and no-duplicate-phone rules itself. See
**[SUPABASE-SETUP.md](SUPABASE-SETUP.md)**.

**Google Forms** — works in either mode. In static mode it is the only
option; in registrations mode, paste a Google Forms link into an event's
"External form instead" box and the Register button goes there. See
**[REGISTRATIONS-GUIDE.md](REGISTRATIONS-GUIDE.md)**.

---

## Files

```
index.html                      all six pages (hash-routed single page)
favicon.svg                     circuit-C mark
.nojekyll                       stops GitHub Pages running Jekyll
assets/css/styles.css           theme, layout, animation
assets/js/app.js                routing, static-mode board and admin panel
assets/js/registrations.js      registrations mode: events, forms, admin, export
assets/js/supabase-config.js    paste your Supabase URL + anon key to switch modes
assets/js/data.js               the registration links (static mode)
assets/js/auth-config.js        the admin login hash (static mode)
assets/js/sha256.js             hashing for the static-mode login
assets/img/                     logos and team photos
supabase/schema.sql             tables, policies, triggers — run once in Supabase
SUPABASE-SETUP.md               switching on registrations mode
REGISTRATIONS-GUIDE.md          using Google Forms instead, or alongside
DEPLOY-GITHUB.md                publishing on GitHub Pages
```

### Pages

`#/` Home · `#/about` About Us · `#/team` Team · `#/hod` HOD's Message ·
`#/events` Our Events · `#/register` Registrations · `#/register/<event>` one
event's page *(registrations mode)* · `#/admin` Admin *(unlisted, shortcut only)*

The Team page has five groups: **From the Department** (HOD, Mentor), **The
people who started CYZERA** (Secretary, Vice President, Treasurer), **The people
running CYZERA** (Executive Head, Team Coordinator), **Our Media Team**, and
**Digital Author**.

---

## Notes

- **Registration cards can carry a poster image**, uploaded in the admin
  editor as a plain file — no server involved. It is downscaled to a max
  width of 1000px and re-encoded as JPEG on a `<canvas>` before being stored,
  so a multi-megabyte phone photo becomes a card image of a few hundred KB
  rather than bloating `localStorage` or the exported `data.js`. Click a
  poster on the Registrations page to see it full size.
- **Team photo files are the originals, byte-for-byte.** Each card is a fixed
  4:5 frame and the photo fills it edge to edge (`object-fit: cover`), so cards
  line up with no blank bands and every subject is centred. Only the *framing*
  is adjusted per photo, with an inline `--zoom`: `1.06` on the secretary's
  photo to hide the white mat baked into the file, and `1.4` / `1.55` on the two
  full-body shots so the person is roughly the same size as in the headshots.
- Two-card groups use `repeat(2, minmax(0, 370px))` with `space-between`, so one
  card sits flush left and one flush right, at the same size as the three-up row.
- **The CYZERA wordmark is the real logotype, traced to vector** — six SVG paths,
  0.981 IoU against the supplied artwork, so the shield-C, cut-Z and notched-E
  are exact. Headings use **Poppins**, the closest match on Google Fonts; change
  `--font-display` to swap it.
- The hero and nav mark is the **real circuit-C artwork** with its black ground
  keyed to transparency. The rotating light arc and scan line are `mask-image`d
  to the mark's own alpha, so light falls only on the artwork.
- `styles.css` and the scripts carry a `?v=8` query. **Bump that number when you
  edit them**, or browsers keep running the previous version after a deploy —
  which looks exactly like a broken site.
- `prefers-reduced-motion` is respected throughout.
- The public site is strictly blue and white; red and green appear only inside
  the admin panel, for destructive actions and success messages.
- `--blue-btn` is a deeper blue for filled buttons with white text: white on
  `--blue` is 3.65:1 and fails WCAG AA, this one is 5.16:1.

---

## Previewing locally

Double-click `index.html`. Everything works straight off the filesystem — the
login, the admin panel, all of it.

If you would rather serve it over HTTP (closer to how it behaves once
deployed):

```bash
py -3 -m http.server 8000
```

Then open <http://localhost:8000>.
