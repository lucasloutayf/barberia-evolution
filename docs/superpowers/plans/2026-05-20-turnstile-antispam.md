# Turnstile Anti-bot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect the web reservation form against bots via Cloudflare Turnstile, with mandatory server-side token validation in a Supabase Edge Function and anon INSERT revoked from `public.reservas`.

**Architecture:** A Supabase Edge Function (`create-reserva`) validates the Turnstile token against Cloudflare Siteverify, rate-limits by IP using a `_ip_attempts` table, and inserts the reservation with the service-role key. The frontend replaces its direct Supabase insert with a `fetch` to the Edge Function. Direct anon inserts are blocked at the RLS level.

**Tech Stack:** Cloudflare Turnstile (widget + Siteverify API), Supabase Edge Functions (Deno), supabase-js v2, vanilla JS + Vite.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `supabase/functions/create-reserva/index.ts` | Create | Edge Function: CORS, rate limit, Turnstile verify, DB insert |
| `index.html` | Modify | Add Turnstile script tag + widget container div |
| `main.js` | Modify | Widget lifecycle (render/remove/reset) + new submit handler |
| `.env` | Modify | Add `VITE_TURNSTILE_SITE_KEY` |
| `.env.example` | Modify | Document `VITE_TURNSTILE_SITE_KEY` |

