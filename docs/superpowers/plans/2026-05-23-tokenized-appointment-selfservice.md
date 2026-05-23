# Tokenized Appointment Self-Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow clients to view and cancel their own appointment via a unique tokenized link sent in the WhatsApp confirmation message.

**Architecture:** HMAC-SHA256 token generated at reservation time (Deno `crypto.subtle`), stored in `reservas.token`, returned to browser and passed to bot. Two new Edge Functions (`get-turno`, `cancel-turno`) serve the client-facing page. A new Vite page `turno.html` handles the UI without login.

**Tech Stack:** Deno/TypeScript Edge Functions, vanilla JS (Vite), Supabase Postgres, Baileys WhatsApp bot (Node.js)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `supabase/functions/create-reserva/index.ts` | Modify | Generate HMAC token, insert with `id`+`token`, return both |
| `supabase/functions/get-turno/index.ts` | Create | GET turno by token — public fields only |
| `supabase/functions/cancel-turno/index.ts` | Create | POST cancel by token — validates future date |
| `bot/format.js` | Modify | Append self-service link to confirmation message |
| `bot/config.js` | Modify | Export `APP_URL` from env |
| `.env.example` | Modify | Add `APP_URL=` |
| `turno.html` | Create | Self-service page — load + cancel turno |
| `turno.js` | Create | Fetch `get-turno`, render, call `cancel-turno` |
| `turno.css` | Create | Minimal dark card UI matching site design system |
| `vite.config.js` | Modify | Register `turno.html` as Rollup input |
| `CLAUDE.md` | Modify | Document new SQL migration and `APP_URL` env var |

---

## Task 1: SQL Migration

**Files:**
- Supabase SQL Editor (no local file change — copy-paste SQL)

- [ ] **Step 1: Run migration in Supabase SQL Editor**

```sql
ALTER TABLE public.reservas
  ADD COLUMN IF NOT EXISTS token text UNIQUE;

CREATE UNIQUE INDEX IF NOT EXISTS reservas_token_idx ON public.reservas (token);
```

Run via Supabase MCP `execute_sql` with project `ascxplypgexhnyaawudc` OR paste into Supabase SQL Editor at https://supabase.com/dashboard/project/ascxplypgexhnyaawudc/sql.

- [ ] **Step 2: Verify column exists**

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'reservas' AND column_name = 'token';
```

Expected output: one row with `column_name=token`, `data_type=text`.

---

## Task 2: Update `create-reserva` — generate and store token

**Files:**
- Modify: `supabase/functions/create-reserva/index.ts`

- [ ] **Step 1: Add `generateToken` helper above `Deno.serve`**

Insert after the closing brace of `corsHeaders` function (after line 61):

```typescript
async function generateToken(secret: string, reservaId: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(reservaId))
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}
```

- [ ] **Step 2: Generate `reservaId` + `token` before the insert and pass them in**

Replace the insert block (the `const { error: insertError } = await db.from('reservas').insert({...})` block through the end of the function) with:

```typescript
  const reservaId = crypto.randomUUID()
  const token = await generateToken(Deno.env.get('TURNSTILE_SECRET_KEY')!, reservaId)

  const { error: insertError } = await db.from('reservas').insert({
    id:          reservaId,
    nombre:      nombre.trim(),
    telefono:    telefono.trim(),
    servicio,
    fecha,
    hora,
    mensaje:     mensaje?.trim() || null,
    duracion_min,
    ip,
    barberia_id: barberia_id ?? null,
    token,
  })

  if (insertError) {
    return json(
      { error: 'Error al guardar la reserva. Intentá de nuevo o llamanos.' },
      500
    )
  }

  return json({ ok: true, token, reserva_id: reservaId }, 200)
})
```

- [ ] **Step 3: Verify the function file compiles (no TS errors)**

```bash
cd supabase/functions/create-reserva
deno check index.ts
```

Expected: no errors. If `deno` not installed, skip — Supabase Deploy catches errors.

- [ ] **Step 4: Deploy**

```bash
supabase functions deploy create-reserva --project-ref ascxplypgexhnyaawudc
```

---

## Task 3: New Edge Function `get-turno`

**Files:**
- Create: `supabase/functions/get-turno/index.ts`

- [ ] **Step 1: Create directory**

```bash
mkdir -p supabase/functions/get-turno
```

- [ ] **Step 2: Write `supabase/functions/get-turno/index.ts`**

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

let cachedOrigins: Set<string> | null = null
let cacheAt = 0

async function getAllowedOrigins(): Promise<Set<string>> {
  if (cachedOrigins && Date.now() - cacheAt < 5 * 60 * 1000) return cachedOrigins
  const { data } = await db.from('barberias').select('dominio')
  cachedOrigins = new Set([
    'http://localhost:5173',
    ...(data ?? []).flatMap((r: { dominio: string }) => [
      `https://${r.dominio}`,
      `https://www.${r.dominio}`,
    ]),
  ])
  cacheAt = Date.now()
  return cachedOrigins
}

