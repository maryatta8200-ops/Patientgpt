import { IconDownload, IconSparkle } from '../components/Icons';

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

export function InstallGuide({ onDone }: { onDone: () => void }) {
  return (
    <div>
      <div className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-aurora/25 to-cyan/15 text-aurora">
        <IconDownload size={20} />
      </div>
      <h2 className="mt-3 text-[19px] font-semibold tracking-tight">Install Pulse</h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-fog">
        Installed, Pulse launches full screen, starts instantly from cache, and can queue questions
        while you are offline.
      </p>

      <ol className="mt-4 space-y-2.5">
        {(isIOS
          ? [
              ['Open in Safari', 'Chrome and Firefox on iOS cannot install PWAs.'],
              ['Tap the Share button', 'The square with an arrow, in the toolbar.'],
              ['Choose “Add to Home Screen”', 'Then tap Add — Pulse appears as an app icon.'],
            ]
          : [
              ['Use Chrome, Edge or Brave', 'Any Chromium browser installs Pulse natively.'],
              ['Open the browser menu', 'The ⋮ button, top right.'],
              ['Tap “Install app” or “Add to Home screen”', 'Confirm to finish.'],
            ]
        ).map(([title, body], i) => (
          <li key={title} className="flex gap-3 rounded-2xl border border-white/8 bg-white/3 p-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-white/8 text-[11px] font-bold text-mist">
              {i + 1}
            </span>
            <div>
              <p className="text-[12.5px] font-semibold text-chalk">{title}</p>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-fog">{body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-4 flex gap-2 rounded-2xl border border-aurora/18 bg-aurora/6 p-3">
        <IconSparkle size={14} className="mt-0.5 shrink-0 text-aurora" />
        <p className="text-[11.5px] leading-relaxed text-mist/90">
          Your conversations live in this browser's storage. Installing does not move them anywhere —
          backing up is what <span className="font-semibold">Export</span> in Settings is for.
        </p>
      </div>

      <button className="btn btn-primary mt-4 w-full" onClick={onDone}>
        Got it
      </button>
    </div>
  );
}
