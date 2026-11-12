# Despliegue completo de LADME

Esta guía lleva el repositorio a producción en este orden:

1. **GitHub** — código versionado.
2. **Supabase** — base de datos, autenticación, RLS, RPC y Edge Function de avisos.
3. **Hosting de la PWA** — Cloudflare Pages, Netlify o Vercel, con dominio propio y HTTPS.
4. **Web Push** — claves VAPID, Edge Function y cron.
5. **Migración de datos** — equipos, reservas, bloqueos y mantenimientos desde Google Sheets.
6. **Apps Script** — se mantiene como respaldo y worker de correo durante la transición.
7. **Verificación** — lista de pruebas antes de anunciar el cambio.

> Los valores entre `<...>` son marcadores. Nunca escriba claves reales en el repositorio.

---

## 0. Lo que debe tener a mano

| Dato | Dónde se obtiene |
|---|---|
| Cuenta de GitHub con acceso a `thaleoo/ladme` | github.com |
| Proyecto Supabase | supabase.com |
| `SUPABASE_URL` y clave pública | Supabase → Settings → API Keys. La **Publishable key** (`sb_publishable_...`) reemplaza a la antigua `anon public`; en proyectos viejos sigue disponible en **Legacy API keys** |
| Clave secreta | La **Secret key** (`sb_secret_...`) reemplaza a `service_role`. Solo para Edge Functions y cron; nunca en la PWA |
| Dominio o subdominio para la PWA | p. ej. `ladme.unal.edu.co` |
| SMTP institucional o proveedor transaccional | para los enlaces mágicos de acceso |
| Cuenta de Apps Script y hoja de cálculo | la que ya usa el laboratorio |
| Exportaciones de las hojas en CSV/XLSX | Google Sheets → Archivo → Descargar |

**Recomendación:** haga una copia de seguridad de la hoja y de los CSV antes de tocar producción.

---

## 1. GitHub

El repositorio local ya está inicializado. Solo falta el remoto y el primer push:

```bash
cd C:\Users\Estudiantes\thaleo
git remote add origin https://github.com/thaleoo/ladme.git
git branch -M main
git push -u origin main
```

Si el repositorio remoto ya tiene un README inicial:

```bash
git pull --rebase origin main
git push -u origin main
```

Notas:

- El repositorio puede ser **privado**; no hay problema para Cloudflare Pages o Netlify, que se conectan con OAuth.
- No suba `ladme/sheets/*.xlsx`, `.env.local`, `.clasp.json`, claves ni certificados. Ya están en `.gitignore`.
- El build de la PWA se puede verificar en GitHub Actions o localmente con `npm run build`.

---

## 2. Crear el proyecto Supabase

1. Entre a <https://supabase.com> y cree un proyecto.
2. Elija la región más cercana (por ejemplo, São Paulo).
3. Guarde la contraseña de la base de datos.
4. En **Project Settings → API** (o **Settings → API Keys**) copie:
   - `Project URL` → `VITE_SUPABASE_URL`
   - **Publishable key** (`sb_publishable_...`) → `VITE_SUPABASE_ANON_KEY`. Es la sustituta de la antigua `anon public`; si su proyecto conserva las claves legacy, también sirve la `anon` (empieza por `eyJ...`).
   - **Secret key** (`sb_secret_...`, antes `service_role`) → solo para cron/Edge Functions; **nunca** en el frontend.

### 2.1 Aplicar el esquema

Abra **SQL Editor → New query**, pegue el contenido completo de:

```text
ladme/db/schema_ladme.sql
```

y pulse **Run**. Debe terminar con `Success. No rows returned`. Se aplica **una sola vez** sobre un proyecto vacío. Si ya ejecutó una versión anterior, no lo vuelva a correr completo: cree una migración incremental en `db/migrations/`.

Después, en la misma ventana, ejecute:

```text
ladme/db/seed_equipos.sql
```

Ese archivo carga los 16 equipos y es idempotente. La verificación completa está en `ladme/db/verificar.sql`.

El esquema crea:

