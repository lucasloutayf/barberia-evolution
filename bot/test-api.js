// Test directo a la API sin pasar por el bot.
// Correr con: node bot/test-api.js
import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const localEnv = resolve(process.cwd(), '.env');
const rootEnv  = resolve(process.cwd(), '..', '.env');
if (existsSync(localEnv))     dotenv.config({ path: localEnv });
else if (existsSync(rootEnv)) dotenv.config({ path: rootEnv });
else                          dotenv.config();

import OpenAI from 'openai';

const baseURL = process.env.AI_BASE_URL || 'https://api.cerebras.ai/v1';
const model   = process.env.AI_MODEL    || 'llama3.1-8b';
const apiKey  = process.env.AI_API_KEY;

console.log(`Testeando: ${baseURL} | modelo: ${model}`);
console.log('Enviando mensaje...');
const start = Date.now();

const client = new OpenAI({ apiKey, baseURL, timeout: 30_000 });

try {
  const res = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: 'respondé solo "ok"' }],
    max_tokens: 10,
  });
  const ms = Date.now() - start;
  console.log(`✓ Respondió en ${ms}ms: "${res.choices[0].message.content}"`);
} catch (err) {
  const ms = Date.now() - start;
  console.error(`✗ Falló en ${ms}ms: ${err.message}`);
}
