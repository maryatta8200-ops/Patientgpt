/**
 * Relay transport.
 *
 * Two drivers behind one interface:
 *   • gas      — a deployed Google Apps Script Web App fronting a Google Sheet.
 *   • sandbox  — a fully local fake so the product can be explored with no backend.
 *
 * Apps Script cannot answer CORS preflights, so we deliberately POST `text/plain`
 * (a "simple" request that skips preflight) and let script.googleusercontent.com
 * reply with `Access-Control-Allow-Origin: *`.
 */

import { kvGet, kvSet } from './db';
import { randomId } from './crypto';
import type { AdminQuestion, PendingReply } from './types';

export interface RelayDriver {
  readonly kind: 'gas' | 'sandbox';
  register(input: { deviceId: string; alias: string }): Promise<{ token: string }>;
  ask(input: {
    deviceId: string;
    token: string;
    localId: string;
    threadId: string;
    text: string;
  }): Promise<{ relayId: string }>;
  poll(input: { deviceId: string; token: string }): Promise<PendingReply[]>;
  ack(input: { deviceId: string; token: string; relayIds: string[] }): Promise<void>;
  ping(input: { deviceId: string; token: string }): Promise<{ serverTime: number; pending: number }>;
  health(): Promise<{ version: string; serverTime: number }>;
  deregister(input: { deviceId: string; token: string }): Promise<void>;
  adminInbox(adminKey: string): Promise<AdminQuestion[]>;
  adminReply(input: { adminKey: string; relayId: string; answer: string }): Promise<void>;
  /** Answers typed straight into the sheet, waiting for Pulse to sweep them into the local store. */
  drain(answers: PendingReply[]): Promise<void>;
}

export class RelayError extends Error {
  readonly hint?: string;
  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'RelayError';
    this.hint = hint;
  }
}

/* =============================== GAS driver =============================== */

interface GasOptions {
  url: string;
}

export class GasRelay implements RelayDriver {
  readonly kind = 'gas' as const;
  private url: string;

  constructor({ url }: GasOptions) {
    this.url = url.trim();
  }

