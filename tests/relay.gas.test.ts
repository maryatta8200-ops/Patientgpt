/**
 * Apps Script relay tests.
 *
 * Code.gs is loaded into a fake Apps Script runtime and driven over the real
 * `doPost` entry point, so these cover the protocol exactly as the PWA uses it:
 * register → ask → (agent answers) → poll → ack → burned.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { loadGas, SHEETS, type GasHarness } from './helpers/gas';

const DEVICE = '11111111-2222-4333-8444-555555555555';
const OTHER_DEVICE = '99999999-8888-4777-8666-555555555555';
const ADMIN_KEY = 'test-admin-key-abcdefghijklmnop';

let gas: GasHarness;

function register(alias = 'Tester', deviceId = DEVICE) {
  const res = gas.post({ action: 'register', deviceId, alias });
  return res;
}

/** Clears the inter-ask throttle so a test can send several questions. */
function clearThrottle() {
  const registry = gas.ss.sheet(SHEETS.registry);
  for (let i = 1; i < registry.rows.length; i++) {
    registry.rows[i][9] = 0; // lastAskAt
    registry.rows[i][5] = 0; // asksToday
    registry.rows[i][6] = ''; // dayKey
  }
}

function ask(token: string, text: string, deviceId = DEVICE) {
  return gas.post({
    action: 'ask',
    deviceId,
    token,
    localId: 'local-1',
    threadId: 'thread-1',
    text,
  });
}

beforeEach(() => {
  gas = loadGas();
  gas.props.set('ADMIN_KEY', ADMIN_KEY);
  gas.props.set('TTL_MINUTES', '15');
  gas.api.setupPulse();
});

/* ------------------------------------------------------------------ setup */

describe('setup', () => {
  it('creates the three sheets with headers', () => {
    for (const name of [SHEETS.registry, SHEETS.mailbox, SHEETS.log]) {
      const sheet = gas.ss.sheet(name);
      expect(sheet.rows.length).toBeGreaterThanOrEqual(1);
      expect(sheet.rows[0].length).toBeGreaterThan(0);
      expect(sheet.frozen).toBe(1);
    }
  });

  it('seeds the configured wording and admin key', () => {
    expect(gas.props.get('ADMIN_KEY')).toBeTruthy();
    expect(gas.props.get('AUTO_ACK_TEXT')).toBe('Our team is working on your question.');
    expect(gas.props.get('NUDGE_TEXT')).toContain('Still on it');
    expect(gas.props.get('ESCALATE_TEXT')).toContain('longer than expected');
  });
});

/* ------------------------------------------------------------- registration */

