// Conexión a WhatsApp vía Baileys 7.x. Sigue el patrón documentado en
// .claude/skills/whatsapp-bayleis/SKILL.md (QR manual, reconexión automática,
// persistencia multi-archivo).

// Baileys 7 exporta makeWASocket como default export "limpio" (en 6.x había
// que destructurar .default del module.exports). El resto son named exports.
import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from 'baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import pino from 'pino';

import { handleMessage, ProviderBusyError } from './agent.js';
import { setRealJid } from './state.js';
import * as guard from './guard.js';
import { TZ, horasForDay, isClosedDay, formatHorario } from './config.js';

function isWithinBusinessHours() {
  const local = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
  const day = local.getDay();
  if (isClosedDay(day)) return false;
  const hhmm = `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`;
  return horasForDay(day).some(f => hhmm >= f.apertura && hhmm <= f.cierre);
}

const CLOSED_COOLDOWN_MS = 60 * 60 * 1000; // 1 hora
const closedNotifiedAt = new Map(); // jid -> timestamp de último aviso de cerrado

let sockInstance = null;

// Resolvers waiting for the first successful connection.
let _connectedResolvers = [];
export function waitForConnected() {
  if (sockInstance && _connectedResolvers === null) return Promise.resolve();
  return new Promise(resolve => { _connectedResolvers.push(resolve); });
}

// Cola por JID: si un usuario manda 3 mensajes seguidos, los procesamos uno a
// uno (no en paralelo). Sin esto, varios handleMessage corren a la vez para
// el mismo cliente, hammerean Cerebras (más 429s) y pelean por el state.
const inflight = new Map();
function enqueueFor(jid, fn) {
  const prev = inflight.get(jid) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  inflight.set(jid, next);
  next.finally(() => { if (inflight.get(jid) === next) inflight.delete(jid); });
  return next;
}

// Cuentas nuevas de WhatsApp se dirigen a sí mismas con JIDs "@lid"
// (alias interno) en vez de "@s.whatsapp.net". En Baileys 7.x el mensaje
// trae `key.remoteJidAlt` con el JID alternativo (el de teléfono real cuando
// el primario es @lid, o viceversa) — esa es la fuente PRIMARIA para
// reconstruir el número del cliente.
//
// Fallback: el evento `contacts.upsert` también provee la asociación
// LID → JID real, así que mantenemos un mapa por si remoteJidAlt llegara vacío.
const lidMap = new Map();

// Dado el JID que viene en m.key, devuelve el JID que prefiramos persistir
// (siempre el de teléfono real cuando esté disponible).
function preferPhoneJid(remoteJid, remoteJidAlt) {
  if (remoteJid && !remoteJid.endsWith('@lid')) return remoteJid;
  if (remoteJidAlt && !remoteJidAlt.endsWith('@lid')) return remoteJidAlt;
  if (remoteJid?.endsWith('@lid') && lidMap.has(remoteJid)) return lidMap.get(remoteJid);
  return remoteJid; // peor caso: queda el @lid (el agente pedirá el teléfono).
}

export function getSock() {
  if (!sockInstance) throw new Error('WhatsApp aún no está conectado');
  return sockInstance;
}

function extractText(m) {
  return (
    m.message?.conversation ||
    m.message?.extendedTextMessage?.text ||
    m.message?.imageMessage?.caption ||
    m.message?.videoMessage?.caption ||
    ''
  );
}

