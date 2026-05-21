import { getSock } from './whatsapp.js';
import { normalizePhoneToJid } from './state.js';
import { getClient, markConfirmacionEnviada, pendingConfirmaciones } from './supabase.js';
import { buildConfirmacion } from './format.js';
import { ADMIN_JID } from './config.js';

async function notificarAdmin(texto) {
  if (!ADMIN_JID) { console.error('[confirmaciones]', texto); return; }
  try {
    await getSock().sendMessage(ADMIN_JID, { text: texto });
  } catch (err) {
    console.error('[confirmaciones] fallo notificando admin:', err.message);
  }
}

async function sendConfirmacion(reserva) {
  // Atomic claim: if this returns false, another process already claimed the row.
  const claimed = await markConfirmacionEnviada(reserva.id);
  if (!claimed) return;

  const jid = normalizePhoneToJid(reserva.telefono);
  if (!jid) {
    await notificarAdmin(
      `⚠️ Confirmación no enviada: teléfono inválido en reserva ${reserva.id} ("${reserva.telefono}")`
    );
    return;
  }

  try {
    await getSock().sendMessage(jid, { text: buildConfirmacion(reserva) });
    console.log(`[confirmaciones] confirmación enviada a ${reserva.telefono} (reserva ${reserva.id})`);
  } catch (err) {
    console.error(`[confirmaciones] fallo enviando a ${jid}:`, err.message);
    await notificarAdmin(
      `⚠️ Confirmación no enviada a ${reserva.telefono} (reserva ${reserva.id}): ${err.message}`
    );
  }
}

export async function startConfirmaciones() {
  // Realtime: fires on every INSERT. Ignores rows where confirmacion_enviada=true
  // (those come from the WhatsApp bot, which sends the message inline).
  getClient()
    .channel('confirmaciones-insert')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reservas' }, (payload) => {
      if (payload.new?.confirmacion_enviada) return;
      sendConfirmacion(payload.new).catch((err) =>
        console.error('[confirmaciones] error en handler Realtime:', err)
      );
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') console.log('[confirmaciones] Realtime activo');
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
        console.error(`[confirmaciones] Realtime status: ${status}`);
    });

  // Startup scan: covers reservas created while the bot was down (last 24h).
  try {
    const pending = await pendingConfirmaciones();
    if (pending.length) {
      console.log(`[confirmaciones] startup scan: ${pending.length} confirmación/es pendiente/s`);
      for (const r of pending) await sendConfirmacion(r);
    }
  } catch (err) {
    console.error('[confirmaciones] error en startup scan:', err);
  }

  console.log('[confirmaciones] activo');
}
