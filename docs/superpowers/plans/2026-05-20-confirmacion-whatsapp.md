# WhatsApp Confirmation on Booking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send an immediate WhatsApp confirmation to the client whenever a reservation is created — from the web form (via Supabase Realtime) or via the WhatsApp bot (inline, bypassing Realtime).

**Architecture:** A new `bot/format.js` module owns `buildConfirmacion()` (pure function, no I/O). `bot/confirmaciones.js` subscribes to Supabase Realtime INSERT events and handles the web-form path. `bot/tools.js` and `bot/agent.js` handle the WhatsApp-bot path inline, marking `confirmacion_enviada = true` at insert time so Realtime ignores those rows.

**Tech Stack:** Node.js ESM, `@supabase/supabase-js` Realtime, Baileys `sock.sendMessage`, `node:test`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `bot/format.js` | **Create** | `buildConfirmacion(reserva)` — pure text builder |
| `bot/test-confirmaciones.js` | **Create** | Unit tests for `buildConfirmacion` |
| `bot/confirmaciones.js` | **Create** | Realtime listener + startup scan + error notifications |
| `bot/supabase.js` | **Modify** | Add `getClient()`, `markConfirmacionEnviada()`, `pendingConfirmaciones()` |
| `bot/tools.js` | **Modify** | Insert with `confirmacion_enviada: true`; return `mensaje_confirmacion` |
| `bot/agent.js` | **Modify** | Short-circuit after `crear_reserva` using `mensaje_confirmacion` |
| `bot/index.js` | **Modify** | Import and call `startConfirmaciones()` after `connectToWhatsApp()` |
| Supabase SQL | **Run once** | New column + enable Realtime on table |

---

## Task 1: SQL Migration

**Files:** Supabase SQL Editor (no local files)

- [ ] **Step 1: Run migration in Supabase SQL Editor**

Open the Supabase dashboard → SQL Editor → New query. Paste and run:

```sql
ALTER TABLE public.reservas
  ADD COLUMN IF NOT EXISTS confirmacion_enviada boolean DEFAULT false;

ALTER PUBLICATION supabase_realtime ADD TABLE public.reservas;
```

- [ ] **Step 2: Verify the column was created**

```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'reservas' AND column_name = 'confirmacion_enviada';
```

Expected: one row, `data_type = boolean`, `column_default = false`.

- [ ] **Step 3: Commit a migration note**

```bash
git commit --allow-empty -m "chore: run SQL — add confirmacion_enviada column + enable Realtime on reservas"
```

---

## Task 2: `bot/supabase.js` — Three new exports

**Files:**
- Modify: `bot/supabase.js`

- [ ] **Step 1: Write the failing test (manual check — no unit test for DB layer)**

The DB functions are thin wrappers; correctness is verified in Task 8 (integration). Skip to implementation.

- [ ] **Step 2: Add exports to `bot/supabase.js`**

Append these three functions at the end of the file (after `markReminderSent`):

```js
// Exposes the raw client for Realtime subscriptions in confirmaciones.js.
export function getClient() { return sb; }

// Atomic claim: sets confirmacion_enviada=true only if it's currently false.
// Returns true if this call claimed the row (safe to send), false if already claimed.
export async function markConfirmacionEnviada(id) {
  const { data, error } = await sb
    .from(TABLE)
    .update({ confirmacion_enviada: true })
    .eq('id', id)
    .eq('confirmacion_enviada', false)
    .select('id');
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

// Returns reservas created in the last 24 hours that haven't been claimed yet.
// Used by the startup scan in confirmaciones.js to catch events missed while the bot was down.
export async function pendingConfirmaciones() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from(TABLE)
    .select('*')
    .eq('confirmacion_enviada', false)
    .gte('created_at', cutoff);
  if (error) throw error;
  return data ?? [];
}
```

- [ ] **Step 3: Commit**

```bash
git add bot/supabase.js
git commit -m "feat(bot): add getClient, markConfirmacionEnviada, pendingConfirmaciones to supabase.js"
```

---