export async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  // Pedimos al server la versión actual del protocolo Web. Sin esto, Baileys
  // identifica al cliente con una versión hard-codeada que WhatsApp suele
  // marcar como obsoleta → cierra el WS con código 405 (Method Not Allowed).
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`[whatsapp] usando protocolo WA v${version.join('.')} (latest=${isLatest})`);

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'warn' }),
    // Browsers.macOS('Desktop') produce el user-agent que WhatsApp acepta sin
    // marcar como "cliente sospechoso". Browser tuples custom suelen disparar
    // el error "Revisa tu conexión y vuelve a intentarlo" al escanear el QR.
    browser: Browsers.macOS('Desktop'),
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n[whatsapp] Escaneá el QR desde WhatsApp > Dispositivos vinculados:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error
        ? (lastDisconnect.error instanceof Boom
            ? lastDisconnect.error.output?.statusCode
            : lastDisconnect.error?.output?.statusCode)
        : null;
      const isReplaced = statusCode === DisconnectReason.connectionReplaced || statusCode === 440;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      const shouldReconnect = !isLoggedOut && !isReplaced;
      console.log(`[whatsapp] conexión cerrada (code=${statusCode}). Reconectar: ${shouldReconnect}`);
      if (isReplaced) {
        console.log('[whatsapp] CONFLICTO: otra sesión ya está activa con este número.');
        console.log('[whatsapp] Cerrá WhatsApp Web en el navegador y cualquier otra instancia del bot, luego reiniciá.');
      } else if (isLoggedOut) {
        console.log('[whatsapp] sesión cerrada. Borrá auth_info_baileys/ y reiniciá para vincular un nuevo número.');
      } else if (shouldReconnect) {
        setTimeout(() => { connectToWhatsApp().catch(console.error); }, 2000);
      }
    } else if (connection === 'open') {
      console.log('[whatsapp] conexión establecida.');
      if (Array.isArray(_connectedResolvers)) {
        _connectedResolvers.forEach(r => r());
        _connectedResolvers = null; // signal: already connected
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // Construir mapa LID → JID real para resolver números correctamente.
  sock.ev.on('contacts.upsert', (contacts) => {
    for (const c of contacts) {
      if (c.lid && c.id) lidMap.set(c.lid, c.id);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const m of messages) {
      if (m.key.fromMe) continue;
      const lidJid = m.key.remoteJid?.endsWith('@lid') ? m.key.remoteJid : null;
      const from = preferPhoneJid(m.key.remoteJid, m.key.remoteJidAlt);
      if (!from || from.endsWith('@g.us') || from.endsWith('@broadcast')) continue; // ignorar grupos/broadcast

      // Si recibimos el JID real por remoteJidAlt, lo asociamos con el LID en
      // memoria y en el state (para que reservas posteriores tengan el número
      // correcto aunque la conversación se haya iniciado con @lid).
      if (lidJid && from !== lidJid) {
        lidMap.set(lidJid, from);
        setRealJid(lidJid, from);
      }

      const rawText = extractText(m).trim();
      if (!rawText) continue;

      const { allowed, reason, firstOffense, text } = guard.check(from, rawText);
      if (!allowed) {
        if (firstOffense && reason !== 'blocked') {
          const warnMsg = reason === 'rate_limit'
            ? 'Estás mandando muchos mensajes seguidos. Esperá un momento antes de escribir de nuevo.'
            : 'Hay varios mensajes tuyos en espera. Esperá a que los procese antes de mandar más.';
          await sock.sendMessage(from, { text: warnMsg }).catch(() => {});
        }
        continue;
      }

      // Serializamos por JID: si llegan varios mensajes del mismo cliente,
      // se procesan uno tras otro (no en paralelo). NO esperamos esta promesa
      // acá para no bloquear la cola global de Baileys con un único cliente
      // lento.
      if (text.startsWith('/')) continue;

      if (!isWithinBusinessHours()) {
        const lastNotified = closedNotifiedAt.get(from) || 0;
        if (Date.now() - lastNotified > CLOSED_COOLDOWN_MS) {
          closedNotifiedAt.set(from, Date.now());
          await sock.sendMessage(from, {
            text: `El salón está cerrado en este momento 🌙\nNuestro horario:\n${formatHorario()}\n¡Escribinos en horario y te atendemos enseguida!`,
          }).catch(() => {});
        }
        guard.queueDecrement(from);
        continue;
      } 

      enqueueFor(from, async () => {
        try {
          // Rama cliente: lenguaje natural via LLM
          await sock.sendPresenceUpdate('composing', from).catch(() => {});
          const reply = await handleMessage(from, text);
          await sock.sendMessage(from, { text: reply });
        } catch (err) {
          console.error('[whatsapp] ERROR procesando mensaje de', from);
          console.error('  texto recibido:', JSON.stringify(text));
          console.error('  mensaje del error:', err?.message || err);
          console.error('  stack:', err?.stack);
          if (err?.response) console.error('  response:', JSON.stringify(err.response).slice(0, 500));

          const userMsg = err instanceof ProviderBusyError
            ? 'Estoy con mucha demanda en este momento, disculpá. ¿Podés volver a escribirme en un minuto?'
            : 'Uy, algo falló de nuestro lado. ¿Podés intentar de vuelta en un ratito?';
          try {
            await sock.sendMessage(from, { text: userMsg });
          } catch {}
        } finally {
          guard.queueDecrement(from);
        }
      });
    }
  });

  sockInstance = sock;
  return sock;
}
