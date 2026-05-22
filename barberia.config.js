export default {
  barberia_id: 'evolution-spa',
  nombre: 'Evolution Spa & Peluquería',
  direccion: 'Mariano Fragueiro 11, X5000 Córdoba',
  telefono: '3513115571',
  ubicacion: 'Córdoba capital',

  bot: {
    nombre: 'Sofi',
  },

  horario: {
    apertura:     '09:00',
    cierre:       '19:30',
    intervalo:    30,
    diasCerrado:  [0],
    timezone:     'America/Argentina/Buenos_Aires',
  },

  ventanaReservaDias: 45,

  servicios: [
    { id: 'corte',    nombre: 'Corte de cabello',     duracion: 30,  precio: 5000  },
    { id: 'tintura',  nombre: 'Tintura & Coloración', duracion: 120, precio: 18000 },
    { id: 'spa',      nombre: 'Tratamientos Spa',     duracion: 60,  precio: 12000 },
    { id: 'styling',  nombre: 'Styling & Peinados',   duracion: 60,  precio: 9000  },
    { id: 'afeitado', nombre: 'Afeitado & Barba',     duracion: 30,  precio: 4000  },
    { id: 'cuidado',  nombre: 'Cuidado capilar',      duracion: 45,  precio: 8000  },
  ],
}
