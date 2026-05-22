# Rediseño Frontend — Evolution Spa (Cinematic Magazine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseño completo del frontend público de Evolution Spa: hero con foto Unsplash full-screen, títulos de sección en Bebas Neue, galería asimétrica con slider before/after interactivo (vanilla JS), sección Nosotros con foto real, Contacto con foto de fondo. 100% responsive en 320px–1440px+.

**Architecture:** Tres archivos modificados — `index.html` (estructura HTML), `styles.css` (estilos visuales), `main.js` (slider JS ~50 líneas). No se crean archivos nuevos ni dependencias. Las fotos se sirven desde Unsplash CDN. Admin, bot y Edge Functions no se tocan.

**Tech Stack:** Vanilla HTML5/CSS3/JS ES2020+, Vite dev server (`npm run dev` → `http://localhost:5173`), Google Fonts (Bebas Neue, Cormorant Garant, Syne — ya cargadas en `<head>`), Unsplash CDN.

---

## Mapa de archivos

| Archivo | Qué cambia |
|---------|-----------|
| `index.html:71-118` | Hero section — estructura completamente nueva |
| `index.html:216-281` | Servicios — section-header reemplazado + card-bg-photo en cada card |
| `index.html:283-351` | Galería — grid asimétrico 5 items + slider en item grande |
| `index.html:354-394` | Nosotros — `.nosotros-art` reemplazado por `<img>` |
| `index.html:502-549` | Contacto — sin cambio de estructura (overlay via CSS) |
| `styles.css` | Hero nuevo, stats Bebas, servicios header, galería grid, slider CSS, nosotros foto, contacto foto, responsive |
| `main.js` | Agregar `initBeforeAfterSliders()` al final, antes de `</script>` |

---

## Task 1: Hero — Reestructurar HTML

**Files:**
- Modify: `index.html:71-118`

- [ ] **Step 1: Reemplazar el bloque `<section class="hero">` completo**

Localizar la sección entre `<!-- HERO -->` y `<!-- MARQUEE -->` (líneas 71-118) y reemplazar con:

```html
  <!-- HERO -->
  <section class="hero" id="inicio">
    <div class="hero-photo" aria-hidden="true"></div>
    <div class="hero-overlay" aria-hidden="true"></div>

    <div class="hero-center">
      <div class="hero-eyebrow">
        <span class="eyebrow-dot"></span>
        <span>Abierto hoy · Cierra a las 8 p.m.</span>
      </div>
    </div>

    <div class="hero-bottom">
      <h1 class="hero-mega-title">
        TU MEJOR<span>VERSIÓN.</span>
      </h1>
      <div class="hero-right">
        <p class="hero-tagline">
          Cortes, tinturas y tratamientos spa<br>
          para hombres y mujeres en Córdoba.
        </p>
        <button class="btn btn-primary open-modal">
          Reservar turno →
        </button>
      </div>
    </div>

    <div class="hero-scroll-hint">
      <div class="scroll-track">
        <div class="scroll-thumb"></div>
      </div>
      <span>Scroll</span>
    </div>
  </section>
```

- [ ] **Step 2: Verificar en browser**

Correr `npm run dev` si no está corriendo. Abrir `http://localhost:5173`. El hero debe mostrar fondo negro (todavía sin foto), el título "TU MEJOR" y "VERSIÓN." en texto plano, y el botón "Reservar turno". La navbar debe seguir flotando arriba. El modal debe abrir al clickear el botón.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "refactor: reestructurar hero HTML para diseño cinematic V3"
```

---

## Task 2: Hero — CSS

**Files:**
- Modify: `styles.css`

- [ ] **Step 1: Reemplazar bloque `/* HERO */` en styles.css**

Localizar el bloque que empieza con `/* ===================== HERO ===================== */` (aprox. línea 424) hasta `/* ===================== MARQUEE ===================== */`. Reemplazar **todo** ese bloque con el siguiente CSS:

```css
/* =====================
   HERO
   ===================== */
.hero {
  position: relative;
  height: 100svh;
  min-height: 640px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  overflow: hidden;
  background: #07060A;
  z-index: 1;
}

.hero-photo {
  position: absolute;
  inset: 0;
  background-image: url('https://images.unsplash.com/photo-1585747860715-2ba37e788b70?w=1800&q=85&auto=format&fit=crop');
  background-size: cover;
  background-position: center 30%;
  will-change: transform;
  transition: transform 12s ease-out;
  z-index: 0;
}
.hero:hover .hero-photo { transform: scale(1.04); }

.hero-overlay {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(to top, rgba(7,6,10,1) 0%, rgba(7,6,10,.6) 40%, rgba(7,6,10,.15) 70%, rgba(7,6,10,.45) 100%),
    linear-gradient(to right, rgba(7,6,10,.25) 0%, transparent 55%);
  z-index: 1;
}