- Tipos, tablas, restricciones de solapamiento y soft-cancel.
- Políticas RLS y vistas públicas sin datos personales.
- RPC de reservas, extensiones, cancelaciones, bloqueos, mantenimiento, roles y permisos.
- Cola de notificaciones y suscripciones Web Push.
- Tabla de respaldo `reservas_importadas` para la migración.

### 2.2 Crear el primer administrador

Por defecto, cualquier cuenta `@unal.edu.co` queda **activa** al registrarse (alta automática). El trigger solo crea el perfil con rol `usuario`. La primera persona debe iniciar sesión al menos una vez y luego se promueve desde SQL:

```sql
-- Ejecutar en SQL Editor después del primer ingreso de esa cuenta
update perfiles
   set rol = 'administrador', activo = true
 where correo = 'josoriodi@unal.edu.co';

update perfiles
   set rol = 'laboratorista', activo = true
 where correo = 'labdatos_paz@unal.edu.co';
```

La administración conserva el control: puede **inhabilitar** a una persona desde **Usuarios** en la PWA o con:

```sql
update perfiles set activo = false where correo = 'persona@unal.edu.co';
```

Si el proyecto se creó con una versión anterior del esquema (alta manual), aplique antes:

```text
ladme/db/migrations/0001_activacion_automatica.sql
```

Para dar el permiso fino de validación técnica:

```sql
update perfiles
   set permisos = array_append(permisos, 'validar_mantenimiento')
 where correo = 'responsable.tecnico@unal.edu.co';
```

También se puede otorgar desde **Usuarios → validar_mantenimiento**.

### 2.3 Verificar RLS

En **Authentication → Policies** o en SQL:

```sql
select schemaname, tablename, policyname, cmd
  from pg_policies
 where schemaname = 'public'
 order by tablename, policyname;
```

Compruebe especialmente:

- `perfiles_ver`: cada persona ve su perfil; el personal ve todos.
- `reservas_ver`: cada persona ve sus reservas; el personal ve todas.
- `mantenimientos`: solo personal.
- `push_suscripciones`: cada persona solo la suya.
- No hay políticas de `insert`/`update` directas sobre `reservas`; todo pasa por RPC.

---

## 3. Autenticación con enlace mágico

La PWA usa **magic link / OTP** de Supabase Auth, no Google OAuth, para no depender de Google Cloud.

### 3.1 Configuración básica

En **Authentication → Providers → Email**:

- Habilite **Email**.
- Mantenga **Confirm email** activo.
- Desactive el registro con contraseña si no se va a usar.

En **Authentication → URL Configuration**:

- **Site URL:** `https://<TU-DOMINIO-PWA>`
- **Redirect URLs:**
  - `https://<TU-DOMINIO-PWA>/auth/callback`
  - `http://localhost:5173/auth/callback` (solo desarrollo)
  - los dominios de preview de Cloudflare/Netlify si los usa

El frontend construye el enlace con `emailRedirectTo: `${window.location.origin}/auth/callback``.

### 3.2 SMTP propio

El correo por defecto de Supabase tiene límites bajos y puede no entregar a `@unal.edu.co`. Configure **Authentication → SMTP Settings** con el servidor institucional o un proveedor transaccional:

| Campo | Ejemplo |
|---|---|
| Host | `smtp.unal.edu.co` o el del proveedor |
| Puerto | `587` (STARTTLS) o `465` (SSL) |
| Usuario | cuenta institucional |
| Contraseña | clave de aplicación, no la personal |
| Remitente | `labdatos_paz@unal.edu.co` |
| Nombre | `LADME UNAL` |

Si el correo institucional no permite SMTP, use un proveedor transaccional con un dominio verificado y configure el remitente como ese dominio. No cambie el dominio permitido de las cuentas: sigue siendo `@unal.edu.co`.

### 3.3 Plantilla del enlace mágico

En **Authentication → Email Templates → Magic Link**, traduzca el mensaje y conserve la variable:

```html
<h2>Ingreso a LADME</h2>
<p>Use este enlace para entrar al sistema de reservas del laboratorio:</p>
<p><a href="{{ .ConfirmationURL }}">Ingresar a LADME</a></p>
<p>Si no solicitó este acceso, ignore el mensaje.</p>
```

