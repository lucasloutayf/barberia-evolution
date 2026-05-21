# Verificación anti-bot con Cloudflare Turnstile — Especificación

**Fecha:** 2026-05-20
**Estado:** Aprobado

## 1. Objetivo

Proteger el formulario de reservas del sitio web contra envíos automáticos sin costo adicional. La verificación Turnstile es obligatoria server-side: ninguna reserva puede crearse directamente en Supabase desde el frontend con la anon key.

## 2. Arquitectura

```
Frontend (index.html + main.js)
  │
  ├─ Widget Turnstile → token client-side
  │
  └─ POST { campos + token } ──→ Edge Function: create-reserva
                                        │
                                        ├─ 1. CORS / preflight
                                        ├─ 2. Rate limit por IP (tabla _ip_attempts)
                                        ├─ 3. Validar campos requeridos
                                        ├─ 4. Verificar token → Cloudflare Siteverify
                                        └─ 5. INSERT en public.reservas (service-role)

public.reservas (anon INSERT revocado — RLS)
```

## 3. Componentes

### 3.1 Frontend — `index.html`

- Añadir script de Turnstile antes del cierre de `</body>`:
  ```html
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" defer></script>
  ```
- Añadir div contenedor dentro del modal, entre el textarea de comentarios y el botón submit:
  ```html
  <div id="turnstileContainer"></div>
  ```

### 3.2 Frontend — `main.js`

**Inicialización del widget (al abrir el modal):**
- Llamar `turnstile.render('#turnstileContainer', { ... })` dentro de `openModal()`.
- El widget se renderiza en modo `managed` (Cloudflare decide si muestra challenge visual o pasa silenciosamente).
- Guardar el `widgetId` retornado por `render()` para poder resetearlo.

**Callbacks obligatorios:**
- `callback(token)` → guarda `turnstileToken = token`.
- `expired-callback()` → limpia `turnstileToken = null`, muestra aviso inline `"La verificación expiró, volvé a completarla."`.
- `error-callback()` → limpia `turnstileToken = null`, muestra aviso `"Error en la verificación. Recargá la página e intentá de nuevo."`.

**Lógica de submit:**
1. Validar campos requeridos (igual que hoy).
2. Si `turnstileToken` es `null` → mostrar `"Completá la verificación anti-bot antes de confirmar."`, abortar.
3. Hacer `fetch` a la Edge Function con `{ ...campos, turnstileToken }`.
4. Tras cualquier respuesta (éxito o error) → llamar `turnstile.reset(widgetId)` y limpiar `turnstileToken = null` para exigir token fresco en el próximo intento.

**Cierre y reapertura del modal:**
- `closeModal()` llama a `turnstile.remove(widgetId)` solo si `widgetId !== null` (guarda para la primera apertura aún no ocurrida).
- `openModal()` siempre re-renderiza el widget desde cero, evitando tokens rancios. Setea `widgetId` con el valor retornado por `render()`.

### 3.3 Edge Function — `supabase/functions/create-reserva/index.ts`

Runtime: Deno (estándar Supabase Edge Functions).

**Orden de ejecución:**

1. **CORS / preflight:**
   - `OPTIONS` → `204` con headers:
     ```
     Access-Control-Allow-Origin: <origin permitido>
     Access-Control-Allow-Methods: POST, OPTIONS
     Access-Control-Allow-Headers: Content-Type
     Access-Control-Max-Age: 86400
     ```
   - `POST` con origin no permitido → `403`.
   - Origins permitidos: `http://localhost:5173` siempre (hardcoded para dev) y el valor de `ALLOWED_ORIGIN` (variable de entorno, dominio de producción). Si `ALLOWED_ORIGIN` no está seteada, solo se permite `localhost:5173`; la función no falla en arranque.

2. **Extracción defensiva de IP:**
   ```
   ip = CF-Connecting-IP ?? X-Forwarded-For[0] ?? X-Real-IP ?? null
   ```
   Si `ip` es `null`, se omite el paso de rate limiting (no se bloquea, no se inserta en `_ip_attempts`). Esto evita falsos positivos en entornos de desarrollo donde esos headers no existen.

3. **Rate limiting por IP** (solo si `ip` no es `null`):
   - Consulta en `_ip_attempts`: contar filas con `ip = ?` y `attempted_at > now() - interval '15 minutes'`.
   - Si count ≥ 10 → `429 { error: "Demasiados intentos. Esperá unos minutos e intentá de nuevo." }`.
   - Si no supera el límite → `INSERT` en `_ip_attempts (ip, attempted_at)`.
   - Limpieza: en el mismo request, `DELETE FROM _ip_attempts WHERE attempted_at < now() - interval '1 hour'` (best-effort, sin fallar el request si falla la limpieza).

4. **Validación de campos:**
   Campos requeridos: `nombre`, `telefono`, `servicio`, `fecha`, `hora`, `turnstileToken`.
   Si alguno falta o está vacío → `400 { error: "Faltan campos requeridos." }`.

5. **Verificación Turnstile (Siteverify):**
   ```
   POST https://challenges.cloudflare.com/turnstile/v0/siteverify
   Body: secret=TURNSTILE_SECRET_KEY&response=<token>
   ```
   - Si `success: false` → `400 { error: "Verificación anti-bot fallida. Volvé a completar el captcha." }`.
   - El token de Turnstile es de un solo uso; reutilizarlo o enviarlo expirado devuelve `success: false`.

6. **INSERT en Supabase:**
   - Usa `service-role key` → bypasea RLS.
   - Campos insertados: `nombre`, `telefono`, `servicio`, `fecha`, `hora`, `mensaje` (nullable), `ip` (nullable, para auditoría futura).
   - Error de BD → `500 { error: "Error al guardar la reserva. Intentá de nuevo o llamanos." }`.
   - Éxito → `200 { ok: true }`.

