# Confirmación por WhatsApp al reservar

**Fecha:** 2026-05-20  
**Estado:** aprobado para implementar

## Contexto

Cuando un cliente llena el formulario web, la reserva se guarda en Supabase pero el cliente no recibe ninguna notificación. La feature más visible para el cliente final es recibir un WhatsApp inmediato con los datos del turno. Como beneficio secundario, se unifica el formato del mensaje de confirmación para reservas hechas por WhatsApp (que ya reciben un mensaje, pero con texto generado por el LLM sin formato fijo).

## Decisiones de diseño

### Transporte: Supabase Realtime

El bot corre 24/7. Al suscribirse al canal de cambios `postgres_changes INSERT on public.reservas`, recibe el evento en tiempo real y manda el WhatsApp de inmediato. No requiere cron extra.

Filtro en el listener: solo procesa eventos con `confirmacion_enviada = false`. Las reservas creadas por el bot se insertan con `confirmacion_enviada = true`, por lo que el listener las ignora naturalmente — sin `if` explícito.

### Safety net: startup scan

Al arrancar, el bot consulta reservas con `confirmacion_enviada = false AND created_at > now() - interval '24 hours'`. Cubre el gap de un reinicio inesperado sin riesgo de reenviar reservas antiguas.

### Anti-doble-envío: UPDATE atómico

Antes de enviar el WhatsApp, el bot hace:

```sql
UPDATE reservas
SET confirmacion_enviada = true
WHERE id = ? AND confirmacion_enviada = false
```

Si la fila ya fue tomada por otra instancia (o el startup scan compite con Realtime al arrancar), `rowsUpdated = 0` y el proceso sale sin enviar. Mismo patrón que `markReminderSent` en `scheduler.js`.

### Separación de caminos

| Origen       | Quién envía la confirmación          | `confirmacion_enviada` al insertar |
|--------------|--------------------------------------|------------------------------------|
| Formulario web | `confirmaciones.js` vía Realtime   | `false`                            |
| Bot WhatsApp | `agent.js` inline (vía `tools.js`)  | `true`                             |

### Función compartida: `buildConfirmacion(reserva)`

Vive en `confirmaciones.js`. Usada por ambos caminos. Garantiza que el texto sea idéntico independientemente del canal.

### Semántica de `confirmacion_enviada`

`confirmacion_enviada = true` significa **"este turno ya fue procesado para evitar duplicados"**, no "el mensaje llegó al cliente". El flag se pone en `true` antes del `sendMessage` (UPDATE atómico). Si el envío falla, el flag queda en `true` igual — el admin recibe un aviso pero no se reintenta automáticamente. Esto es una decisión deliberada: preferimos perder una confirmación ocasional antes que spamear al cliente.

## Migración SQL y configuración Supabase

```sql
ALTER TABLE public.reservas
  ADD COLUMN IF NOT EXISTS confirmacion_enviada boolean DEFAULT false;
```

Las reservas existentes quedan con `false`, pero el startup scan las ignora por la ventana de 24 horas.

Además, habilitar Realtime en la tabla desde el SQL Editor de Supabase:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.reservas;
```

## Formato del mensaje

```
Listo, {nombre}. Te confirmo tu turno:

📅 {díaSemana} {DD/MM} a las {HH:MM}
💇 {servicio}
⏳ Dura {X} hora/s
💲 Precio: ${precio}