El trigger de base de datos rechaza correos que no terminen exactamente en `@unal.edu.co`.

---

## 4. Edge Function de Web Push

### 4.1 Generar claves VAPID

Con Node.js instalado:

```bash
npx web-push generate-vapid-keys
```

Guarde:

- **Public Key** → `VITE_VAPID_PUBLIC_KEY` en el hosting.
- **Private Key** → secreto `VAPID_PRIVATE_KEY` en Supabase.

La clave privada no se pone en el frontend ni en GitHub.

### 4.2 Instalar y desplegar la función

```bash
# Instale la CLI de Supabase si aún no la tiene
npm install -g supabase

supabase login
supabase link --project-ref <PROJECT_REF>

# Secretos de la función
supabase secrets set \
  VAPID_PUBLIC_KEY="<PUBLIC_KEY>" \
  VAPID_PRIVATE_KEY="<PRIVATE_KEY>" \
  VAPID_SUBJECT="mailto:labdatos_paz@unal.edu.co"

# Despliegue (la función valida por su cuenta el Bearer service_role)
supabase functions deploy enviar-avisos --no-verify-jwt
```

La función está en `ladme/supabase/functions/enviar-avisos/index.ts`. Lee la cola `cola_notificaciones`, envía a las suscripciones del usuario y elimina las suscripciones vencidas (404/410).

### 4.3 Programar el cron

En **Database → Extensions**, habilite `pg_cron` y `pg_net`. Luego ejecute en SQL Editor:

```sql
-- Encola recordatorios de fin de reserva cada 10 minutos.
select cron.schedule(
  'ladme-encolar-fin',
  '*/10 * * * *',
  $$ select encolar_recordatorios_fin(30); $$
);

-- Revisa mantenimientos próximos/vencidos todos los días a las 07:00.
select cron.schedule(
  'ladme-encolar-mantenimiento',
  '0 7 * * *',
  $$ select encolar_recordatorios_mantenimiento(); $$
);

-- Envía la cola por Web Push cada 2 minutos.
-- Reemplace <PROJECT_REF> y <SERVICE_ROLE_KEY>.
select cron.schedule(
  'ladme-push',
  '*/2 * * * *',
  $$
    select net.http_post(
      url := 'https://<PROJECT_REF>.functions.supabase.co/enviar-avisos',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
      ),
      body := '{}'::jsonb
    );
  $$
);
```

Compruebe la ejecución:

```sql
select * from cron.job;
select * from cron.job_run_details order by start_time desc limit 20;
```

> La `service_role key` queda dentro de la definición del cron. Si el repositorio o los logs son públicos, use Supabase Vault o un cron externo (GitHub Actions, cron-job.org) que llame a la función con el header `Authorization`.

### 4.4 Probar Web Push

1. Publique la PWA con `VITE_VAPID_PUBLIC_KEY` configurada.
2. Abra la PWA en el teléfono/equipo.
3. Acepte **Activar avisos**.
4. Verifique la fila:

```sql
select usuario_id, endpoint, creado_en from push_suscripciones;
```

5. Cree una reserva de prueba y confirme que la notificación de confirmación llega.

---

## 5. Correos operativos

La PWA **no envía correos por sí sola**. La cola `cola_notificaciones` ya registra los eventos y la Edge Function de Web Push los consume; para correo hay tres opciones:

### Opción A — mantener Apps Script como worker de correo (transición)

Es la más rápida si la hoja sigue siendo la fuente de verdad temporal. Apps Script ya envía confirmaciones, recordatorios y avisos de mantenimiento. Requiere que las reservas sigan registrándose también en la hoja o que se escriba un puente.

### Opción B — Edge Function con proveedor transaccional (recomendada a mediano plazo)

Crear una función `enviar-correos` que:

1. Lea `cola_notificaciones` con `enviado_en is null`.
2. Arme el asunto/cuerpo según `tipo`.
3. Llame a Resend, SendGrid o Amazon SES por HTTPS.
4. Marque `enviado_en` y use `dedupe_key` para no repetir.

