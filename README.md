# Pulse

**Private questions, answered — and nothing kept.**

Pulse is a premium, installable PWA that lets a person ask questions and receive answers from a
human or an AI, using **Google Sheets as a burn-after-read relay**. Every conversation lives on the
asker's device. The sheet is a mailbox, not a database: a question exists only between *asked* and
*delivered*, and the row is deleted the instant the answer reaches the device.

```
        ┌──────────────────────┐
        │  Pulse PWA (device)  │   ← the only place your data lives
        │  IndexedDB + SW      │
        └──────────┬───────────┘
                   │  HTTPS · text/plain POST · no preflight
        ┌──────────▼───────────┐
        │  Apps Script relay   │   ← verifies, appends, purges
        └──────────┬───────────┘
        ┌──────────▼───────────┐
        │  Google Sheet        │
        │  Registry  (hashes)  │   persistent, contains no user data
        │  Mailbox   (ephemeral)│  deleted on ack + TTL sweeper
        │  Log       (counts)  │   no content, ever
        └──────────▲───────────┘
                   │  you, or any AI, type into the `answer` column
```

---

## Why this design

Most "chat over a spreadsheet" tools treat the sheet as the database, which means every message is
permanently readable by anyone with the link. Pulse inverts that:

| Concern | How Pulse handles it |
|---|---|
| Where conversations live | IndexedDB on the device. Export/erase are one tap. |
| What the sheet keeps | A registry row per device containing `deviceId`, `sha256(token)`, alias, timestamps. No questions, no answers. |
| Lifetime of a message | Until delivery. The client acknowledges receipt and the relay deletes the row. |
| If a device never comes back | A 5-minute trigger purges everything past its TTL (default 15 min). |
| If the sheet leaks | There is no history to leak — only aliases and hashes. |
| Identity | A locally generated UUID + CSPRNG token. No email, phone, or password. |
| Device theft | Optional PIN gate, verified on-device with PBKDF2-SHA256 (210k rounds). |

**The honest limit.** While a question is in flight — seconds to minutes — anyone with *edit* access
to the sheet can read it. That is inherent to "answer through a Google Sheet." Pulse shrinks that
window and guarantees no residue, but it cannot make the window zero. This is stated in-app, not
buried here.

---

## Quick start (no backend, 30 seconds)

```bash
npm install
npm run dev
```

Open the app, leave **Sandbox mode** on, and ask a question. A local simulator answers in ~2.6 s and
the message row is burned immediately. The entire product loop is exercised with no Google account.

## Deploy the relay (10 minutes, once)

1. Create a Google Sheet — any name, e.g. `Pulse Relay`.
2. **Extensions → Apps Script**. Delete the stub, paste all of [`apps-script/Code.gs`](apps-script/Code.gs).
3. Project Settings → tick **Show `appsscript.json` manifest file**, then replace it with
   [`apps-script/appsscript.json`](apps-script/appsscript.json) (or just confirm runtime V8).
4. Back in the sheet, reload the tab. A **Pulse** menu appears → **Set up relay**.
   This creates the three sheets, generates your admin key, sets the TTL, and installs the purge
   trigger, then shows you the admin key. **Save that key.**
5. **Deploy → New deployment → Web app**
   - Description: `Pulse relay`
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Deploy, authorise, and copy the `/exec` URL.
6. In Pulse → **Settings → Relay connection** → turn **Sandbox mode off**, paste the URL, tap
   **Test & save connection**. You should see `Relay v1.0.0 answered in N ms`.

> Use "Anyone", not "Anyone with a Google account" — otherwise the relay returns a login page and the
> app reports *"Relay returned a web page, not data."*

## Deploy the app

```bash
npm run build      # → dist/ (static, no server needed)
```

| Host | How |
|---|---|
| **Vercel** | `vercel deploy --prod` — `vercel.json` already sets rewrites, CSP and cache headers. |
| **Netlify** | Drag `dist/` in, or `netlify deploy --prod --dir=dist`. Config in `netlify.toml`. |
| **GitHub Pages** | Push `dist/` to `gh-pages`. PWA install and the service worker need HTTPS — Pages provides it. |
| **Any static host** | Upload `dist/`. Must be served over HTTPS for the service worker. |

Then install it: **Chrome/Edge → ⋮ → Install app**, or **iOS Safari → Share → Add to Home Screen**.

---

## Answering questions

Two supported ways. Both write to the same column, so a human and an AI are interchangeable.

### 1. Directly in the sheet

Open the **Pulse · Mailbox** tab. Each `new` row is a live question. Type your reply into the
`answer` column and change `status` from `new` to `answered`.

The asker's device polls, pulls it, stores it locally, and the row is **deleted** on acknowledgement.

### 2. Agent Console (built into the PWA)

Settings → **Agent console** → paste the admin key. You get an inbox of waiting questions, a reply
box per question, and an auto-refresh. The key is held in `sessionStorage` for that tab only. It is
never written to IndexedDB, never synced, and never included in an export.

### 3. Wire up an AI (optional)

