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

export const APP_URL = process.env.APP_URL || '';

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
