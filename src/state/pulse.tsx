/**
 * Pulse application state.
 *
 * Rule of the house: write to IndexedDB first, then talk to the network.
 * Every state transition survives a reload, a plane, or a dead relay.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import * as db from '../lib/db';
import { cleanOutgoing, haptic } from '../lib/format';
import { hashPin, makeSalt, randomId, safeEqual, uuid } from '../lib/crypto';
import { RelayError, makeRelay, probeRelay } from '../lib/relay';
import {
  DEFAULT_SETTINGS,
  type AdminQuestion,
  type ConnectionState,
  type Identity,
  type Message,
  type Settings,
  type Thread,
} from '../lib/types';

type MessagesByThread = Record<string, Message[]>;

export interface Toast {
  id: string;
  title: string;
  body?: string;
  tone: 'neutral' | 'good' | 'bad';
}

interface PulseContextValue {
  ready: boolean;
  identity: Identity | null;
  settings: Settings;
  threads: Thread[];
  messages: MessagesByThread;
  locked: boolean;
  pinSet: boolean;
  connection: ConnectionState;
  syncing: boolean;
  lastSyncAt: number;
  lastError: string | null;
  toasts: Toast[];
  pendingCount: number;

  register: (input: { alias: string; pin?: string }) => Promise<{ recoveryCode: string }>;
  completeOnboarding: () => Promise<void>;
  send: (text: string, threadId?: string) => Promise<void>;
  refresh: (opts?: { silent?: boolean }) => Promise<void>;
  retry: (messageId: string) => Promise<void>;
  markRead: (threadId: string) => Promise<void>;
  newThread: () => string;
  deleteThread: (threadId: string) => Promise<void>;
  burnThread: (threadId: string) => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  testRelay: (url: string) => Promise<{ ok: boolean; message: string; hint?: string }>;
  setPin: (pin: string | null) => Promise<void>;
  unlock: (pin: string) => Promise<boolean>;
  lock: () => void;
  exportData: () => Promise<void>;
  wipe: () => Promise<void>;
  notify: (title: string, body?: string, tone?: Toast['tone']) => void;
  dismissToast: (id: string) => void;
  adminInbox: (key: string) => Promise<AdminQuestion[]>;
  adminReply: (key: string, relayId: string, answer: string) => Promise<void>;
}

const PulseContext = createContext<PulseContextValue | null>(null);

export function usePulse(): PulseContextValue {
  const ctx = useContext(PulseContext);
  if (!ctx) throw new Error('usePulse must be used inside <PulseProvider>');
  return ctx;
}

export function PulseProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [messages, setMessages] = useState<MessagesByThread>({});
  const [locked, setLocked] = useState(false);
  const [pinSet, setPinSet] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>('sandbox');
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const busy = useRef(false);
  const stateRef = useRef({ identity, settings, messages, threads });
  stateRef.current = { identity, settings, messages, threads };

  /* ------------------------------- toasts ------------------------------- */

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback(
    (title: string, body?: string, tone: Toast['tone'] = 'neutral') => {
      const id = randomId(6);
      setToasts((prev) => [...prev.slice(-2), { id, title, body, tone }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 5200);
    },
    [],
  );

  /* ------------------------------ bootstrap ----------------------------- */

  const loadThreads = useCallback(async (): Promise<{ threads: Thread[]; messages: MessagesByThread }> => {
    const [list, all] = await Promise.all([db.allThreads(), db.allMessages()]);
    const grouped: MessagesByThread = {};
    for (const m of all) {
      (grouped[m.threadId] ||= []).push(m);
    }
    for (const key of Object.keys(grouped)) {
      grouped[key].sort((a, b) => a.createdAt - b.createdAt);
    }
    return { threads: list, messages: grouped };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [storedIdentity, storedSettings, pin] = await Promise.all([
        db.kvGet<Identity>('identity'),
        db.kvGet<Settings>('settings'),
        db.kvGet<{ hash: string; salt: string }>('pin'),
      ]);
      const merged = { ...DEFAULT_SETTINGS, ...(storedSettings ?? {}) };
      const { threads: t, messages: m } = await loadThreads();
      if (cancelled) return;

      setIdentity(storedIdentity ?? null);
      setSettings(merged);
      setThreads(t);
      setMessages(m);
      setPinSet(Boolean(pin));
      setLocked(Boolean(pin));
      setConnection(
        merged.sandbox || !merged.relayUrl ? 'sandbox' : navigator.onLine ? 'online' : 'offline',
      );
      setReady(true);
    })().catch((err) => {
      console.error('[pulse] bootstrap failed', err);
      setLastError('Local storage is unavailable — Pulse cannot start.');
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [loadThreads]);

  /* ------------------------------- relay -------------------------------- */

  const persistSettings = useCallback(async (next: Settings) => {
    setSettings(next);
    await db.kvSet('settings', next);
  }, []);

  const applySettings = useCallback(
    async (patch: Partial<Settings>) => {
      const next = { ...stateRef.current.settings, ...patch };
      await persistSettings(next);
    },
    [persistSettings],
  );

  /* --------------------------- registration ----------------------------- */

  const register = useCallback(
    async ({ alias, pin }: { alias: string; pin?: string }) => {
      const deviceId = uuid();
      const cleanAlias = alias.trim().slice(0, 40) || 'Anonymous';
      const activeDriver = makeRelay(stateRef.current.settings);
      let token: string;
      try {
        ({ token } = await activeDriver.register({ deviceId, alias: cleanAlias }));
      } catch (err) {
        setLastError(err instanceof Error ? err.message : 'Registration failed');
        throw err;
      }

      const newIdentity: Identity = {
        deviceId,
        token,
        alias: cleanAlias,
        createdAt: Date.now(),
        recoveryCode: makeRecoveryCode(),
      };
      await db.kvSet('identity', newIdentity);
      setIdentity(newIdentity);

      if (pin && pin.length >= 4) {
        const salt = makeSalt();
        const hash = await hashPin(pin, salt);
        await db.kvSet('pin', { hash, salt });
        setPinSet(true);
        setLocked(false);
      }

      // `onboarded` stays false until the user has seen their recovery code.
      await persistSettings({ ...stateRef.current.settings, alias: cleanAlias });

      // Welcome thread so the first screen is never empty.
      const threadId = randomId(10);
      const now = Date.now();
      await db.putThread({
        id: threadId,
        title: 'Welcome to Pulse',
        createdAt: now,
        updatedAt: now,
        unread: 0,
        archived: false,
      });
      await db.putMessage({
        id: randomId(10),
        threadId,
        role: 'agent',
        text:
          `Welcome, ${cleanAlias}.\n\nThis conversation lives only on this device. Your questions travel through a relay that keeps nothing: each one is deleted the moment the answer reaches you.\n\nAsk anything — a person or an AI reads it in the relay and writes back.`,
        createdAt: now,
        status: 'delivered',
        deliveredAt: now,
      });
      const reloaded = await loadThreads();
      setThreads(reloaded.threads);
      setMessages(reloaded.messages);
      return { recoveryCode: newIdentity.recoveryCode };
    },
    [loadThreads, persistSettings],
  );

  const completeOnboarding = useCallback(async () => {
    await applySettings({ onboarded: true });
  }, [applySettings]);

  /* ----------------------------- messaging ------------------------------ */

  const flushQueued = useCallback(async () => {
    const { identity: id, settings: s } = stateRef.current;
    if (!id) return;
    const queue = await db.queuedMessages();
    if (!queue.length) return;
    const active = makeRelay(s);

    for (const msg of queue) {
      const sending: Message = { ...msg, status: 'sending', error: undefined };
      await db.putMessage(sending);
      setMessages((prev) => replaceMessage(prev, sending));
      try {
        const { relayId } = await active.ask({
          deviceId: id.deviceId,
          token: id.token,
          localId: msg.id,
          threadId: msg.threadId,
          text: msg.text,
        });
        const awaiting: Message = { ...msg, status: 'awaiting', relayId };
        await db.putMessage(awaiting);
        setMessages((prev) => replaceMessage(prev, awaiting));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not reach the relay';
        const failed: Message = { ...msg, status: 'failed', error: message };
        await db.putMessage(failed);
        setMessages((prev) => replaceMessage(prev, failed));
        setLastError(message);
      }
    }
  }, []);

  const pullAnswers = useCallback(async () => {
    const { identity: id, settings: s } = stateRef.current;
    if (!id) return;
    const active = makeRelay(s);
    const replies = await active.poll({ deviceId: id.deviceId, token: id.token });
    if (!replies.length) return;

    const burn: string[] = [];
    for (const reply of replies) {
      const question = await db.getMessage(reply.messageId);
      if (question) {
        const answered: Message = { ...question, status: 'delivered', deliveredAt: reply.answeredAt };
        await db.putMessage(answered);
        setMessages((prev) => replaceMessage(prev, answered));
      }
      const answer: Message = {
        id: randomId(10),
        threadId: reply.threadId,
        role: 'agent',
        text: reply.answer,
        createdAt: reply.answeredAt || Date.now(),
        status: 'delivered',
        deliveredAt: Date.now(),
      };
      await db.putMessage(answer);
      setMessages((prev) => replaceMessage(prev, answer));

      const thread = stateRef.current.threads.find((t) => t.id === reply.threadId);
      if (thread) {
        const updated: Thread = {
          ...thread,
          updatedAt: Date.now(),
          unread: thread.unread + 1,
        };
        await db.putThread(updated);
        setThreads((prev) => prev.map((t) => (t.id === updated.id ? updated : t)).sort(byUpdated));
      }
      burn.push(reply.relayId);
    }

    // Burn after read — the relay row is destroyed as soon as this device has the answer.
    try {
      await active.ack({ deviceId: id.deviceId, token: id.token, relayIds: burn });
      await applySettings({ lastAckAt: Date.now() });
    } catch {
      /* ack retries on the next poll; the server-side TTL will still purge it */
    }

    haptic(18, stateRef.current.settings.haptics);
    notify('New answer received', 'Saved on this device. The relay copy is gone.', 'good');
  }, [applySettings, notify]);

  const refresh = useCallback(
    async (_opts?: { silent?: boolean }) => {
      const { identity: id, settings: s } = stateRef.current;
      if (!id || busy.current) return;
      busy.current = true;
      setSyncing(true);
      try {
        await flushQueued();
        await pullAnswers();
        const probe = makeRelay(s);
        try {
          await probe.ping({ deviceId: id.deviceId, token: id.token });
          setConnection(s.sandbox || !s.relayUrl ? 'sandbox' : 'online');
          setLastError(null);
        } catch (err) {
          if (!(err instanceof RelayError) || !/admin/i.test(err.message)) {
            setConnection(s.sandbox || !s.relayUrl ? 'sandbox' : 'error');
            setLastError(err instanceof Error ? err.message : 'Relay unreachable');
          }
        }
        setLastSyncAt(Date.now());
      } finally {
        busy.current = false;
        setSyncing(false);
      }
    },
    [flushQueued, pullAnswers],
  );

  const send = useCallback(
    async (text: string, threadId?: string) => {
      const { identity: id, settings: s, threads: currentThreads } = stateRef.current;
      const body = cleanOutgoing(text);
      if (!body || !id) return;

      let target = threadId;
      if (!target || !currentThreads.some((t) => t.id === target)) {
        target = randomId(10);
        const now = Date.now();
        const thread: Thread = {
          id: target,
          title: body.split('\n')[0].slice(0, 52),
          createdAt: now,
          updatedAt: now,
          unread: 0,
          archived: false,
        };
        await db.putThread(thread);
        setThreads((prev) => [thread, ...prev]);
      }

      const message: Message = {
        id: randomId(10),
        threadId: target,
        role: 'user',
        text: body,
        createdAt: Date.now(),
        status: 'queued',
      };
      await db.putMessage(message);
      setMessages((prev) => replaceMessage(prev, message));

      const thread = stateRef.current.threads.find((t) => t.id === target);
      if (thread) {
        const updated: Thread = { ...thread, updatedAt: message.createdAt, unread: 0 };
        await db.putThread(updated);
        setThreads((prev) => prev.map((t) => (t.id === updated.id ? updated : t)).sort(byUpdated));
      }

      haptic(10, s.haptics);
      await refresh({ silent: true });
    },
    [refresh],
  );

  const retry = useCallback(
    async (messageId: string) => {
      const msg = await db.getMessage(messageId);
      if (!msg) return;
      const queued: Message = { ...msg, status: 'queued', error: undefined };
      await db.putMessage(queued);
      setMessages((prev) => replaceMessage(prev, queued));
      await refresh({ silent: true });
    },
    [refresh],
  );

  /* ------------------------------ threads ------------------------------- */

  const newThread = useCallback(() => randomId(10), []);

  const deleteThread = useCallback(async (threadId: string) => {
    await db.deleteThread(threadId);
    setThreads((prev) => prev.filter((t) => t.id !== threadId));
    setMessages((prev) => {
      const next = { ...prev };
      delete next[threadId];
      return next;
    });
  }, []);

  const burnThread = useCallback(
    async (threadId: string) => {
      const list = stateRef.current.messages[threadId] ?? [];
      for (const m of list) await db.deleteMessage(m.id);
      const thread = stateRef.current.threads.find((t) => t.id === threadId);
      if (thread) {
        const clean: Thread = { ...thread, unread: 0, updatedAt: Date.now() };
        await db.putThread(clean);
        setThreads((prev) => prev.map((t) => (t.id === clean.id ? clean : t)));
      }
      setMessages((prev) => ({ ...prev, [threadId]: [] }));
      notify('Conversation burned', 'Messages erased from this device.', 'good');
    },
    [notify],
  );

  const markRead = useCallback(async (threadId: string) => {
    const thread = stateRef.current.threads.find((t) => t.id === threadId);
    if (!thread || thread.unread === 0) return;
    const updated = { ...thread, unread: 0 };
    await db.putThread(updated);
    setThreads((prev) => prev.map((t) => (t.id === threadId ? updated : t)));
  }, []);

  /* ------------------------------- PIN ---------------------------------- */

  const setPin = useCallback(async (pin: string | null) => {
    if (!pin) {
      await db.kvDelete('pin');
      setPinSet(false);
      setLocked(false);
      await applySettings({ pinEnabled: false });
      return;
    }
    const salt = makeSalt();
    const hash = await hashPin(pin, salt);
    await db.kvSet('pin', { hash, salt });
    setPinSet(true);
    setLocked(false);
    await applySettings({ pinEnabled: true });
  }, [applySettings]);

  const unlock = useCallback(async (pin: string) => {
    const stored = await db.kvGet<{ hash: string; salt: string }>('pin');
    if (!stored) {
      setLocked(false);
      return true;
    }
    const candidate = await hashPin(pin, stored.salt);
    const ok = safeEqual(candidate, stored.hash);
    if (ok) setLocked(false);
    return ok;
  }, []);

  const lock = useCallback(() => {
    if (stateRef.current.settings.pinEnabled) setLocked(true);
  }, []);

  /* ------------------------------ settings ------------------------------ */

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const merged = { ...stateRef.current.settings, ...patch };
      await persistSettings(merged);
      setConnection(merged.sandbox || !merged.relayUrl ? 'sandbox' : navigator.onLine ? 'online' : 'offline');
    },
    [persistSettings],
  );

  const testRelay = useCallback(async (url: string) => {
    if (!url.trim()) return { ok: false, message: 'Paste your Apps Script /exec URL first' };
    return probeRelay(url.trim());
  }, []);

  /* --------------------------- data ownership --------------------------- */

  const exportData = useCallback(async () => {
    const json = await db.exportEverything();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pulse-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    notify('Export ready', 'Your full history is in the download.', 'good');
  }, [notify]);

  const wipe = useCallback(async () => {
    const { identity: id, settings: s } = stateRef.current;
    if (id) {
      try {
        await makeRelay(s).deregister({ deviceId: id.deviceId, token: id.token });
      } catch {
        /* local wipe must never be blocked by the network */
      }
    }
    await db.wipeAll();
    setIdentity(null);
    setThreads([]);
    setMessages({});
    setSettings(DEFAULT_SETTINGS);
    setPinSet(false);
    setLocked(false);
    notify('Everything erased', 'Local data removed and the relay registration dropped.', 'good');
  }, [notify]);

  /* ------------------------------- admin -------------------------------- */

  const adminInbox = useCallback(
    (key: string) => makeRelay(stateRef.current.settings).adminInbox(key),
    [],
  );

  const adminReply = useCallback(async (key: string, relayId: string, answer: string) => {
    await makeRelay(stateRef.current.settings).adminReply({ adminKey: key, relayId, answer });
  }, []);

  /* ------------------------------ polling ------------------------------- */

  const pendingCount = useMemo(
    () =>
      Object.values(messages)
        .flat()
        .filter((m) => m.status === 'awaiting' || m.status === 'queued' || m.status === 'failed')
        .length,
    [messages],
  );

  const intervalRef = useRef<number | null>(null);
  useEffect(() => {
    if (!ready || !identity || locked) return;
    const sandboxMode = settings.sandbox || !settings.relayUrl;
    const awaitingActive = pendingCount > 0;
    const delay = sandboxMode ? (awaitingActive ? 2200 : 9000) : (awaitingActive ? settings.pollSeconds * 1000 : 15000);

    intervalRef.current = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      void refresh({ silent: true });
    }, Math.max(2200, delay));

    const onVisible = () => {
      if (document.visibilityState === 'visible' && pendingCount > 0) void refresh({ silent: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ready, identity, locked, pendingCount, settings.sandbox, settings.relayUrl, settings.pollSeconds, refresh]);

  useEffect(() => {
    const onOnline = () => {
      setConnection((prev) => (prev === 'error' || prev === 'offline' ? 'online' : prev));
      void refresh({ silent: true });
    };
    const onOffline = () => setConnection('offline');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [refresh]);

  const value = useMemo<PulseContextValue>(
    () => ({
      ready,
      identity,
      settings,
      threads,
      messages,
      locked,
      pinSet,
      connection,
      syncing,
      lastSyncAt,
      lastError,
      toasts,
      pendingCount,
      register,
      completeOnboarding,
      send,
      refresh,
      retry,
      newThread,
      deleteThread,
      burnThread,
      updateSettings,
      testRelay,
      setPin,
      unlock,
      lock,
      exportData,
      wipe,
      notify,
      dismissToast,
      adminInbox,
      adminReply,
      markRead,
    }),
    [
      ready,
      identity,
      settings,
      threads,
      messages,
      locked,
      pinSet,
      connection,
      syncing,
      lastSyncAt,
      lastError,
      toasts,
      pendingCount,
      register,
      completeOnboarding,
      send,
      refresh,
      retry,
      newThread,
      deleteThread,
      burnThread,
      updateSettings,
      testRelay,
      setPin,
      unlock,
      lock,
      exportData,
      wipe,
      notify,
      dismissToast,
      adminInbox,
      adminReply,
      markRead,
    ],
  );

  return <PulseContext.Provider value={value}>{children}</PulseContext.Provider>;
}

/* ------------------------------- helpers -------------------------------- */

function replaceMessage(state: MessagesByThread, message: Message): MessagesByThread {
  const list = state[message.threadId] ?? [];
  const idx = list.findIndex((m) => m.id === message.id);
  const next = idx === -1 ? [...list, message] : list.map((m) => (m.id === message.id ? message : m));
  next.sort((a, b) => a.createdAt - b.createdAt);
  return { ...state, [message.threadId]: next };
}

function byUpdated(a: Thread, b: Thread) {
  return b.updatedAt - a.updatedAt;
}

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeRecoveryCode(): string {
  const bytes = new Uint8Array(new ArrayBuffer(16));
  crypto.getRandomValues(bytes);
  const groups: string[] = [];
  for (let g = 0; g < 4; g++) {
    let s = '';
    for (let i = 0; i < 4; i++) s += RECOVERY_ALPHABET[bytes[g * 4 + i] % RECOVERY_ALPHABET.length];
    groups.push(s);
  }
  return groups.join('-');
}
