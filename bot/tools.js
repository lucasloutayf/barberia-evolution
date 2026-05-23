// Funciones expuestas al LLM como "tools" (function calling estilo OpenAI).
// Cada una valida sus inputs (no confía en el modelo) y devuelve { ok, data?, error? }.

import { createHmac, randomUUID } from 'crypto';
import { SERVICES, findServiceByNombre, findServiceFuzzy } from './config.js';
import {
  generateAllSlots, slotsForService, hasCollision,
  validateFecha, validateHora, dayOfWeekFor, todayISO, currentTZMinutes,
} from './slots.js';
import {
  listActivasByFecha, insertReserva, updateReserva, cancelReserva,
  findById, findFuturasByTelefono,
} from './supabase.js';
import { buildConfirmacion } from './format.js';

// ---------- Helpers ----------

function generateToken(reservaId) {
  const secret = process.env.TOKEN_SECRET;
  if (!secret) return null;
  return createHmac('sha256', secret).update(reservaId).digest('hex').slice(0, 32);
}

// ---------- Implementaciones ----------

export async function listar_servicios() {
  return {
    ok: true,
    data: SERVICES.map(s => ({
      nombre: s.nombre,
      duracion_min: s.duracion_min,
      precio_ars: s.precio,
    })),
  };
}

export async function consultar_disponibilidad({ fecha, servicio }) {
  const vf = validateFecha(fecha);
  if (!vf.ok) return { ok: false, error: vf.error };

  const svc = findServiceByNombre(servicio) || findServiceFuzzy(servicio);
  if (!svc) return { ok: false, error: `Servicio "${servicio}" no encontrado. Servicios válidos: ${SERVICES.map(s => s.nombre).join(', ')}.` };

  const dayOfWeek = dayOfWeekFor(fecha);
  const reservas = await listActivasByFecha(fecha);
  let horarios = slotsForService(svc.duracion_min, reservas, dayOfWeek);

  // Filter out past slots when booking for today (30-min buffer)
  if (fecha === todayISO()) {
    const cutoff = currentTZMinutes() + 30;
    horarios = horarios.filter(h => {
      const [hh, mm] = h.split(':').map(Number);
      return hh * 60 + mm > cutoff;
    });
  }

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
}

export async function crear_reserva({ nombre, telefono, servicio, fecha, hora, mensaje }) {
  if (!nombre || !nombre.trim()) return { ok: false, error: 'Falta el nombre del cliente.' };
  if (!telefono) return { ok: false, error: 'Falta el teléfono del cliente.' };

  const vf = validateFecha(fecha);
  if (!vf.ok) return { ok: false, error: vf.error };
  const dayOfWeek = dayOfWeekFor(fecha);
  const vh = validateHora(hora, dayOfWeek);
  if (!vh.ok) return { ok: false, error: vh.error };

  // Reject past slots when booking for today
  if (fecha === todayISO()) {
    const [hh, mm] = hora.split(':').map(Number);
    if (hh * 60 + mm <= currentTZMinutes() + 30) {
      return { ok: false, error: `La hora ${hora} ya pasó o está muy próxima. Elegí un horario con al menos 30 minutos de anticipación.` };
    }
  }

  const svc = findServiceByNombre(servicio) || findServiceFuzzy(servicio);
  if (!svc) return { ok: false, error: `Servicio "${servicio}" no existe.` };

  const reservas = await listActivasByFecha(fecha);
  if (hasCollision(hora, svc.duracion_min, reservas)) {
    const disponibles = slotsForService(svc.duracion_min, reservas, dayOfWeek);
    return {
      ok: false,
      error: `El horario ${hora} no está disponible para ${svc.nombre} (${svc.duracion_min} min). Horarios libres: ${disponibles.slice(0, 8).join(', ') || 'ninguno este día'}.`,
    };
  }

  const reservaId = randomUUID();
  const token = generateToken(reservaId);
  const reserva = await insertReserva({
    id: reservaId,
    nombre: nombre.trim(),
    telefono,
    servicio: svc.nombre,
    fecha,
    hora,
    mensaje: (mensaje || '').trim() || null,
    duracion_min: svc.duracion_min,
    estado: 'pendiente',
    recordatorio_enviado: false,
    confirmacion_enviada: true,
    ...(token ? { token } : {}),
  });

  return {
    ok: true,
    data: {
      id: reserva.id,
      nombre: reserva.nombre,
      servicio: reserva.servicio,
      fecha: reserva.fecha,
      hora: reserva.hora,
      duracion_min: reserva.duracion_min,
      precio_ars: svc.precio,
      estado: reserva.estado,
      mensaje_confirmacion: buildConfirmacion(reserva),
    },
  };
}

export async function ver_mis_reservas({ telefono }) {
  if (!telefono) return { ok: false, error: 'Falta el teléfono.' };
  const data = await findFuturasByTelefono(telefono);
  return {
    ok: true,
    data: data.map(r => ({
      id: r.id, fecha: r.fecha, hora: r.hora, servicio: r.servicio, estado: r.estado,
    })),
  };
}

