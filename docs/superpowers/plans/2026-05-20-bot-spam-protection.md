# Bot Spam Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-user rate limiting, queue depth cap, message sanitization, and admin-managed blocklist to the WhatsApp bot via a new `bot/guard.js` module.

**Architecture:** `guard.js` is the single gate for all protection logic — dual sliding-window rate limiting (8/60s + 3/10s burst), atomic queue tracking (max 4 pending), 1000-char message truncation, and a `blocklist.json`-backed blocklist. `whatsapp.js` calls `guard.check(jid, rawText)` before enqueuing; if denied and first offense, sends one warning. `admin.js` adds `/bloquear`, `/desbloquear`, `/bloqueados`.

**Tech Stack:** Node.js ESM, `node:test` (built-in, Node 18+), `node:fs/promises`.

**IMPORTANT:** Do NOT commit during implementation. The user will commit manually.

---

### Task 1: Create `bot/guard.js` with tests

**Files:**
- Create: `bot/guard.js`
- Create: `bot/test-guard.js`

- [ ] **Step 1: Write `bot/test-guard.js`**

```js
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as guard from './guard.js';

// guard.js uses module-level Maps/Sets. _reset() clears all state between tests.

describe('sanitizeText', () => {
  test('passes through short text unchanged', () => {
    assert.equal(guard.sanitizeText('hola'), 'hola');
  });

  test('truncates at 1000 chars', () => {
    const result = guard.sanitizeText('a'.repeat(1500));
    assert.equal(result.length, 1000);
    assert.equal(result, 'a'.repeat(1000));
  });

  test('coerces null to empty string', () => {
    assert.equal(guard.sanitizeText(null), '');
  });

  test('coerces undefined to empty string', () => {
    assert.equal(guard.sanitizeText(undefined), '');
  });
});

describe('blocklist', () => {
  beforeEach(() => guard._reset());

  test('new JID is not blocked', () => {
    assert.equal(guard.isBlocked('5491111111111@s.whatsapp.net'), false);
  });

  test('blockJid makes isBlocked return true', () => {
    guard.blockJid('5491111111111@s.whatsapp.net');
    assert.equal(guard.isBlocked('5491111111111@s.whatsapp.net'), true);
  });

  test('unblockJid removes the block', () => {
    guard.blockJid('5491111111111@s.whatsapp.net');
    guard.unblockJid('5491111111111@s.whatsapp.net');
    assert.equal(guard.isBlocked('5491111111111@s.whatsapp.net'), false);
  });

  test('listBlocked returns each entry with jid and blockedAt', () => {
    guard.blockJid('5491111111111@s.whatsapp.net');
    guard.blockJid('5492222222222@s.whatsapp.net');
    const list = guard.listBlocked();
    assert.equal(list.length, 2);
    assert.ok(list.every(e => typeof e.jid === 'string' && typeof e.blockedAt === 'string'));
  });
});

describe('check — blocked', () => {
  beforeEach(() => guard._reset());

  test('blocked JID returns allowed=false reason=blocked', () => {
    guard.blockJid('5491111111111@s.whatsapp.net');
    const r = guard.check('5491111111111@s.whatsapp.net', 'hola');
    assert.equal(r.allowed, false);
    assert.equal(r.reason, 'blocked');
  });
});

describe('check — burst rate limit (3 msgs / 10s)', () => {
  beforeEach(() => guard._reset());

  test('first 3 messages are allowed', () => {
    const jid = '5491111111111@s.whatsapp.net';
    for (let i = 0; i < 3; i++) {
      const r = guard.check(jid, 'hola');
      assert.equal(r.allowed, true, `message ${i + 1} should be allowed`);
      guard.queueDecrement(jid); // keep queue depth at 0
    }
  });

  test('4th message within 10s is blocked with reason=rate_limit', () => {
    const jid = '5491111111111@s.whatsapp.net';
    for (let i = 0; i < 3; i++) {
      guard.check(jid, 'x');
      guard.queueDecrement(jid);
    }
    const r = guard.check(jid, 'x');
    assert.equal(r.allowed, false);
    assert.equal(r.reason, 'rate_limit');
  });

  test('first rate-limit violation returns firstOffense=true', () => {
    const jid = '5491111111111@s.whatsapp.net';
    for (let i = 0; i < 3; i++) { guard.check(jid, 'x'); guard.queueDecrement(jid); }
    const r = guard.check(jid, 'x');
    assert.equal(r.firstOffense, true);
  });

  test('second rate-limit violation returns firstOffense=false', () => {
    const jid = '5491111111111@s.whatsapp.net';
    for (let i = 0; i < 3; i++) { guard.check(jid, 'x'); guard.queueDecrement(jid); }
    guard.check(jid, 'x'); // first offense — marks warnedRateLimit
    const r = guard.check(jid, 'x');
    assert.equal(r.firstOffense, false);
  });
});

describe('check — queue full', () => {
  beforeEach(() => guard._reset());

  // _setQueueDepth is a test helper that bypasses check() to seed queue depth
  // directly — necessary because the burst limit (3/10s) fires before we can
  // naturally accumulate 4 queue entries within a single 10s window.

  test('blocks when queue depth is already at max (4)', () => {
    const jid = '5491111111111@s.whatsapp.net';
    guard._setQueueDepth(jid, 4);
    const r = guard.check(jid, 'hola');
    assert.equal(r.allowed, false);
    assert.equal(r.reason, 'queue_full');
  });

  test('first queue-full violation returns firstOffense=true', () => {
    const jid = '5491111111111@s.whatsapp.net';
    guard._setQueueDepth(jid, 4);
    const r = guard.check(jid, 'hola');
    assert.equal(r.firstOffense, true);
  });

  test('second queue-full violation returns firstOffense=false', () => {
    const jid = '5491111111111@s.whatsapp.net';
    guard._setQueueDepth(jid, 4);
    guard.check(jid, 'hola'); // first offense — marks warnedQueueFull
    guard._setQueueDepth(jid, 4); // re-fill queue (queue_full doesn't increment)
    const r = guard.check(jid, 'hola');
    assert.equal(r.firstOffense, false);
  });

  test('queueDecrement below max re-allows entry', () => {
    const jid = '5491111111111@s.whatsapp.net';
    guard._setQueueDepth(jid, 4);
    guard.queueDecrement(jid); // depth → 3
    const r = guard.check(jid, 'hola');
    assert.equal(r.allowed, true);
    guard.queueDecrement(jid);
  });
});

describe('check — sanitization on allowed message', () => {
  beforeEach(() => guard._reset());

  test('returns original text when within limit', () => {
    const r = guard.check('5491111111111@s.whatsapp.net', 'hola mundo');
    assert.equal(r.allowed, true);
    assert.equal(r.text, 'hola mundo');
  });

  test('truncates text over 1000 chars', () => {
    const r = guard.check('5491111111111@s.whatsapp.net', 'z'.repeat(2000));
    assert.equal(r.allowed, true);
    assert.equal(r.text.length, 1000);
  });
});
```

