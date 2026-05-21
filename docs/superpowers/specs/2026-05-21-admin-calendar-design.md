# Diseño: Calendario mensual en el panel admin

**Fecha:** 2026-05-21  
**Proyecto:** barberia-evolution  
**Alcance:** Panel admin (`admin.html` / `admin.js` / `admin.css`)

---

## Objetivo

Agregar un calendario mensual al panel de administración que permita al dueño ver de un vistazo qué días tienen turnos confirmados y, al hacer clic en un día, filtrar la tabla de reservas para mostrar solo ese día.

---

## Decisiones de diseño

| Pregunta | Decisión |
|---|---|
| Layout | Calendario entre stat-cards y filtros |
| Interacción | Clic en día → filtra la tabla; segundo clic → deselecciona |
| Indicador de ocupación | Contador numérico de turnos **confirmados** por día |
| Filtro de fecha existente | Se elimina (`filterFecha` input) — reemplazado por el calendario |
| Filtros de Estado y Nombre | Se mantienen; coexisten con el día seleccionado |

---

## Layout resultante

```
┌─────────────────────────────────────────────────────┐
│  stat-cards: Total · Pendientes · Confirmadas · Hoy │
├─────────────────────────────────────────────────────┤
│  CALENDARIO                                         │
│  ← Mayo 2026 →                                      │
│  L  M  X  J  V  S  D                               │
│           1  2  3  4                                │
│  5  6  7  8  9  10 11                               │
│           [22]  ← seleccionado (fondo dorado)       │
│           [3]   ← contador de confirmadas           │
├─────────────────────────────────────────────────────┤
│  filtros: Estado · Buscar cliente · Limpiar         │
├─────────────────────────────────────────────────────┤
│  tabla de reservas (filtrada por día + estado/nombre│
└─────────────────────────────────────────────────────┘
```

---

## Comportamiento detallado

### Navegación
- Al cargar muestra el mes y año actuales.
- Flechas `←` `→` navegan entre meses (sin restricción de rango).
- El título muestra "Mes AAAA" en español.

### Marcadores de días
- Días sin reservas confirmadas: número solo, color atenuado.
- Días con ≥1 reserva confirmada: número + contador dorado debajo (`font-size` pequeño).
- El contador cuenta solo reservas con `estado === 'confirmada'`.
- Domingos: color extra-atenuado, no son clicables (igual que el formulario público).
- Día de hoy: borde sutil dorado para identificación rápida.

### Selección de día
- Clic en un día con turnos (o sin ellos) → `selectedDate = 'YYYY-MM-DD'`; celda toma fondo dorado y texto oscuro.
- Clic en el día ya seleccionado → `selectedDate = null`; deselecciona.
- Al navegar de mes, la selección se mantiene si el día seleccionado pertenece a ese mes; si no, no se limpia (el mes al que volvés vuelve a mostrarlo seleccionado).
- El botón "Limpiar" de los filtros también limpia `selectedDate` y devuelve el calendario al estado sin selección.

### Interacción con la tabla
- `renderTable()` usa `selectedDate` igual que antes usaba `filterFecha.value`.
- Los filtros de Estado y Nombre se aplican sobre el resultado ya filtrado por día.
- La lógica de filtrado en `renderTable()` no cambia de estructura, solo reemplaza la fuente de la fecha.

### Actualizar
- El botón "Actualizar" llama a `loadReservas()`, que recarga datos y vuelve a llamar `renderCalendar()` con el mes actual, actualizando los contadores.

---

## Archivos modificados

### `admin.html`
- Agregar bloque `#calSection` entre `#adminStats` y `.admin-filters`.
- Eliminar el `filter-group` que contiene `#filterFecha`.

### `admin.js`
- Variable módulo `let selectedDate = null` y `let calYear`, `let calMonth`.
- Función `renderCalendar(year, month)`:
  - Genera las celdas del mes (grid 7 columnas, comenzando en el día de la semana correcto, lunes = col 1).
  - Para cada día calcula `count = allReservas.filter(r => r.fecha === dayISO && r.estado === 'confirmada').length`.
  - Aplica clases CSS según estado: `--today`, `--selected`, `--has-confirmed`, `--sunday`.
  - Event listeners en celdas clicables para actualizar `selectedDate` y llamar `renderTable()` + `renderCalendar()`.
- Flechas de navegación: `calMonth--` / `calMonth++` con rollover de año; llaman `renderCalendar()`.
- `renderTable()`: reemplaza `const fecha = document.getElementById('filterFecha').value` por `const fecha = selectedDate`.
- `clearFilters`: también hace `selectedDate = null` y llama `renderCalendar()`.
- `loadReservas()`: después de `updateStats()` llama `renderCalendar(calYear, calMonth)`.
- `showDashboard()`: inicializa `calYear = new Date().getFullYear()`, `calMonth = new Date().getMonth()`.

### `admin.css`
- Bloque `.cal-section`: card contenedor igual que `.admin-filters` (background ink-3, border, border-radius, padding).
- `.cal-header`: flex, espacio entre flechas y título, color dorado.
- `.cal-nav-btn`: botón fantasma pequeño, igual que `.btn-ghost.btn-sm`.
- `.cal-grid`: `display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px`.
- `.cal-day-name`: nombre de columna (L M X J V S D), color muted, uppercase, pequeño.
- `.cal-day`: celda de día, `border-radius`, `padding`, cursor pointer, transición hover.
- `.cal-day--muted`: días sin turnos (color atenuado).
- `.cal-day--has-confirmed`: días con confirmadas — muestra `.cal-day-count` visible.
- `.cal-day-count`: número de confirmadas, `font-size: .7rem`, color dorado.
- `.cal-day--today`: `outline: 1px solid rgba(201,168,76,.35)`.
- `.cal-day--selected`: `background: var(--gold); color: var(--ink); font-weight: 700`.
- `.cal-day--selected .cal-day-count`: `color: var(--ink)`.
- `.cal-day--sunday`: `opacity: .35; cursor: default; pointer-events: none`.
- Responsive: en mobile el calendar mantiene el grid de 7 col; celdas con padding reducido.

---

## Lo que no cambia

- Stat-cards (Total, Pendientes, Confirmadas, Hoy).
- Filtros de Estado y Nombre.
- Tabla, badges, y acciones (confirmar, cancelar, eliminar).
- Lógica optimista de mutaciones en memoria.
- `updateStats()`.
- Nada del frontend público (`index.html`, `main.js`), ni del bot.

---

## Fuera de alcance

- No se agrega ninguna vista de semana ni de día dedicada.
- No se implementa drag-and-drop ni edición desde el calendario.
- No se hace query extra a Supabase — todo usa `allReservas` en memoria.
