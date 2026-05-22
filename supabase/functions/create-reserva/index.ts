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

const ALLOWED_ORIGINS = new Set(
  ['http://localhost:5173', Deno.env.get('ALLOWED_ORIGIN')].filter(Boolean) as string[]
)

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }
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
  const cors = corsHeaders(origin)

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

  if (!ALLOWED_ORIGINS.has(origin)) {
    return json({ error: 'Solicitud no autorizada.' }, 403)
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Defensive IP extraction — skip rate limiting if IP is not detectable
  const ip = getClientIp(req)

  if (ip) {
    // Non-atomic check-then-insert: concurrent bursts may slip through by up to one extra request per in-flight connection.
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

    // Best-effort cleanup of records older than 1 hour
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

  const { nombre, telefono, servicio, fecha, hora, mensaje, turnstileToken } = body

  if (
    !nombre?.trim() ||
    !telefono?.trim() ||
    !servicio?.trim() ||
    !fecha?.trim() ||
    !hora?.trim() ||
    !turnstileToken?.trim()
  ) {
    return json({ error: 'Faltan campos requeridos.' }, 400)
  }

  // Verify Turnstile token with Cloudflare Siteverify
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

  // Collision check: prevent double-booking
  const { data: existing } = await db
    .from('reservas')
    .select('hora, duracion_min, servicio')
    .eq('fecha', fecha)
    .neq('estado', 'cancelada')

  const taken = new Set<string>()
  for (const r of (existing ?? [])) {
    const dur = r.duracion_min ?? SERVICE_DURATIONS[r.servicio] ?? STEP
    for (const s of coversSlots(r.hora, dur)) taken.add(s)
  }
  if (coversSlots(hora, duracion_min).some(s => taken.has(s))) {
    return json({ error: 'Ese horario ya está ocupado. Por favor elegí otro.' }, 409)
  }

  // Insert reservation using service-role key (bypasses RLS)
  const { error: insertError } = await db.from('reservas').insert({
    nombre:      nombre.trim(),
    telefono:    telefono.trim(),
    servicio,
    fecha,
    hora,
    mensaje:     mensaje?.trim() || null,
    duracion_min,
    ip,
  })

  if (insertError) {
    return json(
      { error: 'Error al guardar la reserva. Intentá de nuevo o llamanos.' },
      500
    )
  }

  return json({ ok: true }, 200)
})
