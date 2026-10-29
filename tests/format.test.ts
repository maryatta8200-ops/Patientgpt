/**
 * Formatting, escaping and the rich-text renderer.
 *
 * The renderer feeds `dangerouslySetInnerHTML`, so these tests are a security
 * boundary: agent answers are arbitrary text typed by a third party.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  timeAgo,
  dayLabel,
  bytes,
  cleanOutgoing,
  escapeHtml,
  renderRich,
  initials,
  shortId,
  haptic,
} from '../src/lib/format';

afterEach(() => {
  vi.useRealTimers();
});

describe('timeAgo', () => {
  it('describes recent and older moments', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
    const now = Date.now();
    expect(timeAgo(now)).toBe('just now');
    expect(timeAgo(now - 40_000)).toBe('just now');
    expect(timeAgo(now - 5 * 60_000)).toBe('5m ago');
    expect(timeAgo(now - 3 * 3600_000)).toBe('3h ago');
    expect(timeAgo(now - 2 * 86_400_000)).toBe('2d ago');
    expect(timeAgo(now - 30 * 86_400_000)).toMatch(/\d/); // falls back to a date
  });
});

describe('dayLabel', () => {
  it('names today and yesterday, then dates it', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-10T09:00:00Z'));
    expect(dayLabel(Date.now())).toBe('Today');
    expect(dayLabel(Date.now() - 86_400_000)).toBe('Yesterday');
    expect(dayLabel(Date.now() - 5 * 86_400_000)).toMatch(/Mar|5/);
  });
});

describe('bytes', () => {
  it('scales the unit', () => {
    expect(bytes(512)).toBe('512 B');
    expect(bytes(2048)).toBe('2.0 KB');
    expect(bytes(5 * 1024 * 1024)).toBe('5.00 MB');
  });
});

describe('cleanOutgoing', () => {
  it('trims and collapses a message to the budget', () => {
    expect(cleanOutgoing('  hello  ')).toBe('hello');
    expect(cleanOutgoing('a'.repeat(5000)).length).toBe(4000);
    expect(cleanOutgoing('')).toBe('');
    expect(cleanOutgoing('   ')).toBe('');
  });

  it('strips null bytes', () => {
    expect(cleanOutgoing('a\u0000b')).toBe('ab');
  });

  it('honours a custom cap', () => {
    expect(cleanOutgoing('abcdef', 3)).toBe('abc');
  });
});

describe('escaping', () => {
  it('escapes every character that matters in HTML', () => {
    expect(escapeHtml(`<script>"x"&'y'</script>`)).toBe(
      '&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;',
    );
  });
});

describe('renderRich', () => {
  it('renders bold and inline code', () => {
    expect(renderRich('**hi**')).toContain('<strong>hi</strong>');
    expect(renderRich('use `npm i`')).toContain('<code class="rich-code">npm i</code>');
  });

  it('converts newlines to breaks', () => {
    expect(renderRich('a\nb')).toBe('a<br/>b');
  });

  // Security boundary — an answer is third-party text.
  it('neutralises injected script tags', () => {
    const out = renderRich('<script>alert(1)</script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('neutralises an img onerror payload', () => {
    const out = renderRich('<img src=x onerror="alert(1)">');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('cannot be tricked into emitting markup through the bold rule', () => {
    const out = renderRich('**<iframe src=evil>**');
    expect(out).not.toContain('<iframe');
    expect(out).toContain('&lt;iframe');
  });

  it('cannot be tricked into emitting markup through the code rule', () => {
    const out = renderRich('`<svg onload=alert(1)>`');
    expect(out).not.toContain('<svg');
  });

  it('leaves plain text untouched', () => {
    expect(renderRich('just words')).toBe('just words');
  });
});

describe('display helpers', () => {
  it('derives initials from an alias', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('sam')).toBe('S');
    expect(initials('')).toBe('P');
    expect(initials('!!!')).toBe('P');
  });

  it('shortens long ids and leaves short ones alone', () => {
    expect(shortId('abcdefghijklmnop', 6, 4)).toBe('abcdef…mnop');
    expect(shortId('abc')).toBe('abc');
  });
});

describe('haptic', () => {
  it('never throws when vibration is unavailable or disabled', () => {
    expect(() => haptic(10, false)).not.toThrow();
    expect(() => haptic([10, 20], true)).not.toThrow();
  });

  it('calls the device vibrate API when enabled', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    haptic(12, true);
    expect(vibrate).toHaveBeenCalledWith(12);
    vi.unstubAllGlobals();
  });
});
