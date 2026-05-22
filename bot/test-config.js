import { test } from 'node:test'
import assert from 'node:assert/strict'
import cfg from '../barberia.config.js'
import { SERVICES, BUSINESS_HOURS, BOOKING_WINDOW_DAYS, TZ, findServiceByNombre, findServiceFuzzy } from './config.js'

test('SERVICES matches barberia.config.js servicios', () => {
  assert.equal(SERVICES.length, cfg.servicios.length)
  assert.equal(SERVICES[0].nombre, cfg.servicios[0].nombre)
  assert.equal(SERVICES[0].duracion_min, cfg.servicios[0].duracion)
  assert.equal(SERVICES[0].precio, cfg.servicios[0].precio)
})

test('BUSINESS_HOURS.start matches config apertura', () => {
  assert.equal(BUSINESS_HOURS.start, cfg.horario.apertura)
})

test('BUSINESS_HOURS.end matches config cierre', () => {
  assert.equal(BUSINESS_HOURS.end, cfg.horario.cierre)
})

test('BUSINESS_HOURS.stepMin matches config intervalo', () => {
  assert.equal(BUSINESS_HOURS.stepMin, cfg.horario.intervalo)
})

test('BUSINESS_HOURS.closedDays matches config diasCerrado', () => {
  assert.deepEqual(BUSINESS_HOURS.closedDays, cfg.horario.diasCerrado)
})

test('BOOKING_WINDOW_DAYS matches config ventanaReservaDias', () => {
  assert.equal(BOOKING_WINDOW_DAYS, cfg.ventanaReservaDias)
})

test('TZ matches config timezone', () => {
  assert.equal(TZ, cfg.horario.timezone)
})

test('findServiceByNombre("Tratamientos Spa") returns service', () => {
  const svc = findServiceByNombre('Tratamientos Spa')
  assert.notEqual(svc, null)
  assert.equal(svc.nombre, 'Tratamientos Spa')
})

test('findServiceFuzzy("spa") finds Tratamientos Spa', () => {
  const svc = findServiceFuzzy('spa')
  assert.notEqual(svc, null)
  assert.equal(svc.nombre, 'Tratamientos Spa')
})