SQL migrations run manually in Supabase SQL Editor (no migration files — same pattern as the bot's required migration in CLAUDE.md).

---

## Task 1: Cloudflare Turnstile — register site, get keys

**Files:** none (external setup)

- [ ] **Step 1: Log in to Cloudflare Dashboard**

  Go to `https://dash.cloudflare.com` → log in or create a free account.

- [ ] **Step 2: Create a Turnstile site**

  Left sidebar → **Turnstile** → **Add site**.
  - Site name: `barberia-evolution`
  - Domain: add your production domain (e.g. `barberia-evolution.vercel.app`). Also add `localhost` for local testing.
  - Widget mode: **Managed** (Cloudflare decides whether to show a visible challenge).
  - Click **Create**.

- [ ] **Step 3: Copy both keys**

  After creating, Cloudflare shows two values:
  - **Site Key** (public) — starts with `0x4A...` — safe to expose in frontend.
  - **Secret Key** (private) — starts with `0x4A...` — never put in frontend code.

  Keep these open in a browser tab; you'll need them in Tasks 2 and 5.

---

## Task 2: Add environment variables

**Files:** `.env`, `.env.example`

- [ ] **Step 1: Add `VITE_TURNSTILE_SITE_KEY` to `.env`**

  Open [.env](.env) and add after the existing `VITE_*` lines:
  ```
  VITE_TURNSTILE_SITE_KEY=<your-site-key-from-task-1>
  ```

- [ ] **Step 2: Document in `.env.example`**

  Open [.env.example](.env.example). Add after `VITE_SUPABASE_ANON_KEY`:
  ```
  VITE_TURNSTILE_SITE_KEY=your-cloudflare-turnstile-site-key
  ```

- [ ] **Step 3: Verify Vite picks it up**

  Run the dev server (if not already running):
  ```bash
  npm run dev
  ```
  Open `http://localhost:5173` in a browser. In DevTools console:
  ```javascript
  // This should NOT work from devtools since import.meta.env is compile-time,
  // but verifying the site won't crash is enough for now.
  ```
  Expected: page loads normally, no build errors in the terminal.

---

## Task 3: SQL migration — new table, new column, revoke anon INSERT

**Files:** none (run directly in Supabase SQL Editor)

- [ ] **Step 1: Open Supabase SQL Editor**

  Go to `https://supabase.com/dashboard/project/ascxplypgexhnyaawudc/sql/new`.

- [ ] **Step 2: Run the migration**

  Paste and execute:
  ```sql
  -- Rate limiting table
  CREATE TABLE IF NOT EXISTS _ip_attempts (
    id           BIGSERIAL PRIMARY KEY,
    ip           TEXT        NOT NULL,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS _ip_attempts_ip_time_idx ON _ip_attempts (ip, attempted_at);
  ALTER TABLE _ip_attempts ENABLE ROW LEVEL SECURITY;
  -- No policies: service-role bypasses RLS and can write; authenticated cannot.

  -- Audit column on reservas
  ALTER TABLE public.reservas ADD COLUMN IF NOT EXISTS ip TEXT;

  -- Revoke anon INSERT
  DROP POLICY IF EXISTS "anon insert" ON public.reservas;
  DROP POLICY IF EXISTS "Enable insert for anonymous users" ON public.reservas;
  REVOKE INSERT ON public.reservas FROM anon;
  ```

- [ ] **Step 3: Verify `_ip_attempts` exists**

  In SQL Editor run:
  ```sql
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = '_ip_attempts';
  ```
  Expected: one row returned.

- [ ] **Step 4: Verify `ip` column exists on `reservas`**

  ```sql
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name = 'reservas' AND column_name = 'ip';
  ```
  Expected: one row, `data_type = 'text'`.

- [ ] **Step 5: Verify anon INSERT is blocked**

  ```sql
  SELECT grantee, privilege_type FROM information_schema.role_table_grants
  WHERE table_name = 'reservas' AND privilege_type = 'INSERT' AND grantee = 'anon';
  ```
  Expected: zero rows.

---

## Task 4: Supabase CLI setup + write Edge Function

**Files:** `supabase/functions/create-reserva/index.ts`

- [ ] **Step 1: Check if Supabase CLI is installed**

  ```bash
  supabase --version
  ```
  Expected output: `1.x.x` or higher.

  If not installed, follow `https://supabase.com/docs/guides/cli/getting-started` for your OS. On Windows with Scoop: `scoop install supabase`.

- [ ] **Step 2: Log in to Supabase CLI**

  ```bash
  supabase login
  ```
  This opens a browser for OAuth. Complete the flow.

- [ ] **Step 3: Initialize Supabase project structure**

  In the repo root (`c:\AA Programacion\A A Proyectos\barberia-evolution`):
  ```bash
  supabase init
  ```
  Expected: creates `supabase/config.toml` and `supabase/.gitignore`. Accept defaults if prompted.

- [ ] **Step 4: Link to the remote project**

  ```bash
  supabase link --project-ref ascxplypgexhnyaawudc
  ```
  It will prompt for the database password. This is the password you set when creating the Supabase project (or reset it in the dashboard under **Settings → Database → Reset database password**).

- [ ] **Step 5: Create the function directory**

  ```bash
  supabase functions new create-reserva
  ```
  Expected: creates `supabase/functions/create-reserva/index.ts` with a placeholder.

- [ ] **Step 6: Write the Edge Function**

  Replace the entire content of [supabase/functions/create-reserva/index.ts](supabase/functions/create-reserva/index.ts) with:

  ```typescript
  import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

  const ALLOWED_ORIGINS = new Set(
    ['http://localhost:5173', Deno.env.get('ALLOWED_ORIGIN')].filter(Boolean) as string[]
  )

  function corsHeaders(origin: string): Record<string, string> {
    return {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : '',
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
    const cors = corsHeaders(origin)

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

    if (!ALLOWED_ORIGINS.has(origin)) {
      return json({ error: 'Solicitud no autorizada.' }, 403)
    }

    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Defensive IP extraction
    const ip = getClientIp(req)

    // Rate limiting — only when IP is detectable
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

      // Best-effort cleanup of records older than 1 hour
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

    const { nombre, telefono, servicio, fecha, hora, mensaje, turnstileToken } = body

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

    // Verify Turnstile token with Cloudflare
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

    // Insert reservation using service-role key (bypasses RLS)
    const { error: insertError } = await db.from('reservas').insert({
      nombre:   nombre.trim(),
      telefono: telefono.trim(),
      servicio,
      fecha,
      hora,
      mensaje:  mensaje?.trim() || null,
      ip,
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

- [ ] **Step 7: Commit the Edge Function**

  ```bash
  git add supabase/
  git commit -m "feat: add create-reserva edge function with Turnstile validation"
  ```

---

## Task 5: Set Supabase secrets and deploy Edge Function

**Files:** none (CLI commands)

- [ ] **Step 1: Set secrets**

  Replace the placeholders with actual values. `SUPABASE_SERVICE_ROLE_KEY` is in your local `.env`.

  ```bash
  supabase secrets set TURNSTILE_SECRET_KEY=<your-secret-key-from-task-1>
  supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<value-from-env-file>
  supabase secrets set ALLOWED_ORIGIN=https://<your-production-domain>
  ```

  Verify secrets were registered (values are redacted):
  ```bash
  supabase secrets list
  ```
  Expected: `TURNSTILE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `ALLOWED_ORIGIN` appear in the list.

- [ ] **Step 2: Deploy the function**

  ```bash
  supabase functions deploy create-reserva
  ```
  Expected output ends with something like:
  ```
  Deployed Functions create-reserva on project ascxplypgexhnyaawudc
  ```

- [ ] **Step 3: Smoke test — CORS preflight**

  ```bash
  curl -i -X OPTIONS \
    "https://ascxplypgexhnyaawudc.supabase.co/functions/v1/create-reserva" \
    -H "Origin: http://localhost:5173" \
    -H "Access-Control-Request-Method: POST"
  ```
  Expected: `HTTP/2 204` with `access-control-allow-origin: http://localhost:5173`.

- [ ] **Step 4: Smoke test — missing fields**

  ```bash
  curl -i -X POST \
    "https://ascxplypgexhnyaawudc.supabase.co/functions/v1/create-reserva" \
    -H "Content-Type: application/json" \
    -H "Origin: http://localhost:5173" \
    -d '{"nombre":"Test","telefono":"351123456"}'
  ```
  Expected: `HTTP/2 400` with `{"error":"Faltan campos requeridos."}`.

- [ ] **Step 5: Smoke test — bad Turnstile token**

  ```bash
  curl -i -X POST \
    "https://ascxplypgexhnyaawudc.supabase.co/functions/v1/create-reserva" \
    -H "Content-Type: application/json" \
    -H "Origin: http://localhost:5173" \
    -d '{"nombre":"Test","telefono":"351123456","servicio":"Corte de cabello","fecha":"2026-05-22","hora":"10:00","turnstileToken":"bad-token"}'
  ```
  Expected: `HTTP/2 400` with `{"error":"Verificación anti-bot fallida..."}`.

- [ ] **Step 6: Smoke test — successful reservation using Cloudflare test secret**

  Cloudflare provides a test secret key that always returns `success: true`:
  `1x0000000000000000000000000000000AA`

  Temporarily update the secret to the test value:
  ```bash
  supabase secrets set TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
  supabase functions deploy create-reserva
  ```

  Then run:
  ```bash
  curl -i -X POST \
    "https://ascxplypgexhnyaawudc.supabase.co/functions/v1/create-reserva" \
    -H "Content-Type: application/json" \
    -H "Origin: http://localhost:5173" \
    -d '{"nombre":"Test Bot","telefono":"351999999","servicio":"Corte de cabello","fecha":"2026-05-30","hora":"10:00","turnstileToken":"any-value-passes-with-test-secret"}'
  ```
  Expected: `HTTP/2 200` with `{"ok":true}`.

  Verify the row appears in the Supabase dashboard → Table Editor → `reservas`.

  **After confirming it works, restore the real secret:**
  ```bash
  supabase secrets set TURNSTILE_SECRET_KEY=<your-real-secret-key>
  supabase functions deploy create-reserva
  ```
  Then delete the test row from the `reservas` table in the dashboard.

- [ ] **Step 7: Verify anon INSERT is blocked**

  ```bash
  curl -i -X POST \
    "https://ascxplypgexhnyaawudc.supabase.co/rest/v1/reservas" \
    -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFzY3hwbHlwZ2V4aG55YWF3dWRjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxNDc2NjcsImV4cCI6MjA5NDcyMzY2N30.luJGEypRY_ip9HglKgY5Yeuaw8NXdf6_f-PpyQP8ttY" \
    -H "Content-Type: application/json" \
    -d '{"nombre":"Bypass","telefono":"000","servicio":"Corte de cabello","fecha":"2026-05-30","hora":"10:00"}'
  ```
  Expected: `HTTP/2 403` — confirming the RLS block is working.

---

## Task 6: Frontend — add Turnstile widget to index.html

**Files:** `index.html`

- [ ] **Step 1: Add Turnstile script**

  In [index.html](index.html), add the Turnstile script tag immediately before the Supabase CDN script (line 683):

  ```html
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" defer></script>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
  ```

- [ ] **Step 2: Add widget container in the modal**

  In [index.html](index.html), find the `<button type="submit"` inside `#reservaForm` (around line 666). Add the container div immediately before it:

  ```html
          <div id="turnstileContainer"></div>
          <button type="submit" class="btn btn-primary btn-submit" id="reservaSubmit">
  ```

- [ ] **Step 3: Verify HTML structure**

  Open `http://localhost:5173` (dev server must be running). Open the reservation modal. The Turnstile widget should render visually above the "Confirmar reserva" button. It may show as a checkbox ("I'm human") or resolve silently depending on your browser signals.

---

## Task 7: Frontend — widget lifecycle in main.js

**Files:** `main.js`

- [ ] **Step 1: Add state variables at the top of the modal IIFE**

  In [main.js](main.js), after the existing `const` declarations inside the IIFE (after line 22, before the slot generation loop), add:

  ```javascript
  let turnstileToken = null;
  let widgetId = null;
  ```

- [ ] **Step 2: Replace `openModal` with the widget-aware version**

  Replace the existing `openModal` function (lines 64–72):

  ```javascript
  function openModal() {
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    formWrap.hidden = false;
    successDiv.hidden = true;
    errorMsg.classList.remove('show');
    overlay.querySelector('.modal-box').scrollTop = 0;

    turnstileToken = null;
    widgetId = window.turnstile.render('#turnstileContainer', {
      sitekey: import.meta.env.VITE_TURNSTILE_SITE_KEY,
      callback: (token) => {
        turnstileToken = token;
        errorMsg.classList.remove('show');
      },
      'expired-callback': () => {
        turnstileToken = null;
        errorMsg.textContent = 'La verificación expiró, volvé a completarla.';
        errorMsg.classList.add('show');
      },
      'error-callback': () => {
        turnstileToken = null;
        errorMsg.textContent = 'Error en la verificación. Recargá la página e intentá de nuevo.';
        errorMsg.classList.add('show');
      },
    });
  }
  ```

- [ ] **Step 3: Replace `closeModal` with the widget-cleanup version**

  Replace the existing `closeModal` function (lines 74–77):

  ```javascript
  function closeModal() {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    if (widgetId !== null) {
      window.turnstile.remove(widgetId);
      widgetId = null;
      turnstileToken = null;
    }
  }
  ```

- [ ] **Step 4: Verify widget renders and cleans up**

  In the running dev server:
  1. Open the modal → Turnstile widget appears above the button.
  2. Close the modal → widget DOM is removed (inspect `#turnstileContainer` — it should be empty).
  3. Open again → widget re-renders fresh.

---

## Task 8: Frontend — replace submit handler in main.js

**Files:** `main.js`

- [ ] **Step 1: Replace the entire form submit handler**

  In [main.js](main.js), replace the `form.addEventListener('submit', ...)` block (lines 96–145) with:

  ```javascript
  form.addEventListener('submit', async e => {
    e.preventDefault();
    errorMsg.classList.remove('show');

    // Validate required fields
    const fields = form.querySelectorAll('[required]');
    let valid = true;
    fields.forEach(f => {
      f.classList.remove('error');
      if (!f.value.trim() || !f.checkValidity()) {
        f.classList.add('error');
        valid = false;
      }
    });

    if (!valid) {
      errorMsg.textContent = 'Por favor completá todos los campos requeridos.';
      errorMsg.classList.add('show');
      return;
    }

    if (!turnstileToken) {
      errorMsg.textContent = 'Completá la verificación anti-bot antes de confirmar.';
      errorMsg.classList.add('show');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviando…';

    const payload = {
      nombre:         form.nombre.value.trim(),
      telefono:       form.telefono.value.trim(),
      servicio:       form.servicio.value,
      fecha:          form.fecha.value,
      hora:           form.hora.value,
      mensaje:        form.mensaje.value.trim() || null,
      turnstileToken,
    };

    // Reset widget immediately — token is single-use
    window.turnstile.reset(widgetId);
    turnstileToken = null;

    let res, data;
    try {
      res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-reserva`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      data = await res.json();
    } catch {
      errorMsg.textContent = 'Sin conexión. Verificá tu internet e intentá de nuevo.';
      errorMsg.classList.add('show');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Confirmar reserva';
      return;
    }

    submitBtn.disabled = false;
    submitBtn.textContent = 'Confirmar reserva';

    if (!res.ok) {
      errorMsg.textContent = data?.error ?? 'Error al enviar la reserva. Intentá de nuevo o llamanos.';
      errorMsg.classList.add('show');
      return;
    }

    form.reset();
    formWrap.hidden = true;
    successDiv.hidden = false;
  });
  ```

- [ ] **Step 2: Remove the now-unused `db` constant from main.js**

  The Supabase client constant at the top of [main.js](main.js) is no longer used after this change. Delete this block (the first 7 lines of the file):
  ```javascript
  /* =====================
     SUPABASE
     ===================== */
  const db = window.supabase.createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY
  );
  ```

  Confirm: search for `db.` in main.js — no occurrences should remain.

- [ ] **Step 3: Commit frontend changes**

  ```bash
  git add index.html main.js .env.example
  git commit -m "feat: add Cloudflare Turnstile anti-bot protection to reservation form"
  ```

---

## Task 9: End-to-end browser verification

**Files:** none (manual testing)

Run the dev server and open `http://localhost:5173`.

