# Rediseño Frontend — Evolution Spa & Peluquería

**Fecha:** 2026-05-22  
**Enfoque aprobado:** A — Cinematic Magazine  
**Alcance:** Rediseño completo de `index.html` + `styles.css` + `main.js` (sección visual)

---

## Resumen

Rediseño completo del frontend de la landing page pública. Se mantiene la arquitectura existente (vanilla JS, Vite, sin framework), la paleta negro/dorado y el stack tipográfico (Cormorant Garant, Syne, Bebas Neue). Lo que cambia es la composición visual de cada sección: más drama, fotografía real de Unsplash, tipografía de sección en Bebas Neue a mayor escala, y layout tipo revista de lujo.

El diseño debe ser **100% responsive**: funcionar y verse bien en mobile (320px+), tablet (768px+) y desktop (1180px+).

---

## Fotografías (Unsplash)

Todas las imágenes son de Unsplash (sin costo, sin atribución obligatoria para uso comercial bajo Unsplash License). Se referencian por URL con parámetros de tamaño y calidad. Cuando el cliente tenga fotos del local, se reemplazan en `barberia.config.js` o directamente en el HTML.

| Uso | URL base |
|-----|----------|
| Hero fondo | `photo-1585747860715-2ba37e788b70` — silla de barbería dramática |
| Nosotros | `photo-1599351431202-1e0f0137899a` — interior barbería |
| Contacto fondo | `photo-1521490323096-16c67b2827e0` — barbero trabajando |
| Galería item 1 | `photo-1503951914875-452162b0f3f1` — barbería classic |
| Galería item 2 | `photo-1621605815971-fbc98d665033` — barba y tijeras |
| Galería item 3 | `photo-1599351431202-1e0f0137899a` — interior |
| Galería item 4 | `photo-1585747860715-2ba37e788b70` — silla |
| Galería item 5 | `photo-1534297635766-a262cdcb8ee4` — estilista |
| Antes (slider) | `photo-1503951914875-452162b0f3f1` — tono neutro/antes |
| Después (slider) | `photo-1621605815971-fbc98d665033` — resultado/después |

Formato de URL: `https://images.unsplash.com/{id}?w={w}&q={q}&auto=format&fit=crop`

---

## Secciones — Cambios por sección

### 1. Navbar
- Sin cambios estructurales.
- Logo mantiene "Evolution" en Cormorant Garant.
- En mobile: hamburger existente, sin cambios de lógica.

### 2. Hero ← **cambio principal**

**Layout:** Foto de barbería a pantalla completa (`100svh`). Overlay oscuro con gradiente `to top` (negro sólido en la base, transparente arriba). Navbar flotante sobre la foto.

**Composición:**
- Centro: badge "Abierto hoy" con dot verde pulsante (ya existe, se mantiene)
- Abajo a la izquierda: título en **Bebas Neue**, dos líneas — `TU MEJOR` / `VERSIÓN.` — tamaño `clamp(5rem, 13vw, 12rem)`, color blanco, "VERSIÓN." en dorado (`#C9A84C`)
- Abajo a la derecha: tagline en Cormorant italic + botón CTA primario
- Indicador de scroll: línea vertical con animación (ya existe, se mantiene)

**Responsive:**
- Mobile: título pasa a `clamp(3.8rem, 14vw, 5.5rem)`, CTA y tagline se apilan abajo centrados
- Tablet: layout igual al desktop pero con fuente más chica

**Foto:** Ken Burns suave al hacer hover / al cargar (`transform: scale(1.04)` con `transition: 12s ease-out`)

---

### 3. Marquee
- Sin cambios de contenido ni lógica.
- Ajuste visual: `font-size` más chico en mobile para que no corte.

### 4. Stats
- Números pasan a **Bebas Neue** (`font-size: clamp(3.5rem, 7vw, 6rem)`)
- Se mantiene el grid de 4 columnas en desktop
- Mobile: 2 columnas, sin dividers verticales

### 5. Servicios ← **cambio de encabezado + hover con foto**

**Encabezado:** label pequeño + título `NUESTROS SERVICIOS.` en **Bebas Neue** `clamp(3rem, 6vw, 6rem)`, alineado a la izquierda.

**Cards (grid 3×2):** Se mantiene el grid. Cada card agrega:
- Un `<div class="card-photo">` absoluto con foto Unsplash de ambiente, `opacity: 0` por defecto
- Al hover: `opacity: 0.12` — la foto se "filtra" debajo del contenido existente
- Número de card en Bebas Neue (ya existía, se redimensiona levemente)

**Responsive:**
- Tablet (≤1024px): 2 columnas
- Mobile (≤560px): 1 columna

### 6. Galería — Transformaciones ← **slider interactivo**

**Layout nuevo:** Grid asimétrico tipo magazine.
- Desktop: `grid-template-columns: 2fr 1fr 1fr` / `grid-template-rows: 280px 280px`
- El primer item ocupa `grid-row: 1 / 3` (grande, a la izquierda)
- Los otros 4 items llenan la derecha en 2×2

