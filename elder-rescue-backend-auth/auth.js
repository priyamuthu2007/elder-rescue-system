// auth.js
// Password hashing using Node's BUILT-IN crypto module (scrypt) — no
// extra dependency, no native compilation, works the same way bcrypt
// would conceptually: a random salt per password, a slow hash function
// that resists brute-forcing, and a constant-time comparison on verify.

const crypto = require('crypto');

function createSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Returns a string like "salt:hash" — store this whole string.
function hashPassword(password){
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

// Compares a plain password against a stored "salt:hash" string.
// Returns true/false. Uses timingSafeEqual to avoid leaking info
// via response-time differences.
function verifyPassword(password, stored){
  if(!stored || !stored.includes(':')) return false;
  const [salt, originalHash] = stored.split(':');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(originalHash, 'hex');
  if(a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { hashPassword, verifyPassword, createSessionToken, hashSessionToken };
