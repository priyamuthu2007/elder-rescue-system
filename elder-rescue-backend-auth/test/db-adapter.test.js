const assert = require('node:assert/strict');
const { test } = require('node:test');

const db = require('../db');

test('database adapter exposes a stable local adapter contract', () => {
  assert.equal(typeof db.exec, 'function');
  assert.equal(typeof db.prepare, 'function');
  assert.equal(db.isPostgres, false);
});
