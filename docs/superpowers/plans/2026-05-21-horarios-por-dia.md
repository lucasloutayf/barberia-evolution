# Horarios por día con turnos partidos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el horario único `apertura`/`cierre` por un array `dias[7]` de franjas por día, soportando días cerrados y turnos partidos, tanto en el bot como en el frontend.

**Architecture:** `barberia.config.js` es la única fuente de verdad. `bot/config.js` exporta `SCHEDULE` + helpers (`horasForDay`, `isClosedDay`, `formatHorario`). `bot/slots.js` recibe `dayOfWeek` en todas sus funciones de horario. El frontend regenera los slots dinámicamente al elegir la fecha.

**Tech Stack:** Vanilla JS (ESM), Node 20+ (bot), Vite (frontend), `node:test` para tests del bot.

---

## Archivos modificados

| Archivo | Qué cambia |
|---|---|
| `barberia.config.js` | Nueva estructura `dias[]`; eliminar `apertura`, `cierre`, `diasCerrado` |
| `bot/config.js` | `BUSINESS_HOURS` → `SCHEDULE`; agregar `horasForDay`, `isClosedDay`, `formatHorario` |
| `bot/slots.js` | Todas las funciones de horario reciben `dayOfWeek`; exportar `dayOfWeekFor` |
| `bot/tools.js` | Importar `dayOfWeekFor`; pasar `dayOfWeek` a `validateHora`, `slotsForService`, `generateAllSlots` |
| `bot/agent.js` | Importar `SCHEDULE` + `formatHorario`; reemplazar línea hardcodeada de horario |
| `bot/whatsapp.js` | Importar `isClosedDay`, `horasForDay`, `formatHorario`; reescribir `isWithinBusinessHours` y el mensaje de cerrado |
| `bot/test-config.js` | Reemplazar tests de `BUSINESS_HOURS.*` por tests de `SCHEDULE` y helpers |
| `main.js` | Eliminar vars `startH/endH/CLOSED_DAYS`; reemplazar slots estáticos por generación dinámica en `setupFechaInput` |

---

### Task 1: Actualizar `barberia.config.js`

**Files:**
- Modify: `barberia.config.js`

- [ ] **Step 1: Reemplazar la sección `horario`**

Abrir `barberia.config.js` y reemplazar todo el bloque `horario: { ... }` con:

```js
  horario: {
    intervalo:    30,
    timezone:     'America/Argentina/Buenos_Aires',
    dias: [
      [],                                               // 0 Dom — cerrado
      [{ apertura: '09:00', cierre: '19:30' }],        // 1 Lun
      [{ apertura: '09:00', cierre: '19:30' }],        // 2 Mar
      [{ apertura: '09:00', cierre: '19:30' }],        // 3 Mié
      [{ apertura: '09:00', cierre: '19:30' }],        // 4 Jue
      [{ apertura: '09:00', cierre: '19:30' }],        // 5 Vie
      [{ apertura: '09:00', cierre: '19:30' }],        // 6 Sáb
    ],
  },
```

Resultado: los campos `apertura`, `cierre` y `diasCerrado` ya no existen en el config.

- [ ] **Step 2: Commit**

```bash
git add barberia.config.js
git commit -m "feat: reemplazar horario único por array dias[7] con franjas por día"
```

---

### Task 2: Actualizar `bot/config.js` y `bot/test-config.js`

**Files:**
- Modify: `bot/config.js`
- Modify: `bot/test-config.js`

- [ ] **Step 1: Reescribir `bot/config.js`**

Reemplazar el contenido completo del archivo con:

```js
import cfg from '../barberia.config.js';

export const TZ = cfg.horario.timezone;

export const SERVICES = cfg.servicios.map(s => ({
  id:           s.id,
  nombre:       s.nombre,
  duracion_min: s.duracion,
  precio:       s.precio,
}));

export const SCHEDULE = {
  dias:    cfg.horario.dias,
  stepMin: cfg.horario.intervalo,
};

export function horasForDay(dayOfWeek) {
  return SCHEDULE.dias[dayOfWeek] ?? [];
}

export function isClosedDay(dayOfWeek) {
  return horasForDay(dayOfWeek).length === 0;
}

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export function formatHorario() {
  return SCHEDULE.dias
    .map((franjas, i) => {
      if (franjas.length === 0) return `- ${DAY_NAMES[i]}: cerrado`;
      const rango = franjas.map(f => `${f.apertura} a ${f.cierre}`).join(' y ');
      return `- ${DAY_NAMES[i]}: ${rango}`;
    })
    .join('\n');
}

export const BOOKING_WINDOW_DAYS = cfg.ventanaReservaDias;

export const ADMIN_JID = process.env.ADMIN_JID || '';

export function findServiceByNombre(nombre) {
  if (!nombre) return null;
  const target = nombre.trim().toLowerCase();
  return SERVICES.find(s => s.nombre.toLowerCase() === target) || null;
}

export function findServiceFuzzy(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  for (const s of SERVICES) {
    if (t.includes(s.nombre.toLowerCase())) return s;
    if (t.includes(s.id)) return s;
  }
  return null;
}
```

