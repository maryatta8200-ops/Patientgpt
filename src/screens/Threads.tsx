import { useMemo, useState } from 'react';
import { usePulse } from '../state/pulse';
import { PulseMark } from '../components/PulseMark';
import { InstallBanner } from '../components/Toasts';
import { timeAgo, initials } from '../lib/format';
import {
  IconChevron,
  IconPulse,
  IconRefresh,
  IconSettings,
  IconShield,
} from '../components/Icons';
import type { Thread } from '../lib/types';

export function Threads({
  onOpenThread,
  onOpenSettings,
  onOpenGuide,
  onCompose,
}: {
  onOpenThread: (id: string) => void;
  onOpenSettings: () => void;
  onOpenGuide: () => void;
  onCompose: () => void;
}) {
  const { threads, messages, identity, refresh, syncing, connection, pendingCount, settings } =
    usePulse();
  const [filter, setFilter] = useState<'all' | 'waiting'>('all');

  const previews = useMemo(() => {
    const map: Record<
      string,
      { text: string; role: 'user' | 'agent'; at: number; auto?: boolean; autoKind?: 'ack' | 'nudge' | 'escalate' }
    > = {};
    for (const [threadId, list] of Object.entries(messages)) {
      const last = list[list.length - 1];
      if (last) {
        map[threadId] = {
          text: last.text,
          role: last.role,
          at: last.createdAt,
          auto: last.auto,
          autoKind: last.autoKind,
        };
      }
    }
    return map;
  }, [messages]);

  const waitingThreads = useMemo(() => {
    const ids = new Set<string>();
    for (const list of Object.values(messages)) {
      if (list.some((m) => m.status === 'awaiting' || m.status === 'queued' || m.status === 'sending'))
        ids.add(list[0].threadId);
    }
    return ids;
  }, [messages]);

  const visible = (threads ?? [])
    .filter((t) => (filter === 'waiting' ? waitingThreads.has(t.id) : true))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="safe-t shrink-0 px-4 pb-3 pt-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <PulseMark size={34} glow={false} />
            <div>
              <h1 className="text-[17px] font-semibold leading-none tracking-tight">Pulse</h1>
              <p className="mt-1 text-[11.5px] text-fog">
                {identity?.alias ?? 'Private mode'} ·{' '}
                {connection === 'sandbox'
                  ? 'sandbox'
                  : connection === 'online'
                    ? 'relay online'
                    : connection === 'offline'
                      ? 'offline'
                      : connection === 'unconfigured'
                        ? 'no relay'
                        : 'relay error'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => void refresh()}
              aria-label="Check for answers"
              className="grid size-9 place-items-center rounded-xl border border-white/8 bg-white/4 text-mist transition active:scale-95"
            >
              <IconRefresh size={16} className={syncing ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onOpenSettings}
              aria-label="Settings"
              className="grid size-9 place-items-center rounded-xl border border-white/8 bg-white/4 text-mist transition active:scale-95"
            >
              <IconSettings size={16} />
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <span className="flex items-center gap-2 rounded-full border border-white/8 bg-white/4 px-2.5 py-1.5 text-[11.5px] font-medium text-mist">
            <span
              className={`live-dot ${
                connection === 'error'
                  ? 'live-dot--error'
                  : connection === 'offline'
                    ? 'live-dot--idle'
                    : ''
              }`}
            />
            {connection === 'sandbox'
              ? 'Local sandbox relay'
              : connection === 'online'
                ? 'Connected'
                : connection === 'offline'
                  ? 'Offline'
                  : connection === 'unconfigured'
                    ? 'Not connected'
                    : 'Needs attention'}
          </span>
          {pendingCount > 0 && (
            <span className="rounded-full border border-amber/25 bg-amber/10 px-2.5 py-1.5 text-[11.5px] font-medium text-amber">
              {pendingCount} in flight
            </span>
          )}
          <button
            onClick={() => setFilter(filter === 'all' ? 'waiting' : 'all')}
            className="ml-auto rounded-full border border-white/8 px-2.5 py-1.5 text-[11.5px] font-medium text-fog"
          >
            {filter === 'all' ? 'All' : 'Waiting'}
          </button>
        </div>
      </header>

      <InstallBanner onOpenGuide={onOpenGuide} />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-28">
        {visible.length === 0 ? (
          <EmptyState onCompose={onCompose} />
        ) : (
          <ul className="space-y-1.5">
            {visible.map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                preview={previews[thread.id]}
                waiting={waitingThreads.has(thread.id)}
                onOpen={() => onOpenThread(thread.id)}
                alias={identity?.alias ?? 'P'}
              />
            ))}
          </ul>
        )}

        <div className="mt-6 rounded-2xl border border-white/7 bg-white/3 p-3.5">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-mist">
            <IconShield size={14} className="text-aurora" />
            Burn-after-read relay
          </div>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-fog">
            Questions wait in a single sheet row for seconds, not days. Once an answer reaches this
            device the row is deleted — and anything older than {settings.ttlMinutes} minutes is purged
            regardless.
          </p>
        </div>
      </div>

      <button
        onClick={onCompose}
        className="btn btn-primary absolute bottom-6 right-5 z-20 size-14 rounded-2xl p-0 shadow-[0_18px_40px_-16px_rgba(46,230,197,0.95)]"
        aria-label="New question"
      >
        <IconPulse size={22} />
      </button>
    </div>
  );
}