describe('register', () => {
  it('issues a token and stores only its hash', () => {
    const res = register('Ali');
    expect(res.ok).toBe(true);
    expect(typeof res.token).toBe('string');
    expect((res.token as string).length).toBeGreaterThan(32);

    const [row] = gas.table(SHEETS.registry);
    expect(row.deviceId).toBe(DEVICE);
    expect(row.alias).toBe('Ali');
    expect(row.status).toBe('active');
    // The plaintext token must never appear anywhere in the sheet.
    expect(JSON.stringify(gas.ss.sheet(SHEETS.registry).rows)).not.toContain(res.token);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(gas.ss.sheet(SHEETS.registry).rows[0]).toContain('lastAskAt');
  });

  it('rejects an invalid device id', () => {
    const res = gas.post({ action: 'register', deviceId: 'not-a-uuid', alias: 'x' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Invalid device id');
  });

  it('sanitises a hostile alias', () => {
    register('<script>alert(1)</script>');
    const [row] = gas.table(SHEETS.registry);
    expect(String(row.alias)).not.toContain('<');
    expect(String(row.alias)).not.toContain('>');
  });

  it('falls back to Anonymous for an empty alias', () => {
    register('   ');
    expect(gas.table(SHEETS.registry)[0].alias).toBe('Anonymous');
  });

  it('re-registering the same device replaces its row instead of duplicating', () => {
    register('First');
    register('Second');
    const rows = gas.table(SHEETS.registry);
    expect(rows).toHaveLength(1);
    expect(rows[0].alias).toBe('Second');
  });
});

/* -------------------------------------------------------------- auth gates */

describe('authentication', () => {
  it('rejects a wrong token', () => {
    register();
    const res = ask('definitely-the-wrong-token-here', 'hello');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Invalid token');
  });

  it('rejects an unknown device', () => {
    const res = gas.post({
      action: 'poll',
      deviceId: OTHER_DEVICE,
      token: 'some-token-that-is-long-enough',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Unknown device');
  });

  it('rejects missing credentials', () => {
    expect(gas.post({ action: 'poll' }).error).toBe('Missing credentials');
    expect(gas.post({ action: 'poll', deviceId: DEVICE, token: 'short' }).error).toBe(
      'Missing credentials',
    );
  });

  it('rejects a revoked device', () => {
    const { token } = register();
    const registry = gas.ss.sheet(SHEETS.registry);
    registry.rows[1][7] = 'revoked';
    const res = ask(token as string, 'hello');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Device revoked');
  });
});

/* ------------------------------------------------------------ full lifecycle */

describe('burn-after-read lifecycle', () => {
  it('carries a question all the way through and burns it', () => {
    const { token } = register();
    const asked = ask(token as string, 'Does this survive the round trip?');
    expect(asked.ok).toBe(true);
    expect(asked.relayId).toMatch(/^r_/);

    // The relay echoes the operator's holding text so devices stay in sync.
    expect(asked.autoAck).toBe('Our team is working on your question.');
    expect(asked.nudge).toContain('Still on it');
    expect(asked.escalate).toContain('longer than expected');

    // A new row exists, unanswered.
    let rows = gas.table(SHEETS.mailbox);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('new');
    expect(rows[0].question).toBe('Does this survive the round trip?');

    // Nothing is deliverable before an answer exists.
    const beforeAnswer = gas.post({ action: 'poll', deviceId: DEVICE, token });
    expect(beforeAnswer.messages).toEqual([]);

    // The agent answers.
    const reply = gas.post({
      action: 'adminReply',
      adminKey: ADMIN_KEY,
      relayId: asked.relayId,
      answer: 'Yes.',
    });
    expect(reply.ok).toBe(true);

    // Now it is deliverable.
    const polled = gas.post({ action: 'poll', deviceId: DEVICE, token });
    const messages = polled.messages as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      relayId: asked.relayId,
      messageId: 'local-1',
      threadId: 'thread-1',
      answer: 'Yes.',
    });

    // Acknowledge → the row is destroyed.
    const acked = gas.post({
      action: 'ack',
      deviceId: DEVICE,
      token,
      relayIds: [asked.relayId],
    });
    expect(acked.deleted).toBe(1);
    expect(gas.table(SHEETS.mailbox)).toHaveLength(0);

    // And nothing comes back afterwards.
    const after = gas.post({ action: 'poll', deviceId: DEVICE, token });
    expect(after.messages).toEqual([]);
  });

  it('keeps one device from reading another device answer', () => {
    const a = register('A', DEVICE);
    const b = register('B', OTHER_DEVICE);

    const asked = ask(a.token as string, 'secret question', DEVICE);
    gas.post({
      action: 'adminReply',
      adminKey: ADMIN_KEY,
      relayId: asked.relayId,
      answer: 'secret answer',
    });

    const bPoll = gas.post({ action: 'poll', deviceId: OTHER_DEVICE, token: b.token });
    expect(bPoll.messages).toEqual([]);

    // Device B cannot burn device A's row either.
    const bAck = gas.post({
      action: 'ack',
      deviceId: OTHER_DEVICE,
      token: b.token,
      relayIds: [asked.relayId],
    });
    expect(bAck.deleted).toBe(0);
    expect(gas.table(SHEETS.mailbox)).toHaveLength(1);
  });

  it('only deletes the rows it was asked to delete', () => {
    const { token } = register();
    const first = ask(token as string, 'first');
    clearThrottle();
    const second = ask(token as string, 'second');

    gas.post({ action: 'ack', deviceId: DEVICE, token, relayIds: [first.relayId] });
    const rows = gas.table(SHEETS.mailbox);
    expect(rows).toHaveLength(1);
    expect(rows[0].relayId).toBe(second.relayId);
  });
});

/* ---------------------------------------------------------------- validation */

describe('input validation', () => {
  it('caps an oversized question', () => {
    const { token } = register();
    const res = ask(token as string, 'x'.repeat(4001));
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Question too long');
  });

  it('accepts a question exactly at the limit', () => {
    const { token } = register();
    expect(ask(token as string, 'x'.repeat(4000)).ok).toBe(true);
  });

  it('rejects an empty question', () => {
    const { token } = register();
    expect(ask(token as string, '   ').error).toBe('Empty question');
  });

  it('enforces the daily ask limit', () => {
    const { token } = register();
    const registry = gas.ss.sheet(SHEETS.registry);
    registry.rows[1][5] = 200; // asksToday
    registry.rows[1][6] = new Date().toISOString().slice(0, 10); // dayKey = today

    const res = ask(token as string, 'one too many');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Daily limit reached');
  });

  // Regression: lastSeen was shared with the throttle, so a routine poll or ping
  // refreshed it and the next question was rejected with "Slow down".
  it('does not let polling or pinging throttle the next question', () => {
    const { token } = register();
    expect(gas.post({ action: 'ping', deviceId: DEVICE, token }).ok).toBe(true);
    expect(gas.post({ action: 'poll', deviceId: DEVICE, token }).ok).toBe(true);
    const res = ask(token as string, 'sent right after a poll');
    expect(res.ok).toBe(true);
  });

  it('enforces the minimum gap between asks', () => {
    const { token } = register();
    expect(ask(token as string, 'first').ok).toBe(true);
    const second = ask(token as string, 'immediately after');
    expect(second.ok).toBe(false);
    expect(second.error).toBe('Slow down');
  });
});

/* ---------------------------------------------------------------- admin gate */

describe('admin', () => {
  // Regression: isAdmin_ was referenced but never defined, so every admin call
  // threw and returned "Relay error" — the Agent Console was entirely broken.
  it('accepts the configured key', () => {
    const res = gas.post({ action: 'adminInbox', adminKey: ADMIN_KEY });
    expect(res.ok).toBe(true);
    expect(res.questions).toEqual([]);
  });

  it('refuses an inbox read with the wrong key', () => {
    expect(gas.post({ action: 'adminInbox', adminKey: 'wrong' }).error).toBe('Unauthorized');
    expect(gas.post({ action: 'adminInbox' }).error).toBe('Unauthorized');
  });

  it('refuses an answer with the wrong key', () => {
    const { token } = register();
    const asked = ask(token as string, 'q');
    const res = gas.post({
      action: 'adminReply',
      adminKey: 'wrong',
      relayId: asked.relayId,
      answer: 'a',
    });
    expect(res.error).toBe('Unauthorized');
    expect(gas.table(SHEETS.mailbox)[0].status).toBe('new');
  });

  it('lists pending questions newest first with aliases', () => {
    const { token } = register('Alice');
    ask(token as string, 'older question');
    const inbox = gas.post({ action: 'adminInbox', adminKey: ADMIN_KEY });
    const questions = inbox.questions as Array<Record<string, unknown>>;
    expect(questions).toHaveLength(1);
    expect(questions[0].alias).toBe('Alice');
    expect(questions[0].question).toBe('older question');
    expect(questions[0].status).toBe('new');
  });

  it('reports a missing question rather than failing silently', () => {
    register();
    const res = gas.post({
      action: 'adminReply',
      adminKey: ADMIN_KEY,
      relayId: 'r_nope',
      answer: 'a',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('No such question');
  });

  it('rejects an empty answer', () => {
    const { token } = register();
    const asked = ask(token as string, 'q');
    const res = gas.post({
      action: 'adminReply',
      adminKey: ADMIN_KEY,
      relayId: asked.relayId,
      answer: '   ',
    });
    expect(res.ok).toBe(false);
  });
});

/* -------------------------------------------------------------------- purge */

describe('expiry', () => {
  it('keeps fresh rows', () => {
    const { token } = register();
    ask(token as string, 'fresh');
    gas.api.purgeExpired();
    expect(gas.table(SHEETS.mailbox)).toHaveLength(1);
  });

  it('deletes rows past their TTL', () => {
    const { token } = register();
    ask(token as string, 'stale');
    const mailbox = gas.ss.sheet(SHEETS.mailbox);
    mailbox.rows[1][9] = Date.now() - 1000; // expiresAt in the past

    gas.api.purgeExpired();
    expect(gas.table(SHEETS.mailbox)).toHaveLength(0);
  });

  it('never leaves a row behind with more than one sweep', () => {
    const { token } = register();
    for (let i = 0; i < 5; i++) {
      clearThrottle();
      expect(ask(token as string, `q${i}`).ok).toBe(true);
    }
    const mailbox = gas.ss.sheet(SHEETS.mailbox);
    expect(mailbox.getLastRow() - 1).toBe(5);
    for (let i = 1; i < mailbox.rows.length; i++) mailbox.rows[i][9] = Date.now() - 1;

    gas.api.purgeExpired();
    expect(mailbox.getLastRow()).toBe(1); // header only
  });

  it('drops a question that was never answerable after 24 hours', () => {
    const { token } = register();
    ask(token as string, 'forgotten');
    const mailbox = gas.ss.sheet(SHEETS.mailbox);
    mailbox.rows[1][9] = 0; // no expiry recorded
    mailbox.rows[1][7] = Date.now() - 25 * 60 * 60 * 1000; // created 25h ago

    gas.api.purgeExpired();
    expect(gas.table(SHEETS.mailbox)).toHaveLength(0);
  });
});

/* --------------------------------------------------------------- deregister */

describe('deregister', () => {
  it('removes the device and everything it left behind', () => {
    const { token } = register();
    ask(token as string, 'to be removed');
    expect(gas.table(SHEETS.registry)).toHaveLength(1);
    expect(gas.table(SHEETS.mailbox)).toHaveLength(1);

    const res = gas.post({ action: 'deregister', deviceId: DEVICE, token });
    expect(res.ok).toBe(true);
    expect(gas.table(SHEETS.registry)).toHaveLength(0);
    expect(gas.table(SHEETS.mailbox)).toHaveLength(0);

    // The token is now worthless.
    expect(ask(token as string, 'still there?').error).toBe('Unknown device');
  });
});

/* --------------------------------------------------------------- robustness */

describe('robustness', () => {
  it('rejects an unknown action without throwing', () => {
    const res = gas.post({ action: 'dropSpreadsheet' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Unknown action');
  });

  it('returns JSON from doGet for a browser health visit', () => {
    const out = gas.api.doGet();
    const body = JSON.parse(out.content);
    expect(body.ok).toBe(true);
    expect(body.service).toBe('pulse-relay');
  });

  it('survives a malformed body', () => {
    const res = gas.api.doPost({ postData: { contents: '{not json' } });
    const body = JSON.parse(res.content);
    expect(body.ok).toBe(false);
  });

  it('survives a missing body', () => {
    const res = gas.api.doPost({});
    expect(JSON.parse(res.content).ok).toBe(false);
  });

  it('reports health with the configured wording', () => {
    const health = gas.post({ action: 'health' });
    expect(health.ok).toBe(true);
    expect(health.ttlMinutes).toBe(15);
    expect(health.autoAck).toBe('Our team is working on your question.');
  });

  it('never writes question content to the log sheet', () => {
    const { token } = register();
    ask(token as string, 'HIGHLY-SENSITIVE-QUESTION-TEXT');
    const logDump = JSON.stringify(gas.ss.sheet(SHEETS.log).rows);
    expect(logDump).not.toContain('HIGHLY-SENSITIVE-QUESTION-TEXT');
  });

  it('clamps a nonsense TTL back to the default', () => {
    gas.props.set('TTL_MINUTES', '99999');
    expect(gas.api.ttlMinutes_()).toBe(15);
    gas.props.set('TTL_MINUTES', '5');
    expect(gas.api.ttlMinutes_()).toBe(5);
  });
});
