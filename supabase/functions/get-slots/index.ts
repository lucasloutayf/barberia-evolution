import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGINS = new Set(
  ['http://localhost:5173', Deno.env.get('ALLOWED_ORIGIN')].filter(Boolean) as string[]
)

const STEP = 30 // minutes between slots

// Must match barberia.config.js servicios[].nombre and duracion
const SERVICE_DURATIONS: Record<string, number> = {
  'Corte de cabello':     30,
  'Tintura & Coloración': 120,
  'Tratamientos Spa':     60,
  'Styling & Peinados':   60,
  'Afeitado & Barba':     30,
  'Cuidado capilar':      45,
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : '',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function minutesToHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

// Returns all slot strings covered by a reservation starting at `hora` lasting `duracion` min.
function coversSlots(hora: string, duracion: number): string[] {
  const n = Math.ceil(duracion / STEP)
  const start = hhmmToMinutes(hora)
  return Array.from({ length: n }, (_, i) => minutesToHHMM(start + i * STEP))
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
  if (req.method !== 'GET') {
    return new Response(null, { status: 405, headers: cors })
  }
  if (!ALLOWED_ORIGINS.has(origin)) {
    return json({ error: 'No autorizado.' }, 403)
  }

  const url = new URL(req.url)
  const fecha = url.searchParams.get('fecha')

  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return json({ error: 'Fecha inválida.' }, 400)
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data, error } = await db
    .from('reservas')
    .select('hora, duracion_min, servicio')
    .eq('fecha', fecha)
    .neq('estado', 'cancelada')

  if (error) {
    return json({ error: 'Error consultando disponibilidad.' }, 500)
  }

  // Build set of all blocked slots, considering multi-slot services
  const blocked = new Set<string>()
  for (const r of (data ?? [])) {
    const duracion = r.duracion_min ?? SERVICE_DURATIONS[r.servicio] ?? STEP
    for (const slot of coversSlots(r.hora, duracion)) {
      blocked.add(slot)
    }
  }

  return json({ blocked: [...blocked] }, 200)
})
