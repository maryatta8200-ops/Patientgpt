import { useState } from 'react';
import { usePulse } from '../state/pulse';
import { IconBack, IconCheck, IconCopy, IconLock, IconShield, IconSparkle } from '../components/Icons';
import { PulseMark } from '../components/PulseMark';

type Step = 'gateway' | 'identity' | 'protect' | 'recovery';

export function Onboarding() {
  const { register, completeOnboarding, settings, updateSettings } = usePulse();
  const [step, setStep] = useState<Step>('gateway');
  const [alias, setAlias] = useState('');
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [wantPin, setWantPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState('');
  const [copied, setCopied] = useState(false);

  const effectiveAlias = alias.trim() || 'Anonymous';
  const pinValid = pin.length >= 4 && pin === pinConfirm;
  const canFinish = !wantPin || pinValid;

  const goProtect = () => {
    setError(null);
    setStep('protect');
  };

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await register({
        alias: effectiveAlias,
        pin: wantPin && pinValid ? pin : undefined,
      });
      setRecovery(result.recoveryCode);
      setStep('recovery');
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message}. You can continue in sandbox mode and connect a relay later.`
          : 'Registration failed',
      );
    } finally {
      setBusy(false);
    }
  };

  const copyRecovery = async () => {
    try {
      await navigator.clipboard.writeText(recovery);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copy failed — select the code and copy it manually.');
    }
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-8 pt-[max(env(safe-area-inset-top),28px)]">
      <AuroraBackdrop />

      {step !== 'gateway' && (
        <button
          onClick={() => setStep(step === 'recovery' ? 'recovery' : step === 'protect' ? 'identity' : 'gateway')}
          className="mb-4 inline-flex w-fit items-center gap-1 text-[13px] font-medium text-fog hover:text-chalk disabled:opacity-30"
          disabled={step === 'recovery'}
        >
          <IconBack size={15} /> Back
        </button>
      )}

      <div className="relative flex flex-1 flex-col">
        {step === 'gateway' && (
          <div className="anim-rise flex flex-1 flex-col">
            <div className="mb-8 flex items-center gap-3">
              <PulseMark size={44} />
              <div>
                <p className="text-[19px] font-semibold tracking-tight">Pulse</p>
                <p className="text-[12px] text-fog">Private questions, answered</p>
              </div>
            </div>

            <h1 className="text-[34px] leading-[1.08] font-semibold tracking-[-0.03em] text-balance">
              Nothing to steal,
              <br />
              <span className="bg-gradient-to-r from-aurora via-cyan to-iris bg-clip-text text-transparent">
                because nothing is kept.
              </span>
            </h1>

            <p className="mt-4 max-w-[38ch] text-[14.5px] leading-relaxed text-mist">
              Ask anything. A person or an AI answers through a relay that forgets — each message is
              deleted the instant it reaches your device.
            </p>

            <div className="mt-8 space-y-2.5">
              <Feature
                icon={<IconShield size={16} />}
                title="Local-first by design"
                body="Threads live in this browser's storage. No account, no cloud archive."
              />
              <Feature
                icon={<IconSparkle size={16} />}
                title="Burn after delivery"
                body="The relay row is wiped the moment you read the answer."
              />
              <Feature
                icon={<IconLock size={16} />}
                title="You hold the keys"
                body="Optional PIN gate, export anytime, erase everything in one tap."
              />
            </div>

            <div className="mt-auto space-y-3 pt-10">
              <div className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/4 px-3.5 py-3">
                <div>
                  <p className="text-[13px] font-semibold">Explore in sandbox</p>
                  <p className="text-[11.5px] text-fog">
                    {settings.sandbox ? 'On — replies are simulated locally' : 'Off — using your relay'}
                  </p>
                </div>
                <Switch
                  checked={settings.sandbox}
                  onChange={(v) => void updateSettings({ sandbox: v })}
                  label="Sandbox mode"
                />
              </div>
              <button className="btn btn-primary w-full" onClick={() => setStep('identity')}>
                Create my private identity
              </button>
              <p className="text-center text-[11px] leading-relaxed text-fog/80">
                No email. No phone. No password. A device key is generated here and never leaves it.
              </p>
            </div>
          </div>
        )}

        {step === 'identity' && (
          <div className="anim-rise flex flex-1 flex-col">
            <StepBadge index={1} total={3} label="Identity" />
            <h2 className="mt-4 text-[28px] font-semibold leading-tight tracking-[-0.02em]">
              Who should answers be for?
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed text-mist">
              A display name, nothing more. It is the only field the relay ever sees, and it can be a
              nickname.
            </p>

            <label className="mt-8 block">
              <span className="mb-2 block text-[12px] font-medium uppercase tracking-wider text-fog">
                Display name
              </span>
              <input
                className="field"
                placeholder="e.g. Dr. Sam, or just “S”"
                value={alias}
                maxLength={40}
                autoFocus
                onChange={(e) => setAlias(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && goProtect()}
              />
            </label>

            <div className="mt-4 rounded-2xl border border-white/8 bg-white/3 p-3.5">
              <p className="text-[12px] font-semibold text-mist">What gets created</p>
              <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-fog">
                <li className="flex gap-2">
                  <Dot /> A random device ID (UUID v4), generated on this device
                </li>
                <li className="flex gap-2">
                  <Dot /> An access token stored locally; the relay keeps only its hash
                </li>
                <li className="flex gap-2">
                  <Dot /> A one-time recovery code you will see next
                </li>
              </ul>
            </div>

            <div className="mt-auto pt-10">
              <button className="btn btn-primary w-full" onClick={goProtect}>
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 'protect' && (
          <div className="anim-rise flex flex-1 flex-col">
            <StepBadge index={2} total={3} label="Protection" />
            <h2 className="mt-4 text-[28px] font-semibold leading-tight tracking-[-0.02em]">
              Lock the front door
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed text-mist">
              A PIN is checked on this device only — it is never transmitted. It keeps someone holding
              your unlocked phone out of your threads.
            </p>

            <div className="mt-6 flex items-center justify-between rounded-2xl border border-white/8 bg-white/4 px-3.5 py-3">
              <div>
                <p className="text-[13px] font-semibold">Require a PIN to open Pulse</p>
                <p className="text-[11.5px] text-fog">Recommended · 4–8 digits</p>
              </div>
              <Switch
                checked={wantPin}
                onChange={(v) => {
                  setWantPin(v);
                  setPin('');
                  setPinConfirm('');
                }}
                label="Require a PIN"
              />
            </div>

            {wantPin && (
              <div className="anim-in mt-4 space-y-3">
                <input
                  className="field tnum tracking-[0.4em]"
                  inputMode="numeric"
                  placeholder="••••"
                  type="password"
                  maxLength={8}
                  autoFocus
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                />
                <input
                  className="field tnum tracking-[0.4em]"
                  inputMode="numeric"
                  placeholder="Repeat PIN"
                  type="password"
                  maxLength={8}
                  value={pinConfirm}
                  onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ''))}
                />
                <p
                  className={`text-[12px] ${
                    pin.length >= 4 && pin === pinConfirm ? 'text-aurora' : 'text-fog'
                  }`}
                >
                  {pin.length > 0 && pin.length < 4
                    ? 'Use at least 4 digits'
                    : pin && pinConfirm && pin !== pinConfirm
                      ? 'PINs do not match yet'
                      : pin.length >= 4 && pin === pinConfirm
                        ? 'PIN set — 210,000 PBKDF2 rounds applied locally'
                        : 'Enter your PIN twice'}
                </p>
              </div>
            )}

            <div className="mt-auto pt-10">
              <button className="btn btn-primary w-full" disabled={!canFinish || busy} onClick={finish}>
                {busy ? 'Generating identity…' : 'Generate identity'}
              </button>
              <p className="mt-3 text-center text-[11px] text-fog/80">
                You can change this later in Settings.
              </p>
              {error && (
                <div className="mt-3 rounded-xl border border-rose/25 bg-rose/8 px-3 py-2.5 text-[12px] text-rose">
                  {error}
                </div>
              )}
            </div>
          </div>
        )}

        {step === 'recovery' && (
          <div className="anim-rise flex flex-1 flex-col">
            <StepBadge index={3} total={3} label="Recovery" />
            <div className="mt-6 grid size-12 place-items-center rounded-2xl bg-aurora/12 text-aurora">
              <IconCheck size={22} />
            </div>
            <h2 className="mt-4 text-[28px] font-semibold leading-tight tracking-[-0.02em]">
              You're set up, {effectiveAlias}.
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed text-mist">
              Store this recovery code somewhere safe — a password manager or on paper. It is shown
              once and is the only way to reattach this identity on a new device.
            </p>

            <div className="mt-6 rounded-2xl border border-aurora/20 bg-aurora/6 p-4">
              <p className="text-[11px] font-medium uppercase tracking-wider text-aurora/80">
                Recovery code
              </p>
              <p className="mt-2 font-mono text-[17px] leading-relaxed tracking-[0.08em] text-chalk select-all">
                {recovery || '—'}
              </p>
              <button
                onClick={copyRecovery}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white/8 px-2.5 py-1.5 text-[12px] font-semibold"
              >
                {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
                {copied ? 'Copied' : 'Copy code'}
              </button>
            </div>

            <div className="mt-4 rounded-2xl border border-white/8 bg-white/3 p-3.5">
              <p className="text-[12px] leading-relaxed text-fog">
                Pulse cannot reset this code, and it is never stored on a server. Your device holds the
                only copy of your conversations — if you erase the app data, they are gone for good.
              </p>
            </div>

            <div className="mt-auto pt-8">
              <button
                className="btn btn-primary w-full"
                onClick={async () => {
                  await completeOnboarding();
                  location.hash = '#/';
                }}
              >
                Enter Pulse
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* --------------------------------- pieces --------------------------------- */

function AuroraBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div
        className="absolute -top-24 left-1/2 size-[420px] -translate-x-1/2 rounded-full blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(46,230,197,0.20), transparent 65%)' }}
      />
      <div
        className="absolute -right-24 top-40 size-[320px] rounded-full blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(139,123,255,0.16), transparent 65%)' }}
      />
      <div
        className="absolute -left-28 bottom-0 size-[300px] rounded-full blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(53,208,255,0.14), transparent 65%)' }}
      />
    </div>
  );
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex gap-3 rounded-2xl border border-white/7 bg-white/3 px-3.5 py-3">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-white/6 text-aurora">
        {icon}
      </span>
      <div>
        <p className="text-[13px] font-semibold text-chalk">{title}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-fog">{body}</p>
      </div>
    </div>
  );
}

function StepBadge({ index, total, label }: { index: number; total: number; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1">
        {Array.from({ length: total }).map((_, i) => (
          <span
            key={i}
            className={`h-1 w-6 rounded-full transition-colors ${
              i < index ? 'bg-aurora' : 'bg-white/12'
            }`}
          />
        ))}
      </div>
      <span className="text-[11.5px] font-medium uppercase tracking-wider text-fog">{label}</span>
    </div>
  );
}

function Dot() {
  return <span className="mt-[6px] size-1 shrink-0 rounded-full bg-aurora/70" />;
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? 'bg-aurora' : 'bg-white/14'
      }`}
    >
      <span
        className={`absolute top-0.5 size-5 rounded-full bg-ink shadow transition-transform ${
          checked ? 'translate-x-[22px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}