- [ ] **Step 2: Reescribir `bot/test-config.js`**

Reemplazar el contenido completo con:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import cfg from '../barberia.config.js'
import {
  SERVICES, SCHEDULE, BOOKING_WINDOW_DAYS, TZ,
  findServiceByNombre, findServiceFuzzy,
  horasForDay, isClosedDay, formatHorario,
} from './config.js'

test('SERVICES matches barberia.config.js servicios', () => {
  assert.equal(SERVICES.length, cfg.servicios.length)
  assert.equal(SERVICES[0].nombre, cfg.servicios[0].nombre)
  assert.equal(SERVICES[0].duracion_min, cfg.servicios[0].duracion)
  assert.equal(SERVICES[0].precio, cfg.servicios[0].precio)
})

test('SCHEDULE.dias matches config horario.dias', () => {
  assert.deepEqual(SCHEDULE.dias, cfg.horario.dias)
})

test('SCHEDULE.stepMin matches config intervalo', () => {
  assert.equal(SCHEDULE.stepMin, cfg.horario.intervalo)
})

test('horasForDay(0) returns [] for domingo (closed)', () => {
  assert.deepEqual(horasForDay(0), [])
})

test('horasForDay(1) returns franjas array for lunes', () => {
  const franjas = horasForDay(1)
  assert.ok(Array.isArray(franjas))
  assert.ok(franjas.length > 0)
  assert.ok(franjas[0].apertura)
  assert.ok(franjas[0].cierre)
})

test('isClosedDay(0) returns true for domingo', () => {
  assert.equal(isClosedDay(0), true)
})

test('isClosedDay(1) returns false for lunes', () => {
  assert.equal(isClosedDay(1), false)
})

test('formatHorario returns string with 7 lines', () => {
  const txt = formatHorario()
  assert.equal(typeof txt, 'string')
  assert.equal(txt.split('\n').length, 7)
})

test('BOOKING_WINDOW_DAYS matches config ventanaReservaDias', () => {
  assert.equal(BOOKING_WINDOW_DAYS, cfg.ventanaReservaDias)
})

test('TZ matches config timezone', () => {
  assert.equal(TZ, cfg.horario.timezone)
})

test('findServiceByNombre("Tratamientos Spa") returns service', () => {
  const svc = findServiceByNombre('Tratamientos Spa')
  assert.notEqual(svc, null)
  assert.equal(svc.nombre, 'Tratamientos Spa')
})

test('findServiceFuzzy("spa") finds Tratamientos Spa', () => {
  const svc = findServiceFuzzy('spa')
  assert.notEqual(svc, null)
  assert.equal(svc.nombre, 'Tratamientos Spa')
})
```

- [ ] **Step 3: Correr los tests**

```bash
cd bot && node --test test-config.js
```

Esperado: todos los tests pasan (✓ ok).

- [ ] **Step 4: Commit**

```bash
git add bot/config.js bot/test-config.js
git commit -m "feat: SCHEDULE + helpers horasForDay/isClosedDay/formatHorario en config.js"
```

---

### Task 3: Reescribir `bot/slots.js`

**Files:**
- Modify: `bot/slots.js`

- [ ] **Step 1: Reemplazar el contenido completo de `bot/slots.js`**

```js
import { SCHEDULE, horasForDay, isClosedDay, BOOKING_WINDOW_DAYS, TZ } from './config.js';

const DEFAULT_DURATION = SCHEDULE.stepMin;

function hhmmToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function minutesToHHMM(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Todos los horarios de inicio válidos del día, unión de todas las franjas.
export function generateAllSlots(dayOfWeek) {
  const franjas = horasForDay(dayOfWeek);
  const step = SCHEDULE.stepMin;
  const out = [];
  for (const { apertura, cierre } of franjas) {
    const start = hhmmToMinutes(apertura);
    const end   = hhmmToMinutes(cierre);
    for (let m = start; m <= end; m += step) out.push(minutesToHHMM(m));
  }
  return out;
}

// Slots de stepMin que cubre un servicio que empieza a `horaInicio` y dura `durationMin`.
// Ej: horaInicio="14:00", durationMin=120 → ["14:00","14:30","15:00","15:30"].
export function coversSlots(horaInicio, durationMin) {
  const step = SCHEDULE.stepMin;
  const n = Math.ceil(durationMin / step);
  const startMin = hhmmToMinutes(horaInicio);
  const out = [];
  for (let i = 0; i < n; i++) out.push(minutesToHHMM(startMin + i * step));
  return out;
}

// El servicio cabe si su duración entera queda dentro de UNA sola franja del día.
// Un turno que cruza el corte al mediodía devuelve false.
function fitsInBusinessHours(horaInicio, durationMin, dayOfWeek) {
  const franjas = horasForDay(dayOfWeek);
  const step = SCHEDULE.stepMin;
  const startMin = hhmmToMinutes(horaInicio);
  const endMin = startMin + durationMin;
  for (const { apertura, cierre } of franjas) {
    if (startMin >= hhmmToMinutes(apertura) && endMin <= hhmmToMinutes(cierre) + step) {
      return true;
    }
  }
  return false;
}

// Dado el listado de reservas ACTIVAS del día, calcula los horarios de inicio
// disponibles para un servicio de `durationMin` minutos.
// `existingReservas` debe tener shape: [{ hora, duracion_min }]
export function slotsForService(durationMin, existingReservas, dayOfWeek) {
  const taken = new Set();
  for (const r of existingReservas) {
    const dur = r.duracion_min || DEFAULT_DURATION;
    for (const s of coversSlots(r.hora, dur)) taken.add(s);
  }

  const all = generateAllSlots(dayOfWeek);
  const available = [];
  for (const start of all) {
    if (!fitsInBusinessHours(start, durationMin, dayOfWeek)) continue;
    const needed = coversSlots(start, durationMin);
    if (needed.some(s => taken.has(s))) continue;
    available.push(start);
  }
  return available;
}

// Chequea si un nuevo turno (hora+durationMin) colisiona con reservas existentes.
export function hasCollision(horaInicio, durationMin, existingReservas, excludeId = null) {
  const needed = new Set(coversSlots(horaInicio, durationMin));
  for (const r of existingReservas) {
    if (excludeId && r.id === excludeId) continue;
    const dur = r.duracion_min || DEFAULT_DURATION;
    for (const s of coversSlots(r.hora, dur)) {
      if (needed.has(s)) return true;
    }
  }
  return false;
}

// "YYYY-MM-DD" del día actual en la TZ del salón.
export function todayISO() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(new Date());
}

// Día de la semana (0=Dom..6=Sáb) de una fecha YYYY-MM-DD interpretada como fecha local.
export function dayOfWeekFor(fechaISO) {
  const [y, m, d] = fechaISO.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

// Valida que `fechaISO` esté dentro del rango permitido y no sea día cerrado.
export function validateFecha(fechaISO) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaISO || '')) {
    return { ok: false, error: 'Formato de fecha inválido. Debe ser YYYY-MM-DD.' };
  }
  const hoy = todayISO();
  if (fechaISO <= hoy) {
    return { ok: false, error: 'La fecha debe ser a partir de mañana.' };
  }
  const [y, m, d] = hoy.split('-').map(Number);
  const maxDate = new Date(Date.UTC(y, m - 1, d + BOOKING_WINDOW_DAYS, 12));
  const maxISO = maxDate.toISOString().slice(0, 10);
  if (fechaISO > maxISO) {
    return { ok: false, error: `Solo aceptamos reservas hasta ${maxISO}.` };
  }
  if (isClosedDay(dayOfWeekFor(fechaISO))) {
    return { ok: false, error: 'Estamos cerrados ese día. Elegí otro día.' };
  }
  return { ok: true };
}