function ThreadRow({
  thread,
  preview,
  waiting,
  onOpen,
  alias,
}: {
  thread: Thread;
  preview?: { text: string; role: 'user' | 'agent'; at: number; auto?: boolean; autoKind?: 'ack' | 'nudge' | 'escalate' };
  waiting: boolean;
  onOpen: () => void;
  alias: string;
}) {
  const isAgent = preview?.role === 'agent';
  return (
    <li>
      <button
        onClick={onOpen}
        className="group flex w-full items-center gap-3 rounded-2xl px-2.5 py-3 text-left transition-colors hover:bg-white/4 active:bg-white/6"
      >
        <span
          className="grid size-10 shrink-0 place-items-center rounded-xl text-[13px] font-semibold"
          style={{
            background: isAgent
              ? 'linear-gradient(145deg, rgba(46,230,197,0.20), rgba(53,208,255,0.12))'
              : 'rgba(255,255,255,0.06)',
            color: isAgent ? '#5df0d6' : 'var(--color-mist)',
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
          }}
        >
          {isAgent ? <IconPulse size={17} /> : initials(alias)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-[14px] font-semibold text-chalk">
              {thread.title || 'New question'}
            </span>
            <span className="ml-auto shrink-0 text-[11px] text-fog/80">
              {preview ? timeAgo(preview.at) : timeAgo(thread.updatedAt)}
            </span>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5">
            <span className="truncate text-[12.5px] text-fog">
              {waiting && preview?.auto ? (
                <span
                  className={
                    preview.autoKind === 'escalate'
                      ? 'font-medium text-amber'
                      : preview.autoKind === 'nudge'
                        ? 'text-amber/90'
                        : 'text-aurora/90'
                  }
                >
                  {preview.text.replace(/\s+/g, ' ')}
                </span>
              ) : waiting && !isAgent ? (
                <span className="text-amber/90">Waiting for an answer…</span>
              ) : (
                preview?.text.replace(/\s+/g, ' ') ?? 'No messages yet'
              )}
            </span>
            {thread.unread > 0 && (
              <span className="ml-auto grid min-w-5 shrink-0 place-items-center rounded-full bg-aurora px-1.5 py-0.5 text-[10.5px] font-bold text-ink">
                {thread.unread}
              </span>
            )}
            {thread.unread === 0 && !waiting && (
              <IconChevron size={13} className="ml-auto shrink-0 text-fog/40" />
            )}
          </span>
        </span>
      </button>
    </li>
  );
}

function EmptyState({ onCompose }: { onCompose: () => void }) {
  return (
    <div className="anim-rise flex flex-col items-center px-6 py-16 text-center">
      <PulseMark size={62} />
      <h2 className="mt-6 text-[22px] font-semibold tracking-tight">Ask your first question</h2>
      <p className="mt-2 max-w-[30ch] text-[13.5px] leading-relaxed text-fog">
        Type anything. It travels to a relay that forgets, and the answer comes back to this device
        only.
      </p>
      <button onClick={onCompose} className="btn btn-primary mt-6 px-6">
        Start a conversation
      </button>
    </div>
  );
}
