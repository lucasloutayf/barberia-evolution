# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start Vite dev server at http://localhost:5173
npm run build    # Production build (emits both index.html and admin.html)
npm run preview  # Preview production build
```

There are no test or lint scripts configured.

Always serve via HTTP — never open files directly as `file://` (breaks CDN scripts and Supabase fetch calls).

## Architecture

Static site with no framework or bundler transformations — Vite is used only as a dev/build server. All logic is vanilla JS.

**Files:**
- `index.html` / `styles.css` / `main.js` — Public landing page
- `admin.html` / `admin.css` / `admin.js` — Private reservations panel (Supabase Auth login)

`vite.config.js` declares both `index.html` and `admin.html` as `rollupOptions.input` entries. Any new HTML page must be added there or it won't be emitted by `vite build`.

**External dependencies (CDN, not npm):**
- Supabase JS client loaded via `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js">` — exposes `window.supabase`. Always reference as `window.supabase.createClient(...)` in scripts that Vite may treat as modules.

**Environment variables (`.env`, gitignored):**
- `VITE_SUPABASE_URL` — project URL
- `VITE_SUPABASE_ANON_KEY` — anon public key
- See `.env.example` for the format. The build will fail silently (runtime error in browser) if these are missing.

**Supabase project:** `ascxplypgexhnyaawudc` (name: `barberia`, region: `sa-east-1`)
- Table: `public.reservas` — fields: `id`, `nombre`, `telefono`, `servicio`, `fecha` (date), `hora` (text), `mensaje`, `estado` (`pendiente`|`confirmada`|`cancelada`), `created_at`, `duracion_min` (int), `recordatorio_enviado` (bool), `confirmacion_enviada` (bool)
- RLS policies: `anon` can INSERT only; `authenticated` can SELECT / UPDATE / DELETE.

## Key patterns

**Visibility toggling:** Use `style.display = 'none'` / `style.display = ''` everywhere. Do NOT use the HTML `hidden` attribute — Vite module scripts cannot reliably clear it with `element.hidden = false`.

**Admin auth:** Email + password login via Supabase Auth (`signInWithPassword`). Session is managed by the Supabase client (persisted in `localStorage`); on page load `getSession()` decides whether to show the dashboard or the login screen. Dashboard events are bound inside `showDashboard()` (called after login), not at top level.

**Modal (index.html):** Reservation form modal triggered by `.open-modal` class or `#navReservar`. The Supabase client in `main.js` is initialized at top level (safe because `main.js` loads after the CDN script).

**Booking constraints (hard-coded in `main.js`):**
- Time slots are generated client-side in 30-minute increments from 09:00 to 19:30.
- Bookable date range is tomorrow → +45 days; Sundays are blocked via `setCustomValidity`.
- Changing business hours or the booking window requires editing the slot loop and `setupFechaInput()` in `main.js` — there is no config file.

**Admin mutations are optimistic:** `updateEstado` and `deleteReserva` mutate the in-memory `allReservas` array and re-render, instead of refetching from Supabase. New admin actions should follow the same pattern (or call `loadReservas()` to refresh) so the table and stat counters stay in sync.

## Bot de WhatsApp (`bot/`)

Independent Node.js subproject — **not** touched by Vite. Requires Node 20+. Reads/writes the same `public.reservas` table so reservations created by the bot show up in the existing admin panel.

```bash
cd bot
npm install
npm run dev                         # arranca el bot con --watch (escanear QR en consola la primera vez)
node --test test-guard.js           # corre las 18 pruebas unitarias de guard.js
node --test test-confirmaciones.js  # corre las pruebas de buildConfirmacion (format.js)
node test-api.js                    # prueba la conexión al proveedor LLM directamente (sin bot)
```

**Stack:** Baileys (WhatsApp) + OpenAI API (NLU con function calling) + Supabase service-role client + node-cron (recordatorios 24h).

El cliente LLM en [bot/agent.js](bot/agent.js) es OpenAI-compatible — funciona contra cualquier proveedor que exponga `/v1/chat/completions` (OpenAI, Groq, Together, etc.). Para cambiar de proveedor o modelo, ajustar `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`.

**Extra env vars** (en el `.env` raíz, junto a las `VITE_*` del frontend):
- `SUPABASE_SERVICE_ROLE_KEY` — bypasea RLS para SELECT/UPDATE. Nunca exponer al frontend.
- `AI_BASE_URL` — endpoint OpenAI-compatible (default: `https://api.openai.com/v1`).
- `AI_API_KEY` — API key de OpenAI.
- `AI_MODEL` — id del modelo (ej: `gpt-4o-mini`).
- `AI_MODEL_FALLBACK` — modelo alternativo si el primario devuelve 429/503.
- `ADMIN_JID` — JID del WhatsApp del admin (`<numero>@s.whatsapp.net`).

