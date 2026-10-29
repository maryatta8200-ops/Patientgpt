/**
 * Google Apps Script client tests — the transport that runs in production.
 *
 * The CORS behaviour is the fragile part of this design, so these pin down the
 * exact request shape (text/plain, POST, no credentials) and every failure the
 * user can hit, with `fetch` stubbed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GasRelay, RelayError, probeRelay } from '../src/lib/relay';

const URL_OK = 'https://script.google.com/macros/s/AKfyTEST/exec';
const creds = { deviceId: 'dev-1', token: 'tok-1' };

type FakeResponse = { body: string; ok?: boolean; status?: number };

let fetchMock: ReturnType<typeof vi.fn>;

function respond({ body, ok = true, status = 200 }: FakeResponse) {
  fetchMock.mockResolvedValueOnce({
    ok,
    status,
    text: async () => body,
  });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('request shape', () => {
  it('posts text/plain so the browser sends no CORS preflight', async () => {
    respond({ body: JSON.stringify({ ok: true, token: 'abc' }) });
    await new GasRelay({ url: URL_OK }).register({ deviceId: 'd', alias: 'a' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(URL_OK);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toMatch(/^text\/plain/);
    expect(init.credentials).toBe('omit');
    expect(init.cache).toBe('no-store');
    expect(init.redirect).toBe('follow');
  });

  it('sends the action and payload as JSON in the body', async () => {
    respond({ body: JSON.stringify({ ok: true, messages: [] }) });
    await new GasRelay({ url: URL_OK }).poll(creds);

    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload).toMatchObject({ action: 'poll', ...creds });
  });

  it('strips a pasted trailing space from the configured url', async () => {
    respond({ body: JSON.stringify({ ok: true, token: 'abc' }) });
    await new GasRelay({ url: `  ${URL_OK}  ` }).register({ deviceId: 'd', alias: 'a' });
    expect(fetchMock.mock.calls[0][0]).toBe(URL_OK);
  });
});

describe('url validation', () => {
  it('refuses to call without a url', async () => {
    await expect(new GasRelay({ url: '' }).poll(creds)).rejects.toThrow(RelayError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a url that is not an Apps Script deployment', async () => {
    const err = await new GasRelay({ url: 'https://evil.example/hook' }).poll(creds).catch((e) => e);
    expect(err).toBeInstanceOf(RelayError);
    expect(err.message).toMatch(/looks wrong/i);
    expect(err.hint).toMatch(/script\.google\.com/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not accept a /dev url silently — it validates the host only', async () => {
    respond({ body: JSON.stringify({ ok: true, messages: [] }) });
    await expect(
      new GasRelay({ url: 'https://script.google.com/macros/s/AK/dev' }).poll(creds),
    ).resolves.toBeDefined();
  });
});

describe('error handling', () => {
  it('explains an HTML response, the classic wrong-access-mode symptom', async () => {
    respond({ body: '<!DOCTYPE html><html><body>Sign in</body></html>' });
    const err = await new GasRelay({ url: URL_OK }).poll(creds).catch((e) => e);
    expect(err).toBeInstanceOf(RelayError);
    expect(err.message).toMatch(/web page, not data/i);
    expect(err.hint).toMatch(/Anyone/);
  });

  it('surfaces the server error and hint verbatim', async () => {
    respond({
      body: JSON.stringify({ ok: false, error: 'Daily limit reached', hint: 'Again tomorrow.' }),
    });
    const err = await new GasRelay({ url: URL_OK }).poll(creds).catch((e) => e);
    expect(err.message).toBe('Daily limit reached');
    expect(err.hint).toBe('Again tomorrow.');
  });

  it('reports a network failure as unreachable, with guidance', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const err = await new GasRelay({ url: URL_OK }).poll(creds).catch((e) => e);
    expect(err.message).toBe('Relay unreachable');
    expect(err.hint).toMatch(/Anyone/);
  });

  it('reports an abort as a timeout', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    fetchMock.mockRejectedValueOnce(abort);
    const err = await new GasRelay({ url: URL_OK }).poll(creds).catch((e) => e);
    expect(err.message).toBe('Relay timed out');
  });

  it('reports an empty body', async () => {
    respond({ body: '' });
    const err = await new GasRelay({ url: URL_OK }).poll(creds).catch((e) => e);
    expect(err.message).toMatch(/Empty response/);
  });

  it('reports malformed json without leaking the payload', async () => {
    respond({ body: 'not json at all' });
    const err = await new GasRelay({ url: URL_OK }).poll(creds).catch((e) => e);
    expect(err.message).toMatch(/Malformed/);
  });
});

describe('response handling', () => {
  it('returns the issued token on register', async () => {
    respond({ body: JSON.stringify({ ok: true, token: 'issued-token' }) });
    await expect(new GasRelay({ url: URL_OK }).register({ deviceId: 'd', alias: 'a' })).resolves.toEqual(
      { token: 'issued-token' },
    );
  });

  it('returns the relay id and operator wording on ask', async () => {
    respond({
      body: JSON.stringify({ ok: true, relayId: 'r_1', autoAck: 'Hold on.', nudge: 'Soon.', escalate: 'Late.' }),
    });
    const res = await new GasRelay({ url: URL_OK }).ask({
      ...creds,
      localId: 'm1',
      threadId: 't1',
      text: 'hi',
    });
    expect(res).toEqual({ relayId: 'r_1', autoAck: 'Hold on.', nudge: 'Soon.', escalate: 'Late.' });
  });

  it('defaults to an empty answer list', async () => {
    respond({ body: JSON.stringify({ ok: true }) });
    await expect(new GasRelay({ url: URL_OK }).poll(creds)).resolves.toEqual([]);
  });

  it('parses answers', async () => {
    const reply = { relayId: 'r_1', messageId: 'm1', threadId: 't1', answer: 'Yes.', answeredAt: 5 };
    respond({ body: JSON.stringify({ ok: true, messages: [reply] }) });
    await expect(new GasRelay({ url: URL_OK }).poll(creds)).resolves.toEqual([reply]);
  });

  it('reads health for the connection test', async () => {
    respond({ body: JSON.stringify({ ok: true, version: '1.0.0', serverTime: 42 }) });
    await expect(new GasRelay({ url: URL_OK }).health()).resolves.toEqual({
      version: '1.0.0',
      serverTime: 42,
    });
  });
});

describe('probeRelay', () => {
  it('reports a successful handshake', async () => {
    respond({ body: JSON.stringify({ ok: true, version: '1.0.0' }) });
    const res = await probeRelay(URL_OK);
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/v1\.0\.0/);
  });

  it('reports a failure with its hint', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const res = await probeRelay(URL_OK);
    expect(res.ok).toBe(false);
    expect(res.message).toBe('Relay unreachable');
    expect(res.hint).toMatch(/Anyone/);
  });
});
