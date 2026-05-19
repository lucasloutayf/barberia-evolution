// Catálogo y reglas del salón. Editar precios/duraciones cuando el usuario los provea.
// Los `nombre` de SERVICES deben coincidir EXACTAMENTE con los <option> del <select>
// en index.html (rf-servicio) para que el panel admin del sitio los muestre consistentes.

export const TZ = 'America/Argentina/Buenos_Aires';

export const SERVICES = [
  { id: 'corte',     nombre: 'Corte de cabello',     duracion_min: 30,  precio: 5000  },
  { id: 'tintura',   nombre: 'Tintura & Coloración', duracion_min: 120, precio: 18000 },
  { id: 'spa',       nombre: 'Tratamientos Spa',     duracion_min: 60,  precio: 12000 },
  { id: 'styling',   nombre: 'Styling & Peinados',   duracion_min: 60,  precio: 9000  },
  { id: 'afeitado',  nombre: 'Afeitado & Barba',     duracion_min: 30,  precio: 4000  },
  { id: 'cuidado',   nombre: 'Cuidado capilar',      duracion_min: 45,  precio: 8000  },
];

// TODO ajustar: precios y duraciones placeholder hasta que el usuario los confirme.

export const BUSINESS_HOURS = {
  start: '09:00',
  end:   '19:30',       // último horario de INICIO permitido
  stepMin: 30,
  closedDays: [0],      // 0 = Domingo (getDay)
};

export const BOOKING_WINDOW_DAYS = 45;

export const ADMIN_JID = process.env.ADMIN_JID || '';

export function findServiceByNombre(nombre) {
  if (!nombre) return null;
  const target = nombre.trim().toLowerCase();
  return SERVICES.find(s => s.nombre.toLowerCase() === target) || null;
}

export function findServiceFuzzy(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  for (const s of SERVICES) {
    if (t.includes(s.nombre.toLowerCase())) return s;
    if (t.includes(s.id)) return s;
  }
  return null;
}
