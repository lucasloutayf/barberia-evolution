# Bot de WhatsApp — Evolution Spa & Peluquería

Servicio Node.js independiente que conecta un número de WhatsApp del salón vía **Baileys**, entiende los mensajes de los clientes con **Cerebras (Qwen3 235B MoE)** vía SDK de OpenAI y crea/modifica/cancela reservas en la misma tabla `public.reservas` de Supabase que usa el sitio web.

> El cliente es OpenAI-compatible: cambiando `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` en `.env` se puede apuntar a Cerebras, Groq, Together u OpenAI sin tocar código. Para ver qué modelos tiene habilitada tu cuenta de Cerebras: `curl -H "Authorization: Bearer $AI_API_KEY" https://api.cerebras.ai/v1/models`.

## Setup (una sola vez)

### 1. Migración de Supabase

En el **SQL Editor** del proyecto Supabase `ascxplypgexhnyaawudc`, correr:

```sql
ALTER TABLE public.reservas
  ADD COLUMN IF NOT EXISTS duracion_min         integer,
  ADD COLUMN IF NOT EXISTS recordatorio_enviado boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS reservas_fecha_estado_idx
  ON public.reservas (fecha, estado);
```

### 2. Variables de entorno

Editar el `.env` en la **raíz del repo** (no en `bot/`) y agregar:

```
SUPABASE_SERVICE_ROLE_KEY=...     # service_role key del proyecto (NO la anon)
AI_BASE_URL=https://api.cerebras.ai/v1   # endpoint OpenAI-compatible (default: Cerebras)
AI_API_KEY=...                    # https://cloud.cerebras.ai
AI_MODEL=qwen-3-235b-a22b-instruct-2507  # id del modelo en el proveedor elegido
ADMIN_JID=5493511234567@s.whatsapp.net
```

Las variables `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` ya deberían existir del frontend; el bot también las usa (la URL es la misma; la anon key no se usa, sólo la service_role).

### 3. Instalar y arrancar

```bash
cd bot
npm install
npm run dev
```

La primera vez aparece un código **QR** en la terminal. Abrir WhatsApp del número del salón → Ajustes → Dispositivos vinculados → Vincular un dispositivo → escanear. La sesión se guarda en `bot/auth_info_baileys/` y no vuelve a pedir QR en arranques posteriores.

## Cómo usarlo

### Cliente final

Mandar un WhatsApp al número del salón en lenguaje natural. Ejemplos:

- "Hola, quiero un corte mañana a la tarde"
- "Tenés lugar para una tintura el sábado?"
- "Cambiá mi turno a las 11"
- "Cancelá mi turno"

### Administrador

Desde el WhatsApp configurado en `ADMIN_JID` se pueden enviar comandos:

| Comando | Descripción |
|---|---|
| `/turnos` | Lista los turnos de hoy. |
| `/turnos 2026-05-23` | Lista los turnos de una fecha específica (`YYYY-MM-DD`). |
| `/cancelar <id>` | Cancela el turno por su id (UUID). |
| `/cancelar <telefono>` | Cancela el próximo turno futuro del teléfono indicado. |
| `/help` | Lista de comandos. |

## Recordatorios

Un cron interno corre cada 15 minutos: detecta turnos que caen entre 23h y 25h en el futuro, no cancelados y sin recordatorio enviado, manda el mensaje y marca la fila como `recordatorio_enviado = true`.

## Notas operativas

- **Catálogo de servicios:** `bot/config.js` tiene precios y duraciones **placeholder**. Ajustarlos a los reales del salón antes de poner en producción.
- **Number ban risk:** Baileys es no oficial. Usar un número dedicado del salón, **nunca el personal** del dueño. No enviar mensajes masivos.
- **Service role key:** sólo vive en este servidor. No exponer al frontend.
- **Restart:** matar y rearrancar el proceso no pide QR de nuevo (sesión persistida).
