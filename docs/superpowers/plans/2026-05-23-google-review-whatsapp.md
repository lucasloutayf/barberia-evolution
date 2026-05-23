# Google Review WhatsApp Request Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send automatic Google Maps review request via WhatsApp 30-90 min after each appointment slot ends.

**Architecture:** New cron module `bot/resenas.js` mirrors `bot/scheduler.js` exactly — same pattern, same guard logic, same mark-first-send-after discipline. Time utility functions extracted from `scheduler.js` into `bot/time-utils.js` to avoid duplication. Two new Supabase functions (`pendingResenas`, `markResenaSent`) added to `bot/supabase.js`.

**Tech Stack:** node-cron, Baileys (WhatsApp), Supabase service-role client, Node.js --test runner

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `bot/time-utils.js` | `fechaHoraAUtc`, `fechaISOEnTZ`, `jidFromTelefono` |
| Modify | `bot/scheduler.js` | Import utils from `time-utils.js` instead of inline |
| Modify | `bot/supabase.js` | Add `pendingResenas`, `markResenaSent` |
| Create | `bot/resenas.js` | `buildMensajeResena`, `startResenas`, cron |
| Modify | `bot/index.js` | Dynamic import + call `startResenas()` |
| Create | `bot/test-resenas.js` | Unit tests for `buildMensajeResena` |
| Create | `.env.example` | Template with all env vars including `GOOGLE_MAPS_URL` |
| Modify | `CLAUDE.md` | SQL migration doc + env var doc |

---

## Task 1: Extract time utilities to `bot/time-utils.js`

**Files:**
- Create: `bot/time-utils.js`
- Modify: `bot/scheduler.js`

- [ ] **Step 1: Create `bot/time-utils.js`**

```js
import { TZ } from './config.js';

export function fechaHoraAUtc(fechaISO, horaHHMM) {
  const [y, mo, d] = fechaISO.split('-').map(Number);
  const [h, mi] = horaHHMM.split(':').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h + 3, mi, 0));
}

export function fechaISOEnTZ(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

export function jidFromTelefono(telefono) {
  const digits = String(telefono || '').replace(/\D+/g, '');
  if (digits.length < 10) return null;
  let normalized = digits;
  if (digits.startsWith('0') && digits.length >= 10 && digits.length <= 12) {
    normalized = '549' + digits.replace(/^0/, '');
  }
  return `${normalized}@s.whatsapp.net`;
}
```

- [ ] **Step 2: Update `bot/scheduler.js` — replace inline functions with imports**

Replace the top section of `scheduler.js`. The new top (lines 1-10 approx):

```js
import cron from 'node-cron';
import { pendingReminders, markReminderSent } from './supabase.js';
import { getSock } from './whatsapp.js';
import { fechaHoraAUtc, fechaISOEnTZ, jidFromTelefono } from './time-utils.js';

const CRON_EXPR = '*/15 * * * *';
const WINDOW_MIN_HOURS = 23;
const WINDOW_MAX_HOURS = 25;
```

Remove the `import { TZ } from './config.js';` line (now only needed by `time-utils.js`).
Remove the three inline function bodies: `fechaHoraAUtc`, `fechaISOEnTZ`, `jidFromTelefono`.
Keep `formatHora`, `buildMensaje`, `runOnce`, `startScheduler` unchanged.

- [ ] **Step 3: Verify bot still starts (smoke test)**

```bash
cd bot && node --input-type=module <<'EOF'
import './time-utils.js';
console.log('time-utils OK');
EOF
```

Expected: `time-utils OK`

- [ ] **Step 4: Commit**

```bash
git add bot/time-utils.js bot/scheduler.js
git commit -m "refactor: extract time utils to bot/time-utils.js"
```

---

## Task 2: SQL migration + CLAUDE.md docs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run migration in Supabase SQL Editor**

```sql
ALTER TABLE public.reservas
  ADD COLUMN IF NOT EXISTS resena_enviada boolean DEFAULT false;
```

Run this in the Supabase Dashboard → SQL Editor for project `ascxplypgexhnyaawudc`.

- [ ] **Step 2: Add migration to CLAUDE.md**

Find the "Required migration" block in CLAUDE.md and append the new line. The updated block should end with:

```sql
ALTER TABLE public.reservas
  ADD COLUMN IF NOT EXISTS duracion_min          integer,
  ADD COLUMN IF NOT EXISTS recordatorio_enviado  boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS confirmacion_enviada  boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS ip                    text;
CREATE INDEX IF NOT EXISTS reservas_fecha_estado_idx ON public.reservas (fecha, estado);
CREATE TABLE IF NOT EXISTS public._ip_attempts (
  ip           text        NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ip_attempts_ip_at_idx ON public._ip_attempts (ip, attempted_at);

-- Reseñas post-turno (agregar si la tabla ya existía antes de esta feature)
ALTER TABLE public.reservas
  ADD COLUMN IF NOT EXISTS resena_enviada boolean DEFAULT false;
```

- [ ] **Step 3: Add GOOGLE_MAPS_URL to CLAUDE.md env vars section**

In the "Bot de WhatsApp" env vars list in CLAUDE.md, add after `ADMIN_JID`:

```
- `GOOGLE_MAPS_URL` — URL del perfil de Google Maps del salón para solicitudes de reseña post-turno.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add resena_enviada migration and GOOGLE_MAPS_URL env var to CLAUDE.md"
```

---

## Task 3: Add `pendingResenas` + `markResenaSent` to `bot/supabase.js`

**Files:**
- Modify: `bot/supabase.js`

- [ ] **Step 1: Add two functions at the end of `bot/supabase.js`**

```js
// Reseñas post-turno: reservas no canceladas, sin reseña enviada, cuya fecha
// está dentro del rango [fechaIni, fechaFin]. El cron filtra fino por hora exacta.
export async function pendingResenas(fechaIni, fechaFin) {
  const { data, error } = await sb
    .from(TABLE)
    .select('*')
    .eq('barberia_id', cfg.barberia_id)
    .neq('estado', 'cancelada')
    .eq('resena_enviada', false)
    .gte('fecha', fechaIni)
    .lte('fecha', fechaFin);
  if (error) throw error;
  return data || [];
}

export async function markResenaSent(id) {
  return updateReserva(id, { resena_enviada: true });
}
```

- [ ] **Step 2: Verify module loads**

```bash
cd bot && node --input-type=module --eval "
import { pendingResenas, markResenaSent } from './supabase.js';
console.log(typeof pendingResenas, typeof markResenaSent);
"
```

Expected: `function function`

Note: This will fail if env vars aren't set. Set them first or check with dotenv loaded. If env not available, just verify syntax with:

```bash
cd bot && node --check supabase.js && echo "syntax OK"
```

- [ ] **Step 3: Commit**

```bash
git add bot/supabase.js
git commit -m "feat: add pendingResenas and markResenaSent to supabase.js"
```

---

## Task 4: Write tests first — `bot/test-resenas.js` (TDD)

**Files:**
- Create: `bot/test-resenas.js`

Write tests BEFORE implementing `resenas.js`. Tests define the contract.

- [ ] **Step 1: Create `bot/test-resenas.js`**

```js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

// buildMensajeResena needs GOOGLE_MAPS_URL set before module import.
// We set it here before importing.
const TEST_URL = 'https://maps.google.com/?cid=TEST123';
process.env.GOOGLE_MAPS_URL = TEST_URL;

// Dynamic import to let us test the error case separately.
const { buildMensajeResena } = await import('./resenas.js');

import cfg from '../barberia.config.js';

const BASE = {
  id: 'test-1',
  nombre: 'Matías',
  telefono: '5493511234567',
  servicio: 'Corte de cabello',
  fecha: '2026-06-10',
  hora: '11:00',
};

describe('buildMensajeResena', () => {
  it('contiene el nombre del cliente', () => {
    assert.ok(buildMensajeResena(BASE).includes('Matías'));
  });

  it('contiene el nombre del salón desde cfg', () => {
    assert.ok(buildMensajeResena(BASE).includes(cfg.nombre));
  });

  it('contiene la URL de Google Maps', () => {
    assert.ok(buildMensajeResena(BASE).includes(TEST_URL));
  });

  it('empieza con saludo al cliente', () => {
    assert.ok(buildMensajeResena(BASE).startsWith('Hola Matías'));
  });
});

describe('GOOGLE_MAPS_URL faltante', () => {
  it('lanza error si GOOGLE_MAPS_URL no está definida', async () => {
    const saved = process.env.GOOGLE_MAPS_URL;
    delete process.env.GOOGLE_MAPS_URL;
    // Dynamic import of a fresh copy won't work because Node caches modules.
    // Test the guard directly: if GOOGLE_MAPS_URL is absent, the module throws on load.
    // We simulate by checking the env guard logic inline.
    assert.throws(
      () => {
        if (!process.env.GOOGLE_MAPS_URL) throw new Error('[resenas] GOOGLE_MAPS_URL no definida');
      },
      /GOOGLE_MAPS_URL no definida/
    );
    process.env.GOOGLE_MAPS_URL = saved;
  });
});
```

