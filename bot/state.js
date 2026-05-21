// Estado de conversación por JID, en memoria + snapshot a disco.
// Sobrevive reinicios del proceso (no se pierde el nombre ni el historial reciente).

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const FILE = resolve(process.cwd(), 'state.json');
const MAX_HISTORY = 12;

const store = new Map(); // jid → { nombre, telefono, history: [{role, content}], updatedAt }
let dirty = false;
let saveTimer = null;

// Migra un mensaje del formato Gemini al formato OpenAI (Cerebras/compatibles).
function migrateMsg(msg) {
  if (typeof msg.content === 'string') return msg; // ya es el formato nuevo
  const text = Array.isArray(msg.parts)
    ? (msg.parts[0]?.text ?? '')
    : (msg.content ?? '');
  const role = msg.role === 'model' ? 'assistant' : msg.role;
  return { role, content: text };
}

export async function loadState() {
  try {
    const raw = await readFile(FILE, 'utf8');
    const obj = JSON.parse(raw);
    let lidCleaned = 0;
    for (const [jid, entry] of Object.entries(obj)) {
      // Migrar historial en formato Gemini si hace falta.
      if (Array.isArray(entry.history)) {
        entry.history = entry.history.map(migrateMsg);
      }
      // Migración LID: las versiones viejas guardaban el LID como "telefono"
      // (ej: "73341247467574"). Eso es un alias interno de WhatsApp, NO un
      // teléfono. Si la clave es @lid y el teléfono guardado coincide con la
      // parte local del LID, lo nulificamos: el bot lo va a pedir de nuevo
      // (o lo va a sacar de m.key.remoteJidAlt en Baileys 7).
      if (jid.endsWith('@lid') && entry.telefono && entry.telefono === jid.split('@')[0]) {
        entry.telefono = null;
        lidCleaned++;
      }
      store.set(jid, entry);
    }
    console.log(`[state] cargado: ${store.size} conversaciones${lidCleaned ? ` (${lidCleaned} con teléfono LID inválido limpiado)` : ''}`);
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[state] error leyendo state.json:', err.message);
  }
}

export async function saveStateNow() {
  if (!dirty) return;
  const obj = Object.fromEntries(store.entries());
  try {
    await writeFile(FILE, JSON.stringify(obj, null, 2), 'utf8');
    dirty = false;
  } catch (err) {
    console.warn('[state] error escribiendo state.json:', err.message);
  }
}

function scheduleSave() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveStateNow();
  }, 2000);
}

// Convierte JID de WhatsApp ("5493511234567@s.whatsapp.net") a teléfono ("5493511234567").
// Para JIDs "@lid" devuelve null: el LID NO es el teléfono real, es un alias
// interno de WhatsApp. Quien resuelve el teléfono real es whatsapp.js a partir
// de m.key.remoteJidAlt (Baileys 7+) o del evento contacts.upsert.
export function jidToTelefono(jid) {
  const j = String(jid || '');
  if (!j || j.endsWith('@lid')) return null;
  return j.split('@')[0] || null;
}

export function getOrInit(jid) {
  let entry = store.get(jid);
  if (!entry) {
    entry = {
      nombre: null,
      telefono: jidToTelefono(jid),
      history: [],
      updatedAt: new Date().toISOString(),
    };
    store.set(jid, entry);
    scheduleSave();
  }
  return entry;
}

// Llamado por whatsapp.js cuando WhatsApp nos da el JID real (con teléfono)
// asociado a un alias @lid. Migra la conversación al JID real y popula el
// teléfono, así futuras reservas guardan el número correcto en Supabase.
export function setRealJid(lidJid, realJid) {
  if (!lidJid || !realJid || lidJid === realJid) return;
  if (!lidJid.endsWith('@lid')) return;
  const telefono = realJid.split('@')[0] || null;
  if (!telefono) return;

  const existing = store.get(lidJid);
  const target = store.get(realJid) || existing || {
    nombre: null,
    telefono,
    history: [],
    updatedAt: new Date().toISOString(),
  };

  // Si había estado bajo el LID y NO bajo el real, lo mudamos.
  if (existing && !store.has(realJid)) {
    store.delete(lidJid);
    store.set(realJid, existing);
  }

  target.telefono = telefono;
  target.updatedAt = new Date().toISOString();
  scheduleSave();
}

export function setNombre(jid, nombre) {
  const entry = getOrInit(jid);
  entry.nombre = (nombre || '').trim() || null;
  entry.updatedAt = new Date().toISOString();
  scheduleSave();
}

// Normaliza la entrada del cliente a dígitos. Argentina-friendly:
//   "351 304 2203"  → "5493513042203" (10 dig → prefijar 549)
//   "+54 9 351 304 2203" / "5493513042203" → "5493513042203"
//   "03513042203"   → "5493513042203" (11 dig con 0 inicial → 549 + resto)
//   "543513042203"  → "5493513042203" (12 dig "54xxx" → insertar 9)
// Devuelve null si no parece un número válido (longitud final fuera de 10-15).
export function cleanPhone(input) {
  if (!input) return null;
  let digits = String(input).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) digits = '549' + digits;
  else if (digits.length === 11 && digits.startsWith('0')) digits = '549' + digits.slice(1);
  else if (digits.length === 12 && digits.startsWith('54') && digits[2] !== '9') digits = '549' + digits.slice(2);
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

// Persiste el teléfono del cliente bajo este JID. Devuelve el teléfono limpio
// que quedó guardado, o null si la entrada no se pudo parsear.
export function setTelefono(jid, phone) {
  const clean = cleanPhone(phone);
  if (!clean) return null;
  const entry = getOrInit(jid);
  entry.telefono = clean;
  entry.updatedAt = new Date().toISOString();
  scheduleSave();
  return clean;
}

// role: 'user' | 'assistant' — content: string
export function appendHistory(jid, role, content) {
  const entry = getOrInit(jid);
  entry.history.push({ role, content });
  if (entry.history.length > MAX_HISTORY) {
    entry.history.splice(0, entry.history.length - MAX_HISTORY);
  }
  entry.updatedAt = new Date().toISOString();
  scheduleSave();
}

export function getHistory(jid) {
  return getOrInit(jid).history;
}

export function resetHistory(jid) {
  const entry = getOrInit(jid);
  entry.history = [];
  scheduleSave();
}

// Converts a human phone string to a WhatsApp JID.
// input: "351 304 2203", "+5493513042203", etc.
// returns: "5493513042203@s.whatsapp.net" or null if the input isn't a valid phone.
// Distinct from cleanPhone() which returns only digits.
export function normalizePhoneToJid(input) {
  const phone = cleanPhone(input);
  return phone ? `${phone}@s.whatsapp.net` : null;
}

// Cierre limpio del proceso → flush a disco.
process.on('SIGINT', async () => {
  await saveStateNow();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await saveStateNow();
  process.exit(0);
});
