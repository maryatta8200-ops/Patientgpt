# Verify your relay end to end

Copy-paste checks for a freshly deployed Apps Script relay. Replace `RELAY_URL` and `ADMIN_KEY`.

```bash
RELAY_URL='https://script.google.com/macros/s/AKfy…/exec'
```

> Every request uses `Content-Type: text/plain` on purpose — a JSON content type triggers a CORS
> preflight that Apps Script cannot answer.

## 1. Is it alive?

```bash
curl -s -X POST "$RELAY_URL" -H 'Content-Type: text/plain' -d '{"action":"health"}'
# {"ok":true,"service":"pulse-relay","version":"1.0.0","serverTime":…,"ttlMinutes":15}
```

If you get HTML back, the deployment access is not **Anyone**.

## 2. Register a device

```bash
DEVICE_ID=$(uuidgen | tr 'A-Z' 'a-z')
REG=$(curl -s -X POST "$RELAY_URL" -H 'Content-Type: text/plain' \
  -d "{\"action\":\"register\",\"deviceId\":\"$DEVICE_ID\",\"alias\":\"curl test\"}")
echo "$REG"
TOKEN=$(echo "$REG" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
```

## 3. Ask a question

```bash
ASK=$(curl -s -X POST "$RELAY_URL" -H 'Content-Type: text/plain' \
  -d "{\"action\":\"ask\",\"deviceId\":\"$DEVICE_ID\",\"token\":\"$TOKEN\",\"localId\":\"m1\",\"threadId\":\"t1\",\"text\":\"Does this survive the round trip?\"}")
echo "$ASK"
RELAY_ID=$(echo "$ASK" | sed -n 's/.*"relayId":"\([^"]*\)".*/\1/p')
```

A row now exists in **Pulse · Mailbox** with `status = new`.

## 4. Answer it (as the agent)

Either type into the sheet's `answer` cell and set `status` to `answered`, or:

```bash
curl -s -X POST "$RELAY_URL" -H 'Content-Type: text/plain' \
  -d "{\"action\":\"adminReply\",\"adminKey\":\"$ADMIN_KEY\",\"relayId\":\"$RELAY_ID\",\"answer\":\"Yes — verify the burn next.\"}"
```

## 5. Poll for the answer

```bash
curl -s -X POST "$RELAY_URL" -H 'Content-Type: text/plain' \
  -d "{\"action\":\"poll\",\"deviceId\":\"$DEVICE_ID\",\"token\":\"$TOKEN\"}"
```

## 6. Acknowledge and confirm the burn

```bash
curl -s -X POST "$RELAY_URL" -H 'Content-Type: text/plain' \
  -d "{\"action\":\"ack\",\"deviceId\":\"$DEVICE_ID\",\"token\":\"$TOKEN\",\"relayIds\":[\"$RELAY_ID\"]}"
# {"ok":true,"deleted":1,…}

curl -s -X POST "$RELAY_URL" -H 'Content-Type: text/plain' \
  -d "{\"action\":\"poll\",\"deviceId\":\"$DEVICE_ID\",\"token\":\"$TOKEN\"}"
# {"ok":true,"messages":[]}
```

The mailbox row is gone. That is the whole promise, demonstrated.

## 7. Negative checks

```bash
# wrong token → rejected
curl -s -X POST "$RELAY_URL" -H 'Content-Type: text/plain' \
  -d "{\"action\":\"poll\",\"deviceId\":\"$DEVICE_ID\",\"token\":\"nope-nope-nope-nope\"}"

# wrong admin key → rejected
curl -s -X POST "$RELAY_URL" -H 'Content-Type: text/plain' \
  -d '{"action":"adminInbox","adminKey":"wrong"}'

# oversize question → rejected
```
