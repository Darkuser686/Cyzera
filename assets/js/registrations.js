/* =====================================================================
   CYZERA — event registrations (Supabase mode)

   Everything that talks to the database lives here, so app.js only has to
   ask two questions: is this mode on, and can you render this route.

     public   event cards → event page (poster, details, slots) → built-in
              form rendered from the event's field list → one row in
              `registrations`
     admin    sign in with Supabase → build events and their forms, like a
              Google Form → see who registered → export to Excel

   The page never decides who may do what. Postgres does, through the
   policies in supabase/schema.sql. This file just asks politely.
   ===================================================================== */
(function () {
  'use strict';

  var SB = window.CYZERA_SUPABASE || {};
  var ENABLED = !!(SB.url && SB.anonKey);

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(msg) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-up');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('is-up'); }, 2800);
  }

  function alertInto(host, kind, msg) {
    if (!host) return;
    host.innerHTML = msg ? '<div class="alert alert--' + kind + '">' + esc(msg) + '</div>' : '';
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function fmtWhen(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function slug(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'event';
  }

  /* ---------------------------------------------------------------
     The three questions every form asks. Locked in the builder.
  --------------------------------------------------------------- */
  var SEMESTERS = ['1', '2', '3', '4', '5', '6', '7', '8'];
  /* Default branches, used offline and until the live list loads. Once an
     admin edits branches they live in the database (see db.branches); this
     array is kept in sync so every dropdown reflects the current set. */
  var BRANCHES = ['CSE', 'AI & ML', 'Cyber Security', 'Mechanical', 'Electrical', 'Bio Medical'];

  function fixedFields() {
    return [
      { key: 'full_name', label: 'Full name', type: 'text', required: true, fixed: true },
      { key: 'semester', label: 'Semester', type: 'select', required: true, fixed: true, options: SEMESTERS },
      { key: 'branch', label: 'Branch', type: 'select', required: true, fixed: true, options: BRANCHES.slice() }
    ];
  }
  var FIXED_FIELDS = fixedFields();

  var FIELD_TYPES = [
    ['text', 'Short answer'],
    ['textarea', 'Paragraph'],
    ['email', 'Email'],
    ['tel', 'Phone number'],
    ['number', 'Number'],
    ['select', 'Dropdown'],
    ['radio', 'Multiple choice (pick one)'],
    ['checkbox', 'Checkboxes (pick many)']
  ];

  var HAS_OPTIONS = { select: 1, radio: 1, checkbox: 1 };

  function cleanFields(list) {
    var seen = {};
    FIXED_FIELDS.forEach(function (f) { seen[f.key] = 1; });
    return (Array.isArray(list) ? list : []).map(function (f) {
      var type = FIELD_TYPES.some(function (t) { return t[0] === f.type; }) ? f.type : 'text';
      var out = {
        key: String(f.key || slug(f.label)).replace(/[^a-z0-9_]/g, '_').slice(0, 40) || 'field',
        label: String(f.label || 'Question').slice(0, 120),
        type: type,
        required: !!f.required
      };
      if (HAS_OPTIONS[type]) {
        out.options = (Array.isArray(f.options) ? f.options : String(f.options || '').split('\n'))
          .map(function (o) { return String(o).trim(); })
          .filter(Boolean)
          .slice(0, 60);
      }
      return out;
    }).filter(function (f) {
      if (seen[f.key]) return false;   // never let a custom field shadow a fixed one
      seen[f.key] = 1;
      return true;
    });
  }

  /* ---------------------------------------------------------------
     Supabase client — GoTrue for auth, PostgREST for data, by fetch.
  --------------------------------------------------------------- */
  var BASE = String(SB.url || '').replace(/\/+$/, '');
  var KEY = SB.anonKey || '';
  var STORE_KEY = 'cyzera.sb.session.v2';

  var sess = (function () {
    try { return JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null'); } catch (e) { return null; }
  })();

  function remember(s) {
    sess = s;
    try {
      if (s) sessionStorage.setItem(STORE_KEY, JSON.stringify(s));
      else sessionStorage.removeItem(STORE_KEY);
    } catch (e) { /* private mode */ }
  }

  function storeSession(d) {
    return {
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      email: (d.user && d.user.email) || (sess && sess.email) || '',
      expires_at: Date.now() + (Number(d.expires_in) || 3600) * 1000
    };
  }

  function httpError(data, res) {
    var msg = data && (data.error_description || data.msg || data.message || data.error || data.details);
    if (typeof msg !== 'string' || !msg) msg = 'Request failed (' + res.status + ')';
    /* PostgREST wraps a trigger's RAISE EXCEPTION text in `message`; pass it
       straight through — those are the sentences we wrote for the visitor. */
    return new Error(msg);
  }

  function netError(err) {
    if (err && err.name === 'TypeError') {
      return new Error('Could not reach the database. Check your connection and the URL in assets/js/supabase-config.js.');
    }
    return err;
  }

  function parse(res) {
    if (res.status === 204) return Promise.resolve(null);
    return res.text().then(function (t) {
      var data = null;
      if (t) { try { data = JSON.parse(t); } catch (e) { data = { message: t }; } }
      if (!res.ok) throw httpError(data, res);
      return data;
    });
  }

  function refreshToken() {
    if (!sess || !sess.refresh_token) return Promise.resolve(false);
    return fetch(BASE + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: sess.refresh_token })
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.access_token) { remember(null); return false; }
        remember(storeSession(d));
        return true;
      }).catch(function () { remember(null); return false; });
  }

  function call(path, opts, retried) {
    opts = opts || {};
    var h = {
      apikey: KEY,
      Authorization: 'Bearer ' + (sess && sess.access_token ? sess.access_token : KEY),
      'Content-Type': 'application/json'
    };
    var extra = opts.headers || {};
    for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) h[k] = extra[k];

    return fetch(BASE + path, { method: opts.method || 'GET', headers: h, body: opts.body })
      .catch(function (e) { throw netError(e); })
      .then(function (res) {
        if (res.status === 401 && !retried && sess && sess.refresh_token) {
          return refreshToken().then(function (ok) {
            if (!ok) return parse(res);
            return call(path, { method: opts.method, body: opts.body, headers: extra }, true);
          });
        }
        return parse(res);
      });
  }

  var db = {
    events: function () {
      return call('/rest/v1/events?select=*&order=sort_order.asc,id.asc').then(function (r) { return r || []; });
    },
    event: function (id) {
      return call('/rest/v1/events?id=eq.' + encodeURIComponent(id) + '&select=*&limit=1')
        .then(function (r) { return (r && r[0]) || null; });
    },
    counts: function () {
      return call('/rest/v1/rpc/event_counts', { method: 'POST', body: '{}' }).then(function (rows) {
        var m = {};
        (rows || []).forEach(function (r) { m[r.event_id] = Number(r.registered) || 0; });
        return m;
      });
    },
    saveEvent: function (ev) {
      return call('/rest/v1/events', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify([ev])
      });
    },
    deleteEvent: function (id) {
      return call('/rest/v1/events?id=eq.' + encodeURIComponent(id), { method: 'DELETE' });
    },
    register: function (row) {
      return call('/rest/v1/registrations', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify([row])
      });
    },
    registrations: function (eventId) {
      /* Everything except payment_proof — that data URL can be hundreds of KB
         per row, so it is fetched one at a time only when an admin opens it. */
      var cols = 'id,event_id,full_name,semester,branch,email,phone,txn_id,data,created_at';
      var q = '/rest/v1/registrations?select=' + cols + '&order=created_at.asc';
      if (eventId) q += '&event_id=eq.' + encodeURIComponent(eventId);
      return call(q).then(function (r) { return r || []; });
    },
    proof: function (id) {
      return call('/rest/v1/registrations?id=eq.' + encodeURIComponent(id) + '&select=payment_proof&limit=1')
        .then(function (r) { return (r && r[0] && r[0].payment_proof) || ''; });
    },
    deleteRegistration: function (id) {
      return call('/rest/v1/registrations?id=eq.' + encodeURIComponent(id), { method: 'DELETE' });
    },
    isAdmin: function () {
      return call('/rest/v1/admins?select=user_id&limit=1').then(function (r) { return !!(r && r.length); });
    },
    branches: function () {
      return call('/rest/v1/branches?select=name&order=sort_order.asc,name.asc')
        .then(function (r) { return (r || []).map(function (b) { return b.name; }); });
    },
    addBranch: function (name, order) {
      return call('/rest/v1/branches', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([{ name: name, sort_order: order }])
      });
    },
    deleteBranch: function (name) {
      return call('/rest/v1/branches?name=eq.' + encodeURIComponent(name), { method: 'DELETE' });
    }
  };

  /* Pull the live branch list into BRANCHES so every dropdown is current.
     Falls back silently to the defaults if the call fails. */
  function refreshBranches() {
    return db.branches().then(function (list) {
      if (list && list.length) { BRANCHES.length = 0; list.forEach(function (b) { BRANCHES.push(b); }); }
      return BRANCHES;
    }).catch(function () { return BRANCHES; });
  }

  var auth = {
    session: function () { return sess ? { name: sess.email } : null; },

    login: function (email, pass) {
      return fetch(BASE + '/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: { apikey: KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: String(email).trim(), password: pass })
      }).catch(function (e) { throw netError(e); })
        .then(parse)
        .then(function (d) {
          if (!d || !d.access_token) throw new Error('Incorrect email or password.');
          remember(storeSession(d));
          return db.isAdmin().then(function (ok) {
            if (!ok) {
              remember(null);
              throw new Error('That account signed in, but it is not a CYZERA admin.');
            }
            return auth.session();
          });
        })
        .catch(function (err) {
          if (/invalid login|invalid_grant|invalid credentials/i.test(err.message || '')) {
            throw new Error('Incorrect email or password.');
          }
          throw err;
        });
    },

    logout: function () {
      var had = sess;
      remember(null);
      if (!had) return Promise.resolve();
      return fetch(BASE + '/auth/v1/logout', {
        method: 'POST',
        headers: { apikey: KEY, Authorization: 'Bearer ' + had.access_token }
      }).catch(function () {}).then(function () {});
    },

    refresh: function () {
      if (!sess) return Promise.resolve(null);
      var stale = sess.expires_at && Date.now() > sess.expires_at - 60000;
      return (stale ? refreshToken() : Promise.resolve(true)).then(function (ok) {
        if (!ok) return null;
        return db.isAdmin().then(function (is) {
          if (!is) { remember(null); return null; }
          return auth.session();
        });
      }).catch(function () { remember(null); return null; });
    },

    changePassword: function (cur, next) {
      if (!sess) return Promise.reject(new Error('Not signed in.'));
      var email = sess.email;
      return fetch(BASE + '/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: { apikey: KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: cur })
      }).catch(function (e) { throw netError(e); })
        .then(function (r) {
          if (!r.ok) throw new Error('Current password is incorrect.');
          return r.json();
        }).then(function (d) {
          remember(storeSession(d));
          return call('/auth/v1/user', { method: 'PUT', body: JSON.stringify({ password: next }) });
        });
    }
  };

  /* ---------------------------------------------------------------
     Images — resized on a canvas, re-encoded as JPEG. A phone photo of
     several MB becomes a card image of a few hundred KB.
  --------------------------------------------------------------- */
  function readImageFile(file, maxW) {
    return new Promise(function (resolve, reject) {
      if (!file) { resolve(''); return; }
      if (!/^image\/(png|jpe?g)$/i.test(file.type)) {
        reject(new Error('Please upload a PNG or JPG image. (An iPhone photo may be HEIC — take a screenshot instead, or pick a JPG.)'));
        return;
      }
      if (file.size > 8 * 1024 * 1024) { reject(new Error('That image is larger than 8 MB — pick a smaller one.')); return; }
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Could not read that file.')); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('Could not read that image.')); };
        img.onload = function () {
          var scale = Math.min(1, (maxW || 1000) / img.naturalWidth);
          var w = Math.max(1, Math.round(img.naturalWidth * scale));
          var h = Math.max(1, Math.round(img.naturalHeight * scale));
          var c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          try { resolve(c.toDataURL('image/jpeg', 0.78)); }
          catch (e) { reject(new Error('Could not process that image.')); }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ---------------------------------------------------------------
     Best-effort OCR of a payment screenshot. Loads Tesseract.js only when
     someone actually taps the button. Returns the longest run of digits it
     finds (a UPI UTR is 12 digits), which the payer then confirms. This is a
     convenience, never the record — the typed transaction id is.
  --------------------------------------------------------------- */
  var tesseract = null;
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (tesseract) return tesseract;
    tesseract = new Promise(function (resolve, reject) {
      var el = document.createElement('script');
      el.src = 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.0/tesseract.min.js';
      el.onload = function () { window.Tesseract ? resolve(window.Tesseract) : reject(new Error('no Tesseract')); };
      el.onerror = function () { tesseract = null; reject(new Error('load failed')); };
      document.head.appendChild(el);
    });
    return tesseract;
  }

  function ocrTransactionId(dataUrl) {
    return loadTesseract().then(function (T) {
      return T.recognize(dataUrl, 'eng').then(function (res) {
        var text = (res && res.data && res.data.text) || '';
        var runs = text.replace(/[^0-9]+/g, ' ').split(' ').filter(function (x) { return x.length >= 10; });
        runs.sort(function (a, b) { return b.length - a.length; });
        return runs[0] || '';
      });
    });
  }

  /* ---------------------------------------------------------------
     Rendering a form from its field list — used by the public page and
     by the builder's live preview alike, so the two never drift.
  --------------------------------------------------------------- */
  function allFields(ev) {
    return fixedFields().concat(cleanFields(ev.fields));
  }

  function fieldHtml(f, idx) {
    var id = 'q_' + f.key;
    var req = f.required ? ' required' : '';
    var label = '<span class="field__label">' + esc(f.label) + (f.required ? ' <i class="req" aria-hidden="true">*</i>' : '') + '</span>';
    var inner;

    if (f.type === 'textarea') {
      inner = '<textarea class="textarea" id="' + id + '" name="' + esc(f.key) + '"' + req + '></textarea>';
    } else if (f.type === 'select') {
      inner = '<select class="select" id="' + id + '" name="' + esc(f.key) + '"' + req + '>' +
        '<option value="">Choose…</option>' +
        (f.options || []).map(function (o) { return '<option value="' + esc(o) + '">' + esc(o) + '</option>'; }).join('') +
        '</select>';
    } else if (f.type === 'radio' || f.type === 'checkbox') {
      inner = '<div class="choices" role="group" aria-labelledby="' + id + '_l">' +
        (f.options || []).map(function (o, i) {
          return '<label class="choice">' +
            '<input type="' + f.type + '" name="' + esc(f.key) + '" value="' + esc(o) + '"' +
              (f.type === 'radio' && f.required ? ' required' : '') + '>' +
            '<span>' + esc(o) + '</span></label>';
        }).join('') + '</div>';
      return '<div class="field" data-key="' + esc(f.key) + '" data-required="' + (f.required ? 1 : 0) + '">' +
        '<span class="field__label" id="' + id + '_l">' + esc(f.label) + (f.required ? ' <i class="req" aria-hidden="true">*</i>' : '') + '</span>' +
        inner + '</div>';
    } else {
      var type = f.type === 'number' ? 'number' : f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : 'text';
      inner = '<input class="input" id="' + id + '" name="' + esc(f.key) + '" type="' + type + '"' +
        (type === 'tel' ? ' inputmode="tel" pattern="[0-9+ ]{7,15}"' : '') + req + '>';
    }
    return '<label class="field" data-key="' + esc(f.key) + '">' + label + inner + '</label>';
  }

  function readForm(formEl, fields) {
    var answers = {};
    var problems = [];
    fields.forEach(function (f) {
      var val;
      if (f.type === 'checkbox') {
        val = $$('input[name="' + f.key + '"]:checked', formEl).map(function (i) { return i.value; });
        if (f.required && !val.length) problems.push(f.label + ' — pick at least one.');
      } else if (f.type === 'radio') {
        var r = $('input[name="' + f.key + '"]:checked', formEl);
        val = r ? r.value : '';
        if (f.required && !val) problems.push(f.label + ' — pick one.');
      } else {
        var el = formEl.querySelector('[name="' + f.key + '"]');
        val = el ? String(el.value).trim() : '';
        if (f.required && !val) problems.push(f.label + ' is required.');
        if (val && f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) problems.push(f.label + ' does not look like an email address.');
        if (val && f.type === 'tel' && !/^[0-9+ ]{7,15}$/.test(val)) problems.push(f.label + ' should be 7–15 digits.');
      }
      answers[f.key] = val;
    });
    return { answers: answers, problems: problems };
  }

  /* ---------------------------------------------------------------
     PUBLIC — event cards
  --------------------------------------------------------------- */
  var eventsCache = null;

  function statusChip(ev, counts) {
    if (ev.status !== 'open') return '<span class="chip">Closed</span>';
    if (ev.slots != null) {
      var left = ev.slots - (counts[ev.id] || 0);
      if (left <= 0) return '<span class="chip chip--full">No slots left</span>';
      return '<span class="chip chip--live"><i class="dot"></i> ' + left + ' slot' + (left === 1 ? '' : 's') + ' left</span>';
    }
    return '<span class="chip chip--live"><i class="dot"></i> Open now</span>';
  }

  function renderPublicEvents() {
    var host = $('#publicForms');
    if (!host) return Promise.resolve();
    host.innerHTML = '<div class="empty"><p>Loading events…</p></div>';

    return Promise.all([db.events(), db.counts()]).then(function (r) {
      var events = r[0].filter(function (e) { return e.status !== 'draft'; });
      var counts = r[1];
      eventsCache = events;

      if (!events.length) {
        host.innerHTML =
          '<div class="empty"><div class="empty__icon">◎</div>' +
          '<p><b>No registrations published yet.</b></p>' +
          '<p style="margin-top:.4rem">Events appear here the moment the CYZERA team opens them. Check back before the next fest.</p></div>';
        return;
      }

      host.className = 'eventgrid';
      host.innerHTML = events.map(function (ev, i) {
        var poster = ev.poster
          ? '<img class="eventcard__poster" src="' + esc(ev.poster) + '" alt="' + esc(ev.title) + ' poster" loading="lazy">'
          : '<div class="eventcard__poster eventcard__poster--empty"><span>' + esc(ev.title.slice(0, 1)) + '</span></div>';
        var when = [ev.event_date ? fmtDate(ev.event_date) : '', ev.event_time].filter(Boolean).join(' · ');
        return '' +
          '<a class="eventcard reveal' + (ev.status !== 'open' ? ' is-closed' : '') + '" href="#/register/' + esc(ev.id) + '" style="--delay:' + (i * 60) + 'ms">' +
            poster +
            '<div class="eventcard__body">' +
              '<div class="formcard__meta">' +
                (ev.department ? '<span class="chip chip--blue">' + esc(ev.department) + '</span>' : '') +
                '<span class="chip">' + esc(ev.category) + '</span>' +
                statusChip(ev, counts) +
              '</div>' +
              '<h3 class="eventcard__title">' + esc(ev.title) + '</h3>' +
              (when ? '<p class="eventcard__when">' + esc(when) + '</p>' : '') +
              (ev.description ? '<p class="formcard__desc">' + esc(ev.description) + '</p>' : '') +
              '<span class="eventcard__cta">View &amp; register →</span>' +
            '</div>' +
          '</a>';
      }).join('');
      if (window.CYZERA_ARM_REVEALS) window.CYZERA_ARM_REVEALS();
    }).catch(function (err) {
      host.innerHTML = '<div class="empty"><div class="empty__icon">◎</div><p><b>Could not load events.</b></p><p style="margin-top:.4rem">' + esc(err.message) + '</p></div>';
    });
  }

  /* ---------------------------------------------------------------
     PUBLIC — one event, with its registration form
  --------------------------------------------------------------- */
  function renderEventDetail(id) {
    var host = $('#eventDetail');
    if (!host) return Promise.resolve();
    host.innerHTML = '<div class="empty"><p>Loading…</p></div>';

    return Promise.all([db.event(id), db.counts(), refreshBranches()]).then(function (r) {
      var ev = r[0];
      var counts = r[1];
      if (!ev || ev.status === 'draft') {
        host.innerHTML = '<div class="empty"><div class="empty__icon">◎</div><p><b>That event does not exist.</b></p>' +
          '<p style="margin-top:.6rem"><a class="btn" href="#/register"><span>← All events</span></a></p></div>';
        return;
      }

      var taken = counts[ev.id] || 0;
      var left = ev.slots != null ? Math.max(0, ev.slots - taken) : null;
      var canRegister = ev.status === 'open' && (left === null || left > 0);
      var when = [ev.event_date ? fmtDate(ev.event_date) : '', ev.event_time].filter(Boolean).join(' · ');

      var details = [
        ['Date', ev.event_date ? fmtDate(ev.event_date) : ''],
        ['Time', ev.event_time],
        ['Venue', ev.venue],
        ['Department', ev.department],
        ['Fee', ev.fee],
        ['Team size', ev.team_size],
        ['Slots', ev.slots == null ? 'Unlimited' : (left + ' of ' + ev.slots + ' left')]
      ].filter(function (d) { return d[1]; });

      var rules = String(ev.rules || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean);

      var formHtml;
      if (!canRegister) {
        formHtml = '<div class="alert alert--info">' + (ev.status !== 'open' ? 'Registrations for this event are closed.' : 'No slots left for this event.') + '</div>';
      } else if (ev.external_url) {
        formHtml = '<a class="btn btn--primary" href="' + esc(ev.external_url) + '" target="_blank" rel="noopener noreferrer"><span>Register ↗</span></a>' +
          '<p class="hint">Opens the registration form in a new tab.</p>';
      } else {
        var fields = allFields(ev);
        var payBlock = '';
        if (ev.payment_required) {
          payBlock =
            '<div class="paybox">' +
              (ev.payment_qr
                ? '<button type="button" class="paybox__qr" data-poster-src="' + esc(ev.payment_qr) + '"><img src="' + esc(ev.payment_qr) + '" alt="Payment QR code"></button>'
                : '') +
              '<div class="paybox__body">' +
                '<b>Payment required' + (ev.fee ? ' — ' + esc(ev.fee) : '') + '</b>' +
                (ev.payment_note ? '<p>' + esc(ev.payment_note) + '</p>' : '<p>Scan the code to pay, then enter your transaction id and upload the screenshot below.</p>') +
              '</div>' +
            '</div>' +
            '<label class="field"><span class="field__label">Transaction / UTR id <i class="req" aria-hidden="true">*</i></span>' +
              '<input class="input" id="qTxn" name="txn_id" required placeholder="e.g. 4521 8890 1234">' +
              '<span class="hint" style="margin-top:.35rem;display:block">Copy it from your payment app. This is what goes in our records.</span></label>' +
            '<label class="field"><span class="field__label">Payment screenshot <i class="req" aria-hidden="true">*</i></span>' +
              '<div class="poster-field">' +
                '<div class="poster-preview" id="qProofPreview" hidden><img id="qProofImg" alt="Payment screenshot preview"><button class="poster-preview__remove" type="button" id="qProofRemove" aria-label="Remove">&times;</button></div>' +
                '<label class="poster-drop" id="qProofDrop"><input type="file" id="qProof" accept="image/png,image/jpeg" hidden><span class="poster-drop__icon" aria-hidden="true">&#8593;</span><span class="poster-drop__text">Upload your payment screenshot<br><small>JPG or PNG</small></span></label>' +
                '<button class="btn btn--sm" type="button" id="qOcr" hidden style="margin-top:.6rem"><span>Auto-read transaction id from screenshot</span></button>' +
                '<div id="qProofAlert"></div>' +
              '</div></label>';
        }
        formHtml =
          '<form class="regform" id="regForm" autocomplete="on" novalidate>' +
            '<div id="regAlert"></div>' +
            fields.map(fieldHtml).join('') +
            payBlock +
            '<button class="btn btn--primary" type="submit" id="regSubmit" style="width:100%"><span>Register</span></button>' +
            '<p class="hint">Your details go straight to the CYZERA team and nowhere else.</p>' +
          '</form>';
      }

      host.innerHTML =
        '<a class="backlink" href="#/register">← All events</a>' +
        '<div class="eventpage">' +
          '<div class="eventpage__main">' +
            '<div class="formcard__meta">' +
              (ev.department ? '<span class="chip chip--blue">' + esc(ev.department) + '</span>' : '') +
              '<span class="chip">' + esc(ev.category) + '</span>' +
              statusChip(ev, counts) +
            '</div>' +
            '<h1 class="eventpage__title">' + esc(ev.title) + '</h1>' +
            (when ? '<p class="eventcard__when">' + esc(when) + '</p>' : '') +
            (ev.description ? '<p class="eventpage__desc">' + esc(ev.description).replace(/\n/g, '<br>') + '</p>' : '') +
            (rules.length ? '<h2 class="eventpage__h2">Rules &amp; regulations</h2><ol class="rules">' + rules.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ol>' : '') +
          '</div>' +
          '<aside class="eventpage__side">' +
            (details.length ? '<dl class="details">' + details.map(function (d) { return '<div><dt>' + esc(d[0]) + '</dt><dd>' + esc(d[1]) + '</dd></div>'; }).join('') + '</dl>' : '') +
            '<div class="panel" id="regPanel"><h2 class="eventpage__h2" style="margin-top:0">Register</h2>' + formHtml + '</div>' +
          '</aside>' +
        '</div>';

      var form = $('#regForm');
      if (!form) return;

      var proofData = '';
      if (ev.payment_required) {
        $('#qProof').addEventListener('change', function () {
          var file = this.files && this.files[0];
          this.value = '';
          if (!file) return;
          alertInto($('#qProofAlert'), 'info', 'Reading image…');
          readImageFile(file, 1100).then(function (d) {
            proofData = d;
            $('#qProofImg').src = d;
            $('#qProofPreview').hidden = false;
            $('#qProofDrop').hidden = true;
            $('#qOcr').hidden = false;
            alertInto($('#qProofAlert'), 'info', '');
          }).catch(function (err) { alertInto($('#qProofAlert'), 'err', err.message); });
        });
        $('#qProofRemove').addEventListener('click', function () {
          proofData = '';
          $('#qProofImg').src = '';
          $('#qProofPreview').hidden = true;
          $('#qProofDrop').hidden = false;
          $('#qOcr').hidden = true;
        });
        $('#qOcr').addEventListener('click', function () {
          if (!proofData) return;
          var b = this; b.disabled = true; b.querySelector('span').textContent = 'Reading… (may take a moment)';
          ocrTransactionId(proofData).then(function (guess) {
            if (guess) {
              $('#qTxn').value = guess;
              alertInto($('#qProofAlert'), 'ok', 'Read a transaction id — please check it matches your screenshot.');
            } else {
              alertInto($('#qProofAlert'), 'err', 'Could not read an id. Please type it in yourself.');
            }
          }).catch(function () {
            alertInto($('#qProofAlert'), 'err', 'Auto-read is unavailable. Please type the id in.');
          }).then(function () { b.disabled = false; b.querySelector('span').textContent = 'Auto-read transaction id from screenshot'; });
        });
      }

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var res = readForm(form, allFields(ev));
        if (res.problems.length) {
          alertInto($('#regAlert'), 'err', res.problems[0]);
          return;
        }
        var txn = '', proof = '';
        if (ev.payment_required) {
          txn = $('#qTxn').value.trim();
          proof = proofData;
          if (!txn) { alertInto($('#regAlert'), 'err', 'Enter your payment transaction id.'); return; }
          if (!proof) { alertInto($('#regAlert'), 'err', 'Upload your payment screenshot.'); return; }
        }
        var a = res.answers;
        var row = {
          event_id: ev.id,
          full_name: a.full_name,
          semester: a.semester,
          branch: a.branch,
          email: a.email || null,
          phone: a.phone || null,
          txn_id: txn || null,
          payment_proof: proof || null,
          data: a
        };
        var btn = $('#regSubmit');
        btn.disabled = true;
        alertInto($('#regAlert'), 'info', 'Sending…');
        db.register(row).then(function () {
          $('#regPanel').innerHTML =
            '<div class="regdone">' +
              '<div class="regdone__mark">✓</div>' +
              '<h2 class="eventpage__h2" style="margin-top:.4rem">You are registered</h2>' +
              '<p>Thanks, <b>' + esc(a.full_name) + '</b>. The CYZERA team has your entry for <b>' + esc(ev.title) + '</b>.</p>' +
              '<p class="hint">Keep an eye on your phone' + (a.email ? ' and email' : '') + ' for updates.</p>' +
            '</div>';
          toast('Registered.');
        }).catch(function (err) {
          var m = err.message || 'Could not register.';
          if (/registrations_no_dupe_phone|duplicate key/i.test(m)) m = 'That phone number is already registered for this event.';
          alertInto($('#regAlert'), 'err', m);
          btn.disabled = false;
        });
      });
    }).catch(function (err) {
      host.innerHTML = '<div class="empty"><div class="empty__icon">◎</div><p><b>Could not load this event.</b></p><p style="margin-top:.4rem">' + esc(err.message) + '</p></div>';
    });
  }

  /* ---------------------------------------------------------------
     ADMIN
  --------------------------------------------------------------- */
  var adminHost = null;
  var adminEvents = [];
  var adminCounts = {};
  var builderFields = [];      // custom fields being edited
  var editingId = '';
  var posterData = '';
  var qrData = '';

  function adminShell() {
    return '' +
      '<div class="admin-bar">' +
        '<span class="admin-bar__who">Signed in as <b id="sbWho"></b> · every change is live for everyone the moment you save</span>' +
        '<span class="admin-bar__actions">' +
          '<a class="btn btn--sm btn--ghost" href="#/register"><span>View public page</span></a>' +
          '<button class="btn btn--sm btn--danger" id="sbLogout"><span>Log out</span></button>' +
        '</span>' +
      '</div>' +
      '<div class="tabs" role="tablist">' +
        '<button class="tab is-active" data-sbtab="events" role="tab">Events &amp; forms</button>' +
        '<button class="tab" data-sbtab="regs" role="tab">Registrations</button>' +
        '<button class="tab" data-sbtab="settings" role="tab">Settings</button>' +
      '</div>' +
      '<div class="tabpane is-active" data-sbpane="events">' +
        '<div class="panel panel--wide" id="sbEditor"></div>' +
        '<div class="admin-list" id="sbEventList"></div>' +
      '</div>' +
      '<div class="tabpane" data-sbpane="regs">' +
        '<div class="panel panel--wide" id="sbRegs"></div>' +
      '</div>' +
      '<div class="tabpane" data-sbpane="settings">' +
        '<div class="panel panel--wide" id="sbSettings"></div>' +
      '</div>';
  }

  function loginHtml() {
    return '' +
      '<div class="section__head reveal" style="text-align:center;margin-inline:auto">' +
        '<span class="eyebrow" style="justify-content:center">Restricted</span>' +
        '<h2 class="section__title">Admin sign-in</h2>' +
      '</div>' +
      '<div class="admin-shell reveal">' +
        '<form class="panel" id="sbLoginForm" autocomplete="on">' +
          '<div id="sbLoginAlert"></div>' +
          '<label class="field"><span class="field__label">Email</span>' +
            '<input class="input" type="email" id="sbEmail" autocomplete="email" required></label>' +
          '<label class="field"><span class="field__label">Password</span>' +
            '<input class="input" type="password" id="sbPass" autocomplete="current-password" required></label>' +
          '<button class="btn btn--primary" type="submit" style="width:100%"><span>Sign in</span></button>' +
          '<p class="hint">CYZERA office bearers only. Sign in with the email your Supabase admin account uses.</p>' +
        '</form>' +
      '</div>';
  }

  function mountAdmin() {
    adminHost = $('#adminSupabase');
    if (!adminHost) return Promise.resolve();
    return auth.refresh().then(function (s) {
      if (!s) {
        adminHost.innerHTML = loginHtml();
        $('#sbLoginForm').addEventListener('submit', function (e) {
          e.preventDefault();
          var btn = e.target.querySelector('button[type=submit]');
          btn.disabled = true;
          alertInto($('#sbLoginAlert'), 'info', 'Signing in…');
          auth.login($('#sbEmail').value, $('#sbPass').value).then(function () {
            toast('Signed in.');
            mountAdmin();
          }).catch(function (err) {
            alertInto($('#sbLoginAlert'), 'err', err.message);
            $('#sbPass').value = '';
            btn.disabled = false;
          });
        });
        if (window.CYZERA_ARM_REVEALS) window.CYZERA_ARM_REVEALS();
        return;
      }

      adminHost.innerHTML = adminShell();
      $('#sbWho').textContent = s.name;
      $('#sbLogout').addEventListener('click', function () {
        auth.logout().then(function () { toast('Logged out.'); mountAdmin(); });
      });
      $$('[data-sbtab]').forEach(function (tab) {
        tab.addEventListener('click', function () {
          $$('[data-sbtab]').forEach(function (t) { t.classList.toggle('is-active', t === tab); });
          $$('[data-sbpane]').forEach(function (p) { p.classList.toggle('is-active', p.dataset.sbpane === tab.dataset.sbtab); });
          if (tab.dataset.sbtab === 'regs') renderRegs();
        });
      });
      renderSettings();
      refreshBranches();
      return loadAdminEvents();
    });
  }

  function loadAdminEvents() {
    return Promise.all([db.events(), db.counts()]).then(function (r) {
      adminEvents = r[0];
      adminCounts = r[1];
      renderEventList();
      if (!editingId) renderEditor(null);
    }).catch(function (err) { toast(err.message); });
  }

  /* ---- events list ---- */
  function renderEventList() {
    var host = $('#sbEventList');
    if (!host) return;
    if (!adminEvents.length) {
      host.innerHTML = '<div class="empty"><p>No events yet. Create the first one above.</p></div>';
      return;
    }
    host.innerHTML = adminEvents.map(function (ev, i) {
      var n = adminCounts[ev.id] || 0;
      var chip = ev.status === 'open' ? '<span class="chip chip--live">Open</span>'
               : ev.status === 'closed' ? '<span class="chip">Closed</span>'
               : '<span class="chip chip--draft">Draft</span>';
      return '' +
        '<div class="admin-row" data-id="' + esc(ev.id) + '">' +
          (ev.poster ? '<img class="admin-row__poster" src="' + esc(ev.poster) + '" alt="">' : '<span class="admin-row__poster admin-row__poster--empty">No poster</span>') +
          '<div>' +
            '<div class="formcard__meta">' + chip +
              (ev.department ? '<span class="chip chip--blue">' + esc(ev.department) + '</span>' : '') +
              '<span class="chip">' + n + ' registered' + (ev.slots != null ? ' / ' + ev.slots : '') + '</span>' +
            '</div>' +
            '<div class="admin-row__title">' + esc(ev.title) + '</div>' +
            '<div class="admin-row__url">' + (ev.external_url ? esc(ev.external_url) : (FIXED_FIELDS.length + cleanFields(ev.fields).length) + ' questions · built-in form') + '</div>' +
          '</div>' +
          '<div class="admin-row__actions">' +
            '<button class="btn btn--sm" data-act="up" ' + (i === 0 ? 'disabled' : '') + '><span>↑</span></button>' +
            '<button class="btn btn--sm" data-act="down" ' + (i === adminEvents.length - 1 ? 'disabled' : '') + '><span>↓</span></button>' +
            '<button class="btn btn--sm" data-act="status"><span>' + (ev.status === 'open' ? 'Close' : 'Open') + '</span></button>' +
            '<button class="btn btn--sm" data-act="regs"><span>Registrants</span></button>' +
            '<button class="btn btn--sm" data-act="edit"><span>Edit</span></button>' +
            '<button class="btn btn--sm btn--danger" data-act="del"><span>Delete</span></button>' +
          '</div>' +
        '</div>';
    }).join('');
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('#sbEventList [data-act]');
    if (!btn) return;
    var id = btn.closest('.admin-row').dataset.id;
    var ev = adminEvents.filter(function (x) { return x.id === id; })[0];
    if (!ev) return;
    var act = btn.dataset.act;
    var i = adminEvents.indexOf(ev);

    if (act === 'edit') { renderEditor(ev); return; }
    if (act === 'regs') {
      $$('[data-sbtab]').forEach(function (t) { t.classList.toggle('is-active', t.dataset.sbtab === 'regs'); });
      $$('[data-sbpane]').forEach(function (p) { p.classList.toggle('is-active', p.dataset.sbpane === 'regs'); });
      renderRegs(id);
      return;
    }
    if (act === 'status') {
      var next = ev.status === 'open' ? 'closed' : 'open';
      db.saveEvent(Object.assign({}, ev, { status: next })).then(function () {
        toast(next === 'open' ? 'Event is open for registration.' : 'Event closed.');
        return loadAdminEvents();
      }).catch(function (err) { toast(err.message); });
      return;
    }
    if (act === 'del') {
      var n = adminCounts[id] || 0;
      if (!confirm('Delete "' + ev.title + '"' + (n ? ' and its ' + n + ' registration' + (n === 1 ? '' : 's') : '') + '? This cannot be undone.')) return;
      db.deleteEvent(id).then(function () { toast('Event deleted.'); if (editingId === id) renderEditor(null); return loadAdminEvents(); })
        .catch(function (err) { toast(err.message); });
      return;
    }
    if (act === 'up' || act === 'down') {
      var j = act === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= adminEvents.length) return;
      var a = Object.assign({}, adminEvents[i], { sort_order: j });
      var b = Object.assign({}, adminEvents[j], { sort_order: i });
      Promise.all([db.saveEvent(a), db.saveEvent(b)]).then(loadAdminEvents).catch(function (err) { toast(err.message); });
    }
  });

  /* ---- event editor + form builder ---- */
  function renderEditor(ev) {
    var host = $('#sbEditor');
    if (!host) return;
    editingId = ev ? ev.id : '';
    builderFields = ev ? cleanFields(ev.fields) : [{ key: 'phone', label: 'Phone number', type: 'tel', required: true }];
    posterData = ev ? (ev.poster || '') : '';
    qrData = ev ? (ev.payment_qr || '') : '';

    host.innerHTML = '' +
      '<h3 style="font-size:1.15rem" id="sbEditorHeading">' + (ev ? 'Edit event' : 'Create an event') + '</h3>' +
      '<p class="hint" style="margin-bottom:1.4rem">Every event is its own registration form. Fill in the details, build the questions, then open it.</p>' +
      '<form id="sbEventForm" autocomplete="off">' +
        '<div id="sbEditorAlert"></div>' +
        '<div class="grid grid--2" style="gap:1rem">' +
          '<label class="field" style="margin:0"><span class="field__label">Title</span><input class="input" id="eTitle" required value="' + esc(ev ? ev.title : '') + '"></label>' +
          '<label class="field" style="margin:0"><span class="field__label">Department</span><input class="input" id="eDept" list="deptList" value="' + esc(ev ? ev.department : 'Cyber Security') + '">' +
            '<datalist id="deptList">' + BRANCHES.concat(['General']).map(function (b) { return '<option value="' + esc(b) + '">'; }).join('') + '</datalist></label>' +
        '</div>' +
        '<div class="grid grid--2" style="gap:1rem;margin-top:1rem">' +
          '<label class="field" style="margin:0"><span class="field__label">Category</span><select class="select" id="eCat">' +
            ['Competition', 'Workshop', 'Talk', 'Other'].map(function (c) { return '<option' + (ev && ev.category === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></label>' +
          '<label class="field" style="margin:0"><span class="field__label">Status</span><select class="select" id="eStatus">' +
            '<option value="draft"' + (!ev || ev.status === 'draft' ? ' selected' : '') + '>Draft — hidden from the site</option>' +
            '<option value="open"' + (ev && ev.status === 'open' ? ' selected' : '') + '>Open — accepting registrations</option>' +
            '<option value="closed"' + (ev && ev.status === 'closed' ? ' selected' : '') + '>Closed — listed, not accepting</option>' +
          '</select></label>' +
        '</div>' +
        '<label class="field"><span class="field__label">Description</span><textarea class="textarea" id="eDesc">' + esc(ev ? ev.description : '') + '</textarea></label>' +
        '<label class="field"><span class="field__label">Rules &amp; regulations <span style="text-transform:none;letter-spacing:0">(one per line)</span></span><textarea class="textarea" id="eRules" rows="4">' + esc(ev ? ev.rules : '') + '</textarea></label>' +
        '<div class="grid grid--2" style="gap:1rem">' +
          '<label class="field" style="margin:0"><span class="field__label">Date</span><input class="input" id="eDate" type="date" value="' + esc(ev ? ev.event_date : '') + '"></label>' +
          '<label class="field" style="margin:0"><span class="field__label">Time</span><input class="input" id="eTime" placeholder="10:00 am" value="' + esc(ev ? ev.event_time : '') + '"></label>' +
          '<label class="field" style="margin:0"><span class="field__label">Venue</span><input class="input" id="eVenue" value="' + esc(ev ? ev.venue : '') + '"></label>' +
          '<label class="field" style="margin:0"><span class="field__label">Fee</span><input class="input" id="eFee" placeholder="Free or ₹150" value="' + esc(ev ? ev.fee : '') + '"></label>' +
          '<label class="field" style="margin:0"><span class="field__label">Team size</span><input class="input" id="eTeam" placeholder="Solo, or 3–5" value="' + esc(ev ? ev.team_size : '') + '"></label>' +
          '<label class="field" style="margin:0"><span class="field__label">Slots <span style="text-transform:none;letter-spacing:0">(blank = unlimited)</span></span><input class="input" id="eSlots" type="number" min="1" value="' + (ev && ev.slots != null ? ev.slots : '') + '"></label>' +
        '</div>' +
        '<label class="field"><span class="field__label">Poster</span>' +
          '<div class="poster-field">' +
            '<div class="poster-preview" id="ePosterPreview" ' + (posterData ? '' : 'hidden') + '><img id="ePosterImg" src="' + esc(posterData) + '" alt=""><button class="poster-preview__remove" type="button" id="ePosterRemove" aria-label="Remove poster">&times;</button></div>' +
            '<label class="poster-drop" id="ePosterDrop" ' + (posterData ? 'hidden' : '') + '><input type="file" id="ePoster" accept="image/png,image/jpeg" hidden><span class="poster-drop__icon" aria-hidden="true">&#8593;</span><span class="poster-drop__text">Click to upload a poster<br><small>JPG or PNG, resized automatically</small></span></label>' +
            '<div id="ePosterAlert"></div>' +
          '</div></label>' +
        '<label class="field"><span class="field__label">External form instead <span style="text-transform:none;letter-spacing:0">(optional — a Google Forms link; leave blank to use the built-in form below)</span></span>' +
          '<input class="input" id="eExt" type="text" inputmode="url" spellcheck="false" placeholder="https://forms.gle/…" value="' + esc(ev ? ev.external_url : '') + '"></label>' +

        '<div class="paysection">' +
          '<label class="choice" style="margin-bottom:1rem"><input type="checkbox" id="ePayReq" ' + (ev && ev.payment_required ? 'checked' : '') + '><span>This event needs payment</span></label>' +
          '<div id="ePayFields" ' + (ev && ev.payment_required ? '' : 'hidden') + '>' +
            '<label class="field"><span class="field__label">Payment QR code <span style="text-transform:none;letter-spacing:0">(the image people scan to pay)</span></span>' +
              '<div class="poster-field">' +
                '<div class="poster-preview poster-preview--qr" id="eQrPreview" ' + (qrData ? '' : 'hidden') + '><img id="eQrImg" src="' + esc(qrData) + '" alt=""><button class="poster-preview__remove" type="button" id="eQrRemove" aria-label="Remove QR">&times;</button></div>' +
                '<label class="poster-drop" id="eQrDrop" ' + (qrData ? 'hidden' : '') + '><input type="file" id="eQr" accept="image/png,image/jpeg" hidden><span class="poster-drop__icon" aria-hidden="true">&#8593;</span><span class="poster-drop__text">Click to upload the payment QR<br><small>JPG or PNG</small></span></label>' +
                '<div id="eQrAlert"></div>' +
              '</div></label>' +
            '<label class="field"><span class="field__label">Payment instruction <span style="text-transform:none;letter-spacing:0">(shown under the QR, optional)</span></span>' +
              '<input class="input" id="ePayNote" placeholder="Pay ₹150, then upload the screenshot below." value="' + esc(ev ? (ev.payment_note || '') : '') + '"></label>' +
            '<p class="hint" style="margin-top:.4rem">People registering will see the QR, and must enter their transaction id and upload a payment screenshot. Both appear in the registrants table and the Excel export.</p>' +
          '</div>' +
        '</div>' +

        '<div class="builder" id="builder">' +
          '<div class="builder__head"><h3 style="font-size:1.05rem">Questions on the form</h3><p class="hint" style="margin:0">The first three are asked on every form and cannot be removed.</p></div>' +
          '<div id="builderList"></div>' +
          '<div class="builder__add" id="builderAdd">' +
            '<div class="grid grid--2" style="gap:.75rem">' +
              '<input class="input" id="bLabel" placeholder="Question, e.g. Phone number">' +
              '<select class="select" id="bType">' + FIELD_TYPES.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + '</option>'; }).join('') + '</select>' +
            '</div>' +
            '<textarea class="textarea" id="bOptions" rows="3" placeholder="Options, one per line" hidden style="margin-top:.75rem"></textarea>' +
            '<div style="display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;margin-top:.75rem">' +
              '<label class="choice"><input type="checkbox" id="bReq" checked><span>Required</span></label>' +
              '<button class="btn btn--sm" type="button" id="bAdd"><span>+ Add question</span></button>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div style="display:flex;flex-wrap:wrap;gap:.6rem;margin-top:1.4rem">' +
          '<button class="btn btn--primary" type="submit" id="eSave"><span>' + (ev ? 'Save changes' : 'Create event') + '</span></button>' +
          (ev ? '<button class="btn btn--ghost" type="button" id="eCancel"><span>Cancel</span></button>' : '') +
        '</div>' +
      '</form>';

    renderBuilder();

    $('#bType').addEventListener('change', function () { $('#bOptions').hidden = !HAS_OPTIONS[this.value]; });
    $('#bAdd').addEventListener('click', addBuilderField);
    $('#bLabel').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addBuilderField(); } });

    $('#ePoster').addEventListener('change', function () {
      var file = this.files && this.files[0];
      this.value = '';
      if (!file) return;
      alertInto($('#ePosterAlert'), 'info', 'Reading image…');
      readImageFile(file, 1000).then(function (d) {
        posterData = d;
        $('#ePosterImg').src = d;
        $('#ePosterPreview').hidden = false;
        $('#ePosterDrop').hidden = true;
        alertInto($('#ePosterAlert'), 'ok', '');
      }).catch(function (err) { alertInto($('#ePosterAlert'), 'err', err.message); });
    });
    $('#ePosterRemove').addEventListener('click', function () {
      posterData = '';
      $('#ePosterImg').src = '';
      $('#ePosterPreview').hidden = true;
      $('#ePosterDrop').hidden = false;
    });

    $('#ePayReq').addEventListener('change', function () { $('#ePayFields').hidden = !this.checked; });
    $('#eQr').addEventListener('change', function () {
      var file = this.files && this.files[0];
      this.value = '';
      if (!file) return;
      alertInto($('#eQrAlert'), 'info', 'Reading image…');
      readImageFile(file, 700).then(function (d) {
        qrData = d;
        $('#eQrImg').src = d;
        $('#eQrPreview').hidden = false;
        $('#eQrDrop').hidden = true;
        alertInto($('#eQrAlert'), 'ok', '');
      }).catch(function (err) { alertInto($('#eQrAlert'), 'err', err.message); });
    });
    $('#eQrRemove').addEventListener('click', function () {
      qrData = '';
      $('#eQrImg').src = '';
      $('#eQrPreview').hidden = true;
      $('#eQrDrop').hidden = false;
    });

    if ($('#eCancel')) $('#eCancel').addEventListener('click', function () { renderEditor(null); });

    $('#sbEventForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var title = $('#eTitle').value.trim();
      if (!title) { alertInto($('#sbEditorAlert'), 'err', 'Give the event a title.'); return; }
      var ext = $('#eExt').value.trim();
      if (ext && !/^https?:\/\/[^\s]+$/i.test(ext)) { alertInto($('#sbEditorAlert'), 'err', 'That external link does not look like a web address.'); return; }
      var slots = $('#eSlots').value.trim();

      var record = {
        id: editingId || uniqueId(slug(title)),
        title: title,
        department: $('#eDept').value.trim(),
        category: $('#eCat').value,
        description: $('#eDesc').value.trim(),
        rules: $('#eRules').value.trim(),
        poster: posterData || '',
        event_date: $('#eDate').value || '',
        event_time: $('#eTime').value.trim(),
        venue: $('#eVenue').value.trim(),
        fee: $('#eFee').value.trim(),
        team_size: $('#eTeam').value.trim(),
        slots: slots ? Math.max(1, parseInt(slots, 10) || 1) : null,
        status: $('#eStatus').value,
        external_url: ext,
        payment_required: $('#ePayReq').checked,
        payment_qr: $('#ePayReq').checked ? (qrData || '') : '',
        payment_note: $('#ePayReq').checked ? $('#ePayNote').value.trim() : '',
        fields: cleanFields(builderFields),
        sort_order: editingId ? (adminEvents.filter(function (x) { return x.id === editingId; })[0] || {}).sort_order || 0 : adminEvents.length
      };

      var btn = $('#eSave');
      btn.disabled = true;
      db.saveEvent(record).then(function () {
        toast(editingId ? 'Event saved.' : 'Event created.');
        editingId = '';
        return loadAdminEvents().then(function () { renderEditor(null); });
      }).catch(function (err) {
        alertInto($('#sbEditorAlert'), 'err', err.message);
        btn.disabled = false;
      });
    });

    if (ev) host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function uniqueId(base) {
    var id = base, n = 2;
    while (adminEvents.some(function (e) { return e.id === id; })) id = base + '-' + (n++);
    return id;
  }

  function addBuilderField() {
    var label = $('#bLabel').value.trim();
    var type = $('#bType').value;
    if (!label) { $('#bLabel').focus(); return; }
    var f = { key: slug(label).replace(/-/g, '_'), label: label, type: type, required: $('#bReq').checked };
    if (HAS_OPTIONS[type]) {
      f.options = $('#bOptions').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      if (!f.options.length) { alertInto($('#sbEditorAlert'), 'err', 'Add at least one option, one per line.'); return; }
    }
    /* keep keys unique against fixed + existing */
    var taken = {};
    FIXED_FIELDS.concat(builderFields).forEach(function (x) { taken[x.key] = 1; });
    var k = f.key, n = 2;
    while (taken[k]) k = f.key + '_' + (n++);
    f.key = k;
    builderFields.push(f);
    $('#bLabel').value = ''; $('#bOptions').value = ''; $('#bReq').checked = true;
    alertInto($('#sbEditorAlert'), 'info', '');
    renderBuilder();
    $('#bLabel').focus();
  }

  function renderBuilder() {
    var host = $('#builderList');
    if (!host) return;
    var rows = FIXED_FIELDS.map(function (f) {
      return '<div class="bfield bfield--fixed"><span class="bfield__grip" aria-hidden="true">≡</span>' +
        '<div class="bfield__main"><b>' + esc(f.label) + '</b> <span class="chip">' + typeLabel(f.type) + '</span> <span class="chip">required</span>' +
        (f.options ? '<div class="bfield__opts">' + f.options.map(esc).join(' · ') + '</div>' : '') + '</div>' +
        '<span class="hint" style="margin:0">Always asked</span></div>';
    });
    rows = rows.concat(builderFields.map(function (f, i) {
      return '<div class="bfield" data-i="' + i + '"><span class="bfield__grip" aria-hidden="true">≡</span>' +
        '<div class="bfield__main"><b>' + esc(f.label) + '</b> <span class="chip">' + typeLabel(f.type) + '</span>' + (f.required ? ' <span class="chip">required</span>' : '') +
        (f.options ? '<div class="bfield__opts">' + f.options.map(esc).join(' · ') + '</div>' : '') + '</div>' +
        '<div class="admin-row__actions">' +
          '<button class="btn btn--sm" type="button" data-b="up" ' + (i === 0 ? 'disabled' : '') + '><span>↑</span></button>' +
          '<button class="btn btn--sm" type="button" data-b="down" ' + (i === builderFields.length - 1 ? 'disabled' : '') + '><span>↓</span></button>' +
          '<button class="btn btn--sm" type="button" data-b="req"><span>' + (f.required ? 'Optional' : 'Required') + '</span></button>' +
          '<button class="btn btn--sm btn--danger" type="button" data-b="del"><span>✕</span></button>' +
        '</div></div>';
    }));
    host.innerHTML = rows.join('');
  }

  function typeLabel(t) {
    for (var i = 0; i < FIELD_TYPES.length; i++) if (FIELD_TYPES[i][0] === t) return FIELD_TYPES[i][1];
    return t;
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('#builderList [data-b]');
    if (!btn) return;
    var i = parseInt(btn.closest('.bfield').dataset.i, 10);
    var act = btn.dataset.b;
    if (act === 'del') builderFields.splice(i, 1);
    else if (act === 'req') builderFields[i].required = !builderFields[i].required;
    else if (act === 'up' && i > 0) builderFields.splice(i - 1, 0, builderFields.splice(i, 1)[0]);
    else if (act === 'down' && i < builderFields.length - 1) builderFields.splice(i + 1, 0, builderFields.splice(i, 1)[0]);
    renderBuilder();
  });

  /* ---- registrations viewer + export ---- */
  var regsRows = [];
  var regsEvent = '';

  function renderRegs(eventId) {
    var host = $('#sbRegs');
    if (!host) return;
    if (eventId !== undefined) regsEvent = eventId || '';

    host.innerHTML = '' +
      '<h3 style="font-size:1.15rem">Who has registered</h3>' +
      '<div style="display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;margin:1rem 0 1.2rem">' +
        '<select class="select" id="rEvent" style="width:auto;min-width:220px">' +
          '<option value="">All events</option>' +
          adminEvents.map(function (ev) { return '<option value="' + esc(ev.id) + '"' + (ev.id === regsEvent ? ' selected' : '') + '>' + esc(ev.title) + '</option>'; }).join('') +
        '</select>' +
        '<input class="input" id="rSearch" placeholder="Search name, phone, branch…" style="width:auto;min-width:220px;flex:1">' +
        '<button class="btn btn--primary btn--sm" id="rXlsx"><span>Download Excel</span></button>' +
        '<button class="btn btn--sm" id="rCsv"><span>CSV</span></button>' +
        '<button class="btn btn--sm" id="rReload"><span>Refresh</span></button>' +
      '</div>' +
      '<div id="rSummary" class="hint" style="margin:0 0 .8rem"></div>' +
      '<div class="tablewrap"><table class="regtable" id="rTable"></table></div>';

    $('#rEvent').addEventListener('change', function () { renderRegs(this.value); });
    $('#rReload').addEventListener('click', function () { renderRegs(); });
    $('#rSearch').addEventListener('input', paintRegsTable);
    $('#rXlsx').addEventListener('click', function () { exportRegs('xlsx'); });
    $('#rCsv').addEventListener('click', function () { exportRegs('csv'); });

    $('#rTable').innerHTML = '<tr><td class="hint">Loading…</td></tr>';
    db.registrations(regsEvent).then(function (rows) {
      regsRows = rows;
      paintRegsTable();
    }).catch(function (err) { $('#rTable').innerHTML = '<tr><td class="alert alert--err">' + esc(err.message) + '</td></tr>'; });
  }

  function regsColumns() {
    /* union of custom field keys across the events shown, in event order */
    var cols = [];
    var seen = {};
    adminEvents.forEach(function (ev) {
      if (regsEvent && ev.id !== regsEvent) return;
      cleanFields(ev.fields).forEach(function (f) {
        if (!seen[f.key]) { seen[f.key] = 1; cols.push({ key: f.key, label: f.label }); }
      });
    });
    return cols;
  }

  function cell(v) {
    if (Array.isArray(v)) return v.join(', ');
    return v == null ? '' : String(v);
  }

  function anyPayment() {
    return adminEvents.some(function (ev) {
      if (regsEvent && ev.id !== regsEvent) return false;
      return ev.payment_required;
    });
  }

  function regsMatrix() {
    var cols = regsColumns();
    var titleOf = {};
    adminEvents.forEach(function (ev) { titleOf[ev.id] = ev.title; });
    var pay = anyPayment();
    var head = ['#', 'Event', 'Full name', 'Semester', 'Branch']
      .concat(cols.map(function (c) { return c.label; }))
      .concat(pay ? ['Transaction id', 'Proof'] : [])
      .concat(['Registered at']);
    var q = ($('#rSearch') ? $('#rSearch').value : '').trim().toLowerCase();
    var body = [];
    regsRows.forEach(function (r, i) {
      var row = [i + 1, titleOf[r.event_id] || r.event_id, r.full_name, r.semester, r.branch]
        .concat(cols.map(function (c) { return cell((r.data || {})[c.key]); }))
        .concat(pay ? [r.txn_id || '', r.txn_id ? 'submitted' : ''] : [])
        .concat([fmtWhen(r.created_at)]);
      if (q && row.join(' ').toLowerCase().indexOf(q) === -1) return;
      body.push({ id: r.id, cells: row, hasProof: !!r.txn_id, proofCol: pay ? row.length - 2 : -1 });
    });
    return { head: head, body: body, pay: pay };
  }

  function paintRegsTable() {
    var m = regsMatrix();
    var tbl = $('#rTable');
    $('#rSummary').textContent = m.body.length + ' registration' + (m.body.length === 1 ? '' : 's') +
      (regsRows.length !== m.body.length ? ' shown of ' + regsRows.length : '') +
      (regsEvent ? '' : ' across all events');
    if (!m.body.length) {
      tbl.innerHTML = '<tr><td class="hint" style="padding:1rem">No registrations' + (regsRows.length ? ' match that search.' : ' yet.') + '</td></tr>';
      return;
    }
    tbl.innerHTML =
      '<thead><tr>' + m.head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '<th></th></tr></thead>' +
      '<tbody>' + m.body.map(function (r) {
        return '<tr data-rid="' + esc(r.id) + '">' + r.cells.map(function (c, ci) {
          if (ci === r.proofCol && r.hasProof) {
            return '<td><button class="btn btn--sm" data-proof><span>View</span></button></td>';
          }
          return '<td>' + esc(c) + '</td>';
        }).join('') +
          '<td><button class="btn btn--sm btn--danger" data-rdel><span>✕</span></button></td></tr>';
      }).join('') + '</tbody>';
  }

  document.addEventListener('click', function (e) {
    var view = e.target.closest('#rTable [data-proof]');
    if (view) {
      var rid = view.closest('tr').dataset.rid;
      var lb = $('#posterLightbox'), img = $('#lightboxImg');
      view.disabled = true; view.querySelector('span').textContent = '…';
      db.proof(rid).then(function (src) {
        view.disabled = false; view.querySelector('span').textContent = 'View';
        if (!src) { toast('No screenshot stored for this one.'); return; }
        img.src = src; lb.hidden = false; document.body.style.overflow = 'hidden';
      }).catch(function (err) { view.disabled = false; view.querySelector('span').textContent = 'View'; toast(err.message); });
      return;
    }
    var btn = e.target.closest('#rTable [data-rdel]');
    if (!btn) return;
    var tr = btn.closest('tr');
    var id = tr.dataset.rid;
    var name = tr.children[2].textContent;
    if (!confirm('Remove ' + name + '\'s registration? This cannot be undone.')) return;
    db.deleteRegistration(id).then(function () {
      regsRows = regsRows.filter(function (r) { return r.id !== id; });
      paintRegsTable();
      toast('Registration removed.');
      db.counts().then(function (c) { adminCounts = c; renderEventList(); });
    }).catch(function (err) { toast(err.message); });
  });

  function fileStem() {
    var ev = adminEvents.filter(function (x) { return x.id === regsEvent; })[0];
    return 'cyzera-registrations-' + (ev ? slug(ev.title) : 'all') + '-' + new Date().toISOString().slice(0, 10);
  }

  function download(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
  }

  function exportRegs(kind) {
    var m = regsMatrix();
    if (!m.body.length) { toast('Nothing to export.'); return; }
    var aoa = [m.head].concat(m.body.map(function (r) { return r.cells; }));

    if (kind === 'csv') {
      var csv = aoa.map(function (row) {
        return row.map(function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',');
      }).join('\r\n');
      download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), fileStem() + '.csv');
      toast('CSV downloaded.');
      return;
    }

    loadSheetJS().then(function (XLSX) {
      var ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = m.head.map(function (h, i) {
        var w = Math.max(String(h).length, 8);
        aoa.slice(1).forEach(function (r) { w = Math.max(w, Math.min(40, String(r[i] == null ? '' : r[i]).length)); });
        return { wch: w + 2 };
      });
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Registrations');
      XLSX.writeFile(wb, fileStem() + '.xlsx');
      toast('Excel file downloaded.');
    }).catch(function () {
      toast('Excel library could not load — downloading CSV instead (Excel opens it fine).');
      exportRegs('csv');
    });
  }

  var sheetJs = null;
  function loadSheetJS() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (sheetJs) return sheetJs;
    sheetJs = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = function () { window.XLSX ? resolve(window.XLSX) : reject(new Error('no XLSX')); };
      s.onerror = function () { sheetJs = null; reject(new Error('load failed')); };
      document.head.appendChild(s);
    });
    return sheetJs;
  }

  /* ---- settings ---- */
  function renderBranchList() {
    var host = $('#brList');
    if (!host) return;
    if (!BRANCHES.length) { host.innerHTML = '<p class="hint">No branches yet — add the first one below.</p>'; return; }
    host.innerHTML = BRANCHES.map(function (b) {
      return '<span class="branchchip">' + esc(b) +
        '<button type="button" class="branchchip__x" data-branch="' + esc(b) + '" aria-label="Remove ' + esc(b) + '">&times;</button></span>';
    }).join('');
  }

  document.addEventListener('click', function (e) {
    var x = e.target.closest('#brList [data-branch]');
    if (!x) return;
    var name = x.getAttribute('data-branch');
    if (!confirm('Remove the branch "' + name + '"? People already registered under it are not affected, but it will no longer be offered.')) return;
    db.deleteBranch(name).then(function () {
      alertInto($('#brAlert'), 'ok', '');
      return refreshBranches().then(renderBranchList);
    }).catch(function (err) { alertInto($('#brAlert'), 'err', err.message); });
  });

  function renderSettings() {
    var host = $('#sbSettings');
    if (!host) return;
    host.innerHTML = '' +
      '<h3 style="font-size:1.15rem">Change password</h3>' +
      '<p class="hint" style="margin-bottom:1.4rem">Stored by Supabase as a salted hash, never sent back to the browser. Changing it signs out every other session.</p>' +
      '<form id="sbPwForm" autocomplete="off">' +
        '<div id="sbPwAlert"></div>' +
        '<label class="field"><span class="field__label">Current password</span><input class="input" type="password" id="pwCur" autocomplete="current-password" required></label>' +
        '<label class="field"><span class="field__label">New password</span><input class="input" type="password" id="pwNew" autocomplete="new-password" required minlength="8"></label>' +
        '<label class="field"><span class="field__label">Confirm new password</span><input class="input" type="password" id="pwConf" autocomplete="new-password" required></label>' +
        '<button class="btn btn--primary" type="submit"><span>Change password</span></button>' +
      '</form>' +
      '<hr class="rule" style="margin:2rem 0">' +
      '<h3 style="font-size:1.15rem">Branches</h3>' +
      '<p class="hint" style="margin-bottom:1rem">The branch dropdown every registrant picks from. Add or remove branches here — changes apply to every form at once.</p>' +
      '<div id="brAlert"></div>' +
      '<div class="branchlist" id="brList"></div>' +
      '<form id="brForm" style="display:flex;gap:.6rem;flex-wrap:wrap;margin-top:1rem">' +
        '<input class="input" id="brNew" placeholder="New branch, e.g. Civil" style="flex:1;min-width:200px">' +
        '<button class="btn btn--sm btn--primary" type="submit"><span>+ Add branch</span></button>' +
      '</form>' +
      '<hr class="rule" style="margin:2rem 0">' +
      '<h3 style="font-size:1.15rem">How this is protected</h3>' +
      '<p class="hint">Sign-in happens on Supabase, not in this page. Every event you save and every registrant you read is checked by the database against its row-level security policies, so tampering with the page in devtools gets an attacker nowhere. Only accounts in the <code>admins</code> table can do any of this, and only the Supabase SQL editor can add one. Visitors can do exactly one thing: submit a registration to an open event.</p>';

    renderBranchList();
    $('#brForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = $('#brNew').value.trim();
      if (!name) return;
      if (BRANCHES.some(function (b) { return b.toLowerCase() === name.toLowerCase(); })) {
        alertInto($('#brAlert'), 'err', 'That branch already exists.'); return;
      }
      var btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true;
      db.addBranch(name, BRANCHES.length).then(function () {
        $('#brNew').value = '';
        alertInto($('#brAlert'), 'ok', '');
        return refreshBranches().then(renderBranchList);
      }).catch(function (err) { alertInto($('#brAlert'), 'err', err.message); })
        .then(function () { btn.disabled = false; });
    });

    $('#sbPwForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var cur = $('#pwCur').value, next = $('#pwNew').value, conf = $('#pwConf').value;
      if (next !== conf) { alertInto($('#sbPwAlert'), 'err', 'The two new passwords do not match.'); return; }
      if (next.length < 8) { alertInto($('#sbPwAlert'), 'err', 'Use at least 8 characters.'); return; }
      var btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true;
      auth.changePassword(cur, next).then(function () {
        e.target.reset();
        alertInto($('#sbPwAlert'), 'ok', 'Password changed.');
        toast('Password changed.');
      }).catch(function (err) { alertInto($('#sbPwAlert'), 'err', err.message); })
        .then(function () { btn.disabled = false; });
    });
  }

  /* ---------------------------------------------------------------
     Public surface for app.js
  --------------------------------------------------------------- */
  window.CYZERA_REG = {
    enabled: ENABLED,
    renderPublicEvents: renderPublicEvents,
    renderEventDetail: renderEventDetail,
    mountAdmin: mountAdmin
  };
})();
