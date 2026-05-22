/* Admin Panel — Evolution Spa & Peluquería */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

let db = null;
let BARBERIA_ID = null;

function getDb() {
  if (!db) {
    db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return db;
}

/* ---- UI helpers ---- */
function show(id) { document.getElementById(id).style.display = ''; }
function hide(id) { document.getElementById(id).style.display = 'none'; }

/* ---- Init ---- */
window.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await getDb().auth.getSession();
  if (session) {
    showDashboard();
    return;
  }

  document.getElementById('loginBtn').addEventListener('click', handleLogin);
  document.getElementById('adminPass').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleLogin();
  });
});

async function handleLogin() {
  const email = document.getElementById('adminEmail').value.trim();
  const pass = document.getElementById('adminPass').value;
  const errEl = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');

  btn.disabled = true;
  errEl.style.display = 'none';

  const { error } = await getDb().auth.signInWithPassword({ email, password: pass });

  btn.disabled = false;

  if (error) {
    errEl.textContent = 'Contraseña incorrecta.';
    errEl.style.display = 'block';
    document.getElementById('adminPass').focus();
  } else {
    showDashboard();
  }
}

async function showDashboard() {
  const { data: { user } } = await getDb().auth.getUser()
  BARBERIA_ID = user?.user_metadata?.barberia_id ?? null

  if (!BARBERIA_ID) {
    alert('Este usuario no tiene una barbería asignada. Contactá al administrador.')
    await getDb().auth.signOut()
    return
  }

  hide('loginScreen');
  show('dashboard');

  if (!dashboardBound) {
    dashboardBound = true;

    document.getElementById('logoutBtn').addEventListener('click', async () => {
      await getDb().auth.signOut();
      show('loginScreen');
      hide('dashboard');
      document.getElementById('adminPass').value = '';
    });

    document.getElementById('refreshBtn').addEventListener('click', loadReservas);

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
    document.getElementById('filterEstado').addEventListener('change', renderTable);
    document.getElementById('filterNombre').addEventListener('input', renderTable);
    document.getElementById('clearFilters').addEventListener('click', () => {
      document.getElementById('filterEstado').value = '';
      document.getElementById('filterNombre').value = '';
      selectedDate = null;
      renderCalendar(calYear, calMonth);
      renderTable();
    });
  }

  calYear = new Date().getFullYear();
  calMonth = new Date().getMonth();
  loadReservas();
}

/* ---- Carga de datos ---- */
let allReservas = [];
let selectedDate = null;
const _now = new Date();
let calYear = _now.getFullYear();
let calMonth = _now.getMonth();
let dashboardBound = false;

async function loadReservas() {
  const loading = document.getElementById('loadingRow');
  const table = document.getElementById('reservasTable');
  const empty = document.getElementById('emptyRow');

  loading.textContent = 'Cargando reservas…';
  loading.style.display = '';
  table.style.display = 'none';
  empty.style.display = 'none';

  try {
    const { data, error } = await getDb()
      .from('reservas')
      .select('*')
      .eq('barberia_id', BARBERIA_ID)
      .order('created_at', { ascending: false });

    loading.style.display = 'none';

    if (error) throw error;

    allReservas = data || [];
    updateStats();
    renderCalendar(calYear, calMonth);
    renderTable();

  } catch (err) {
    loading.textContent = 'Error: ' + (err.message || 'No se pudieron cargar las reservas.');
    loading.style.display = '';
    renderCalendar(calYear, calMonth);
  }
}

function updateStats() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('statTotal').textContent = allReservas.length;
  document.getElementById('statPendiente').textContent = allReservas.filter(r => r.estado === 'pendiente').length;
  document.getElementById('statConfirmada').textContent = allReservas.filter(r => r.estado === 'confirmada').length;
  document.getElementById('statHoy').textContent = allReservas.filter(r => r.fecha === today).length;
}

