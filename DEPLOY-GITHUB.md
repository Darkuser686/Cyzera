# Publishing CYZERA on GitHub Pages

Gets the site online at a link you can share. Free, no card, about 10 minutes.

---

## 1. Put the folder on GitHub

If you have GitHub Desktop, drag the `Cyzera` folder in and publish. From a
terminal:

```bash
cd "C:/Users/user/Downloads/Cyzera"
git init
git add .
git commit -m "CYZERA club website"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/cyzera.git
git push -u origin main
```

Everything in the folder is meant to be public — there are no secrets in it.

## 2. Turn on Pages

Repository → **Settings** → **Pages** → Source: **Deploy from a branch** →
Branch `main`, folder `/ (root)` → **Save**.

Wait a minute, then your site is at:

```
https://YOUR-USERNAME.github.io/cyzera/
```

That is the link to share.

---

## Editing the registration links

The links live in `assets/js/data.js`. Two ways to change them:

**From the admin panel.** Open the site, press **Ctrl + Shift + A**, sign in,
edit the links, then go to the **Publish** tab and click **Download data.js**.
Replace `assets/js/data.js` with that file, commit and push.

**By hand.** Edit `assets/js/data.js` directly:

```js
{
  id: 'f-shieldxtech',
  title: 'Shield X Tech — General Registration',
  event: 'Shield X Tech',
  description: 'One form, all four tracks.',
  url: 'https://forms.gle/YOUR-LINK-HERE',
  deadline: '',
  status: 'open'          // 'open' or 'closed'
}
```

A link shows as open only when `status` is `'open'` **and** `url` is a real
`https://` address.

Either way, GitHub Pages redeploys about a minute after you push.

> Edits made in the admin panel are stored in that browser until you export and
> push. They are live for you immediately, but nobody else sees them until
> `data.js` is committed.

## Vercel instead

Same repo works. Add New → Project → import it. Framework preset **Other**,
no build command, output directory `.`.

---

## Updating the site later

```bash
git add .
git commit -m "what changed"
git push
```

Pages rebuilds automatically.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| 404 at the Pages URL | Give it 2–3 minutes after enabling; check Settings → Pages shows a green "Your site is live" |
| Page loads but is unstyled | Almost always a stale browser cache — hard reload with Ctrl+Shift+R |
| Registrations page empty | `assets/js/data.js` has no entries, or the file failed to load |
| Changes not showing | Confirm the push landed on `main`, then hard reload |
| Admin panel will not open | Press Ctrl + Shift + A; the URL alone does not open it |

`.nojekyll` in the repo root stops GitHub running the Jekyll blog engine over
the site. Leave it there.