function corsHeaders(origin: string, allowed: Set<string>): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': allowed.has(origin) ? origin : '',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') ?? ''
  const allowed = await getAllowedOrigins()
  const cors = corsHeaders(origin, allowed)

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'GET') return new Response(null, { status: 405, headers: cors })

  const url = new URL(req.url)
  const token = url.searchParams.get('t')

  if (!token || token.length < 8) {
    return json({ error: 'Token inválido.' }, 400)
  }

  const { data, error } = await db
    .from('reservas')
    .select('id, nombre, fecha, hora, servicio, estado')
    .eq('token', token)
    .single()

  if (error || !data) {
    return json({ error: 'Turno no encontrado.' }, 404)
  }

  return json(data, 200)
})
```

- [ ] **Step 3: Deploy**

```bash
supabase functions deploy get-turno --project-ref ascxplypgexhnyaawudc
```

---

## Task 4: New Edge Function `cancel-turno`

**Files:**
- Create: `supabase/functions/cancel-turno/index.ts`

- [ ] **Step 1: Create directory**

```bash
mkdir -p supabase/functions/cancel-turno
```

- [ ] **Step 2: Write `supabase/functions/cancel-turno/index.ts`**

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TZ = 'America/Argentina/Cordoba'

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

let cachedOrigins: Set<string> | null = null
let cacheAt = 0

async function getAllowedOrigins(): Promise<Set<string>> {
  if (cachedOrigins && Date.now() - cacheAt < 5 * 60 * 1000) return cachedOrigins
  const { data } = await db.from('barberias').select('dominio')
  cachedOrigins = new Set([
    'http://localhost:5173',
    ...(data ?? []).flatMap((r: { dominio: string }) => [
      `https://${r.dominio}`,
      `https://www.${r.dominio}`,
    ]),
  ])
  cacheAt = Date.now()
  return cachedOrigins
}

function corsHeaders(origin: string, allowed: Set<string>): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': allowed.has(origin) ? origin : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

function todayInTZ(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') ?? ''
  const allowed = await getAllowedOrigins()
  const cors = corsHeaders(origin, allowed)

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: cors })

  let body: { token?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Cuerpo inválido.' }, 400)
  }

  const { token } = body
  if (!token || token.length < 8) {
    return json({ error: 'Token inválido.' }, 400)
  }

  const { data, error } = await db
    .from('reservas')
    .select('id, fecha, estado')
    .eq('token', token)
    .single()

  if (error || !data) {
    return json({ error: 'Turno no encontrado.' }, 404)
  }

  if (data.estado === 'cancelada') {
    return json({ error: 'El turno ya está cancelado.' }, 409)
  }

  if (data.fecha < todayInTZ()) {
    return json({ error: 'No podés cancelar un turno ya pasado.' }, 409)
  }

  const { error: updateError } = await db
    .from('reservas')
    .update({ estado: 'cancelada' })
    .eq('id', data.id)

  if (updateError) {
    return json({ error: 'Error al cancelar el turno. Llamanos al 351 311-5571.' }, 500)
  }

  return json({ ok: true }, 200)
})
```

- [ ] **Step 3: Deploy**

```bash
supabase functions deploy cancel-turno --project-ref ascxplypgexhnyaawudc
```

---

## Task 5: Update bot — `APP_URL` env, `config.js`, `format.js`, `.env.example`

**Files:**
- Modify: `bot/config.js` (add `APP_URL` export)
- Modify: `bot/format.js` (append link to confirmation)
- Modify: `.env.example` (add `APP_URL=`)

- [ ] **Step 1: Add `APP_URL` export to `bot/config.js`**

Add after the `ADMIN_JID` line (after line 39):

```js
export const APP_URL = process.env.APP_URL || '';
```

- [ ] **Step 2: Update `bot/format.js` to append self-service link**

Add import at the top:

```js
import { findServiceByNombre, TZ, APP_URL } from './config.js';
```

Then inside `buildConfirmacion`, replace the last two lines:

```js
  lines.push(``, `Cualquier cosa, avisame. ${cierre}`);
  return lines.join('\n');