.hero-center {
  position: relative;
  z-index: 3;
  display: flex;
  justify-content: center;
  padding-top: 6.5rem;
}

.hero-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: .65rem;
  font-family: 'Syne', sans-serif;
  font-size: .68rem;
  font-weight: 600;
  letter-spacing: .22em;
  text-transform: uppercase;
  color: var(--gold-light);
  background: rgba(201,168,76,.07);
  border: 1px solid rgba(201,168,76,.2);
  padding: .4rem 1.2rem;
  border-radius: 50px;
  animation: fadeDown .9s var(--ease-out) both;
}

.eyebrow-dot {
  width: 7px; height: 7px;
  background: #5CB85C;
  border-radius: 50%;
  flex-shrink: 0;
  animation: pulse 2.5s ease-in-out infinite;
}

.hero-bottom {
  position: relative;
  z-index: 3;
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  padding: 0 4% 4%;
  gap: 2rem;
}

.hero-mega-title {
  font-family: 'Bebas Neue', sans-serif;
  font-size: clamp(5rem, 13vw, 12rem);
  line-height: .88;
  letter-spacing: .015em;
  color: #fff;
  animation: slideUp 1s var(--ease-out) .2s both;
  flex-shrink: 0;
}
.hero-mega-title span {
  color: var(--gold);
  display: block;
}

.hero-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1.5rem;
  padding-bottom: .5rem;
  max-width: 280px;
  animation: slideUp 1s var(--ease-out) .4s both;
}

.hero-tagline {
  font-family: 'Cormorant Garant', serif;
  font-style: italic;
  font-size: 1.05rem;
  font-weight: 300;
  color: rgba(255,255,255,.45);
  line-height: 1.65;
  text-align: right;
}

/* Scroll hint — reposicionado a la derecha */
.hero-scroll-hint {
  position: absolute;
  bottom: 2rem;
  right: 3%;
  left: auto;
  transform: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: .5rem;
  color: rgba(234,230,220,.2);
  font-family: 'Syne', sans-serif;
  font-size: .6rem;
  letter-spacing: .22em;
  text-transform: uppercase;
  z-index: 3;
}

.scroll-track {
  width: 1.5px;
  height: 50px;
  background: rgba(201,168,76,.1);
  border-radius: 2px;
  overflow: hidden;
}
.scroll-thumb {
  width: 100%; height: 50%;
  background: var(--gold);
  border-radius: 2px;
  animation: scrollThumb 2.5s var(--ease) infinite;
}
@keyframes scrollThumb {
  0%   { transform: translateY(-100%); opacity: 0; }
  20%  { opacity: 1; }
  80%  { opacity: 1; }
  100% { transform: translateY(200%); opacity: 0; }
}
```

- [ ] **Step 2: Verificar en browser**

Abrir `http://localhost:5173`. Debe verse:
- Foto de silla de barbería a pantalla completa con overlay oscuro gradiente
- Badge "Abierto hoy" centrado en la parte alta
- "TU MEJOR / VERSIÓN." en Bebas Neue grande abajo-izquierda, "VERSIÓN." en dorado
- Tagline italic + botón dorado abajo-derecha
- Navbar transparente sobre la foto, se vuelve oscura al scrollear
- Efecto Ken Burns (zoom suave) al hacer hover en el hero

- [ ] **Step 3: Commit**

```bash
git add styles.css
git commit -m "feat: hero cinematic — foto Unsplash full-screen, Bebas Neue mega-title"
```

---

## Task 3: Stats Bebas Neue + patrón de encabezados de sección

**Files:**
- Modify: `styles.css`

- [ ] **Step 1: Cambiar fuente de `.stat-number` a Bebas Neue**

Localizar `.stat-number` en styles.css y reemplazar solo las propiedades `font-family` y `font-size`:

```css
.stat-number {
  font-family: 'Bebas Neue', sans-serif;
  font-size: clamp(3.5rem, 7vw, 6rem);
  font-weight: 400;
  color: var(--gold);
  line-height: 1;
  margin-bottom: .55rem;
  letter-spacing: .02em;
}
```

- [ ] **Step 2: Agregar clase `.section-heading-bebas` al final del bloque de tipografía**

Localizar el bloque `/* ===================== TYPOGRAPHY ===================== */` y agregar al final de ese bloque (antes del siguiente comentario de sección):

```css
/* Encabezados de sección en Bebas Neue — usado en Servicios, Galería, Nosotros, Contacto */
.section-heading-bebas {
  font-family: 'Bebas Neue', sans-serif;
  font-size: clamp(3rem, 6vw, 6rem);
  line-height: .9;
  letter-spacing: .02em;
  color: #fff;
  margin-bottom: 3.5rem;
}

.section-header-left {
  text-align: left;
  max-width: none;
  margin: 0 0 3.5rem;
}
.section-header-left .section-label {
  justify-content: flex-start;
}
.section-header-left .section-label::before { display: inline-block; }
.section-header-left .section-label::after { display: none; }
```

