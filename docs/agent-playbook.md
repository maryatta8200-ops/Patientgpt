# Agent playbook

How to answer Pulse questions — as a person, or by driving an AI.

## The loop

1. A question arrives in **Pulse · Mailbox** with `status = new`.
2. You write the reply into the `answer` column and set `status = answered`.
3. The asker's device polls (3–20 s), stores the answer locally, and acknowledges.
4. The relay **deletes the row**. If the device never returns, the TTL sweeper deletes it anyway.

You never need to touch the registry sheet. You never see anything about the person beyond their
alias.

## House rules

- **Answer in the row, not in a new one.** A new row is a new question, not a reply.
- **Be complete the first time.** Once burned, the answer cannot be re-read by you or by anyone.
- **Keep it under 8 000 characters** (cell/relay limit). The UI renders `**bold**`, `` `code` `` and
  line breaks.
- **No re-identification.** Nobody can follow up unless they ask again, so don't ask for details that
  can't be acted on.
- **Don't paste the question back.** It is already visible on their device.

## Answering with an AI

Two options, both supported without changing Pulse:

### A. Human-in-the-loop (recommended)

Read the question in the sheet, ask your AI of choice, paste its reply into `answer`. Zero setup, and
you are always the last line of review — which matters for anything medical, legal or financial.

### B. Automated webhook

```text
Apps Script → Project Settings → Script properties → AI_WEBHOOK_URL = https://your-worker/hook
```

Each new question is POSTed to your worker:

```json
{ "relayId": "r_…", "question": "…" }
```

Your worker answers by calling the relay:

```bash
curl -s -X POST "$RELAY_URL" -H 'Content-Type: text/plain' -d @- <<JSON
{ "action": "adminReply", "adminKey": "…", "relayId": "r_…", "answer": "…" }
JSON
```

Nothing is retried automatically: if the webhook is down, the question simply waits in the sheet for
a human, which is the safest failure mode available.

## Queue hygiene

| Situation | Action |
|---|---|
| Question is unanswerable / spam | Delete the row — the asker's device sees nothing and eventually times out. |
| Device compromised | Pulse menu → **Deregister a device…** → paste the `deviceId` from the Registry sheet. |
| Sheet growing unexpectedly | Pulse menu → **Relay health check**, then **Purge expired rows now**. |
| Changing the TTL | Apps Script → Script properties → `TTL_MINUTES` (1–1440). |

## Tone

People arrive with something on their mind and are being asked to trust a system that forgets them.
Be direct, warm, and specific. Short paragraphs. No filler. If you don't know, say so plainly — that
respects the person more than a confident guess.