```

With:

```js
  lines.push(``, `Cualquier cosa, avisame. ${cierre}`);
  if (APP_URL && reserva.token) {
    lines.push(``, `🔗 Gestioná tu turno: ${APP_URL}/turno?t=${reserva.token}`);
  }
  return lines.join('\n');
```

- [ ] **Step 3: Add `APP_URL` to `.env.example`**

Add after the `GOOGLE_MAPS_URL` line:

```
# URL pública del frontend (para links de autogestión en mensajes WhatsApp)
APP_URL=https://tu-dominio.com
```

- [ ] **Step 4: Verify bot test still passes**

```bash
cd bot
node --test test-confirmaciones.js
```

Expected: all tests pass (the link is only appended when `APP_URL` is set, so existing test snapshots won't break if `APP_URL` is unset in the test environment).

---

## Task 6: New frontend page `turno.html` + `turno.js` + `turno.css`

**Files:**
- Create: `turno.html`
- Create: `turno.js`
- Create: `turno.css`

- [ ] **Step 1: Write `turno.css`**

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --ink:        #07060A;
  --ink-3:      #161419;
  --ink-4:      #1F1D23;
  --gold:       #C9A84C;
  --gold-glow:  rgba(201,168,76,.22);
  --text:       #EAE6DC;
  --text-dim:   rgba(234,230,220,.52);
  --border:     rgba(255,255,255,.055);
  --border-gold:rgba(201,168,76,.16);
  --r-md:       12px;
  --r-lg:       20px;
  --shadow-lg:  0 24px 80px rgba(0,0,0,.6);
}

html { scroll-behavior: smooth; }

body {
  font-family: 'Syne', sans-serif;
  background: var(--ink);
  color: var(--text);
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem 1rem;
}

.card {
  background: var(--ink-3);
  border: 1px solid var(--border-gold);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-lg);
  padding: 2.5rem 2rem;
  max-width: 480px;
  width: 100%;
}

.card-logo {
  font-family: 'Cormorant Garant', serif;
  font-size: 1.1rem;
  color: var(--gold);
  letter-spacing: .12em;
  text-transform: uppercase;
  margin-bottom: 2rem;
  display: flex;
  align-items: center;
  gap: .5rem;
}

.card-logo .logo-mark {
  font-size: 1.6rem;
  font-weight: 700;
  color: var(--gold);
}

h1 {
  font-family: 'Cormorant Garant', serif;
  font-size: 2rem;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 1.5rem;
}

.turno-row {
  display: flex;
  align-items: flex-start;
  gap: .75rem;
  padding: .75rem 0;
  border-bottom: 1px solid var(--border);
}
.turno-row:last-child { border-bottom: none; }

.turno-icon {
  font-size: 1.2rem;
  flex-shrink: 0;
  width: 1.5rem;
  text-align: center;
  margin-top: .05rem;
}

.turno-label {
  font-size: .75rem;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: .08em;
  margin-bottom: .15rem;
}

.turno-value {
  font-size: 1rem;
  font-weight: 500;
}

.estado-badge {
  display: inline-block;
  padding: .2em .75em;
  border-radius: 99px;
  font-size: .8rem;
  font-weight: 600;
  letter-spacing: .05em;
  text-transform: uppercase;
}
.estado-pendiente  { background: rgba(201,168,76,.15); color: var(--gold); }
.estado-confirmada { background: rgba(80,200,120,.12); color: #50C878; }
.estado-cancelada  { background: rgba(255,80,80,.12);  color: #ff6060; }

.actions { margin-top: 2rem; }

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: .5rem;
  padding: .85rem 1.75rem;
  border-radius: var(--r-md);
  font-family: 'Syne', sans-serif;
  font-size: .9rem;
  font-weight: 600;
  letter-spacing: .06em;
  cursor: pointer;
  transition: opacity .2s, transform .15s;
  border: none;
  width: 100%;
}
.btn:disabled { opacity: .5; cursor: not-allowed; }
.btn:not(:disabled):hover { opacity: .85; }
.btn:not(:disabled):active { transform: scale(.98); }

.btn-danger {
  background: #7a1c1c;
  color: #ffb3b3;
  border: 1px solid rgba(255,80,80,.25);
}

.btn-ghost {
  background: transparent;
  color: var(--text-dim);
  border: 1px solid var(--border);
  margin-top: .75rem;
}

.msg {
  margin-top: 1.5rem;
  padding: 1rem 1.25rem;
  border-radius: var(--r-md);
  font-size: .9rem;
  line-height: 1.5;
}
.msg-error   { background: rgba(255,80,80,.10); border: 1px solid rgba(255,80,80,.25); color: #ffb3b3; }
.msg-success { background: rgba(80,200,120,.10); border: 1px solid rgba(80,200,120,.2); color: #a8f0c0; }
.msg-info    { background: rgba(201,168,76,.10); border: 1px solid var(--border-gold); color: var(--gold); }

.spinner {
  display: inline-block;
  width: 1.4rem;
  height: 1.4rem;
  border: 2px solid var(--border-gold);
  border-top-color: var(--gold);
  border-radius: 50%;
  animation: spin .7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.loading-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 2rem 0;
  color: var(--text-dim);
}
```

