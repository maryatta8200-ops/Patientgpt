// @vitest-environment jsdom
/**
 * Store integration tests — the whole product loop through the real provider.
 *
 * Mounts <PulseProvider> exactly as the app does, with the shipping sandbox
 * relay and a real IndexedDB, then drives:
 *
 *   register → send → auto-ack appears → answer arrives → auto-ack cleared
 *            → relay row burned → thread state correct
 *
 * This is the behaviour the product promises, asserted end to end.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PulseProvider, usePulse } from '../src/state/pulse';
import * as db from '../src/lib/db';

const wrapper = ({ children }: { children: ReactNode }) => <PulseProvider>{children}</PulseProvider>;

async function mountPulse() {
  const { result } = renderHook(() => usePulse(), { wrapper });
  await waitFor(() => expect(result.current.ready).toBe(true));
  return result;
}

/** Registers and finishes onboarding. */
async function onboard(result: Awaited<ReturnType<typeof mountPulse>>, alias = 'Tester') {
  await act(async () => {
    await result.current.register({ alias });
  });
  await act(async () => {
    await result.current.completeOnboarding();
  });
}

/** Moves the (faked) clock forward without blocking on real timers. */
function advance(ms: number) {
  vi.setSystemTime(new Date(Date.now() + ms));
}

