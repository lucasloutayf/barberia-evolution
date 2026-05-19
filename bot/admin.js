// Comandos del administrador. Se ejecutan ANTES de pasarle el mensaje al LLM.

import { listByFecha, findById, cancelReserva, findFuturasByTelefono } from './supabase.js';
import { todayISO } from './slots.js';

const HELP = [
  '*Comandos admin disponibles:*',
  '/turnos              → turnos de hoy',
  '/turnos YYYY-MM-DD   → turnos de una fecha',
  '/cancelar <id>       → cancelar por id (UUID)',
  '/cancelar <telefono> → cancelar próximo turno de un teléfono',
  '/help                → esta ayuda',
].join('\n');

function formatTurnos(rows, fecha) {
  if (!rows.length) return `No hay turnos para ${fecha}.`;
  const activos = rows.filter(r => r.estado !== 'cancelada');
  const cancelados = rows.filter(r => r.estado === 'cancelada');
  let out = `*Turnos del ${fecha}* (${activos.length} activos):\n`;
  for (const r of activos) {
    const dur = r.duracion_min ? ` · ${r.duracion_min}min` : '';
    const estadoTag = r.estado === 'confirmada' ? ' ✓' : '';
    out += `\n${r.hora}${estadoTag} — ${r.nombre} — ${r.servicio}${dur} — ${r.telefono}`;
  }
  if (cancelados.length) {
    out += `\n\n_(${cancelados.length} cancelados omitidos)_`;
  }
  return out;
}

// UUID v4-ish detection (sólo para distinguir id vs telefono).
function looksLikeUUID(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

// Retorna { handled: boolean, reply?: string }
export async function handleAdmin(text) {
  const raw = (text || '').trim();
  if (!raw.startsWith('/')) return { handled: false };

  const [cmd, ...rest] = raw.split(/\s+/);
  const args = rest.join(' ').trim();

  try {
    switch (cmd.toLowerCase()) {
      case '/help':
        return { handled: true, reply: HELP };

      case '/turnos': {
        const fecha = args || todayISO();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
          return { handled: true, reply: 'Formato de fecha inválido. Usá YYYY-MM-DD.' };
        }
        const rows = await listByFecha(fecha);
        return { handled: true, reply: formatTurnos(rows, fecha) };
      }

      case '/cancelar': {
        if (!args) return { handled: true, reply: 'Usá: /cancelar <id> o /cancelar <telefono>' };

        if (looksLikeUUID(args)) {
          const r = await findById(args);
          if (!r) return { handled: true, reply: `No existe reserva con id ${args}.` };
          if (r.estado === 'cancelada') return { handled: true, reply: 'Esa reserva ya estaba cancelada.' };
          await cancelReserva(args);
          return { handled: true, reply: `Cancelada: ${r.fecha} ${r.hora} — ${r.nombre} (${r.servicio}).` };
        }

        // Tratar como teléfono
        const futuras = await findFuturasByTelefono(args);
        if (!futuras.length) return { handled: true, reply: `No hay turnos futuros para el teléfono ${args}.` };
        if (futuras.length > 1) {
          const lista = futuras.map(f => `  ${f.id}  ${f.fecha} ${f.hora}  ${f.servicio}`).join('\n');
          return { handled: true, reply: `Hay ${futuras.length} turnos futuros para ${args}. Cancelá por id:\n${lista}` };
        }
        const r = futuras[0];
        await cancelReserva(r.id);
        return { handled: true, reply: `Cancelada: ${r.fecha} ${r.hora} — ${r.nombre} (${r.servicio}).` };
      }

      default:
        return { handled: true, reply: `Comando desconocido. ${HELP}` };
    }
  } catch (err) {
    console.error('[admin] error:', err);
    return { handled: true, reply: `Error: ${err.message || 'desconocido'}` };
  }
}
