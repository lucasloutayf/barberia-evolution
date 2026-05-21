import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const FILE = resolve(process.cwd(), 'blocklist.json');

const RATE_60S   = 8;    // max messages per 60s window
const RATE_10S   = 3;    // max messages per 10s window (burst)
const QUEUE_MAX  = 4;    // max pending messages per JID
const MSG_MAX_LEN = 1000;

const windows         = new Map(); // jid → { ts60: number[], ts10: number[] }
const queueDepth      = new Map(); // jid → number
const warnedRateLimit = new Set(); // JIDs that received a rate-limit warning this session
const warnedQueueFull = new Set(); // JIDs that received a queue-full warning this session
const blocked         = new Set(); // JIDs blocked (mirror of blocklist.json)
const blockedMeta     = new Map(); // jid → { blockedAt: string }

let dirty     = false;
let saveTimer = null;

export async function load() {
  try {
    const raw = await readFile(FILE, 'utf8');
    const { blocked: list } = JSON.parse(raw);
    if (Array.isArray(list)) {
      for (const e of list) {
        if (!e?.jid) continue;
        blocked.add(e.jid);
        blockedMeta.set(e.jid, { blockedAt: e.blockedAt });
      }
    }
    console.log(`[guard] blocklist cargada: ${blocked.size} bloqueados`);
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[guard] error leyendo blocklist.json:', err.message);
  }
}

function scheduleSave() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    if (!dirty) return;
    const arr = [...blocked].map(jid => ({
      jid,
      blockedAt: blockedMeta.get(jid)?.blockedAt ?? new Date().toISOString(),
    }));
    try {
      await writeFile(
        FILE,
        JSON.stringify({ blocked: arr, updatedAt: new Date().toISOString() }, null, 2),
        'utf8',
      );
      dirty = false;
    } catch (err) {
      console.warn('[guard] error escribiendo blocklist.json:', err.message);
    }
  }, 2000);
}

export async function saveNow() {
  if (!dirty) return;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  const arr = [...blocked].map(jid => ({
    jid,
    blockedAt: blockedMeta.get(jid)?.blockedAt ?? new Date().toISOString(),
  }));
  try {
    await writeFile(
      FILE,
      JSON.stringify({ blocked: arr, updatedAt: new Date().toISOString() }, null, 2),
      'utf8',
    );
    dirty = false;
  } catch (err) {
    console.warn('[guard] error escribiendo blocklist.json:', err.message);
  }
}

export function isBlocked(jid) {
  return blocked.has(jid);
}

export function blockJid(jid) {
  blocked.add(jid);
  blockedMeta.set(jid, { blockedAt: new Date().toISOString() });
  scheduleSave();
}

export function unblockJid(jid) {
  blocked.delete(jid);
  blockedMeta.delete(jid);
  scheduleSave();
}

export function listBlocked() {
  return [...blocked].map(jid => ({
    jid,
    blockedAt: blockedMeta.get(jid)?.blockedAt ?? null,
  }));
}

function checkRateLimit(jid) {
  const now = Date.now();
  let win = windows.get(jid);
  if (win) {
    win.ts60 = win.ts60.filter(t => now - t < 60_000);
    win.ts10 = win.ts10.filter(t => now - t < 10_000);
    if (win.ts60.length === 0 && win.ts10.length === 0) {
      windows.delete(jid);
      win = null;
    }
  }
  if (!win) {
    win = { ts60: [], ts10: [] };
    windows.set(jid, win);
  }

  win.ts60.push(now);
  win.ts10.push(now);

  return win.ts60.length > RATE_60S || win.ts10.length > RATE_10S;
}

function tryQueueEnter(jid) {
  const d = queueDepth.get(jid) ?? 0;
  if (d >= QUEUE_MAX) return false;
  queueDepth.set(jid, d + 1);
  return true;
}

export function queueDecrement(jid) {
  const d = queueDepth.get(jid) ?? 0;
  if (d <= 1) queueDepth.delete(jid);
  else queueDepth.set(jid, d - 1);
}

export function sanitizeText(text) {
  const t = String(text ?? '');
  return t.length > MSG_MAX_LEN ? t.slice(0, MSG_MAX_LEN) : t;
}

export function check(jid, rawText) {
  if (blocked.has(jid)) {
    return { allowed: false, reason: 'blocked', firstOffense: false };
  }

  if (checkRateLimit(jid)) {
    const firstOffense = !warnedRateLimit.has(jid);
    if (firstOffense) warnedRateLimit.add(jid);
    return { allowed: false, reason: 'rate_limit', firstOffense };
  }

  if (!tryQueueEnter(jid)) {
    const firstOffense = !warnedQueueFull.has(jid);
    if (firstOffense) warnedQueueFull.add(jid);
    return { allowed: false, reason: 'queue_full', firstOffense };
  }

  return { allowed: true, text: sanitizeText(rawText) };
}

// ─── Test helpers ────────────────────────────────────────────────────────────
// These are only for use in test-guard.js. Never call from production code.

export function _reset() {
  windows.clear();
  queueDepth.clear();
  warnedRateLimit.clear();
  warnedQueueFull.clear();
  blocked.clear();
  blockedMeta.clear();
  dirty = false;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
}

export function _setQueueDepth(jid, depth) {
  if (depth <= 0) queueDepth.delete(jid);
  else queueDepth.set(jid, depth);
}

process.on('SIGINT', async () => { await saveNow(); });
process.on('SIGTERM', async () => { await saveNow(); });
