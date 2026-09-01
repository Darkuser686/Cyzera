# CYZERA — club website

Site for **CYZERA**, the cyber security and digital innovation club of
Al Azhar College of Engineering and Technology, Thodupuzha, Idukki.

Static front end plus a small Python backend. Nothing to install — everything
uses the Python standard library.

---

## Running it

```bash
py -3 server.py
```

Then open <http://localhost:8787>. On the same Wi-Fi, other devices can reach it
at `http://<your-ip>:8787` (run `ipconfig` to find the address).

| flag | effect |
|---|---|
| `--port 9000` | listen on a different port |
| `--host 127.0.0.1` | this machine only (default is reachable on the LAN) |
| `--reset-password cyzera_admin` | set a new random password and print it |

---

## Admin

The Admin link is **not** in the navigation or the footer, and typing `#/admin`
in the address bar does **not** open it. It opens with:

**Ctrl + Shift + A**

That is convenience, not protection. What actually protects the panel is the
server: every write is rejected without a valid session.

### First login

On first run the server creates an admin account with a random 20-character
password, prints it to the console, and writes it to `FIRST_RUN_PASSWORD.txt`.
Sign in, change the password from **Admin → Settings**, then **delete that
file**.

Locked out? `py -3 server.py --reset-password cyzera_admin`.

### How the login is protected

- The password is stored in SQLite as a salted **scrypt** hash
  (`n=32768, r=8, p=1`) — never in plain text, never sent to the browser.
- Comparison is constant-time (`hmac.compare_digest`).
- A successful login returns an **HttpOnly** cookie, so page scripts cannot read
  or forge a session.
- Writes require a valid session **and** an `X-Requested-With` header, which
  blocks cross-site form posts.
- **8 failed logins from one address** locks that address out for 15 minutes.
- Failed logins spend the same time whether or not the username exists, so
  response timing does not reveal valid usernames.
- Changing the password signs out every other session.
- `cyzera.db`, `server.py` and `FIRST_RUN_PASSWORD.txt` are never served over
  HTTP, and path traversal (`../`) is blocked.

### Password policy

Enforced on the server; the Settings form shows the same rules live as you type.
At least 12 characters, with lowercase, uppercase, a digit, a symbol, and 6+
distinct characters. Rejected: common passwords including leetspeak and suffixed
variants (`Password123!`, `P@ssw0rd123!x`), keyboard and alphabet runs (`abcd`,
`1234`, `qwerty`), four or more repeats of one character, the username, and the
word "cyzera".

---

## Publishing registration links

Admin → Form links. Create, edit, reorder, open/close and delete. **Changes are
live for every visitor immediately** — the links live in the database, so there
is no file to export and upload any more.

---

## Database

SQLite, created automatically as `cyzera.db` on first run.

| table | holds |
|---|---|
| `admin` | username, scrypt hash, salt and hash parameters |
| `session` | active login tokens and their expiry |
| `forms` | the registration links shown on the site |
| `login_attempt` | recent failures, for the lockout |

`assets/js/data.js` is **not** loaded by the site. The server reads it once, to
seed an empty database on first run.

Back up by copying `cyzera.db`. To start over, delete it and restart — a new
admin account and password will be generated.

---

## Files

```
server.py                       backend: SQLite, auth, API, static files
cyzera.db                       created on first run — BACK THIS UP
index.html                      all six pages (hash-routed single page)
favicon.svg                     circuit-C mark
assets/css/styles.css           theme, layout, animation
assets/js/app.js                routing, registration board, admin panel
assets/js/data.js               first-run seed only
assets/img/                     logos and team photos
```

### Pages

`#/` Home · `#/about` About Us · `#/team` Team · `#/events` Our Events ·
`#/register` Registrations · `#/admin` Admin *(unlisted, shortcut only)*

The Team page has three groups: **The people who started CYZERA** (Secretary,
Vice President, Treasurer), **The people running CYZERA** (Executive Head, Team
Coordinator) and **Our Media Team**.

---

## Notes

- **Team photo files are the originals, byte-for-byte.** Each card is a fixed
  4:5 frame and the photo fills it edge to edge (`object-fit: cover`), so cards
  line up with no blank bands. Only the *framing* is adjusted, per photo, via
  `--pos` so nobody's head is cropped — plus `--zoom` on the one photo that has
  a white mat baked into the file.
- Two-card groups use `repeat(2, minmax(0, 370px))` with `space-between`, so one
  card sits flush left and one flush right, at the same size as the three-up row.
- **The CYZERA wordmark is the real logotype, traced to vector** — six SVG paths,
  0.981 IoU against the supplied artwork, so the shield-C, cut-Z and notched-E
  are exact. Headings use **Poppins**, the closest match on Google Fonts; change
  `--font-display` to swap it.
- The hero and nav mark is the **real circuit-C artwork** with its black ground
  keyed to transparency. The rotating light arc and scan line are `mask-image`d
  to the mark's own alpha, so light falls only on the artwork.
- HTML, CSS and JS are served `no-cache`, and `styles.css` / `app.js` carry a
  `?v=` version. Without that a browser keeps running the previous build after an
  edit — which looks exactly like a broken site.
- `prefers-reduced-motion` is respected throughout.
- The public site is strictly blue and white; red and green appear only inside
  the admin panel, for destructive actions and success messages.
- `--blue-btn` is a deeper blue for filled buttons with white text: white on
  `--blue` is 3.65:1 and fails WCAG AA, this one is 5.16:1.

---

## Before putting this on the public internet

This server is fine for a class demo or campus Wi-Fi. Beyond that, put it behind
nginx or Caddy with HTTPS, and add `Secure` to the session cookie — it is
currently `HttpOnly` and `SameSite=Strict` but not `Secure`, because local use is
over plain HTTP.