## Task 3: `bot/format.js` — `buildConfirmacion` (TDD)

**Files:**
- Create: `bot/format.js`
- Create: `bot/test-confirmaciones.js`

- [ ] **Step 1: Write the failing tests**

Create `bot/test-confirmaciones.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildConfirmacion } from './format.js';

// Compute today/tomorrow in Argentina TZ at test runtime (matches format.js logic).
const TZ = 'America/Argentina/Buenos_Aires';
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const MANANA = (() => {
  const d = new Date(); d.setDate(d.getDate() + 1);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
})();

// 2026-06-03 is a Wednesday; 2026-06-08 is a Monday.
const BASE = {
  nombre: 'Lucas',
  fecha: '2026-06-03',
  hora: '14:00',
  servicio: 'Tintura & Coloración',
  duracion_min: 120,
};

describe('buildConfirmacion', () => {
  it('encabezado con nombre del cliente', () => {
    assert.ok(buildConfirmacion(BASE).startsWith('Listo, Lucas.'));
  });

  it('fecha con día de semana y DD/MM', () => {
    assert.ok(buildConfirmacion(BASE).includes('Miércoles 03/06 a las 14:00'));
  });

  it('nombre del servicio', () => {
    assert.ok(buildConfirmacion(BASE).includes('Tintura & Coloración'));
  });

  it('duración 2 horas exactas', () => {
    assert.ok(buildConfirmacion(BASE).includes('Dura 2 horas'));
  });

  it('duración 1 hora exacta', () => {
    assert.ok(buildConfirmacion({ ...BASE, duracion_min: 60 }).includes('Dura 1 hora'));
  });

  it('duración en minutos cuando < 60', () => {
    const msg = buildConfirmacion({ ...BASE, servicio: 'Corte de cabello', duracion_min: 30 });
    assert.ok(msg.includes('Dura 30 minutos'));
  });

  it('duración con horas y minutos restantes', () => {
    assert.ok(buildConfirmacion({ ...BASE, duracion_min: 90 }).includes('Dura 1 hora y 30 minutos'));
  });

  it('precio formateado con punto como separador de miles', () => {
    assert.ok(buildConfirmacion(BASE).includes('$18.000'));
  });

  it('lookup duracion_min desde config si reserva.duracion_min es null', () => {
    // Tintura & Coloración = 120min en config.js
    assert.ok(buildConfirmacion({ ...BASE, duracion_min: null }).includes('Dura 2 horas'));
  });

  it('omite línea de precio si el servicio no existe en el catálogo', () => {
    const msg = buildConfirmacion({ ...BASE, servicio: 'Servicio fantasma', duracion_min: 30 });
    assert.ok(!msg.includes('Precio'));
  });

  it('cierre dinámico: hoy', () => {
    assert.ok(buildConfirmacion({ ...BASE, fecha: HOY }).includes('Nos vemos hoy'));
  });

  it('cierre dinámico: mañana', () => {
    assert.ok(buildConfirmacion({ ...BASE, fecha: MANANA }).includes('Nos vemos mañana'));
  });

  it('cierre dinámico: día de semana para fechas futuras', () => {
    // 2026-06-08 = Lunes
    assert.ok(buildConfirmacion({ ...BASE, fecha: '2026-06-08' }).includes('Nos vemos el Lunes'));
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd bot
node --test test-confirmaciones.js
```

Expected: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module './format.js'`

- [ ] **Step 3: Create `bot/format.js`**

```js
import { findServiceByNombre, TZ } from './config.js';

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function formatDuracion(min) {
  if (min < 60) return `${min} minutos`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (m === 0) return h === 1 ? '1 hora' : `${h} horas`;
  return `${h} hora${h > 1 ? 's' : ''} y ${m} minutos`;
}

function todayEnTZ() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

function tomorrowEnTZ() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
}

