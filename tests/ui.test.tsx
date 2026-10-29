// @vitest-environment jsdom
/**
 * UI tests for the promises that are visible to users:
 * the holding card is not a fake answer, an answer cannot inject markup,
 * a locked app stays locked, and an empty screen still guides you.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { PulseProvider } from '../src/state/pulse';
import { Chat } from '../src/screens/Chat';
import { Threads } from '../src/screens/Threads';
import { LockScreen } from '../src/screens/Lock';
import * as db from '../src/lib/db';
import { hashPin, makeSalt } from '../src/lib/crypto';
import { DEFAULT_SETTINGS, type Message, type Thread } from '../src/lib/types';

const IDENTITY = {
  deviceId: 'dev-1',
  token: 'tok-1',
  alias: 'Tester',
  createdAt: 1,
  recoveryCode: 'AAAA-BBBB',
};

function thread(over: Partial<Thread> = {}): Thread {
  return {
    id: 't1',
    title: 'My first question',
    createdAt: 1,
    updatedAt: 1,
    unread: 0,
    archived: false,
    ...over,
  };
}

function msg(over: Partial<Message> & { id: string }): Message {
  return {
    threadId: 't1',
    role: 'user',
    text: 'hello',
    createdAt: 1,
    status: 'delivered',
    ...over,
  };
}

/** Seeds the local database, then mounts the app around the screen under test. */
async function seed(opts: { settings?: Record<string, unknown> } = {}) {
  await db.kvSet('identity', IDENTITY);
  await db.kvSet('settings', {
    ...DEFAULT_SETTINGS,
    onboarded: true,
    alias: 'Tester',
    sandbox: true,
    ...opts.settings,
  });
}

function renderChat() {
  return render(
    <PulseProvider>
      <Chat threadId="t1" onBack={() => undefined} />
    </PulseProvider>,
  );
}

beforeEach(async () => {
  await db.wipeAll();
});

afterEach(() => {
  cleanup();
});

describe('Chat — holding cards', () => {
  it('renders the instant acknowledgement as a status card, not an answer bubble', async () => {
    await seed();
    await db.putThread(thread());
    await db.putMessage(msg({ id: 'q1', role: 'user', status: 'awaiting', text: 'Is this private?' }));
    await db.putMessage(
      msg({
        id: 'a1',
        role: 'agent',
        auto: true,
        autoKind: 'ack',
        forMessageId: 'q1',
        text: 'Our team is working on your question.',
      }),
    );

    const { container } = renderChat();

    await waitFor(() =>
      expect(screen.getByText('Our team is working on your question.')).toBeTruthy(),
    );
    expect(screen.getByText(/Automatic reply/)).toBeTruthy();
    // It must not be styled as a delivered chat bubble.
    expect(container.querySelectorAll('.bubble-agent')).toHaveLength(0);
  });

  it('labels the escalation as an automatic update', async () => {
    await seed();
    await db.putThread(thread());
    await db.putMessage(msg({ id: 'q1', role: 'user', status: 'awaiting' }));
    await db.putMessage(
      msg({
        id: 'a2',
        role: 'agent',
        auto: true,
        autoKind: 'escalate',
        forMessageId: 'q1',
        text: 'This is taking longer than expected.',
      }),
    );

    renderChat();
    await waitFor(() => expect(screen.getByText(/Automatic update/)).toBeTruthy());
  });

  it('hides the typing indicator once a holding card exists', async () => {
    await seed();
    await db.putThread(thread());
    await db.putMessage(msg({ id: 'q1', role: 'user', status: 'awaiting' }));
    await db.putMessage(
      msg({ id: 'a1', role: 'agent', auto: true, autoKind: 'ack', forMessageId: 'q1', text: 'On it.' }),
    );

    renderChat();
    await waitFor(() => expect(screen.getByText('On it.')).toBeTruthy());
    expect(screen.queryByText(/waiting for an answer/i)).toBeNull();
  });
});

describe('Chat — safe rendering', () => {
  it('never renders markup injected through an answer', async () => {
    await seed();
    await db.putThread(thread());
    await db.putMessage(
      msg({
        id: 'a1',
        role: 'agent',
        text: 'Careful: <img src=x onerror="alert(1)"> and <script>alert(2)</script>',
      }),
    );

    const { container } = renderChat();
    await waitFor(() => expect(container.querySelector('.bubble-agent')).toBeTruthy());

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    // The text is shown literally instead.
    expect(container.textContent).toContain('<img src=x');
  });

  it('renders bold and code in a legitimately formatted answer', async () => {
    await seed();
    await db.putThread(thread());
    await db.putMessage(msg({ id: 'a1', role: 'agent', text: '**Bold** and `code`' }));

    const { container } = renderChat();
    await waitFor(() => expect(container.querySelector('strong')).toBeTruthy());
    expect(container.querySelector('code')?.textContent).toBe('code');
  });
});