- [ ] **Step 3: Verificar en browser**

Scrollear a la sección Stats. Los números (5, 3200, 6, 220) deben aparecer en Bebas Neue — fuente más condensada y bold que Cormorant Garant.

- [ ] **Step 4: Commit**

```bash
git add styles.css
git commit -m "feat: stats y encabezados de sección a Bebas Neue"
```

---

## Task 4: Servicios — Encabezado Bebas + foto en hover

**Files:**
- Modify: `index.html:216-281`
- Modify: `styles.css`

- [ ] **Step 1: Reemplazar section-header de Servicios en index.html**

Localizar el bloque:
```html
      <div class="section-header reveal">
        <span class="section-label">Lo que hacemos</span>
        <h2>Nuestros servicios</h2>
        <p>Cada visita es una experiencia diseñada para que te vayas sintiéndote increíble.</p>
      </div>
```

Reemplazar con:
```html
      <div class="section-header-left reveal">
        <span class="section-label">Lo que hacemos</span>
        <h2 class="section-heading-bebas">Nuestros<br>servicios.</h2>
      </div>
```

- [ ] **Step 2: Agregar `.card-bg-photo` a cada servicio-card**

Cada `.servicio-card` necesita un div con foto como primer hijo. Reemplazar las 6 cards con:

```html
        <div class="servicio-card reveal" data-num="01">
          <div class="card-bg-photo" style="background-image:url('https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=600&q=70&auto=format&fit=crop')"></div>
          <div class="card-border-sweep"></div>
          <div class="servicio-icon-wrap">
            <span class="servicio-icon">✂</span>
          </div>
          <h3>Corte de cabello</h3>
          <p>Cortes clásicos y modernos adaptados a tu estilo, forma de cara y preferencias personales.</p>
          <div class="card-arrow">→</div>
        </div>
        <div class="servicio-card featured reveal" data-num="02">
          <div class="card-bg-photo" style="background-image:url('https://images.unsplash.com/photo-1560869713-7d0a29430803?w=600&q=70&auto=format&fit=crop')"></div>
          <div class="card-border-sweep"></div>
          <div class="servicio-badge">Popular</div>
          <div class="servicio-icon-wrap">
            <span class="servicio-icon">◈</span>
          </div>
          <h3>Tintura & Coloración</h3>
          <p>Desde mechas y balayage hasta cambios de color completos con productos de alta calidad.</p>
          <div class="card-arrow">→</div>
        </div>
        <div class="servicio-card reveal" data-num="03">
          <div class="card-bg-photo" style="background-image:url('https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=600&q=70&auto=format&fit=crop')"></div>
          <div class="card-border-sweep"></div>
          <div class="servicio-icon-wrap">
            <span class="servicio-icon">◉</span>
          </div>
          <h3>Tratamientos Spa</h3>
          <p>Hidratación profunda, keratinas y tratamientos capilares para restaurar tu cabello.</p>
          <div class="card-arrow">→</div>
        </div>
        <div class="servicio-card reveal" data-num="04">
          <div class="card-bg-photo" style="background-image:url('https://images.unsplash.com/photo-1534297635766-a262cdcb8ee4?w=600&q=70&auto=format&fit=crop')"></div>
          <div class="card-border-sweep"></div>
          <div class="servicio-icon-wrap">
            <span class="servicio-icon">✦</span>
          </div>
          <h3>Styling & Peinados</h3>
          <p>Peinados para eventos especiales, bodas o el día a día. Te hacemos lucir perfecto.</p>
          <div class="card-arrow">→</div>
        </div>
        <div class="servicio-card reveal" data-num="05">
          <div class="card-bg-photo" style="background-image:url('https://images.unsplash.com/photo-1621605815971-fbc98d665033?w=600&q=70&auto=format&fit=crop')"></div>
          <div class="card-border-sweep"></div>
          <div class="servicio-icon-wrap">
            <span class="servicio-icon">⌁</span>
          </div>
          <h3>Afeitado & Barba</h3>
          <p>Afeitado tradicional con navaja y perfilado de barba con técnica artesanal.</p>
          <div class="card-arrow">→</div>
        </div>
        <div class="servicio-card reveal" data-num="06">
          <div class="card-bg-photo" style="background-image:url('https://images.unsplash.com/photo-1620332372374-f108c53d2e03?w=600&q=70&auto=format&fit=crop')"></div>
          <div class="card-border-sweep"></div>
          <div class="servicio-icon-wrap">
            <span class="servicio-icon">❋</span>
          </div>
          <h3>Cuidado capilar</h3>
          <p>Masajes capilares y tratamientos anticaída para la salud y vitalidad de tu cabello.</p>
          <div class="card-arrow">→</div>
        </div>
```