export function buildConfirmacion(reserva) {
  const svc = findServiceByNombre(reserva.servicio);
  const duracion = reserva.duracion_min ?? svc?.duracion_min ?? 30;
  const precio = svc?.precio;

  const [y, mo, d] = reserva.fecha.split('-').map(Number);
  const diaSemana = DIAS[new Date(y, mo - 1, d).getDay()];
  const dd = String(d).padStart(2, '0');
  const mm = String(mo).padStart(2, '0');

  let cierre;
  if (reserva.fecha === todayEnTZ())    cierre = '¡Nos vemos hoy!';
  else if (reserva.fecha === tomorrowEnTZ()) cierre = '¡Nos vemos mañana!';
  else                                  cierre = `¡Nos vemos el ${diaSemana}!`;

  const lines = [
    `Listo, ${reserva.nombre}. Te confirmo tu turno:`,
    ``,
    `📅 ${diaSemana} ${dd}/${mm} a las ${reserva.hora}`,
    `💇 ${reserva.servicio}`,
    `⏳ Dura ${formatDuracion(duracion)}`,
  ];
  if (precio != null) lines.push(`💲 Precio: $${precio.toLocaleString('es-AR')}`);
  lines.push(``, `Cualquier cosa, avisame. ${cierre}`);
  return lines.join('\n');
}
```

- [ ] **Step 4: Run tests — verify they all pass**

```bash
cd bot
node --test test-confirmaciones.js
```

Expected: `✔ encabezado con nombre del cliente` … 13 passing, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add bot/format.js bot/test-confirmaciones.js
git commit -m "feat(bot): add buildConfirmacion pure function with 13 unit tests"
```

---

## Task 4: `bot/confirmaciones.js` — Realtime + startup scan

**Files:**
- Create: `bot/confirmaciones.js`

- [ ] **Step 1: Create `bot/confirmaciones.js`**

```js
import { getSock } from './whatsapp.js';
import { normalizePhoneToJid } from './state.js';
import { getClient, markConfirmacionEnviada, pendingConfirmaciones } from './supabase.js';
import { buildConfirmacion } from './format.js';
import { ADMIN_JID } from './config.js';

async function notificarAdmin(texto) {
  if (!ADMIN_JID) { console.error('[confirmaciones]', texto); return; }
  try {
    await getSock().sendMessage(ADMIN_JID, { text: texto });
  } catch (err) {
    console.error('[confirmaciones] fallo notificando admin:', err.message);
  }
}

async function sendConfirmacion(reserva) {
  // Atomic claim: if this returns false, another process already claimed the row.
  const claimed = await markConfirmacionEnviada(reserva.id);
  if (!claimed) return;

  const jid = normalizePhoneToJid(reserva.telefono);
  if (!jid) {
    await notificarAdmin(
      `⚠️ Confirmación no enviada: teléfono inválido en reserva ${reserva.id} ("${reserva.telefono}")`
    );
    return;
  }

  try {
    await getSock().sendMessage(jid, { text: buildConfirmacion(reserva) });
    console.log(`[confirmaciones] confirmación enviada a ${reserva.telefono} (reserva ${reserva.id})`);
  } catch (err) {
    console.error(`[confirmaciones] fallo enviando a ${jid}:`, err.message);
    await notificarAdmin(
      `⚠️ Confirmación no enviada a ${reserva.telefono} (reserva ${reserva.id}): ${err.message}`
    );
  }
}

export async function startConfirmaciones() {
  // Realtime: fires on every INSERT. Ignores rows where confirmacion_enviada=true
  // (those come from the WhatsApp bot, which sends the message inline).
  getClient()
    .channel('confirmaciones-insert')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reservas' }, (payload) => {
      if (payload.new?.confirmacion_enviada) return;
      sendConfirmacion(payload.new).catch((err) =>
        console.error('[confirmaciones] error en handler Realtime:', err)
      );
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') console.log('[confirmaciones] Realtime activo');
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
        console.error(`[confirmaciones] Realtime status: ${status}`);
    });

  // Startup scan: covers reservas created while the bot was down (last 24h).
  try {
    const pending = await pendingConfirmaciones();
    if (pending.length) {
      console.log(`[confirmaciones] startup scan: ${pending.length} confirmación/es pendiente/s`);
      for (const r of pending) await sendConfirmacion(r);
    }
  } catch (err) {
    console.error('[confirmaciones] error en startup scan:', err);
  }

  console.log('[confirmaciones] activo');
}
```