**No use SMTP crudo desde Edge Functions**: el runtime puede bloquear esos puertos. Use la API HTTPS del proveedor.

### Opción C — solo avisos en la PWA y Web Push

Si el laboratorio acepta que los recordatorios sean push/in-app y que el correo quede solo para el enlace de acceso, no hace falta un worker de correo operativo.

> Decida A, B o C antes de anunciar la migración. Si elige B, el dominio del remitente debe estar verificado en el proveedor.

---

## 6. Publicar la PWA

### Cloudflare Pages (recomendado)

1. **Workers & Pages → Create → Pages → Connect to Git**.
2. Repositorio `thaleoo/ladme`.
3. **Root directory:** `ladme/pwa`.
4. **Build command:** `npm ci && npm run build`.
5. **Build output directory:** `dist`.
6. Variables de entorno:

```text
VITE_SUPABASE_URL=https://<PROJECT_REF>.supabase.co
VITE_SUPABASE_ANON_KEY=<ANON_KEY>
VITE_PUBLIC_URL=https://<TU-DOMINIO-PWA>
VITE_VAPID_PUBLIC_KEY=<PUBLIC_KEY>
```

7. **Custom domains:** agregue el subdominio y cree el registro DNS que indique Cloudflare.
8. Espere el certificado HTTPS y abra la URL.

### Netlify

1. **Add new site → Import an existing project**.
2. Base directory: `ladme/pwa`.
3. Build command: `npm ci && npm run build`.
4. Publish directory: `ladme/pwa/dist`.
5. Mismas variables.
6. Dominio personalizado y HTTPS.

### Vercel

1. **Add New → Project**.
2. Root directory: `ladme/pwa`.
3. Framework: Vite.
4. Build: `npm run build`; output `dist`.
5. Mismas variables.
6. El archivo `vercel.json` ya define las reescrituras del SPA.

### Después de publicar

- Abra la URL en el celular y use **Añadir a pantalla de inicio**.
- Verifique que el manifest y el service worker carguen (`/manifest.webmanifest`, `/sw.js`).
- El aviso de instalación aparece solo en HTTPS y tras la primera visita.
- Confirme que el dominio de la PWA coincide con `VITE_PUBLIC_URL` y con **Site URL** de Supabase.

---

## 7. Migrar los datos desde Google Sheets

> Esta es la parte más delicada. Hágalo en un proyecto Supabase de ensayo primero.

### 7.1 Exportar

Descargue como CSV/XLSX:

- `Computadores_LADME` (16 equipos; `UNAL-10` no tiene reservas).
- `Reservas_LADME` (131 reservas).
- `Reservas_HISTORIAL` (solo 3 filas; el historial anterior no es recuperable).
- `Bloqueos_LADME`.
- `Mantenimientos_LADME`.
- `Reservas_CONTACTOS` (si existe).
- `Configuración` o equivalentes.

Guarde los CSV fuera del repositorio.

### 7.2 Importar equipos

Primero los equipos, porque todo lo demás depende de `equipos.id`. El catálogo ya está preparado en:

```text
ladme/db/seed_equipos.sql
```

Ejecútelo una vez en el SQL Editor. Es idempotente y no sobrescribe el `estado` si el laboratorio ya lo cambió. Use exactamente los códigos `UNAL-XX` de las etiquetas NFC/QR. No invente códigos nuevos.

### 7.3 Importar reservas históricas

Para conservar todo sin exigir que cada persona tenga cuenta:

```sql
insert into reservas_importadas
  (origen, codigo_equipo, correo_titular, nombre_titular, inicio, fin, estado, actividad, detalle, datos)
values
  ('google_sheets', 'UNAL-05', 'persona@unal.edu.co', 'Nombre Apellido',
   '2025-01-10 08:00:00-05', '2025-01-10 12:00:00-05', 'Finalizada',
   'Clase', NULL, '{}'::jsonb);
```

Puede cargar el CSV con `\copy` o con un script Python que use la API REST y la `service_role` (nunca desde el navegador).

### 7.4 Importar reservas vigentes y futuras

Solo las reservas activas/futuras deben entrar a `reservas`, porque participan en la disponibilidad y en el constraint de solapamiento.

