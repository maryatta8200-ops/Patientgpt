import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePulse } from '../state/pulse';
import { clockTime, dayLabel, renderRich } from '../lib/format';
import {
  IconAlert,
  IconBack,
  IconCheck,
  IconClock,
  IconFire,
  IconRefresh,
  IconSend,
  IconTrash,
} from '../components/Icons';
import type { Message } from '../lib/types';

const SUGGESTIONS = [
  'How does Pulse keep my questions private?',
  'What happens to my message after I read the answer?',
  'Can I use this offline?',
];

export function Chat({ threadId, onBack }: { threadId: string; onBack: () => void }) {
  const { messages, threads, send, retry, refresh, burnThread, deleteThread, markRead, settings } =
    usePulse();
  const [draft, setDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);
  const textarea = useRef<HTMLTextAreaElement | null>(null);

  const thread = threads.find((t) => t.id === threadId);
  const list = useMemo(() => messages[threadId] ?? [], [messages, threadId]);
  const awaiting = list.some((m) => m.status === 'awaiting' || m.status === 'sending' || m.status === 'queued');
  const empty = list.length === 0;

  useEffect(() => {
    void markRead(threadId);
  }, [threadId, markRead]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [list.length, awaiting]);

  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft]);

  const submit = async (text?: string) => {
    const body = (text ?? draft).trim();
    if (!body || sending) return;
    setSending(true);
    setDraft('');
    try {
      await send(body, threadId);
    } finally {
      setSending(false);
      textarea.current?.focus();
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="safe-t shrink-0 border-b border-white/6 bg-ink/70 px-2 pb-2.5 pt-2 backdrop-blur-xl">
        <div className="flex items-center gap-1">
          <button
            onClick={onBack}
            aria-label="Back to threads"
            className="grid size-9 shrink-0 place-items-center rounded-xl text-mist hover:bg-white/6"
          >
            <IconBack size={19} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14.5px] font-semibold leading-tight">
              {thread?.title || 'New question'}
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-fog">
              {awaiting ? (
                <>
                  <span className="live-dot" /> Team is on it
                </>
              ) : (
                <>
                  <IconFire size={10} className="text-aurora/80" />
                  Burn-after-read · {settings.ttlMinutes}m TTL
                </>
              )}
            </p>
          </div>
          <button
            onClick={() => void refresh()}
            aria-label="Refresh"
            className="grid size-9 place-items-center rounded-xl text-mist hover:bg-white/6"
          >
            <IconRefresh size={16} />
          </button>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Conversation options"
            className="grid size-9 place-items-center rounded-xl text-mist hover:bg-white/6"
          >
            <span className="text-[17px] leading-none tracking-widest">···</span>
          </button>
        </div>

        {menuOpen && (
          <div className="anim-in mx-2 mt-2 overflow-hidden rounded-xl border border-white/10 bg-surface/95">
            <button
              onClick={async () => {
                setMenuOpen(false);
                await burnThread(threadId);
                onBack();
              }}
              className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left text-[13px] text-chalk hover:bg-white/5"
            >
              <IconFire size={15} className="text-amber" />
              Burn this conversation
              <span className="ml-auto text-[11px] text-fog">erases locally</span>
            </button>
            <div className="hairline" />
            <button
              onClick={async () => {
                setMenuOpen(false);
                await deleteThread(threadId);
                onBack();
              }}
              className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left text-[13px] text-rose hover:bg-rose/6"
            >
              <IconTrash size={15} />
              Delete thread entirely
            </button>
          </div>
        )}
      </header>

      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-3"
        style={{ scrollbarGutter: 'stable' }}
      >
        {empty ? (
          <div className="anim-rise px-2 py-10 text-center">
            <p className="text-[15px] font-semibold">Empty thread</p>
            <p className="mx-auto mt-1.5 max-w-[28ch] text-[12.5px] leading-relaxed text-fog">
              Send the first message. Nothing is written to this device until you do.
            </p>
            <div className="mt-5 space-y-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => void submit(s)}
                  className="w-full rounded-xl border border-white/8 bg-white/3 px-3.5 py-2.5 text-left text-[12.5px] text-mist transition hover:bg-white/6"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {list.map((msg, i) => {
              const prev = list[i - 1];
              const showDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(msg.createdAt).toDateString();
              return (
                <div key={msg.id}>
                  {showDay && (
                    <div className="my-3 flex items-center gap-3">
                      <div className="hairline flex-1" />
                      <span className="text-[10.5px] font-medium uppercase tracking-wider text-fog/70">
                        {dayLabel(msg.createdAt)}
                      </span>
                      <div className="hairline flex-1" />
                    </div>
                  )}
                  {msg.auto ? (
                    <StatusCard message={msg} />
                  ) : (
                    <Bubble message={msg} onRetry={() => void retry(msg.id)} />
                  )}
                </div>
              );
            })}

            {awaiting && !list.some((m) => m.auto) && <TypingIndicator />}
          </div>
        )}
      </div>

      <div className="safe-b shrink-0 border-t border-white/6 bg-ink/80 px-3 pb-3 pt-2.5 backdrop-blur-xl">
        <div className="flex items-end gap-2">
          <textarea
            ref={textarea}
            value={draft}
            rows={1}
            placeholder="Ask a question…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              }
            }}
            className="field max-h-[140px] min-h-[46px] flex-1 py-3 leading-snug"
            style={{ height: 46 }}
          />
          <button
            onClick={() => void submit()}
            disabled={!draft.trim() || sending}
            aria-label="Send question"
            className="btn btn-primary size-[46px] shrink-0 rounded-2xl p-0"
          >
            <IconSend size={19} />
          </button>
        </div>
        <p className="mt-1.5 flex items-center justify-between px-1 text-[10.5px] text-fog/70">
          <span>Stored locally first, then relayed</span>
          <span className="tnum">{draft.length > 0 ? `${draft.length}/4000` : ''}</span>
        </p>
      </div>
    </div>
  );
}