export async function modificar_reserva({ id, nueva_fecha, nueva_hora }) {
  if (!id) return { ok: false, error: 'Falta el id de la reserva.' };
  const actual = await findById(id);
  if (!actual) return { ok: false, error: `No existe reserva con id ${id}.` };
  if (actual.estado === 'cancelada') return { ok: false, error: 'Esa reserva está cancelada, no se puede modificar.' };

  const fecha = nueva_fecha || actual.fecha;
  const hora = nueva_hora || actual.hora;

  const vf = validateFecha(fecha);
  if (!vf.ok) return { ok: false, error: vf.error };
  const dayOfWeek = dayOfWeekFor(fecha);
  const vh = validateHora(hora, dayOfWeek);
  if (!vh.ok) return { ok: false, error: vh.error };

  if (fecha === todayISO()) {
    const [hh, mm] = hora.split(':').map(Number);
    if (hh * 60 + mm <= currentTZMinutes() + 30) {
      return { ok: false, error: `La hora ${hora} ya pasó o está muy próxima.` };
    }
  }

  const duracion = actual.duracion_min || 30;
  const reservas = await listActivasByFecha(fecha);
  if (hasCollision(hora, duracion, reservas, id)) {
    const disponibles = slotsForService(duracion, reservas, dayOfWeek);
    return { ok: false, error: `${hora} no está disponible. Libres: ${disponibles.slice(0, 8).join(', ') || 'ninguno'}.` };
  }

  const updated = await updateReserva(id, { fecha, hora, recordatorio_enviado: false });
  return {
    ok: true,
    data: { id: updated.id, fecha: updated.fecha, hora: updated.hora, servicio: updated.servicio, estado: updated.estado },
  };
}

export async function cancelar_reserva({ id }) {
  if (!id) return { ok: false, error: 'Falta el id de la reserva.' };
  const actual = await findById(id);
  if (!actual) return { ok: false, error: `No existe reserva con id ${id}.` };
  if (actual.estado === 'cancelada') return { ok: true, data: { id, mensaje: 'Ya estaba cancelada.' } };

  const updated = await cancelReserva(id);
  return { ok: true, data: { id: updated.id, estado: updated.estado } };
}

// ---------- Declaraciones OpenAI-compatible (function calling) ----------

export const FUNCTION_DECLARATIONS = [
  {
    name: 'listar_servicios',
    description: 'Devuelve el catálogo de servicios del salón con nombre, duración en minutos y precio en pesos argentinos.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'consultar_disponibilidad',
    description: 'Devuelve los horarios de inicio disponibles para un servicio en una fecha dada, considerando la duración del servicio y los turnos ya reservados.',
    parameters: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'Fecha en formato YYYY-MM-DD.' },
        servicio: { type: 'string', description: 'Nombre exacto del servicio (ej: "Corte de cabello").' },
      },
      required: ['fecha', 'servicio'],
    },
  },
  {
    name: 'crear_reserva',
    description: 'Crea un nuevo turno. Debe llamarse SOLO después de confirmar todos los datos con el cliente.',
    parameters: {
      type: 'object',
      properties: {
        nombre:   { type: 'string', description: 'Nombre completo del cliente.' },
        telefono: { type: 'string', description: 'Teléfono del cliente (se obtiene del JID de WhatsApp).' },
        servicio: { type: 'string', description: 'Nombre exacto del servicio del catálogo.' },
        fecha:    { type: 'string', description: 'YYYY-MM-DD.' },
        hora:     { type: 'string', description: 'HH:MM en 24h.' },
        mensaje:  { type: 'string', description: 'Notas opcionales del cliente.' },
      },
      required: ['nombre', 'telefono', 'servicio', 'fecha', 'hora'],
    },
  },
  {
    name: 'ver_mis_reservas',
    description: 'Lista los turnos futuros no cancelados de un teléfono.',
    parameters: {
      type: 'object',
      properties: { telefono: { type: 'string' } },
      required: ['telefono'],
    },
  },
  {
    name: 'modificar_reserva',
    description: 'Cambia la fecha y/o hora de una reserva existente, re-validando disponibilidad.',
    parameters: {
      type: 'object',
      properties: {
        id:           { type: 'string', description: 'UUID de la reserva.' },
        nueva_fecha:  { type: 'string', description: 'YYYY-MM-DD (opcional).' },
        nueva_hora:   { type: 'string', description: 'HH:MM (opcional).' },
      },
      required: ['id'],
    },
  },
  {
    name: 'cancelar_reserva',
    description: 'Marca una reserva como cancelada.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
];

// Dispatcher: nombre de función → implementación.
export const TOOL_HANDLERS = {
  listar_servicios,
  consultar_disponibilidad,
  crear_reserva,
  ver_mis_reservas,
  modificar_reserva,
  cancelar_reserva,
};
