import { useEffect, useState } from 'react';
import { usePulse } from '../state/pulse';
import { IconAlert, IconCheck, IconClose, IconDownload, IconInfo } from './Icons';

export function Toasts() {
  const { toasts, dismissToast } = usePulse();

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-2 px-3 pt-[max(env(safe-area-inset-top),12px)]">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="glass-strong anim-in pointer-events-auto flex w-full max-w-[420px] items-start gap-3 rounded-2xl px-3.5 py-3 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.95)]"
        >
          <span
            className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full"
            style={{
              background:
                t.tone === 'good'
                  ? 'rgba(46,230,197,0.14)'
                  : t.tone === 'bad'
                    ? 'rgba(255,122,144,0.14)'
                    : 'rgba(255,255,255,0.07)',
              color:
                t.tone === 'good' ? '#2ee6c5' : t.tone === 'bad' ? '#ff7a90' : 'var(--color-mist)',
            }}
          >
            {t.tone === 'good' ? (
              <IconCheck size={15} />
            ) : t.tone === 'bad' ? (
              <IconAlert size={15} />
            ) : (
              <IconInfo size={15} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-semibold text-chalk">{t.title}</p>
            {t.body && <p className="mt-0.5 text-[12.5px] leading-snug text-fog">{t.body}</p>}
          </div>
          <button
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss"
            className="rounded-full p-1 text-fog hover:text-chalk"
          >
            <IconClose size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'pulse.install.dismissed';

export function InstallBanner({ onOpenGuide }: { onOpenGuide: () => void }) {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(() => localStorage.getItem(DISMISS_KEY) === '1');
  const [standalone] = useState(
    () =>
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true,
  );

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (standalone || hidden) return null;

  const install = async () => {
    if (evt) {
      await evt.prompt();
      const choice = await evt.userChoice;
      if (choice.outcome === 'accepted') setHidden(true);
      setEvt(null);
      return;
    }
    onOpenGuide();
  };

  return (
    <div className="anim-in mx-4 mb-2 flex items-center gap-3 rounded-2xl border border-white/8 bg-white/4 px-3 py-2.5">
      <span className="grid size-8 place-items-center rounded-xl bg-aurora/12 text-aurora">
        <IconDownload size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-chalk">Install Pulse</p>
        <p className="truncate text-[11.5px] text-fog">Works offline, launches full screen.</p>
      </div>
      <button onClick={install} className="rounded-lg bg-white/8 px-2.5 py-1.5 text-[12px] font-semibold">
        Add
      </button>
      <button
        onClick={() => {
          setHidden(true);
          localStorage.setItem(DISMISS_KEY, '1');
        }}
        aria-label="Dismiss install banner"
        className="p-1 text-fog hover:text-chalk"
      >
        <IconClose size={13} />
      </button>
    </div>
  );
}
