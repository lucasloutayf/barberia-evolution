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

// Exposes the raw client for Realtime subscriptions in confirmaciones.js.
export function getClient() { return sb; }

// Atomic claim: sets confirmacion_enviada=true only if it's currently false.
// Returns true if this call claimed the row (safe to send), false if already claimed.
export async function markConfirmacionEnviada(id) {
  const { data, error } = await sb
    .from(TABLE)
    .update({ confirmacion_enviada: true })
    .eq('id', id)
    .eq('confirmacion_enviada', false)
    .select('id');
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

// Returns reservas created in the last 24 hours that haven't been claimed yet.
// Used by the startup scan in confirmaciones.js to catch events missed while the bot was down.
export async function pendingConfirmaciones() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from(TABLE)
    .select('*')
    .eq('confirmacion_enviada', false)
    .gte('created_at', cutoff);
  if (error) throw error;
  return data ?? [];
}
