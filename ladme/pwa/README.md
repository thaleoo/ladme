# `pwa/` — frontend de la PWA

**Estado:** carpeta reservada. Todavía no hay código.

## Objetivo

Una PWA instalable, con offline del shell, notificaciones push, credencial dinámica y validación de QR, respaldada por **Supabase** (Postgres + RLS + RPC). Sin Google Cloud.

## Stack previsto

| Capa | Elección |
|---|---|
| Framework | React + Vite + TypeScript |
| Estilos | Tailwind + shadcn/ui (o Bootstrap si se prioriza continuidad visual) |
| Calendario | FullCalendar React |
| Datos | Supabase JS + TanStack Query |
| Auth | Supabase Auth por **magic link / OTP** con dominio `@unal.edu.co` |
| Hosting | Cloudflare Pages o Netlify (HTTPS, headers, preview deploys) |
| Push | Web Push con VAPID desde Edge Function |
| QR | Generación local; URL `/validar/<token>` |

## Por qué no dentro de Apps Script

`HtmlService` sirve la app en un iframe de `googleusercontent.com`. Ahí no se puede registrar un service worker, no se cumple el criterio de instalación y no hay Web Push. Un manifest externo no cambia el origen. Por eso el frontend debe vivir en su propio dominio.

## Orden de trabajo

1. Esquema y RLS en Supabase (`db/`), con datos de prueba.
2. Auth por magic link y seed de las dos cuentas iniciales.
3. Pantalla de disponibilidad (solo lectura) y ficha de equipo.
4. Reservar/cancelar/extender + "Mis reservas".
5. Credencial y QR.
6. Mantenimiento, alertas y admin.
7. Migración y redirección desde Apps Script.

No empezar por la UI: primero datos, auth y una RPC bien probada.

## Reglas

- Ninguna regla de negocio se valida solo en el cliente.
- No se cachean datos personales ni disponibilidad en el service worker.
- El QR nunca lleva nombre, cédula ni correo.
- No se usa Google Cloud; si algún día se quiere login con Google, se evalúa como excepción explícita.