export function validateHora(hhmm, dayOfWeek) {
  if (!/^\d{2}:\d{2}$/.test(hhmm || '')) {
    return { ok: false, error: 'Formato de hora inválido. Debe ser HH:MM.' };
  }
  if (!generateAllSlots(dayOfWeek).includes(hhmm)) {
    const franjas = horasForDay(dayOfWeek);
    const rango = franjas.map(f => `${f.apertura}–${f.cierre}`).join(' y ');
    return { ok: false, error: `Hora fuera de los slots válidos (${rango} cada ${SCHEDULE.stepMin} min).` };
  }
  return { ok: true };
}
```

Nota clave: `dayOfWeekFor` ahora es **exported** (antes era función local). `tools.js` la importa en el paso siguiente.

- [ ] **Step 2: Verificar que no hay errores de sintaxis importando el módulo**

```bash
cd bot && node --input-type=module <<'EOF'
import { generateAllSlots, validateFecha, validateHora, dayOfWeekFor } from './slots.js';
console.log('slots OK:', generateAllSlots(1).slice(0,3));
console.log('validateFecha bad:', validateFecha('2020-01-01'));
console.log('validateHora lunes 09:00:', validateHora('09:00', 1));
console.log('validateHora domingo:', validateHora('09:00', 0));
EOF
```

Esperado (sin errores): slots OK con primeros slots del lunes, validateFecha bad con error, validateHora lunes ok, validateHora domingo con error.

- [ ] **Step 3: Commit**

```bash
git add bot/slots.js
git commit -m "feat: slots.js con generateAllSlots/slotsForService/validateHora por día de semana"
```

---

### Task 4: Actualizar `bot/tools.js`

**Files:**
- Modify: `bot/tools.js`

- [ ] **Step 1: Agregar `dayOfWeekFor` a los imports de `./slots.js`**

Cambiar la línea de import de slots.js de:

```js
import {
  generateAllSlots, slotsForService, hasCollision,
  validateFecha, validateHora,
} from './slots.js';
```

a:

```js
import {
  generateAllSlots, slotsForService, hasCollision,
  validateFecha, validateHora, dayOfWeekFor,
} from './slots.js';
```

- [ ] **Step 2: Actualizar `consultar_disponibilidad`**

Reemplazar el cuerpo de la función desde `const reservas = ...` hasta el `return`:

```js
  const dayOfWeek = dayOfWeekFor(fecha);
  const reservas = await listActivasByFecha(fecha);
  const horarios = slotsForService(svc.duracion_min, reservas, dayOfWeek);
  return {
    ok: true,
    data: {
      fecha,
      servicio: svc.nombre,
      duracion_min: svc.duracion_min,
      horarios_disponibles: horarios,
      total_horarios_dia: generateAllSlots(dayOfWeek).length,
    },
  };
```

- [ ] **Step 3: Actualizar `crear_reserva`**

Localizar las líneas:
```js
  const vh = validateHora(hora);
