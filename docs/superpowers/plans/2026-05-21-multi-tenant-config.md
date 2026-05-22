# Multi-Tenant Barbershop Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extraer todos los valores específicos de cada barbería a un `barberia.config.js` por deploy, aislar datos por `barberia_id` en Supabase, y permitir que el mismo codebase sirva a múltiples barberías sin tocar el código entre deployments.

**Architecture:** Un repo, un proyecto Supabase, N deploys (frontend + bot). Cada deploy tiene su propio `barberia.config.js` con identidad, servicios, horarios y datos de contacto. La tabla `reservas` gana una columna `barberia_id`; RLS asegura que admins autenticados solo vean sus propias filas. El bot lee todo desde `barberia.config.js`. El frontend inyecta valores del config en el DOM al cargar.

**Tech Stack:** Vanilla JS + Vite (frontend), Node.js + Baileys + OpenAI SDK (bot), Supabase (DB + Auth), Node `--test` (tests)

---

## File Map

| Acción | Archivo | Cambio |
|--------|---------|--------|
| CREATE | `barberia.config.js` | Fuente única de verdad por deploy |
| MODIFY | `bot/config.js` | Proxy desde `../barberia.config.js` |
| MODIFY | `bot/agent.js` | Nombre del bot + info del negocio desde config |
| MODIFY | `bot/supabase.js` | `barberia_id` en todos los INSERT/SELECT |
| MODIFY | `main.js` | Importar config, inyectar en DOM y reemplazar hard-codes |
| MODIFY | `index.html` | Agregar IDs a elementos dinámicos, vaciar `<select>` de servicios |
| MODIFY | `admin.js` | Filtrar queries por `barberia_id` del user metadata |
| CREATE | `bot/test-config.js` | Validar shape del config |

---

### Task 1: Crear `barberia.config.js`

**Files:**
- Create: `barberia.config.js`

- [ ] **Step 1: Crear el archivo de config**

```js
// barberia.config.js
export default {
  barberia_id: 'evolution-spa',
  nombre: 'Evolution Spa & Peluquería',
  direccion: 'Mariano Fragueiro 11, X5000 Córdoba',
  telefono: '3513115571',
  ubicacion: 'Córdoba capital',

  bot: {
    nombre: 'Sofi',
  },

  horario: {
    apertura:     '09:00',
    cierre:       '19:30',
    intervalo:    30,
    diasCerrado:  [0],
    timezone:     'America/Argentina/Buenos_Aires',
  },

  ventanaReservaDias: 45,

  servicios: [
    { nombre: 'Corte de cabello',     duracion: 30,  precio: 5000  },
    { nombre: 'Tintura & Coloración', duracion: 120, precio: 18000 },
    { nombre: 'Tratamientos Spa',     duracion: 60,  precio: 12000 },
    { nombre: 'Styling & Peinados',   duracion: 60,  precio: 9000  },
    { nombre: 'Afeitado & Barba',     duracion: 30,  precio: 4000  },
    { nombre: 'Cuidado capilar',      duracion: 45,  precio: 8000  },
  ],
}
```

- [ ] **Step 2: Commit**

```bash
git add barberia.config.js
git commit -m "feat: add barberia.config.js as single source of truth per deploy"
```

---

### Task 2: Migración Supabase — agregar `barberia_id` + actualizar RLS

**Files:**
- No hay archivos de código — SQL se corre directamente en el SQL Editor de Supabase

- [ ] **Step 1: Correr migración en el SQL Editor de Supabase**

