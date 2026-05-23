import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TZ = 'America/Argentina/Cordoba'

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

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

function todayInTZ(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
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

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: cors })
  if (!allowed.has(origin)) {
    return json({ error: 'No autorizado.' }, 403)
  }

  let body: { token?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Cuerpo inválido.' }, 400)
  }

  const { token } = body
  if (!token || token.length < 8) {
    return json({ error: 'Token inválido.' }, 400)
  }

  const { data, error } = await db
    .from('reservas')
    .select('id, fecha, estado')
    .eq('token', token)
    .single()

  if (error || !data) {
    return json({ error: 'Turno no encontrado.' }, 404)
  }

  if (data.estado === 'cancelada') {
    return json({ error: 'El turno ya está cancelado.' }, 409)
  }

  if (data.fecha < todayInTZ()) {
    return json({ error: 'No podés cancelar un turno ya pasado.' }, 409)
  }

  const { error: updateError } = await db
    .from('reservas')
    .update({ estado: 'cancelada' })
    .eq('id', data.id)

  if (updateError) {
    return json({ error: 'Error al cancelar el turno. Llamanos al 351 311-5571.' }, 500)
  }

  return json({ ok: true }, 200)
})