- [ ] **Step 2: Run the test file — expect it to fail (module not found)**

```
cd bot && node --test test-guard.js
```

Expected: error `Cannot find module './guard.js'`

- [ ] **Step 3: Write `bot/guard.js`**

```js
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const FILE = resolve(process.cwd(), 'blocklist.json');

const RATE_60S   = 8;    // max messages per 60s window
const RATE_10S   = 3;    // max messages per 10s window (burst)
const QUEUE_MAX  = 4;    // max pending messages per JID
const MSG_MAX_LEN = 1000;

const windows         = new Map(); // jid → { ts60: number[], ts10: number[] }
const queueDepth      = new Map(); // jid → number
const warnedRateLimit = new Set(); // JIDs that received a rate-limit warning this session
const warnedQueueFull = new Set(); // JIDs that received a queue-full warning this session
const blocked         = new Set(); // JIDs blocked (mirror of blocklist.json)
const blockedMeta     = new Map(); // jid → { blockedAt: string }

let dirty     = false;
let saveTimer = null;

export async function load() {
  try {
    const raw = await readFile(FILE, 'utf8');
    const { blocked: list } = JSON.parse(raw);
    if (Array.isArray(list)) {
      for (const e of list) {
        blocked.add(e.jid);
        blockedMeta.set(e.jid, { blockedAt: e.blockedAt });
      }
    }
    console.log(`[guard] blocklist cargada: ${blocked.size} bloqueados`);
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[guard] error leyendo blocklist.json:', err.message);
  }
}

function scheduleSave() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    if (!dirty) return;
    const arr = [...blocked].map(jid => ({
      jid,
      blockedAt: blockedMeta.get(jid)?.blockedAt ?? new Date().toISOString(),
    }));
    try {
      await writeFile(
        FILE,
        JSON.stringify({ blocked: arr, updatedAt: new Date().toISOString() }, null, 2),
        'utf8',
      );
      dirty = false;
    } catch (err) {
      console.warn('[guard] error escribiendo blocklist.json:', err.message);
    }
  }, 2000);
}

export function isBlocked(jid) {
  return blocked.has(jid);
}

export function blockJid(jid) {
  blocked.add(jid);
  blockedMeta.set(jid, { blockedAt: new Date().toISOString() });
  scheduleSave();
}

export function unblockJid(jid) {
  blocked.delete(jid);
  blockedMeta.delete(jid);
  scheduleSave();
}

export function listBlocked() {
  return [...blocked].map(jid => ({
    jid,
    blockedAt: blockedMeta.get(jid)?.blockedAt ?? null,
  }));
}

function checkRateLimit(jid) {
  const now = Date.now();
  let win = windows.get(jid);
  if (!win) {
    win = { ts60: [], ts10: [] };
    windows.set(jid, win);
  }

  win.ts60.push(now);
  win.ts10.push(now);

  win.ts60 = win.ts60.filter(t => now - t < 60_000);
  win.ts10 = win.ts10.filter(t => now - t < 10_000);

  const exceeded = win.ts60.length > RATE_60S || win.ts10.length > RATE_10S;

  if (win.ts60.length === 0 && win.ts10.length === 0) windows.delete(jid);

  return exceeded;
}

function tryQueueEnter(jid) {
  const d = queueDepth.get(jid) ?? 0;
  if (d >= QUEUE_MAX) return false;
  queueDepth.set(jid, d + 1);
  return true;
}

export function queueDecrement(jid) {
  const d = queueDepth.get(jid) ?? 0;
  if (d <= 1) queueDepth.delete(jid);
  else queueDepth.set(jid, d - 1);
}

export function sanitizeText(text) {
  const t = String(text ?? '');
  return t.length > MSG_MAX_LEN ? t.slice(0, MSG_MAX_LEN) : t;
}

export function check(jid, rawText) {
  if (blocked.has(jid)) {
    return { allowed: false, reason: 'blocked', firstOffense: false };
  }

  if (checkRateLimit(jid)) {
    const firstOffense = !warnedRateLimit.has(jid);
    if (firstOffense) warnedRateLimit.add(jid);
    return { allowed: false, reason: 'rate_limit', firstOffense };
  }

  if (!tryQueueEnter(jid)) {
    const firstOffense = !warnedQueueFull.has(jid);
    if (firstOffense) warnedQueueFull.add(jid);
    return { allowed: false, reason: 'queue_full', firstOffense };
  }

  return { allowed: true, text: sanitizeText(rawText) };
}

// ─── Test helpers ────────────────────────────────────────────────────────────
// These are only for use in test-guard.js. Never call from production code.

export function _reset() {
  windows.clear();
  queueDepth.clear();
  warnedRateLimit.clear();
  warnedQueueFull.clear();
  blocked.clear();
  blockedMeta.clear();
  dirty = false;
}

export function _setQueueDepth(jid, depth) {
  if (depth <= 0) queueDepth.delete(jid);
  else queueDepth.set(jid, depth);
}
```

