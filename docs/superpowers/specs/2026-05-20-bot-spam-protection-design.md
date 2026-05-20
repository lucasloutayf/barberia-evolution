# Bot Spam Protection — Design Spec

Date: 2026-05-20

## Problem

The WhatsApp bot has no protection against abusive usage:

- No per-user rate limiting — a spammer sending 100 messages queues 100 LLM calls, draining API credits.
- No queue depth limit — `enqueueFor` serializes but doesn't cap how many messages accumulate per JID.
- No message length limit — a 10,000-character message is sent to the LLM intact.
- No user blocking — no way to permanently ignore an abusive JID.

## Decisions

| Topic | Decision |
|---|---|
| Rate limit behavior | First offense: send one warning. Subsequent offenses: silent drop. |
| Blocklist storage | `bot/blocklist.json` — separate from `state.json`, human-editable. |
| Rate limit thresholds | 8 msgs/60s + 3 msgs/10s (burst). Queue max 4 pending per JID. |
| Architecture | New `bot/guard.js` module — single entry point for all protection logic. |

## Architecture

All protection logic lives in `bot/guard.js`. `whatsapp.js` calls `guard.check(from, rawText)` before enqueuing — this is the only integration point. `admin.js` calls guard's block/unblock functions for manual moderation.

```
whatsapp.js
  └─ guard.check(jid, rawText) → { allowed, reason, firstOffense, text }
       ├─ isBlocked(jid)
       ├─ checkRateLimit(jid)     — sliding windows 60s + 10s
       ├─ tryQueueEnter(jid)      — atomic check+increment, depth < 4
       └─ sanitizeText(rawText)   — truncate at 1000 chars
```

## Module: `bot/guard.js`

### In-memory structures

```js
const windows      = new Map(); // jid → { ts60: number[], ts10: number[] }
const queueDepth   = new Map(); // jid → number (pending messages)
const warnedRateLimit  = new Set(); // JIDs that already received a rate-limit warning
const warnedQueueFull  = new Set(); // JIDs that already received a queue-full warning
const blocked      = new Set(); // mirror of blocklist.json
```

`windows` entries are pruned after each check; if both arrays become empty, the key is deleted to avoid unbounded memory growth.

### Rate limiting — dual sliding window

On each `check`:
1. Push `Date.now()` to both `ts60` and `ts10`.
2. Filter `ts60` to keep only timestamps within the last 60 000 ms.
3. Filter `ts10` to keep only timestamps within the last 10 000 ms.
4. Rate limited if `ts60.length > 8` OR `ts10.length > 3`.
5. If both arrays are empty after filtering, delete the entry from `windows`.

### Queue control — `tryQueueEnter(jid)`

Atomic check-and-increment. Returns `true` and increments depth if current depth < 4. Returns `false` without incrementing if at capacity. Callers must call `guard.queueDecrement(jid)` in a `finally` block.

### `guard.check(jid, rawText)`

Returns one of:
```js
{ allowed: true,  text: string }
{ allowed: false, reason: 'blocked' | 'rate_limit' | 'queue_full', firstOffense: boolean }
```

Evaluation order: blocked → rate_limit → queue_full → sanitize.

`firstOffense` is `true` the first time a given JID hits `rate_limit` or `queue_full` in the current process lifetime (tracked by `warnedRateLimit` and `warnedQueueFull` respectively). After marking, subsequent violations return `firstOffense: false`.

### Message sanitization

`sanitizeText(text)` truncates to 1000 characters. No error thrown — always returns a string.

### Blocklist persistence — `bot/blocklist.json`

```json
{
  "blocked": [
    { "jid": "5491112345678@s.whatsapp.net", "blockedAt": "2026-05-20T14:00:00.000Z" }
  ],
  "updatedAt": "2026-05-20T14:00:00.000Z"
}
```

Loaded at startup via `guard.load()`. Writes are debounced 2 s (same pattern as `state.js`). The `blocked` Set in memory is the source of truth at runtime.

### Public API

`tryQueueEnter` is internal to `check`. Callers never call it directly.

```js
// Startup
await guard.load()

// Message gate (called in whatsapp.js before enqueueFor)
guard.check(jid, rawText)   // → { allowed, reason?, firstOffense?, text? }
                             //   if allowed: true, queue is already incremented
guard.queueDecrement(jid)   // called in finally after processing

// Admin operations (called from admin.js)
guard.blockJid(jid)         // → void, persists async
guard.unblockJid(jid)       // → void, persists async
guard.listBlocked()         // → Array<{ jid, blockedAt }>
guard.isBlocked(jid)        // → boolean
```

## Changes to `whatsapp.js`

Single integration point after extracting `from` and `rawText`, before `enqueueFor`:

```js
const { allowed, reason, firstOffense, text } = guard.check(from, rawText);
if (!allowed) {
  if (firstOffense && reason !== 'blocked') {
    const msg = reason === 'rate_limit'
      ? 'Estás mandando muchos mensajes seguidos. Esperá un momento antes de escribir de nuevo.'
      : 'Hay varios mensajes tuyos en espera. Esperá a que los procese antes de mandar más.';
    await sock.sendMessage(from, { text: msg }).catch(() => {});
  }
  continue;
}

// Queue was already incremented inside guard.check (tryQueueEnter is internal).
// Only decrement is needed here, in finally.
enqueueFor(from, async () => {
  try {
    // ... existing logic using `text` (safeText), never raw rawText ...
  } finally {
    guard.queueDecrement(from);
  }
});
```

`text` (sanitized) replaces every reference to the raw input inside the enqueued function. No raw string reaches the LLM after `check`.

## Changes to `admin.js`

Three new commands, following existing handler style:

| Command | Action |
|---|---|
| `/bloquear <numero>` | Normalize input → JID, call `guard.blockJid(jid)` |
| `/desbloquear <numero>` | Normalize input → JID, call `guard.unblockJid(jid)` |
| `/bloqueados` | Call `guard.listBlocked()`, format list with dates |

All three are admin-only (checked by the existing `from === ADMIN_JID` guard in `whatsapp.js`).

## New utility: `normalizePhoneToJid(input)` in `state.js`

```js
// input: human phone string ("351 304 2203", "+5493513042203", etc.)
// returns: WhatsApp JID ("5493513042203@s.whatsapp.net") or null if invalid
export function normalizePhoneToJid(input) {
  const phone = cleanPhone(input);
  return phone ? `${phone}@s.whatsapp.net` : null;
}
```

Used by `admin.js` for `/bloquear` and `/desbloquear`. Distinct from `cleanPhone` (which returns just the digits) — this function returns the full JID identifier as used everywhere in the system.

## Changes to `index.js`

Add `await guard.load()` alongside the existing `await loadState()` at startup.

## Files changed

| File | Change |
|---|---|
| `bot/guard.js` | New module |
| `bot/blocklist.json` | New file (created on first block, or empty on first load) |
| `bot/whatsapp.js` | Add guard.check + queueDecrement integration |
| `bot/admin.js` | Add /bloquear, /desbloquear, /bloqueados commands |
| `bot/state.js` | Add normalizePhoneToJid export |
| `bot/index.js` | Call guard.load() at startup |

## Out of scope

- Persistence of rate-limit state across restarts (in-memory is sufficient).
- Global rate limit across all users (not needed for a single-location barbershop).
- Auto-blocking after N violations (adds complexity, not requested).
- IP-level or device-level blocking (not available through Baileys/WhatsApp API).