- [ ] **Test 1 — Happy path**

  1. Click "Reservar turno" → modal opens, Turnstile widget appears.
  2. Wait for widget to resolve (may be instant on clean browser).
  3. Fill all required fields with valid data.
  4. Click "Confirmar reserva".
  5. Expected: success screen appears ("¡Turno solicitado!").
  6. Verify in Supabase dashboard → `reservas` table: the row exists with correct data.

- [ ] **Test 2 — Submit without resolving widget**

  1. Open modal.
  2. Fill all fields.
  3. Submit immediately without waiting for widget.
  4. Expected: inline error "Completá la verificación anti-bot antes de confirmar." No network request made.

- [ ] **Test 3 — Widget expiry**

  1. Open modal.
  2. Wait for widget to resolve.
  3. Wait 5+ minutes (or simulate by calling `window.turnstile.reset(widgetId)` from DevTools console — this clears the token internally too).
  4. Attempt submit.
  5. Expected: error from server "Verificación anti-bot fallida. Volvé a completar el captcha." Widget resets and becomes resolvable again.

- [ ] **Test 4 — Direct Supabase insert blocked**

  Open DevTools console on any page and run (supabase-js is already on `window.supabase` from the CDN script):
  ```javascript
  const testDb = window.supabase.createClient(
    'https://ascxplypgexhnyaawudc.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFzY3hwbHlwZ2V4aG55YWF3dWRjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxNDc2NjcsImV4cCI6MjA5NDcyMzY2N30.luJGEypRY_ip9HglKgY5Yeuaw8NXdf6_f-PpyQP8ttY'
  );
  const result = await testDb.from('reservas').insert({
    nombre: 'hack', telefono: '000', servicio: 'Corte de cabello',
    fecha: '2026-06-01', hora: '10:00'
  });
  console.log(result.error);
  ```
  Expected: `result.error.code === '42501'` (insufficient privilege) — the RLS block works.

