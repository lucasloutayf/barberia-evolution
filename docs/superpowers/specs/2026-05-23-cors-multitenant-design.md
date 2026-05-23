# CORS Multi-tenant — Diseño

**Fecha:** 2026-05-23
**Estado:** Aprobado

## Problema

Las Edge Functions `get-slots` y `create-reserva` validan el origen CORS contra una variable de entorno `ALLOWED_ORIGIN` (valor único). Agregar una peluquería nueva al sistema requiere actualizar ese secreto manualmente en Supabase y redeployar ambas funciones. Esto no escala.

## Solución

Reemplazar la variable de entorno por una tabla `barberias` en Supabase. Las Edge Functions consultan esa tabla al recibir una request y cachean el resultado 5 minutos en memoria. Agregar un cliente nuevo es un `npm run register` — sin tocar Supabase Dashboard ni redeployar funciones.

---

## 1. Cambio en `barberia.config.js`

Agregar campo `dominio` (sin `https://`, sin `www`):

```js
export default {
  barberia_id: 'evolution-spa',
  dominio:     'lucasloutayf.com',
  nombre:      'Evolution Spa & Peluquería',
  // ...resto sin cambios
}
```

---

## 2. Tabla `barberias` (migration SQL)

```sql
CREATE TABLE IF NOT EXISTS public.barberias (
  barberia_id  text PRIMARY KEY,
  dominio      text UNIQUE NOT NULL,
  nombre       text
);

-- Registro inicial de Evolution Spa
INSERT INTO public.barberias (barberia_id, dominio, nombre)
VALUES ('evolution-spa', 'lucasloutayf.com', 'Evolution Spa & Peluquería')
ON CONFLICT (barberia_id) DO UPDATE
  SET dominio = EXCLUDED.dominio,
      nombre  = EXCLUDED.nombre;
```

No requiere RLS especial — las Edge Functions usan la service-role key que bypasea RLS.

---

## 3. Script `scripts/register.js`

Lee `barberia.config.js` y hace upsert en `barberias` via Supabase REST API. Usa fetch nativo (Node 20+) y `--env-file` para leer el `.env` — sin dependencias nuevas en `package.json`.

Requiere `VITE_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en el `.env` (ya existen para el bot).

```js
const { barberia_id, dominio, nombre } = (await import('../barberia.config.js')).default

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
if (!res.ok) { console.error('Error:', await res.text()); process.exit(1) }
console.log(`✓ ${nombre} registrada → ${dominio}`)
```

Agregar en `package.json`:
```json
"scripts": {
  "register": "node --env-file=.env scripts/register.js"
}
```

---

## 4. Edge Functions — CORS dinámico

Ambas funciones (`get-slots`, `create-reserva`) reemplazan el bloque `ALLOWED_ORIGINS` actual por una función async con cache en memoria (TTL 5 min):

```ts
let cachedOrigins: Set<string> | null = null
let cacheAt = 0

async function getAllowedOrigins(db: ReturnType<typeof createClient>): Promise<Set<string>> {
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
```

La función `corsHeaders` recibe el `Set` y lo consulta igual que antes. El DB client se instancia una vez al inicio del handler (ya está disponible por `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`).

La variable de entorno `ALLOWED_ORIGIN` queda obsoleta y puede eliminarse de Supabase Secrets una vez deployado.

---

## 5. Actualización del proceso de onboarding

Entre el paso 4 (editar `barberia.config.js`) y el paso 5 (diseñar frontend), agregar:

**Paso 4.5 — Registrar en Supabase:**
```bash
npm run register
```

Esto es suficiente para que el nuevo dominio quede activo en CORS dentro de los 5 minutos siguientes (tiempo de expiración del cache de la instancia warm). En instancias cold (primera request tras inactividad) es inmediato.

---

## Archivos afectados

| Archivo | Cambio |
|---|---|
| `barberia.config.js` | +`dominio` |
| `package.json` | +script `register` |
| `scripts/register.js` | nuevo |
| `supabase/functions/get-slots/index.ts` | reemplazar CORS estático por dinámico |
| `supabase/functions/create-reserva/index.ts` | reemplazar CORS estático por dinámico |
| Supabase SQL Editor | correr migration de `barberias` |

## Fuera de scope

- UI de administración de barberias
- Autenticación del script `register` más allá del service-role key en `.env`
- Eliminar `ALLOWED_ORIGIN` de Supabase Secrets (puede hacerse manualmente después del deploy)
