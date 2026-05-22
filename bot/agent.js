// Cliente OpenAI-compatible (Cerebras, Groq, Together, etc.) con function calling.
// API estilo OpenAI (tools = [{ type: 'function', function: {...} }]).

import OpenAI from 'openai';
import { SERVICES, BOOKING_WINDOW_DAYS, BUSINESS_HOURS, TZ } from './config.js';
import { todayISO } from './slots.js';
import { FUNCTION_DECLARATIONS, TOOL_HANDLERS } from './tools.js';
import {
  getOrInit, appendHistory, getHistory, setNombre, setTelefono,
} from './state.js';
import cfg from '../barberia.config.js';

const MODEL_NAME = process.env.AI_MODEL || 'qwen-3-235b-a22b-instruct-2507';
// Fallback opcional: si el modelo primario está saturado (429/503) tras todos
// los reintentos, intentamos UNA vez con este modelo de respaldo antes de
// fallar. Dejar vacío para deshabilitar.
const MODEL_FALLBACK = process.env.AI_MODEL_FALLBACK || '';
const apiKey = process.env.AI_API_KEY;
const baseURL = process.env.AI_BASE_URL || 'https://api.openai.com/v1';

if (!apiKey) {
  throw new Error('Falta AI_API_KEY en .env');
}

const client = new OpenAI({ apiKey, baseURL, timeout: 60_000 });
console.log(`[agent] proveedor: ${baseURL} | modelo primario: ${MODEL_NAME}${MODEL_FALLBACK ? ` | fallback: ${MODEL_FALLBACK}` : ''}`);

function buildSystemPrompt(entry) {
  const catalogoTxt = SERVICES
    .map(s => `- ${s.nombre} · ${s.duracion_min} min · $${s.precio.toLocaleString('es-AR')}`)
    .join('\n');

  const nombreInfo = entry.nombre
    ? `El cliente se llama ${entry.nombre}. NO le preguntes el nombre de nuevo.`
    : `Aún no sabés el nombre del cliente. La primera vez que mencione querer reservar, preguntale: "¿A nombre de quién reservo?". Cuando te lo diga, guardalo (el sistema lo persiste).`;

  const telefonoInfo = entry.telefono
    ? `- Teléfono: ${entry.telefono} (úsalo en TODAS las tools que pidan teléfono — el sistema ya lo tiene, NO se lo pidas al cliente).`
    : `- Teléfono: AÚN NO LO TENÉS. WhatsApp no nos lo expuso por su sistema interno. ANTES de llamar a "crear_reserva", pediselo al cliente UNA sola vez, en formato internacional sin "+" (ej: "5493513042203"). Cuando te lo diga, pasalo como argumento "telefono" a la tool y el sistema lo persiste.`;

  return `Te llamas ${cfg.bot.nombre} y sos la recepcionista que atiende el WhatsApp de ${cfg.nombre}, un salón en ${cfg.ubicacion}. Tomás turnos, respondés preguntas sobre precios y horarios, y ayudás con cancelaciones o cambios — todo por este chat. Escribís como cualquier persona en Argentina que atiende el WhatsApp de un negocio: rioplatense, directo, sin pasarte de formal ni de informal. Usás "vos", nunca "tú". Mensajes cortos — esto es WhatsApp, no un mail. Nada de listas numeradas ni bloques de texto.

Si alguien te pregunta si sos un bot o una IA, decís que no, que sos la recepcionista del salón.

Lo que ofrecemos:
${catalogoTxt}

Horario: lunes a sábado de ${BUSINESS_HOURS.start} a ${BUSINESS_HOURS.end} hs. Los domingos cerramos.
Los turnos son cada ${BUSINESS_HOURS.stepMin} minutos. Se puede reservar desde mañana hasta ${BOOKING_WINDOW_DAYS} días adelante.
Hoy es ${todayISO()} (Argentina, ${TZ}).

${telefonoInfo}
${nombreInfo}

Para sacar un turno necesitás saber el servicio, el día y la hora. Si falta algo, preguntá de a una cosa — no hagas preguntas múltiples en el mismo mensaje. Cuando empieces, saludá.

Antes de ofrecer horarios, consultá siempre disponibilidad real con "consultar_disponibilidad" — nunca inventes slots.

Antes de confirmar el turno, preguntá brevemente si quieren agregar alguna nota (preferencia de estilo, alergia a algún producto). Si no quieren, seguís. Preguntalo solo una vez.

OJO — nunca le digas al cliente que el turno está confirmado, creado o agendado sin antes haber llamado a "crear_reserva" en este turno y recibido { ok: true }. Si el cliente ya dijo que sí ("dale", "perfecto", "sí", "bueno"), tu próxima acción es llamar la tool — no escribirle nada antes. Solo después de ver { ok: true } le avisás con los datos del turno.

Para fechas como "mañana" o "el sábado que viene", convertí a YYYY-MM-DD con la fecha de hoy de arriba. Para cancelar o cambiar, usá primero "ver_mis_reservas" para conseguir el id.

Si el teléfono ya está cargado, usalo directo en las tools sin pedírselo al cliente. Si una tool devuelve error, explicalo con naturalidad y ofrecé una alternativa.

Cuando confirmás un turno, decile: el día con fecha (ej: "sábado 24/05"), la hora, el servicio, cuánto dura y el precio.

Si preguntan algo que no tiene nada que ver con el salón, deciles tranquilamente que por acá solo manejás lo del salón.`;
}