- [ ] **Step 2: Commit**

```bash
git add bot/confirmaciones.js
git commit -m "feat(bot): add confirmaciones.js — Realtime listener + startup scan + admin alerts"
```

---

## Task 5: `bot/tools.js` — Insert with flag + return `mensaje_confirmacion`

**Files:**
- Modify: `bot/tools.js`

- [ ] **Step 1: Add import for `buildConfirmacion` at the top of `bot/tools.js`**

After the existing imports (around line 8), add:

```js
import { buildConfirmacion } from './format.js';
```

- [ ] **Step 2: In `crear_reserva`, add `confirmacion_enviada: true` to the insert payload**

Find this block in `crear_reserva` (around line 69):

```js
  const reserva = await insertReserva({
    nombre: nombre.trim(),
    telefono,
    servicio: svc.nombre,
    fecha,
    hora,
    mensaje: (mensaje || '').trim() || null,
    duracion_min: svc.duracion_min,
    estado: 'pendiente',
    recordatorio_enviado: false,
  });
```

Replace with:

```js
  const reserva = await insertReserva({
    nombre: nombre.trim(),
    telefono,
    servicio: svc.nombre,
    fecha,
    hora,
    mensaje: (mensaje || '').trim() || null,
    duracion_min: svc.duracion_min,
    estado: 'pendiente',
    recordatorio_enviado: false,
    confirmacion_enviada: true,
  });
```

- [ ] **Step 3: Add `mensaje_confirmacion` to the returned data**

Find the return statement (around line 81):

```js
  return {
    ok: true,
    data: {
      id: reserva.id,
      nombre: reserva.nombre,
      servicio: reserva.servicio,
      fecha: reserva.fecha,
      hora: reserva.hora,
      duracion_min: reserva.duracion_min,
      precio_ars: svc.precio,
      estado: reserva.estado,
    },
  };
```

Replace with:

```js
  return {
    ok: true,
    data: {
      id: reserva.id,
      nombre: reserva.nombre,
      servicio: reserva.servicio,
      fecha: reserva.fecha,
      hora: reserva.hora,
      duracion_min: reserva.duracion_min,
      precio_ars: svc.precio,
      estado: reserva.estado,
      mensaje_confirmacion: buildConfirmacion(reserva),
    },
  };
```

- [ ] **Step 4: Run existing guard tests to make sure nothing regressed**

```bash
cd bot
node --test test-guard.js
```

Expected: all 18 tests pass.

- [ ] **Step 5: Commit**

```bash
git add bot/tools.js
git commit -m "feat(bot): crear_reserva sets confirmacion_enviada=true and returns mensaje_confirmacion"
```

---

## Task 6: `bot/agent.js` — Short-circuit on `mensaje_confirmacion`

**Files:**
- Modify: `bot/agent.js`

- [ ] **Step 1: Add early return after successful `crear_reserva`**

Find this block in `agent.js` (around line 288):

```js
            if (fnName === 'crear_reserva' && result.ok) {
              reservaCreadaEsteTurno = true;
              if (!entry.nombre && args.nombre) setNombre(jid, args.nombre);
            }
```

Replace with:

```js
            if (fnName === 'crear_reserva' && result.ok) {
              reservaCreadaEsteTurno = true;
              if (!entry.nombre && args.nombre) setNombre(jid, args.nombre);
              if (result.data?.mensaje_confirmacion) {
                appendHistory(jid, 'user', userText);
                appendHistory(jid, 'assistant', result.data.mensaje_confirmacion);
                return result.data.mensaje_confirmacion;
              }
            }
```

- [ ] **Step 2: Run guard tests again**

```bash
cd bot
node --test test-guard.js
```

Expected: 18 passing.

- [ ] **Step 3: Commit**

