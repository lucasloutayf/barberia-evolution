import { findServiceByNombre, TZ } from './config.js';

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function formatDuracion(min) {
  if (min < 60) return `${min} minutos`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (m === 0) return h === 1 ? '1 hora' : `${h} horas`;
  return `${h} hora${h > 1 ? 's' : ''} y ${m} minutos`;
}

function todayEnTZ() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

function tomorrowEnTZ() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
}

export function buildConfirmacion(reserva) {
  const svc = findServiceByNombre(reserva.servicio);
  const duracion = reserva.duracion_min ?? svc?.duracion_min ?? 30;
  const precio = svc?.precio;

  const [y, mo, d] = reserva.fecha.split('-').map(Number);
  const diaSemana = DIAS[new Date(y, mo - 1, d).getDay()];
  const dd = String(d).padStart(2, '0');
  const mm = String(mo).padStart(2, '0');

  let cierre;
  if (reserva.fecha === todayEnTZ())         cierre = '¡Nos vemos hoy!';
  else if (reserva.fecha === tomorrowEnTZ()) cierre = '¡Nos vemos mañana!';
  else                                       cierre = `¡Nos vemos el ${diaSemana}!`;

  const lines = [
    `Listo, ${reserva.nombre}. Te confirmo tu turno:`,
    ``,
    `📅 ${diaSemana} ${dd}/${mm} a las ${reserva.hora}`,
    `💇 ${reserva.servicio}`,
    `⏳ Dura ${formatDuracion(duracion)}`,
  ];
  if (precio != null) lines.push(`💲 Precio: $${precio.toLocaleString('es-AR')}`);
  if (reserva.mensaje?.trim()) lines.push(`📝 ${reserva.mensaje.trim()}`);
  lines.push(``, `Cualquier cosa, avisame. ${cierre}`);
  return lines.join('\n');
}
