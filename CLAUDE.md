# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start Vite dev server at http://localhost:5173
npm run build    # Production build (emits both index.html and admin.html)
npm run preview  # Preview production build
```

There are no test or lint scripts configured for the frontend.

Deploy Edge Functions (Supabase CLI required):
```bash
supabase functions deploy get-slots --project-ref ascxplypgexhnyaawudc
supabase functions deploy create-reserva --project-ref ascxplypgexhnyaawudc
supabase functions deploy get-turno --project-ref ascxplypgexhnyaawudc
supabase functions deploy cancel-turno --project-ref ascxplypgexhnyaawudc
```

Register a barberia in the `barberias` table (multi-tenant CORS):
```bash
npm run register
```

Always serve via HTTP — never open files directly as `file://` (breaks CDN scripts and Supabase fetch calls).

## Architecture

Static site with no framework or bundler transformations — Vite is used only as a dev/build server. All logic is vanilla JS.

**Files:**
- `index.html` / `styles.css` / `main.js` — Public landing page
- `admin.html` / `admin.css` / `admin.js` — Private reservations panel (Supabase Auth login)
- `turno.html` / `turno.css` / `turno.js` — Public self-service page; clients access it via tokenized link (`?t=TOKEN`) to view or cancel their appointment. Calls `get-turno` and `cancel-turno` Edge Functions directly (no Supabase client, no auth).
- `barberia.config.js` — **Single source of truth** for all business config (name, address, phone, services catalog, schedule, booking window). Also contains `barberia_id` and `dominio` used for multi-tenant registration. Both `main.js` and `bot/config.js` import from this file. Edge Functions duplicate `SERVICE_DURATIONS` inline and must be kept in sync manually.

`vite.config.js` declares `index.html`, `admin.html`, and `turno.html` as `rollupOptions.input` entries. Any new HTML page must be added there or it won't be emitted by `vite build`.

**External dependencies (CDN, not npm):**
- Supabase JS client via `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js">` — exposes `window.supabase`. Always reference as `window.supabase.createClient(...)` in scripts that Vite may treat as modules.
- Cloudflare Turnstile via CDN — exposes `window.turnstile`. Used in the reservation modal for bot protection.

**Environment variables (`.env`, gitignored):**
- `VITE_SUPABASE_URL` — project URL (also used to call Edge Functions at `$URL/functions/v1/`)
- `VITE_SUPABASE_ANON_KEY` — anon public key (admin panel auth only; form submissions go through Edge Functions)
- `VITE_TURNSTILE_SITE_KEY` — Cloudflare Turnstile site key for the reservation form widget
- See `.env.example` for the format. The build will fail silently (runtime error in browser) if these are missing.

**Supabase project:** `ascxplypgexhnyaawudc` (name: `barberia`, region: `sa-east-1`)
- Table: `public.reservas` — fields: `id`, `nombre`, `telefono`, `servicio`, `fecha` (date), `hora` (text), `mensaje`, `estado` (`pendiente`|`confirmada`|`cancelada`), `created_at`, `duracion_min` (int), `recordatorio_enviado` (bool), `confirmacion_enviada` (bool), `resena_enviada` (bool), `ip` (text), `token` (text, UNIQUE)
- Table: `public._ip_attempts` — fields: `ip` (text), `attempted_at` (timestamptz, default now()). Used by `create-reserva` for rate limiting (10 requests per IP per 15 min).
- Table: `public.barberias` — fields: `barberia_id` (text, PK), `dominio` (text), `nombre` (text). Read by both Edge Functions to build the dynamic CORS allowlist (TTL-cached 5 min per warm instance). Populated via `npm run register`.
- RLS policies: `anon` can INSERT only on `reservas`; `authenticated` can SELECT / UPDATE / DELETE.

## Key patterns

**Config injection (`barberia.config.js`):** `main.js` calls `initConfig()` at startup to populate any element with `data-cfg="nombre"` with the business name, and similarly hydrates address, phone links, WhatsApp links, and the service `<select>` from the config. To change business info, edit only `barberia.config.js`.

**Visibility toggling:** Use `style.display = 'none'` / `style.display = ''` everywhere. Do NOT use the HTML `hidden` attribute — Vite module scripts cannot reliably clear it with `element.hidden = false`.

**Admin auth:** Email + password login via Supabase Auth (`signInWithPassword`). Session is managed by the Supabase client (persisted in `localStorage`); on page load `getSession()` decides whether to show the dashboard or the login screen. Dashboard events are bound inside `showDashboard()` (called after login), not at top level.

**Reservation form flow:** Modal collects data → Turnstile widget must be completed first → form submits to `create-reserva` Edge Function via `fetch`. `main.js` does NOT write to Supabase directly. Slot availability is fetched from `get-slots` Edge Function each time the user picks a date.

