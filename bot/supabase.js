// Wrapper de Supabase usando service_role (bypasea RLS).
// IMPORTANTE: nunca exponer este cliente al frontend.

import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error(
    'Faltan VITE_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env (el bot necesita la service_role key, no la anon).'
  );
}

export const sb = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TABLE = 'reservas';

export async function listByFecha(fecha) {
  const { data, error } = await sb
    .from(TABLE)
    .select('*')
    .eq('fecha', fecha)
    .order('hora', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function listActivasByFecha(fecha) {
  const { data, error } = await sb
    .from(TABLE)
    .select('*')
    .eq('fecha', fecha)
    .neq('estado', 'cancelada')
    .order('hora', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function findById(id) {
  const { data, error } = await sb.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function findFuturasByTelefono(telefono) {
  const hoy = new Date().toISOString().slice(0, 10);
  const { data, error } = await sb
    .from(TABLE)
    .select('*')
    .eq('telefono', telefono)
    .neq('estado', 'cancelada')
    .gte('fecha', hoy)
    .order('fecha', { ascending: true })
    .order('hora', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function insertReserva(row) {
  const { data, error } = await sb.from(TABLE).insert(row).select('*').single();
  if (error) throw error;
  return data;
}

export async function updateReserva(id, patch) {
  const { data, error } = await sb.from(TABLE).update(patch).eq('id', id).select('*').single();
  if (error) throw error;
  return data;
}

export async function cancelReserva(id) {
  return updateReserva(id, { estado: 'cancelada' });
}

// Recordatorios: reservas no canceladas, sin recordatorio enviado, cuya fecha
// está dentro del rango [fechaIni, fechaFin]. El filtro fino por hora se hace
// arriba (en scheduler.js) porque Supabase no permite comparar fecha+hora juntos.
export async function pendingReminders(fechaIni, fechaFin) {
  const { data, error } = await sb
    .from(TABLE)
    .select('*')
    .neq('estado', 'cancelada')
    .eq('recordatorio_enviado', false)
    .gte('fecha', fechaIni)
    .lte('fecha', fechaFin);
  if (error) throw error;
  return data || [];
}

export async function markReminderSent(id) {
  return updateReserva(id, { recordatorio_enviado: true });
}
