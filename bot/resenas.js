import cron from 'node-cron';
import cfg from '../barberia.config.js';
import { fechaHoraAUtc, fechaISOEnTZ, jidFromTelefono } from './time-utils.js';

const GOOGLE_MAPS_URL = process.env.GOOGLE_MAPS_URL;
if (!GOOGLE_MAPS_URL) throw new Error('[resenas] GOOGLE_MAPS_URL no definida');

const CRON_EXPR = '*/15 * * * *';
// Ventana: reservas cuyo (fecha+hora) cayó hace entre 30 y 90 minutos.
const WINDOW_MIN_MIN = 30;
const WINDOW_MAX_MIN = 90;

export function buildMensajeResena(reserva) {
  const nombre = reserva.nombre || 'Hola';
  return [
    `Hola ${nombre}! Esperamos que hayas disfrutado tu visita a *${cfg.nombre}* 💈`,
    ``,
    `¿Cómo fue tu experiencia? Tu opinión nos ayuda mucho:`,
    `⭐ Dejanos una reseña: ${GOOGLE_MAPS_URL}`,
    ``,
    `¡Hasta la próxima!`,
  ].join('\n');
}

export async function runOnce() {
  const { pendingResenas, markResenaSent } = await import('./supabase.js');
  const { getSock } = await import('./whatsapp.js');

  const now = new Date();
  const minDate = new Date(now.getTime() - WINDOW_MAX_MIN * 60 * 1000);
  const maxDate = new Date(now.getTime() - WINDOW_MIN_MIN * 60 * 1000);
  const fechaMin = fechaISOEnTZ(minDate);
  const fechaMax = fechaISOEnTZ(maxDate);

  // Nota: cuando la ventana cruza medianoche, fechaMin puede ser el día anterior.
  // La query trae todas las reservas de ese rango de fechas y el filtro fino por hora
  // exacta descarta las que no caen en la ventana. El volumen es bajo para un salón.
  let candidatas;
  try {
    candidatas = await pendingResenas(fechaMin, fechaMax);
  } catch (err) {
    console.error('[resenas] error consultando pendientes:', err);
    return;
  }

  if (!candidatas.length) return;

  let sock;
  try { sock = getSock(); } catch { console.warn('[resenas] socket no listo, salteando tick'); return; }

  for (const r of candidatas) {
    const when = fechaHoraAUtc(r.fecha, r.hora);
    if (when < minDate || when > maxDate) continue;

    const jid = jidFromTelefono(r.telefono);
    if (!jid) {
      console.warn(`[resenas] tel inválido para reserva ${r.id}: "${r.telefono}", marcando para evitar reintentos`);
      try { await markResenaSent(r.id); } catch {}
      continue;
    }

    try { await markResenaSent(r.id); }
    catch (err) { console.error(`[resenas] no se pudo marcar ${r.id}:`, err); continue; }

    try {
      await sock.sendMessage(jid, { text: buildMensajeResena(r) });
      console.log(`[resenas] reseña enviada a ${r.telefono} (reserva ${r.id})`);
    } catch (err) {
      console.error(`[resenas] fallo enviando reseña a ${jid}:`, err.message);
    }
  }
}

export function startResenas() {
  cron.schedule(CRON_EXPR, () => {
    runOnce().catch(err => console.error('[resenas] tick error:', err));
  });
  console.log(`[resenas] activo (${CRON_EXPR}, ventana ${WINDOW_MIN_MIN}-${WINDOW_MAX_MIN} min post-turno)`);
}
