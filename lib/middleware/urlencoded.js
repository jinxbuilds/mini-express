'use strict';

const bodyParser = require('./read-body');
const { parseQuery } = require('../utils');

/** Parse HTML form posts (`application/x-www-form-urlencoded`) into req.body. */
function urlencoded({ limit = '100kb' } = {}) {
  return bodyParser({
    limit,
    matches: (type) => type === 'application/x-www-form-urlencoded',
    parse: (raw) => ({ ...parseQuery(raw) }),
  });
}

module.exports = urlencoded;