- [ ] **Step 3: Agregar CSS para `.card-bg-photo`**

Localizar el bloque `/* ===================== SERVICIOS ===================== */` en styles.css. Agregar después de `.card-border-sweep { display: none; }`:

```css
.card-bg-photo {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  opacity: 0;
  transition: opacity .5s var(--ease);
  z-index: 0;
  border-radius: inherit;
}
.servicio-card:hover .card-bg-photo { opacity: .1; }
```

- [ ] **Step 4: Verificar en browser**

Scrollear a Servicios. Debe verse:
- Encabezado "NUESTROS / SERVICIOS." en Bebas Neue grande, alineado a la izquierda
- Al hacer hover en cualquier card, debe aparecer sutilmente una foto de ambiente debajo del contenido (opacity 10%)

- [ ] **Step 5: Commit**

```bash
git add index.html styles.css
git commit -m "feat: servicios — encabezado Bebas Neue + hover foto de ambiente"
```

---

## Task 5: Nosotros — Reemplazar arte CSS por foto real

**Files:**
- Modify: `index.html:354-394`
- Modify: `styles.css`

- [ ] **Step 1: Reemplazar `.nosotros-visual` en index.html**

Localizar el bloque completo de `<div class="nosotros-visual reveal">` (que contiene `.nosotros-art`, `.art-circle`, `.art-glyph`, `.art-badge`, etc.) y reemplazarlo con:

```html
      <div class="nosotros-visual reveal">
        <div class="nosotros-photo-wrap">
          <img
            src="https://images.unsplash.com/photo-1599351431202-1e0f0137899a?w=900&q=85&auto=format&fit=crop"
            alt="Interior de Evolution Spa & Peluquería"
            class="nosotros-photo-img"
            loading="lazy"
          >
          <div class="nosotros-photo-overlay"></div>
        </div>
      </div>
```

- [ ] **Step 2: Actualizar el h2 de Nosotros a Bebas Neue**

Localizar dentro del `.nosotros-content`:
```html
        <h2>Pasión por el detalle, dedicación en cada corte</h2>
```
Reemplazar con:
```html
        <h2 class="section-heading-bebas" style="margin-bottom:1.4rem">Pasión por<br>el <span style="color:var(--gold)">detalle.</span></h2>
```

- [ ] **Step 3: Agregar CSS para la foto de Nosotros**

Localizar `/* ===================== NOSOTROS ===================== */` en styles.css. Reemplazar el bloque `.nosotros-visual` y todo el arte CSS (`.nosotros-art`, `.art-circle`, `.art-c1`, `.art-c2`, `.art-c3`, `.art-lines`, `.art-line`, `.art-glyph`, `.art-badge`, `.badge-year`, `.badge-text`) con:

```css
.nosotros-visual {
  position: relative;
  overflow: hidden;
  border-radius: var(--r-lg);
  min-height: 480px;
}

.nosotros-photo-wrap {
  width: 100%;
  height: 100%;
  position: absolute;
  inset: 0;
}

.nosotros-photo-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  display: block;
  filter: brightness(.82) contrast(1.05) saturate(.88);
}

.nosotros-photo-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(to right, transparent 60%, rgba(7,6,10,.95) 100%);
}
```

Mantener el resto del bloque Nosotros (`.nosotros-inner`, `.nosotros-content`, `.nosotros-features`, `.feat-num`) sin cambios.

- [ ] **Step 4: Verificar en browser**

Scrollear a Nosotros. Debe verse:
- Foto de interior de barbería en el lado izquierdo, con un fade a negro hacia la derecha
- Texto del lado derecho sin cambios
- Layout 50/50 en desktop

- [ ] **Step 5: Commit**

```bash
git add index.html styles.css
git commit -m "feat: nosotros — reemplazar arte CSS por foto real Unsplash"
```

---

## Task 6: Galería — Grid asimétrico con fotos reales

**Files:**
- Modify: `index.html:283-351`
- Modify: `styles.css`

- [ ] **Step 1: Reemplazar el bloque `<div class="galeria-grid">` en index.html**

Localizar `<div class="galeria-grid">` y todo su contenido (las 3 `.galeria-card`). Reemplazar con:

