# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start Vite dev server at http://localhost:5173
npm run build    # Production build
npm run preview  # Preview production build
```

Always serve via HTTP — never open files directly as `file://` (breaks CDN scripts and Supabase fetch calls).

## Architecture

Static site with no framework or bundler transformations — Vite is used only as a dev/build server. All logic is vanilla JS.

**Files:**
- `index.html` / `styles.css` / `main.js` — Public landing page
- `admin.html` / `admin.css` / `admin.js` — Private reservations panel (password: `evolution2025`)

**External dependencies (CDN, not npm):**
- Supabase JS client loaded via `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js">` — exposes `window.supabase`. Always reference as `window.supabase.createClient(...)` in scripts that Vite may treat as modules.

**Supabase project:** `qwuifgwihpvgykybbvne` (shared with another app — SP500 Heatmap)
- Table: `public.reservas` — fields: `id`, `nombre`, `telefono`, `servicio`, `fecha` (date), `hora` (text), `mensaje`, `estado` (`pendiente`|`confirmada`|`cancelada`), `created_at`
- RLS: anon can INSERT, SELECT, UPDATE, DELETE

## Key patterns

**Visibility toggling:** Use `style.display = 'none'` / `style.display = ''` everywhere. Do NOT use the HTML `hidden` attribute — Vite module scripts cannot reliably clear it with `element.hidden = false`.

**Admin auth:** Sessionless password check against `ADMIN_PASS` constant, persisted in `sessionStorage`. Dashboard events are bound inside `showDashboard()` (called after login), not at top level.

**Modal (index.html):** Reservation form modal triggered by `.open-modal` class or `#navReservar`. The Supabase client in `main.js` is initialized at top level (safe because `main.js` loads after the CDN script).
