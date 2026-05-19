// Cron interno para recordatorios 24hs antes del turno.
// Corre cada 15 minutos. Busca reservas no canceladas, sin recordatorio enviado,
// cuyo (fecha+hora) cae en la ventana [now+23h, now+25h] en TZ del salón.

import cron from 'node-cron';
import { TZ } from './config.js';
import { pendingReminders, markReminderSent } from './supabase.js';
import { getSock } from './whatsapp.js';

const CRON_EXPR = '*/15 * * * *';
const WINDOW_MIN_HOURS = 23;
const WINDOW_MAX_HOURS = 25;

// Combina fecha (YYYY-MM-DD) y hora (HH:MM) en un Date UTC que corresponde a
// ese instante en la TZ del salón.
function fechaHoraAUtc(fechaISO, horaHHMM) {
  // Heurística simple: Argentina (TZ) está siempre en UTC-3 (sin DST).
  // Si el salón cambia de país, reescribir con luxon/tz-aware.
  const [y, mo, d] = fechaISO.split('-').map(Number);
  const [h, mi] = horaHHMM.split(':').map(Number);
  // h en TZ = h+3 en UTC.
  return new Date(Date.UTC(y, mo - 1, d, h + 3, mi, 0));
}

function fechaISOEnTZ(date) {
  // Convierte un Date a YYYY-MM-DD según la TZ del salón.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function formatHora(hhmm) {
  return hhmm;
}

function jidFromTelefono(telefono) {
  // Acepta tanto "5493511234567" (lo guarda el bot desde el JID) como
  // "0351 311-5571" (formulario web).
  const digits = String(telefono || '').replace(/\D+/g, '');
  if (digits.length < 10) return null;
  // Si arranca con "0" → asumimos Argentina local, lo convertimos a 549+...
  let normalized = digits;
  if (digits.startsWith('0') && digits.length >= 10 && digits.length <= 12) {
    normalized = '549' + digits.replace(/^0/, '');
  }
  return `${normalized}@s.whatsapp.net`;
}

function buildMensaje(reserva) {
  const nombre = reserva.nombre || 'Hola';
  return [
    `Hola ${nombre}! Te recordamos tu turno en *Evolution Spa & Peluquería*:`,
    ``,
    `📅 ${reserva.fecha} a las ${formatHora(reserva.hora)} hs`,
    `💇 ${reserva.servicio}`,
    ``,
    `Si no podés venir, respondé *CANCELAR* y reagendamos.`,
  ].join('\n');
}

export async function runOnce() {
  const now = new Date();
  const minDate = new Date(now.getTime() + WINDOW_MIN_HOURS * 3600 * 1000);
  const maxDate = new Date(now.getTime() + WINDOW_MAX_HOURS * 3600 * 1000);
  const fechaMin = fechaISOEnTZ(minDate);
  const fechaMax = fechaISOEnTZ(maxDate);

  let candidatas;
  try {
    candidatas = await pendingReminders(fechaMin, fechaMax);
  } catch (err) {
    console.error('[scheduler] error consultando pendientes:', err);
    return;
  }

  if (!candidatas.length) return;

  let sock;
  try { sock = getSock(); } catch { console.warn('[scheduler] socket no listo, salteando tick'); return; }

  for (const r of candidatas) {
    const when = fechaHoraAUtc(r.fecha, r.hora);
    if (when < minDate || when > maxDate) continue; // filtro fino por hora exacta

    const jid = jidFromTelefono(r.telefono);
    if (!jid) {
      console.warn(`[scheduler] tel inválido para reserva ${r.id}: "${r.telefono}", marcando como enviado para evitar reintentos`);
      try { await markReminderSent(r.id); } catch {}
      continue;
    }

    // Marcamos PRIMERO y enviamos después: preferimos perder un recordatorio
    // que mandarlo dos veces si la app reinicia entre el send y la marca.
    try { await markReminderSent(r.id); }
    catch (err) { console.error(`[scheduler] no se pudo marcar ${r.id}:`, err); continue; }

    try {
      await sock.sendMessage(jid, { text: buildMensaje(r) });
      console.log(`[scheduler] recordatorio enviado a ${r.telefono} (reserva ${r.id})`);
    } catch (err) {
      console.error(`[scheduler] fallo enviando recordatorio a ${jid}:`, err.message);
    }
  }
}

export function startScheduler() {
  cron.schedule(CRON_EXPR, () => {
    runOnce().catch(err => console.error('[scheduler] tick error:', err));
  });
  console.log(`[scheduler] activo (${CRON_EXPR})`);
}