Cualquier cosa, avisame. {cierre}
```

**Reglas de formato:**

- `díaSemana`: nombre en español del día de la semana de `reserva.fecha` (ej: "Miércoles")
- `DD/MM`: día y mes con cero padding (ej: "20/05")
- `HH:MM`: hora tal como viene en `reserva.hora`
- `duracion_min`: viene de `reserva.duracion_min`; si es null, se busca en `config.js` via `findServiceByNombre()`
- Formato de duración: `< 60` → `"X minutos"`, `=== 60` → `"1 hora"`, `> 60` → `"X horas"` o `"X hora y Y minutos"` si no es múltiplo exacto
- `precio`: de `config.js` via `findServiceByNombre()`; formateado con separador de miles (`$18.000`); si el servicio no se encuentra → omitir la línea de precio silenciosamente
- `cierre` dinámico:
  - Si `reserva.fecha === hoy` → `"¡Nos vemos hoy!"`
  - Si `reserva.fecha === mañana` → `"¡Nos vemos mañana!"`
  - En cualquier otro caso → `"¡Nos vemos el {díaSemana}!"`

## Módulo `bot/confirmaciones.js`

### API pública

```
startConfirmaciones()
```

Llamado desde `index.js` después de `connectToWhatsApp()`. Abre la suscripción Realtime y corre el startup scan.

### Flujo interno

```
startConfirmaciones()
  ├─ supabase.channel('confirmaciones')
  │    .on('postgres_changes', { event: 'INSERT', table: 'reservas' }, handler)
  │    .subscribe()
  │
  └─ startup scan: query reservas WHERE confirmacion_enviada=false
                                   AND created_at > now()-24h
       → forEach → sendConfirmacion(reserva)

sendConfirmacion(reserva)
  ├─ UPDATE atómico (sale si rowsUpdated=0)
  ├─ jid = normalizePhoneToJid(reserva.telefono)  ← de state.js
  ├─ si jid inválido → notificar admin, return
  ├─ sock.sendMessage(jid, buildConfirmacion(reserva))
  └─ catch → notificar admin con id y teléfono de la reserva

notificarAdmin(texto)
  → sock.sendMessage(ADMIN_JID, texto)  si ADMIN_JID está configurado
  → console.error si no
```

## Cambios en módulos existentes

### `bot/tools.js` — `crear_reserva`

- Inserta con `confirmacion_enviada: true`
- Incluye `mensaje_confirmacion: buildConfirmacion(reserva)` en el objeto `data` retornado

### `bot/agent.js`

- Cuando el resultado de `crear_reserva` tiene `data.mensaje_confirmacion`, el loop de function calling termina ahí: `agent.js` devuelve ese texto directamente a `whatsapp.js` sin hacer otra vuelta al LLM. El LLM no genera el texto de confirmación — lo genera `buildConfirmacion()`.

### `bot/index.js`

```js
const { startConfirmaciones } = await import('./confirmaciones.js');
// después de connectToWhatsApp():
await startConfirmaciones();
```

### `bot/supabase.js`

- Nueva función `markConfirmacionEnviada(id)`: UPDATE atómico, devuelve `true` si actualizó la fila
- Nueva función `pendingConfirmaciones()`: SELECT WHERE confirmacion_enviada=false AND created_at > now()-24h

## Archivos modificados

| Archivo | Tipo de cambio |
|---|---|
| `bot/confirmaciones.js` | Nuevo |
| `bot/tools.js` | Modificado: insert con flag + devuelve mensaje_confirmacion |
| `bot/agent.js` | Modificado: usa mensaje_confirmacion del tool result |
| `bot/index.js` | Modificado: llama startConfirmaciones() |
| `bot/supabase.js` | Modificado: dos funciones nuevas |
| Supabase (SQL) | Nueva columna confirmacion_enviada |

## Lo que no cambia

- `main.js` (frontend): sin cambios — la reserva se inserta exactamente igual
- `scheduler.js`: sin cambios — los recordatorios 24h siguen siendo independientes
- `guard.js`: sin cambios
- `admin.html` / `admin.js`: sin cambios

## Casos de error

| Caso | Comportamiento |
|---|---|
| Teléfono no parseable | Notificar admin con id de reserva, continuar |
| `sendMessage` falla (número sin WhatsApp) | Notificar admin con id y teléfono, continuar |
| `ADMIN_JID` no configurado | `console.error`, nunca lanza |
| Supabase Realtime desconectado | El cliente de Supabase JS reconecta automáticamente; el startup scan en el próximo reinicio del bot cubre cualquier evento perdido durante el gap |
| `confirmacion_enviada` falta en reserva antigua | El UPDATE atómico simplemente no la toca |
