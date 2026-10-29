/**
 * Agent Console — for the human (or AI) on the answering side.
 *
 * Same relay, same rules: reply, send, and the row is burned the moment the
 * asker reads it. Protected by the admin key held in the Apps Script properties.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePulse } from '../state/pulse';
import { timeAgo } from '../lib/format';
import {
  IconBack,
  IconCheck,
  IconRefresh,
  IconSend,
  IconShield,
  IconSparkle,
} from '../components/Icons';
import type { AdminQuestion } from '../lib/types';

const KEY_STORAGE = 'pulse.adminKey';

export function Admin({ onBack }: { onBack: () => void }) {
  const { adminInbox, adminReply, settings, notify } = usePulse();
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem(KEY_STORAGE) ?? '');
  const [unlocked, setUnlocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [questions, setQuestions] = useState<AdminQuestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'new' | 'all'>('new');

  const load = useCallback(
    async (key: string) => {
      setLoading(true);
      setError(null);
      try {
        const inbox = await adminInbox(key);
        setQuestions(inbox);
        setUnlocked(true);
        sessionStorage.setItem(KEY_STORAGE, key);
      } catch (err) {
        setUnlocked(false);
        setError(err instanceof Error ? err.message : 'Console unavailable');
      } finally {
        setLoading(false);
      }
    },
    [adminInbox],
  );

  useEffect(() => {
    if (!unlocked) return;
    const timer = window.setInterval(() => void load(adminKey).catch(() => undefined), 8000);
    return () => window.clearInterval(timer);
  }, [unlocked, adminKey, load]);

  const visible = useMemo(
    () => (filter === 'new' ? questions.filter((q) => !q.answer) : questions),
    [questions, filter],
  );

  const pendingCount = questions.filter((q) => !q.answer).length;

  const submit = async (q: AdminQuestion) => {
    const answer = (drafts[q.relayId] ?? '').trim();
    if (!answer) return;
    setSendingId(q.relayId);
    try {
      await adminReply(adminKey, q.relayId, answer);
      setQuestions((prev) =>
        prev.map((item) =>
          item.relayId === q.relayId ? { ...item, answer, status: 'answered' } : item,
        ),
      );
      setDrafts((prev) => ({ ...prev, [q.relayId]: '' }));
      notify('Answer queued', 'The row will burn once their device reads it.', 'good');
    } catch (err) {
      notify('Could not send answer', err instanceof Error ? err.message : undefined, 'bad');
    } finally {
      setSendingId(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="safe-t shrink-0 px-2 pb-2 pt-2">
        <div className="flex items-center gap-1">
          <button
            onClick={onBack}
            aria-label="Back"
            className="grid size-9 place-items-center rounded-xl text-mist hover:bg-white/6"
          >
            <IconBack size={19} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-[15px] font-semibold leading-tight">Agent console</h1>
            <p className="text-[11px] text-fog">
              {unlocked
                ? `${pendingCount} waiting · answers burn on read`
                : 'Admin key required'}
            </p>
          </div>
          {unlocked && (
            <button
              onClick={() => void load(adminKey)}
              aria-label="Refresh inbox"
              className="grid size-9 place-items-center rounded-xl text-mist hover:bg-white/6"
            >
              <IconRefresh size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          )}
        </div>
      </header>

      {!unlocked ? (
        <div className="flex flex-1 flex-col justify-center px-5 pb-16">
          <div className="grid size-12 place-items-center rounded-2xl bg-iris/12 text-iris">
            <IconShield size={22} />
          </div>
          <h2 className="mt-4 text-[20px] font-semibold tracking-tight">Answer from here</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-fog">
            Paste the <span className="font-mono text-mist">ADMIN_KEY</span> you set in the Apps Script
            project. It is kept in this tab's session only, and never written to local storage.
          </p>
          <input
            className="field mt-5 font-mono text-[13px]"
            type="password"
            placeholder="admin key"
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void load(adminKey)}
            autoCapitalize="off"
            spellCheck={false}
          />
          <button
            className="btn btn-primary mt-3 w-full"
            disabled={!adminKey.trim() || loading}
            onClick={() => void load(adminKey)}
          >
            {loading ? 'Opening inbox…' : 'Unlock console'}
          </button>
          {error && (
            <p className="mt-3 rounded-xl border border-rose/25 bg-rose/8 px-3 py-2.5 text-[12px] leading-relaxed text-rose">
              {error}
            </p>
          )}
          <p className="mt-4 rounded-xl border border-white/8 bg-white/3 px-3 py-2.5 text-[11.5px] leading-relaxed text-fog">
            You can also answer directly in the Google Sheet: type into the{' '}
            <span className="font-mono text-mist">answer</span> column of any{' '}
            <span className="font-mono text-mist">new</span> row. Pulse picks it up on the next poll —
            a human and an AI work exactly the same way.
          </p>
        </div>
      ) : (
        <>
          <div className="shrink-0 px-4 pb-2">
            <div className="flex gap-1 rounded-xl border border-white/8 bg-white/4 p-1">
              {(['new', 'all'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`flex-1 rounded-lg py-1.5 text-[12px] font-semibold capitalize transition ${
                    filter === f ? 'bg-white/10 text-chalk' : 'text-fog'
                  }`}
                >
                  {f === 'new' ? `Waiting (${pendingCount})` : `All (${questions.length})`}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 pb-10">
            {visible.length === 0 ? (
              <div className="flex flex-col items-center py-16 text-center">
                <span className="grid size-12 place-items-center rounded-2xl bg-aurora/10 text-aurora">
                  <IconCheck size={22} />
                </span>
                <p className="mt-3 text-[14px] font-semibold">Inbox zero</p>
                <p className="mt-1 max-w-[26ch] text-[12px] leading-relaxed text-fog">
                  No {filter === 'new' ? 'pending' : ''} questions in the relay.
                  {settings.sandbox && ' Sandbox mode simulates answers automatically.'}
                </p>
              </div>
            ) : (
              visible.map((q) => (
                <div
                  key={q.relayId}
                  className="anim-in rounded-2xl border border-white/8 bg-white/4 p-3.5"
                >
                  <div className="flex items-center gap-2 text-[11px] text-fog">
                    <span
                      className={`rounded-full px-2 py-0.5 font-semibold ${
                        q.answer ? 'bg-aurora/12 text-aurora' : 'bg-amber/12 text-amber'
                      }`}
                    >
                      {q.answer ? 'answered' : 'new'}
                    </span>
                    <span className="truncate">{q.alias || 'anonymous'}</span>
                    <span className="ml-auto shrink-0">{timeAgo(q.createdAt)}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-chalk">
                    {q.question}
                  </p>

                  {q.answer ? (
                    <div className="mt-2.5 rounded-xl border border-aurora/15 bg-aurora/6 px-3 py-2">
                      <p className="text-[10.5px] font-semibold uppercase tracking-wider text-aurora/80">
                        reply · burns on read
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-mist">
                        {q.answer}
                      </p>
                    </div>
                  ) : (
                    <div className="mt-2.5 flex items-end gap-2">
                      <textarea
                        className="field min-h-[44px] flex-1 py-2.5 text-[13px]"
                        rows={2}
                        placeholder="Type the answer…"
                        value={drafts[q.relayId] ?? ''}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [q.relayId]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            void submit(q);
                          }
                        }}
                      />
                      <button
                        onClick={() => void submit(q)}
                        disabled={!drafts[q.relayId]?.trim() || sendingId === q.relayId}
                        aria-label="Send answer"
                        className="btn btn-primary size-[44px] shrink-0 rounded-xl p-0"
                      >
                        <IconSend size={17} />
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}

            <div className="mt-4 flex gap-2 rounded-2xl border border-iris/18 bg-iris/6 p-3.5">
              <IconSparkle size={15} className="mt-0.5 shrink-0 text-iris" />
              <p className="text-[11.5px] leading-relaxed text-mist/90">
                Any agent — a person, ChatGPT, or your own script — can write into the sheet's{' '}
                <span className="font-mono">answer</span> column. Nothing here is required for Pulse to
                work; the console is a convenience.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
