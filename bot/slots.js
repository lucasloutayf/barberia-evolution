// Generación de horarios y cálculo de disponibilidad con bloqueo multi-slot.
// Replica la lógica del loop en main.js (09:00–19:30 cada 30 min).

import { BUSINESS_HOURS, BOOKING_WINDOW_DAYS, TZ } from './config.js';

const DEFAULT_DURATION = BUSINESS_HOURS.stepMin;

function hhmmToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function minutesToHHMM(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Todos los horarios de inicio válidos del día (09:00, 09:30, ..., 19:30).
export function generateAllSlots() {
  const start = hhmmToMinutes(BUSINESS_HOURS.start);
  const end   = hhmmToMinutes(BUSINESS_HOURS.end);
  const step  = BUSINESS_HOURS.stepMin;
  const out = [];
  for (let m = start; m <= end; m += step) out.push(minutesToHHMM(m));
  return out;
}

// Slots de 30 min que cubre un servicio que empieza a `horaInicio` y dura `durationMin`.
// Ej: horaInicio="14:00", durationMin=120 → ["14:00","14:30","15:00","15:30"].
export function coversSlots(horaInicio, durationMin) {
  const step = BUSINESS_HOURS.stepMin;
  const n = Math.ceil(durationMin / step);
  const startMin = hhmmToMinutes(horaInicio);
  const out = [];
  for (let i = 0; i < n; i++) out.push(minutesToHHMM(startMin + i * step));
  return out;
}

// Retorna true si todos los slots cubiertos por el servicio (en su horaInicio
// y duración) caben dentro del horario de cierre del salón.
function fitsInBusinessHours(horaInicio, durationMin) {
  const step = BUSINESS_HOURS.stepMin;
  const lastStart = hhmmToMinutes(BUSINESS_HOURS.end); // último INICIO permitido
  const startMin = hhmmToMinutes(horaInicio);
  const endMin = startMin + durationMin;
  // El último slot que ocupa el servicio termina en endMin. Permitimos hasta
  // lastStart + step (= cierre real).
  return endMin <= lastStart + step;
}

// Dado el listado de reservas ACTIVAS del día, calcula los horarios de inicio
// disponibles para un servicio de `durationMin` minutos.
// `existingReservas` debe tener shape: [{ hora, duracion_min }]
export function slotsForService(durationMin, existingReservas) {
  // Marcar como ocupados todos los slots cubiertos por reservas existentes.
  const taken = new Set();
  for (const r of existingReservas) {
    const dur = r.duracion_min || DEFAULT_DURATION; // reservas viejas sin duracion_min → 30 min
    for (const s of coversSlots(r.hora, dur)) taken.add(s);
  }

  const all = generateAllSlots();
  const available = [];
  for (const start of all) {
    if (!fitsInBusinessHours(start, durationMin)) continue;
    const needed = coversSlots(start, durationMin);
    if (needed.some(s => taken.has(s))) continue;
    available.push(start);
  }
  return available;
}

// Chequea si un nuevo turno (fecha+hora+durationMin) colisiona con la lista de
// reservas activas existentes. Si `excludeId` se pasa, ignora esa reserva
// (útil al modificar un turno propio).
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
  return fmt.format(new Date()); // en-CA → "YYYY-MM-DD"
}

// Día de la semana (0=Dom..6=Sáb) de una fecha YYYY-MM-DD interpretada como
// fecha local del salón.
function dayOfWeekFor(fechaISO) {
  // Construir un Date a mediodía UTC para evitar saltos de zona en el cálculo.
  const [y, m, d] = fechaISO.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

// Valida que `fechaISO` (YYYY-MM-DD) esté dentro del rango permitido y no sea Domingo.
// Retorna { ok: true } o { ok: false, error: '...' }.
export function validateFecha(fechaISO) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaISO || '')) {
    return { ok: false, error: 'Formato de fecha inválido. Debe ser YYYY-MM-DD.' };
  }
  const hoy = todayISO();
  if (fechaISO <= hoy) {
    return { ok: false, error: 'La fecha debe ser a partir de mañana.' };
  }
  // Calcular fecha máxima = hoy + BOOKING_WINDOW_DAYS
  const [y, m, d] = hoy.split('-').map(Number);
  const maxDate = new Date(Date.UTC(y, m - 1, d + BOOKING_WINDOW_DAYS, 12));
  const maxISO = maxDate.toISOString().slice(0, 10);
  if (fechaISO > maxISO) {
    return { ok: false, error: `Solo aceptamos reservas hasta ${maxISO}.` };
  }
  if (BUSINESS_HOURS.closedDays.includes(dayOfWeekFor(fechaISO))) {
    return { ok: false, error: 'Estamos cerrados los Domingos. Elegí otro día.' };
  }
  return { ok: true };
}

export function validateHora(hhmm) {
  if (!/^\d{2}:\d{2}$/.test(hhmm || '')) {
    return { ok: false, error: 'Formato de hora inválido. Debe ser HH:MM.' };
  }
  if (!generateAllSlots().includes(hhmm)) {
    return { ok: false, error: `Hora fuera de los slots válidos (${BUSINESS_HOURS.start} a ${BUSINESS_HOURS.end} cada ${BUSINESS_HOURS.stepMin} min).` };
  }
  return { ok: true };
}
