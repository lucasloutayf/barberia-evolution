import cfg from './barberia.config.js'

/* =====================
   CONFIG INJECTION
   ===================== */
const SLOT_INTERVAL    = cfg.horario.intervalo
const BOOKING_WINDOW   = cfg.ventanaReservaDias

function initConfig() {
  document.querySelectorAll('[data-cfg="nombre"]').forEach(el => {
    el.textContent = cfg.nombre
  })

  const dir = document.getElementById('cfg-direccion')
  if (dir) dir.textContent = cfg.direccion

  const telLink = document.getElementById('cfg-tel-link')
  if (telLink) {
    telLink.href = `tel:${cfg.telefono}`
    telLink.textContent = cfg.telefono
  }

  document.querySelectorAll('[data-cfg="tel-link"]').forEach(el => {
    el.href = `tel:${cfg.telefono}`
    if (el.textContent.trim() === '3513115571') el.textContent = cfg.telefono
  })

  document.querySelectorAll('[data-cfg="wa-link"]').forEach(el => {
    el.href = `https://wa.me/549${cfg.telefono}`
  })

  const select = document.getElementById('servicio')
  if (select) {
    select.innerHTML =
      '<option value="" disabled selected>Seleccioná un servicio</option>' +
      cfg.servicios.map(s => `<option value="${s.nombre}">${s.nombre}</option>`).join('')
  }
}

initConfig()

/* =====================
   MODAL RESERVA
   ===================== */
