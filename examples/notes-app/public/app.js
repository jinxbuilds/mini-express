'use strict';

const $ = (sel) => document.querySelector(sel);

const state = { q: '', tag: '', notes: [], allTags: [] };

// ---- API helper -----------------------------------------------------------

async function api(method, path, body) {
  const init = { method, headers: { Accept: 'application/json' } };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await fetch(path, init);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err = new Error(data?.error?.message || res.statusText);
    err.details = data?.error?.details;
    throw err;
  }
  return data;
}

// ---- notes ----------------------------------------------------------------

async function loadNotes() {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.tag) params.set('tag', state.tag);
  const [{ notes }, stats] = await Promise.all([
    api('GET', `/api/notes?${params}`),
    api('GET', '/api/notes/stats'),
  ]);
  state.notes = notes;
  state.allTags = Object.keys(stats.tags).sort();
  $('#count').textContent = `(${stats.total})`;
  renderTags();
  renderNotes();
}

function renderTags() {
  const box = $('#tag-filter');
  box.replaceChildren(...state.allTags.map((tag) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tag';
    b.textContent = `#${tag}`;
    b.setAttribute('aria-pressed', String(state.tag === tag));
    b.onclick = () => {
      state.tag = state.tag === tag ? '' : tag;
      loadNotes();
    };
    return b;
  }));
}

function renderNotes() {
  const grid = $('#notes-grid');
  if (!state.notes.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = state.q || state.tag ? 'No notes match that filter.' : 'No notes yet — add one above.';
    grid.replaceChildren(p);
    return;
  }

  const tpl = $('#note-template');
  grid.replaceChildren(...state.notes.map((note) => {
    const el = tpl.content.firstElementChild.cloneNode(true);
    el.classList.toggle('pinned', note.pinned);
    el.querySelector('h3').textContent = note.title;
    el.querySelector('.body').textContent = note.body;
    const time = el.querySelector('time');
    time.dateTime = note.updatedAt;
    time.textContent = new Date(note.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    el.querySelector('.tags').replaceChildren(...note.tags.map((t) => {
      const s = document.createElement('span');
      s.className = 'tag';
      s.textContent = `#${t}`;
      return s;
    }));
    el.querySelector('.pin').onclick = async () => {
      await api('PATCH', `/api/notes/${note.id}`, { pinned: !note.pinned });
      loadNotes();
    };
    el.querySelector('.delete').onclick = async () => {
      await api('DELETE', `/api/notes/${note.id}`);
      loadNotes();
    };
    return el;
  }));
}

$('#create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const errorEl = $('#form-error');
  errorEl.textContent = '';
  try {
    await api('POST', '/api/notes', {
      title: form.elements.title.value,
      body: form.elements.body.value,
      tags: form.elements.tags.value.split(',').map((t) => t.trim()).filter(Boolean),
    });
    form.reset();
    loadNotes();
  } catch (err) {
    errorEl.textContent = err.details ? `${err.message}: ${err.details.join(', ')}` : err.message;
  }
});

let searchTimer;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = e.target.value.trim();
    loadNotes();
  }, 200);
});

// ---- API console ----------------------------------------------------------

const presets = [
  ['GET', '/api/health'],
  ['GET', '/api/notes?q=routing'],
  ['POST', '/api/notes', '{\n  "title": "Hello from the console",\n  "tags": ["console"]\n}'],
  ['POST', '/api/notes', '{ "title": "" }'],
  ['POST', '/api/notes', '{ not valid json'],
  ['GET', '/api/notes/does-not-exist'],
  ['GET', '/api/echo/a/b/c?sort=desc&tag=x&tag=y'],
  ['OPTIONS', '/api/notes'],
  ['GET', '/api/boom'],
  ['GET', '/api/nothing-here'],
  ['GET', '/styles.css'],
];

$('#presets').replaceChildren(...presets.map(([method, path, body]) => {
  const b = document.createElement('button');
  b.type = 'button';
  const m = document.createElement('b');
  m.textContent = method;
  b.append(m, path.length > 32 ? path.slice(0, 30) + '…' : path);
  b.title = body ? `${method} ${path}\n${body}` : `${method} ${path}`;
  b.onclick = () => {
    const form = $('#console-form');
    form.elements.method.value = method;
    form.elements.path.value = path;
    form.elements.body.value = body || '';
    form.requestSubmit();
  };
  return b;
}));

$('#console-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const method = form.elements.method.value;
  const init = { method, headers: { Accept: 'application/json' } };
  if (form.elements.body.value.trim() && !['GET', 'HEAD'].includes(method)) {
    init.headers['Content-Type'] = 'application/json';
    init.body = form.elements.body.value;
  }

  const t0 = performance.now();
  let res;
  try {
    res = await fetch(form.elements.path.value, init);
  } catch (err) {
    showResponse({ status: 0, statusText: 'Network error', headers: new Headers(), text: String(err), ms: 0 });
    return;
  }
  const text = await res.text();
  showResponse({ status: res.status, statusText: res.statusText, headers: res.headers, text, ms: performance.now() - t0 });

  // Keep the notes board in sync with whatever the console changed.
  if (form.elements.path.value.startsWith('/api/notes') && method !== 'GET') loadNotes();
});

function showResponse({ status, statusText, headers, text, ms }) {
  $('#response').hidden = false;
  const s = $('#res-status');
  s.textContent = `${status} ${statusText}`;
  s.className = `status s${String(status)[0]}`;
  const serverTime = headers.get('X-Response-Time');
  $('#res-time').textContent = `${ms.toFixed(0)}ms round-trip${serverTime ? ` · ${serverTime} in server` : ''}`;
  $('#res-size').textContent = `${new Blob([text]).size} bytes`;
  $('#res-headers').textContent = [...headers].map(([k, v]) => `${k}: ${v}`).join('\n');

  let pretty = text;
  try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* not JSON */ }
  $('#res-body').textContent = pretty || '(empty body)';
}

// ---- boot -----------------------------------------------------------------

api('GET', '/api/health')
  .then((h) => {
    const badge = $('#health-badge');
    badge.textContent = `● online · ${h.framework}`;
    badge.classList.add('ok');
  })
  .catch(() => { $('#health-badge').textContent = 'offline'; });

loadNotes();