- [ ] **Step 2: Write `turno.html`**

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Mi Turno | Evolution Spa & Peluquería</title>
  <link rel="stylesheet" href="turno.css" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link
    href="https://fonts.googleapis.com/css2?family=Cormorant+Garant:wght@400;600;700&family=Syne:wght@400;500;600;700&display=swap"
    rel="stylesheet" />
</head>
<body>
  <div class="card">
    <div class="card-logo">
      <span class="logo-mark">E</span>
      <span>volution Spa & Peluquería</span>
    </div>

    <!-- Loading -->
    <div id="loadingState">
      <div class="loading-wrap">
        <div class="spinner"></div>
        <span>Cargando tu turno…</span>
      </div>
    </div>

    <!-- Turno info -->
    <div id="turnoInfo" style="display:none">
      <h1>Tu turno</h1>
      <div id="turnoDetails"></div>
      <div class="actions" id="turnoActions" style="display:none">
        <button class="btn btn-danger" id="cancelBtn">Cancelar turno</button>
        <button class="btn btn-ghost" id="confirmCancelBtn" style="display:none">
          Sí, cancelar definitivamente
        </button>
      </div>
      <div id="turnoMsg" style="display:none"></div>
    </div>

    <!-- Error -->
    <div id="errorState" style="display:none">
      <div id="errorMsg" class="msg msg-error"></div>
    </div>
  </div>

  <script src="turno.js" type="module"></script>
</body>
</html>
```

- [ ] **Step 3: Write `turno.js`**

```js
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

function formatFecha(fechaISO) {
  const [y, mo, d] = fechaISO.split('-').map(Number)
  const dia = DIAS[new Date(Date.UTC(y, mo - 1, d, 12)).getUTCDay()]
  return `${dia} ${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${y}`
}

function estadoClass(estado) {
  if (estado === 'confirmada') return 'estado-confirmada'
  if (estado === 'cancelada')  return 'estado-cancelada'
  return 'estado-pendiente'
}

function estadoLabel(estado) {
  if (estado === 'confirmada') return 'Confirmado'
  if (estado === 'cancelada')  return 'Cancelado'
  return 'Pendiente'
}

function show(id)  { document.getElementById(id).style.display = '' }
function hide(id)  { document.getElementById(id).style.display = 'none' }

function showMsg(id, html, cls) {
  const el = document.getElementById(id)
  el.className = `msg ${cls}`
  el.innerHTML = html
  el.style.display = ''
}