```html
      <div class="galeria-grid">
        <!-- Item grande — tendrá el slider before/after en Task 7 -->
        <div class="galeria-item galeria-item--large reveal" id="galeriaSlider">
          <img
            src="https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=900&h=600&q=85&auto=format&fit=crop"
            alt="Transformación en Evolution Spa"
            loading="lazy"
          >
        </div>
        <div class="galeria-item reveal">
          <img
            src="https://images.unsplash.com/photo-1621605815971-fbc98d665033?w=600&h=300&q=80&auto=format&fit=crop"
            alt="Servicio de barba"
            loading="lazy"
          >
        </div>
        <div class="galeria-item reveal">
          <img
            src="https://images.unsplash.com/photo-1599351431202-1e0f0137899a?w=600&h=300&q=80&auto=format&fit=crop"
            alt="Interior barbería"
            loading="lazy"
          >
        </div>
        <div class="galeria-item reveal">
          <img
            src="https://images.unsplash.com/photo-1585747860715-2ba37e788b70?w=600&h=300&q=80&auto=format&fit=crop"
            alt="Silla de barbería"
            loading="lazy"
          >
        </div>
        <div class="galeria-item reveal">
          <img
            src="https://images.unsplash.com/photo-1534297635766-a262cdcb8ee4?w=600&h=300&q=80&auto=format&fit=crop"
            alt="Estilista trabajando"
            loading="lazy"
          >
        </div>
      </div>
```

También reemplazar el encabezado de la sección galería (`.section-header reveal` dentro de galería):
```html
      <div class="section-header-left reveal">
        <span class="section-label">Nuestro trabajo</span>
        <h2 class="section-heading-bebas">Transformaciones.</h2>
        <p style="color:var(--text-dim);font-size:.9rem;margin-top:-.5rem;margin-bottom:0">Cada corte cuenta una historia.</p>
      </div>
```

- [ ] **Step 2: Reemplazar CSS del bloque `/* ===================== GALERÍA ===================== */` en styles.css**

Reemplazar todo el bloque galería (`.galeria` hasta `.galeria-info span`) con:

```css
/* =====================
   GALERÍA
   ===================== */
.galeria {
  padding: 8rem 0;
  background: var(--ink-2);
}

.galeria-grid {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  grid-template-rows: 280px 280px;
  gap: 8px;
  margin-top: 3.5rem;
}

.galeria-item {
  border-radius: 8px;
  overflow: hidden;
  position: relative;
  background: var(--ink-3);
}

.galeria-item--large {
  grid-row: 1 / 3;
}

.galeria-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  display: block;
  filter: brightness(.88) saturate(.88);
  transition: transform .65s var(--ease);
}
.galeria-item:hover img { transform: scale(1.05); }

.galeria-item::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, rgba(7,6,10,.55) 0%, transparent 50%);
  pointer-events: none;
}
```

- [ ] **Step 3: Actualizar selector de cursor hover en main.js**

Localizar en `main.js` la línea con `hoverTargets` (aprox. línea 550):
```javascript
const hoverTargets = 'a, button, .servicio-card, .galeria-card, .opinion-card, .open-modal, input, select, textarea';
```
Reemplazar `.galeria-card` por `.galeria-item`:
```javascript
const hoverTargets = 'a, button, .servicio-card, .galeria-item, .opinion-card, .open-modal, input, select, textarea';
```

- [ ] **Step 4: Verificar en browser**

Scrollear a Galería. Debe verse:
- Grid asimétrico: foto grande a la izquierda (ocupa toda la altura), 4 fotos en 2×2 a la derecha
- Hover en cualquier foto hace zoom suave
- El título "TRANSFORMACIONES." en Bebas Neue, alineado a la izquierda

- [ ] **Step 5: Commit**

```bash
git add index.html styles.css main.js
git commit -m "feat: galería — grid asimétrico magazine con fotos reales Unsplash"
```

---

## Task 7: Slider Before/After — HTML + CSS + JS

**Files:**
- Modify: `index.html` (dentro de `#galeriaSlider`)
- Modify: `styles.css`
- Modify: `main.js`

- [ ] **Step 1: Reemplazar contenido del item grande en index.html**

Localizar `<div class="galeria-item galeria-item--large reveal" id="galeriaSlider">` y reemplazar su `<img>` con el markup del slider:

```html
        <div class="galeria-item galeria-item--large reveal" id="galeriaSlider">
          <div class="ba-slider" role="img" aria-label="Comparación antes y después de corte de cabello">
            <div class="ba-before">
              <img
                src="https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=900&h=600&q=85&auto=format&fit=crop"
                alt="Antes"
                draggable="false"
              >
              <span class="ba-label ba-label--before">Antes</span>
            </div>
            <div class="ba-after">
              <img
                src="https://images.unsplash.com/photo-1621605815971-fbc98d665033?w=900&h=600&q=85&auto=format&fit=crop"
                alt="Después"
                draggable="false"
              >
              <span class="ba-label ba-label--after">Después</span>
            </div>
            <div class="ba-slider-handle" aria-hidden="true">
              <div class="ba-slider-line"></div>
              <div class="ba-slider-btn">◈</div>
            </div>
          </div>
        </div>
```

- [ ] **Step 2: Agregar CSS del slider**