// Adapta FUNCTION_DECLARATIONS al formato OpenAI (Cerebras/compatibles).
const TOOLS = FUNCTION_DECLARATIONS.map(d => ({
  type: 'function',
  function: {
    name: d.name,
    description: d.description,
    parameters: d.parameters, // ya está en JSON Schema estándar
  },
}));

// Error marcador: el proveedor está saturado tras agotar los reintentos.
// whatsapp.js lo detecta para enviarle al cliente un mensaje amable en vez
// del stack del SDK ("429 status code (no body)").
export class ProviderBusyError extends Error {
  constructor(cause) {
    super('provider_busy');
    this.name = 'ProviderBusyError';
    this.cause = cause;
  }
}

// Retry para errores transitorios (503/429/500). Cerebras devuelve 429 con
// code=queue_exceeded cuando el modelo está congestionado — la cola puede
// tardar 5-15s en drenar, así que el budget debe ser generoso. Jitter para
// que dos clientes concurrentes no reintenten en el mismo instante.
async function callWithRetry(fn, label = 'completion') {
  const maxAttempts = 5;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err?.status || err?.statusCode;
      const msg = err?.message || '';
      const isTimeout = !status && /timed?\s*out/i.test(msg);
      const isTransient = status === 503 || status === 429 || status === 500
        || /\b(503|429|500|unavailable|overloaded|rate|queue)\b/i.test(msg);
      if (!isTimeout && !isTransient) break;
      // Timeouts: máx 3 intentos (ya esperamos 60 s c/u — no tiene sentido más).
      // Rate limits / 5xx: hasta 5 intentos con backoff exponencial.
      const maxForThis = isTimeout ? 3 : maxAttempts;
      if (attempt >= maxForThis) break;
      const base = isTimeout ? 3000 : 1000 * Math.pow(2, attempt - 1);
      const wait = Math.round(base * (0.75 + Math.random() * 0.5));
      console.warn(`[agent] ${label} intento ${attempt}/${maxForThis} falló (${isTimeout ? 'timeout' : `status=${status}`} ${msg.slice(0, 80)}); reintento en ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  // Solo convertimos a ProviderBusyError los 429/503 (saturación real).
  const finalStatus = lastErr?.status || lastErr?.statusCode;
  if (finalStatus === 429 || finalStatus === 503) {
    throw new ProviderBusyError(lastErr);
  }
  throw lastErr;
}

// Heurística para capturar el nombre cuando el cliente lo da en lenguaje natural.
function maybeCaptureNombre(jid, userText, entry) {
  if (entry.nombre) return;
  const t = (userText || '').trim();
  if (!t) return;

  const patrones = [
    /(?:me llamo|mi nombre es|soy|habla)\s+([a-záéíóúñ][a-záéíóúñ\s]{1,40})/i,
  ];
  for (const re of patrones) {
    const m = t.match(re);
    if (m && m[1]) {
      setNombre(jid, m[1].trim());
      return;
    }
  }
  const lastBot = [...getHistory(jid)].reverse().find(h => h.role === 'assistant');
  const lastBotText = (lastBot?.content || '').toLowerCase();
  if (/(nombre|a nombre)/.test(lastBotText) && t.length <= 60 && /^[a-záéíóúñ\s\.\-]+$/i.test(t)) {
    setNombre(jid, t);
  }
}

// Patrones que el modelo usa cuando intenta "confirmar" una reserva.
// Si vemos esto en la respuesta final pero NO hubo un crear_reserva exitoso
// en este turno, es alucinación → forzamos reintento.
const CONFIRMATION_PATTERN = /\b(confirmad[oa]|reserva\s+(creada|confirmada|hecha|lista)|listo,?\s+(tu\s+)?(turno|reserva)|tenés\s+(tu\s+)?turno\s+(confirmado|reservado|listo|agendado)|qued[oa]\s+agendado|qued[oa]\s+reservado|reservado\s+para)\b/i;

// Maneja un mensaje entrante. Retorna el string de respuesta para mandar al cliente.
export async function handleMessage(jid, userText) {
  const entry = getOrInit(jid);
  maybeCaptureNombre(jid, userText, entry);

  // Mensajes acumulados durante este turno (NO los persistimos todos: solo el
  // texto final del usuario y la respuesta final del bot van al state).
  const messages = [
    { role: 'system', content: buildSystemPrompt(entry) },
    ...getHistory(jid),
    { role: 'user', content: userText },
  ];

  // Tracking de este turno: ¿se llamó crear_reserva con ok:true?
  // Sirve para detectar alucinaciones ("¡Confirmado!" sin tool call real).
  let reservaCreadaEsteTurno = false;
  let alreadyForcedRetry = false;

  // Loop de tool calling (límite duro).
  for (let iter = 0; iter < 6; iter++) {
    // 1) Intentamos el modelo primario con reintentos.
    // 2) Si tras los reintentos el primario sigue saturado (ProviderBusyError)
    //    y hay fallback configurado, intentamos UNA vez con el fallback.
    //    Esto le da al cliente una respuesta aunque qwen esté caído.
    const completionFn = (model) => () => client.chat.completions.create({
      model,
      messages,
      tools: TOOLS,
      tool_choice: 'auto',
      temperature: 0.65,
      max_tokens: 1024,
    });
    let completion;
    try {
      completion = await callWithRetry(completionFn(MODEL_NAME), `iter-${iter}`);
    } catch (err) {
      if (err instanceof ProviderBusyError && MODEL_FALLBACK) {
        console.warn(`[agent] primario ${MODEL_NAME} saturado tras reintentos; cayendo a fallback ${MODEL_FALLBACK}.`);
        completion = await callWithRetry(completionFn(MODEL_FALLBACK), `iter-${iter}-fb`);
      } else {
        throw err;
      }
    }

    const assistantMsg = completion.choices[0].message;
    // Push del assistant turn al historial local (necesario para que el modelo pueda referenciar tool_call_ids).
    messages.push({
      role: 'assistant',
      content: assistantMsg.content || null,
      tool_calls: assistantMsg.tool_calls,
    });

    const toolCalls = assistantMsg.tool_calls || [];
    if (toolCalls.length === 0) {
      const rawContent = (assistantMsg.content || '').trim();

      // Seguridad: el modelo a veces filtra tool calls como texto plano
      // (ej: "<function=nombre>{...}</function>"). Si detectamos ese patrón,
      // inyectamos un recordatorio y forzamos otra iteración en lugar de
      // enviarle ese texto al cliente.
      const leaksFunction = /<function=\w+>|\{\s*"fecha":|\{\s*"servicio":/.test(rawContent);
      if (leaksFunction) {
        console.warn('[agent] El modelo filtró un tool call como texto — forzando reintento.');
        // Reemplazamos el último assistant message con una corrección.
        messages[messages.length - 1] = {
          role: 'assistant',
          content: null,
        };
        messages.push({
          role: 'user',
          content: 'Por favor, usá las herramientas disponibles en vez de escribir el JSON a mano. Respondé al cliente directamente.',
        });
        continue;
      }

      // Guardia anti-alucinación: si el modelo dice "¡Confirmado!" / "reserva
      // creada" / etc. pero NO llamó a crear_reserva con ok:true en este turno,
      // está mintiendo (la reserva NO existe en la DB). Forzamos UN reintento
      // empujándolo a llamar la tool de verdad antes de cerrar el turno.
      if (!reservaCreadaEsteTurno && !alreadyForcedRetry && CONFIRMATION_PATTERN.test(rawContent)) {
        alreadyForcedRetry = true;
        console.warn('[agent] Posible alucinación: el modelo escribió una confirmación sin haber llamado crear_reserva. Forzando reintento.');
        messages.push({
          role: 'user',
          content: 'STOP — no confirmes la reserva sin antes haber llamado a la tool "crear_reserva" en este mismo turno y haber obtenido { ok: true } como respuesta. Llamala AHORA con los datos confirmados (nombre, teléfono, servicio, fecha YYYY-MM-DD, hora HH:MM). Si ya está creada y solo querés responderle al cliente, igual confirmá llamando primero la tool.',
        });
        continue;
      }

      // Respuesta final.
      const reply = rawContent || 'Uy, no te entendí bien. ¿Me lo podés contar de otra forma?';
      appendHistory(jid, 'user', userText);
      appendHistory(jid, 'assistant', reply);
      return reply;
    }

    // Ejecutar cada tool call.
    for (const call of toolCalls) {
      const fnName = call.function?.name;
      let args = {};
      let result;
      try {
        args = JSON.parse(call.function?.arguments || '{}');
      } catch (err) {
        result = { ok: false, error: `Argumentos JSON inválidos: ${err.message}` };
      }

      if (!result) {
        const handler = TOOL_HANDLERS[fnName];
        if (!handler) {
          result = { ok: false, error: `Tool desconocida: ${fnName}` };
        } else {
          try {
            if (fnName === 'crear_reserva') {
              // Si el modelo le pidió el teléfono al cliente y lo pasó por
              // argumento, normalizamos y lo persistimos para no preguntar otra vez.
              if (args.telefono) {
                const persisted = setTelefono(jid, args.telefono);
                if (persisted) {
                  args.telefono = persisted;
                  entry.telefono = persisted;
                }
              } else if (entry.telefono) {
                args.telefono = entry.telefono;
              }
              if (!args.nombre && entry.nombre) args.nombre = entry.nombre;
            }
            if (fnName === 'ver_mis_reservas' && !args.telefono && entry.telefono) {
              args.telefono = entry.telefono;
            }
            result = await handler(args);

            if (fnName === 'crear_reserva' && result.ok) {
              reservaCreadaEsteTurno = true;
              if (!entry.nombre && args.nombre) setNombre(jid, args.nombre);
              if (result.data?.mensaje_confirmacion) {
                appendHistory(jid, 'user', userText);
                appendHistory(jid, 'assistant', result.data.mensaje_confirmacion);
                return result.data.mensaje_confirmacion;
              }
            }
          } catch (err) {
            console.error(`[agent] ERROR en tool ${fnName}:`);
            console.error('  args:', JSON.stringify(args));
            console.error('  message:', err?.message);
            console.error('  code:', err?.code, 'details:', err?.details, 'hint:', err?.hint);
            console.error('  stack:', err?.stack);
            result = { ok: false, error: `Error interno (${fnName}): ${err?.message || 'desconocido'}` };
          }
        }
      }

      // Log compacto de cada tool call: imprescindible para depurar
      // "el bot dijo confirmado pero no hay nada en la DB".
      const resumen = result?.ok
        ? `ok${result.data?.id ? ' id=' + String(result.data.id).slice(0, 8) : ''}`
        : `FAIL: ${result?.error || 'sin error'}`;
      console.log(`[agent] tool ${fnName}(${JSON.stringify(args).slice(0, 200)}) → ${resumen}`);

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  // Si excedió el loop sin respuesta final.
  const fallback = 'Uh, algo se trabó de nuestro lado. ¿Me lo repetís?';
  appendHistory(jid, 'user', userText);
  appendHistory(jid, 'assistant', fallback);
  return fallback;
}