```sql
-- Agregar columna
ALTER TABLE public.reservas
  ADD COLUMN IF NOT EXISTS barberia_id text;

CREATE INDEX IF NOT EXISTS reservas_barberia_id_idx
  ON public.reservas (barberia_id);

-- Backfill de filas existentes
UPDATE public.reservas
  SET barberia_id = 'evolution-spa'
  WHERE barberia_id IS NULL;

-- Eliminar políticas authenticated existentes (ajustar nombres si difieren)
DROP POLICY IF EXISTS "authenticated_all"        ON public.reservas;
DROP POLICY IF EXISTS "Enable read access for authenticated"   ON public.reservas;
DROP POLICY IF EXISTS "Enable update for authenticated" ON public.reservas;
DROP POLICY IF EXISTS "Enable delete for authenticated" ON public.reservas;

-- Nuevas: authenticated solo ve su propia barbería
CREATE POLICY "authenticated_select_own" ON public.reservas
  FOR SELECT TO authenticated
  USING (barberia_id = (auth.jwt() -> 'user_metadata' ->> 'barberia_id'));

CREATE POLICY "authenticated_update_own" ON public.reservas
  FOR UPDATE TO authenticated
  USING (barberia_id = (auth.jwt() -> 'user_metadata' ->> 'barberia_id'));

CREATE POLICY "authenticated_delete_own" ON public.reservas
  FOR DELETE TO authenticated
  USING (barberia_id = (auth.jwt() -> 'user_metadata' ->> 'barberia_id'));
```

> La política `anon INSERT` no cambia. El `barberia_id` viene del config del deploy (código confiable).

- [ ] **Step 2: Asignar `barberia_id` al usuario admin en Supabase**

Ir a Supabase Dashboard → Authentication → Users → clic en el usuario admin → Edit → User metadata:
```json
{ "barberia_id": "evolution-spa" }
```

---

### Task 3: Actualizar `bot/config.js` para que lea desde `barberia.config.js`

**Files:**
- Modify: `bot/config.js`
- Create: `bot/test-config.js`

- [ ] **Step 1: Escribir el test que debe fallar**

Crear `bot/test-config.js`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import cfg from '../barberia.config.js'
import { SERVICES, BUSINESS_HOURS, BOOKING_WINDOW_DAYS, TZ } from './config.js'

test('SERVICES matches barberia.config.js servicios', () => {
  assert.equal(SERVICES.length, cfg.servicios.length)
  assert.equal(SERVICES[0].nombre, cfg.servicios[0].nombre)
  assert.equal(SERVICES[0].duracion_min, cfg.servicios[0].duracion)
  assert.equal(SERVICES[0].precio, cfg.servicios[0].precio)
})

test('BUSINESS_HOURS.start matches config apertura', () => {
  assert.equal(BUSINESS_HOURS.start, cfg.horario.apertura)
})

test('BUSINESS_HOURS.end matches config cierre', () => {
  assert.equal(BUSINESS_HOURS.end, cfg.horario.cierre)
})

test('BUSINESS_HOURS.slotMinutes matches config intervalo', () => {
  assert.equal(BUSINESS_HOURS.slotMinutes, cfg.horario.intervalo)
})

test('BUSINESS_HOURS.closedDays matches config diasCerrado', () => {
  assert.deepEqual(BUSINESS_HOURS.closedDays, cfg.horario.diasCerrado)
})

test('BOOKING_WINDOW_DAYS matches config ventanaReservaDias', () => {
  assert.equal(BOOKING_WINDOW_DAYS, cfg.ventanaReservaDias)
})