Al final del bloque `/* ===================== GALERÍA ===================== */` en styles.css, agregar:

```css
/* Before/After Slider */
.ba-slider {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
  cursor: ew-resize;
  touch-action: pan-y;
}

.ba-before,
.ba-after {
  position: absolute;
  inset: 0;
}

.ba-before img,
.ba-after img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  display: block;
  pointer-events: none;
  filter: brightness(.88) saturate(.88);
}

.ba-after {
  clip-path: inset(0 50% 0 0);
}

.ba-label {
  position: absolute;
  top: .85rem;
  z-index: 3;
  font-family: 'Syne', sans-serif;
  font-size: .6rem;
  font-weight: 700;
  letter-spacing: .18em;
  text-transform: uppercase;
  color: var(--text);
  background: rgba(7,6,10,.6);
  padding: .22rem .75rem;
  border-radius: 50px;
  backdrop-filter: blur(6px);
  border: 1px solid var(--border);
  pointer-events: none;
}
.ba-label--before { left: .85rem; }
.ba-label--after  { right: .85rem; }

.ba-slider-handle {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 44px;
  height: 100%;
  z-index: 4;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: ew-resize;
}

.ba-slider-line {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 2px;
  background: linear-gradient(to bottom, transparent, var(--gold) 15%, var(--gold) 85%, transparent);
}

.ba-slider-btn {
  width: 38px;
  height: 38px;
  background: var(--gold);
  color: var(--ink);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: .85rem;
  box-shadow: 0 4px 20px rgba(0,0,0,.5);
  position: relative;
  z-index: 5;
  transition: transform .2s var(--ease-spring), box-shadow .2s;
}
.ba-slider:active .ba-slider-btn,
.ba-slider-handle:hover .ba-slider-btn {
  transform: scale(1.12);
  box-shadow: 0 6px 28px rgba(201,168,76,.5);
}
```

- [ ] **Step 3: Agregar `initBeforeAfterSliders` en main.js**

Al final de `main.js`, antes del último cierre de módulo, agregar la función completa:

```javascript
/* =====================
   SLIDER ANTES/DESPUÉS
   ===================== */
;(function () {
  function initBeforeAfterSliders() {
    document.querySelectorAll('.ba-slider').forEach(slider => {
      const handle = slider.querySelector('.ba-slider-handle');
      const after  = slider.querySelector('.ba-after');
      if (!handle || !after) return;

      let dragging = false;

      function setPos(clientX) {
        const rect = slider.getBoundingClientRect();
        const pct  = Math.max(5, Math.min(95, (clientX - rect.left) / rect.width * 100));
        handle.style.left        = pct + '%';
        after.style.clipPath     = `inset(0 ${100 - pct}% 0 0)`;
      }

      /* Mouse */
      slider.addEventListener('mousedown', e => {
        dragging = true;
        setPos(e.clientX);
        e.preventDefault();
      });
      window.addEventListener('mouseup',   () => { dragging = false; });
      window.addEventListener('mousemove', e => { if (dragging) setPos(e.clientX); });

      /* Touch */
      slider.addEventListener('touchstart', e => {
        dragging = true;
        setPos(e.touches[0].clientX);
      }, { passive: true });
      window.addEventListener('touchend',   () => { dragging = false; });
      window.addEventListener('touchmove',  e => {
        if (dragging) setPos(e.touches[0].clientX);
      }, { passive: true });
    });
  }

  initBeforeAfterSliders();
})();
```

- [ ] **Step 4: Verificar en browser — desktop**

Scrollear a la sección Galería. En el item grande de la izquierda:
- Debe verse una imagen dividida en dos: izquierda "Antes", derecha "Después"
- El divisor dorado con círculo debe estar en el centro
- Hacer click y arrastrar hacia izquierda/derecha debe mover el divisor y cambiar la proporción visible de cada foto
- Los labels "Antes" / "Después" deben estar en las esquinas superiores correspondientes

- [ ] **Step 5: Verificar en browser — touch/mobile**

En DevTools, activar modo responsive (iPhone 375px o Galaxy S20). Verificar:
- El slider funciona con touch (tap + arrastrar)
- El scroll de la página no interfiere con el drag del slider (el slider es horizontal, el scroll es vertical — no deben conflictuarse)

- [ ] **Step 6: Commit**

```bash
git add index.html styles.css main.js
git commit -m "feat: slider before/after interactivo — mouse y touch, vanilla JS"
```

---

## Task 8: Contacto — Foto de fondo

**Files:**
- Modify: `styles.css`

- [ ] **Step 1: Actualizar CSS del bloque `/* ===================== CONTACTO ===================== */`**

Localizar `.contacto {` y reemplazar solo esa regla base:

```css
.contacto {
  padding: 8rem 0;
  background: var(--ink-2);
  position: relative;
  overflow: hidden;
}
```