- [ ] **Step 4: Run the tests — expect all to pass**

```
cd bot && node --test test-guard.js
```

Expected output: all tests pass (no failures).

---

### Task 2: Add `normalizePhoneToJid` to `bot/state.js`

**Files:**
- Modify: `bot/state.js` (add one export at the end)
- Modify: `bot/test-guard.js` (add a describe block for the new function)

- [ ] **Step 1a: Add the import to the top of `bot/test-guard.js`** (alongside the existing imports)

```js
import { normalizePhoneToJid } from './state.js';
```

- [ ] **Step 1b: Append the describe block at the end of `bot/test-guard.js`**, after the last `describe`:

```js
describe('normalizePhoneToJid', () => {
  test('10-digit number gets 549 prefix and @s.whatsapp.net suffix', () => {
    assert.equal(normalizePhoneToJid('3513042203'), '5493513042203@s.whatsapp.net');
  });

  test('full international number is normalized', () => {
    assert.equal(normalizePhoneToJid('+54 9 351 304 2203'), '5493513042203@s.whatsapp.net');
  });

  test('returns null for non-phone input', () => {
    assert.equal(normalizePhoneToJid('abc'), null);
    assert.equal(normalizePhoneToJid(''), null);
    assert.equal(normalizePhoneToJid(null), null);
  });
});
```

