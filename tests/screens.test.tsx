// @vitest-environment jsdom
/**
 * First-run and data-ownership screens.
 *
 * Onboarding is the only path to an identity, and Settings holds every
 * destructive action, so both are worth pinning down.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { PulseProvider } from '../src/state/pulse';
import { Onboarding } from '../src/screens/Onboarding';
import { Settings } from '../src/screens/Settings';
import * as db from '../src/lib/db';
import { DEFAULT_SETTINGS } from '../src/lib/types';

const IDENTITY = {
  deviceId: '123e4567-e89b-42d3-a456-426614174000',
  token: 'tok-1',
  alias: 'Tester',
  createdAt: Date.UTC(2026, 0, 15),
  recoveryCode: 'AAAA-BBBB',
};

function renderOnboarding() {
  return render(
    <PulseProvider>
      <Onboarding />
    </PulseProvider>,
  );
}

function renderSettings() {
  return render(
    <PulseProvider>
      <Settings onBack={() => undefined} onOpenAdmin={() => undefined} />
    </PulseProvider>,
  );
}

beforeEach(async () => {
  await db.wipeAll();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('Onboarding', () => {
  it('opens with the guarantee and the sandbox explained', async () => {
    renderOnboarding();
    expect(await screen.findByText(/Nothing to steal/)).toBeTruthy();
    expect(screen.getByText(/Explore in sandbox/)).toBeTruthy();
  });

  it('walks identity → protection → recovery', async () => {
    renderOnboarding();

    fireEvent.click(await screen.findByRole('button', { name: /Create my private identity/ }));
    expect(await screen.findByText(/Who should answers be for/)).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText(/Dr\. Sam/), { target: { value: 'Ada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText(/Lock the front door/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Generate identity/ }));

    // The one-time code must be shown before entering the app.
    await waitFor(() => expect(screen.getByText(/You're set up, Ada/)).toBeTruthy());
    expect(screen.getByText('Recovery code')).toBeTruthy();
    expect(screen.getByText(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/)).toBeTruthy();
  });

  it('does not mark onboarding complete until the recovery code is acknowledged', async () => {
    renderOnboarding();

    fireEvent.click(await screen.findByRole('button', { name: /Create my private identity/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByRole('button', { name: /Generate identity/ }));

    await waitFor(() => expect(screen.getByText(/You're set up/)).toBeTruthy());
    const settings = await db.kvGet<{ onboarded: boolean }>('settings');
    expect(settings?.onboarded).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /Enter Pulse/ }));
    await waitFor(async () => {
      const after = await db.kvGet<{ onboarded: boolean }>('settings');
      expect(after?.onboarded).toBe(true);
    });
  });

  it('requires matching PINs before it will generate', async () => {
    renderOnboarding();

    fireEvent.click(await screen.findByRole('button', { name: /Create my private identity/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    await screen.findByText(/Lock the front door/);

    fireEvent.click(screen.getByRole('switch', { name: 'Require a PIN' }));
    const [first, second] = screen.getAllByPlaceholderText(/••••|Repeat PIN/);

    fireEvent.change(first, { target: { value: '1234' } });
    fireEvent.change(second, { target: { value: '9999' } });

    expect(await screen.findByText(/do not match/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Generate identity/ })).toHaveProperty('disabled', true);
  });

  it('defaults to Anonymous when no name is given', async () => {
    renderOnboarding();
    fireEvent.click(await screen.findByRole('button', { name: /Create my private identity/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByRole('button', { name: /Generate identity/ }));

    await waitFor(() => expect(screen.getByText(/You're set up, Anonymous/)).toBeTruthy());
    const identity = await db.kvGet<{ alias: string }>('identity');
    expect(identity?.alias).toBe('Anonymous');
  });
});

describe('Settings', () => {
  beforeEach(async () => {
    await db.kvSet('identity', IDENTITY);
    await db.kvSet('settings', { ...DEFAULT_SETTINGS, onboarded: true, alias: 'Tester' });
  });

  it('shows the identity and the local-data footprint', async () => {
    renderSettings();
    expect(await screen.findByText('Tester')).toBeTruthy();
    expect(screen.getByText('Device ID')).toBeTruthy();
    expect(screen.getByText(/Relay token/)).toBeTruthy();
    expect(screen.getByText('On this device')).toBeTruthy();
  });

  it('never shows the full token, and truncates the device id', async () => {
    const { container } = renderSettings();
    await screen.findByText('Tester');

    // The token is the secret: only its last four characters are ever rendered.
    expect(container.textContent).not.toContain('tok-1');
    expect(container.textContent).toContain('ok-1');

    // The device id is an identifier, but it is still shown abbreviated.
    expect(container.textContent).not.toContain('123e4567-e89b-42d3-a456-426614174000');
    expect(container.textContent).toContain('123e4567-e');
  });

  it('reveals the relay URL field when sandbox mode is turned off', async () => {
    renderSettings();
    await screen.findByText('Tester');

    expect(screen.queryByPlaceholderText(/script\.google\.com/)).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'Sandbox mode' }));

    await waitFor(() =>
      expect(screen.getByPlaceholderText(/script\.google\.com/)).toBeTruthy(),
    );
  });

  it('states the honest limit of the relay', async () => {
    renderSettings();
    expect(await screen.findByText(/Honest limit/)).toBeTruthy();
  });

  it('requires confirmation before erasing anything', async () => {
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: /Erase everything/ }));

    await waitFor(() => expect(screen.getByText(/Erase everything\?/)).toBeTruthy());
    // Nothing has been deleted yet.
    expect(await db.kvGet('identity')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Keep my data/ }));
    expect(await db.kvGet('identity')).toBeTruthy();
  });

  it('erases identity and settings only after explicit confirmation', async () => {
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: /Erase everything/ }));
    await waitFor(() => expect(screen.getByText(/Erase everything\?/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Yes, erase it all/ }));

    await waitFor(async () => {
      expect(await db.kvGet('identity')).toBeUndefined();
    });
  });

  it('shows the automatic acknowledgement text in a live preview', async () => {
    renderSettings();
    expect(await screen.findByText(/Instant holding reply/)).toBeTruthy();
    expect(screen.getAllByText(/Our team is working on your question\./).length).toBeGreaterThan(0);
  });
});
