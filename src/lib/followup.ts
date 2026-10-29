/**
 * Follow-up scheduling — a pure decision function so the rules are testable
 * without a browser, a timer, or IndexedDB.
 *
 * Stage 0 → nothing sent yet
 * Stage 1 → gentle "still on it" nudge sent
 * Stage 2 → final escalation sent (terminal; never repeats)
 */

import type { Settings } from './types';

export interface FollowUp {
  stage: 1 | 2;
  kind: 'nudge' | 'escalate';
  text: string;
}

const MINUTE = 60_000;

export function nextFollowUp(input: {
  stage: number;
  ageMs: number;
  settings: Pick<Settings, 'followUpMinutes' | 'escalateMinutes' | 'nudgeText' | 'escalateText'>;
}): FollowUp | null {
  const { stage, ageMs, settings } = input;
  const { followUpMinutes, escalateMinutes, nudgeText, escalateText } = settings;

  if (stage <= 0) {
    if (followUpMinutes > 0 && ageMs >= followUpMinutes * MINUTE) {
      return { stage: 1, kind: 'nudge', text: nudgeText.trim() };
    }
    return null;
  }

  if (stage === 1) {
    // Escalation requires the follow-up feature to still be on, and must come
    // strictly after the nudge — otherwise a stale stage could fire it instantly.
    if (followUpMinutes > 0 && escalateMinutes > followUpMinutes && ageMs >= escalateMinutes * MINUTE) {
      return { stage: 2, kind: 'escalate', text: escalateText.trim() };
    }
    return null;
  }

  return null;
}
