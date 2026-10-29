/**
 * Pulse local database — native IndexedDB, zero dependencies.
 *
 * Stores:
 *   kv        key/value (identity, settings, pin hash, sandbox mailbox)
 *   threads   conversation headers
 *   messages  every message, indexed by threadId
 *
 * Nothing in this file ever talks to the network. This *is* the source of truth.
 */

const DB_NAME = 'pulse';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('threads')) {
        const s = db.createObjectStore('threads', { keyPath: 'id' });
        s.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('messages')) {
        const s = db.createObjectStore('messages', { keyPath: 'id' });
        s.createIndex('threadId', 'threadId');
        s.createIndex('threadId_createdAt', ['threadId', 'createdAt']);
        s.createIndex('status', 'status');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Unable to open local database'));
    req.onblocked = () => reject(new Error('Local database is blocked by another tab'));
  });
  return dbPromise;
}

function tx<T>(
  storeNames: string | string[],
  mode: IDBTransactionMode,
  run: (stores: Record<string, IDBObjectStore>) => Promise<T> | T,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const names = Array.isArray(storeNames) ? storeNames : [storeNames];
        const t = db.transaction(names, mode);
        const map: Record<string, IDBObjectStore> = {};
        for (const n of names) map[n] = t.objectStore(n);
        let result: T;
        let settled = false;
        const done = () => {
          if (!settled) {
            settled = true;
            resolve(result);
          }
        };
        t.oncomplete = done;
        t.onabort = () => reject(t.error ?? new Error('Local database transaction aborted'));
        t.onerror = () => reject(t.error ?? new Error('Local database error'));
        Promise.resolve(run(map)).then((r) => {
          result = r;
          if (mode === 'readonly') done();
        }, reject);
      }),
  );
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ------------------------------- key/value ------------------------------- */

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return tx('kv', 'readonly', (s) => reqAsPromise(s.kv.get(key) as IDBRequest<T | undefined>));
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await tx('kv', 'readwrite', (s) => reqAsPromise(s.kv.put(value, key)));
}

export async function kvDelete(key: string): Promise<void> {
  await tx('kv', 'readwrite', (s) => reqAsPromise(s.kv.delete(key)));
}

/* -------------------------------- threads -------------------------------- */

export async function allThreads(): Promise<Thread[]> {
  const list = await tx('threads', 'readonly', (s) =>
    reqAsPromise(s.threads.getAll() as IDBRequest<Thread[]>),
  );
  return list.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function putThread(thread: Thread): Promise<void> {
  await tx('threads', 'readwrite', (s) => reqAsPromise(s.threads.put(thread)));
}

export async function deleteThread(id: string): Promise<void> {
  await tx(['threads', 'messages'], 'readwrite', async (s) => {
    await reqAsPromise(s.threads.delete(id));
    const keys = await reqAsPromise(
      s.messages.index('threadId').getAllKeys(id) as IDBRequest<IDBValidKey[]>,
    );
    for (const k of keys) await reqAsPromise(s.messages.delete(k));
  });
}

/* -------------------------------- messages ------------------------------- */

export async function messagesFor(threadId: string): Promise<Message[]> {
  const list = await tx('messages', 'readonly', (s) =>
    reqAsPromise(s.messages.index('threadId').getAll(threadId) as IDBRequest<Message[]>),
  );
  return list.sort((a, b) => a.createdAt - b.createdAt);
}

export async function allMessages(): Promise<Message[]> {
  return tx('messages', 'readonly', (s) =>
    reqAsPromise(s.messages.getAll() as IDBRequest<Message[]>),
  );
}

export async function putMessage(message: Message): Promise<void> {
  await tx('messages', 'readwrite', (s) => reqAsPromise(s.messages.put(message)));
}

export async function putMessages(messages: Message[]): Promise<void> {
  if (!messages.length) return;
  await tx('messages', 'readwrite', async (s) => {
    for (const m of messages) await reqAsPromise(s.messages.put(m));
  });
}

export async function getMessage(id: string): Promise<Message | undefined> {
  return tx('messages', 'readonly', (s) =>
    reqAsPromise(s.messages.get(id) as IDBRequest<Message | undefined>),
  );
}

export async function deleteMessage(id: string): Promise<void> {
  await tx('messages', 'readwrite', (s) => reqAsPromise(s.messages.delete(id)));
}

export async function awaitingMessages(): Promise<Message[]> {
  const all = await allMessages();
  return all.filter((m) => m.status === 'awaiting' && m.relayId);
}

export async function queuedMessages(): Promise<Message[]> {
  const all = await allMessages();
  return all.filter((m) => m.status === 'queued' || m.status === 'sending').sort(
    (a, b) => a.createdAt - b.createdAt,
  );
}

/* -------------------------------- nuclear -------------------------------- */

export async function wipeAll(): Promise<void> {
  await tx(['kv', 'threads', 'messages'], 'readwrite', async (s) => {
    await reqAsPromise(s.kv.clear());
    await reqAsPromise(s.threads.clear());
    await reqAsPromise(s.messages.clear());
  });
}

/** Rough byte estimate of everything Pulse keeps on this device. */
export async function localFootprint(): Promise<{ threads: number; messages: number; bytes: number }> {
  const [threads, msgs] = await Promise.all([allThreads(), allMessages()]);
  const bytes = new Blob([JSON.stringify(msgs)]).size;
  return { threads: threads.length, messages: msgs.length, bytes };
}

export async function exportEverything(): Promise<string> {
  const [identity, settings, pin, threads, messages] = await Promise.all([
    kvGet<Identity>('identity'),
    kvGet<Settings>('settings'),
    kvGet<{ hash: string; salt: string }>('pin'),
    allThreads(),
    allMessages(),
  ]);
  return JSON.stringify(
    {
      app: 'pulse',
      format: 1,
      exportedAt: new Date().toISOString(),
      note: 'This file is your entire Pulse history. The relay holds nothing.',
      identity: identity
        ? { deviceId: identity.deviceId, alias: identity.alias, createdAt: identity.createdAt }
        : null,
      settings: settings ? { ...settings, relayUrl: settings.relayUrl ? '[redacted]' : '' } : null,
      pinConfigured: Boolean(pin),
      threads,
      messages,
    },
    null,
    2,
  );
}

// Imported lazily to avoid a circular type import at runtime.
import type { Identity, Message, Settings, Thread } from './types';