/* ---- Render tabla ---- */
function renderTable() {
  const estado = document.getElementById('filterEstado').value;
  const fecha = selectedDate;
  const query = document.getElementById('filterNombre').value.toLowerCase();

  let rows = allReservas;
  if (estado) rows = rows.filter(r => r.estado === estado);
  if (fecha) rows = rows.filter(r => r.fecha === fecha);
  if (query) rows = rows.filter(r =>
    r.nombre.toLowerCase().includes(query) ||
    r.telefono.toLowerCase().includes(query)
  );

  const tbody = document.getElementById('reservasTbody');
  const table = document.getElementById('reservasTable');
  const empty = document.getElementById('emptyRow');

  if (rows.length === 0) {
    table.style.display = 'none';
    empty.style.display = '';
    return;
  }

  table.style.display = '';
  empty.style.display = 'none';

  tbody.innerHTML = rows.map(r => `
    <tr data-id="${r.id}" class="row-${r.estado}">
      <td class="cell-fecha">
        <span class="fecha-recibida">${formatDateTime(r.created_at)}</span>
      </td>
      <td class="cell-turno">
        <strong>${formatDate(r.fecha)}</strong>
        <span>${r.hora} hs</span>
      </td>
      <td class="cell-nombre">${escHtml(r.nombre)}</td>
      <td class="cell-tel">
        <a href="tel:${escHtml(r.telefono)}" class="tel-link">${escHtml(r.telefono)}</a>
      </td>
      <td class="cell-servicio">${escHtml(r.servicio)}</td>
      <td class="cell-msg">${r.mensaje ? escHtml(r.mensaje) : '<span class="cell-empty">—</span>'}</td>
      <td class="cell-estado">
        <span class="badge badge-${r.estado}">${r.estado}</span>
      </td>
      <td class="cell-actions">
        ${r.estado !== 'confirmada' ? `<button class="act-btn act-confirm" data-id="${r.id}" title="Confirmar">✓</button>` : ''}
        ${r.estado !== 'cancelada' ? `<button class="act-btn act-cancel"  data-id="${r.id}" title="Cancelar">✕</button>` : ''}
        <button class="act-btn act-delete" data-id="${r.id}" title="Eliminar">&#x1F5D1;</button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.act-confirm').forEach(btn =>
    btn.addEventListener('click', () => updateEstado(btn.dataset.id, 'confirmada'))
  );
  tbody.querySelectorAll('.act-cancel').forEach(btn =>
    btn.addEventListener('click', () => updateEstado(btn.dataset.id, 'cancelada'))
  );
  tbody.querySelectorAll('.act-delete').forEach(btn =>
    btn.addEventListener('click', () => deleteReserva(btn.dataset.id, btn))
  );
}

/* ---- Acciones ---- */
async function updateEstado(id, estado) {
  const row = document.querySelector(`tr[data-id="${id}"]`);
  if (row) row.style.opacity = '.45';

  try {
    const { error } = await getDb().from('reservas').update({ estado }).eq('id', id).eq('barberia_id', BARBERIA_ID);
    if (error) throw error;
    const r = allReservas.find(r => r.id === id);
    if (r) r.estado = estado;
    updateStats();
    renderTable();
  } catch {
    if (row) row.style.opacity = '1';
  }
}

async function deleteReserva(id, btn) {
  if (!confirm('¿Eliminar esta reserva definitivamente?')) return;
  btn.disabled = true;

  try {
    const { error } = await getDb().from('reservas').delete().eq('id', id).eq('barberia_id', BARBERIA_ID);
    if (error) throw error;
    allReservas = allReservas.filter(r => r.id !== id);
    updateStats();
    renderTable();
  } catch {
    btn.disabled = false;
  }
}

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
    const count = allReservas.filter(r => r.fecha === iso && r.estado !== 'cancelada').length;

    const classes = [
      'cal-day',
      isSunday   ? 'cal-day--sunday'   : '',
      isToday    ? 'cal-day--today'    : '',
      isSelected ? 'cal-day--selected' : '',
      (!isSunday && count === 0) ? 'cal-day--muted' : '',
      count > 0  ? 'cal-day--has-confirmed' : '',
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

/* ---- Helpers ---- */
function formatDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
    + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
