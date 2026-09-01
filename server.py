#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CYZERA — backend.

Serves the static site and provides a real, server-side admin login backed by
SQLite. Standard library only: no pip install, run it with `py -3 server.py`.

Why this exists
---------------
The site previously checked the admin password in the browser, which meant the
password hash shipped to every visitor and the check could be edited away in
devtools. Here the password never leaves the server, and every write to the
registration links requires a valid session cookie that only a correct login
can produce.

    py -3 server.py                 # http://localhost:8787
    py -3 server.py --port 9000     # different port
    py -3 server.py --host 127.0.0.1  # this machine only (default is LAN)
"""

import argparse
import hashlib
import hmac
import http.cookies
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import sys
import threading
import time
import unicodedata
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote

ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(ROOT, 'cyzera.db')
FIRST_RUN_FILE = os.path.join(ROOT, 'FIRST_RUN_PASSWORD.txt')

SESSION_HOURS = 4
SESSION_COOKIE = 'cyzera_session'

# scrypt parameters. n=2**15 with r=8 costs ~32 MB and ~100 ms per hash, which
# is trivial for one login and brutal for an attacker grinding a stolen DB.
SCRYPT_N, SCRYPT_R, SCRYPT_P, DK_LEN = 2 ** 15, 8, 1, 32

# Login throttle: after this many failures from one address, refuse for a while.
MAX_FAILS, LOCKOUT_SECONDS = 8, 900

_db_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
def connect():
    con = sqlite3.connect(DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA journal_mode=WAL')
    con.execute('PRAGMA foreign_keys=ON')
    return con


def init_db():
    """Create the schema and, on a truly fresh database, a first admin."""
    fresh_admin = None
    with _db_lock, connect() as con:
        con.executescript('''
            CREATE TABLE IF NOT EXISTS admin (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                username     TEXT    NOT NULL UNIQUE,
                pw_hash      BLOB    NOT NULL,
                pw_salt      BLOB    NOT NULL,
                algo         TEXT    NOT NULL DEFAULT 'scrypt',
                n            INTEGER NOT NULL,
                r            INTEGER NOT NULL,
                p            INTEGER NOT NULL,
                must_change  INTEGER NOT NULL DEFAULT 0,
                created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
                updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS session (
                token      TEXT PRIMARY KEY,
                admin_id   INTEGER NOT NULL REFERENCES admin(id) ON DELETE CASCADE,
                expires_at REAL    NOT NULL,
                created_at TEXT    NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS forms (
                id          TEXT PRIMARY KEY,
                title       TEXT NOT NULL,
                event       TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                url         TEXT NOT NULL DEFAULT '',
                deadline    TEXT NOT NULL DEFAULT '',
                status      TEXT NOT NULL DEFAULT 'closed',
                sort_order  INTEGER NOT NULL DEFAULT 0,
                updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS login_attempt (
                ip       TEXT NOT NULL,
                at       REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_attempt_ip ON login_attempt(ip, at);
        ''')

        if con.execute('SELECT COUNT(*) c FROM admin').fetchone()['c'] == 0:
            pw = generate_password()
            store_password(con, 'cyzera_admin', pw, create=True)
            fresh_admin = ('cyzera_admin', pw)

        if con.execute('SELECT COUNT(*) c FROM forms').fetchone()['c'] == 0:
            seed_forms(con)

    if fresh_admin:
        user, pw = fresh_admin
        with open(FIRST_RUN_FILE, 'w', encoding='utf-8') as fh:
            fh.write(
                'CYZERA first-run admin credentials\n'
                '==================================\n\n'
                'username: %s\npassword: %s\n\n'
                'Sign in, change the password from Admin -> Settings,\n'
                'then DELETE this file.\n' % (user, pw))
        banner = '\n'.join([
            '',
            '=' * 62,
            '  FIRST RUN — an admin account was created',
            '',
            '    username: %s' % user,
            '    password: %s' % pw,
            '',
            '  Also written to FIRST_RUN_PASSWORD.txt',
            '  Change it from Admin -> Settings, then delete that file.',
            '=' * 62,
            '',
        ])
        print(banner, flush=True)


def seed_forms(con):
    """Import whatever assets/js/data.js already lists, so nothing is lost."""
    path = os.path.join(ROOT, 'assets', 'js', 'data.js')
    rows = []
    try:
        with open(path, encoding='utf-8') as fh:
            txt = fh.read()
        m = re.search(r'window\.CYZERA_FORMS\s*=\s*(\[.*?\]);', txt, re.S)
        if m:
            blob = re.sub(r'/\*.*?\*/', '', m.group(1), flags=re.S)
            blob = re.sub(r'(\w+)\s*:', r'"\1":', blob)          # keys -> JSON
            blob = blob.replace("'", '"')
            blob = re.sub(r',(\s*[\]\}])', r'\1', blob)          # trailing commas
            rows = json.loads(blob)
    except Exception as exc:                                      # noqa: BLE001
        print('  (could not seed forms from data.js: %s)' % exc, file=sys.stderr)

    for i, f in enumerate(rows):
        con.execute(
            'INSERT OR IGNORE INTO forms (id,title,event,description,url,deadline,status,sort_order)'
            ' VALUES (?,?,?,?,?,?,?,?)',
            (f.get('id') or 'f-%d' % i, f.get('title', 'Untitled'), f.get('event', ''),
             f.get('description', ''), f.get('url', ''), f.get('deadline', ''),
             'open' if f.get('status') == 'open' else 'closed', i))
    if rows:
        print('  seeded %d registration links from data.js' % len(rows))


# ---------------------------------------------------------------------------
# Passwords
# ---------------------------------------------------------------------------
ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*?-_'


def generate_password(length=20):
    """A random password that satisfies our own policy."""
    while True:
        pw = ''.join(secrets.choice(ALPHABET) for _ in range(length))
        if not password_problems(pw, 'cyzera_admin'):
            return pw


COMMON = {
    'password', 'passw0rd', '12345678', '123456789', 'qwerty', 'letmein',
    'admin', 'administrator', 'welcome', 'iloveyou', 'abc123', 'monkey',
    'dragon', 'football', 'baseball', 'sunshine', 'princess', 'qwertyuiop',
    'cyzera', 'cyzera123', 'cyzera@2026', 'changeme', 'secret',
}


LEET = str.maketrans({'0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's',
                      '7': 't', '@': 'a', '$': 's', '!': 'i'})


def looks_common(pw):
    """Catch 'Password123!' as well as plain 'password'.

    An exact-match blocklist is close to useless: appending a digit and a bang
    satisfies every character-class rule while leaving the password guessable.
    So compare the *core* of the password — lowercased, de-leetspeaked, with
    leading/trailing digits and punctuation stripped — against the list.
    """
    raw = (pw or '').lower()
    candidates = {raw, raw.translate(LEET)}
    for c in list(candidates):
        candidates.add(re.sub(r'^[^a-z]+|[^a-z]+$', '', c))   # trim non-letters
        candidates.add(re.sub(r'[^a-z]', '', c))              # letters only
    if any(c in COMMON for c in candidates if c):
        return True

    # "P@ssw0rd123!x" normalises to "passwordi2eix" — the weak word is a prefix,
    # not the whole string, so also look for common words *inside* the password.
    # Only words of 5+ characters, so short entries cannot cause false hits.
    return any(w in c for w in COMMON if len(w) >= 5 for c in candidates if c)


# The club's own name is the first thing anyone who knows the site would try,
# and it was the old default password. Banned anywhere in the string.
SITE_WORDS = ('cyzera',)


def contains_site_word(pw):
    low = (pw or '').lower()
    forms = (low, low.translate(LEET), re.sub(r'[^a-z]', '', low.translate(LEET)))
    return any(w in f for w in SITE_WORDS for f in forms)


SEQUENCES = ('abcdefghijklmnopqrstuvwxyz', '0123456789', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm')


def has_sequence(pw, run=4):
    low = (pw or '').lower()
    for seq in SEQUENCES:
        for i in range(len(seq) - run + 1):
            chunk = seq[i:i + run]
            if chunk in low or chunk[::-1] in low:
                return True
    return False


def password_problems(pw, username=''):
    """Return a list of reasons the password is unacceptable. Empty == fine."""
    problems = []
    pw = unicodedata.normalize('NFKC', pw or '')

    if len(pw) < 12:
        problems.append('must be at least 12 characters')
    if len(pw) > 200:
        problems.append('must be under 200 characters')
    if not re.search(r'[a-z]', pw):
        problems.append('needs a lowercase letter')
    if not re.search(r'[A-Z]', pw):
        problems.append('needs an uppercase letter')
    if not re.search(r'[0-9]', pw):
        problems.append('needs a digit')
    if not re.search(r'[^A-Za-z0-9]', pw):
        problems.append('needs a symbol')
    if looks_common(pw):
        problems.append('is too close to a commonly used password')
    if contains_site_word(pw):
        problems.append('must not contain the club name')
    if has_sequence(pw):
        problems.append('must not contain a run like 1234 or abcd')
    if username and username.lower() in pw.lower():
        problems.append('must not contain the username')
    if re.search(r'(.)\1{3,}', pw):
        problems.append('must not repeat one character four or more times')
    if len(set(pw)) < 6:
        problems.append('needs more variety of characters')
    return problems


def hash_password(pw, salt=None, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P):
    salt = salt or secrets.token_bytes(16)
    pw = unicodedata.normalize('NFKC', pw).encode('utf-8')
    digest = hashlib.scrypt(pw, salt=salt, n=n, r=r, p=p,
                            dklen=DK_LEN, maxmem=n * r * 256)
    return digest, salt


def store_password(con, username, pw, create=False):
    digest, salt = hash_password(pw)
    if create:
        con.execute(
            'INSERT INTO admin (username,pw_hash,pw_salt,algo,n,r,p) VALUES (?,?,?,?,?,?,?)',
            (username, digest, salt, 'scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P))
    else:
        con.execute(
            'UPDATE admin SET pw_hash=?,pw_salt=?,n=?,r=?,p=?,must_change=0,'
            "updated_at=datetime('now') WHERE username=?",
            (digest, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P, username))


def verify_password(row, pw):
    """Constant-time comparison against the stored scrypt digest."""
    try:
        digest, _ = hash_password(pw, salt=bytes(row['pw_salt']),
                                  n=row['n'], r=row['r'], p=row['p'])
    except Exception:                                             # noqa: BLE001
        return False
    return hmac.compare_digest(digest, bytes(row['pw_hash']))


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------
def new_session(con, admin_id):
    token = secrets.token_urlsafe(32)
    con.execute('INSERT INTO session (token,admin_id,expires_at) VALUES (?,?,?)',
                (token, admin_id, time.time() + SESSION_HOURS * 3600))
    con.execute('DELETE FROM session WHERE expires_at < ?', (time.time(),))
    return token


def session_admin(con, token):
    if not token:
        return None
    row = con.execute(
        'SELECT a.*, s.expires_at FROM session s JOIN admin a ON a.id = s.admin_id'
        ' WHERE s.token = ?', (token,)).fetchone()
    if not row or row['expires_at'] < time.time():
        if row:
            con.execute('DELETE FROM session WHERE token=?', (token,))
        return None
    # sliding expiry while the admin is actually working
    con.execute('UPDATE session SET expires_at=? WHERE token=?',
                (time.time() + SESSION_HOURS * 3600, token))
    return row


# ---------------------------------------------------------------------------
# Throttling
# ---------------------------------------------------------------------------
def record_failure(con, ip):
    con.execute('INSERT INTO login_attempt (ip,at) VALUES (?,?)', (ip, time.time()))


def is_locked_out(con, ip):
    cutoff = time.time() - LOCKOUT_SECONDS
    con.execute('DELETE FROM login_attempt WHERE at < ?', (cutoff,))
    n = con.execute('SELECT COUNT(*) c FROM login_attempt WHERE ip=? AND at>=?',
                    (ip, cutoff)).fetchone()['c']
    return n >= MAX_FAILS


def clear_failures(con, ip):
    con.execute('DELETE FROM login_attempt WHERE ip=?', (ip,))


# ---------------------------------------------------------------------------
# URL validation (mirrors the client-side check)
# ---------------------------------------------------------------------------
HOST_RE = re.compile(
    r'^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$', re.I)


def clean_url(raw):
    from urllib.parse import urlsplit
    u = (raw or '').strip()
    if not u:
        return ''
    if not re.match(r'^[a-z][a-z0-9+.-]*:', u, re.I):
        u = 'https://' + u
    parts = urlsplit(u)
    if parts.scheme not in ('http', 'https'):
        return ''
    if not HOST_RE.match(parts.hostname or ''):
        return ''
    return u


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    server_version = 'CyzeraHTTP/1.0'
    protocol_version = 'HTTP/1.1'

    # -- helpers ------------------------------------------------------------
    def client_ip(self):
        return self.client_address[0] if self.client_address else '?'

    def cookie_token(self):
        raw = self.headers.get('Cookie')
        if not raw:
            return None
        try:
            jar = http.cookies.SimpleCookie()
            jar.load(raw)
            return jar[SESSION_COOKIE].value if SESSION_COOKIE in jar else None
        except Exception:                                         # noqa: BLE001
            return None

    def read_json(self, limit=64 * 1024):
        try:
            n = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            return None
        if n <= 0 or n > limit:
            return None
        try:
            return json.loads(self.rfile.read(n).decode('utf-8'))
        except Exception:                                         # noqa: BLE001
            return None

    def send_json(self, obj, status=200, cookie=None):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(body)

    def guard_csrf(self):
        """Reject cross-site form posts: our own fetch() always sends this."""
        return self.headers.get('X-Requested-With') == 'cyzera'

    # -- routing ------------------------------------------------------------
    def do_HEAD(self):
        self._head_only = True
        try:
            self.do_GET()
        finally:
            self._head_only = False

    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        if path.startswith('/api/'):
            return self.api_get(path)
        return self.serve_static(path)

    def do_POST(self):
        path = unquote(urlparse(self.path).path)
        if not path.startswith('/api/'):
            return self.send_json({'error': 'not found'}, 404)
        if not self.guard_csrf():
            return self.send_json({'error': 'bad request'}, 400)
        return self.api_post(path)

    def do_DELETE(self):
        path = unquote(urlparse(self.path).path)
        if not self.guard_csrf():
            return self.send_json({'error': 'bad request'}, 400)
        m = re.match(r'^/api/forms/([\w.-]+)$', path)
        if not m:
            return self.send_json({'error': 'not found'}, 404)
        with _db_lock, connect() as con:
            if not session_admin(con, self.cookie_token()):
                return self.send_json({'error': 'not signed in'}, 401)
            con.execute('DELETE FROM forms WHERE id=?', (m.group(1),))
        return self.send_json({'ok': True})

    # -- API ----------------------------------------------------------------
    def api_get(self, path):
        with _db_lock, connect() as con:
            if path == '/api/forms':
                rows = con.execute(
                    'SELECT id,title,event,description,url,deadline,status'
                    ' FROM forms ORDER BY sort_order, rowid').fetchall()
                return self.send_json({'forms': [dict(r) for r in rows]})

            if path == '/api/session':
                admin = session_admin(con, self.cookie_token())
                return self.send_json({
                    'signedIn': bool(admin),
                    'username': admin['username'] if admin else None,
                })
        return self.send_json({'error': 'not found'}, 404)

    def api_post(self, path):
        body = self.read_json()
        if body is None:
            return self.send_json({'error': 'bad request'}, 400)

        # ---- login ----
        if path == '/api/login':
            ip = self.client_ip()
            with _db_lock, connect() as con:
                if is_locked_out(con, ip):
                    return self.send_json(
                        {'error': 'Too many failed attempts. Try again in 15 minutes.'}, 429)

                row = con.execute('SELECT * FROM admin WHERE username=?',
                                  (str(body.get('username', '')).strip(),)).fetchone()
                ok = bool(row) and verify_password(row, str(body.get('password', '')))
                if not ok:
                    # Spend the same work even when the user does not exist, so
                    # response time does not reveal which usernames are valid.
                    if not row:
                        hash_password(str(body.get('password', '')) or 'x')
                    record_failure(con, ip)
                    return self.send_json({'error': 'Incorrect username or password.'}, 401)

                clear_failures(con, ip)
                token = new_session(con, row['id'])
                cookie = ('%s=%s; Path=/; HttpOnly; SameSite=Strict; Max-Age=%d'
                          % (SESSION_COOKIE, token, SESSION_HOURS * 3600))
                return self.send_json(
                    {'ok': True, 'username': row['username'],
                     'mustChange': bool(row['must_change'])}, cookie=cookie)

        # ---- logout ----
        if path == '/api/logout':
            token = self.cookie_token()
            with _db_lock, connect() as con:
                con.execute('DELETE FROM session WHERE token=?', (token,))
            expired = ('%s=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' % SESSION_COOKIE)
            return self.send_json({'ok': True}, cookie=expired)

        # everything past this point needs a session
        with _db_lock, connect() as con:
            admin = session_admin(con, self.cookie_token())
            if not admin:
                return self.send_json({'error': 'not signed in'}, 401)

            # ---- change password ----
            if path == '/api/password':
                current = str(body.get('current', ''))
                new = str(body.get('new', ''))

                if not verify_password(admin, current):
                    record_failure(con, self.client_ip())
                    return self.send_json({'error': 'Current password is incorrect.'}, 403)
                if new == current:
                    return self.send_json({'error': 'New password must be different.'}, 400)

                problems = password_problems(new, admin['username'])
                if problems:
                    return self.send_json(
                        {'error': 'Password ' + '; '.join(problems) + '.'}, 400)

                store_password(con, admin['username'], new)
                # every other session for this admin is now invalid
                con.execute('DELETE FROM session WHERE admin_id=? AND token<>?',
                            (admin['id'], self.cookie_token()))
                return self.send_json({'ok': True})

            # ---- create / update a form link ----
            if path == '/api/forms':
                title = str(body.get('title', '')).strip()
                if not title:
                    return self.send_json({'error': 'Give the link a title.'}, 400)

                raw = str(body.get('url', '')).strip()
                url = clean_url(raw)
                if raw and not url:
                    return self.send_json(
                        {'error': 'That does not look like a valid web address.'}, 400)

                status = 'open' if body.get('status') == 'open' else 'closed'
                if status == 'open' and not url:
                    return self.send_json(
                        {'error': 'Add the form URL before marking this one open.'}, 400)

                fid = str(body.get('id') or '').strip() or ('f-' + secrets.token_hex(4))
                existing = con.execute('SELECT sort_order FROM forms WHERE id=?',
                                       (fid,)).fetchone()
                order = existing['sort_order'] if existing else (
                    con.execute('SELECT COALESCE(MAX(sort_order),-1)+1 n FROM forms')
                       .fetchone()['n'])

                con.execute(
                    'INSERT INTO forms (id,title,event,description,url,deadline,status,sort_order)'
                    ' VALUES (?,?,?,?,?,?,?,?)'
                    ' ON CONFLICT(id) DO UPDATE SET title=excluded.title,event=excluded.event,'
                    ' description=excluded.description,url=excluded.url,deadline=excluded.deadline,'
                    " status=excluded.status,updated_at=datetime('now')",
                    (fid, title, str(body.get('event', ''))[:120],
                     str(body.get('description', ''))[:1000], url,
                     str(body.get('deadline', ''))[:10], status, order))
                return self.send_json({'ok': True, 'id': fid})

            # ---- reorder ----
            if path == '/api/forms/order':
                ids = body.get('ids')
                if not isinstance(ids, list):
                    return self.send_json({'error': 'bad request'}, 400)
                for i, fid in enumerate(ids):
                    con.execute('UPDATE forms SET sort_order=? WHERE id=?', (i, str(fid)))
                return self.send_json({'ok': True})

        return self.send_json({'error': 'not found'}, 404)

    # -- static -------------------------------------------------------------
    def serve_static(self, path):
        if path in ('', '/'):
            path = '/index.html'

        # Resolve inside ROOT only — blocks ../ traversal.
        target = os.path.realpath(os.path.join(ROOT, path.lstrip('/')))
        if not target.startswith(os.path.realpath(ROOT) + os.sep) and target != os.path.realpath(ROOT):
            return self.send_json({'error': 'forbidden'}, 403)

        # The database and the first-run password file are never web-readable.
        base = os.path.basename(target).lower()
        if base.startswith('cyzera.db') or base == 'first_run_password.txt' or base == 'server.py':
            return self.send_json({'error': 'forbidden'}, 403)

        if not os.path.isfile(target):
            return self.send_json({'error': 'not found'}, 404)

        ctype, _ = mimetypes.guess_type(target)
        try:
            with open(target, 'rb') as fh:
                data = fh.read()
        except OSError:
            return self.send_json({'error': 'not found'}, 404)

        self.send_response(200)
        self.send_header('Content-Type', ctype or 'application/octet-stream')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'same-origin')
        # HTML/CSS/JS must revalidate, or a browser keeps running the previous
        # build after a deploy — which looks exactly like a broken site.
        if target.lower().endswith(('.html', '.css', '.js')):
            self.send_header('Cache-Control', 'no-cache, must-revalidate')
        else:
            self.send_header('Cache-Control', 'public, max-age=86400')
        self.end_headers()
        if not getattr(self, '_head_only', False):
            self.wfile.write(data)

    def log_message(self, fmt, *args):
        sys.stderr.write('%s  %s\n' % (self.client_ip(), fmt % args))


def main():
    ap = argparse.ArgumentParser(description='CYZERA site + admin API')
    ap.add_argument('--host', default='0.0.0.0',
                    help='bind address (default 0.0.0.0 = reachable on the LAN)')
    ap.add_argument('--port', type=int, default=8787)
    ap.add_argument('--reset-password', metavar='USERNAME', default=None,
                    help='set a new random password for an admin and print it')
    args = ap.parse_args()

    init_db()

    if args.reset_password:
        with _db_lock, connect() as con:
            row = con.execute('SELECT id FROM admin WHERE username=?',
                              (args.reset_password,)).fetchone()
            if not row:
                print('No such admin: %s' % args.reset_password)
                return 1
            pw = generate_password()
            store_password(con, args.reset_password, pw)
            con.execute('DELETE FROM session WHERE admin_id=?', (row['id'],))
        print('New password for %s:\n\n    %s\n' % (args.reset_password, pw))
        return 0

    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    where = 'localhost' if args.host in ('127.0.0.1', 'localhost') else args.host
    print('CYZERA running on http://%s:%d   (database: %s)'
          % (where, args.port, os.path.basename(DB_PATH)), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\nstopped')
    return 0


if __name__ == '__main__':
    sys.exit(main())
