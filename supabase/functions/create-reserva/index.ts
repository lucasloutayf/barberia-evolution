import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const STEP = 30

// Must stay in sync with barberia.config.js servicios[].nombre and duracion
const SERVICE_DURATIONS: Record<string, number> = {
  'Corte de cabello':     30,
  'Tintura & Coloración': 120,
  'Tratamientos Spa':     60,
  'Styling & Peinados':   60,
  'Afeitado & Barba':     30,
  'Cuidado capilar':      45,
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function minutesToHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

function coversSlots(hora: string, duracion: number): string[] {
  const n = Math.ceil(duracion / STEP)
  const start = hhmmToMinutes(hora)
  return Array.from({ length: n }, (_, i) => minutesToHHMM(start + i * STEP))
}

// DB client at module scope — reused across warm requests
const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// Allowed origins cache (TTL: 5 min per warm instance)
let cachedOrigins: Set<string> | null = null
let cacheAt = 0

async function getAllowedOrigins(): Promise<Set<string>> {
  if (cachedOrigins && Date.now() - cacheAt < 5 * 60 * 1000) return cachedOrigins
  const { data } = await db.from('barberias').select('dominio')
  cachedOrigins = new Set([
    'http://localhost:5173',
    ...(data ?? []).flatMap((r: { dominio: string }) => [
      `https://${r.dominio}`,
      `https://www.${r.dominio}`,
    ]),
  ])
  cacheAt = Date.now()
  return cachedOrigins
}

function corsHeaders(origin: string, allowed: Set<string>): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': allowed.has(origin) ? origin : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

async function generateToken(secret: string, reservaId: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(reservaId))
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}

function getClientIp(req: Request): string | null {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    null
  )
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') ?? ''
  const allowed = await getAllowedOrigins()
  const cors = corsHeaders(origin, allowed)

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  if (req.method !== 'POST') {
    return new Response(null, { status: 405, headers: cors })
  }

  if (!allowed.has(origin)) {
    return json({ error: 'Solicitud no autorizada.' }, 403)
  }

  const ip = getClientIp(req)

  if (ip) {
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    const { count } = await db
      .from('_ip_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('ip', ip)
      .gt('attempted_at', since)

    if ((count ?? 0) >= 10) {
      return json(
        { error: 'Demasiados intentos. Esperá unos minutos e intentá de nuevo.' },
        429
      )
    }

    await db.from('_ip_attempts').insert({ ip })

    await db
      .from('_ip_attempts')
      .delete()
      .lt('attempted_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
  }

  let body: Record<string, string>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Cuerpo de solicitud inválido.' }, 400)
  }

  const { nombre, telefono, servicio, fecha, hora, mensaje, turnstileToken, barberia_id } = body

  if (
    !nombre?.trim() ||
    !telefono?.trim() ||
    !servicio?.trim() ||
    !fecha?.trim() ||
    !hora?.trim() ||
    !turnstileToken?.trim() ||
    !barberia_id?.trim()
  ) {
    return json({ error: 'Faltan campos requeridos.' }, 400)
  }

  const cfRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      secret: Deno.env.get('TURNSTILE_SECRET_KEY')!,
      response: turnstileToken,
    }),
  })
  const cfData = await cfRes.json()

  if (!cfData.success) {
    return json(
      { error: 'Verificación anti-bot fallida. Volvé a completar el captcha.' },
      400
    )
  }

  const duracion_min = SERVICE_DURATIONS[servicio] ?? STEP

  const { data: existing } = await db
    .from('reservas')
    .select('hora, duracion_min, servicio')
    .eq('fecha', fecha)
    .eq('barberia_id', barberia_id ?? '')
    .neq('estado', 'cancelada')

  const taken = new Set<string>()
  for (const r of (existing ?? [])) {
    const dur = r.duracion_min ?? SERVICE_DURATIONS[r.servicio] ?? STEP
    for (const s of coversSlots(r.hora, dur)) taken.add(s)
  }
  if (coversSlots(hora, duracion_min).some(s => taken.has(s))) {
    return json({ error: 'Ese horario ya está ocupado. Por favor elegí otro.' }, 409)
  }

  const reservaId = crypto.randomUUID()
  const token = await generateToken(Deno.env.get('TOKEN_SECRET')!, reservaId)

  const { error: insertError } = await db.from('reservas').insert({
    id:          reservaId,
    nombre:      nombre.trim(),
    telefono:    telefono.trim(),
    servicio,
    fecha,
    hora,
    mensaje:     mensaje?.trim() || null,
    duracion_min,
    ip,
    barberia_id: barberia_id ?? null,
    token,
  })

  if (insertError) {
    return json(
      { error: 'Error al guardar la reserva. Intentá de nuevo o llamanos.' },
      500
    )
  }

  return json({ ok: true, token, reserva_id: reservaId }, 200)
})