- [ ] **Step 2: Run the tests — expect the new describe to fail (function not found)**

```
cd bot && node --test test-guard.js
```

Expected: `SyntaxError` or `normalizePhoneToJid is not a function`

- [ ] **Step 3: Add `normalizePhoneToJid` to the end of `bot/state.js`**

Open `bot/state.js` and append after the last export (`resetHistory`):

```js
// Converts a human phone string to a WhatsApp JID.
// input: "351 304 2203", "+5493513042203", etc.
// returns: "5493513042203@s.whatsapp.net" or null if the input isn't a valid phone.
// Distinct from cleanPhone() which returns only digits.
export function normalizePhoneToJid(input) {
  const phone = cleanPhone(input);
  return phone ? `${phone}@s.whatsapp.net` : null;
}
```

- [ ] **Step 4: Run the tests — expect all to pass**

```
cd bot && node --test test-guard.js
```

Expected: all tests pass.

---

### Task 3: Add admin commands to `bot/admin.js`

**Files:**
- Modify: `bot/admin.js`

No new tests here — the commands delegate entirely to `guard.js` (already tested) and `normalizePhoneToJid` (already tested). Integration is straightforward.

- [ ] **Step 1: Add imports at the top of `bot/admin.js`**

Replace the existing import block:

```js
import { listByFecha, findById, cancelReserva, findFuturasByTelefono } from './supabase.js';
import { todayISO } from './slots.js';
```

With:

```js
import { listByFecha, findById, cancelReserva, findFuturasByTelefono } from './supabase.js';
import { todayISO } from './slots.js';
import * as guard from './guard.js';
import { normalizePhoneToJid } from './state.js';
```

- [ ] **Step 2: Update the `HELP` constant in `bot/admin.js`**

Replace:

```js
const HELP = [
  '*Comandos admin disponibles:*',
  '/turnos              → turnos de hoy',
  '/turnos YYYY-MM-DD   → turnos de una fecha',
  '/cancelar <id>       → cancelar por id (UUID)',
  '/cancelar <telefono> → cancelar próximo turno de un teléfono',
  '/help                → esta ayuda',
].join('\n');
```

With:

```js
const HELP = [
  '*Comandos admin disponibles:*',
  '/turnos              → turnos de hoy',
  '/turnos YYYY-MM-DD   → turnos de una fecha',
  '/cancelar <id>       → cancelar por id (UUID)',
  '/cancelar <telefono> → cancelar próximo turno de un teléfono',
  '/bloquear <numero>   → bloquear un número de WhatsApp',
  '/desbloquear <numero> → desbloquear un número',
  '/bloqueados          → listar números bloqueados',
  '/help                → esta ayuda',
].join('\n');
```

