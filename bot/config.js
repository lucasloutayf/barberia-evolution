// Catálogo y reglas del salón — leídos desde barberia.config.js (fuente única de verdad).
// Los `nombre` de SERVICES deben coincidir EXACTAMENTE con los <option> del <select>
// en index.html (rf-servicio) para que el panel admin del sitio los muestre consistentes.

import cfg from '../barberia.config.js';

export const TZ = cfg.horario.timezone;

export const SERVICES = cfg.servicios.map(s => ({
  id:           s.id,
  nombre:       s.nombre,
  duracion_min: s.duracion,
  precio:       s.precio,
}));

export const BUSINESS_HOURS = {
  start:       cfg.horario.apertura,
  end:         cfg.horario.cierre,
  stepMin:     cfg.horario.intervalo,
  closedDays:  cfg.horario.diasCerrado,
};

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