### 3.4 Base de datos

**Nueva tabla `_ip_attempts`** (prefijo `_` indica tabla de infraestructura, no de negocio):
```sql
CREATE TABLE IF NOT EXISTS _ip_attempts (
  id        BIGSERIAL PRIMARY KEY,
  ip        TEXT        NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS _ip_attempts_ip_time_idx ON _ip_attempts (ip, attempted_at);
ALTER TABLE _ip_attempts ENABLE ROW LEVEL SECURITY;
-- Sin políticas: authenticated no puede leer/escribir; service-role bypasea RLS y sí puede.
```
- No expone datos personales: la IP se guarda temporalmente y se limpia cada hora.

**Nueva columna en `public.reservas`:**
```sql
ALTER TABLE public.reservas
  ADD COLUMN IF NOT EXISTS ip TEXT;
```
No visible en el admin panel. Solo para auditoría si se detecta abuso.

**Revocación del INSERT anónimo:**
```sql
-- Eliminar política existente de insert anónimo
DROP POLICY IF EXISTS "anon insert" ON public.reservas;
-- Por nombre alternativo que podría existir:
DROP POLICY IF EXISTS "Enable insert for anonymous users" ON public.reservas;
REVOKE INSERT ON public.reservas FROM anon;
```
Después de este cambio, cualquier `db.from('reservas').insert(...)` con la anon key devuelve `403`.

Las políticas existentes de `authenticated` (SELECT, UPDATE, DELETE) no se tocan.

### 3.5 Variables de entorno

| Variable | Dónde vive | Uso |
|---|---|---|
| `VITE_TURNSTILE_SITE_KEY` | `.env` del proyecto (commiteable en `.env.example`) | Frontend — pública por diseño |
| `TURNSTILE_SECRET_KEY` | Supabase Secrets (`supabase secrets set`) | Edge Function — nunca al frontend |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Secrets | Edge Function — ya existe en `.env` local |
| `ALLOWED_ORIGIN` | Supabase Secrets | Edge Function — dominio de producción |
| `SUPABASE_URL` | Inyectada automáticamente por Supabase | Edge Function — no requiere configuración manual |

## 4. Manejo de errores — tabla completa

| Causa | HTTP | Mensaje al usuario |
|---|---|---|
| Widget no resuelto (submit sin token) | — (client) | "Completá la verificación anti-bot antes de confirmar." |
| Token expirado o reutilizado | 400 | "La verificación expiró. Volvé a completar el captcha." |
| Rate limit por IP | 429 | "Demasiados intentos. Esperá unos minutos e intentá de nuevo." |
| Origin no permitido | 403 | "Solicitud no autorizada." |
| Campos faltantes | 400 | "Por favor completá todos los campos requeridos." |
| Error de BD | 500 | "Error al guardar la reserva. Intentá de nuevo o llamanos." |
| Error de red (fetch falla) | — (client) | "Sin conexión. Verificá tu internet e intentá de nuevo." |

## 5. Comportamiento del panel admin

Sin cambios. Las reservas llegan a `public.reservas` igual que hoy. El admin usa sesión `authenticated` con sus políticas existentes (SELECT / UPDATE / DELETE). La columna `ip` es invisible en la UI.

## 6. Setup y deploy

### Pasos previos (una vez)

1. Crear cuenta en Cloudflare → Turnstile → "Add site" → obtener **Site Key** (pública) y **Secret Key** (privada).
2. Agregar `VITE_TURNSTILE_SITE_KEY=<site_key>` al `.env` local y a `.env.example`.
3. Agregar `VITE_TURNSTILE_SITE_KEY` también en la plataforma de hosting (si aplica).

### Supabase Secrets (una vez)

```bash
supabase secrets set TURNSTILE_SECRET_KEY=<secret_key>
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service_role_key>
supabase secrets set ALLOWED_ORIGIN=https://<dominio-produccion>
```

### Migración SQL (una vez, en Supabase SQL Editor o `supabase db push`)

```sql
-- Tabla de rate limiting
CREATE TABLE IF NOT EXISTS _ip_attempts (
  id           BIGSERIAL PRIMARY KEY,
  ip           TEXT        NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS _ip_attempts_ip_time_idx ON _ip_attempts (ip, attempted_at);
ALTER TABLE _ip_attempts ENABLE ROW LEVEL SECURITY;
-- Sin políticas: solo service-role puede operar sobre esta tabla.

-- Columna de auditoría en reservas
ALTER TABLE public.reservas ADD COLUMN IF NOT EXISTS ip TEXT;

-- Revocar insert anónimo
DROP POLICY IF EXISTS "anon insert" ON public.reservas;
DROP POLICY IF EXISTS "Enable insert for anonymous users" ON public.reservas;
REVOKE INSERT ON public.reservas FROM anon;
```

### Deploy Edge Function

```bash
supabase functions deploy create-reserva
```

## 7. Pruebas end-to-end

1. **Flujo feliz:** abrir modal → completar campos → resolver widget → submit → verificar fila en `reservas` en Supabase dashboard.
2. **Sin token:** submit sin resolver widget → mensaje de error client-side, sin llamada a la Edge Function.
3. **Token expirado:** resolver widget → esperar >5 min → intentar submit → `expired-callback` ya debería haber limpiado el token → mismo flujo que "sin token".
4. **Rate limit:** enviar ≥ 10 requests a la Edge Function con la misma IP en 15 minutos → respuesta `429`.
5. **Insert directo bloqueado:** intentar `db.from('reservas').insert({...})` con anon key desde consola del navegador → verificar `403`.
6. **Reapertura de modal:** cerrar y reabrir el modal → el widget se renderiza fresco sin token previo.
