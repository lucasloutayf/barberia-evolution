# Admin Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un calendario mensual al panel admin que muestra el conteo de turnos confirmados por día y filtra la tabla al hacer clic en un día.

**Architecture:** El calendario vive entre las stat-cards y los filtros en `admin.html`. Opera 100% sobre `allReservas` (ya en memoria) — sin queries extra a Supabase. El `filterFecha` input se elimina; su rol lo toma la variable `selectedDate` que `renderCalendar()` escribe y `renderTable()` lee.

**Tech Stack:** Vanilla JS (ES modules, Vite dev server), HTML5, CSS3. No hay framework de tests para el frontend — la verificación es manual en el browser con `npm run dev`.

---

## File Map

| Archivo | Cambios |
|---|---|
| `admin.css` | Agregar bloque de estilos del calendario al final |
| `admin.html` | Agregar `#calSection` entre stats y filtros; eliminar filter-group de fecha |
| `admin.js` | Variables de estado; `renderCalendar()`; wiring de nav; actualizar `renderTable()`, `clearFilters`, `loadReservas()` |

---

## Task 1: Estilos CSS del calendario

**Files:**
- Modify: `admin.css` (agregar al final del archivo)

- [ ] **Step 1: Agregar estilos al final de `admin.css`**

Abrir `admin.css` y añadir al final:

```css
/* ---- Calendario ---- */
.cal-section {
  background: var(--ink-3);
  border: 1px solid rgba(255,255,255,.055);
  border-radius: var(--r-md);
  padding: 1.25rem 1.5rem;
}

.cal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.cal-title {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 1rem;
  letter-spacing: .1em;
  color: var(--gold);
}

.cal-nav-btn {
  background: var(--ink-4);
  border: 1px solid rgba(255,255,255,.09);
  border-radius: var(--r-sm);
  color: var(--text-dim);
  cursor: pointer;
  font-size: .9rem;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color .2s, color .2s;
}

.cal-nav-btn:hover {
  border-color: rgba(201,168,76,.35);
  color: var(--gold);
}

.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
  text-align: center;
}

.cal-day-name {
  font-size: .68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .07em;
  color: var(--text-muted);
  padding: .3rem 0 .5rem;
}

.cal-day {
  border-radius: var(--r-sm);
  padding: .45rem .25rem;
  font-size: .83rem;
  line-height: 1.1;
  cursor: pointer;
  transition: background .15s, color .15s;
  color: var(--text);
}

.cal-day--empty {
  cursor: default;
  pointer-events: none;
}

.cal-day--muted {
  color: var(--text-muted);
}

.cal-day:not(.cal-day--sunday):not(.cal-day--empty):hover {
  background: rgba(201,168,76,.1);
  color: var(--text);
}

.cal-day--today {
  outline: 1px solid rgba(201,168,76,.35);
  outline-offset: -1px;
}

.cal-day--selected {
  background: var(--gold) !important;
  color: var(--ink) !important;
  font-weight: 700;
}

.cal-day-count {
  display: block;
  font-size: .68rem;
  color: var(--gold);
  line-height: 1;
  min-height: .85rem;
}

.cal-day--muted .cal-day-count {
  visibility: hidden;
}

.cal-day--selected .cal-day-count {
  color: var(--ink);
}

.cal-day--sunday {
  opacity: .3;
  cursor: default;
  pointer-events: none;
}

@media (max-width: 768px) {
  .cal-section { padding: 1rem; }
  .cal-day { padding: .35rem .15rem; font-size: .75rem; }
  .cal-day-count { font-size: .6rem; }
}
```

- [ ] **Step 2: Verificar que no hay errores de sintaxis**

Abrir `http://localhost:5173/admin.html` (si el servidor ya está corriendo) o lanzar `npm run dev`. El panel debe cargar sin errores en consola relacionados con CSS.

---

## Task 2: Estructura HTML — agregar calendario, eliminar filtro de fecha

**Files:**
- Modify: `admin.html`

- [ ] **Step 1: Agregar el bloque `#calSection` en `admin.html`**

Localizar este comentario en `admin.html`:

```html
      <!-- Filtros -->
      <div class="admin-filters">
```

Insertar ANTES de ese bloque:

```html
      <!-- Calendario -->
      <div class="cal-section" id="calSection">
        <div class="cal-header">
          <button class="cal-nav-btn" id="calPrev">&#8592;</button>
          <span class="cal-title" id="calTitle"></span>
          <button class="cal-nav-btn" id="calNext">&#8594;</button>
        </div>
        <div class="cal-grid" id="calGrid"></div>
      </div>
```

- [ ] **Step 2: Eliminar el filter-group de fecha**

Dentro de `.admin-filters`, eliminar este bloque completo:

```html
        <div class="filter-group">
          <label>Fecha del turno</label>
          <input type="date" id="filterFecha">
        </div>
```

- [ ] **Step 3: Verificar estructura visual**

En `http://localhost:5173/admin.html` (logueado), debe aparecer un recuadro oscuro vacío donde irá el calendario, entre las stat-cards y los filtros. El filtro de fecha ya no debe estar. Sin errores en consola.

---

## Task 3: JS — variables de estado y función `renderCalendar()`

**Files:**
- Modify: `admin.js`

- [ ] **Step 1: Agregar variables de módulo**

Localizar en `admin.js`:

```js
let allReservas = [];
```

Reemplazarlo por:

```js
let allReservas = [];
let selectedDate = null;
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();
```

- [ ] **Step 2: Agregar la constante de nombres de mes y la función `renderCalendar()`**

Localizar en `admin.js` el comentario `/* ---- Helpers ---- */` y agregar ANTES de él:

