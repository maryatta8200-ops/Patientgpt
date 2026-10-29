import { nextFollowUp } from '../src/lib/followup.ts';

const base = {
  followUpMinutes: 4,
  escalateMinutes: 15,
  nudgeText: 'nudge',
  escalateText: 'escalate',
};
const M = 60_000;
let pass = 0, fail = 0;
function t(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; } else { fail++; console.log('FAIL', name, '\n  got ', got, '\n  want', want); }
}
const nudge = { stage: 1, kind: 'nudge', text: 'nudge' };
const esc = { stage: 2, kind: 'escalate', text: 'escalate' };

// silence before the threshold
t('t=0 stage0', nextFollowUp({ stage: 0, ageMs: 0, settings: base }), null);
t('t=3.9m stage0', nextFollowUp({ stage: 0, ageMs: 3.9 * M, settings: base }), null);
t('t=4m stage0 -> nudge', nextFollowUp({ stage: 0, ageMs: 4 * M, settings: base }), nudge);
t('t=9m stage0 -> nudge still', nextFollowUp({ stage: 0, ageMs: 9 * M, settings: base }), nudge);
// never repeats the nudge
t('stage1 t=9m -> null', nextFollowUp({ stage: 1, ageMs: 9 * M, settings: base }), null);
t('stage1 t=14.9m -> null', nextFollowUp({ stage: 1, ageMs: 14.9 * M, settings: base }), null);
t('stage1 t=15m -> escalate', nextFollowUp({ stage: 1, ageMs: 15 * M, settings: base }), esc);
t('stage1 t=60m -> escalate', nextFollowUp({ stage: 1, ageMs: 60 * M, settings: base }), esc);
// terminal
t('stage2 t=99m -> null', nextFollowUp({ stage: 2, ageMs: 99 * M, settings: base }), null);
// escalation switched off
t('escalate off', nextFollowUp({ stage: 1, ageMs: 99 * M, settings: { ...base, escalateMinutes: 0 } }), null);
// nudge switched off => nothing at all
t('nudge off stage0', nextFollowUp({ stage: 0, ageMs: 99 * M, settings: { ...base, followUpMinutes: 0 } }), null);
t('nudge off stage1', nextFollowUp({ stage: 1, ageMs: 99 * M, settings: { ...base, followUpMinutes: 0 } }), null);
// escalation <= nudge is ignored rather than firing instantly
t('escalate<=nudge', nextFollowUp({ stage: 1, ageMs: 99 * M, settings: { ...base, escalateMinutes: 4 } }), null);
t('escalate=1 nudge=4', nextFollowUp({ stage: 1, ageMs: 99 * M, settings: { ...base, escalateMinutes: 1 } }), null);
console.log(fail === 0 ? `ALL ${pass} PASS` : `${fail} FAILED / ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
