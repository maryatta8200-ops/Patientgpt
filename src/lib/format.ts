/** Small formatting + sanitising helpers shared across the UI. */

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.round(diff / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function clockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** Trim + collapse whitespace, cap length to the relay's cell budget. */
export function cleanOutgoing(text: string, max = 4000): string {
  return text.replace(/\u0000/g, '').trim().slice(0, max);
}

/** Very small markup: **bold**, `code`, and line breaks. Everything is escaped first. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderRich(text: string): string {
  let html = escapeHtml(text);
  html = html.replace(/`([^`\n]{1,200})`/g, '<code class="rich-code">$1</code>');
  html = html.replace(/\*\*([^*\n]{1,300})\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\n/g, '<br/>');
  return html;
}

export function initials(alias: string): string {
  const cleaned = alias.replace(/[^\p{L}\p{N} ]/gu, '').trim();
  if (!cleaned) return 'P';
  const parts = cleaned.split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

export function shortId(id: string, head = 6, tail = 4): string {
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

export function haptic(pattern: number | number[], enabled: boolean): void {
  if (!enabled) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* no-op */
  }
}
