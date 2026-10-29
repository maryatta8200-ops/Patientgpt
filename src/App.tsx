import { useCallback, useEffect, useState } from 'react';
import { PulseProvider, usePulse } from './state/pulse';
import { Toasts } from './components/Toasts';
import { Onboarding } from './screens/Onboarding';
import { LockScreen } from './screens/Lock';
import { Threads } from './screens/Threads';
import { Chat } from './screens/Chat';
import { Settings } from './screens/Settings';
import { Admin } from './screens/Admin';
import { InstallGuide } from './screens/InstallGuide';
import { PulseMark } from './components/PulseMark';
import { IconClose } from './components/Icons';

type Route =
  | { name: 'threads' }
  | { name: 'chat'; threadId: string }
  | { name: 'settings' }
  | { name: 'admin' };

export default function App() {
  return (
    <PulseProvider>
      <Shell />
      <Toasts />
    </PulseProvider>
  );
}

function Shell() {
  const { ready, identity, locked, settings, newThread, notify, refresh } = usePulse();
  const [route, setRoute] = useState<Route>({ name: 'threads' });
  const [guide, setGuide] = useState(false);

  /* --------------------------------- router -------------------------------- */

  const go = useCallback((next: Route) => {
    setRoute(next);
    const hash =
      next.name === 'threads' ? '#/' : next.name === 'chat' ? `#/t/${next.threadId}` : `#/${next.name}`;
    if (location.hash !== hash) history.pushState(null, '', hash);
  }, []);

  useEffect(() => {
    const parse = () => {
      const hash = location.hash.replace(/^#/, '');
      if (hash.startsWith('/t/')) setRoute({ name: 'chat', threadId: hash.slice(3) });
      else if (hash === '/settings') setRoute({ name: 'settings' });
      else if (hash === '/admin') setRoute({ name: 'admin' });
      else setRoute({ name: 'threads' });
    };
    parse();
    window.addEventListener('popstate', parse);
    window.addEventListener('hashchange', parse);
    return () => {
      window.removeEventListener('popstate', parse);
      window.removeEventListener('hashchange', parse);
    };
  }, []);

  /* ------------------------------ back gesture ----------------------------- */

  useEffect(() => {
    if (route.name !== 'threads' && !history.state?.pulse) {
      history.replaceState({ pulse: true }, '');
    }
  }, [route]);

  /* -------------------------- service worker notice ------------------------ */

  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => {
    const handler = () => setUpdateReady(true);
    window.addEventListener('pulse:update', handler);
    return () => window.removeEventListener('pulse:update', handler);
  }, []);

  /* --------------------------------- render -------------------------------- */

  if (!ready) {
    return (
      <main className="pulse-stage grid place-items-center">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-pulse">
            <PulseMark size={54} />
          </div>
          <p className="text-[12px] tracking-wide text-fog">Opening your local vault…</p>
        </div>
      </main>
    );
  }

  const needsOnboarding = !settings.onboarded || !identity;

  return (
    <main className="pulse-stage">
      <div className="app-frame">
        {needsOnboarding ? (
          <Onboarding />
        ) : locked ? (
          <LockScreen />
        ) : (
          <>
            {route.name === 'threads' && (
              <Threads
                onOpenThread={(id) => go({ name: 'chat', threadId: id })}
                onOpenSettings={() => go({ name: 'settings' })}
                onOpenGuide={() => setGuide(true)}
                onCompose={() => {
                  go({ name: 'chat', threadId: newThread() });
                }}
              />
            )}
            {route.name === 'chat' && (
              <Chat threadId={route.threadId} onBack={() => go({ name: 'threads' })} />
            )}
            {route.name === 'settings' && (
              <Settings onBack={() => go({ name: 'threads' })} onOpenAdmin={() => go({ name: 'admin' })} />
            )}
            {route.name === 'admin' && <Admin onBack={() => go({ name: 'settings' })} />}
          </>
        )}

        {updateReady && (
          <div className="anim-in absolute inset-x-3 bottom-3 z-40 flex items-center gap-3 rounded-2xl border border-aurora/25 bg-surface/95 px-3.5 py-2.5 backdrop-blur-xl">
            <span className="text-[12.5px] text-mist">A new version of Pulse is ready.</span>
            <button
              onClick={() => location.reload()}
              className="ml-auto rounded-lg bg-aurora px-2.5 py-1.5 text-[12px] font-semibold text-ink"
            >
              Reload
            </button>
          </div>
        )}
      </div>

      {guide && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 px-4 backdrop-blur-sm">
          <div className="glass-strong anim-rise relative max-h-[85dvh] w-full max-w-[420px] overflow-y-auto rounded-3xl p-5">
            <button
              onClick={() => setGuide(false)}
              aria-label="Close"
              className="absolute right-3 top-3 grid size-8 place-items-center rounded-full bg-white/6 text-mist"
            >
              <IconClose size={15} />
            </button>
            <InstallGuide
              onDone={() => {
                setGuide(false);
                notify('Ready when you are', 'Pulse works offline once installed.', 'good');
                void refresh();
              }}
            />
          </div>
        </div>
      )}
    </main>
  );
}
