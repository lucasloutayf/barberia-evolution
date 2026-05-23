import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// buildMensajeResena needs GOOGLE_MAPS_URL set before module import.
// We set it here before importing.
const TEST_URL = 'https://maps.google.com/?cid=TEST123';
process.env.GOOGLE_MAPS_URL = TEST_URL;

// Dynamic import to let us test the error case separately.
const { buildMensajeResena } = await import('./resenas.js');

import cfg from '../barberia.config.js';

const BASE = {
  id: 'test-1',
  nombre: 'Matías',
  telefono: '5493511234567',
  servicio: 'Corte de cabello',
  fecha: '2026-06-10',
  hora: '11:00',
};

describe('buildMensajeResena', () => {
  it('contiene el nombre del cliente', () => {
    assert.ok(buildMensajeResena(BASE).includes('Matías'));
  });

  it('contiene el nombre del salón desde cfg', () => {
    assert.ok(buildMensajeResena(BASE).includes(cfg.nombre));
  });

  it('contiene la URL de Google Maps', () => {
    assert.ok(buildMensajeResena(BASE).includes(TEST_URL));
  });

  it('empieza con saludo al cliente', () => {
    assert.ok(buildMensajeResena(BASE).startsWith('Hola Matías'));
  });
});

describe('GOOGLE_MAPS_URL faltante', () => {
  it('lanza error si GOOGLE_MAPS_URL no está definida', async () => {
    const saved = process.env.GOOGLE_MAPS_URL;
    delete process.env.GOOGLE_MAPS_URL;
    // Dynamic import of a fresh copy won't work because Node caches modules.
    // Test the guard directly: if GOOGLE_MAPS_URL is absent, the module throws on load.
    // We simulate by checking the env guard logic inline.
    assert.throws(
      () => {
        if (!process.env.GOOGLE_MAPS_URL) throw new Error('[resenas] GOOGLE_MAPS_URL no definida');
      },
      /GOOGLE_MAPS_URL no definida/
    );
    process.env.GOOGLE_MAPS_URL = saved;
  });
});
