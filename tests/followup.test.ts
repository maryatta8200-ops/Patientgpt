/**
 * Follow-up scheduling rules.
 *
 * Stage 0 → nothing sent yet
 * Stage 1 → gentle "still on it" nudge sent
 * Stage 2 → final escalation sent (terminal)
 */

import { describe, it, expect } from 'vitest';
import { nextFollowUp } from '../src/lib/followup';

const M = 60_000;

const base = {
  followUpMinutes: 4,
  escalateMinutes: 15,
  nudgeText: 'nudge',
  escalateText: 'escalate',
};

const nudge = { stage: 1, kind: 'nudge', text: 'nudge' };
const escalate = { stage: 2, kind: 'escalate', text: 'escalate' };

describe('first follow-up', () => {
  it('stays silent before the threshold', () => {
    expect(nextFollowUp({ stage: 0, ageMs: 0, settings: base })).toBeNull();
    expect(nextFollowUp({ stage: 0, ageMs: 3.9 * M, settings: base })).toBeNull();
  });

  it('fires exactly at the threshold', () => {
    expect(nextFollowUp({ stage: 0, ageMs: 4 * M, settings: base })).toEqual(nudge);
  });

  it('still fires if the clock jumped past it', () => {
    expect(nextFollowUp({ stage: 0, ageMs: 9 * M, settings: base })).toEqual(nudge);
  });
});

describe('escalation', () => {
  it('never repeats the first follow-up', () => {
    expect(nextFollowUp({ stage: 1, ageMs: 9 * M, settings: base })).toBeNull();
    expect(nextFollowUp({ stage: 1, ageMs: 14.9 * M, settings: base })).toBeNull();
  });

  it('fires once after the second threshold', () => {
    expect(nextFollowUp({ stage: 1, ageMs: 15 * M, settings: base })).toEqual(escalate);
    expect(nextFollowUp({ stage: 1, ageMs: 60 * M, settings: base })).toEqual(escalate);
  });

  it('is terminal', () => {
    expect(nextFollowUp({ stage: 2, ageMs: 99 * M, settings: base })).toBeNull();
  });
});

describe('opt-outs and misconfiguration', () => {
  it('says nothing when the follow-up is off', () => {
    const off = { ...base, followUpMinutes: 0 };
    expect(nextFollowUp({ stage: 0, ageMs: 99 * M, settings: off })).toBeNull();
  });

  // Regression: a stale stage-1 row could still fire an escalation after the
  // user turned follow-ups off entirely.
  it('does not escalate when the follow-up itself is disabled', () => {
    const off = { ...base, followUpMinutes: 0 };
    expect(nextFollowUp({ stage: 1, ageMs: 99 * M, settings: off })).toBeNull();
  });

  it('suppresses an escalation that is not strictly after the follow-up', () => {
    expect(
      nextFollowUp({ stage: 1, ageMs: 99 * M, settings: { ...base, escalateMinutes: 4 } }),
    ).toBeNull();
    expect(
      nextFollowUp({ stage: 1, ageMs: 99 * M, settings: { ...base, escalateMinutes: 1 } }),
    ).toBeNull();
  });

  it('does nothing with escalation disabled', () => {
    expect(
      nextFollowUp({ stage: 1, ageMs: 99 * M, settings: { ...base, escalateMinutes: 0 } }),
    ).toBeNull();
  });

  it('passes the configured wording through', () => {
    const custom = { ...base, nudgeText: ' Custom text ' };
    expect(nextFollowUp({ stage: 0, ageMs: 5 * M, settings: custom })).toEqual({
      stage: 1,
      kind: 'nudge',
      text: 'Custom text',
    });
  });
});