```js
/* ---- Calendario ---- */
const MONTH_NAMES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
];

function renderCalendar(year, month) {
  calYear = year;
  calMonth = month;

  document.getElementById('calTitle').textContent = `${MONTH_NAMES[month]} ${year}`;

  const grid = document.getElementById('calGrid');
  const today = new Date().toISOString().split('T')[0];

  const dayNames = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  let html = dayNames.map(d => `<div class="cal-day-name">${d}</div>`).join('');

  // getDay() returns 0=Sun,1=Mon,...,6=Sat — convert to Mon-based offset (0=Mon,...,6=Sun)
  const firstDow = new Date(year, month, 1).getDay();
  const startOffset = (firstDow === 0) ? 6 : firstDow - 1;
  for (let i = 0; i < startOffset; i++) {
    html += `<div class="cal-day cal-day--empty"></div>`;
  }

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isSunday = new Date(year, month, d).getDay() === 0;
    const isToday   = iso === today;
    const isSelected = iso === selectedDate;
    const count = allReservas.filter(r => r.fecha === iso && r.estado === 'confirmada').length;

    const classes = [
      'cal-day',
      isSunday   ? 'cal-day--sunday'   : '',
      isToday    ? 'cal-day--today'    : '',
      isSelected ? 'cal-day--selected' : '',
      count > 0  ? 'cal-day--has-confirmed' : 'cal-day--muted',
    ].filter(Boolean).join(' ');

    html += `<div class="${classes}" data-date="${iso}">${d}<span class="cal-day-count">${count > 0 ? count : ''}</span></div>`;
  }

  grid.innerHTML = html;

  grid.querySelectorAll('.cal-day:not(.cal-day--sunday):not(.cal-day--empty)').forEach(cell => {
    cell.addEventListener('click', () => {
      const date = cell.dataset.date;
      selectedDate = (selectedDate === date) ? null : date;
      renderCalendar(calYear, calMonth);
      renderTable();
    });
  });
}
```

- [ ] **Step 3: Verificar en browser**

Con el servidor corriendo y el panel abierto, abrir la consola del browser. Ejecutar manualmente:

```js
renderCalendar(2026, 4)
```

Debe renderizar el calendario de mayo 2026 en el bloque `#calGrid`. Si hay reservas cargadas, los días con confirmadas deben mostrar su contador dorado.

---

## Task 4: JS — wiring de navegación, inicialización, integración con tabla y filtros

**Files:**
- Modify: `admin.js`

- [ ] **Step 1: Registrar los botones de navegación en `showDashboard()`**

Localizar en `showDashboard()` la línea:

```js
  document.getElementById('refreshBtn').addEventListener('click', loadReservas);
```

Agregar DESPUÉS de esa línea:

```js
  calYear = new Date().getFullYear();
  calMonth = new Date().getMonth();

  document.getElementById('calPrev').addEventListener('click', () => {
    calMonth--;
    if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar(calYear, calMonth);
  });
  document.getElementById('calNext').addEventListener('click', () => {
    calMonth++;
    if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar(calYear, calMonth);
  });
```

- [ ] **Step 2: Actualizar el listener de `clearFilters`**

Localizar en `showDashboard()`:

```js
  document.getElementById('clearFilters').addEventListener('click', () => {
    document.getElementById('filterEstado').value = '';
    document.getElementById('filterFecha').value = '';
    document.getElementById('filterNombre').value = '';
    renderTable();
  });
```

Reemplazarlo por:

```js
  document.getElementById('clearFilters').addEventListener('click', () => {
    document.getElementById('filterEstado').value = '';
    document.getElementById('filterNombre').value = '';
    selectedDate = null;
    renderCalendar(calYear, calMonth);
    renderTable();
  });
```

- [ ] **Step 3: Actualizar `renderTable()` para usar `selectedDate`**

Localizar en `renderTable()`:

```js
  const fecha = document.getElementById('filterFecha').value;
```

Reemplazarlo por:

```js
  const fecha = selectedDate;
```

- [ ] **Step 4: Llamar `renderCalendar()` desde `loadReservas()`**

Localizar en `loadReservas()`:

```js
    allReservas = data || [];
    updateStats();
    renderTable();
```

Reemplazarlo por:

```js
    allReservas = data || [];
    updateStats();
    renderCalendar(calYear, calMonth);
    renderTable();
```

- [ ] **Step 5: Verificar flujo completo en browser**

En `http://localhost:5173/admin.html`:

1. **El calendario debe aparecer** con el mes actual, días con nombre L M X J V S D.
2. **Los días con confirmadas** muestran un número dorado pequeño debajo del número de día.
3. **Clic en un día con confirmadas** → celda se pone dorada y la tabla filtra solo ese día.
4. **Clic en el mismo día** → se deselecciona, la tabla muestra todos.
5. **Flechas ← →** navegan entre meses; al volver al mes original el día seleccionado sigue marcado.
6. **Filtros de Estado y Nombre** siguen funcionando junto con un día seleccionado.
7. **Botón "Limpiar"** limpia estado, nombre Y la selección del calendario.
8. **Botón "Actualizar"** recarga datos y actualiza los contadores del calendario.
9. **Domingo** aparece apagado y no responde a clic.
10. **Hoy** tiene un borde dorado tenue.

- [ ] **Step 6: Verificar mobile**

Achicar el browser a ~375px de ancho. El calendario debe seguir siendo legible — celdas más compactas, contador visible.

---

## Task 5: Commit final

**Files:** `admin.css`, `admin.html`, `admin.js`

- [ ] **Step 1: Commit**

```bash
git add admin.css admin.html admin.js
git commit -m "feat(admin): add monthly calendar with confirmed-count indicators"
```

Expected output: `[main xxxxxxx] feat(admin): add monthly calendar with confirmed-count indicators` con 3 archivos cambiados.
