# Diseño: Horarios por día con turnos partidos

**Fecha:** 2026-05-21  
**Estado:** Aprobado

## Problema

El sistema actual tiene un único par `apertura`/`cierre` que aplica igual a todos los días de la semana. No soporta que una peluquería abra diferente según el día (ej: lunes 9–19:30, sábado 10–15:00) ni turnos partidos (ej: martes 9–13:00 y 15:00–19:00).

## Solución

Reemplazar `apertura`/`cierre`/`diasCerrado` en `barberia.config.js` por un array `dias[7]` de franjas horarias. El índice mapea directo a `Date.getDay()` (0=Dom…6=Sáb). Array vacío = día cerrado.

## Estructura de datos

### `barberia.config.js`

```js
horario: {
  intervalo: 30,
  timezone: 'America/Argentina/Buenos_Aires',
  dias: [
    [],                                                                        // 0 Dom — cerrado
    [{ apertura: '09:00', cierre: '19:30' }],                                 // 1 Lun
    [{ apertura: '09:00', cierre: '13:00' }, { apertura: '15:00', cierre: '19:00' }], // 2 Mar — partido
    [{ apertura: '09:00', cierre: '19:30' }],                                 // 3 Mié
    [{ apertura: '09:00', cierre: '19:30' }],                                 // 4 Jue
    [{ apertura: '09:00', cierre: '19:30' }],                                 // 5 Vie
    [{ apertura: '10:00', cierre: '15:00' }],                                 // 6 Sáb
  ],
},
```

Los campos `apertura`, `cierre` y `diasCerrado` son eliminados.

## Archivos afectados

| Archivo | Cambio |
|---|---|
| `barberia.config.js` | Nueva estructura `dias[]`; eliminar `apertura`, `cierre`, `diasCerrado` |
| `bot/config.js` | `BUSINESS_HOURS` → `SCHEDULE`; agregar helpers `horasForDay` e `isClosedDay` |
| `bot/slots.js` | Reescritura de funciones clave para recibir `dayOfWeek` |
| `bot/agent.js` | System prompt generado dinámicamente por día |
| `bot/whatsapp.js` | Check de horario actualizado a helpers nuevos |
| `bot/tools.js` | Pasa `dayOfWeek` a `validateHora` y `slotsForService` |
| `bot/test-config.js` | Tests actualizados para nueva forma de `SCHEDULE` |
| `main.js` | Slots generados dinámicamente al elegir fecha |

## Diseño por módulo

### `bot/config.js`

Exporta `SCHEDULE` en lugar de `BUSINESS_HOURS`:

```js
export const SCHEDULE = {
  dias:    cfg.horario.dias,       // array[7] de franjas
  stepMin: cfg.horario.intervalo,
};

export function horasForDay(dayOfWeek) {
  return SCHEDULE.dias[dayOfWeek] ?? [];
}

export function isClosedDay(dayOfWeek) {
  return horasForDay(dayOfWeek).length === 0;
}

export function formatHorario() {
  // Genera string legible del horario para el system prompt del bot
  // Ej: "- Lunes: 09:00 a 19:30\n- Martes: 09:00 a 13:00 y 15:00 a 19:00\n..."
}
```

`TZ` sigue exportándose desde `cfg.horario.timezone`.

### `bot/slots.js`

Todas las funciones que dependen del horario reciben `dayOfWeek` (número 0–6):

- **`generateAllSlots(dayOfWeek)`** — une los slots de todas las franjas del día en orden cronológico
- **`fitsInBusinessHours(hora, duracion, dayOfWeek)`** — el servicio debe caber entero dentro de una sola franja. Un turno de 90 min que empieza a las 12:30 con franja 9–13:00 queda bloqueado porque cruza el corte
- **`slotsForService(duracion, existingReservas, dayOfWeek)`** — pasa `dayOfWeek` a las funciones internas
- **`validateFecha(fechaISO)`** — usa `isClosedDay(dayOfWeek)` en lugar de `closedDays.includes()`
- **`validateHora(hhmm, dayOfWeek)`** — valida contra `generateAllSlots(dayOfWeek)`

`hasCollision` y `coversSlots` no cambian porque no tienen lógica de horario de negocio.

### `bot/agent.js`

El system prompt reemplaza la línea hardcodeada de horario por el resultado de `formatHorario()` de `bot/config.js`. Ejemplo de output:

```
Horario:
- Lunes: 09:00 a 19:30
- Martes: 09:00 a 13:00 y 15:00 a 19:00
- Miércoles a Viernes: 09:00 a 19:30
- Sábado: 10:00 a 15:00
- Domingo: cerrado
```

### `bot/whatsapp.js`

La función `isWithinBusinessHours()` reemplaza referencias a `BUSINESS_HOURS.closedDays/.start/.end` por `isClosedDay(day)` y `horasForDay(day)`. Verifica que la hora actual caiga dentro de alguna franja del día.

### `main.js` (frontend)

El loop de slots estático al cargar la página se elimina. En su lugar:

1. Al cargar: `horaSelect` muestra solo el placeholder deshabilitado ("Seleccioná un horario")
2. En el `input` event de `fechaInput`:
   - Calcula `dayOfWeek` de la fecha elegida
   - Lee `cfg.horario.dias[dayOfWeek]`
   - Si `franjas.length === 0`: invalida el campo y vacía el select
   - Si hay franjas: regenera las opciones del select con todos los slots de todas las franjas en orden

Con turnos partidos, todos los slots de todas las franjas aparecen juntos en el select en orden cronológico.

### `bot/test-config.js`

Los tests de `BUSINESS_HOURS.start`, `.end`, `.closedDays` se reemplazan por tests de `SCHEDULE.dias`, `SCHEDULE.stepMin`, `horasForDay()` e `isClosedDay()`.

## Invariantes importantes

- Un servicio **nunca puede cruzar el corte** de un turno partido. Si una franja cierra a las 13:00 (último slot inicio a las 13:00, termina a las 13:30 con step 30), un servicio de 60 min que empiece a las 12:30 queda bloqueado porque su segunda mitad (13:00–13:30) no cabe dentro del cierre real de esa franja (13:30). La lógica de `fitsInBusinessHours` verifica `startMin + duracion <= cierre + step` para cada franja candidata.
- El frontend nunca muestra un slot que no corresponde al día seleccionado.
- `closedDays` deja de existir como concepto separado; se deriva de `dias[i].length === 0`.