Por:

```css
.contacto {
  padding: 8rem 0;
  position: relative;
  overflow: hidden;
}

.contacto::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: url('https://images.unsplash.com/photo-1521490323096-16c67b2827e0?w=1600&q=80&auto=format&fit=crop');
  background-size: cover;
  background-position: center 20%;
  z-index: 0;
}

.contacto::after {
  content: '';
  position: absolute;
  inset: 0;
  background:
    linear-gradient(to right, rgba(7,6,10,.97) 0%, rgba(7,6,10,.92) 45%, rgba(7,6,10,.65) 100%),
    linear-gradient(to top, rgba(7,6,10,.5) 0%, transparent 40%);
  z-index: 1;
}

.contacto-inner {
  position: relative;
  z-index: 2;
}
```

También actualizar el h2 de Contacto. Localizar en styles.css:
```css
.contacto-info h2 {
  font-size: clamp(2rem, 3.2vw, 3rem);
  margin-bottom: 1.1rem;
  letter-spacing: -.01em;
  line-height: 1.15;
}
```
Reemplazar con:
```css
.contacto-info h2 {
  font-family: 'Bebas Neue', sans-serif;
  font-size: clamp(3rem, 5vw, 5rem);
  margin-bottom: 1.1rem;
  letter-spacing: .02em;
  line-height: .92;
  color: #fff;
}
```

- [ ] **Step 2: Verificar en browser**

Scrollear a Contacto. Debe verse:
- Foto de barbero de fondo, casi invisible a la izquierda (overlay ~97%) y más visible a la derecha (~35%)
- Mapa iframe a la derecha mantiene su posición
- Texto e información de contacto bien legibles sobre el fondo oscuro

- [ ] **Step 3: Commit**

```bash
git add styles.css
git commit -m "feat: contacto — foto de barbero como fondo con overlay oscuro"
```

---

## Task 9: Responsive CSS — Todos los elementos nuevos

**Files:**
- Modify: `styles.css` (bloques `@media`)

- [ ] **Step 1: Actualizar breakpoint `@media (max-width: 1024px)`**

Localizar el bloque `@media (max-width: 1024px)` en styles.css y agregar al final del bloque (sin reemplazar las reglas existentes):

```css
  /* Hero */
  .hero-mega-title { font-size: clamp(4rem, 10vw, 7rem); }
  .hero-right { max-width: 240px; }

  /* Galería asimétrica → 2 columnas en tablet */
  .galeria-grid {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 320px 220px 220px;
  }
  .galeria-item--large {
    grid-row: 1 / 2;
    grid-column: 1 / 3;
  }

  /* Nosotros */
  .nosotros-photo-overlay {
    background: linear-gradient(to bottom, transparent 60%, rgba(7,6,10,.95) 100%);
  }

  /* Contacto */
  .contacto::after {
    background: linear-gradient(to bottom, rgba(7,6,10,.75) 0%, rgba(7,6,10,.97) 100%);
  }
```

- [ ] **Step 2: Actualizar breakpoint `@media (max-width: 768px)`**

Localizar el bloque `@media (max-width: 768px)` y agregar al final del bloque:

```css
  /* Hero mobile */
  .hero-bottom {
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 0 5% 8%;
    gap: 1.25rem;
  }
  .hero-mega-title {
    font-size: clamp(3.8rem, 14vw, 5.5rem);
    text-align: center;
  }
  .hero-right {
    align-items: center;
    max-width: 100%;
    gap: 1rem;
  }
  .hero-tagline { text-align: center; }
  .hero-scroll-hint { display: none; }

  /* Galería mobile → 1 columna */
  .galeria-grid {
    grid-template-columns: 1fr;
    grid-template-rows: auto;
    gap: 6px;
  }
  .galeria-item--large {
    grid-row: auto;
    grid-column: auto;
    height: 320px;
  }
  .galeria-item { height: 200px; }

  /* Nosotros foto mobile */
  .nosotros-visual {
    min-height: 280px;
    border-radius: 0;
    display: block;
  }
  .nosotros-photo-wrap {
    position: relative;
    height: 280px;
  }

  /* Section heading bebas mobile */
  .section-heading-bebas { font-size: clamp(2.6rem, 10vw, 4rem); }
```

- [ ] **Step 3: Actualizar breakpoint `@media (max-width: 560px)`**

Localizar el bloque `@media (max-width: 560px)` y agregar al final:

```css
  /* Hero extra-small */
  .hero-mega-title { font-size: clamp(3.2rem, 15vw, 4.5rem); }
  .hero-center { padding-top: 5.5rem; }

  /* Section headings extra-small */
  .section-heading-bebas { font-size: clamp(2.2rem, 12vw, 3.5rem); }

  /* Stats extra-small: ya tenía flex-wrap */
  .stat-number { font-size: clamp(3rem, 10vw, 4.5rem); }

  /* Galería slider touch area */
  .ba-slider-btn { width: 44px; height: 44px; font-size: 1rem; }

  /* Contacto mobile: texto legible sin foto visible */
  .contacto::before { opacity: .25; }
```

