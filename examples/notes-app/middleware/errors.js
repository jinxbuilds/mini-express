'use strict';

/** 404 for any /api path no route claimed. */
function notFound(req, res) {
  res.status(404).json({
    error: { status: 404, message: `No route for ${req.method} ${req.originalUrl}`, requestId: req.id },
  });
}

/**
 * Central JSON error handler. Four arguments is what marks it as an error
 * handler — the router only calls it when something passed an error to next().
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  const expose = status < 500 || req.app.get('env') !== 'production';

  if (status >= 500 && req.app.get('env') !== 'test') console.error(err);

  res.status(status).json({
    error: {
      status,
      message: expose ? err.message : 'Internal Server Error',
      ...(err.details && { details: err.details }),
      requestId: req.id,
    },
  });
}

module.exports = { notFound, errorHandler };
