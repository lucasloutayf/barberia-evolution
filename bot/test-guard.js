import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as guard from './guard.js';
import { normalizePhoneToJid } from './state.js';

// guard.js uses module-level Maps/Sets. _reset() clears all state between tests.

describe('sanitizeText', () => {
  test('passes through short text unchanged', () => {
    assert.equal(guard.sanitizeText('hola'), 'hola');
  });

  test('truncates at 1000 chars', () => {
    const result = guard.sanitizeText('a'.repeat(1500));
    assert.equal(result.length, 1000);
    assert.equal(result, 'a'.repeat(1000));
  });

  test('coerces null to empty string', () => {
    assert.equal(guard.sanitizeText(null), '');
  });

  test('coerces undefined to empty string', () => {
    assert.equal(guard.sanitizeText(undefined), '');
  });
});

describe('blocklist', () => {
  beforeEach(() => guard._reset());

  test('new JID is not blocked', () => {
    assert.equal(guard.isBlocked('5491111111111@s.whatsapp.net'), false);
  });

  test('blockJid makes isBlocked return true', () => {
    guard.blockJid('5491111111111@s.whatsapp.net');
    assert.equal(guard.isBlocked('5491111111111@s.whatsapp.net'), true);
  });

  test('unblockJid removes the block', () => {
    guard.blockJid('5491111111111@s.whatsapp.net');
    guard.unblockJid('5491111111111@s.whatsapp.net');
    assert.equal(guard.isBlocked('5491111111111@s.whatsapp.net'), false);
  });

  test('listBlocked returns each entry with jid and blockedAt', () => {
    guard.blockJid('5491111111111@s.whatsapp.net');
    guard.blockJid('5492222222222@s.whatsapp.net');
    const list = guard.listBlocked();
    assert.equal(list.length, 2);
    assert.ok(list.every(e => typeof e.jid === 'string' && typeof e.blockedAt === 'string'));
  });
});

describe('check — blocked', () => {
  beforeEach(() => guard._reset());

  test('blocked JID returns allowed=false reason=blocked', () => {
    guard.blockJid('5491111111111@s.whatsapp.net');
    const r = guard.check('5491111111111@s.whatsapp.net', 'hola');
    assert.equal(r.allowed, false);
    assert.equal(r.reason, 'blocked');
  });

  test('blocked JID returns firstOffense=false', () => {
    guard.blockJid('5491111111111@s.whatsapp.net');
    const r = guard.check('5491111111111@s.whatsapp.net', 'hola');
    assert.equal(r.firstOffense, false);
  });
});

describe('check — burst rate limit (3 msgs / 10s)', () => {
  beforeEach(() => guard._reset());

  test('first 3 messages are allowed', () => {
    const jid = '5491111111111@s.whatsapp.net';
    for (let i = 0; i < 3; i++) {
      const r = guard.check(jid, 'hola');
      assert.equal(r.allowed, true, `message ${i + 1} should be allowed`);
      guard.queueDecrement(jid); // keep queue depth at 0
    }
  });

  test('4th message within 10s is blocked with reason=rate_limit', () => {
    const jid = '5491111111111@s.whatsapp.net';
    for (let i = 0; i < 3; i++) {
      guard.check(jid, 'x');
      guard.queueDecrement(jid);
    }
    const r = guard.check(jid, 'x');
    assert.equal(r.allowed, false);
    assert.equal(r.reason, 'rate_limit');
  });

  test('first rate-limit violation returns firstOffense=true', () => {
    const jid = '5491111111111@s.whatsapp.net';
    for (let i = 0; i < 3; i++) { guard.check(jid, 'x'); guard.queueDecrement(jid); }
    const r = guard.check(jid, 'x');
    assert.equal(r.firstOffense, true);
  });

  test('second rate-limit violation returns firstOffense=false', () => {
    const jid = '5491111111111@s.whatsapp.net';
    for (let i = 0; i < 3; i++) { guard.check(jid, 'x'); guard.queueDecrement(jid); }
    guard.check(jid, 'x'); // first offense — marks warnedRateLimit
    const r = guard.check(jid, 'x');
    assert.equal(r.firstOffense, false);
  });
});

describe('check — queue full', () => {
  beforeEach(() => guard._reset());

  // _setQueueDepth is a test helper that bypasses check() to seed queue depth
  // directly — necessary because the burst limit (3/10s) fires before we can
  // naturally accumulate 4 queue entries within a single 10s window.

  test('blocks when queue depth is already at max (4)', () => {
    const jid = '5491111111111@s.whatsapp.net';
    guard._setQueueDepth(jid, 4);
    const r = guard.check(jid, 'hola');
    assert.equal(r.allowed, false);
    assert.equal(r.reason, 'queue_full');
  });

  test('first queue-full violation returns firstOffense=true', () => {
    const jid = '5491111111111@s.whatsapp.net';
    guard._setQueueDepth(jid, 4);
    const r = guard.check(jid, 'hola');
    assert.equal(r.firstOffense, true);
  });

  test('second queue-full violation returns firstOffense=false', () => {
    const jid = '5491111111111@s.whatsapp.net';
    guard._setQueueDepth(jid, 4);
    guard.check(jid, 'hola'); // first offense — marks warnedQueueFull
    guard._setQueueDepth(jid, 4); // re-fill queue (queue_full doesn't increment)
    const r = guard.check(jid, 'hola');
    assert.equal(r.firstOffense, false);
  });

  test('queueDecrement below max re-allows entry', () => {
    const jid = '5491111111111@s.whatsapp.net';
    guard._setQueueDepth(jid, 4);
    guard.queueDecrement(jid); // depth → 3
    const r = guard.check(jid, 'hola');
    assert.equal(r.allowed, true);
    guard.queueDecrement(jid);
  });
});

describe('check — sanitization on allowed message', () => {
  beforeEach(() => guard._reset());

  test('returns original text when within limit', () => {
    const r = guard.check('5491111111111@s.whatsapp.net', 'hola mundo');
    assert.equal(r.allowed, true);
    assert.equal(r.text, 'hola mundo');
  });

  test('truncates text over 1000 chars', () => {
    const r = guard.check('5491111111111@s.whatsapp.net', 'z'.repeat(2000));
    assert.equal(r.allowed, true);
    assert.equal(r.text.length, 1000);
  });
});

describe('normalizePhoneToJid', () => {
  test('10-digit number gets 549 prefix and @s.whatsapp.net suffix', () => {
    assert.equal(normalizePhoneToJid('3513042203'), '5493513042203@s.whatsapp.net');
  });

  test('full international number is normalized', () => {
    assert.equal(normalizePhoneToJid('+54 9 351 304 2203'), '5493513042203@s.whatsapp.net');
  });

  test('returns null for non-phone input', () => {
    assert.equal(normalizePhoneToJid('abc'), null);
    assert.equal(normalizePhoneToJid(''), null);
    assert.equal(normalizePhoneToJid(null), null);
  });
});
