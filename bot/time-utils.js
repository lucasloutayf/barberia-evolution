import { TZ } from './config.js';

// Combina fecha (YYYY-MM-DD) y hora (HH:MM) en un Date UTC que corresponde a
// ese instante en la TZ del salón.
export function fechaHoraAUtc(fechaISO, horaHHMM) {
  // Heurística simple: Argentina (TZ) está siempre en UTC-3 (sin DST).
  // Si el salón cambia de país, reescribir con luxon/tz-aware.
  const [y, mo, d] = fechaISO.split('-').map(Number);
  const [h, mi] = horaHHMM.split(':').map(Number);
  // h en TZ = h+3 en UTC.
  return new Date(Date.UTC(y, mo - 1, d, h + 3, mi, 0));
}

// Convierte un Date a YYYY-MM-DD según la TZ del salón.
export function fechaISOEnTZ(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

// Acepta tanto "5493511234567" (lo guarda el bot desde el JID) como
// "0351 311-5571" (formulario web).
export function jidFromTelefono(telefono) {
  const digits = String(telefono || '').replace(/\D+/g, '');
  if (digits.length < 10) return null;
  // Si arranca con "0" → asumimos Argentina local, lo convertimos a 549+...
  let normalized = digits;
  if (digits.startsWith('0') && digits.length >= 10 && digits.length <= 12) {
    normalized = '549' + digits.replace(/^0/, '');
  }
  return `${normalized}@s.whatsapp.net`;
}