async function main() {
  const token = new URLSearchParams(window.location.search).get('t')

  if (!token) {
    hide('loadingState')
    show('errorState')
    document.getElementById('errorMsg').textContent = 'Link inválido. Solicitá uno nuevo contactando al salón.'
    return
  }

  let reserva
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/get-turno?t=${encodeURIComponent(token)}`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Error al cargar el turno.')
    reserva = data
  } catch (err) {
    hide('loadingState')
    show('errorState')
    document.getElementById('errorMsg').textContent = err.message
    return
  }

  hide('loadingState')
  show('turnoInfo')

  const details = document.getElementById('turnoDetails')
  details.innerHTML = `
    <div class="turno-row">
      <span class="turno-icon">👤</span>
      <div><div class="turno-label">Nombre</div><div class="turno-value">${reserva.nombre}</div></div>
    </div>
    <div class="turno-row">
      <span class="turno-icon">📅</span>
      <div><div class="turno-label">Fecha y hora</div><div class="turno-value">${formatFecha(reserva.fecha)} a las ${reserva.hora}</div></div>
    </div>
    <div class="turno-row">
      <span class="turno-icon">💇</span>
      <div><div class="turno-label">Servicio</div><div class="turno-value">${reserva.servicio}</div></div>
    </div>
    <div class="turno-row">
      <span class="turno-icon">◎</span>
      <div><div class="turno-label">Estado</div><div class="turno-value"><span class="estado-badge ${estadoClass(reserva.estado)}">${estadoLabel(reserva.estado)}</span></div></div>
    </div>
  `

  const isCancelable = reserva.estado === 'pendiente' || reserva.estado === 'confirmada'
  if (isCancelable) {
    show('turnoActions')
    setupCancelFlow(token)
  } else if (reserva.estado === 'cancelada') {
    showMsg('turnoMsg', 'Este turno ya fue cancelado.', 'msg-info')
  }
}

function setupCancelFlow(token) {
  const cancelBtn = document.getElementById('cancelBtn')
  const confirmBtn = document.getElementById('confirmCancelBtn')
  const msgEl = document.getElementById('turnoMsg')

  cancelBtn.addEventListener('click', () => {
    cancelBtn.style.display = 'none'
    confirmBtn.style.display = ''
    showMsg('turnoMsg', '¿Confirmás que querés cancelar? Esta acción no se puede deshacer.', 'msg-error')
  })

  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true
    confirmBtn.textContent = 'Cancelando…'
    hide('turnoMsg')

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/cancel-turno`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al cancelar.')

      hide('turnoActions')
      showMsg('turnoMsg', 'Tu turno fue cancelado correctamente. Si necesitás un nuevo turno, contactanos.', 'msg-success')
      // Update badge in the DOM
      const badge = document.querySelector('.estado-badge')
      if (badge) {
        badge.className = 'estado-badge estado-cancelada'
        badge.textContent = 'Cancelado'
      }
    } catch (err) {
      confirmBtn.disabled = false
      confirmBtn.textContent = 'Sí, cancelar definitivamente'
      showMsg('turnoMsg', err.message, 'msg-error')
    }
  })
}

main()
```

---

## Task 7: Update `vite.config.js` and `CLAUDE.md`

**Files:**
- Modify: `vite.config.js`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Register `turno.html` in `vite.config.js`**

Replace the `input` block:

```js
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main:  'index.html',
        admin: 'admin.html',
        turno: 'turno.html',
      },
    },
  },
})
```

- [ ] **Step 2: Update `CLAUDE.md` — add SQL migration note**

In the **Required migration** SQL block, add after the existing `resena_enviada` line:

```sql
-- Token de autogestión de turnos (link tokenizado)
ALTER TABLE public.reservas
  ADD COLUMN IF NOT EXISTS token text UNIQUE;

CREATE UNIQUE INDEX IF NOT EXISTS reservas_token_idx ON public.reservas (token);
```

- [ ] **Step 3: Update `CLAUDE.md` — document `APP_URL` env var**

In the **Extra env vars** section of the Bot, add:

```
- `APP_URL` — URL pública del frontend (ej: `https://tu-dominio.com`). Usado en confirmaciones de WhatsApp para incluir link de autogestión de turno. Sin este valor, el link no se agrega al mensaje.
```

Also add new Edge Functions to the **Commands** section:

```bash
supabase functions deploy get-turno --project-ref ascxplypgexhnyaawudc
supabase functions deploy cancel-turno --project-ref ascxplypgexhnyaawudc
```

- [ ] **Step 4: Build to verify no Vite errors**

```bash
npm run build
```

Expected: emits `index.html`, `admin.html`, `turno.html` in `dist/`. No errors.

---

## Self-Review: Spec Coverage

| Requirement | Task |
|-------------|------|
| HMAC token in `create-reserva` | Task 2 |
| Token stored in `reservas.token` | Task 1 + Task 2 |
| `{ ok: true, token, reserva_id }` response | Task 2 |
| SQL migration | Task 1 |
| Link in WhatsApp confirmation | Task 5 |
| `APP_URL` env var + `.env.example` | Task 5 |
| `turno.html` reads `?t=token` | Task 6 |
| `turno.html` calls `get-turno` | Task 6 |
| Shows data, cancel button if cancelable | Task 6 |
| Shows message if cancelled/past | Task 6 |
| `turno.html` in `vite.config.js` | Task 7 |
| `get-turno` Edge Function | Task 3 |
| `cancel-turno` Edge Function | Task 4 |
| No login required | Tasks 3,4,6 (token-only auth) |
| No token expiry | Tasks 3,4 (no expiry check) |
| `style.display` not `hidden` attribute | Task 6 |
| Deploy both new EFs | Tasks 3,4 |
| CLAUDE.md updated | Task 7 |
