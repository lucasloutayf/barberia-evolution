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
