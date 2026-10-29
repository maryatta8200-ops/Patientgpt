import { useEffect, useRef, useState } from 'react';
import { usePulse } from '../state/pulse';
import { PulseMark } from '../components/PulseMark';
import { haptic } from '../lib/format';
import { IconLock } from '../components/Icons';

const MAX_ATTEMPTS = 6;

export function LockScreen() {
  const { unlock, settings } = usePulse();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const busy = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => window.clearInterval(t);
  }, [cooldown]);

  useEffect(() => {
    if (pin.length < 4 || busy.current || cooldown > 0) return;
    busy.current = true;
    (async () => {
      const ok = await unlock(pin);
      if (ok) {
        haptic(12, settings.haptics);
      } else {
        haptic([12, 60, 12], settings.haptics);
        const next = attempts + 1;
        setAttempts(next);
        setPin('');
        setError('Wrong PIN');
        if (next >= MAX_ATTEMPTS) {
          setCooldown(30);
          setAttempts(0);
          setError('Too many attempts. Wait 30 seconds.');
        }
      }
      busy.current = false;
    })();
  }, [pin, attempts, unlock, cooldown, settings.haptics]);

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-8 py-6">
      <PulseMark size={54} />
      <div className="mt-6 grid size-11 place-items-center rounded-2xl bg-white/6 text-mist">
        <IconLock size={20} />
      </div>
      <h1 className="mt-4 text-[19px] font-semibold tracking-tight">Pulse is locked</h1>
      <p className="mt-1 text-center text-[13px] text-fog">
        {cooldown > 0 ? `Try again in ${cooldown}s` : 'Enter your PIN to open your threads'}
      </p>

      <div className="mt-7 flex gap-2.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <span
            key={i}
            className={`size-3 rounded-full transition-all ${
              i < pin.length ? 'scale-110 bg-aurora' : 'bg-white/12'
            }`}
          />
        ))}
      </div>

      <input
        aria-label="PIN"
        autoFocus
        inputMode="numeric"
        type="password"
        maxLength={8}
        value={pin}
        disabled={cooldown > 0}
        onChange={(e) => {
          setError('');
          setPin(e.target.value.replace(/\D/g, ''));
        }}
        className="absolute size-0 opacity-0"
      />

      <p className="mt-4 h-4 text-[12px] text-rose">{error}</p>

      <div className="mt-2 grid w-full max-w-[260px] grid-cols-3 gap-2.5">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((key, i) =>
          key === '' ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              disabled={cooldown > 0}
              onClick={() => {
                haptic(4, settings.haptics);
                if (key === '⌫') setPin((p) => p.slice(0, -1));
                else if (pin.length < 8) setPin((p) => p + key);
              }}
              className="h-14 rounded-2xl border border-white/8 bg-white/4 text-[19px] font-medium text-chalk transition active:scale-95 active:bg-white/10 disabled:opacity-40"
            >
              {key}
            </button>
          ),
        )}
      </div>
      <p className="mt-8 px-6 text-center text-[11px] leading-relaxed text-fog/70">
        Your PIN is verified on this device with PBKDF2. It is never sent anywhere.
      </p>
    </div>
  );
}
