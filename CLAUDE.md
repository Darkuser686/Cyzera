# CYZERA website — notes for Claude

Static site. No server, no build step, no dependencies. Open `index.html` and
it runs. Preview with `py -3 -m http.server 8000` if you want it over HTTP.

## Where things live

| I want to change... | Edit |
|---|---|
| Registration links | `assets/js/data.js` |
| Any page text, team members, events | `index.html` |
| Colours, layout, animation | `assets/css/styles.css` |
| Routing, admin panel behaviour | `assets/js/app.js` |
| Admin login | `assets/js/auth-config.js` (hash only) |

## Rules that matter

- **Bump the `?v=` number** on the `<script>`/`<link>` tags in `index.html`
  whenever you edit `styles.css` or any JS. Without it browsers keep running
  the old file after a deploy, which looks exactly like a broken site.
- **Team photos are the originals, byte-for-byte.** Never re-encode or crop the
  files. Framing is controlled only by the inline `--pos` / `--zoom` on each
  `<img class="member__photo">`.
- The admin login check runs in the browser, so it is a courtesy barrier, not
  security. Never put a plaintext password in any committed file — only the
  SHA-256 hash in `auth-config.js`.
- Poster images go through `readPosterFile()` in `app.js` — always resized on
  a canvas and re-encoded as JPEG before being stored. Never store a raw
  upload directly; an unresized phone photo (several MB) baked into every
  visitor's `data.js` load is a real performance problem, not a theoretical
  one.
- This site has no backend, so registrant sign-up data (name, semester,
  branch) cannot be collected or viewed on the site itself — see
  `REGISTRATIONS-GUIDE.md`. Don't quietly reintroduce a server or database for
  this; that was explicitly removed once already. If the club wants that
  back, it's a deliberate decision to raise, not a default to reach for.
- Public site is strictly blue and white. Red and green appear only inside the
  admin panel (destructive actions, success messages).

## Admin panel

Opens with **Ctrl + Shift + A** — the `#/admin` URL alone does not open it.
Username `Cyzera_Admin`. Edits save to that browser only; **Publish → Download
data.js**, then replace `assets/js/data.js` and commit to publish for everyone.

## Deploying

GitHub Pages from `main`, root folder. See `DEPLOY-GITHUB.md`.