- [ ] **Step 4: Verificar responsive completo**

En DevTools, probar 4 viewports:

**Desktop (1280px):**
- Hero: foto full, título Bebas izquierda, tagline+CTA derecha
- Galería: 2fr+1fr+1fr, item grande ocupa 2 rows
- Nosotros: 50/50 foto+contenido

**Tablet (768px):**
- Hero: título centrado, CTA centrado, apilados
- Galería: item grande span full-width (top), 2×2 abajo
- Nosotros: foto arriba 280px, contenido abajo

**Mobile (375px):**
- Hero: título chico centrado, sin scroll hint
- Galería: todo en 1 columna, slider 320px de alto
- Slider funciona con dedo
- Stats: 2 columnas
- Servicios: 1 columna

**Mobile chico (320px):**
- Hero: título legible sin overflow horizontal
- Nada se corta fuera del viewport

- [ ] **Step 5: Commit**

```bash
git add styles.css
git commit -m "feat: responsive completo — hero, galería, nosotros, headings 320px–1440px"
```

---

## Task 10: Opiniones — Comillas en Bebas + sección label

**Files:**
- Modify: `styles.css`
- Modify: `index.html` (section-header de opiniones)

- [ ] **Step 1: Actualizar section-header de Opiniones en index.html**

Localizar el `.section-header reveal` dentro de `<section class="opiniones">` y reemplazar:
```html
      <div class="section-header reveal">
        <span class="section-label">Lo que dicen nuestros clientes</span>
        <h2>Opiniones</h2>
        <div class="rating-overview">
```
Por:
```html
      <div class="section-header reveal">
        <span class="section-label">Lo que dicen nuestros clientes</span>
        <h2 class="section-heading-bebas" style="font-size:clamp(3rem,6vw,5.5rem);margin-bottom:1.5rem">Opiniones.</h2>
        <div class="rating-overview">
```

- [ ] **Step 2: Cambiar fuente de `.opinion-quote` a Bebas Neue en styles.css**

Localizar `.opinion-quote` en styles.css y cambiar `font-family`:

```css
.opinion-quote {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 7rem;
  color: var(--gold);
  opacity: .12;
  line-height: .7;
  margin-bottom: -.5rem;
  display: block;
}
```

- [ ] **Step 3: Verificar en browser**

Scrollear a Opiniones. Las comillas decorativas de las cards deben verse en Bebas Neue (más condensada, más bold). El título "OPINIONES." en Bebas grande centrado.

- [ ] **Step 4: Commit**

```bash
git add index.html styles.css
git commit -m "feat: opiniones — título Bebas Neue, comillas actualizadas"
```

---

## Self-Review

### Cobertura del spec vs plan

| Req. del spec | Tarea que lo cubre |
|---|---|
| Hero foto Unsplash full-screen | Task 1 + Task 2 |
| Bebas Neue mega-title `TU MEJOR / VERSIÓN.` | Task 2 |
| Ken Burns hover | Task 2 |
| Stats Bebas Neue | Task 3 |
| Patrón encabezados Bebas (`.section-heading-bebas`) | Task 3 |
| Servicios Bebas header + card foto hover | Task 4 |
| Nosotros foto real, adiós arte CSS | Task 5 |
| Galería asimétrica 2fr 1fr 1fr | Task 6 |
| Slider before/after draggable mouse + touch | Task 7 |
| Contacto foto de fondo + overlay | Task 8 |
| Responsive 320px–1440px | Task 9 |
| Opiniones comillas Bebas | Task 10 |
| Modal sin cambios | ✓ No tocado |
| Admin/bot sin cambios | ✓ No tocado |
| `.open-modal` conservado en hero CTA | Task 1 ✓ |
| `.reveal` / IntersectionObserver conservado | ✓ Classes mantenidas en HTML |
| Cursor hover actualizado para `.galeria-item` | Task 6 Step 3 |

### Placeholder scan
Sin TBD, TODO ni referencias a métodos indefinidos. Todas las URLs de Unsplash son IDs reales. Los nombres de clase son consistentes entre HTML y CSS tasks.

### Consistencia de tipos/nombres
- `.ba-slider` → `.ba-before` / `.ba-after` / `.ba-slider-handle` — consistente en Tasks 7 HTML y CSS
- `.galeria-item` y `.galeria-item--large` — consistente en Tasks 6 y 9
- `.section-heading-bebas` — definido en Task 3, usado en Tasks 4, 5, 10
- `initBeforeAfterSliders()` — definido y llamado en Task 7