test('TZ matches config timezone', () => {
  assert.equal(TZ, cfg.horario.timezone)
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd bot
node --test test-config.js
```
Expected: FAIL — los valores del config actual no coinciden todavía.

- [ ] **Step 3: Reescribir `bot/config.js` para leer desde `barberia.config.js`**

Reemplazar el contenido completo de `bot/config.js`:
```js
import cfg from '../barberia.config.js'

export const SERVICES = cfg.servicios.map(s => ({
  nombre:      s.nombre,
  duracion_min: s.duracion,
  precio:       s.precio,
}))

export const BUSINESS_HOURS = {
  start:       cfg.horario.apertura,
  end:         cfg.horario.cierre,
  slotMinutes: cfg.horario.intervalo,
  closedDays:  cfg.horario.diasCerrado,
}

export const BOOKING_WINDOW_DAYS = cfg.ventanaReservaDias

export const TZ = cfg.horario.timezone

export function findServiceByNombre(nombre) {
  return SERVICES.find(s => s.nombre === nombre) ?? null
}

export function findServiceFuzzy(nombre) {
  const n = nombre.toLowerCase()
  return SERVICES.find(s => s.nombre.toLowerCase().includes(n)) ?? null
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

```bash
cd bot
node --test test-config.js
```
Expected: PASS (7 tests)

- [ ] **Step 5: Correr tests existentes para verificar que no hay regresiones**

```bash
node --test test-guard.js
node --test test-confirmaciones.js
```
Expected: todos PASS

- [ ] **Step 6: Commit**

```bash
git add bot/config.js bot/test-config.js
git commit -m "feat: bot/config.js proxies values from barberia.config.js"
```

---

### Task 4: Actualizar `bot/agent.js` para usar config en nombre del bot e info del negocio

**Files:**
- Modify: `bot/agent.js`

- [ ] **Step 1: Agregar import del config al principio de `bot/agent.js`**

Después de los imports existentes (línea ~10), agregar:
```js
import cfg from '../barberia.config.js'
```

- [ ] **Step 2: Reemplazar la línea del default del modelo (línea ~18)**

```js
// Antes:
const baseURL = process.env.AI_BASE_URL || 'https://api.cerebras.ai/v1';
// Después:
const baseURL = process.env.AI_BASE_URL || 'https://api.openai.com/v1';
```

- [ ] **Step 3: Reemplazar los valores hard-coded en `buildSystemPrompt` (línea ~40)**

Encontrar esta línea en `buildSystemPrompt`:
```js
return `Te llamas Sofi y sos la recepcionista que atiende el WhatsApp de Evolution Spa & Peluquería, un salón en Córdoba capital.
```

Reemplazarla por:
```js
return `Te llamas ${cfg.bot.nombre} y sos la recepcionista que atiende el WhatsApp de ${cfg.nombre}, un salón en ${cfg.ubicacion}.
```

- [ ] **Step 4: Verificar que el bot inicia sin errores**

```bash
cd bot
node index.js
```
Expected: el bot inicia, muestra el proveedor y modelo en consola, no crashea. Ctrl+C para detener.

- [ ] **Step 5: Commit**

```bash
git add bot/agent.js
git commit -m "feat: bot/agent.js uses config for bot name, business name and location"
```

---

### Task 5: Agregar `barberia_id` a los queries de `bot/supabase.js`

**Files:**
- Modify: `bot/supabase.js`

- [ ] **Step 1: Agregar import del config al principio de `bot/supabase.js`**

Después de los imports existentes, agregar:
```js
import cfg from '../barberia.config.js'
```

- [ ] **Step 2: Agregar filtro `barberia_id` en `listByFecha`**

```js
export async function listByFecha(fecha) {
  const { data, error } = await sb
    .from(TABLE)
    .select('*')
    .eq('barberia_id', cfg.barberia_id)
    .eq('fecha', fecha)
    .order('hora', { ascending: true });
  if (error) throw error;
  return data || [];
}
```

- [ ] **Step 3: Agregar filtro `barberia_id` en `listActivasByFecha`**

```js
export async function listActivasByFecha(fecha) {
  const { data, error } = await sb
    .from(TABLE)
    .select('*')
    .eq('barberia_id', cfg.barberia_id)
    .eq('fecha', fecha)
    .neq('estado', 'cancelada')
    .order('hora', { ascending: true });
  if (error) throw error;
  return data || [];
}
```

- [ ] **Step 4: Agregar filtro `barberia_id` en `findFuturasByTelefono`**

```js
export async function findFuturasByTelefono(telefono) {
  const hoy = new Date().toISOString().slice(0, 10);
  const base = telefono.replace(/^\+?549?/, '');
  const variants = [...new Set([telefono, `549${base}`, base])];
  const { data, error } = await sb
    .from(TABLE)
    .select('*')
    .eq('barberia_id', cfg.barberia_id)
    .in('telefono', variants)
    .neq('estado', 'cancelada')
    .gte('fecha', hoy)
    .order('fecha', { ascending: true })
    .order('hora', { ascending: true });
  if (error) throw error;
  return data || [];
}
```

- [ ] **Step 5: Agregar `barberia_id` al INSERT en `insertReserva`**

```js
export async function insertReserva(row) {
  const { data, error } = await sb
    .from(TABLE)
    .insert({ ...row, barberia_id: cfg.barberia_id })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}
```

- [ ] **Step 6: Agregar filtro `barberia_id` en `pendingReminders`**

```js
export async function pendingReminders(fechaIni, fechaFin) {
  const { data, error } = await sb
    .from(TABLE)
    .select('*')
    .eq('barberia_id', cfg.barberia_id)
    .neq('estado', 'cancelada')
    .eq('recordatorio_enviado', false)
    .gte('fecha', fechaIni)
    .lte('fecha', fechaFin);
  if (error) throw error;
  return data || [];
}
```

- [ ] **Step 7: Agregar filtro `barberia_id` en `pendingConfirmaciones`**

```js
export async function pendingConfirmaciones() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from(TABLE)
    .select('*')
    .eq('barberia_id', cfg.barberia_id)
    .eq('confirmacion_enviada', false)
    .gte('created_at', cutoff);
  if (error) throw error;
  return data ?? [];
}
```

- [ ] **Step 8: Correr tests existentes**

```bash
cd bot
node --test test-confirmaciones.js
```
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add bot/supabase.js
git commit -m "feat: bot/supabase.js scopes all queries to barberia_id from config"
```

---

### Task 6: Inyectar config en el frontend

**Files:**
- Modify: `index.html`
- Modify: `main.js`

- [ ] **Step 1: Agregar IDs a los elementos dinámicos en `index.html`**

Buscar cada ocurrencia de los valores hard-coded y agregar IDs. Buscar por texto:
- `"Evolution Spa & Peluquería"` → agregar `id="cfg-nombre"` al elemento contenedor (si hay múltiples, usar `data-cfg="nombre"` en todos)
- `"Mariano Fragueiro 11"` → agregar `id="cfg-direccion"`
- El `<a href="tel:3513115571">` → agregar `id="cfg-tel-link"`
- El `<a href="https://wa.me/5493513115571">` → agregar `id="cfg-wa-link"`
- El `<select>` de servicios (actualmente tiene 6 `<option>`) → vaciar el contenido y agregar `id="servicio"` si no lo tiene:

```html
<select id="servicio" name="servicio" required>
  <!-- populated by main.js from barberia.config.js -->
</select>
```

Para elementos que aparecen múltiples veces (ej: nombre del negocio en header y footer), usar `data-cfg="nombre"` en lugar de `id`:
```html
<span data-cfg="nombre">Evolution Spa & Peluquería</span>
```

- [ ] **Step 2: Agregar import del config y función `initConfig` en `main.js`**

Al principio de `main.js`, agregar:
```js
import cfg from './barberia.config.js'
```

Agregar la función `initConfig` y llamarla antes de cualquier otro setup:
```js
function initConfig() {
  document.querySelectorAll('[data-cfg="nombre"]').forEach(el => {
    el.textContent = cfg.nombre
  })

  const dir = document.getElementById('cfg-direccion')
  if (dir) dir.textContent = cfg.direccion

  const telLink = document.getElementById('cfg-tel-link')
  if (telLink) {
    telLink.href = `tel:${cfg.telefono}`
    telLink.textContent = cfg.telefono
  }

  const waLink = document.getElementById('cfg-wa-link')
  if (waLink) waLink.href = `https://wa.me/549${cfg.telefono}`

  const select = document.getElementById('servicio')
  if (select) {
    select.innerHTML = cfg.servicios
      .map(s => `<option value="${s.nombre}">${s.nombre}</option>`)
      .join('')
  }
}

initConfig()
```

- [ ] **Step 3: Reemplazar los hard-codes de horario y slots en `main.js`**

Encontrar el loop de generación de slots (buscar `h = 9` o similar) y las constantes de fecha. Reemplazar:

```js
// Leer del config en lugar de hard-codes
const [startH, startM] = cfg.horario.apertura.split(':').map(Number)
const [endH, endM]     = cfg.horario.cierre.split(':').map(Number)
const SLOT_INTERVAL    = cfg.horario.intervalo
const BOOKING_WINDOW   = cfg.ventanaReservaDias
const CLOSED_DAYS      = cfg.horario.diasCerrado
```

Usar estas variables en el loop de slots y en `setupFechaInput()` en lugar de los números literales.

- [ ] **Step 4: Iniciar el dev server y verificar**

```bash
npm run dev
```

Abrir http://localhost:5173. Verificar:
- El nombre del negocio se muestra correctamente en header y footer
- Dirección y teléfono son correctos
- El `<select>` de servicios muestra los 6 servicios del config
- El date picker bloquea domingos

- [ ] **Step 5: Commit**

```bash
git add main.js index.html
git commit -m "feat: frontend injects barberia.config.js values into DOM at load"
```

---

### Task 7: Filtrar el admin panel por `barberia_id`

**Files:**
- Modify: `admin.js`

- [ ] **Step 1: Leer `barberia_id` del user metadata después del login**

Dentro de `showDashboard()` (llamado tras login exitoso), agregar al principio:
```js
const { data: { user } } = await supabase.auth.getUser()
const BARBERIA_ID = user?.user_metadata?.barberia_id ?? null

if (!BARBERIA_ID) {
  alert('Este usuario no tiene una barbería asignada. Contactá al administrador.')
  await supabase.auth.signOut()
  return
}
```

- [ ] **Step 2: Agregar `.eq('barberia_id', BARBERIA_ID)` a todos los queries SELECT de `admin.js`**

Buscar todas las llamadas `.from('reservas').select(...)` y agregar el filtro. Ejemplo para la función de carga principal:

```js
const { data, error } = await supabase
  .from('reservas')
  .select('*')
  .eq('barberia_id', BARBERIA_ID)
  .order('fecha', { ascending: true })
```

Hacer lo mismo para el query del calendario mensual (si tiene su propio SELECT).

- [ ] **Step 3: Verificar en el browser**

```bash
npm run dev
```

Abrir http://localhost:5173/admin.html. Loguear. Verificar que la tabla solo muestra reservas donde `barberia_id = 'evolution-spa'`.

Para probar el aislamiento: ir a Supabase Dashboard → Table Editor → insertar manualmente una fila con `barberia_id = 'otra-barberia'`. Esa fila NO debe aparecer en el panel.

- [ ] **Step 4: Commit**

```bash
git add admin.js
git commit -m "feat: admin panel filters reservations by barberia_id from user metadata"
```

---

## Self-Review

**Spec coverage:**
- ✅ Config file único por deploy con identidad, servicios, horarios
- ✅ Bot lee nombre del bot, nombre del negocio y ubicación desde config
- ✅ Bot scopes todos los queries a `barberia_id`
- ✅ Frontend inyecta nombre, dirección, teléfono, servicios desde config
- ✅ Admin panel filtra por `barberia_id` del user metadata
- ✅ Migración DB agrega columna + backfill + nuevas RLS policies

**Gaps encontrados y cubiertos:**
- `pendingReminders` y `pendingConfirmaciones` también necesitaban `barberia_id` — cubiertos en Task 5 (Steps 6 y 7).
- `bot/agent.js` tenía el default de `AI_BASE_URL` apuntando a Cerebras — corregido a OpenAI en Task 4 Step 2.

**Placeholder check:** Ninguno encontrado.

**Consistencia de tipos:** `cfg.barberia_id` (string) usado consistentemente en Tasks 1, 5, 7. `cfg.servicios[].duracion` → mapeado a `duracion_min` en Task 3 Step 3 para mantener compatibilidad con el resto del bot.