  private async call<T>(payload: Record<string, unknown>): Promise<T> {
    if (!this.url) {
      throw new RelayError('No relay URL configured', 'Add your Apps Script /exec URL in Settings.');
    }
    if (!/^https:\/\/script\.google\.com\//.test(this.url)) {
      throw new RelayError(
        'Relay URL looks wrong',
        'It should start with https://script.google.com/macros/s/…/exec',
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);

    let res: Response;
    try {
      res = await fetch(this.url, {
        method: 'POST',
        // text/plain keeps this a CORS "simple request" — no preflight, works with Apps Script.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        redirect: 'follow',
        signal: controller.signal,
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch (err) {
      clearTimeout(timer);
      const aborted = (err as Error)?.name === 'AbortError';
      throw new RelayError(
        aborted ? 'Relay timed out' : 'Relay unreachable',
        aborted
          ? 'The script took too long to respond. Try again in a moment.'
          : 'Check your connection, and that the Web App is deployed with access "Anyone".',
      );
    }
    clearTimeout(timer);

    const body = await res.text();
    if (!body) throw new RelayError('Empty response from relay', 'The script returned nothing.');

    if (body.trimStart().startsWith('<')) {
      throw new RelayError(
        'Relay returned a web page, not data',
        'Redeploy the Web App with "Execute as: Me" and "Who has access: Anyone", then update the URL.',
      );
    }

    let parsed: { ok?: boolean; error?: string; hint?: string } & Record<string, unknown>;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new RelayError('Malformed relay response', body.slice(0, 120));
    }

    if (!parsed.ok) {
      throw new RelayError(parsed.error || 'Relay rejected the request', parsed.hint);
    }
    return parsed as unknown as T;
  }

  async register(input: { deviceId: string; alias: string }) {
    const r = await this.call<{ token: string }>({ action: 'register', ...input });
    return { token: r.token };
  }

  async ask(input: {
    deviceId: string;
    token: string;
    localId: string;
    threadId: string;
    text: string;
  }) {
    const r = await this.call<{ relayId: string }>({ action: 'ask', ...input });
    return { relayId: r.relayId };
  }

  async poll(input: { deviceId: string; token: string }) {
    const r = await this.call<{ messages: PendingReply[] }>({ action: 'poll', ...input });
    return r.messages ?? [];
  }

  async ack(input: { deviceId: string; token: string; relayIds: string[] }) {
    await this.call({ action: 'ack', ...input });
  }

  async ping(input: { deviceId: string; token: string }) {
    const r = await this.call<{ serverTime: number; pending: number }>({ action: 'ping', ...input });
    return { serverTime: r.serverTime, pending: r.pending ?? 0 };
  }

  async deregister(input: { deviceId: string; token: string }) {
    await this.call({ action: 'deregister', ...input });
  }

  async health() {
    const r = await this.call<{ version: string; serverTime: number }>({ action: 'health' });
    return { version: r.version ?? 'unknown', serverTime: r.serverTime ?? Date.now() };
  }

  async adminInbox(adminKey: string) {
    const r = await this.call<{ questions: AdminQuestion[] }>({ action: 'adminInbox', adminKey });
    return r.questions ?? [];
  }

  async adminReply(input: { adminKey: string; relayId: string; answer: string }) {
    await this.call({ action: 'adminReply', ...input });
  }

  async drain(_answers: PendingReply[]) {
    // GAS has no separate drain step — answers arrive through poll().
  }
}

/* ============================= Sandbox driver ============================= */

interface SandboxRow {
  relayId: string;
  localId: string;
  threadId: string;
  text: string;
  answer: string;
  createdAt: number;
  answeredAt: number;
  acked: boolean;
}

const SANDBOX_KEY = 'sandbox.mailbox';
const SANDBOX_ANSWER_DELAY = 2600;

export class SandboxRelay implements RelayDriver {
  readonly kind = 'sandbox' as const;

  private async rows(): Promise<SandboxRow[]> {
    return (await kvGet<SandboxRow[]>(SANDBOX_KEY)) ?? [];
  }

  private async save(rows: SandboxRow[]): Promise<void> {
    await kvSet(SANDBOX_KEY, rows);
  }

  async register(_input: { deviceId: string; alias: string }) {
    return { token: `sandbox_${randomId(18)}` };
  }

  async ask(input: { text: string; localId: string; threadId: string }) {
    const relayId = `sbx_${randomId(10)}`;
    const rows = await this.rows();
    rows.push({
      relayId,
      localId: input.localId,
      threadId: input.threadId,
      text: input.text,
      answer: '',
      createdAt: Date.now(),
      answeredAt: 0,
      acked: false,
    });
    await this.save(rows.slice(-40));
    return { relayId };
  }

  async poll() {
    const rows = await this.rows();
    const now = Date.now();
    let changed = false;
    const out: PendingReply[] = [];
    for (const row of rows) {
      if (row.acked) continue;
      if (!row.answer && now - row.createdAt > SANDBOX_ANSWER_DELAY) {
        row.answer = sandboxAnswer(row.text);
        row.answeredAt = now;
        changed = true;
      }
      if (row.answer) {
        out.push({
          relayId: row.relayId,
          messageId: row.localId,
          threadId: row.threadId,
          answer: row.answer,
          answeredAt: row.answeredAt,
        });
      }
    }
    if (changed) await this.save(rows);
    return out;
  }

  async ack(input: { relayIds: string[] }) {
    const rows = await this.rows();
    const set = new Set(input.relayIds);
    // Burn after read: the row is deleted outright.
    await this.save(rows.filter((r) => !set.has(r.relayId)));
  }

  async ping() {
    const rows = await this.rows();
    return { serverTime: Date.now(), pending: rows.filter((r) => !r.acked).length };
  }

  async health() {
    return { version: 'sandbox', serverTime: Date.now() };
  }

  async deregister() {
    await this.save([]);
  }

  async adminInbox() {
    const rows = await this.rows();
    return rows.map<AdminQuestion>((r) => ({
      relayId: r.relayId,
      deviceId: 'sandbox-device',
      alias: 'You (sandbox)',
      question: r.text,
      createdAt: r.createdAt,
      status: r.answer ? 'answered' : 'new',
      answer: r.answer || undefined,
    }));
  }

  async adminReply(input: { relayId: string; answer: string }) {
    const rows = await this.rows();
    const row = rows.find((r) => r.relayId === input.relayId);
    if (row) {
      row.answer = input.answer;
      row.answeredAt = Date.now();
      await this.save(rows);
    }
  }

  async drain(_answers: PendingReply[]) {
    /* sandbox answers arrive through poll() */
  }
}

const SANDBOX_REPLIES: Array<[RegExp, string]> = [
  [
    /(hi|hello|hey|salam|assalam)\b/i,
    'Hello — Pulse received this in the sandbox relay. In production, a real person or AI answers from the Google Sheet, and this row is burned the moment you read it.\n\nAsk me anything to see the full loop.',
  ],
  [
    /(how|what).*(work|protocol|burn|delete|privacy)/i,
    '**How it flows**\n\n1. Your question is written to a single Sheet row.\n2. An agent reads it there and types an answer into the answer column.\n3. Your device polls, pulls the answer, and stores it locally.\n4. Your device sends an `ack`, and that row is deleted.\n\nNothing about you is stored remotely — not even which questions you asked.',
  ],
  [
    /(safe|secure|encrypt|steal)/i,
    'The relay only ever holds a question for seconds or minutes. There is no archive to breach: the Sheet is a mailbox, not a database.\n\nYour device keeps the transcript. Wipe the app and it is gone everywhere.',
  ],
  [
    /(price|cost|deploy|setup)/i,
    'Deployment is one Apps Script paste plus one static build. Open **Settings → Relay** for the connection test, and read the setup guide in the repo for the exact click path.',
  ],
  [
    /(who|agent|human|ai)/i,
    'Either. The Sheet does not care whether a human or an AI writes the answer column. This particular reply came from the local sandbox simulator — the real relay would wait for me.',
  ],
];

function sandboxAnswer(question: string): string {
  for (const [pattern, reply] of SANDBOX_REPLIES) {
    if (pattern.test(question)) return reply;
  }
  const trimmed = question.length > 90 ? `${question.slice(0, 87)}…` : question;
  return `Received: “${trimmed}”\n\nThis is the **sandbox** simulator, so the reply is local and instant. Connect a real Google Sheet relay in Settings and this same message would travel: device → Sheet row → agent → Sheet → device → deleted.`;
}

/* ================================ factory ================================ */

export function makeRelay(settings: { relayUrl: string; sandbox: boolean }): RelayDriver {
  if (settings.sandbox || !settings.relayUrl.trim()) return new SandboxRelay();
  return new GasRelay({ url: settings.relayUrl });
}

export async function probeRelay(url: string): Promise<{ ok: boolean; message: string; hint?: string }> {
  const driver = new GasRelay({ url });
  try {
    const started = performance.now();
    const health = await driver.health();
    return {
      ok: true,
      message: `Relay v${health.version} answered in ${Math.round(performance.now() - started)} ms`,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Relay check failed',
      hint: err instanceof RelayError ? err.hint : undefined,
    };
  }
}