1. Cree o invite a los titulares para que tengan perfil.
2. Mapee correo → `perfiles.id`.
3. Inserte con el RPC o con SQL controlado:

```sql
insert into reservas
  (tipo, equipo_id, usuario_id, inicio, fin, actividad, detalle, desatendido, mensaje_llegada)
select 'reserva', e.id, p.id, '<inicio>', '<fin>', '<actividad>', NULL, false, NULL
  from equipos e, perfiles p
 where e.codigo = 'UNAL-05'
   and p.correo = 'persona@unal.edu.co';
```

**Reservas mayores de 168 h:** no las cancele. Están amparadas por la decisión D-13: se conservan hasta su fin y las futuras se renegocian caso por caso. El RPC `crear_reserva` aplica el límite a las nuevas; la importación directa conserva las existentes.

### 7.5 Bloqueos y mantenimientos

- Los bloqueos de gestión entran a `reservas` con `tipo = 'bloqueo'`, `usuario_id` del personal que los creó y `motivo`.
- Los mantenimientos entran a `mantenimientos` y, si su intervalo es futuro, generan una fila `tipo = 'bloqueo'`.
- Si no tiene el `usuario_id` del autor original, use el administrador del laboratorio y déjelo en `hallazgos` o `motivo`.

### 7.6 Verificación de la migración

```sql
select count(*) from equipos;
select count(*) from reservas_importadas;
select count(*) from reservas where tipo = 'reserva';
select codigo, count(*) from reservas r join equipos e on e.id = r.equipo_id group by codigo order by codigo;
select count(*) from reservas where fin - inicio > interval '168 hours';
```

Compare con la auditoría (`docs/AUDITORIA_DATOS.md`). No borre las hojas originales hasta haber validado la PWA durante un periodo prudente.

---

## 8. Apps Script (respaldo y correo)

Mientras la PWA no tenga worker de correo propio, Apps Script sigue siendo útil.

### 8.1 Copia local → Apps Script

El código real vive en Apps Script; `ladme/appsscript/` es su copia exacta.

1. Abra el proyecto en <https://script.google.com>.
2. Pegue `Código.gs` y `Index.html` completos.
3. Revise `appsscript.json` (zona horaria `America/Bogota`, V8, `executeAs: USER_DEPLOYING`, `access: DOMAIN`).
4. Ejecute una vez `instalarDisparadores()` desde el editor para crear:
   - revisión diaria de mantenimiento a las 07:00;
   - recordatorios de fin cada 30 minutos.
5. Autorice los permisos (Sheets, correo, triggers).
6. Implemente como aplicación web. **No cambie la URL** si quiere conservar las etiquetas NFC/QR.

### 8.2 Cuentas iniciales

En `Código.gs`:

```js
const ADMIN_EMAILS = ['josoriodi@unal.edu.co'];
const LAB_EMAILS = ['labdatos_paz@unal.edu.co'];
```

Confirme que no quede el typo `@una.edu.co`.

### 8.3 Mantener la copia exacta

1. Si edita en Apps Script, copie el archivo completo a `ladme/appsscript/` en el mismo commit.
2. Si edita localmente, pegue el archivo completo en Apps Script antes de desplegar.
3. No renombre `Código.gs` sin actualizar el proyecto remoto.
4. Pruebe las funciones `pruebasP0`, `pruebasP1B1`, `pruebasP1B2`, `pruebasN1`, `pruebasN3`, `pruebasPolitica` y `pruebasMantenimiento` antes de desplegar.

### 8.4 Redirección a la PWA

Cuando la PWA esté publicada, el `doGet` puede redirigir las etiquetas `?asset=UNAL-XX` a:

```text
https://<TU-DOMINIO-PWA>/equipo/UNAL-XX
```

La PWA ya entiende `?asset=` y redirige a `/equipo/:codigo`. Conservar la URL de Apps Script como puente evita reimprimir etiquetas.

---

## 9. Checklist de puesta en marcha

### Base de datos