beforeEach(async () => {
  await db.wipeAll();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-04-01T08:00:00Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('onboarding', () => {
  it('starts unregistered', async () => {
    const result = await mountPulse();
    expect(result.current.identity).toBeNull();
    expect(result.current.settings.onboarded).toBe(false);
  });

  it('registers a device identity and a welcome thread', async () => {
    const result = await mountPulse();
    await onboard(result);

    expect(result.current.identity?.alias).toBe('Tester');
    expect(result.current.identity?.deviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.current.identity?.token).toBeTruthy();
    expect(result.current.settings.onboarded).toBe(true);
    expect(result.current.threads).toHaveLength(1);
    expect(result.current.settings.sandbox).toBe(true);
  });

  it('does not finish onboarding until the recovery code has been acknowledged', async () => {
    const result = await mountPulse();
    await act(async () => {
      await result.current.register({ alias: 'Tester' });
    });
    // The recovery screen relies on this staying false.
    expect(result.current.settings.onboarded).toBe(false);
    expect(result.current.identity?.recoveryCode).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/);
  });

  it('sets a PIN that locks the next session', async () => {
    const result = await mountPulse();
    await onboard(result);
    await act(async () => {
      await result.current.setPin('4321');
    });
    expect(result.current.pinSet).toBe(true);
    expect(await result.current.unlock('0000')).toBe(false);
    expect(await result.current.unlock('4321')).toBe(true);
  });
});

describe('sending a question', () => {
  it('persists the message locally and marks it awaiting', async () => {
    const result = await mountPulse();
    await onboard(result);

    await act(async () => {
      await result.current.send('What is Pulse?');
    });

    const thread = result.current.threads.find((t) => t.title === 'What is Pulse?');
    expect(thread).toBeDefined();

    const messages = result.current.messages[thread!.id];
    const question = messages.find((m) => m.role === 'user');
    expect(question?.text).toBe('What is Pulse?');
    expect(question?.status).toBe('awaiting');
    expect(question?.relayId).toMatch(/^sbx_/);

    // And it survives in the local database, not just React state.
    const persisted = await db.messagesFor(thread!.id);
    expect(persisted.some((m) => m.text === 'What is Pulse?')).toBe(true);
  });

  it('posts the holding reply immediately, before any answer exists', async () => {
    const result = await mountPulse();
    await onboard(result);

    await act(async () => {
      await result.current.send('Anything?');
    });

    const thread = result.current.threads.find((t) => t.title === 'Anything?')!;
    const ack = result.current.messages[thread.id].find((m) => m.auto);

    expect(ack).toBeDefined();
    expect(ack?.text).toBe('Our team is working on your question.');
    expect(ack?.autoKind).toBe('ack');
    expect(ack?.role).toBe('agent');
  });

  it('uses the operator-configured wording', async () => {
    const result = await mountPulse();
    await onboard(result);
    await act(async () => {
      await result.current.updateSettings({ autoAckText: 'Hold tight, we are on it.' });
    });

    await act(async () => {
      await result.current.send('custom wording');
    });

    const thread = result.current.threads.find((t) => t.title === 'custom wording')!;
    expect(result.current.messages[thread.id].find((m) => m.auto)?.text).toBe(
      'Hold tight, we are on it.',
    );
  });

  it('can be turned off entirely', async () => {
    const result = await mountPulse();
    await onboard(result);
    await act(async () => {
      await result.current.updateSettings({ autoAck: false });
    });

    await act(async () => {
      await result.current.send('no holding reply please');
    });

    const thread = result.current.threads.find((t) => t.title === 'no holding reply please')!;
    expect(result.current.messages[thread.id].some((m) => m.auto)).toBe(false);
  });

  it('keeps an empty draft from creating a thread', async () => {
    const result = await mountPulse();
    await onboard(result);
    const before = result.current.threads.length;

    await act(async () => {
      await result.current.send('   ');
    });

    expect(result.current.threads).toHaveLength(before);
  });
});

describe('receiving the answer', () => {
  it('delivers it, clears the holding reply, and burns the relay row', async () => {
    const result = await mountPulse();
    await onboard(result);

    await act(async () => {
      await result.current.send('How does this work?');
    });
    const thread = result.current.threads.find((t) => t.title === 'How does this work?')!;

    // Nothing yet.
    expect(result.current.messages[thread.id].some((m) => m.text.includes('Received:'))).toBe(false);

    // The sandbox answers after ~2.6s.
    advance(4_000);
    await act(async () => {
      await result.current.refresh();
    });

    const messages = result.current.messages[thread.id];

    // The question is marked delivered…
    const question = messages.find((m) => m.role === 'user')!;
    expect(question.status).toBe('delivered');

    // …the real answer is present…
    const answer = messages.find((m) => m.role === 'agent' && !m.auto)!;
    expect(answer.text.length).toBeGreaterThan(20);

    // …and the holding card is gone, so the thread reads cleanly.
    expect(messages.some((m) => m.auto)).toBe(false);
  });

  it('burns the row, so a second poll returns nothing', async () => {
    const result = await mountPulse();
    await onboard(result);
    await act(async () => {
      await result.current.send('delivered once');
    });

    advance(4_000);
    await act(async () => {
      await result.current.refresh();
    });

    const thread = result.current.threads.find((t) => t.title === 'delivered once')!;
    const countAfterFirst = result.current.messages[thread.id].length;

    advance(4_000);
    await act(async () => {
      await result.current.refresh();
    });

    // No duplicate answer: the relay no longer holds it.
    expect(result.current.messages[thread.id]).toHaveLength(countAfterFirst);
  });

  it('counts the thread as unread and stores the answer locally', async () => {
    const result = await mountPulse();
    await onboard(result);
    await act(async () => {
      await result.current.send('unread check');
    });

    advance(4_000);
    await act(async () => {
      await result.current.refresh();
    });

    const thread = result.current.threads.find((t) => t.title === 'unread check')!;
    expect(thread.unread).toBeGreaterThan(0);

    const persisted = await db.messagesFor(thread.id);
    expect(persisted.some((m) => m.role === 'agent' && !m.auto)).toBe(true);
  });
});

describe('follow-ups', () => {
  it('nudges once, then escalates once, then stops', async () => {
    const result = await mountPulse();
    await onboard(result);
    await act(async () => {
      await result.current.send('slow path');
    });
    const thread = result.current.threads.find((t) => t.title === 'slow path')!;

    // Empty the relay mailbox so this question can never be answered.
    const { SandboxRelay } = await import('../src/lib/relay');
    await new SandboxRelay().deregister({ deviceId: 'x', token: 'y' });

    const autoKinds = () =>
      result.current.messages[thread.id].filter((m) => m.auto).map((m) => m.autoKind);

    // Before the threshold: only the instant acknowledgement.
    expect(autoKinds()).toEqual(['ack']);

    // Past the first threshold (default 4 min).
    advance(5 * 60_000);
    await act(async () => {
      await result.current.refresh();
    });
    expect(autoKinds()).toEqual(['ack', 'nudge']);

    // Not yet the escalation threshold (default 15 min).
    advance(2 * 60_000);
    await act(async () => {
      await result.current.refresh();
    });
    expect(autoKinds()).toEqual(['ack', 'nudge']);

    // Past it.
    advance(10 * 60_000);
    await act(async () => {
      await result.current.refresh();
    });
    expect(autoKinds()).toEqual(['ack', 'nudge', 'escalate']);

    // Terminal: however long it sits, nothing more is posted.
    advance(24 * 60 * 60_000);
    await act(async () => {
      await result.current.refresh();
    });
    expect(autoKinds()).toEqual(['ack', 'nudge', 'escalate']);
  });

  it('respects the configured intervals and wording', async () => {
    const result = await mountPulse();
    await onboard(result);
    await act(async () => {
      await result.current.updateSettings({
        followUpMinutes: 2,
        escalateMinutes: 30,
        nudgeText: 'Custom nudge.',
        escalateText: 'Custom escalation.',
      });
    });
    await act(async () => {
      await result.current.send('timing check');
    });
    const thread = result.current.threads.find((t) => t.title === 'timing check')!;

    const { SandboxRelay } = await import('../src/lib/relay');
    await new SandboxRelay().deregister({ deviceId: 'x', token: 'y' });

    advance(2.5 * 60_000);
    await act(async () => {
      await result.current.refresh();
    });
    const nudge = result.current.messages[thread.id].find((m) => m.autoKind === 'nudge');
    expect(nudge?.text).toBe('Custom nudge.');

    advance(28 * 60_000);
    await act(async () => {
      await result.current.refresh();
    });
    const escalation = result.current.messages[thread.id].find((m) => m.autoKind === 'escalate');
    expect(escalation?.text).toBe('Custom escalation.');
  });

  it('posts nothing extra when follow-ups are disabled', async () => {
    const result = await mountPulse();
    await onboard(result);
    await act(async () => {
      await result.current.updateSettings({ followUpMinutes: 0, escalateMinutes: 0 });
    });
    await act(async () => {
      await result.current.send('no follow-ups');
    });
    const thread = result.current.threads.find((t) => t.title === 'no follow-ups')!;

    const { SandboxRelay } = await import('../src/lib/relay');
    await new SandboxRelay().deregister({ deviceId: 'x', token: 'y' });

    advance(3 * 60 * 60_000);
    await act(async () => {
      await result.current.refresh();
    });

    const kinds = result.current.messages[thread.id].filter((m) => m.auto).map((m) => m.autoKind);
    expect(kinds).toEqual(['ack']);
  });
});

describe('burning and erasing', () => {
  it('burns a conversation but keeps the thread', async () => {
    const result = await mountPulse();
    await onboard(result);
    await act(async () => {
      await result.current.send('burn me');
    });
    const thread = result.current.threads.find((t) => t.title === 'burn me')!;

    await act(async () => {
      await result.current.burnThread(thread.id);
    });

    expect(result.current.messages[thread.id]).toEqual([]);
    expect(result.current.threads.some((t) => t.id === thread.id)).toBe(true);
    expect(await db.messagesFor(thread.id)).toEqual([]);
  });

  it('deletes a thread and its messages outright', async () => {
    const result = await mountPulse();
    await onboard(result);
    await act(async () => {
      await result.current.send('delete me');
    });
    const thread = result.current.threads.find((t) => t.title === 'delete me')!;

    await act(async () => {
      await result.current.deleteThread(thread.id);
    });

    expect(result.current.threads.some((t) => t.id === thread.id)).toBe(false);
    expect(await db.messagesFor(thread.id)).toEqual([]);
  });

  it('erases everything and returns to a fresh install', async () => {
    const result = await mountPulse();
    await onboard(result);
    await act(async () => {
      await result.current.send('erased soon');
    });

    await act(async () => {
      await result.current.wipe();
    });

    expect(result.current.identity).toBeNull();
    expect(result.current.threads).toEqual([]);
    expect(result.current.messages).toEqual({});
    expect(result.current.settings.onboarded).toBe(false);
    expect(await db.kvGet('identity')).toBeUndefined();
  });
});

describe('offline behaviour', () => {
  it('queues a question when the relay is unreachable and loses nothing', async () => {
    const result = await mountPulse();
    await onboard(result);

    // Point at an endpoint that cannot answer, then disable the sandbox.
    await act(async () => {
      await result.current.updateSettings({
        sandbox: false,
        relayUrl: 'https://script.google.com/macros/s/DOES_NOT_EXIST/exec',
      });
    });

    // No network in this environment: the send must not throw.
    await act(async () => {
      await result.current.send('while offline');
    });

    const thread = result.current.threads.find((t) => t.title === 'while offline');
    expect(thread).toBeDefined();

    const messages = result.current.messages[thread!.id];
    const question = messages.find((m) => m.role === 'user')!;
    expect(['queued', 'sending', 'failed']).toContain(question.status);

    // The text is still on the device, ready to retry.
    const persisted = await db.messagesFor(thread!.id);
    expect(persisted.some((m) => m.text === 'while offline')).toBe(true);

    // And no holding card lies about work in progress for a failed send.
    if (question.status === 'failed') {
      await waitFor(() => expect(result.current.messages[thread!.id].some((m) => m.auto)).toBe(false));
    }
  });
});