function Bubble({ message, onRetry }: { message: Message; onRetry: () => void }) {
  const user = message.role === 'user';
  return (
    <div className={`flex ${user ? 'justify-end' : 'justify-start'} anim-in`}>
      <div className={`flex max-w-full flex-col gap-1 ${user ? 'items-end' : 'items-start'}`}>
        <div
          className={`bubble ${user ? 'bubble-user' : 'bubble-agent'}`}
          dangerouslySetInnerHTML={{ __html: renderRich(message.text) }}
        />
        <div
          className={`flex items-center gap-1 px-1 text-[10px] ${
            message.status === 'failed' ? 'text-rose' : 'text-fog/70'
          }`}
        >
          {user ? (
            <>
              {message.status === 'queued' && (
                <>
                  <IconClock size={10} /> queued
                </>
              )}
              {message.status === 'sending' && (
                <>
                  <IconClock size={10} /> sending
                </>
              )}
              {message.status === 'awaiting' && (
                <>
                  <IconClock size={10} /> awaiting answer · {clockTime(message.createdAt)}
                </>
              )}
              {message.status === 'delivered' && (
                <>
                  <IconCheck size={10} /> delivered · burned on relay
                </>
              )}
              {message.status === 'failed' && (
                <>
                  <IconAlert size={10} />
                  <button onClick={onRetry} className="underline underline-offset-2">
                    {message.error ? 'failed — tap to retry' : 'tap to retry'}
                  </button>
                </>
              )}
            </>
          ) : (
            <>answered · {clockTime(message.createdAt)}</>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusCard({ message }: { message: Message }) {
  const nudge = message.autoKind === 'nudge';
  return (
    <div className="anim-in my-2 flex justify-center px-2">
      <div
        className={`flex max-w-[92%] items-start gap-2 rounded-2xl border px-3 py-2 ${
          nudge
            ? 'border-amber/20 bg-amber/6'
            : 'border-aurora/18 bg-aurora/5'
        }`}
      >
        <span className="mt-1 shrink-0">
          {nudge ? (
            <IconClock size={13} className="text-amber" />
          ) : (
            <span className="live-dot block" />
          )}
        </span>
        <div>
          <p className={`text-[12.5px] font-medium leading-relaxed ${nudge ? 'text-amber/95' : 'text-mist'}`}>
            {message.text}
          </p>
          <p className="mt-0.5 text-[10.5px] text-fog/70">
            {nudge ? 'Automatic update' : 'Automatic reply'} · {clockTime(message.createdAt)}
          </p>
        </div>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="bubble bubble-agent flex items-center gap-2 py-3">
        <span className="think">
          <span />
          <span />
          <span />
        </span>
        <span className="text-[11.5px] text-fog">waiting for an answer</span>
      </div>
    </div>
  );
}