**Migración requerida** (correr una vez en SQL Editor de Supabase):
```sql
ALTER TABLE public.reservas
  ADD COLUMN IF NOT EXISTS duracion_min          integer,
  ADD COLUMN IF NOT EXISTS recordatorio_enviado  boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS confirmacion_enviada  boolean DEFAULT false;
CREATE INDEX IF NOT EXISTS reservas_fecha_estado_idx ON public.reservas (fecha, estado);
```

**Catálogo de servicios** (precios y duraciones) vive en [bot/config.js](bot/config.js). Los nombres DEBEN coincidir exactamente con los `<option>` del `<select>` de [index.html](index.html) para que el panel admin los muestre consistentes.

**Reglas compartidas con el frontend:** horario Lun-Sáb 09:00–19:30, slots cada 30 min, ventana de reserva tomorrow → +45 días, Domingos cerrado. Si cambian acá, también editar `BUSINESS_HOURS` en [bot/config.js](bot/config.js) y los hard-codes en [main.js](main.js).

**A diferencia del formulario web**, el bot SÍ chequea colisiones y bloquea slots consecutivos según `duracion_min` del servicio. Las reservas viejas sin `duracion_min` se tratan como 30 min.

**Módulos del bot:**
- `index.js` — entry point; valida env vars, llama `guard.load()`, y hace lazy-load del resto tras cargar dotenv.
- `whatsapp.js` — integración Baileys 7.x; pasa mensajes por `guard.check()` antes de encolarlos; llama `guard.queueDecrement()` en el `finally`. Mantiene un `inflight` Map para serializar los mensajes por JID (evita race conditions en el estado). Exporta `waitForConnected()` — promesa que resuelve cuando WA está conectado; usada por `confirmaciones.js` antes del startup scan.
- `guard.js` — protección contra spam: rate limiting de doble ventana (3 msgs/10 s burst + 8 msgs/60 s), cap de cola (4 msgs pendientes por JID), sanitización (trunca a 1000 chars), y blocklist persistida en `blocklist.json`. API: `load()`, `check()`, `blockJid()`, `unblockJid()`, `isBlocked()`, `listBlocked()`, `queueDecrement()`, `sanitizeText()`.
- `agent.js` — loop de function calling contra el proveedor OpenAI-compatible; construye el system prompt dinámicamente con el catálogo, datos del cliente y reglas de negocio. Exporta `ProviderBusyError` para manejo de 429/503.
- `tools.js` — implementaciones de las 4 herramientas del LLM: `listar_servicios`, `consultar_disponibilidad`, `crear_reserva`, `ver_mis_reservas`.
- `slots.js` — genera slots disponibles y detecta colisiones considerando `duracion_min`.
- `state.js` — estado de conversación en memoria por JID (`nombre`, `telefono`, `history`). Se persiste en `state.json`; incluye lógica de migración para formatos anteriores (Gemini, JIDs `@lid`). Exporta `normalizePhoneToJid()` para convertir número de teléfono humano a JID de WhatsApp.
- `config.js` — catálogo de servicios, horarios, `BOOKING_WINDOW_DAYS`. Exporta `findServiceByNombre()` (exact match) y `findServiceFuzzy()` (fuzzy match). Los nombres de servicio DEBEN coincidir con los `<option>` del `<select>` en `index.html`.
- `confirmaciones.js` — suscripción Supabase Realtime a INSERT en `reservas`; si `confirmacion_enviada` es false, reclama la fila (UPDATE atómico) y envía el mensaje de confirmación por WhatsApp. Al arrancar hace un startup scan de las últimas 24 h para cubrir eventos perdidos mientras el bot estuvo apagado. Notifica al admin si el teléfono es inválido o el envío falla.
- `format.js` — `buildConfirmacion(reserva)`: genera el texto del mensaje de confirmación de turno (día de semana, DD/MM, hora, servicio, duración, precio). Hace lookup de duración/precio desde el catálogo via `findServiceByNombre()`.
- `scheduler.js` — cron cada 15 min para recordatorios 24 h antes de la reserva.
- `admin.js` — comandos WhatsApp exclusivos del admin (`/turnos`, `/cancelar <id>`, `/bloquear <número>`, `/desbloquear <número>`, `/bloqueados`, `/help`); se procesan antes de llegar al LLM.
- `supabase.js` — cliente Supabase con service-role key; todas las queries del bot pasan por aquí.

**Archivos de runtime (gitignoreados):**
- `state.json` — snapshot de conversaciones por JID
- `blocklist.json` — JIDs bloqueados con timestamp; escrito con debounce de 2 s por `guard.js`
- `auth_info_baileys/` — credenciales de sesión de Baileys

**JID aliasing (Baileys 7.x):** Las cuentas nuevas de WhatsApp usan JIDs `@lid` en lugar de `@s.whatsapp.net`. `whatsapp.js` normaliza estos a JIDs de teléfono cuando están disponibles. `state.js` limpia en el arranque los JIDs `@lid` inválidos heredados de versiones anteriores.
