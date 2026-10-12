'use strict';

const express = require('../../..');

/** Validate a note payload. `partial` allows PATCH bodies with a subset of fields. */
function validate(body, { partial = false } = {}) {
  const errors = [];
  const out = {};

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: ['Body must be a JSON object'] };
  }

  if (body.title !== undefined || !partial) {
    if (typeof body.title !== 'string' || !body.title.trim()) errors.push('title is required');
    else if (body.title.length > 120) errors.push('title must be at most 120 characters');
    else out.title = body.title.trim();
  }
  if (body.body !== undefined) {
    if (typeof body.body !== 'string') errors.push('body must be a string');
    else if (body.body.length > 5000) errors.push('body must be at most 5000 characters');
    else out.body = body.body;
  }
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || !body.tags.every((t) => typeof t === 'string')) {
      errors.push('tags must be an array of strings');
    } else {
      out.tags = [...new Set(body.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 10);
    }
  }
  if (body.pinned !== undefined) {
    if (typeof body.pinned !== 'boolean') errors.push('pinned must be a boolean');
    else out.pinned = body.pinned;
  }
  return { errors, data: out };
}

function validationError(errors) {
  const err = new Error('Validation failed');
  err.status = 422;
  err.details = errors;
  return err;
}

/** Build the /api/notes router around a store. */
function notesRouter(store) {
  const router = express.Router();

  // Runs for every route with an :id — loads the note or 404s once, up front.
  router.param('id', async (req, res, next, id) => {
    const note = await store.get(id);
    if (!note) {
      const err = new Error(`Note '${id}' not found`);
      err.status = 404;
      return next(err);
    }
    req.note = note;
    next();
  });

  router.route('/')
    .get(async (req, res) => {
      const { q, tag } = req.query;
      const notes = await store.list({ q, tag });
      res.json({ count: notes.length, notes });
    })
    .post(async (req, res) => {
      const { errors, data } = validate(req.body);
      if (errors.length) throw validationError(errors);
      const note = await store.create(data);
      res.status(201).location(`${req.baseUrl}/${note.id}`).json(note);
    });

  router.get('/stats', async (req, res) => {
    res.json(await store.stats());
  });

  router.route('/:id')
    .get((req, res) => res.json(req.note))
    .patch(async (req, res) => {
      const { errors, data } = validate(req.body, { partial: true });
      if (errors.length) throw validationError(errors);
      res.json(await store.update(req.note.id, data));
    })
    .delete(async (req, res) => {
      await store.remove(req.note.id);
      res.status(204).end();
    });

  return router;
}

module.exports = notesRouter;