Set the script property `AI_WEBHOOK_URL` on the Apps Script project. Every new question is POSTed to
it as `{ relayId, question }` (fire-and-forget, failures never block delivery). Your worker replies
by calling the same Web App:

```bash
curl -s -X POST "$RELAY_URL" -H 'Content-Type: text/plain' \
  -d '{"action":"adminReply","adminKey":"…","relayId":"r_…","answer":"…"}'
```

That is the whole integration surface: one endpoint in, one endpoint out.

---

## Security model

| Layer | Implementation |
|---|---|
| Transport | HTTPS only. Tokens are compared as SHA-256 hashes, in constant time. |
| CORS | The client posts `text/plain` so no preflight is sent (Apps Script cannot answer one); Google still returns `Access-Control-Allow-Origin: *`. |
| Auth | `deviceId` (UUID v4) + 40-char CSPRNG token, issued at registration. Revocable from the sheet menu. |
| Rate limits | 200 asks/day/device, 1.5 s minimum gap, 4 000-char questions, 500 registrations/day/script. |
| Concurrency | `LockService` around every append/delete so two devices cannot corrupt the mailbox. |
| Retention | Deleted on `ack`; TTL sweeper every 5 min; unanswerable rows dropped after 24 h. |
| Rendering | Answers are escaped before any markup is applied — `dangerouslySetInnerHTML` only ever receives text that has been HTML-escaped first. |
| Headers | CSP, `nosniff`, `no-referrer`, `Permissions-Policy` locked down in `vercel.json` / `netlify.toml`. |
| Dependencies | React only. Zero analytics, zero fonts, zero CDN calls. |
| Service worker | Explicitly refuses to cache anything from `google.com` / `googleusercontent.com`. |

### Threat table

| Attacker capability | Result |
|---|---|
| Reads the sheet file | Sees aliases, device UUIDs, token **hashes**, timestamps. No message content. |
| Reads the sheet during the delivery window | Can see a question in flight. Mitigated by TTL + instant ack; not eliminable by design. |
| Steals the registry | Hashes are SHA-256 of 40-char CSPRNG tokens — not brute-forceable. |
| Steals an unlocked device | PIN gate (if enabled) + the OS lock screen. |
| Steals the exported JSON | Contains everything — treat the export like a diary. |
| Replays a captured request | Token is required; requests are only useful to the same device's mailbox. |

---

## Project layout

```
apps-script/
  Code.gs               relay: register / ask / poll / ack / ping / admin*, purger, sheet menu
  appsscript.json       manifest with webapp + minimal scopes
public/
  manifest.webmanifest  install metadata, shortcuts, maskable icons
  sw.js                 shell + asset caching, relay traffic never cached
  icons/                generated PNG/SVG set + OG card
scripts/
  make-icons.mjs        renders every icon from one SVG definition (npm run icons)
src/
  lib/crypto.ts         WebCrypto: ids, PBKDF2 PIN, AES-GCM sealing
  lib/db.ts             IndexedDB stores, export, wipe, footprint
  lib/relay.ts          transport: GAS driver + local sandbox driver
  lib/format.ts         time, escaping, rich-text, haptics
  state/pulse.tsx       the whole state machine — write local, then network
  screens/              Onboarding · Lock · Threads · Chat · Settings · Admin · InstallGuide
  components/           icons, toasts, install banner, brand mark
```

## Scripts

```bash
npm run dev        # dev server on 0.0.0.0:5173
npm run build      # typecheck + production build
npm run preview    # serve dist/
npm run icons      # regenerate the icon set
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| *"Relay returned a web page, not data"* | Deployment access is not **Anyone**, or you copied the `/dev` URL. Use `/exec`. |
| *"Relay unreachable"* | The URL is wrong, or the deployment was deleted. Re-deploy and update Settings. |
| Relay answers but nothing arrives | The row must have `status` exactly `answered`. Also check the TTL hasn't already purged it. |
| Questions stuck at *queued* | Device is offline. Pulse keeps them in IndexedDB and flushes on reconnect. |
| Admin console says *Unauthorized* | The key must match the `ADMIN_KEY` script property. Pulse menu → **Show admin key**. |
| Install prompt never appears | Already installed, dismissed, or the host isn't HTTPS. iOS never fires it — use Share → Add to Home Screen. |
| Lost the PIN | No recovery, by design. Erase app data (this deletes all local messages). |

---

## Design decisions worth knowing

- **No `application/json`.** Apps Script cannot answer a CORS preflight, so the client deliberately
  sends `text/plain`. This is the only reliably working pattern and the reason most spreadsheet-chat
  projects fail.
- **Local write first.** A message is persisted as `queued` before any network call, so a dead relay or
  a plane ride never loses a question.
- **No accounts.** Identity is a device key. The tradeoff is honest: lose the device and you lose the
  history — which is exactly the property that makes it unstealable.
- **Sandbox mode ships in production.** It makes the product demonstrable in one tap and doubles as a
  smoke test that the UI works when a relay is misconfigured.

MIT licensed. Built to be read, forked, and deployed.