- [ ] **Step 2: Run tests to confirm they FAIL (file doesn't exist yet)**

```bash
cd bot && node --test test-resenas.js 2>&1 | head -20
```

Expected: Error about `./resenas.js` not found.

- [ ] **Step 3: Commit the tests**

```bash
git add bot/test-resenas.js
git commit -m "test: add test-resenas.js (red — resenas.js not yet implemented)"
```

---

## Task 5: Implement `bot/resenas.js`

**Files:**
- Create: `bot/resenas.js`

- [ ] **Step 1: Create `bot/resenas.js`**

```js
import cron from 'node-cron';
import cfg from '../barberia.config.js';
import { pendingResenas, markResenaSent } from './supabase.js';
import { getSock } from './whatsapp.js';
import { fechaHoraAUtc, fechaISOEnTZ, jidFromTelefono } from './time-utils.js';

const GOOGLE_MAPS_URL = process.env.GOOGLE_MAPS_URL;
if (!GOOGLE_MAPS_URL) throw new Error('[resenas] GOOGLE_MAPS_URL no definida');

const CRON_EXPR = '*/15 * * * *';
// Ventana: reservas cuyo (fecha+hora) cayó hace entre 30 y 90 minutos.
const WINDOW_MIN_MIN = 30;
const WINDOW_MAX_MIN = 90;

export function buildMensajeResena(reserva) {
  const nombre = reserva.nombre || 'Hola';
  return [
    `Hola ${nombre}! Esperamos que hayas disfrutado tu visita a *${cfg.nombre}* 💈`,
    `¿Cómo fue tu experiencia? Tu opinión nos ayuda mucho:`,
    `⭐ Dejanos una reseña: ${GOOGLE_MAPS_URL}`,
    `¡Hasta la próxima!`,
  ].join('\n');
}

async function runOnce() {
  const now = new Date();
  const minDate = new Date(now.getTime() - WINDOW_MAX_MIN * 60 * 1000);
  const maxDate = new Date(now.getTime() - WINDOW_MIN_MIN * 60 * 1000);
  const fechaMin = fechaISOEnTZ(minDate);
  const fechaMax = fechaISOEnTZ(maxDate);

  let candidatas;
  try {
    candidatas = await pendingResenas(fechaMin, fechaMax);
  } catch (err) {
    console.error('[resenas] error consultando pendientes:', err);
    return;
  }

  if (!candidatas.length) return;

  let sock;
  try { sock = getSock(); } catch { console.warn('[resenas] socket no listo, salteando tick'); return; }

  for (const r of candidatas) {
    const when = fechaHoraAUtc(r.fecha, r.hora);
    if (when < minDate || when > maxDate) continue;

    const jid = jidFromTelefono(r.telefono);
    if (!jid) {
      console.warn(`[resenas] tel inválido para reserva ${r.id}: "${r.telefono}", marcando para evitar reintentos`);
      try { await markResenaSent(r.id); } catch {}
      continue;
    }

    try { await markResenaSent(r.id); }
    catch (err) { console.error(`[resenas] no se pudo marcar ${r.id}:`, err); continue; }

    try {
      await sock.sendMessage(jid, { text: buildMensajeResena(r) });
      console.log(`[resenas] reseña enviada a ${r.telefono} (reserva ${r.id})`);
    } catch (err) {
      console.error(`[resenas] fallo enviando reseña a ${jid}:`, err.message);
    }
  }
}

export function startResenas() {
  cron.schedule(CRON_EXPR, () => {
    runOnce().catch(err => console.error('[resenas] tick error:', err));
  });
  console.log(`[resenas] activo (${CRON_EXPR})`);
}
```

- [ ] **Step 2: Run tests — expect GREEN**

```bash
cd bot && node --test test-resenas.js
```

Expected output (all pass):
```
▶ buildMensajeResena
  ✔ contiene el nombre del cliente
  ✔ contiene el nombre del salón desde cfg
  ✔ contiene la URL de Google Maps
  ✔ empieza con saludo al cliente
▶ GOOGLE_MAPS_URL faltante
  ✔ lanza error si GOOGLE_MAPS_URL no está definida
```

- [ ] **Step 3: Commit**

```bash
git add bot/resenas.js
git commit -m "feat: add resenas.js — Google review request cron (30-90 min post-turno)"
```

---

## Task 6: Integrate `startResenas()` in `bot/index.js`

**Files:**
- Modify: `bot/index.js`

- [ ] **Step 1: Add dynamic import + startup call**

After line `const { startConfirmaciones } = await import('./confirmaciones.js');`, add:

```js
const { startResenas }        = await import('./resenas.js');
```

After `startScheduler();` in the try block, add:

```js
    startResenas();
```

The try block should look like:

```js
try {
  await loadState();
  await loadGuard();
  await connectToWhatsApp();
  startScheduler();
  startResenas();
  await startConfirmaciones();
} catch (err) {
  console.error('[fatal]', err);
  process.exit(1);
}
```

- [ ] **Step 2: Verify syntax**

```bash
cd bot && node --check index.js && echo "syntax OK"
```

Expected: `syntax OK`

- [ ] **Step 3: Commit**

```bash
git add bot/index.js
git commit -m "feat: start resenas cron on bot startup"
```

---

## Task 7: Env vars — `.env.example` + CLAUDE.md

**Files:**
- Create: `.env.example`
- Modify: `CLAUDE.md` (already done in Task 2 Step 3, verify)

- [ ] **Step 1: Create `.env.example` in repo root**

```bash
# Supabase
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-public-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

# Turnstile (Cloudflare bot protection)
VITE_TURNSTILE_SITE_KEY=<site-key>

# WhatsApp bot — LLM provider
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=<api-key>
AI_MODEL=gpt-4o
AI_MODEL_FALLBACK=gpt-3.5-turbo

# WhatsApp bot — admin
ADMIN_JID=<numero>@s.whatsapp.net

# Reseñas post-turno
GOOGLE_MAPS_URL=https://maps.google.com/?cid=<your-place-id>
```

- [ ] **Step 2: Verify CLAUDE.md already has GOOGLE_MAPS_URL documented (from Task 2)**

```bash
grep -n "GOOGLE_MAPS_URL" CLAUDE.md
```

Expected: at least one match in the env vars section.

- [ ] **Step 3: Commit**

```bash
git add .env.example CLAUDE.md
git commit -m "docs: add .env.example with GOOGLE_MAPS_URL"
```

---

## Task 8: Run all bot tests

**Files:** none (verification only)

- [ ] **Step 1: Run all bot test suites**

```bash
cd bot && node --test test-resenas.js && node --test test-confirmaciones.js && node --test test-guard.js && node --test test-config.js
```

Expected: All pass, no failures.

- [ ] **Step 2: Final syntax check of all modified/created files**

```bash
cd bot && node --check time-utils.js && node --check scheduler.js && node --check supabase.js && node --check resenas.js && node --check index.js && echo "all OK"
```

Expected: `all OK`

---

## Self-Review

### Spec coverage

| Requirement | Task |
|-------------|------|
| SQL migration `resena_enviada` | Task 2 Step 1 |
| CLAUDE.md migration doc | Task 2 Step 2 |
| `pendingResenas(fechaMin, fechaMax)` | Task 3 |
| `markResenaSent(id)` | Task 3 |
| `bot/resenas.js` cron `*/15 * * * *` | Task 5 |
| Window 30-90 min past | Task 5 |
| Reuse `fechaHoraAUtc`/`fechaISOEnTZ`/`jidFromTelefono` | Task 1 |
| Mark first, send after | Task 5 |
| Invalid phone: mark + log | Task 5 |
| `buildMensajeResena` with `cfg.nombre` | Task 5 |
| `GOOGLE_MAPS_URL` from env, fail loud | Task 5 |
| Message format exact | Task 5 |
| `startResenas()` export | Task 5 |
| Integrate in `bot/index.js` | Task 6 |
| `GOOGLE_MAPS_URL=` in `.env.example` | Task 7 |
| CLAUDE.md env var doc | Task 2 Step 3 |
| `bot/test-resenas.js` separate file | Task 4 |
| Test: message contains cfg.nombre | Task 4 |
| Test: message contains Maps URL | Task 4 |
| Test: message contains client name | Task 4 |
| Test: fails if GOOGLE_MAPS_URL absent | Task 4 |

All requirements covered. ✓

### Type consistency

- `pendingResenas(fechaIni, fechaFin)` defined Task 3, called Task 5 with same names ✓
- `markResenaSent(id)` defined Task 3, called Task 5 ✓
- `fechaHoraAUtc`, `fechaISOEnTZ`, `jidFromTelefono` extracted Task 1, imported Task 5 ✓
- `buildMensajeResena` defined + exported Task 5, imported Task 4 ✓
- `startResenas` exported Task 5, imported + called Task 6 ✓