**Slider antes/después:** Una de las cards (la primera, la grande) se convierte en slider interactivo:
- Foto "antes" y foto "después" apiladas
- Divisor central draggable (mouse + touch)
- El divisor tiene un handle circular dorado con icono `◈` o flechas `⟺`
- Al arrastrar el divisor, cambia el `clip-path` o el `width` de la capa "después"
- Sin librerías externas — implementado en vanilla JS puro (~40 líneas)
- Label "Antes" / "Después" en esquinas superiores

**Responsive:**
- Tablet: grid `1fr 1fr` con rows auto, slider en pantalla completa de ancho
- Mobile: 1 columna, slider primero, luego las fotos restantes apiladas

### 7. Nosotros ← **split real con foto**

**Layout:** Grid `1fr 1fr`.
- Izquierda: `<img>` real de Unsplash (interior de barbería), `object-fit: cover`, `height: 100%`
- Derecha: contenido actual (texto + lista features + CTA)
- Overlay sutil en el borde derecho de la foto para la transición al fondo oscuro

**Reemplaza:** El arte CSS de círculos animados (`nosotros-art`) se elimina completamente.

**Responsive:**
- Tablet/Mobile: columna única — foto arriba (height fija 300px), contenido abajo

### 8. Proceso
- Sin cambios estructurales.
- Se puede actualizar el `step-number` a Bebas Neue para consistencia, pero el layout queda igual.

### 9. Opiniones
- Las comillas decorativas (`"`) pasan a Bebas Neue para consistencia
- Cards: sin cambios estructurales

### 10. Contacto ← **foto de fondo**

**Cambio:** La sección pasa de fondo liso a foto de barbero con overlay oscuro:
- `background-image` de Unsplash, `background-size: cover`, `background-position: center 20%`
- Overlay: `linear-gradient(to right, rgba(7,6,10,.95) 45%, rgba(7,6,10,.6) 100%)`
- El mapa iframe se mantiene a la derecha en desktop
- Responsive: el mapa desaparece en mobile, solo queda el contenido + CTA

### 11. Footer
- Sin cambios estructurales.
- Leve ajuste: logo en Cormorant Garant, más prominente.

### 12. Modal de reserva
- Sin cambios. Ya está bien diseñado.

---

## Tipografía de sección — Patrón unificado

Todos los títulos de sección principales migran a este patrón:

```
[LABEL PEQUEÑO con línea] ← Bebas Neue, 0.72rem, letter-spacing .3em, dorado
[TÍTULO EN BEBAS]         ← Bebas Neue, clamp(3rem, 6vw, 6rem), blanco
```

Subtítulos y cuerpo mantienen Cormorant Garant / Syne como está.

---

## Slider antes/después — Spec técnica

Implementación vanilla JS sin dependencias:

```
estructura HTML:
  .ba-container (position: relative, overflow: hidden)
    .ba-before   (position: absolute, inset: 0, img a pantalla completa)
    .ba-after    (position: absolute, inset: 0, img, clip-path: inset(0 {100-pos}% 0 0))
    .ba-handle   (position: absolute, top: 0, left: {pos}%, cursor: ew-resize)
      .ba-line   (1px, altura 100%, dorado)
      .ba-btn    (círculo dorado, ícono ◈ o flechas)
    .ba-label-before  (esquina superior izquierda)
    .ba-label-after   (esquina superior derecha)

JS:
  - escucha mousedown / touchstart en .ba-handle
  - en mousemove / touchmove: calcula % = (clientX - rect.left) / rect.width * 100
  - clamp entre 5% y 95%
  - actualiza handle.style.left y after clip-path
  - mouseup / touchend: limpia listeners
```

Posición inicial: 50%.

---

## Responsive — Breakpoints

| Breakpoint | Cambios clave |
|------------|---------------|
| `≤1024px` (tablet) | Servicios 2 col, nosotros apilado, contacto sin mapa |
| `≤768px` (mobile) | Navbar hamburger, hero título chico y apilado, galería 1 col |
| `≤560px` (mobile chico) | Stats 2 col, servicios 1 col, form una columna |

Regla general: **nunca texto que sangre fuera del viewport**, **nunca elementos con `width` fijo que rompan el layout**.

---

## Archivos a modificar

| Archivo | Cambios |
|---------|---------|
| `styles.css` | Rediseño completo de las secciones listadas. El resto (navbar, modal, botones, variables) se toca mínimamente. |
| `index.html` | Estructura de hero, galería (slider), nosotros (img real), contacto (div foto). |
| `main.js` | Agregar lógica del slider before/after (~40 líneas vanilla JS). El resto del JS no se toca. |

`admin.html`, `admin.css`, `admin.js`, `bot/` y Edge Functions: **no se tocan**.

---

## Lo que NO cambia

- Lógica de reserva (modal, Turnstile, Edge Function)
- Sistema de animaciones reveal (`.reveal` / IntersectionObserver)
- Config injection (`data-cfg`)
- Variables CSS (`:root`) — se pueden agregar, no eliminar
- Marquee, hamburger menu, cursor custom, canvas de fondo
