const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

function formatFecha(fechaISO) {
  const [y, mo, d] = fechaISO.split('-').map(Number)
  const dia = DIAS[new Date(Date.UTC(y, mo - 1, d, 12)).getUTCDay()]
  return `${dia} ${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${y}`
}

function estadoClass(estado) {
  if (estado === 'confirmada') return 'estado-confirmada'
  if (estado === 'cancelada')  return 'estado-cancelada'
  return 'estado-pendiente'
}

function estadoLabel(estado) {
  if (estado === 'confirmada') return 'Confirmado'
  if (estado === 'cancelada')  return 'Cancelado'
  return 'Pendiente'
}

function show(id)  { document.getElementById(id).style.display = '' }
function hide(id)  { document.getElementById(id).style.display = 'none' }

function showMsg(id, html, cls) {
  const el = document.getElementById(id)
  el.className = `msg ${cls}`
  el.innerHTML = html
  el.style.display = ''
}

async function main() {
  const token = new URLSearchParams(window.location.search).get('t')

  if (!token) {
    hide('loadingState')
    show('errorState')
    document.getElementById('errorMsg').textContent = 'Link inválido. Solicitá uno nuevo contactando al salón.'
    return
  }

  let reserva
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/get-turno?t=${encodeURIComponent(token)}`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Error al cargar el turno.')
    reserva = data
  } catch (err) {
    hide('loadingState')
    show('errorState')
    document.getElementById('errorMsg').textContent = err.message
    return
  }

  hide('loadingState')
  show('turnoInfo')

  const details = document.getElementById('turnoDetails')
  details.innerHTML = `
    <div class="turno-row">
      <span class="turno-icon">👤</span>
      <div><div class="turno-label">Nombre</div><div class="turno-value">${reserva.nombre}</div></div>
    </div>
    <div class="turno-row">
      <span class="turno-icon">📅</span>
      <div><div class="turno-label">Fecha y hora</div><div class="turno-value">${formatFecha(reserva.fecha)} a las ${reserva.hora}</div></div>
    </div>
    <div class="turno-row">
      <span class="turno-icon">💇</span>
      <div><div class="turno-label">Servicio</div><div class="turno-value">${reserva.servicio}</div></div>
    </div>
    <div class="turno-row">
      <span class="turno-icon">◎</span>
      <div><div class="turno-label">Estado</div><div class="turno-value"><span class="estado-badge ${estadoClass(reserva.estado)}">${estadoLabel(reserva.estado)}</span></div></div>
    </div>
  `

  const isCancelable = reserva.estado === 'pendiente' || reserva.estado === 'confirmada'
  if (isCancelable) {
    show('turnoActions')
    setupCancelFlow(token)
  } else if (reserva.estado === 'cancelada') {
    showMsg('turnoMsg', 'Este turno ya fue cancelado.', 'msg-info')
  }
}

function setupCancelFlow(token) {
  const cancelBtn = document.getElementById('cancelBtn')
  const confirmBtn = document.getElementById('confirmCancelBtn')

  cancelBtn.addEventListener('click', () => {
    cancelBtn.style.display = 'none'
    confirmBtn.style.display = ''
    showMsg('turnoMsg', '¿Confirmás que querés cancelar? Esta acción no se puede deshacer.', 'msg-error')
  })

  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true
    confirmBtn.textContent = 'Cancelando…'
    hide('turnoMsg')

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/cancel-turno`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al cancelar.')

      hide('turnoActions')
      showMsg('turnoMsg', 'Tu turno fue cancelado correctamente. Si necesitás un nuevo turno, contactanos.', 'msg-success')
      const badge = document.querySelector('.estado-badge')
      if (badge) {
        badge.className = 'estado-badge estado-cancelada'
        badge.textContent = 'Cancelado'
      }
    } catch (err) {
      confirmBtn.disabled = false
      confirmBtn.textContent = 'Sí, cancelar definitivamente'
      showMsg('turnoMsg', err.message, 'msg-error')
    }
  })
}

main()