- [ ] **Step 3: Add three new cases to the `switch` in `bot/admin.js`**

Inside `handleAdmin`, in the `switch (cmd.toLowerCase())` block, replace the `default:` case with the three new cases followed by `default:`:

```js
      case '/bloquear': {
        if (!args) return { handled: true, reply: 'Usá: /bloquear <numero>' };
        const jid = normalizePhoneToJid(args);
        if (!jid) return { handled: true, reply: `No pude interpretar "${args}" como número de teléfono.` };
        guard.blockJid(jid);
        return { handled: true, reply: `Bloqueado: ${jid}` };
      }

      case '/desbloquear': {
        if (!args) return { handled: true, reply: 'Usá: /desbloquear <numero>' };
        const jid = normalizePhoneToJid(args);
        if (!jid) return { handled: true, reply: `No pude interpretar "${args}" como número de teléfono.` };
        if (!guard.isBlocked(jid)) return { handled: true, reply: `${jid} no estaba bloqueado.` };
        guard.unblockJid(jid);
        return { handled: true, reply: `Desbloqueado: ${jid}` };
      }

      case '/bloqueados': {
        const list = guard.listBlocked();
        if (!list.length) return { handled: true, reply: 'No hay números bloqueados.' };
        const lines = list.map(e => {
          const fecha = new Date(e.blockedAt).toLocaleDateString('es-AR');
          return `${e.jid}  (desde ${fecha})`;
        });
        return { handled: true, reply: `*Números bloqueados (${list.length}):*\n${lines.join('\n')}` };
      }

      default:
        return { handled: true, reply: `Comando desconocido. ${HELP}` };
```

---

### Task 4: Integrate `guard` into `bot/whatsapp.js`

**Files:**
- Modify: `bot/whatsapp.js`

- [ ] **Step 1: Add the `guard` import to `bot/whatsapp.js`**

Replace the existing import block at the top:

```js
import { ADMIN_JID } from './config.js';
import { handleAdmin } from './admin.js';
import { handleMessage, ProviderBusyError } from './agent.js';
import { setRealJid } from './state.js';
```

With:

```js
import { ADMIN_JID } from './config.js';
import { handleAdmin } from './admin.js';
import { handleMessage, ProviderBusyError } from './agent.js';
import { setRealJid } from './state.js';
import * as guard from './guard.js';
```

- [ ] **Step 2: Replace the message processing block in `bot/whatsapp.js`**

Find this block (lines ~143–179):

```js
      const text = extractText(m).trim();
      if (!text) continue;

      // Serializamos por JID: si llegan varios mensajes del mismo cliente,
      // se procesan uno tras otro (no en paralelo). NO esperamos esta promesa
      // acá para no bloquear la cola global de Baileys con un único cliente
      // lento.
      enqueueFor(from, async () => {
        try {
          // Rama admin: comandos que empiezan con "/"
          if (ADMIN_JID && from === ADMIN_JID) {
            const { handled, reply } = await handleAdmin(text);
            if (handled) {
              await sock.sendMessage(from, { text: reply });
              return;
            }
          }

          // Rama cliente: lenguaje natural via LLM (Cerebras / Llama)
          await sock.sendPresenceUpdate('composing', from).catch(() => {});
          const reply = await handleMessage(from, text);
          await sock.sendMessage(from, { text: reply });
        } catch (err) {
          console.error('[whatsapp] ERROR procesando mensaje de', from);
          console.error('  texto recibido:', JSON.stringify(text));
          console.error('  mensaje del error:', err?.message || err);
          console.error('  stack:', err?.stack);
          if (err?.response) console.error('  response:', JSON.stringify(err.response).slice(0, 500));

          const userMsg = err instanceof ProviderBusyError
            ? 'Estoy con mucha demanda en este momento, disculpá. ¿Podés volver a escribirme en un minuto?'
            : 'Uy, algo falló de nuestro lado. ¿Podés intentar de vuelta en un ratito?';
          try {
            await sock.sendMessage(from, { text: userMsg });
          } catch {}
        }
      });
```