```bash
git add bot/agent.js
git commit -m "feat(bot): agent returns buildConfirmacion text directly after crear_reserva"
```

---

## Task 7: `bot/index.js` — Wire up `startConfirmaciones`

**Files:**
- Modify: `bot/index.js`

- [ ] **Step 1: Add the dynamic import alongside the other imports**

Find this block in `bot/index.js` (around line 35):

```js
const { loadState }         = await import('./state.js');
const { load: loadGuard }   = await import('./guard.js');
const { connectToWhatsApp } = await import('./whatsapp.js');
const { startScheduler }    = await import('./scheduler.js');
```

Replace with:

```js
const { loadState }           = await import('./state.js');
const { load: loadGuard }     = await import('./guard.js');
const { connectToWhatsApp }   = await import('./whatsapp.js');
const { startScheduler }      = await import('./scheduler.js');
const { startConfirmaciones } = await import('./confirmaciones.js');
```

- [ ] **Step 2: Call `startConfirmaciones()` after `connectToWhatsApp()`**

Find this block in `bot/index.js`:

```js
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

Replace with:

```js
try {
  await loadState();
  await loadGuard();
  await connectToWhatsApp();
  startScheduler();
  await startConfirmaciones();
} catch (err) {
  console.error('[fatal]', err);
  process.exit(1);
}
```

- [ ] **Step 3: Commit**

```bash
git add bot/index.js
git commit -m "feat(bot): wire up startConfirmaciones in index.js"
```

---

## Task 8: Manual Integration Test

**Prerequisites:** bot running (`npm run dev` in `bot/`), WhatsApp connected.

- [ ] **Step 1: Verify bot starts cleanly**

Check console output after `npm run dev`. Expected lines (order may vary):

```
[confirmaciones] Realtime activo
[confirmaciones] activo
[scheduler] activo (*/15 * * * *)
[whatsapp] conexión establecida.
```

- [ ] **Step 2: Test web-form path (Realtime)**

Open `http://localhost:5173` in browser. Fill the reservation form with a valid WhatsApp phone number you control. Submit.

Expected within ~2 seconds:
- Success screen appears in browser
- WhatsApp receives message:
  ```
  Listo, [nombre]. Te confirmo tu turno:

  📅 [día] [DD/MM] a las [HH:MM]
  💇 [servicio]
  ⏳ Dura [X horas/minutos]
  💲 Precio: $[precio]

  Cualquier cosa, avisame. ¡Nos vemos el [día]!
  ```
- Bot console shows: `[confirmaciones] confirmación enviada a [tel] (reserva [id])`

- [ ] **Step 3: Verify `confirmacion_enviada = true` in Supabase**

In Supabase Table Editor, find the row just inserted. Verify `confirmacion_enviada = true`.

- [ ] **Step 4: Test WhatsApp-bot path**

Send a message to the bot and complete a full booking via WhatsApp conversation.

Expected:
- The bot's confirmation reply uses the fixed `buildConfirmacion` format (same as Step 2)
- The new row in Supabase has `confirmacion_enviada = true`
- No second WhatsApp message arrives (Realtime listener skipped it)

- [ ] **Step 5: Test invalid phone (edge case)**

Insert a row manually via Supabase SQL Editor with `confirmacion_enviada = false` and an invalid phone (e.g., `telefono = '123'`):

```sql
INSERT INTO public.reservas (nombre, telefono, servicio, fecha, hora, estado, confirmacion_enviada)
VALUES ('Test', '123', 'Corte de cabello', CURRENT_DATE + 2, '10:00', 'pendiente', false);
```

Expected:
- Bot console: `[confirmaciones] fallo...` or similar error log
- Admin WhatsApp receives: `⚠️ Confirmación no enviada: teléfono inválido en reserva [id] ("123")`

- [ ] **Step 6: Run all unit tests one final time**

```bash
cd bot
node --test test-guard.js && node --test test-confirmaciones.js
```

Expected: 18 + 13 = 31 tests passing, 0 failing.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "test: verify confirmacion-whatsapp integration end-to-end"
```
