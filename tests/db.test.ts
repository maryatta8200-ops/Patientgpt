/**
 * Local storage tests — run against a real IndexedDB implementation
 * (fake-indexeddb), so transactions, indexes and upgrades are exercised.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as db from '../src/lib/db';
import type { Message, Thread } from '../src/lib/types';

function thread(id: string, updatedAt = 1): Thread {
  return { id, title: `Thread ${id}`, createdAt: 1, updatedAt, unread: 0, archived: false };
}

function message(over: Partial<Message> & { id: string; threadId: string }): Message {
  return {
    role: 'user',
    text: 'hello',
    createdAt: 1,
    status: 'queued',
    ...over,
  };
}

beforeEach(async () => {
  // One shared connection for the run; start every test from a clean slate.
  await db.wipeAll();
});

describe('key/value store', () => {
  it('round-trips an object', async () => {
    await db.kvSet('identity', { deviceId: 'abc', token: 'secret' });
    expect(await db.kvGet<{ deviceId: string }>('identity')).toMatchObject({ deviceId: 'abc' });
  });

  it('returns undefined for a missing key', async () => {
    expect(await db.kvGet('nope')).toBeUndefined();
  });

  it('deletes', async () => {
    await db.kvSet('k', 1);
    await db.kvDelete('k');
    expect(await db.kvGet('k')).toBeUndefined();
  });
});

describe('threads', () => {
  it('sorts newest activity first', async () => {
    await db.putThread(thread('a', 10));
    await db.putThread(thread('b', 30));
    await db.putThread(thread('c', 20));
    expect((await db.allThreads()).map((t) => t.id)).toEqual(['b', 'c', 'a']);
  });

  it('updates in place rather than duplicating', async () => {
    await db.putThread(thread('a', 1));
    await db.putThread({ ...thread('a', 2), unread: 4 });
    const all = await db.allThreads();
    expect(all).toHaveLength(1);
    expect(all[0].unread).toBe(4);
  });
});

describe('messages', () => {
  it('returns a thread in chronological order regardless of insert order', async () => {
    await db.putMessage(message({ id: 'm3', threadId: 't1', createdAt: 300 }));
    await db.putMessage(message({ id: 'm1', threadId: 't1', createdAt: 100 }));
    await db.putMessage(message({ id: 'm2', threadId: 't1', createdAt: 200 }));
    expect((await db.messagesFor('t1')).map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('keeps threads separate', async () => {
    await db.putMessage(message({ id: 'a', threadId: 't1' }));
    await db.putMessage(message({ id: 'b', threadId: 't2' }));
    expect(await db.messagesFor('t1')).toHaveLength(1);
    expect(await db.messagesFor('t2')).toHaveLength(1);
    expect(await db.messagesFor('t3')).toEqual([]);
  });

  it('finds only messages still awaiting an answer', async () => {
    await db.putMessage(message({ id: 'a', threadId: 't1', status: 'awaiting', relayId: 'r1' }));
    await db.putMessage(message({ id: 'b', threadId: 't1', status: 'delivered' }));
    await db.putMessage(message({ id: 'c', threadId: 't1', status: 'awaiting' })); // no relayId
    const awaiting = await db.awaitingMessages();
    expect(awaiting.map((m) => m.id)).toEqual(['a']);
  });

  it('finds messages queued for the relay, oldest first', async () => {
    await db.putMessage(message({ id: 'b', threadId: 't1', status: 'queued', createdAt: 20 }));
    await db.putMessage(message({ id: 'a', threadId: 't1', status: 'queued', createdAt: 10 }));
    await db.putMessage(message({ id: 'c', threadId: 't1', status: 'delivered' }));
    expect((await db.queuedMessages()).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('preserves optional fields through a round trip', async () => {
    const original = message({
      id: 'x',
      threadId: 't1',
      status: 'failed',
      error: 'relay unreachable',
      nudgeStage: 2,
      auto: true,
      autoKind: 'escalate',
      forMessageId: 'parent',
    });
    await db.putMessage(original);
    expect(await db.getMessage('x')).toEqual(original);
  });
});

describe('deletion', () => {
  it('removes a thread and every message inside it', async () => {
    await db.putThread(thread('t1'));
    await db.putThread(thread('t2'));
    await db.putMessage(message({ id: 'a', threadId: 't1' }));
    await db.putMessage(message({ id: 'b', threadId: 't1' }));
    await db.putMessage(message({ id: 'c', threadId: 't2' }));

    await db.deleteThread('t1');

    expect((await db.allThreads()).map((t) => t.id)).toEqual(['t2']);
    expect(await db.messagesFor('t1')).toEqual([]);
    expect(await db.messagesFor('t2')).toHaveLength(1);
  });

  it('wipes everything', async () => {
    await db.kvSet('identity', { deviceId: 'x' });
    await db.putThread(thread('t1'));
    await db.putMessage(message({ id: 'a', threadId: 't1' }));

    await db.wipeAll();

    expect(await db.kvGet('identity')).toBeUndefined();
    expect(await db.allThreads()).toEqual([]);
    expect(await db.allMessages()).toEqual([]);
  });
});

describe('footprint and export', () => {
  it('reports counts and a byte estimate', async () => {
    await db.putThread(thread('t1'));
    await db.putMessage(message({ id: 'a', threadId: 't1' }));
    await db.putMessage(message({ id: 'b', threadId: 't1' }));
    const footprint = await db.localFootprint();
    expect(footprint.threads).toBe(1);
    expect(footprint.messages).toBe(2);
    expect(footprint.bytes).toBeGreaterThan(0);
  });

  it('exports the full history readably', async () => {
    await db.kvSet('identity', {
      deviceId: 'dev-1',
      token: 'super-secret-token',
      alias: 'Ali',
      createdAt: 5,
      recoveryCode: 'AAAA-BBBB',
    });
    await db.kvSet('settings', { relayUrl: 'https://script.google.com/macros/s/SECRET/exec' });
    await db.putThread(thread('t1'));
    await db.putMessage(message({ id: 'a', threadId: 't1', text: 'my question' }));

    const parsed = JSON.parse(await db.exportEverything());
    expect(parsed.app).toBe('pulse');
    expect(parsed.format).toBe(1);
    expect(parsed.identity.deviceId).toBe('dev-1');
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0].text).toBe('my question');
  });

  it('never includes the relay token or the raw relay URL in an export', async () => {
    await db.kvSet('identity', { deviceId: 'dev-1', token: 'super-secret-token', alias: 'A' });
    await db.kvSet('settings', { relayUrl: 'https://script.google.com/macros/s/SECRET/exec' });

    const raw = await db.exportEverything();
    expect(raw).not.toContain('super-secret-token');
    expect(raw).not.toContain('SECRET');
    expect(JSON.parse(raw).settings.relayUrl).toBe('[redacted]');
  });
});
