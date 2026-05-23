// Entrypoint del bot: carga .env, restaura estado, conecta WhatsApp, arranca cron.
// IMPORTANTE: usamos dynamic imports para los módulos del bot porque varios
// (supabase.js, agent.js) leen process.env en su top-level y necesitamos que
// dotenv haya cargado primero. Los `import` de ESM son hoisted, así que un
// `import` estático correría ANTES que dotenv.config().

import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

// Cargamos el .env desde la raíz del repo (compartido con el frontend Vite).
// Si preferís un .env propio en bot/, dejalo ahí: tiene precedencia.
const localEnv = resolve(process.cwd(), '.env');
const rootEnv  = resolve(process.cwd(), '..', '.env');
if (existsSync(localEnv))     dotenv.config({ path: localEnv });
else if (existsSync(rootEnv)) dotenv.config({ path: rootEnv });
else                          dotenv.config();

if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Falta configurar VITE_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en .env');
  process.exit(1);
}
if (!process.env.AI_API_KEY) {
  console.error('Falta configurar AI_API_KEY en .env (https://cloud.cerebras.ai)');
  process.exit(1);
}
{
  const k = process.env.AI_API_KEY;
  console.log(`[env] AI_API_KEY cargada: ${k.slice(0, 6)}...${k.slice(-4)} (${k.length} chars)`);
}
if (!process.env.ADMIN_JID) {
  console.warn('[warn] ADMIN_JID no configurado: los comandos /turnos y /cancelar no van a funcionar.');
}

const { loadState }           = await import('./state.js');
const { load: loadGuard }     = await import('./guard.js');
const { connectToWhatsApp }   = await import('./whatsapp.js');
const { startScheduler }      = await import('./scheduler.js');
const { startResenas }        = await import('./resenas.js');
const { startConfirmaciones } = await import('./confirmaciones.js');

try {
  await loadState();
  await loadGuard();
  await connectToWhatsApp();
  startScheduler();
  startResenas();
  await startConfirmaciones();
} catch (err) {
  console.error('[fatal]', err);
  process.exit(1);
}