**Booking constraints (driven by `barberia.config.js`):**
- Time slots generated from `cfg.horario.dias[dayOfWeek]` franjas (apertura/cierre pairs) in `cfg.horario.intervalo`-minute increments.
- Bookable date range is today → +`cfg.ventanaReservaDias` days; days with empty franjas are blocked via `setCustomValidity`.
- Blocked slots are fetched from the `get-slots` Edge Function (collision-aware, respects `duracion_min`).
- To change hours or window: edit `barberia.config.js` only (frontend and bot pick it up automatically; update Edge Functions' `SERVICE_DURATIONS` manually if service durations change).

**Admin mutations are optimistic:** `updateEstado` and `deleteReserva` mutate the in-memory `allReservas` array and re-render, instead of refetching from Supabase. New admin actions should follow the same pattern (or call `loadReservas()` to refresh) so the table and stat counters stay in sync.

## Supabase Edge Functions (`supabase/functions/`)

Deployed as Deno/TypeScript. All four require these Supabase-injected env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. All enforce CORS dynamically: allowed origins are `http://localhost:5173` plus every `dominio` in the `public.barberias` table (fetched at runtime, cached 5 min). No `ALLOWED_ORIGIN` env var is needed.

**`get-slots`** — `GET ?fecha=YYYY-MM-DD`. Returns `{ blocked: string[] }` — all 30-min slot strings that are taken on that date (considering multi-slot services via `duracion_min`). Uses `anon` read on `reservas` filtered by date and non-cancelled status.

**`create-reserva`** — `POST`. Validates Turnstile token with Cloudflare Siteverify (requires `TURNSTILE_SECRET_KEY` env var), rate-limits by IP via `_ip_attempts` table (10/15 min), checks slot collisions, then INSERTs into `reservas` using service-role key (bypasses RLS).

**`get-turno`** — `GET ?t=TOKEN`. Returns `{ id, nombre, fecha, hora, servicio, estado }` for the matching `token` column. Used by `turno.html` to display appointment details to the client.

**`cancel-turno`** — `POST { token }`. Validates token, rejects past-date and already-cancelled appointments, then sets `estado = 'cancelada'`. Called by `turno.html` when the client self-cancels.

**Critical sync requirement:** Both Edge Functions contain a hardcoded `SERVICE_DURATIONS` map that must stay in sync with `barberia.config.js servicios[].{nombre, duracion}`. There is no shared module between Deno functions and the Node/browser code — update all three locations when adding or renaming services.

**Required migration** (run once in Supabase SQL Editor):
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

-- Token de autogestión de turnos (link tokenizado)
ALTER TABLE public.reservas
  ADD COLUMN IF NOT EXISTS token text UNIQUE;

CREATE UNIQUE INDEX IF NOT EXISTS reservas_token_idx ON public.reservas (token);
```

## Bot de WhatsApp (`bot/`)

Independent Node.js subproject — **not** touched by Vite. Requires Node 20+. Reads/writes the same `public.reservas` table so reservations created by the bot show up in the existing admin panel.

```bash
cd bot
npm install
npm run dev                         # arranca el bot con --watch (escanear QR en consola la primera vez)
npm start                           # producción: sin --watch
node --test test-guard.js           # corre las 18 pruebas unitarias de guard.js
node --test test-confirmaciones.js  # corre las pruebas de buildConfirmacion (format.js)
node --test test-config.js          # verifica que bot/config.js esté sincronizado con barberia.config.js
node --test test-resenas.js         # corre las pruebas de buildMensajeResena (resenas.js)
node test-api.js                    # prueba la conexión al proveedor LLM directamente (sin bot)
```

**Stack:** Baileys (WhatsApp) + OpenAI API (NLU con function calling) + Supabase service-role client + node-cron (recordatorios 24h).

El cliente LLM en [bot/agent.js](bot/agent.js) es OpenAI-compatible — funciona contra cualquier proveedor que exponga `/v1/chat/completions` (OpenAI, Groq, Together, etc.). Para cambiar de proveedor o modelo, ajustar `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`.

**Extra env vars** (en el `.env` raíz, junto a las `VITE_*` del frontend):
- `SUPABASE_SERVICE_ROLE_KEY` — bypasea RLS para SELECT/UPDATE. Nunca exponer al frontend.
- `AI_BASE_URL` — endpoint OpenAI-compatible (default: `https://api.openai.com/v1`).
- `AI_API_KEY` — API key de OpenAI.
- `AI_MODEL` — id del modelo (default: `qwen-3-235b-a22b-instruct-2507` para Cerebras; ajustar según proveedor).
- `AI_MODEL_FALLBACK` — modelo alternativo si el primario devuelve 429/503.
- `ADMIN_JID` — JID del WhatsApp del admin (`<numero>@s.whatsapp.net`).
- `GOOGLE_MAPS_URL` — URL del perfil de Google Maps del salón para solicitudes de reseña post-turno.
- `APP_URL` — URL pública del frontend (ej: `https://tu-dominio.com`). Usado en confirmaciones de WhatsApp para incluir link de autogestión de turno. Sin este valor, el link no se agrega al mensaje.

**Catálogo de servicios** (precios y duraciones) vive en [barberia.config.js](barberia.config.js) en la raíz. `bot/config.js` importa desde allí y re-exporta los valores que necesita el bot. Los nombres DEBEN coincidir exactamente con los `<option>` del `<select>` de [index.html](index.html) (que también se genera desde `barberia.config.js`) y con el `SERVICE_DURATIONS` hardcodeado en las Edge Functions.

**Reglas compartidas con el frontend:** horario Lun-Sáb 09:00–19:30, slots cada 30 min, ventana de reserva today → +45 días, Domingos cerrado. Si cambian, editar solo `barberia.config.js` para el frontend y el bot. Las Edge Functions requieren actualización manual de `SERVICE_DURATIONS`.

**A diferencia del formulario web**, el bot SÍ chequea colisiones y bloquea slots consecutivos según `duracion_min` del servicio. Las reservas viejas sin `duracion_min` se tratan como 30 min.

**Módulos del bot:**
- `index.js` — entry point; valida env vars, llama `guard.load()`, y hace lazy-load del resto tras cargar dotenv.
- `whatsapp.js` — integración Baileys 7.x; pasa mensajes por `guard.check()` antes de encolarlos; llama `guard.queueDecrement()` en el `finally`. Mantiene un `inflight` Map para serializar los mensajes por JID (evita race conditions en el estado). Exporta `waitForConnected()` — promesa que resuelve cuando WA está conectado; usada por `confirmaciones.js` antes del startup scan.
- `guard.js` — protección contra spam: rate limiting de doble ventana (3 msgs/10 s burst + 8 msgs/60 s), cap de cola (4 msgs pendientes por JID), sanitización (trunca a 1000 chars), y blocklist persistida en `blocklist.json`. API: `load()`, `check()`, `blockJid()`, `unblockJid()`, `isBlocked()`, `listBlocked()`, `queueDecrement()`, `sanitizeText()`.
- `agent.js` — loop de function calling contra el proveedor OpenAI-compatible; construye el system prompt dinámicamente con el catálogo, datos del cliente y reglas de negocio. Exporta `ProviderBusyError` para manejo de 429/503.
- `tools.js` — implementaciones de las 4 herramientas del LLM: `listar_servicios`, `consultar_disponibilidad`, `crear_reserva`, `ver_mis_reservas`.
- `slots.js` — genera slots disponibles y detecta colisiones considerando `duracion_min`.
- `state.js` — estado de conversación en memoria por JID (`nombre`, `telefono`, `history`). Se persiste en `state.json`; incluye lógica de migración para formatos anteriores (Gemini, JIDs `@lid`). Exporta `normalizePhoneToJid()` para convertir número de teléfono humano a JID de WhatsApp.
- `config.js` — re-exporta desde `barberia.config.js` con adaptaciones para el bot (`SERVICES`, `SCHEDULE`, `TZ`, `BOOKING_WINDOW_DAYS`). Exporta `findServiceByNombre()` (exact match) y `findServiceFuzzy()` (fuzzy match).
- `confirmaciones.js` — suscripción Supabase Realtime a INSERT en `reservas`; si `confirmacion_enviada` es false, reclama la fila (UPDATE atómico) y envía el mensaje de confirmación por WhatsApp. Al arrancar hace un startup scan de las últimas 24 h para cubrir eventos perdidos mientras el bot estuvo apagado. Notifica al admin si el teléfono es inválido o el envío falla.
- `format.js` — `buildConfirmacion(reserva)`: genera el texto del mensaje de confirmación de turno (día de semana, DD/MM, hora, servicio, duración, precio). Hace lookup de duración/precio desde el catálogo via `findServiceByNombre()`.
- `scheduler.js` — cron cada 15 min para recordatorios 24 h antes de la reserva.
- `resenas.js` — cron cada 15 min para solicitudes de reseña Google Maps; envía mensaje 30-90 min después del turno. Requiere `GOOGLE_MAPS_URL` en env.
- `time-utils.js` — utilidades de fecha/hora compartidas entre `scheduler.js` y `resenas.js`: `fechaHoraAUtc`, `fechaISOEnTZ`, `jidFromTelefono`.
- `supabase.js` — cliente Supabase con service-role key; todas las queries del bot pasan por aquí.

**Advertencia operativa:** Baileys es no oficial. Usar siempre un número de WhatsApp dedicado del salón — nunca el personal del dueño. No enviar mensajes masivos (riesgo de ban del número).

**Archivos de runtime (gitignoreados):**
- `state.json` — snapshot de conversaciones por JID
- `blocklist.json` — JIDs bloqueados con timestamp; escrito con debounce de 2 s por `guard.js`
- `auth_info_baileys/` — credenciales de sesión de Baileys

**JID aliasing (Baileys 7.x):** Las cuentas nuevas de WhatsApp usan JIDs `@lid` en lugar de `@s.whatsapp.net`. `whatsapp.js` normaliza estos a JIDs de teléfono cuando están disponibles. `state.js` limpia en el arranque los JIDs `@lid` inválidos heredados de versiones anteriores.