- [ ] **Test 5 — Modal reopen is clean**

  1. Open modal → widget resolves → close modal.
  2. Inspect `#turnstileContainer` in DevTools Elements tab — should be empty.
  3. Reopen modal → fresh widget renders.
  4. Expected: no stale token, widget works normally.

- [ ] **Test 6 — Admin panel unaffected**

  Open `http://localhost:5173/admin.html`. Log in with admin credentials.
  Expected: reservations load normally, status updates work, no console errors related to Turnstile.

---

## Notes

**Turnstile test keys (Cloudflare-provided):**
| Purpose | Site Key | Secret Key |
|---|---|---|
| Always passes silently | `1x00000000000000000000AA` | `1x0000000000000000000000000000000AA` |
| Always shows challenge | `3x00000000000000000000FF` | — |
| Always fails | `2x00000000000000000000AB` | `2x0000000000000000000000000000000BB` |

Use the "always passes" site key in `VITE_TURNSTILE_SITE_KEY` during development to avoid having to interact with the widget on every test. Switch back to your real site key before going to production.

**`SUPABASE_URL` in Edge Functions:** Supabase injects this automatically. Do not set it via `supabase secrets set`.

**Local Edge Function testing:** `supabase functions serve` requires Docker Desktop running. Alternatively, deploy to Supabase directly and test with curl as shown in Task 5 — for a project this size, deploy-and-test is faster than local Docker setup.
