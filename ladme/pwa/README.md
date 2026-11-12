# `pwa/` — frontend de la PWA

**Estado:** código completo y compilando (`npm run build`). Falta conectar el proyecto Supabase real, migrar los datos y publicar.

## Qué incluye

| Módulo | Ruta | Quién |
|---|---|---|
| Ingreso por enlace mágico `@unal.edu.co` | `/login`, `/auth/callback` | todos |
| Disponibilidad y agenda | `/` | autenticados |
| Nueva reserva (máx. 168 h) | `/reservar` | autenticados |
| Mis reservas, cancelar, extender, liberar, llegada | `/mis-reservas` | autenticados |
| Credencial con QR y calendario `.ics` | `/credencial/:id` | titular |
| Validación de QR | `/validar`, `/validar/:token` | personal |
| Ficha de equipo (`?asset=UNAL-XX`) | `/equipo/:codigo` | autenticados |
| Mantenimiento, historial y validación | `/mantenimiento` | laboratorista/administrador |
| Usuarios, roles y permisos | `/usuarios` | administrador |

También incluye: service worker, instalación como app, aviso de sin conexión, Web Push opcional, y consulta de Supabase sin caché (`NetworkOnly`).

## Requisitos

- Node.js 20 o superior.
- Un proyecto Supabase con `db/schema_ladme.sql` aplicado.
- Variables de entorno (ver `.env.example`).

## Desarrollo local

```bash
cd ladme/pwa
cp .env.example .env.local
# edite .env.local con la URL y la clave anon de su proyecto
npm install
npm run dev
```

Abre `http://localhost:5173`. El service worker está desactivado en desarrollo; las funciones PWA se prueban con `npm run build && npm run preview`.

## Variables de entorno

| Variable | Uso |
|---|---|
| `VITE_SUPABASE_URL` | URL del proyecto (`https://<ref>.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | clave pública del cliente: **Publishable key** (`sb_publishable_...`) o, en proyectos legacy, `anon public` (`eyJ...`). Nunca la secret/`service_role` |
| `VITE_PUBLIC_URL` | URL pública de la PWA; se usa en el QR de la credencial y en enlaces |
| `VITE_VAPID_PUBLIC_KEY` | clave pública VAPID para Web Push; vacía si aún no configura push |

`.env.local` está en `.gitignore`. No suba claves.

## Build

```bash
npm run typecheck   # tsc --noEmit
npm run build       # typecheck + vite build
npm run preview     # sirve dist/ localmente
```

Salida: `dist/`. No se versiona.

## Publicación

La PWA **debe vivir en su propio dominio HTTPS**. No puede servirse dentro de un iframe de Apps Script (`googleusercontent.com`) porque allí no se puede registrar un service worker ni usar Web Push.

### Cloudflare Pages (recomendado)

1. Conecte el repositorio `thaleoo/ladme`.
2. Root directory: `ladme/pwa`.
3. Build command: `npm ci && npm run build`.
4. Output directory: `dist`.
5. Variables de entorno: las cuatro de la tabla anterior.
6. Agregue el dominio personalizado y espere el certificado HTTPS.
7. El archivo `public/_redirects` ya resuelve las rutas del SPA.

### Netlify

1. Base directory: `ladme/pwa`.
2. Build command: `npm ci && npm run build`.
3. Publish directory: `ladme/pwa/dist`.
4. Mismas variables de entorno.
5. `public/_redirects` cubre el fallback del SPA.

### Vercel

1. Root directory: `ladme/pwa`.
2. Framework preset: Vite.
3. Build command: `npm run build`; output `dist`.
4. Mismas variables de entorno.
5. Use `vercel.json` si necesita reescrituras del SPA.

## Notas de seguridad

- El cliente solo usa la clave pública. Toda la lógica sensible vive en RPC `security definer` y RLS.
- Las respuestas de Supabase no se cachean en el service worker.
- El token del QR es aleatorio y no contiene datos personales.
- La sesión se guarda con la persistencia estándar de Supabase Auth.
- El enlace mágico se envía solo a cuentas `@unal.edu.co`; el trigger de base de datos rechaza otros dominios.

## Pendientes fuera de este frontend

- Configurar SMTP propio en Supabase Auth (el servicio por defecto tiene límites y puede no entregar correos institucionales).
- Migrar equipos, reservas y bloqueos desde Google Sheets.
- Enviar los correos operativos desde la cola de Supabase (o mantener Apps Script como worker durante la transición).
- Desplegar la Edge Function `enviar-avisos` y programar el cron de Web Push.

Ver [`../docs/DESPLIEGUE.md`](../docs/DESPLIEGUE.md).
