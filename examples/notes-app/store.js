'use strict';

const crypto = require('crypto');

/**
 * A tiny in-memory "database". Methods are async to mimic a real driver,
 * which lets the routes demonstrate async handlers and error propagation.
 */
class NotesStore {
  constructor(seed = []) {
    this.notes = new Map();
    for (const note of seed) this.insert(note);
  }

  insert({ title, body = '', tags = [], pinned = false }) {
    const now = new Date().toISOString();
    const note = {
      id: crypto.randomUUID().slice(0, 8),
      title,
      body,
      tags,
      pinned,
      createdAt: now,
      updatedAt: now,
    };
    this.notes.set(note.id, note);
    return note;
  }

  async list({ q, tag, sort = 'updatedAt' } = {}) {
    let items = [...this.notes.values()];
    if (q) {
      const needle = q.toLowerCase();
      items = items.filter((n) => `${n.title} ${n.body}`.toLowerCase().includes(needle));
    }
    if (tag) items = items.filter((n) => n.tags.includes(tag));
    return items.sort((a, b) => (b.pinned - a.pinned) || String(b[sort]).localeCompare(String(a[sort])));
  }

  async get(id) {
    return this.notes.get(id) || null;
  }

  async create(data) {
    return this.insert(data);
  }

  async update(id, changes) {
    const note = this.notes.get(id);
    if (!note) return null;
    Object.assign(note, changes, { updatedAt: new Date().toISOString() });
    return note;
  }

  async remove(id) {
    return this.notes.delete(id);
  }

  async stats() {
    const all = [...this.notes.values()];
    const tags = {};
    for (const n of all) for (const t of n.tags) tags[t] = (tags[t] || 0) + 1;
    return { total: all.length, pinned: all.filter((n) => n.pinned).length, tags };
  }
}

const seed = [
  {
    title: 'Welcome to mini-express 👋',
    body: 'Every request on this page is handled by a framework written from scratch: router, middleware pipeline, body parsing, static files and error handling.',
    tags: ['intro'],
    pinned: true,
  },
  {
    title: 'How routing works',
    body: 'Paths like /api/notes/:id compile to a RegExp. The router walks its stack of layers and calls next() to move on.',
    tags: ['internals', 'router'],
  },
  {
    title: 'Try the API console',
    body: 'Send GET, POST, PATCH and DELETE requests below and inspect the status, headers and timing.',
    tags: ['demo'],
  },
];

module.exports = { NotesStore, seed };