```
y:
```js
  const reservas = await listActivasByFecha(fecha);
  if (hasCollision(hora, svc.duracion_min, reservas)) {
    const disponibles = slotsForService(svc.duracion_min, reservas);
```

Reemplazar con:
```js
  const dayOfWeek = dayOfWeekFor(fecha);
  const vh = validateHora(hora, dayOfWeek);
```
y:
```js
  const reservas = await listActivasByFecha(fecha);
  if (hasCollision(hora, svc.duracion_min, reservas)) {
    const disponibles = slotsForService(svc.duracion_min, reservas, dayOfWeek);
```

- [ ] **Step 4: Actualizar `modificar_reserva`**

Localizar las líneas (después de calcular `fecha` y `hora`):
```js
  const vh = validateHora(hora);
```
y:
```js
  const reservas = await listActivasByFecha(fecha);
  if (hasCollision(hora, duracion, reservas, id)) {
    const disponibles = slotsForService(duracion, reservas);
```

Reemplazar con:
```js
  const dayOfWeek = dayOfWeekFor(fecha);
  const vh = validateHora(hora, dayOfWeek);
```
y:
```js
  const reservas = await listActivasByFecha(fecha);
  if (hasCollision(hora, duracion, reservas, id)) {
    const disponibles = slotsForService(duracion, reservas, dayOfWeek);
```

- [ ] **Step 5: Verificar imports sin errores**

```bash
cd bot && node --input-type=module <<'EOF'
import { consultar_disponibilidad, crear_reserva, modificar_reserva } from './tools.js';
console.log('tools.js OK');
EOF
```

Esperado: `tools.js OK` (sin errores de importación).

- [ ] **Step 6: Commit**

```bash
git add bot/tools.js
git commit -m "feat: tools.js pasa dayOfWeek a validateHora, slotsForService y generateAllSlots"
```

---

### Task 5: Actualizar `bot/agent.js`

**Files:**
- Modify: `bot/agent.js`

- [ ] **Step 1: Actualizar el import de `./config.js`**

Cambiar:
```js
import { SERVICES, BOOKING_WINDOW_DAYS, BUSINESS_HOURS, TZ } from './config.js';
```

a:
```js
import { SERVICES, BOOKING_WINDOW_DAYS, SCHEDULE, TZ, formatHorario } from './config.js';
```

- [ ] **Step 2: Reemplazar la línea hardcodeada de horario en `buildSystemPrompt`**

Cambiar:
```js
Horario: lunes a sábado de ${BUSINESS_HOURS.start} a ${BUSINESS_HOURS.end} hs. Los domingos cerramos.
Los turnos son cada ${BUSINESS_HOURS.stepMin} minutos. Se puede reservar desde mañana hasta ${BOOKING_WINDOW_DAYS} días adelante.
```

por:
```js
Horario:
${formatHorario()}
Los turnos son cada ${SCHEDULE.stepMin} minutos. Se puede reservar desde mañana hasta ${BOOKING_WINDOW_DAYS} días adelante.
```

- [ ] **Step 3: Verificar imports sin errores**

```bash
cd bot && node --env-file ../.env --input-type=module <<'EOF'
import { handleMessage, ProviderBusyError } from './agent.js';
console.log('agent.js OK');
EOF
```

Esperado: `agent.js OK`. Requiere `.env` en la raíz con `AI_API_KEY` válido; si falta, el módulo tira `Falta AI_API_KEY en .env`.

- [ ] **Step 4: Commit**

```bash
git add bot/agent.js
git commit -m "feat: agent.js usa formatHorario() dinámico en lugar de horario hardcodeado"
```

---

### Task 6: Actualizar `bot/whatsapp.js`

**Files:**
- Modify: `bot/whatsapp.js`

- [ ] **Step 1: Actualizar el import de `./config.js`**

Cambiar:
```js
import { BUSINESS_HOURS, TZ } from './config.js';
```

a:
```js
import { TZ, horasForDay, isClosedDay, formatHorario } from './config.js';
```

- [ ] **Step 2: Reescribir `isWithinBusinessHours`**

Reemplazar:
```js
function isWithinBusinessHours() {
  const local = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
  const day = local.getDay();
  if (BUSINESS_HOURS.closedDays.includes(day)) return false;
  const hhmm = `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`;
  return hhmm >= BUSINESS_HOURS.start && hhmm <= BUSINESS_HOURS.end;
}
```

con:
```js
function isWithinBusinessHours() {
  const local = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
  const day = local.getDay();
  if (isClosedDay(day)) return false;
  const hhmm = `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`;
  return horasForDay(day).some(f => hhmm >= f.apertura && hhmm <= f.cierre);
}
```

- [ ] **Step 3: Actualizar el mensaje de "salón cerrado"**

Localizar:
```js
          await sock.sendMessage(from, {
            text: 'El salón está cerrado en este momento 🌙\nNuestro horario es lunes a sábado de 9:00 a 19:30 hs.\n¡Escribinos en horario y te atendemos enseguida!',
          }).catch(() => {});
```

Reemplazar con:
```js
          await sock.sendMessage(from, {
            text: `El salón está cerrado en este momento 🌙\nNuestro horario:\n${formatHorario()}\n¡Escribinos en horario y te atendemos enseguida!`,
          }).catch(() => {});
```

- [ ] **Step 4: Verificar imports sin errores**

```bash
cd bot && node --input-type=module <<'EOF'
import { connectToWhatsApp } from './whatsapp.js';
console.log('whatsapp.js OK');
EOF
```

Esperado: `whatsapp.js OK` (puede haber errores de `.env` faltante, pero no de importaciones).

- [ ] **Step 5: Commit**

```bash
git add bot/whatsapp.js
git commit -m "feat: whatsapp.js usa isClosedDay/horasForDay para check de horario por día"
```

---

### Task 7: Actualizar `main.js` (frontend)

**Files:**
- Modify: `main.js`

- [ ] **Step 1: Eliminar variables de horario obsoletas al tope del archivo**

Cambiar las líneas 6–10:
```js
const [startH, startM] = cfg.horario.apertura.split(':').map(Number)
const [endH, endM]     = cfg.horario.cierre.split(':').map(Number)
const SLOT_INTERVAL    = cfg.horario.intervalo
const BOOKING_WINDOW   = cfg.ventanaReservaDias
const CLOSED_DAYS      = cfg.horario.diasCerrado
```

por:
```js
const SLOT_INTERVAL    = cfg.horario.intervalo
const BOOKING_WINDOW   = cfg.ventanaReservaDias
```

- [ ] **Step 2: Reemplazar la generación estática de slots**

Dentro del IIFE de la modal, eliminar el bloque de generación estática (líneas 63–77):
```js
  // --- Generar slots de horario ---
  const slots = [];
  for (let h = startH; h <= endH; h++) {
    for (let m = 0; m < 60; m += SLOT_INTERVAL) {
      if (h === endH && m > endM) break;
      if (h === startH && m < startM) continue;
      slots.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
    }
  }
  slots.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s + ' hs';
    horaSelect.appendChild(opt);
  });
```

Y reemplazarlo con la función `populateSlotsForDay`:
```js
  function populateSlotsForDay(dayOfWeek) {
    horaSelect.innerHTML = '<option value="" disabled selected>Seleccioná un horario</option>';
    const franjas = cfg.horario.dias[dayOfWeek] ?? [];
    for (const { apertura, cierre } of franjas) {
      const [sH, sM] = apertura.split(':').map(Number);
      const [eH, eM] = cierre.split(':').map(Number);
      for (let h = sH; h <= eH; h++) {
        for (let m = (h === sH ? sM : 0); m < 60; m += SLOT_INTERVAL) {
          if (h === eH && m > eM) break;
          const hh = String(h).padStart(2, '0');
          const mm = String(m).padStart(2, '0');
          const opt = document.createElement('option');
          opt.value = `${hh}:${mm}`;
          opt.textContent = `${hh}:${mm} hs`;
          horaSelect.appendChild(opt);
        }
      }
    }
  }
```

- [ ] **Step 3: Actualizar `setupFechaInput` para regenerar slots en cada cambio de fecha**

Reemplazar el listener dentro de `setupFechaInput`:
```js
    fechaInput.addEventListener('input', () => {
      const chosen = new Date(fechaInput.value + 'T00:00:00');
      if (CLOSED_DAYS.includes(chosen.getDay())) {
        fechaInput.setCustomValidity('Estamos cerrados ese día. Por favor elegí otro día.');
      } else {
        fechaInput.setCustomValidity('');
      }
    });
```

con:
```js
    fechaInput.addEventListener('input', () => {
      const chosen = new Date(fechaInput.value + 'T00:00:00');
      const day = chosen.getDay();
      const franjas = cfg.horario.dias[day] ?? [];
      if (franjas.length === 0) {
        fechaInput.setCustomValidity('Estamos cerrados ese día. Por favor elegí otro día.');
        horaSelect.innerHTML = '<option value="" disabled selected>Seleccioná un horario</option>';
      } else {
        fechaInput.setCustomValidity('');
        populateSlotsForDay(day);
      }
    });
```

- [ ] **Step 4: Arrancar el servidor de desarrollo y probar manualmente**

```bash
npm run dev
```

Abrir `http://localhost:5173` en el navegador.

Verificar:
1. Al abrir el modal, el select de hora muestra solo "Seleccioná un horario" (sin opciones de tiempo)
2. Al elegir una fecha de un día abierto (ej: lunes), el select se llena con los slots correctos
3. Al elegir una fecha de domingo, el campo de fecha muestra el error de validación y el select se vacía
4. Si el config tiene un día con turno partido (ej: martes con `09:00–13:00` y `15:00–19:00`), el select muestra los slots de ambas franjas en orden cronológico, sin slots en el corte 13:30–14:30

- [ ] **Step 5: Commit**

```bash
git add main.js
git commit -m "feat: main.js regenera slots de hora dinámicamente según día elegido"
```

---

### Task 8: Correr todos los tests del bot

**Files:** (ninguno — solo verificación)

- [ ] **Step 1: Correr la suite completa del bot**

```bash
cd bot && node --test test-config.js && node --test test-guard.js && node --test test-confirmaciones.js
```

Esperado: todos los tests pasan (✓ ok). Si alguno falla, revisar el error y corregir antes de continuar.

- [ ] **Step 2: Commit final si hay cambios pendientes**

Si todo pasa sin cambios adicionales, no hay nada que commitear. Si se corrigió algo en el paso anterior, commitear con:

```bash
git add -p
git commit -m "fix: correcciones post-test en horarios por día"
```