;(function () {
  const overlay    = document.getElementById('modalReserva');
  const modalClose = document.getElementById('modalClose');
  const formWrap   = document.getElementById('modalFormWrap');
  const form       = document.getElementById('reservaForm');
  const submitBtn  = document.getElementById('reservaSubmit');
  const errorMsg   = document.getElementById('formErrorMsg');
  const successDiv = document.getElementById('reservaSuccess');
  const successClose = document.getElementById('successClose');
  const fechaInput = document.getElementById('rf-fecha');
  const horaSelect = document.getElementById('rf-hora');

  let turnstileToken = null;
  let widgetId = null;

  function populateSlotsForDay(dayOfWeek) {
    horaSelect.innerHTML = '<option value="" disabled selected>Seleccioná un horario</option>';
    const franjas = cfg.horario.dias[dayOfWeek] ?? [];
    for (const { apertura, cierre } of franjas) {
      const [sH, sM] = apertura.split(':').map(Number);
      const [eH, eM] = cierre.split(':').map(Number);
      for (let h = sH; h <= eH; h++) {
        for (let m = (h === sH ? sM : 0); m < 60; m += SLOT_INTERVAL) {
          if (h === eH && m > eM) break;
          const hh = String(h).padStart(2, '0');
          const mm = String(m).padStart(2, '0');
          const opt = document.createElement('option');
          opt.value = `${hh}:${mm}`;
          opt.textContent = `${hh}:${mm} hs`;
          horaSelect.appendChild(opt);
        }
      }
    }
  }

  // --- Rango de fecha: mañana → +BOOKING_WINDOW días, sin días cerrados ---
  function setupFechaInput() {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const maxDate = new Date(today);
    maxDate.setDate(today.getDate() + BOOKING_WINDOW);

    const fmt = d => d.toISOString().split('T')[0];
    fechaInput.min = fmt(tomorrow);
    fechaInput.max = fmt(maxDate);

    fechaInput.addEventListener('input', () => {
      const chosen = new Date(fechaInput.value + 'T00:00:00');
      const day = chosen.getDay();
      const franjas = cfg.horario.dias[day] ?? [];
      if (franjas.length === 0) {
        fechaInput.setCustomValidity('Estamos cerrados ese día. Por favor elegí otro día.');
        horaSelect.innerHTML = '<option value="" disabled selected>Seleccioná un horario</option>';
      } else {
        fechaInput.setCustomValidity('');
        populateSlotsForDay(day);
      }
    });
  }

  setupFechaInput();

  // --- Abrir / cerrar ---
  function openModal() {
    if (widgetId !== null && window.turnstile) {
      window.turnstile.remove(widgetId);
      widgetId = null;
    }
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    formWrap.hidden = false;
    successDiv.hidden = true;
    errorMsg.classList.remove('show');
    overlay.querySelector('.modal-box').scrollTop = 0;

    turnstileToken = null;
    if (window.turnstile) {
      widgetId = window.turnstile.render('#turnstileContainer', {
        sitekey: import.meta.env.VITE_TURNSTILE_SITE_KEY,
        callback: (token) => {
          turnstileToken = token;
          errorMsg.classList.remove('show');
        },
        'expired-callback': () => {
          turnstileToken = null;
          errorMsg.textContent = 'La verificación expiró, volvé a completarla.';
          errorMsg.classList.add('show');
        },
        'error-callback': () => {
          turnstileToken = null;
          errorMsg.textContent = 'Error en la verificación. Recargá la página e intentá de nuevo.';
          errorMsg.classList.add('show');
        },
      });
    }
  }

  function closeModal() {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    if (widgetId !== null) {
      window.turnstile.remove(widgetId);
      widgetId = null;
      turnstileToken = null;
    }
  }

  // Disparadores de apertura
  document.querySelectorAll('.open-modal, #navReservar').forEach(btn => {
    btn.addEventListener('click', openModal);
  });

  modalClose.addEventListener('click', closeModal);
  successClose.addEventListener('click', closeModal);

  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) closeModal();
  });

  // --- Envío del formulario ---
  form.addEventListener('submit', async e => {
    e.preventDefault();
    errorMsg.classList.remove('show');

    // Validar campos requeridos
    const fields = form.querySelectorAll('[required]');
    let valid = true;
    fields.forEach(f => {
      f.classList.remove('error');
      if (!f.value.trim() || !f.checkValidity()) {
        f.classList.add('error');
        valid = false;
      }
    });

    if (!valid) {
      errorMsg.textContent = 'Por favor completá todos los campos requeridos.';
      errorMsg.classList.add('show');
      return;
    }

    if (!turnstileToken) {
      errorMsg.textContent = 'Completá la verificación anti-bot antes de confirmar.';
      errorMsg.classList.add('show');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviando…';

    const payload = {
      nombre:         form.nombre.value.trim(),
      telefono:       form.telefono.value.trim(),
      servicio:       form.servicio.value,
      fecha:          form.fecha.value,
      hora:           form.hora.value,
      mensaje:        form.mensaje.value.trim() || null,
      barberia_id:    cfg.barberia_id,
      turnstileToken,
    };

    // Reset widget immediately — token is single-use
    if (widgetId !== null && window.turnstile) {
      window.turnstile.reset(widgetId);
    }
    turnstileToken = null;

    let res, data;
    try {
      res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-reserva`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
    } catch {
      errorMsg.textContent = 'Sin conexión. Verificá tu internet e intentá de nuevo.';
      errorMsg.classList.add('show');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Confirmar reserva';
      return;
    }

    try {
      data = await res.json();
    } catch {
      data = {};
    }

    submitBtn.disabled = false;
    submitBtn.textContent = 'Confirmar reserva';

    if (!res.ok) {
      errorMsg.textContent = data?.error ?? 'Error al enviar la reserva. Intentá de nuevo o llamanos.';
      errorMsg.classList.add('show');
      return;
    }

    form.reset();
    formWrap.hidden = true;
    successDiv.hidden = false;
  });

  // Limpiar errores inline al corregir
  form.querySelectorAll('input, select, textarea').forEach(el => {
    el.addEventListener('input', () => el.classList.remove('error'));
  });
})();

/* =====================
   CANVAS: Gold Particle Field
   ===================== */
(function () {
  const canvas = document.getElementById('heroCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, particles, diagonals;
  const GOLD = [201, 168, 76];
  const COUNT = 55;
  const LINE_COUNT = 8;

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function randBetween(a, b) { return a + Math.random() * (b - a); }

  function initParticles() {
    particles = Array.from({ length: COUNT }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: randBetween(.4, 1.8),
      vx: randBetween(-.25, .25),
      vy: randBetween(-.4, -.1),
      alpha: randBetween(.1, .6),
      da: randBetween(-.003, .003),
    }));
  }

  function initDiagonals() {
    diagonals = Array.from({ length: LINE_COUNT }, (_, i) => ({
      x: (W / LINE_COUNT) * i + randBetween(-50, 50),
      speed: randBetween(.15, .45),
      alpha: randBetween(.018, .045),
      width: randBetween(.5, 1.2),
      offset: Math.random() * H,
    }));
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // Diagonal lines moving upward
    diagonals.forEach(d => {
      d.offset = (d.offset - d.speed + H) % H;
      const x1 = d.x - H * .6;
      const y1 = d.offset + H;
      const x2 = d.x + H * .6;
      const y2 = d.offset - H;

      const grad = ctx.createLinearGradient(x1, y1, x2, y2);
      grad.addColorStop(0,   `rgba(${GOLD},0)`);
      grad.addColorStop(.35, `rgba(${GOLD},${d.alpha})`);
      grad.addColorStop(.65, `rgba(${GOLD},${d.alpha})`);
      grad.addColorStop(1,   `rgba(${GOLD},0)`);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = grad;
      ctx.lineWidth = d.width;
      ctx.stroke();
    });

    // Particles
    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.alpha += p.da;
      if (p.alpha <= 0 || p.alpha >= .65) p.da *= -1;
      if (p.y < -5) { p.y = H + 5; p.x = Math.random() * W; }
      if (p.x < -5 || p.x > W + 5) { p.x = Math.random() * W; }

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${GOLD},${p.alpha})`;
      ctx.fill();
    });

    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', () => {
    resize();
    initDiagonals();
  }, { passive: true });

  resize();
  initParticles();
  initDiagonals();
  draw();
})();

