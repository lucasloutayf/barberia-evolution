import { test } from 'node:test'
import assert from 'node:assert/strict'
import cfg from '../barberia.config.js'
import {
  SERVICES, SCHEDULE, BOOKING_WINDOW_DAYS, TZ,
  findServiceByNombre, findServiceFuzzy,
  horasForDay, isClosedDay, formatHorario,
} from './config.js'

test('SERVICES matches barberia.config.js servicios', () => {
  assert.equal(SERVICES.length, cfg.servicios.length)
  assert.equal(SERVICES[0].nombre, cfg.servicios[0].nombre)
  assert.equal(SERVICES[0].duracion_min, cfg.servicios[0].duracion)
  assert.equal(SERVICES[0].precio, cfg.servicios[0].precio)
})

test('SCHEDULE.dias matches config horario.dias', () => {
  assert.deepEqual(SCHEDULE.dias, cfg.horario.dias)
})

test('SCHEDULE.stepMin matches config intervalo', () => {
  assert.equal(SCHEDULE.stepMin, cfg.horario.intervalo)
})

test('horasForDay(0) returns [] for domingo (closed)', () => {
  assert.deepEqual(horasForDay(0), [])
})

test('horasForDay(1) returns franjas array for lunes', () => {
  const franjas = horasForDay(1)
  assert.ok(Array.isArray(franjas))
  assert.ok(franjas.length > 0)
  assert.ok(franjas[0].apertura)
  assert.ok(franjas[0].cierre)
})

test('isClosedDay(0) returns true for domingo', () => {
  assert.equal(isClosedDay(0), true)
})

test('isClosedDay(1) returns false for lunes', () => {
  assert.equal(isClosedDay(1), false)
})

test('formatHorario returns string with 7 lines', () => {
  const txt = formatHorario()
  assert.equal(typeof txt, 'string')
  assert.equal(txt.split('\n').length, 7)
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
