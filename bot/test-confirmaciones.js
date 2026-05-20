import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildConfirmacion } from './format.js';

// Compute today/tomorrow in Argentina TZ at test runtime (matches format.js logic).
const TZ = 'America/Argentina/Buenos_Aires';
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const MANANA = (() => {
  const d = new Date(); d.setDate(d.getDate() + 1);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
})();

// 2026-06-03 is a Wednesday; 2026-06-08 is a Monday.
const BASE = {
  nombre: 'Lucas',
  fecha: '2026-06-03',
  hora: '14:00',
  servicio: 'Tintura & Coloración',
  duracion_min: 120,
};

describe('buildConfirmacion', () => {
  it('encabezado con nombre del cliente', () => {
    assert.ok(buildConfirmacion(BASE).startsWith('Listo, Lucas.'));
  });

  it('fecha con día de semana y DD/MM', () => {
    assert.ok(buildConfirmacion(BASE).includes('Miércoles 03/06 a las 14:00'));
  });

  it('nombre del servicio', () => {
    assert.ok(buildConfirmacion(BASE).includes('Tintura & Coloración'));
  });

  it('duración 2 horas exactas', () => {
    assert.ok(buildConfirmacion(BASE).includes('Dura 2 horas'));
  });

  it('duración 1 hora exacta', () => {
    assert.ok(buildConfirmacion({ ...BASE, duracion_min: 60 }).includes('Dura 1 hora'));
  });

  it('duración en minutos cuando < 60', () => {
    const msg = buildConfirmacion({ ...BASE, servicio: 'Corte de cabello', duracion_min: 30 });
    assert.ok(msg.includes('Dura 30 minutos'));
  });

  it('duración con horas y minutos restantes', () => {
    assert.ok(buildConfirmacion({ ...BASE, duracion_min: 90 }).includes('Dura 1 hora y 30 minutos'));
  });

  it('precio formateado con punto como separador de miles', () => {
    assert.ok(buildConfirmacion(BASE).includes('$18.000'));
  });

  it('lookup duracion_min desde config si reserva.duracion_min es null', () => {
    // Tintura & Coloración = 120min en config.js
    assert.ok(buildConfirmacion({ ...BASE, duracion_min: null }).includes('Dura 2 horas'));
  });

  it('omite línea de precio si el servicio no existe en el catálogo', () => {
    const msg = buildConfirmacion({ ...BASE, servicio: 'Servicio fantasma', duracion_min: 30 });
    assert.ok(!msg.includes('Precio'));
  });

  it('cierre dinámico: hoy', () => {
    assert.ok(buildConfirmacion({ ...BASE, fecha: HOY }).includes('Nos vemos hoy'));
  });

  it('cierre dinámico: mañana', () => {
    assert.ok(buildConfirmacion({ ...BASE, fecha: MANANA }).includes('Nos vemos mañana'));
  });

  it('cierre dinámico: día de semana para fechas futuras', () => {
    // 2026-06-08 = Lunes
    assert.ok(buildConfirmacion({ ...BASE, fecha: '2026-06-08' }).includes('Nos vemos el Lunes'));
  });
});