/* =====================
   NAVBAR SCROLL
   ===================== */
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 50);
}, { passive: true });

/* =====================
   HAMBURGER MENU
   ===================== */
const hamburger = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobileMenu');

hamburger.addEventListener('click', () => {
  const open = hamburger.classList.toggle('open');
  mobileMenu.classList.toggle('open', open);
  document.body.style.overflow = open ? 'hidden' : '';
});

mobileMenu.querySelectorAll('a, button').forEach(link => {
  link.addEventListener('click', () => {
    hamburger.classList.remove('open');
    mobileMenu.classList.remove('open');
    // No resetear overflow si hay modal abierto
    if (!document.getElementById('modalReserva').classList.contains('open')) {
      document.body.style.overflow = '';
    }
  });
});

/* =====================
   REVEAL ON SCROLL
   ===================== */
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry, i) => {
    if (entry.isIntersecting) {
      const el = entry.target;
      const delay = parseFloat(el.dataset.delay || 0);
      setTimeout(() => el.classList.add('visible'), delay);
      revealObserver.unobserve(el);
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -30px 0px' });

document.querySelectorAll('.reveal').forEach((el, i) => {
  // Stagger siblings inside the same grid
  const siblings = el.parentElement.querySelectorAll('.reveal');
  const idx = Array.from(siblings).indexOf(el);
  el.dataset.delay = idx * 80;
  revealObserver.observe(el);
});

/* =====================
   ANIMATED COUNTERS
   ===================== */
function animateCounter(el) {
  const target = parseInt(el.dataset.target, 10);
  const duration = 1800;
  const start = performance.now();

  function step(now) {
    const progress = Math.min((now - start) / duration, 1);
    // Ease out quart
    const eased = 1 - Math.pow(1 - progress, 4);
    const value = Math.round(eased * target);
    el.textContent = value >= 1000
      ? value.toLocaleString('es-AR')
      : value.toString();
    if (progress < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

const counterObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      animateCounter(entry.target);
      counterObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.5 });

document.querySelectorAll('.stat-number[data-target]').forEach(el => {
  counterObserver.observe(el);
});

/* =====================
   BEFORE/AFTER DRAG
   ===================== */
document.querySelectorAll('.before-after').forEach(ba => {
  const divider = ba.querySelector('.ba-divider');
  const beforeSide = ba.querySelector('.before-side');
  let dragging = false;

  function setPosition(pct) {
    pct = Math.max(10, Math.min(90, pct));
    beforeSide.style.flex = `0 0 ${pct}%`;
    divider.style.left = `${pct}%`;
  }

  function getPercent(clientX) {
    const rect = ba.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * 100;
  }

  divider.addEventListener('mousedown', e => { dragging = true; e.preventDefault(); });
  window.addEventListener('mouseup', () => { dragging = false; });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    setPosition(getPercent(e.clientX));
  });

  // Touch
  divider.addEventListener('touchstart', e => { dragging = true; }, { passive: true });
  window.addEventListener('touchend', () => { dragging = false; });
  window.addEventListener('touchmove', e => {
    if (!dragging) return;
    setPosition(getPercent(e.touches[0].clientX));
  }, { passive: true });
});

/* =====================
   CUSTOM CURSOR
   ===================== */
(function () {
  const dot  = document.getElementById('cursorDot');
  const ring = document.getElementById('cursorRing');
  if (!dot || !ring) return;

  let mx = 0, my = 0, rx = 0, ry = 0;

  document.addEventListener('mousemove', e => {
    mx = e.clientX;
    my = e.clientY;
    dot.style.left = mx + 'px';
    dot.style.top  = my + 'px';
  }, { passive: true });

  function animateRing() {
    rx += (mx - rx) * 0.1;
    ry += (my - ry) * 0.1;
    ring.style.left = rx + 'px';
    ring.style.top  = ry + 'px';
    requestAnimationFrame(animateRing);
  }
  animateRing();

  const hoverTargets = 'a, button, .servicio-card, .galeria-card, .opinion-card, .open-modal, input, select, textarea';
  document.querySelectorAll(hoverTargets).forEach(el => {
    el.addEventListener('mouseenter', () => ring.classList.add('is-hover'));
    el.addEventListener('mouseleave', () => ring.classList.remove('is-hover'));
  });
})();