Replace it with:

```js
      const rawText = extractText(m).trim();
      if (!rawText) continue;

      const { allowed, reason, firstOffense, text } = guard.check(from, rawText);
      if (!allowed) {
        if (firstOffense && reason !== 'blocked') {
          const warnMsg = reason === 'rate_limit'
            ? 'Estás mandando muchos mensajes seguidos. Esperá un momento antes de escribir de nuevo.'
            : 'Hay varios mensajes tuyos en espera. Esperá a que los procese antes de mandar más.';
          await sock.sendMessage(from, { text: warnMsg }).catch(() => {});
        }
        continue;
      }

      // Serializamos por JID: si llegan varios mensajes del mismo cliente,
      // se procesan uno tras otro (no en paralelo). NO esperamos esta promesa
      // acá para no bloquear la cola global de Baileys con un único cliente
      // lento.
      enqueueFor(from, async () => {
        try {
          // Rama admin: comandos que empiezan con "/"
          if (ADMIN_JID && from === ADMIN_JID) {
            const { handled, reply } = await handleAdmin(text);
            if (handled) {
              await sock.sendMessage(from, { text: reply });
              return;
            }
          }

          // Rama cliente: lenguaje natural via LLM (Cerebras / Llama)
          await sock.sendPresenceUpdate('composing', from).catch(() => {});
          const reply = await handleMessage(from, text);
          await sock.sendMessage(from, { text: reply });
        } catch (err) {
          console.error('[whatsapp] ERROR procesando mensaje de', from);
          console.error('  texto recibido:', JSON.stringify(text));
          console.error('  mensaje del error:', err?.message || err);
          console.error('  stack:', err?.stack);
          if (err?.response) console.error('  response:', JSON.stringify(err.response).slice(0, 500));

          const userMsg = err instanceof ProviderBusyError
            ? 'Estoy con mucha demanda en este momento, disculpá. ¿Podés volver a escribirme en un minuto?'
            : 'Uy, algo falló de nuestro lado. ¿Podés intentar de vuelta en un ratito?';
          try {
            await sock.sendMessage(from, { text: userMsg });
          } catch {}
        } finally {
          guard.queueDecrement(from);
        }
      });
```

Key changes: `text` → `rawText` for the raw extraction, `guard.check` gate with warning, `text` (sanitized) used throughout the enqueued function, `guard.queueDecrement` in `finally`.

---

### Task 5: Call `guard.load()` in `bot/index.js`

**Files:**
- Modify: `bot/index.js`

- [ ] **Step 1: Add `guard.load()` to the startup sequence in `bot/index.js`**

Find this block near the bottom of `bot/index.js`:

```js
const { loadState }         = await import('./state.js');
const { connectToWhatsApp } = await import('./whatsapp.js');
const { startScheduler }    = await import('./scheduler.js');

try {
  await loadState();
  await connectToWhatsApp();
  startScheduler();
} catch (err) {
  console.error('[fatal]', err);
  process.exit(1);
}
```

Replace with:

```js
const { loadState }         = await import('./state.js');
const { load: loadGuard }   = await import('./guard.js');
const { connectToWhatsApp } = await import('./whatsapp.js');
const { startScheduler }    = await import('./scheduler.js');

try {
  await loadState();
  await loadGuard();
  await connectToWhatsApp();
  startScheduler();
} catch (err) {
  console.error('[fatal]', err);
  process.exit(1);
}
```

- [ ] **Step 2: Run the full test suite one final time to confirm nothing broke**

```
cd bot && node --test test-guard.js
```

Expected: all tests pass.

- [ ] **Step 3: Verify the bot starts without errors (smoke test)**

```
cd bot && node index.js
```

Expected: log lines like `[state] cargado: ...` and `[guard] blocklist cargada: 0 bloqueados` appear before the QR prompt. No `Cannot find module` or `SyntaxError` errors. Stop with Ctrl+C once the logs look clean.