- [ ] Proyecto Supabase creado y región elegida.
- [ ] `schema_ladme.sql` aplicado sin errores.
- [ ] `select * from politicas;` muestra 168/24/1/192.
- [ ] Primer administrador y laboratorista con `activo = true`.
- [ ] RLS activo en todas las tablas.
- [ ] `btree_gist`, `pg_cron` y `pg_net` habilitados.

### Autenticación

- [ ] SMTP propio configurado y probado.
- [ ] Plantilla de magic link en español.
- [ ] Site URL y Redirect URLs apuntan al dominio real.
- [ ] Un correo `@gmail.com` es rechazado por el trigger.
- [ ] Un correo `@unal.edu.co` recibe el enlace y crea perfil.

### PWA

- [ ] `npm run build` pasa sin errores.
- [ ] Variables de entorno cargadas en el hosting.
- [ ] HTTPS y dominio personalizado funcionando.
- [ ] Service worker y manifest cargan.
- [ ] Instalación como app funciona en Android/iOS.
- [ ] Login, disponibilidad, reserva, credencial QR y validación funcionan.
- [ ] Cancelar, extender (máx. 24 h), liberar y registrar llegada funcionan.
- [ ] Reserva de más de 168 h es rechazada.
- [ ] Segunda extensión es rechazada.
- [ ] Reserva de más de 192 h es rechazada.
- [ ] Cancelación conserva la fila y desaparece de la disponibilidad.
- [ ] Mantenimiento bloquea el equipo y se puede validar con el permiso.
- [ ] Un usuario común no ve el panel de mantenimiento ni usuarios.

### Avisos

- [ ] Web Push activado en al menos un dispositivo.
- [ ] Recordatorio de fin llega antes del vencimiento.
- [ ] Aviso de mantenimiento llega al personal.
- [ ] No se duplican avisos (clave `dedupe_key`).
- [ ] `cron.job_run_details` no muestra errores repetidos.

### Migración

- [ ] 16 equipos importados con sus códigos reales.
- [ ] Reservas históricas respaldadas en `reservas_importadas`.
- [ ] Reservas vigentes/futuras importadas y sin solapamientos.
- [ ] Reservas >168 h conservadas (D-13).
- [ ] Las hojas originales siguen intactas como respaldo.

---

## 10. Seguridad y privacidad

- La clave secreta (`sb_secret_...` / `service_role`) solo se usa en el SQL Editor, Edge Functions y cron. Nunca en la PWA.
- No se guardan cédulas en la PWA; el esquema solo conserva nombre y programa.
- Las hojas exportadas no se versionan.
- Los enlaces de validación usan tokens aleatorios sin datos personales.
- El personal ve datos de contacto; un usuario común solo ve el veredicto del QR.
- Revise los logs de Supabase y de la Edge Function después de cada despliegue.
- Si una clave se filtra, rótela en Supabase y actualice el hosting.

---

## 11. Rollback

1. **PWA:** mantenga el deployment anterior en Cloudflare/Netlify/Vercel; se puede volver a él con un clic.
2. **Supabase:** no borre tablas. Desactive la PWA y use un proyecto de respaldo si hay que revertir el esquema.
3. **Apps Script:** conserve el deployment anterior y la hoja original; la URL se puede sobrescribir con una versión estable.
4. **Datos:** los CSV originales y `reservas_importadas` son el respaldo de la migración.

---

## 12. Lo que falta decidir o entregar

| Tema | Qué se necesita |
|---|---|
| Proyecto Supabase | URL, clave pública (Publishable/anon), clave secreta (Secret/service_role), región |
| SMTP | host, puerto, usuario, contraseña de aplicación y remitente |
| Dominio PWA | subdominio y acceso al DNS |
| VAPID | par de claves generado |
| Correo operativo | elegir opción A, B o C de la sección 5 |
| Responsable técnico | nombre y correo de quien validará mantenimiento |
| Frecuencias de mantenimiento | valores por equipo (la periodicidad es configurable) |
| Migración | CSV de `Reservas_CONTACTOS` y `Bloqueos_LADME` si existen |
| Apps Script | confirmar que la copia local coincide con la desplegada (`clasp pull` o comparación manual) |
