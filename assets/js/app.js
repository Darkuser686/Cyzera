/* =====================================================================
   CYZERA — application logic
   Routing · scroll reveal · registration board · admin panel
   ===================================================================== */
(function () {
  'use strict';


  var UNLOCK = 'cyzera.unlock';   /* gates the admin route, see below */

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------------------
     Utilities
  --------------------------------------------------------------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var toastEl = $('#toast');
  var toastTimer;

  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('is-up');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-up'); }, 2600);
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

  /* A Google Forms link, or at minimum a plausible http(s) URL.
     new URL() alone is too permissive — it percent-encodes spaces straight into
     the host, so "not a url at all" would sail through. Check the hostname. */
  function normaliseUrl(raw) {
    var u = String(raw || '').trim();
    if (!u) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;

    var parsed;
    try { parsed = new URL(u); } catch (e) { return ''; }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(parsed.hostname)) return '';

    return parsed.href;
  }

  function isGoogleForm(u) {
    return /(^https?:\/\/forms\.gle\/)|(^https?:\/\/(docs|forms)\.google\.com\/)/i.test(u);
  }

  /* ---------------------------------------------------------------
     Store — published defaults, overridden by this browser's edits
  --------------------------------------------------------------- */
  /* ---------------------------------------------------------------
     Store and Auth — no server, no database.

     The published links live in assets/js/data.js. Edits made in the admin
     panel are kept in this browser's localStorage and take effect straight
     away here; to publish them to everyone, export data.js from the Publish
     tab and commit it.
  --------------------------------------------------------------- */
  var CFG = window.CYZERA_AUTH || {};
  var PUBLISHED = window.CYZERA_FORMS || [];
  var LS_FORMS = 'cyzera.forms.v2';
  var SS_AUTH = 'cyzera.session.v2';

  function normaliseRecord(f, i) {
    return {
      id: f.id || ('f-' + i),
      title: String(f.title || 'Untitled'),
      event: String(f.event || ''),
      description: String(f.description || ''),
      url: normaliseUrl(f.url) || '',
      deadline: String(f.deadline || ''),
      status: f.status === 'open' ? 'open' : 'closed'
    };
  }

  var Store = {
    load: function () {
      var list = null;
      try {
        var raw = localStorage.getItem(LS_FORMS);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) list = parsed;
        }
      } catch (e) { /* fall through to the published file */ }

      if (!list) list = JSON.parse(JSON.stringify(PUBLISHED));
      forms = list.map(normaliseRecord);
      return Promise.resolve(forms);
    },

    save: function () {
      try {
        localStorage.setItem(LS_FORMS, JSON.stringify(forms));
      } catch (e) {
        return Promise.reject(new Error('This browser refused to save (private mode?).'));
      }
      return Promise.resolve();
    },

    reset: function () {
      try { localStorage.removeItem(LS_FORMS); } catch (e) { /* noop */ }
      forms = JSON.parse(JSON.stringify(PUBLISHED)).map(normaliseRecord);
      return Promise.resolve(forms);
    },

    isEdited: function () {
      try { return localStorage.getItem(LS_FORMS) !== null; } catch (e) { return false; }
    }
  };

  var Auth = {
    hashOf: function (user, pass) {
      return window.sha256(String(user).trim() + ':' + String(pass) + ':' + (CFG.SALT || ''));
    },

    login: function (user, pass) {
      if (this.hashOf(user, pass) !== CFG.ADMIN_HASH) {
        return Promise.reject(new Error('Incorrect username or password.'));
      }
      var mins = Number(CFG.SESSION_MINUTES) || 120;
      var s = { name: String(user).trim(), exp: Date.now() + mins * 60000 };
      try { sessionStorage.setItem(SS_AUTH, JSON.stringify(s)); } catch (e) { /* noop */ }
      current = s;
      return Promise.resolve(s);
    },

    logout: function () {
      try { sessionStorage.removeItem(SS_AUTH); } catch (e) { /* noop */ }
      current = null;
      return Promise.resolve();
    },

    refresh: function () { return Promise.resolve(this.session()); },

    session: function () {
      if (current && current.exp > Date.now()) return current;
      try {
        var s = JSON.parse(sessionStorage.getItem(SS_AUTH) || 'null');
        if (s && s.exp > Date.now()) { current = s; return current; }
      } catch (e) { /* noop */ }
      current = null;
      return null;
    },

    touch: function () {
      var s = this.session();
      if (!s) return;
      s.exp = Date.now() + (Number(CFG.SESSION_MINUTES) || 120) * 60000;
      try { sessionStorage.setItem(SS_AUTH, JSON.stringify(s)); } catch (e) { /* noop */ }
    }
  };

  var current = null;

  var forms = [];

  /* ---------------------------------------------------------------
     Router
  --------------------------------------------------------------- */
  var ROUTES = ['home', 'about', 'team', 'events', 'register', 'admin'];

  /* The admin route is not reachable by typing the URL. It opens only after
     the Ctrl+Shift+A gesture, which sets a flag for this tab. This is
     convenience, not security — the server is what actually protects the
     data, and it rejects every write without a valid session cookie. */
  function adminUnlocked() {
    try { return sessionStorage.getItem(UNLOCK) === '1'; } catch (e) { return false; }
  }

  function unlockAdmin() {
    try { sessionStorage.setItem(UNLOCK, '1'); } catch (e) { /* noop */ }
  }

  function routeFromHash() {
    var h = (location.hash || '#/').replace(/^#\/?/, '').split('?')[0];
    if (h === 'admin' && !adminUnlocked()) return 'home';
    return ROUTES.indexOf(h) > -1 ? h : 'home';
  }

  function go() {
    var route = routeFromHash();

    $$('.view').forEach(function (v) {
      v.classList.toggle('is-active', v.id === 'view-' + route);
    });

    $$('.nav__link').forEach(function (a) {
      var target = a.getAttribute('href').replace(/^#\/?/, '') || 'home';
      a.classList.toggle('is-active', target === route);
    });

    closeMenu();
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });

    if (route === 'register') renderPublic();
    if (route === 'admin') syncAdminUI();

    var titles = {
      home: 'CYZERA — Innovate | Secure | Evolve',
      about: 'About Us — CYZERA',
      team: 'Team — CYZERA',
      events: 'Our Events — CYZERA',
      register: 'Registrations — CYZERA',
      admin: 'Admin — CYZERA'
    };
    document.title = titles[route];

    armReveals();
    if (typeof paintBar === 'function') paintBar();
  }

  window.addEventListener('hashchange', go);

  /* ---------------------------------------------------------------
     Nav
  --------------------------------------------------------------- */
  var nav = $('#nav');
  var burger = $('#burger');
  var navLinks = $('#navLinks');

  function closeMenu() {
    if (!burger) return;
    burger.setAttribute('aria-expanded', 'false');
    navLinks.classList.remove('is-open');
  }

  if (burger) {
    burger.addEventListener('click', function () {
      var open = burger.getAttribute('aria-expanded') === 'true';
      burger.setAttribute('aria-expanded', String(!open));
      navLinks.classList.toggle('is-open', !open);
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeMenu();
  });

  var lastY = -1;
  function onScroll() {
    var y = window.scrollY;
    if ((y > 12) !== (lastY > 12)) nav.classList.toggle('is-stuck', y > 12);
    lastY = y;
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------------------------------------------------------------
     Scroll reveal
  --------------------------------------------------------------- */
  var io = null;

  if ('IntersectionObserver' in window && !reduceMotion) {
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('is-in');
          io.unobserve(en.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
  }

  function armReveals() {
    var targets = $$('.view.is-active .reveal:not(.is-in)');
    if (!io) { targets.forEach(function (t) { t.classList.add('is-in'); }); return; }
    targets.forEach(function (t) { io.observe(t); });
  }

  /* ---------------------------------------------------------------
     Word-by-word heading reveal

     Walks text nodes only, so inline markup inside a heading (the accent
     span, <br>) survives intact and its words still get wrapped.
  --------------------------------------------------------------- */
  function splitWords(root) {
    if (!root || root.dataset.split) return;
    root.dataset.split = '1';

    var i = 0;

    (function walk(node) {
      var kids = Array.prototype.slice.call(node.childNodes);
      kids.forEach(function (child) {
        if (child.nodeType === 1) { walk(child); return; }
        if (child.nodeType !== 3 || !child.nodeValue.trim()) return;

        var frag = document.createDocumentFragment();
        child.nodeValue.split(/(\s+)/).forEach(function (tok) {
          if (!tok) return;
          if (!tok.trim()) { frag.appendChild(document.createTextNode(tok)); return; }
          var w = document.createElement('span');
          w.className = 'word';
          w.style.setProperty('--wi', i++);
          w.textContent = tok;
          frag.appendChild(w);
        });
        node.replaceChild(frag, child);
      });
    })(root);
  }

  $$('.section__title, .about__lead').forEach(splitWords);

  /* ---------------------------------------------------------------
     Hidden admin access

     The Admin link is deliberately absent from the nav and footer. The route
     still works, so office bearers reach the panel one of two ways:
       1. the URL directly  ->  <site>/#/admin
       2. Ctrl + Shift + A  ->  from any page
     Neither is a security control (see the note in the Settings tab) — they
     just keep the panel out of a casual visitor's way.
  --------------------------------------------------------------- */
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
      e.preventDefault();
      unlockAdmin();
      if (location.hash === '#/admin') go(); else location.hash = '#/admin';
    }
  });

  /* ---------------------------------------------------------------
     Scroll progress
  --------------------------------------------------------------- */
  var bar = $('#scrollBar');
  var barTick = false;

  function paintBar() {
    barTick = false;
    if (!bar) return;
    var doc = document.documentElement;
    var max = doc.scrollHeight - doc.clientHeight;
    bar.style.setProperty('--p', max > 0 ? Math.min(1, window.scrollY / max) : 0);
  }

  if (bar && !reduceMotion) {
    window.addEventListener('scroll', function () {
      if (!barTick) { barTick = true; requestAnimationFrame(paintBar); }
    }, { passive: true });
    window.addEventListener('resize', paintBar, { passive: true });
    paintBar();
  }

  /* ---------------------------------------------------------------
     Card spotlight (pointer-follow glow)
  --------------------------------------------------------------- */
  if (!reduceMotion && window.matchMedia('(hover: hover)').matches) {
    document.addEventListener('pointermove', function (e) {
      var card = e.target.closest ? e.target.closest('.card, .formcard, .event') : null;
      if (!card) return;
      var r = card.getBoundingClientRect();
      card.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100) + '%');
      card.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100) + '%');
    }, { passive: true });
  }

  /* ---------------------------------------------------------------
     Marquee
  --------------------------------------------------------------- */
  (function buildMarquee() {
    var track = $('#marqueeTrack');
    if (!track) return;
    var words = ['Cryptography', 'Digital Forensics', 'OSINT', 'Hackathons', 'Escape Rooms',
                 'AI Generation', 'eSports', 'Technical Talks', 'Cyber Resilience', 'Innovate',
                 'Secure', 'Evolve'];
    var run = words.map(function (w) { return '<span class="marquee__item">' + esc(w) + '</span>'; }).join('');
    track.innerHTML = run + run; /* duplicated for a seamless -50% loop */
  })();

  /* ---------------------------------------------------------------
     Public registration board
  --------------------------------------------------------------- */
  function renderPublic() {
    var host = $('#publicForms');
    if (!host) return;

    var open = forms.filter(function (f) { return f.status === 'open' && !!normaliseUrl(f.url); });
    var rest = forms.filter(function (f) { return open.indexOf(f) === -1; });
    var ordered = open.concat(rest);

    if (!ordered.length) {
      host.innerHTML =
        '<div class="empty">' +
          '<div class="empty__icon">◎</div>' +
          '<p><b>No registrations published yet.</b></p>' +
          '<p style="margin-top:.4rem">Links appear here the moment the CYZERA team publishes them. Check back before the next event.</p>' +
        '</div>';
      return;
    }

    host.innerHTML = ordered.map(function (f, i) {
      var live = f.status === 'open';
      var url = normaliseUrl(f.url);
      var usable = live && !!url;

      var chips = '';
      chips += usable
        ? '<span class="chip chip--live"><i class="dot"></i> Open now</span>'
        : '<span class="chip">' + (live ? 'Link pending' : 'Closed') + '</span>';
      if (f.event) chips += '<span class="chip chip--blue">' + esc(f.event) + '</span>';
      if (f.deadline) chips += '<span class="chip">Closes ' + esc(fmtDate(f.deadline)) + '</span>';

      var action = usable
        ? '<a class="btn btn--primary" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer"><span>Open form ↗</span></a>'
        : '<button class="btn" disabled><span>' + (live ? 'Coming soon' : 'Closed') + '</span></button>';

      return '' +
        '<article class="formcard reveal' + (usable ? '' : ' is-closed') + '" style="--delay:' + (i * 70) + 'ms">' +
          '<div>' +
            '<div class="formcard__meta">' + chips + '</div>' +
            '<h3 class="formcard__title">' + esc(f.title) + '</h3>' +
            (f.description ? '<p class="formcard__desc">' + esc(f.description) + '</p>' : '') +
          '</div>' +
          '<div>' + action + '</div>' +
        '</article>';
    }).join('');

    armReveals();
  }

  /* ---------------------------------------------------------------
     Auth
  --------------------------------------------------------------- */


  /* ---------------------------------------------------------------
     Admin UI
  --------------------------------------------------------------- */
  var loginBox = $('#adminLogin');
  var panelBox = $('#adminPanel');

  function paintAdminUI() {
    var sess = Auth.session();
    var inn = !!sess;
    if (loginBox) loginBox.hidden = inn;
    if (panelBox) panelBox.hidden = !inn;
    if (inn) {
      $('#adminWho').textContent = sess.name;
      renderAdminList();
      refreshExport();
    }
    armReveals();
  }

  function syncAdminUI() { paintAdminUI(); }

  var loginForm = $('#loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var u = $('#loginUser').value;
      var p = $('#loginPass').value;

      var btn = loginForm.querySelector('button[type=submit]');
      btn.disabled = true;
      alertInto($('#loginAlert'), 'info', '');

      Auth.login(u, p).then(function () {
        $('#loginPass').value = '';
        toast('Signed in.');
        syncAdminUI();
      }).catch(function (err) {
        alertInto($('#loginAlert'), 'err', err.message);
        $('#loginPass').value = '';
        $('#loginPass').focus();
      }).then(function () { btn.disabled = false; });
    });
  }

  var logoutBtn = $('#logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      Auth.logout().then(function () {
        toast('Logged out — published links stay live.');
        syncAdminUI();
      });
    });
  }


  /* ---- Tabs ---- */
  $$('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      var name = tab.dataset.tab;
      $$('.tab').forEach(function (t) { t.classList.toggle('is-active', t === tab); });
      $$('.tabpane').forEach(function (p) { p.classList.toggle('is-active', p.dataset.pane === name); });
    });
  });

  /* ---- List ---- */
  function renderAdminList() {
    var host = $('#adminList');
    if (!host) return;

    if (!forms.length) {
      host.innerHTML = '<div class="empty"><p>No links yet. Add the first one above.</p></div>';
      return;
    }

    host.innerHTML = forms.map(function (f, i) {
      var live = f.status === 'open';
      return '' +
        '<div class="admin-row" data-id="' + esc(f.id) + '">' +
          '<div>' +
            '<div class="formcard__meta">' +
              (live ? '<span class="chip chip--live">Open</span>' : '<span class="chip">Closed</span>') +
              (f.event ? '<span class="chip chip--blue">' + esc(f.event) + '</span>' : '') +
              (f.deadline ? '<span class="chip">' + esc(fmtDate(f.deadline)) + '</span>' : '') +
            '</div>' +
            '<div class="admin-row__title">' + esc(f.title) + '</div>' +
            '<div class="admin-row__url">' + esc(f.url || '— no link set —') + '</div>' +
          '</div>' +
          '<div class="admin-row__actions">' +
            '<button class="btn btn--sm" data-act="up"     ' + (i === 0 ? 'disabled' : '') + '><span>↑</span></button>' +
            '<button class="btn btn--sm" data-act="down"   ' + (i === forms.length - 1 ? 'disabled' : '') + '><span>↓</span></button>' +
            '<button class="btn btn--sm" data-act="toggle"><span>' + (live ? 'Close' : 'Open') + '</span></button>' +
            '<button class="btn btn--sm" data-act="edit"><span>Edit</span></button>' +
            '<button class="btn btn--sm btn--danger" data-act="del"><span>Delete</span></button>' +
          '</div>' +
        '</div>';
    }).join('');
  }

  function indexOfId(id) {
    for (var i = 0; i < forms.length; i++) if (forms[i].id === id) return i;
    return -1;
  }

  function repaint() {
    renderAdminList();
    renderPublic();
    refreshExport();
  }

  function persist() { repaint(); }

  /* Re-pull from the server, then repaint both the admin list and the public
     board so what an admin sees is always what a visitor would see. */
  function reload() {
    return Store.load().then(function () { repaint(); });
  }

  function fail(err) { toast(err.message || 'Something went wrong.'); }

  var adminList = $('#adminList');
  if (adminList) {
    adminList.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn) return;

      var row = btn.closest('.admin-row');
      var id = row.dataset.id;
      var i = indexOfId(id);
      if (i < 0) return;

      var act = btn.dataset.act;

      if (act === 'toggle') {
        forms[i].status = forms[i].status === 'open' ? 'closed' : 'open';
        var nowOpen = forms[i].status === 'open';
        Store.save().then(function () {
          repaint();
          toast(nowOpen ? 'Link is now open.' : 'Link closed.');
        }).catch(fail);

      } else if (act === 'del') {
        if (!confirm('Delete "' + forms[i].title + '"? This cannot be undone.')) return;
        forms.splice(i, 1);
        Store.save().then(function () {
          repaint();
          toast('Link deleted.');
        }).catch(fail);

      } else if ((act === 'up' && i > 0) || (act === 'down' && i < forms.length - 1)) {
        var j = act === 'up' ? i - 1 : i + 1;
        forms.splice(j, 0, forms.splice(i, 1)[0]);
        Store.save().then(repaint).catch(fail);

      } else if (act === 'edit') {
        loadIntoEditor(forms[i]);
      }
    });
  }

  /* ---- Editor ---- */
  var editor = $('#formEditor');

  function loadIntoEditor(f) {
    $('#fId').value = f.id;
    $('#fTitle').value = f.title || '';
    $('#fEvent').value = f.event || '';
    $('#fUrl').value = f.url || '';
    $('#fDesc').value = f.description || '';
    $('#fDeadline').value = f.deadline || '';
    $('#fStatus').value = f.status === 'open' ? 'open' : 'closed';

    $('#editorHeading').textContent = 'Edit link';
    $('#saveBtn').querySelector('span').textContent = 'Save changes';
    $('#cancelEdit').hidden = false;
    alertInto($('#editorAlert'), 'info', '');

    $('#formEditor').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    $('#fTitle').focus();
  }

  function resetEditor() {
    editor.reset();
    $('#fId').value = '';
    $('#editorHeading').textContent = 'Add a Google Form link';
    $('#saveBtn').querySelector('span').textContent = 'Publish link';
    $('#cancelEdit').hidden = true;
    alertInto($('#editorAlert'), 'info', '');
  }

  var cancelEdit = $('#cancelEdit');
  if (cancelEdit) cancelEdit.addEventListener('click', resetEditor);

  if (editor) {
    editor.addEventListener('submit', function (e) {
      e.preventDefault();

      var title = $('#fTitle').value.trim();
      var rawUrl = $('#fUrl').value.trim();
      var url = normaliseUrl(rawUrl);

      if (!title) { alertInto($('#editorAlert'), 'err', 'Give the link a title.'); return; }

      /* An empty URL is allowed — the entry lists as "Coming soon" until the
         form exists. Only a URL that was typed but is malformed is an error. */
      if (rawUrl && !url) {
        alertInto($('#editorAlert'), 'err', 'That does not look like a valid web address. Paste the full Google Forms link.');
        return;
      }

      if (!url && $('#fStatus').value === 'open') {
        alertInto($('#editorAlert'), 'err', 'Add the form URL before marking this one open.');
        return;
      }

      var record = {
        id: $('#fId').value || ('f-' + Math.random().toString(36).slice(2, 8)),
        title: title,
        event: $('#fEvent').value.trim(),
        description: $('#fDesc').value.trim(),
        url: url,
        deadline: $('#fDeadline').value || '',
        status: $('#fStatus').value === 'open' ? 'open' : 'closed'
      };

      var at = indexOfId(record.id);
      var existing = at > -1;
      if (existing) { forms[at] = record; } else { forms.push(record); }

      var btn = $('#saveBtn');
      btn.disabled = true;
      Store.save().then(function () {
        repaint();
        resetEditor();
        var warn = isGoogleForm(url) ? '' : ' (heads up — that is not a Google Forms address)';
        toast((existing ? 'Link updated.' : 'Link published.') + warn);
      }).catch(function (err) {
        alertInto($('#editorAlert'), 'err', err.message);
      }).then(function () { btn.disabled = false; });
    });
  }

  /* Checked before sending, so the message is instant and specific. */
  var COMMON_WEAK = ['password', 'passw0rd', 'password1', '12345678', '123456789',
                     '1234567890', 'qwerty', 'qwerty123', 'qwertyuiop', 'letmein',
                     'welcome', 'iloveyou', 'abc12345', 'admin123', 'administrator',
                     'changeme', 'monkey', 'football', 'sunshine', 'princess',
                     'trustno1', 'starwars', 'whatever'];

  function passwordProblems(pw) {
    pw = String(pw || '');
    var out = [];
    if (pw.length < 8) out.push('must be at least 8 characters');
    if (!/[A-Za-z]/.test(pw)) out.push('needs a letter');
    if (!/[0-9]/.test(pw)) out.push('needs a number');

    var leet = pw.toLowerCase()
      .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a')
      .replace(/5/g, 's').replace(/7/g, 't').replace(/@/g, 'a').replace(/\$/g, 's')
      .replace(/!/g, 'i');
    var letters = leet.replace(/[^a-z]/g, '');
    var raw = pw.toLowerCase();
    for (var i = 0; i < COMMON_WEAK.length; i++) {
      var w = COMMON_WEAK[i];
      if (raw === w || leet === w || letters === w ||
          (w.length >= 5 && (leet.indexOf(w) > -1 || letters.indexOf(w) > -1))) {
        out.push('is too easy to guess');
        break;
      }
    }
    return out;
  }

  /* ---- Settings: generate a new credential hash ---- */
  var credForm = $('#credForm');
  if (credForm) {
    credForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var u = $('#cUser').value.trim();
      var pw = $('#cNew').value;
      var conf = $('#cConfirm').value;

      if (!u) { alertInto($('#credAlert'), 'err', 'Enter a username.'); return; }
      if (pw !== conf) { alertInto($('#credAlert'), 'err', 'The two passwords do not match.'); return; }

      var weak = passwordProblems(pw);
      if (weak.length) {
        alertInto($('#credAlert'), 'err', 'Password ' + weak.join('; ') + '.');
        return;
      }

      $('#credHash').textContent = "ADMIN_HASH: '" + Auth.hashOf(u, pw) + "',";
      $('#credOut').hidden = false;
      $('#cNew').value = '';
      $('#cConfirm').value = '';
      alertInto($('#credAlert'), 'ok',
        'Paste the line below into assets/js/auth-config.js, replacing the ADMIN_HASH line. ' +
        'The new login takes effect when you reload.');
      toast('Hash generated.');
    });
  }

  var newPw = $('#cNew');
  if (newPw) {
    newPw.addEventListener('input', function () {
      var v = newPw.value;
      var checks = [
        [v.length >= 8,       'at least 8 characters'],
        [/[A-Za-z]/.test(v),  'a letter'],
        [/[0-9]/.test(v),     'a number'],
        [v.length > 0 && !passwordProblems(v).length, 'not an easily guessed password']
      ];
      $('#pwRules').innerHTML = checks.map(function (c) {
        return '<li class="' + (c[0] ? 'is-ok' : '') + '">' + esc(c[1]) + '</li>';
      }).join('');
    });
  }

  /* ---- Publish tab: hand back a data.js to commit ---- */
  function dataFileText() {
    return [
      '/* ============================================================',
      '   CYZERA — registration links.',
      '',
      '   Exported from the admin panel. Replace assets/js/data.js with',
      '   this file and push, and everyone sees these links.',
      '   ============================================================ */',
      '',
      'window.CYZERA_FORMS = ' + JSON.stringify(forms, null, 2) + ';',
      ''
    ].join('\n');
  }

  function refreshExport() {
    var box = $('#jsonBox');
    if (box) box.value = dataFileText();
    var note = $('#editedNote');
    if (note) note.hidden = !Store.isEdited();
  }

  var exportBtn = $('#exportBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', function () {
      var blob = new Blob([dataFileText()], { type: 'text/javascript' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'data.js';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      toast('data.js downloaded — replace assets/js/data.js and push.');
    });
  }

  var copyBtn = $('#copyBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      var text = dataFileText();
      var done = function () { toast('Copied to clipboard.'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(done); });
      } else {
        fallbackCopy(done);
      }
    });
  }

  function fallbackCopy(done) {
    var box = $('#jsonBox');
    box.select();
    try { document.execCommand('copy'); done(); }
    catch (e) { toast('Copy failed — select the box and copy manually.'); }
  }

  var resetBtn = $('#resetBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      if (!confirm('Discard every edit made in this browser and go back to what assets/js/data.js contains?')) return;
      Store.reset().then(function () {
        repaint();
        resetEditor();
        toast('Reset to the published file.');
      });
    });
  }

  /* ---------------------------------------------------------------
     Boot
  --------------------------------------------------------------- */
  var yearEl = $('#year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  Store.load()
    .then(function () { renderPublic(); })
    .then(go);
})();
