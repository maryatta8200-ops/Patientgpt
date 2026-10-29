import { useEffect, useState } from 'react';
import { usePulse } from '../state/pulse';
import { Switch } from './Onboarding';
import { bytes, shortId } from '../lib/format';
import * as db from '../lib/db';
import {
  IconBack,
  IconCheck,
  IconChevron,
  IconCopy,
  IconDownload,
  IconFire,
  IconInfo,
  IconLock,
  IconShield,
  IconTrash,
  IconWifi,
} from '../components/Icons';

export function Settings({
  onBack,
  onOpenAdmin,
}: {
  onBack: () => void;
  onOpenAdmin: () => void;
}) {
  const {
    identity,
    settings,
    updateSettings,
    testRelay,
    setPin,
    pinSet,
    connection,
    lastSyncAt,
    refresh,
    exportData,
    wipe,
    notify,
  } = usePulse();

  const [url, setUrl] = useState(settings.relayUrl);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; message: string; hint?: string } | null>(null);
  const [footprint, setFootprint] = useState<{ threads: number; messages: number; bytes: number }>();
  const [pinDraft, setPinDraft] = useState('');
  const [pinEditing, setPinEditing] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [copied, setCopied] = useState('');

  useEffect(() => {
    void db.localFootprint().then(setFootprint);
  }, [identity, settings.onboarded]);

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(''), 1800);
    } catch {
      notify('Copy failed', 'Select and copy manually.', 'bad');
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    const res = await testRelay(url);
    setTest(res);
    setTesting(false);
    if (res.ok) {
      await updateSettings({ relayUrl: url.trim(), sandbox: false });
      void refresh();
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
          <h1 className="text-[15px] font-semibold">Settings</h1>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-10">
        {/* Identity */}
        <Section title="Your identity">
          <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-aurora/25 to-cyan/15 text-aurora">
                <IconShield size={17} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold">{identity?.alias ?? 'Not registered'}</p>
                <p className="text-[11.5px] text-fog">
                  Member since{' '}
                  {identity
                    ? new Date(identity.createdAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })
                    : '—'}
                </p>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              <Row label="Device ID" value={identity ? shortId(identity.deviceId, 10, 6) : '—'} mono />
              <Row
                label="Relay token"
                value={identity ? `${'•'.repeat(12)}${identity.token.slice(-4)}` : '—'}
                mono
              />
              <p className="pt-1 text-[11px] leading-relaxed text-fog/80">
                The relay stores only a SHA-256 hash of this token, paired with your device ID. No
                questions, no answers, no history.
              </p>
            </div>
          </div>
        </Section>

        {/* Relay */}
        <Section title="Relay connection">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/4 px-3.5 py-3">
              <div>
                <p className="text-[13px] font-semibold">Sandbox mode</p>
                <p className="text-[11.5px] text-fog">Simulated replies, no backend needed</p>
              </div>
              <Switch
                checked={settings.sandbox}
                onChange={(v) => void updateSettings({ sandbox: v })}
                label="Sandbox mode"
              />
            </div>

            {!settings.sandbox && (
              <div className="anim-in space-y-2">
                <label className="block">
                  <span className="mb-1.5 block text-[11.5px] font-medium uppercase tracking-wider text-fog">
                    Apps Script Web App URL
                  </span>
                  <input
                    className="field font-mono text-[12px]"
                    placeholder="https://script.google.com/macros/s/AKfy…/exec"
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      setTest(null);
                    }}
                    spellCheck={false}
                    autoCapitalize="off"
                  />
                </label>
                <button
                  onClick={runTest}
                  disabled={testing || !url.trim()}
                  className="btn btn-ghost w-full"
                >
                  {testing ? 'Testing handshake…' : 'Test & save connection'}
                </button>
                {test && (
                  <div
                    className={`rounded-xl border px-3 py-2.5 text-[12px] leading-relaxed ${
                      test.ok
                        ? 'border-aurora/25 bg-aurora/8 text-aurora'
                        : 'border-rose/25 bg-rose/8 text-rose'
                    }`}
                  >
                    <p className="flex items-center gap-1.5 font-semibold">
                      {test.ok ? <IconCheck size={13} /> : <IconWifi size={13} />}
                      {test.message}
                    </p>
                    {test.hint && <p className="mt-1 text-[11.5px] opacity-85">{test.hint}</p>}
                  </div>
                )}
              </div>
            )}

            <div className="rounded-2xl border border-white/8 bg-white/3 p-3.5">
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat label="State" value={connectionLabel(connection)} />
                <Stat label="Poll" value={`${settings.pollSeconds}s`} />
                <Stat
                  label="Last sync"
                  value={lastSyncAt ? new Date(lastSyncAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '—'}
                />
              </div>
              <label className="mt-3 block">
                <span className="mb-1.5 flex items-center justify-between text-[11.5px] text-fog">
                  <span>Poll interval</span>
                  <span className="tnum text-mist">{settings.pollSeconds}s</span>
                </span>
                <input
                  type="range"
                  min={3}
                  max={20}
                  step={1}
                  value={settings.pollSeconds}
                  onChange={(e) => void updateSettings({ pollSeconds: Number(e.target.value) })}
                  className="w-full accent-aurora"
                />
                <span className="mt-1 block text-[10.5px] leading-relaxed text-fog/80">
                  Faster polling means quicker replies and more Apps Script calls (quota: 20k/day on
                  consumer accounts).
                </span>
              </label>
            </div>

            <button onClick={onOpenAdmin} className="btn btn-ghost w-full justify-between">
              <span className="flex items-center gap-2">
                <IconInfo size={15} className="text-iris" /> Agent console
              </span>
              <IconChevron size={14} className="text-fog" />
            </button>
          </div>
        </Section>

        {/* Privacy */}
        <Section title="Privacy & local data">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/4 px-3.5 py-3">
              <div>
                <p className="text-[13px] font-semibold">PIN lock</p>
                <p className="text-[11.5px] text-fog">
                  {pinSet ? 'Enabled · PBKDF2 on this device' : 'Not set'}
                </p>
              </div>
              {pinSet ? (
                <button
                  onClick={async () => {
                    await setPin(null);
                    notify('PIN removed', 'Pulse now opens without a PIN.', 'good');
                  }}
                  className="rounded-lg bg-white/8 px-2.5 py-1.5 text-[12px] font-semibold"
                >
                  Remove
                </button>
              ) : (
                <button
                  onClick={() => setPinEditing((v) => !v)}
                  className="rounded-lg bg-white/8 px-2.5 py-1.5 text-[12px] font-semibold"
                >
                  Set PIN
                </button>
              )}
            </div>

            {pinEditing && !pinSet && (
              <div className="anim-in flex gap-2">
                <input
                  className="field tnum flex-1 tracking-[0.3em]"
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  placeholder="4–8 digits"
                  value={pinDraft}
                  onChange={(e) => setPinDraft(e.target.value.replace(/\D/g, ''))}
                />
                <button
                  className="btn btn-primary px-4"
                  disabled={pinDraft.length < 4}
                  onClick={async () => {
                    await setPin(pinDraft);
                    setPinDraft('');
                    setPinEditing(false);
                    notify('PIN enabled', 'You will be asked for it next time Pulse opens.', 'good');
                  }}
                >
                  Save
                </button>
              </div>
            )}

            <div className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/4 px-3.5 py-3">
              <div>
                <p className="text-[13px] font-semibold">Haptic feedback</p>
                <p className="text-[11.5px] text-fog">Subtle vibration on send & receive</p>
              </div>
              <Switch
                checked={settings.haptics}
                onChange={(v) => void updateSettings({ haptics: v })}
                label="Haptic feedback"
              />
            </div>

            <div className="rounded-2xl border border-white/8 bg-white/3 p-3.5">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-mist">
                <IconLock size={13} className="text-aurora" /> On this device
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <Stat label="Threads" value={String(footprint?.threads ?? 0)} />
                <Stat label="Messages" value={String(footprint?.messages ?? 0)} />
                <Stat label="Size" value={bytes(footprint?.bytes ?? 0)} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button onClick={() => void exportData()} className="btn btn-ghost h-11 text-[13px]">
                  <IconDownload size={14} /> Export
                </button>
                <button
                  onClick={() => void copy('identity', identity?.deviceId ?? '')}
                  className="btn btn-ghost h-11 text-[13px]"
                >
                  <IconCopy size={14} /> {copied === 'identity' ? 'Copied' : 'Copy device ID'}
                </button>
              </div>
            </div>

            <button
              onClick={() => setConfirmWipe(true)}
              className="btn btn-danger w-full"
            >
              <IconTrash size={15} /> Erase everything
            </button>
            <p className="px-1 text-[11px] leading-relaxed text-fog/80">
              Erasing removes every thread, message, setting and PIN from this device, and tells the
              relay to drop your registration. Pulse cannot undo it, and there is no cloud backup to
              restore from.
            </p>
          </div>
        </Section>

        {/* About */}
        <Section title="About">
          <div className="rounded-2xl border border-white/8 bg-white/3 p-3.5">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-mist">
              <IconFire size={13} className="text-amber" /> Burn-after-read protocol
            </div>
            <ol className="mt-2 space-y-1.5 text-[11.5px] leading-relaxed text-fog">
              <li>1 · Your question is written to a single row in the relay sheet.</li>
              <li>2 · An agent (human or AI) types an answer into that row.</li>
              <li>3 · This device pulls the answer and saves it locally.</li>
              <li>4 · An acknowledgement deletes the row outright.</li>
              <li>
                5 · A time-driven trigger purges anything older than {settings.ttlMinutes} minutes, even
                if a device never comes back online.
              </li>
            </ol>
            <p className="mt-2.5 rounded-xl bg-amber/8 px-2.5 py-2 text-[11px] leading-relaxed text-amber/90">
              Honest limit: while a question is in flight (seconds to minutes) anyone with edit access
              to the sheet could read it. Pulse minimises that window; it cannot make it zero.
            </p>
          </div>
          <p className="pt-1 text-center text-[11px] text-fog/60">Pulse · version 1.0.0 · local-first</p>
        </Section>
      </div>

      {confirmWipe && (
        <div className="fixed inset-0 z-50 grid place-items-end bg-black/60 backdrop-blur-sm sm:place-items-center">
          <div className="glass-strong anim-rise w-full max-w-[420px] rounded-t-3xl p-5 sm:rounded-3xl">
            <div className="grid size-11 place-items-center rounded-2xl bg-rose/12 text-rose">
              <IconFire size={20} />
            </div>
            <h2 className="mt-3 text-[18px] font-semibold">Erase everything?</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-fog">
              This deletes all threads and messages from this device and drops your relay registration.
              There is no undo and no remote copy to recover.
            </p>
            <div className="mt-4 space-y-2">
              <button
                className="btn btn-danger w-full"
                onClick={async () => {
                  setConfirmWipe(false);
                  await wipe();
                }}
              >
                Yes, erase it all
              </button>
              <button className="btn btn-ghost w-full" onClick={() => setConfirmWipe(false)}>
                Keep my data
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function connectionLabel(c: string) {
  switch (c) {
    case 'online':
      return 'Online';
    case 'offline':
      return 'Offline';
    case 'error':
      return 'Error';
    case 'sandbox':
      return 'Sandbox';
    default:
      return '—';
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-fog">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/4 px-2 py-2">
      <p className="text-[10px] uppercase tracking-wider text-fog/80">{label}</p>
      <p className="mt-0.5 truncate text-[12.5px] font-semibold text-chalk">{value}</p>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[11.5px]">
      <span className="text-fog">{label}</span>
      <span className={`truncate text-mist ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}
