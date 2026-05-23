# CORS Multi-tenant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar la variable `ALLOWED_ORIGIN` estática por una tabla `barberias` en Supabase, de modo que agregar un cliente nuevo solo requiera editar `barberia.config.js` y correr `npm run register` — sin tocar Supabase Dashboard ni redeployar Edge Functions.

**Architecture:** Se crea la tabla `barberias` (`barberia_id`, `dominio`, `nombre`). Las Edge Functions `get-slots` y `create-reserva` consultan esa tabla para validar el origen CORS, con cache en memoria de 5 min por instancia. Un script `scripts/register.mjs` lee `barberia.config.js` y hace upsert vía REST API.

**Tech Stack:** Supabase Edge Functions (Deno/TypeScript), Node 20+, Supabase REST API, fetch nativo

---

## File Map

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `barberia.config.js` | Modificar | Agregar campo `dominio` |
| `package.json` | Modificar | Agregar script `register` |
| `scripts/register.mjs` | Crear | Upsert de `barberias` vía Supabase REST |
| `supabase/functions/get-slots/index.ts` | Modificar | CORS dinámico desde DB |
| `supabase/functions/create-reserva/index.ts` | Modificar | CORS dinámico desde DB |

---

## Task 1: Agregar `dominio` a `barberia.config.js`

**Files:**
- Modify: `barberia.config.js`

- [ ] **Abrir `barberia.config.js` y agregar el campo `dominio` después de `barberia_id`:**

```js
export default {
  barberia_id: 'evolution-spa',
  dominio:     'lucasloutayf.com',   // <-- nuevo
  nombre: 'Evolution Spa & Peluquería',
  // ...resto sin cambios
}
```

- [ ] **Commit:**

```bash
git add barberia.config.js
git commit -m "config: agregar campo dominio"
```

---

## Task 2: Crear script `scripts/register.mjs` y actualizar `package.json`

**Files:**
- Create: `scripts/register.mjs`
- Modify: `package.json`

- [ ] **Crear el directorio y el script:**

```js
// scripts/register.mjs
const { barberia_id, dominio, nombre } = (await import('../barberia.config.js')).default

if (!dominio) {
  console.error('Error: falta el campo "dominio" en barberia.config.js')
  process.exit(1)
}

const url = `${process.env.VITE_SUPABASE_URL}/rest/v1/barberias`
const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type':  'application/json',
    'apikey':        process.env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Prefer':        'resolution=merge-duplicates',
  },
  body: JSON.stringify({ barberia_id, dominio, nombre }),
})

if (!res.ok) {
  console.error('Error:', await res.text())
  process.exit(1)
}
console.log(`✓ ${nombre} registrada → ${dominio}`)
```

- [ ] **Agregar el script en `package.json`:**

```json
{
  "name": "barberia-evolution",
  "version": "1.0.0",
  "scripts": {
    "dev":      "vite",
    "build":    "vite build",
    "preview":  "vite preview",
    "register": "node --env-file=.env scripts/register.mjs"
  },
  "devDependencies": {
    "vite": "^5.4.0"
  }
}
```

- [ ] **Verificar sintaxis del script:**

```bash
node --check scripts/register.mjs
```

Resultado esperado: ningún output (sin errores de sintaxis).

- [ ] **Commit:**

```bash
git add scripts/register.mjs package.json
git commit -m "feat: script npm run register para alta de barberias"
```

---

## Task 3: Correr la migración SQL en Supabase

**Files:** ninguno (cambio en DB)

Ejecutar en el SQL Editor de Supabase (`supabase.com/dashboard/project/ascxplypgexhnyaawudc/sql`):

- [ ] **Correr la siguiente SQL:**

```sql
CREATE TABLE IF NOT EXISTS public.barberias (
  barberia_id  text PRIMARY KEY,
  dominio      text UNIQUE NOT NULL,
  nombre       text
);

INSERT INTO public.barberias (barberia_id, dominio, nombre)
VALUES ('evolution-spa', 'lucasloutayf.com', 'Evolution Spa & Peluquería')
ON CONFLICT (barberia_id) DO UPDATE
  SET dominio = EXCLUDED.dominio,
      nombre  = EXCLUDED.nombre;
```

- [ ] **Verificar que la tabla y la fila existen:**

```sql
SELECT * FROM public.barberias;
```

Resultado esperado: 1 fila con `barberia_id = 'evolution-spa'`, `dominio = 'lucasloutayf.com'`.

---

## Task 4: Registrar Evolution Spa con el script

**Files:** ninguno

- [ ] **Verificar que `.env` tiene las variables necesarias:**

El archivo `.env` en la raíz del proyecto debe contener:
```
VITE_SUPABASE_URL=https://ascxplypgexhnyaawudc.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key>
```

- [ ] **Correr el script:**

