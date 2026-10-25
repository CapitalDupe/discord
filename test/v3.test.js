// Run with: node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const V3 = require('../v3.js');

test('mapMessage maps the server shape to the UI shape', () => {
  const m = V3.mapMessage({ id: 'M1', channelId: 'C1', author: { id: 'U1', displayName: 'Ada', accentColor: '#112233' }, content: 'hi', createdAt: '2026-10-25T10:00:00.000Z', editedAt: '2026-10-25T10:01:00.000Z', nonce: 'n1' }, 'U9');
  assert.equal(m.uid, 'U1'); assert.equal(m.name, 'Ada'); assert.equal(m.color, '#112233');
  assert.equal(m.text, 'hi'); assert.equal(m.edited, 1); assert.equal(m.nonce, 'n1');
  assert.equal(m.ts, Date.parse('2026-10-25T10:00:00.000Z'));
});

test('mapMessage handles a deleted author and a deleted message', () => {
  const m = V3.mapMessage({ id: 'M2', author: null, content: 'secret', createdAt: '2026-10-25T10:00:00Z', deletedAt: '2026-10-25T11:00:00Z' }, 'U9');
  assert.equal(m.name, 'Deleted user'); assert.equal(m.uid, null);
  assert.equal(m.deleted, 1); assert.equal(m.text, '');
});

test('reactions keep the count and mark my own reaction', () => {
  const m = V3.mapMessage({ id: 'M3', createdAt: '2026-10-25T10:00:00Z', content: 'x', reactions: [{ emoji: '👍', count: 3, me: true }, { emoji: '❤️', count: 2, me: false }] }, 'U9');
  assert.equal(m.r['👍'].length, 3); assert.ok(m.r['👍'].includes('U9'));
  assert.equal(m.r['❤️'].length, 2); assert.ok(!m.r['❤️'].includes('U9'));
});

test('hostile reaction keys are dropped (no prototype pollution)', () => {
  const m = V3.mapMessage({ id: 'M4', createdAt: '2026-10-25T10:00:00Z', content: 'x', reactions: [{ emoji: '__proto__', count: 1 }, { emoji: 'constructor', count: 1 }, { emoji: 'x'.repeat(40), count: 1 }] }, 'U9');
  assert.equal(m.r, undefined);
  assert.equal({}.polluted, undefined);
});

test('mapChannel keeps text and voice, hides unsupported types', () => {
  assert.deepEqual(V3.mapChannel({ id: 'C1', name: 'general', type: 'TEXT' }), { id: 'C1', name: 'general', type: 'text' });
  assert.equal(V3.mapChannel({ id: 'C2', name: 'lounge', type: 'VOICE' }).type, 'voice');
  assert.equal(V3.mapChannel({ id: 'C3', name: 'forum', type: 'FORUM' }), null);
  assert.equal(V3.mapChannel({ id: 'C4', name: 'dm', type: 'DM' }), null);
});

test('colorOf falls back for bad colours', () => {
  assert.equal(V3.colorOf({ accentColor: 'red' }), '#949ba4');
  assert.equal(V3.colorOf({ accentColor: '#AABBCC' }), '#AABBCC');
  assert.equal(V3.colorOf(null), '#949ba4');
});

test('mapMember prefers the nickname', () => {
  const m = V3.mapMember({ userId: 'U2', nickname: 'Nick', user: { displayName: 'Real', isBot: true }, status: 'ONLINE' });
  assert.equal(m.name, 'Nick'); assert.equal(m.bot, true); assert.equal(m.status, 'ONLINE');
});

test('leadingZeroBits counts across bytes', () => {
  assert.equal(V3.leadingZeroBits(new Uint8Array([0, 0, 0x10])), 19);
  assert.equal(V3.leadingZeroBits(new Uint8Array([0x80])), 0);
  assert.equal(V3.leadingZeroBits(new Uint8Array([0x01])), 7);
});

test('solveChallenge finds a valid proof of work', async () => {
  const ch = { id: 'c1', salt: 'abc123', difficulty: 12 };
  const n = await V3.solve ? 0 : 0; // placeholder to keep node:test happy about unused exports
  const sol = await V3.solveChallenge(ch);
  const h = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(ch.salt + ':' + sol)));
  assert.ok(V3.leadingZeroBits(h) >= 12);
});
