/**
 * Sandbox relay integration — the demo driver the app ships with.
 *
 * This is the only driver exercised end to end in this repository, so it proves
 * the transport contract the Google Apps Script driver must also satisfy.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as db from '../src/lib/db';
import { SandboxRelay, makeRelay } from '../src/lib/relay';

let relay: SandboxRelay;

beforeEach(async () => {
  // Real timers first: IndexedDB schedules through setTimeout/setImmediate.
  await db.wipeAll();
  // Only Date is faked — the sandbox decides "time to answer" from Date.now(),
  // so we can age a question without freezing the storage layer.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-05-01T10:00:00Z'));
  relay = new SandboxRelay();
});

/** Moves the clock forward by `ms` without touching real timers. */
function advance(ms: number) {
  vi.setSystemTime(new Date(Date.now() + ms));
}

afterEach(() => {
  vi.useRealTimers();
});

const creds = { deviceId: 'dev', token: 'tok' };

describe('sandbox lifecycle', () => {
  it('issues a token on registration', async () => {
    const { token } = await relay.register({ deviceId: 'dev', alias: 'Ali' });
    expect(token).toMatch(/^sandbox_/);
  });

  it('does not answer instantly — the wait is part of the experience', async () => {
    const { relayId } = await relay.ask({ ...creds, localId: 'm1', threadId: 't1', text: 'hi' });
    expect(relayId).toMatch(/^sbx_/);

    expect(await relay.poll(creds)).toEqual([]);

    advance(2_000);
    expect(await relay.poll(creds)).toEqual([]);
  });

  it('answers after the simulated delay and delivers the right message', async () => {
    const { relayId } = await relay.ask({
      ...creds,
      localId: 'm1',
      threadId: 't1',
      text: 'How does this work?',
    });

    advance(3_000);
    const replies = await relay.poll(creds);

    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({
      relayId,
      messageId: 'm1',
      threadId: 't1',
    });
    expect(replies[0].answer.length).toBeGreaterThan(20);
  });

  it('burns the row on ack, so it is delivered exactly once', async () => {
    const { relayId } = await relay.ask({ ...creds, localId: 'm1', threadId: 't1', text: 'hi' });
    advance(3_000);

    const first = await relay.poll(creds);
    expect(first).toHaveLength(1);

    await relay.ack({ ...creds, relayIds: [relayId] });

    // Burned: nothing to steal afterwards.
    expect(await relay.poll(creds)).toEqual([]);
    const pending = await relay.ping(creds);
    expect(pending.pending).toBe(0);
  });

  it('keeps unanswered questions pending across polls', async () => {
    await relay.ask({ ...creds, localId: 'm1', threadId: 't1', text: 'hi' });
    expect((await relay.ping(creds)).pending).toBe(1);
    expect(await relay.poll(creds)).toEqual([]);
    expect((await relay.ping(creds)).pending).toBe(1);
  });

  it('reports a real server time', async () => {
    const { serverTime } = await relay.ping(creds);
    expect(serverTime).toBe(Date.now());
  });
});

describe('sandbox admin', () => {
  it('lists pending questions', async () => {
    await relay.ask({ ...creds, localId: 'm1', threadId: 't1', text: 'first' });
    const inbox = await relay.adminInbox('any-key');
    expect(inbox).toHaveLength(1);
    expect(inbox[0].question).toBe('first');
    expect(inbox[0].status).toBe('new');
  });

  it('lets an agent answer, which the client then receives', async () => {
    const { relayId } = await relay.ask({
      ...creds,
      localId: 'm1',
      threadId: 't1',
      text: 'hi',
    });
    await relay.adminReply({ adminKey: 'k', relayId, answer: 'Written by hand.' });

    const replies = await relay.poll(creds);
    expect(replies).toHaveLength(1);
    expect(replies[0].answer).toBe('Written by hand.');
  });

  it('ignores a reply for an unknown question', async () => {
    await expect(
      relay.adminReply({ adminKey: 'k', relayId: 'nope', answer: 'x' }),
    ).resolves.toBeUndefined();
    expect(await relay.poll(creds)).toEqual([]);
  });
});

describe('sandbox deregister', () => {
  it('drops everything it was holding', async () => {
    await relay.ask({ ...creds, localId: 'm1', threadId: 't1', text: 'hi' });
    await relay.deregister(creds);
    expect((await relay.ping(creds)).pending).toBe(0);
    expect(await relay.adminInbox('k')).toEqual([]);
  });
});

describe('driver selection', () => {
  it('uses the sandbox when the mode is on, even with a url set', () => {
    expect(makeRelay({ relayUrl: 'https://script.google.com/x/exec', sandbox: true }).kind).toBe(
      'sandbox',
    );
  });

  it('uses the real relay when configured and sandbox is off', () => {
    expect(makeRelay({ relayUrl: 'https://script.google.com/x/exec', sandbox: false }).kind).toBe(
      'gas',
    );
  });

  it('falls back to the sandbox when no url is set, so the app always works', () => {
    expect(makeRelay({ relayUrl: '   ', sandbox: false }).kind).toBe('sandbox');
  });
});