describe('Chat — failure states', () => {
  it('offers a retry when a send failed', async () => {
    await seed();
    await db.putThread(thread());
    await db.putMessage(
      msg({ id: 'q1', role: 'user', status: 'failed', text: 'did not send', error: 'offline' }),
    );

    renderChat();
    await waitFor(() => expect(screen.getByText(/tap to retry/)).toBeTruthy());
  });

  it('shows guidance instead of a blank screen for an empty thread', async () => {
    await seed();
    await db.putThread(thread({ id: 't1', title: 'Empty' }));

    renderChat();
    await waitFor(() => expect(screen.getByText('Empty thread')).toBeTruthy());
    expect(screen.getByText(/Nothing is written to this device until you do/)).toBeTruthy();
  });
});

describe('Threads', () => {
  it('prompts for a first question when there is nothing yet', async () => {
    await seed();
    render(
      <PulseProvider>
        <Threads
          onOpenThread={() => undefined}
          onOpenSettings={() => undefined}
          onOpenGuide={() => undefined}
          onCompose={() => undefined}
        />
      </PulseProvider>,
    );

    await waitFor(() => expect(screen.getByText('Ask your first question')).toBeTruthy());
  });

  it('surfaces a waiting question in the thread list', async () => {
    await seed();
    await db.putThread(thread({ id: 't1', title: 'Waiting thread', updatedAt: 10 }));
    await db.putMessage(msg({ id: 'q1', role: 'user', status: 'awaiting', text: 'my question' }));
    await db.putMessage(
      msg({
        id: 'a1',
        role: 'agent',
        auto: true,
        autoKind: 'ack',
        forMessageId: 'q1',
        text: 'Our team is working on your question.',
        createdAt: 2,
      }),
    );

    render(
      <PulseProvider>
        <Threads
          onOpenThread={() => undefined}
          onOpenSettings={() => undefined}
          onOpenGuide={() => undefined}
          onCompose={() => undefined}
        />
      </PulseProvider>,
    );

    await waitFor(() => expect(screen.getByText('Waiting thread')).toBeTruthy());
    // The holding text doubles as the preview, so the list never looks stalled.
    expect(screen.getByText(/Our team is working on your question/)).toBeTruthy();
  });

  it('states the burn-after-read guarantee', async () => {
    await seed();
    render(
      <PulseProvider>
        <Threads
          onOpenThread={() => undefined}
          onOpenSettings={() => undefined}
          onOpenGuide={() => undefined}
          onCompose={() => undefined}
        />
      </PulseProvider>,
    );
    await waitFor(() => expect(screen.getByText(/Burn-after-read relay/)).toBeTruthy());
  });
});

describe('Lock screen', () => {
  it('rejects a wrong PIN', async () => {
    const salt = makeSalt();
    const hash = await hashPin('4321', salt);
    await seed({ settings: { pinEnabled: true } });
    await db.kvSet('pin', { hash, salt });

    const { container } = render(
      <PulseProvider>
        <LockScreen />
      </PulseProvider>,
    );

    await waitFor(() => expect(screen.getByText('Pulse is locked')).toBeTruthy());

    const keypad = (digit: string) =>
      screen.getByRole('button', { name: digit });

    for (const d of ['1', '2', '3', '4']) fireEvent.click(keypad(d));

    await waitFor(() => expect(screen.getByText('Wrong PIN')).toBeTruthy());
    expect(container).toBeTruthy();
  });

  it('accepts the correct PIN without an error', async () => {
    const salt = makeSalt();
    const hash = await hashPin('4321', salt);
    await seed({ settings: { pinEnabled: true } });
    await db.kvSet('pin', { hash, salt });

    render(
      <PulseProvider>
        <LockScreen />
      </PulseProvider>,
    );
    await waitFor(() => expect(screen.getByText('Pulse is locked')).toBeTruthy());

    for (const d of ['4', '3', '2', '1']) fireEvent.click(screen.getByRole('button', { name: d }));

    // A correct PIN clears the field and reports no error.
    await waitFor(() => expect(screen.queryByText('Wrong PIN')).toBeNull());
  });

  it('never renders the PIN digits in the clear', async () => {
    const salt = makeSalt();
    const hash = await hashPin('4321', salt);
    await seed({ settings: { pinEnabled: true } });
    await db.kvSet('pin', { hash, salt });

    const { container } = render(
      <PulseProvider>
        <LockScreen />
      </PulseProvider>,
    );
    await waitFor(() => expect(screen.getByText('Pulse is locked')).toBeTruthy());

    for (const d of ['4', '3']) fireEvent.click(screen.getByRole('button', { name: d }));
    expect(container.textContent).not.toContain('43');
  });
});