```bash
npm run register
```

Resultado esperado:
```
✓ Evolution Spa & Peluquería registrada → lucasloutayf.com
```

- [ ] **Confirmar en Supabase que la fila fue actualizada** (la row del Task 3 sigue siendo la misma — el upsert no duplica).

---

## Task 5: Actualizar `get-slots` con CORS dinámico

**Files:**
- Modify: `supabase/functions/get-slots/index.ts`

- [ ] **Login al Supabase CLI (requerido una vez por máquina):**

```bash
npx supabase login
```

Abre el browser para autenticar. Completar el flujo. Resultado esperado: `You are now logged in.`

- [ ] **Reemplazar el contenido completo de `supabase/functions/get-slots/index.ts`:**

```ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const STEP = 30

// Must match barberia.config.js servicios[].nombre and duracion
const SERVICE_DURATIONS: Record<string, number> = {
  'Corte de cabello':     30,
  'Tintura & Coloración': 120,
  'Tratamientos Spa':     60,
  'Styling & Peinados':   60,
  'Afeitado & Barba':     30,
  'Cuidado capilar':      45,
}

// DB client at module scope — reused across warm requests
const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// Allowed origins cache (TTL: 5 min per warm instance)
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

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function minutesToHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

function coversSlots(hora: string, duracion: number): string[] {
  const n = Math.ceil(duracion / STEP)
  const start = hhmmToMinutes(hora)
  return Array.from({ length: n }, (_, i) => minutesToHHMM(start + i * STEP))
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

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }
  if (req.method !== 'GET') {
    return new Response(null, { status: 405, headers: cors })
  }
  if (!allowed.has(origin)) {
    return json({ error: 'No autorizado.' }, 403)
  }

  const url = new URL(req.url)
  const fecha = url.searchParams.get('fecha')
  const barberia_id = url.searchParams.get('barberia_id')

  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return json({ error: 'Fecha inválida.' }, 400)
  }
  if (!barberia_id) {
    return json({ error: 'barberia_id requerido.' }, 400)
  }

  const { data, error } = await db
    .from('reservas')
    .select('hora, duracion_min, servicio')
    .eq('fecha', fecha)
    .eq('barberia_id', barberia_id)
    .neq('estado', 'cancelada')

  if (error) {
    return json({ error: 'Error consultando disponibilidad.' }, 500)
  }

  const blocked = new Set<string>()
  for (const r of (data ?? [])) {
    const duracion = r.duracion_min ?? SERVICE_DURATIONS[r.servicio] ?? STEP
    for (const slot of coversSlots(r.hora, duracion)) {
      blocked.add(slot)
    }
  }

  return json({ blocked: [...blocked] }, 200)
})
```

- [ ] **Deployar `get-slots`:**

```bash
npx supabase functions deploy get-slots --project-ref ascxplypgexhnyaawudc
```

Resultado esperado: `Deployed Function get-slots`

- [ ] **Smoke test — verificar que `localhost:5173` sigue siendo aceptado:**

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Origin: http://localhost:5173" \
  "https://ascxplypgexhnyaawudc.supabase.co/functions/v1/get-slots?fecha=2026-06-01&barberia_id=evolution-spa"
```

Resultado esperado: `200`

- [ ] **Smoke test — verificar que `lucasloutayf.com` ahora es aceptado:**

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Origin: https://lucasloutayf.com" \
  "https://ascxplypgexhnyaawudc.supabase.co/functions/v1/get-slots?fecha=2026-06-01&barberia_id=evolution-spa"
```

Resultado esperado: `200`

- [ ] **Commit:**

```bash
git add supabase/functions/get-slots/index.ts
git commit -m "feat: get-slots — CORS dinámico desde tabla barberias"
```

---

## Task 6: Actualizar `create-reserva` con CORS dinámico

**Files:**
- Modify: `supabase/functions/create-reserva/index.ts`

- [ ] **Reemplazar el contenido completo de `supabase/functions/create-reserva/index.ts`:**

```ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const STEP = 30

// Must stay in sync with barberia.config.js servicios[].nombre and duracion
const SERVICE_DURATIONS: Record<string, number> = {
  'Corte de cabello':     30,
  'Tintura & Coloración': 120,
  'Tratamientos Spa':     60,
  'Styling & Peinados':   60,
  'Afeitado & Barba':     30,
  'Cuidado capilar':      45,
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function minutesToHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

function coversSlots(hora: string, duracion: number): string[] {
  const n = Math.ceil(duracion / STEP)
  const start = hhmmToMinutes(hora)
  return Array.from({ length: n }, (_, i) => minutesToHHMM(start + i * STEP))
}

// DB client at module scope — reused across warm requests
const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// Allowed origins cache (TTL: 5 min per warm instance)
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

function getClientIp(req: Request): string | null {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    null
  )
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

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  if (req.method !== 'POST') {
    return new Response(null, { status: 405, headers: cors })
  }

  if (!allowed.has(origin)) {
    return json({ error: 'Solicitud no autorizada.' }, 403)
  }

  const ip = getClientIp(req)

  if (ip) {
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    const { count } = await db
      .from('_ip_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('ip', ip)
      .gt('attempted_at', since)

    if ((count ?? 0) >= 10) {
      return json(
        { error: 'Demasiados intentos. Esperá unos minutos e intentá de nuevo.' },
        429
      )
    }

    await db.from('_ip_attempts').insert({ ip })

    await db
      .from('_ip_attempts')
      .delete()
      .lt('attempted_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
  }

  let body: Record<string, string>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Cuerpo de solicitud inválido.' }, 400)
  }

  const { nombre, telefono, servicio, fecha, hora, mensaje, turnstileToken, barberia_id } = body

  if (
    !nombre?.trim() ||
    !telefono?.trim() ||
    !servicio?.trim() ||
    !fecha?.trim() ||
    !hora?.trim() ||
    !turnstileToken?.trim()
  ) {
    return json({ error: 'Faltan campos requeridos.' }, 400)
  }

  const cfRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      secret: Deno.env.get('TURNSTILE_SECRET_KEY')!,
      response: turnstileToken,
    }),
  })
  const cfData = await cfRes.json()

  if (!cfData.success) {
    return json(
      { error: 'Verificación anti-bot fallida. Volvé a completar el captcha.' },
      400
    )
  }

  const duracion_min = SERVICE_DURATIONS[servicio] ?? STEP

  const { data: existing } = await db
    .from('reservas')
    .select('hora, duracion_min, servicio')
    .eq('fecha', fecha)
    .eq('barberia_id', barberia_id ?? '')
    .neq('estado', 'cancelada')

  const taken = new Set<string>()
  for (const r of (existing ?? [])) {
    const dur = r.duracion_min ?? SERVICE_DURATIONS[r.servicio] ?? STEP
    for (const s of coversSlots(r.hora, dur)) taken.add(s)
  }
  if (coversSlots(hora, duracion_min).some(s => taken.has(s))) {
    return json({ error: 'Ese horario ya está ocupado. Por favor elegí otro.' }, 409)
  }

  const { error: insertError } = await db.from('reservas').insert({
    nombre:      nombre.trim(),
    telefono:    telefono.trim(),
    servicio,
    fecha,
    hora,
    mensaje:     mensaje?.trim() || null,
    duracion_min,
    ip,
    barberia_id: barberia_id ?? null,
  })

  if (insertError) {
    return json(
      { error: 'Error al guardar la reserva. Intentá de nuevo o llamanos.' },
      500
    )
  }

  return json({ ok: true }, 200)
})
```

- [ ] **Deployar `create-reserva`:**

```bash
npx supabase functions deploy create-reserva --project-ref ascxplypgexhnyaawudc
```

Resultado esperado: `Deployed Function create-reserva`

- [ ] **Smoke test — OPTIONS preflight desde `lucasloutayf.com`:**

```bash
curl -s -I -X OPTIONS \
  -H "Origin: https://lucasloutayf.com" \
  -H "Access-Control-Request-Method: POST" \
  "https://ascxplypgexhnyaawudc.supabase.co/functions/v1/create-reserva"
```

Resultado esperado: header `access-control-allow-origin: https://lucasloutayf.com` en la respuesta.

- [ ] **Commit:**

```bash
git add supabase/functions/create-reserva/index.ts
git commit -m "feat: create-reserva — CORS dinámico desde tabla barberias"
```

---

## Task 7: Verificación end-to-end

- [ ] **Abrir `https://lucasloutayf.com` en el navegador.**

- [ ] **Abrir DevTools → Network → filtrar por `supabase`.**

- [ ] **Abrir el modal de reserva, elegir fecha, servicio y hora.**

- [ ] **Verificar que la llamada a `get-slots` devuelve 200** y no hay errores CORS en la consola.

- [ ] **Completar el Turnstile y enviar el formulario.**

- [ ] **Verificar que la llamada a `create-reserva` devuelve 200** y aparece el mensaje de éxito.

- [ ] **Confirmar en Supabase → Table Editor → `reservas`** que la reserva fue insertada.

---

## Proceso de onboarding actualizado (para documentar)

Para cada peluquería nueva, **entre el paso 4 y el paso 5** del proceso existente:

```bash
# 4. Editar barberia.config.js (incluir dominio: 'peluqueria-nueva.com')
# 4.5 Registrar en Supabase:
npm run register
# → ✓ Peluquería Nueva registrada → peluqueria-nueva.com
# 5. Diseñar el frontend...
```

Sin tocar Supabase Dashboard, sin redeployar Edge Functions.
