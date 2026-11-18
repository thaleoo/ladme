# Puesta en marcha de la PWA completa

Guía corta para activar todo lo que trae la rama `pwa-completa`. Hágalo en este
orden; cada paso se puede probar antes de seguir. Los nombres exactos de los
menús de Supabase y Google pueden variar un poco.

## 1. Base de datos (5 min)

1. Supabase → **SQL Editor** → pegue y ejecute `ladme/db/migrations/0002_pwa_completa.sql`.
   Es una sola transacción: si algo falla, no cambia nada.
2. Verifique: `select clave, valor from politicas order by clave;` debe mostrar 10 filas.

La migración da por atendidos los avisos de prueba que ya hubiera en la cola,
para que al activar el correo no salga una ráfaga.

## 2. Ingreso con Google (15 min)

La PWA ofrece «Continuar con Google» y, como respaldo, un código de 6 dígitos al
correo. La base de datos rechaza cualquier cuenta que no sea `@unal.edu.co`,
sin importar el método.

1. [console.cloud.google.com](https://console.cloud.google.com) → cree un proyecto (p. ej. `ladme-acceso`). Es gratis y no se usa para nada más.
2. **APIs y servicios → Pantalla de consentimiento de OAuth**: nombre `LADME`, correo de soporte `labdatos_paz@unal.edu.co`.
   - Tipo **Interno** si la consola lo permite con su cuenta institucional (solo deja entrar a `unal.edu.co`).
   - Si no, **Externo** y publíquela. Con los permisos básicos (correo y perfil) no requiere verificación.
3. **Credenciales → Crear credenciales → ID de cliente de OAuth → Aplicación web**:
   - Orígenes de JavaScript autorizados: la URL de la PWA.
   - URI de redireccionamiento autorizado: `https://<ref-del-proyecto>.supabase.co/auth/v1/callback`
4. Supabase → **Authentication → Providers → Google**: actívelo y pegue el ID de cliente y el secreto.
5. Supabase → **Authentication → URL Configuration**: confirme que `https://<dominio-pwa>/auth/callback` está en *Redirect URLs*.
6. Pruebe con una cuenta `@unal.edu.co` y con una `@gmail.com` (esta debe ser rechazada con un mensaje claro).

Si el Workspace de la universidad bloquea aplicaciones de terceros, Google
mostrará un error de acceso: en ese caso el código por correo sigue funcionando
y es el único método hasta que la OTIC autorice el cliente.

### Código por correo

Supabase → **Authentication → Email Templates → Magic Link**. Deje el asunto que
quiera y use un cuerpo que muestre el código:

```html
<h2>Su código de acceso a LADME</h2>
<p style="font-size:28px;letter-spacing:6px"><strong>{{ .Token }}</strong></p>
<p>Escríbalo en la aplicación. Vence en pocos minutos y sirve una sola vez.</p>
```

Sin SMTP propio, Supabase envía muy pocos correos por hora: por eso Google es el
método principal. Si configura SMTP (DESPLIEGUE §4), el código queda sin ese límite.

## 3. Correos del sistema (10 min)

Los envía Apps Script desde `labdatos_paz@unal.edu.co`, leyendo la cola de Supabase.

1. Copie `ladme/appsscript/Código.gs` completo al editor de Apps Script (reemplaza el actual). `Index.html` no cambia.
2. **Configuración del proyecto → Propiedades del script**:
   - `SUPABASE_URL` = `https://<ref>.supabase.co`
   - `SUPABASE_SECRET_KEY` = la clave secreta (Supabase → Settings → API Keys). Nunca la pegue en el código ni en un chat.
   - `PWA_URL_PRUEBAS` = URL de la PWA (para que los correos lleven el botón «Abrir LADME» antes del corte).
3. Ejecute `probarConexionSupabase` (pedirá autorizar el acceso a servicios externos) y luego `instalarDisparadores`.

Desde ahí, cada 5 minutos salen: confirmación, extensión, cancelación hecha por
el laboratorio, recordatorio de fin, contacto al titular, respuestas a
solicitudes y avisos de mantenimiento al personal. El mismo disparador genera
los recordatorios y los avisos de no-show, así que **no hace falta pg_cron**.

Web Push (DESPLIEGUE §9) es opcional y complementario: quien no lo active ve
todo en **Avisos**, dentro de la aplicación.

## 4. Primer administrador y perfiles

1. Ingrese a la PWA con su cuenta.
2. SQL Editor: `update perfiles set rol = 'administrador' where correo = 'su.correo@unal.edu.co';`
3. Desde **Usuarios** asigne laboratoristas y el permiso de validar mantenimiento.

## 5. Migrar los datos de Sheets

1. Exporte la hoja como `.xlsx` a `ladme/sheets/` (esa carpeta no se versiona).
2. `python ladme/scripts/migrar_sheets.py "ladme/sheets/LADME.xlsx" > ladme/sheets/migracion.sql`
3. Pegue `migracion.sql` en el SQL Editor y ejecútelo. Al final muestra un resumen:
   - `historica`: pasada o cancelada; queda para estadísticas.
   - `vigente`: el titular ya tenía cuenta; quedó a su nombre.
   - `vigente_pendiente`: ocupa el equipo y pasará a su titular cuando ingrese por primera vez.
   - `conflicto` / `equipo_desconocido`: revíselas a mano (el listado aparece debajo).
4. Borre `migracion.sql`: contiene nombres y correos.

Se puede ejecutar varias veces sin duplicar. La cédula no se migra.

## 6. El corte (un solo día)

Los dos sistemas no se sincronizan, así que no deben aceptar reservas a la vez.

1. Avise la fecha a los usuarios.
2. Ese día: exporte la hoja y repita el paso 5 (trae lo creado desde la primera importación).
3. En Apps Script agregue la propiedad `PWA_URL` = URL de la PWA. Desde ese instante:
   - el sistema anterior muestra «LADME se mudó» con un botón a la PWA;
   - las etiquetas NFC/QR (`?asset=UNAL-05`) llevan a la ficha del equipo en la PWA;
   - el sistema anterior ya no acepta reservas ni envía sus recordatorios.
4. Para revertir, borre la propiedad `PWA_URL`.

Conserve la hoja como archivo de solo lectura al menos un semestre.

## 7. Pruebas automáticas de la base de datos

```bash
PGURL=postgresql://postgres@localhost:5432/postgres bash ladme/db/tests/ejecutar.sh
```

Crea una base desechable en un PostgreSQL local, aplica esquema y migraciones y
comprueba más de 50 reglas (límites, permisos, avisos, importación). No toca Supabase.

## 8. Segunda tanda: reportes, inicio compacto y más (migración 0003)

1. SQL Editor → ejecute `ladme/db/migrations/0003_reportes_categorias.sql` (después de 0002).
2. Vuelva a pegar `ladme/appsscript/Código.gs` en Apps Script: trae la plantilla nueva de correo y el
   aviso «ya está libre». Ejecute `probarPlantillaCorreo` para recibir una muestra en su bandeja.
3. Despliegue la PWA. Quien tenga la versión anterior instalada verá el icono nuevo al reinstalarla
   (Android a veces lo actualiza solo al cabo de unos días).

Qué cambia para las personas:

- **Reglamento**: en el primer ingreso se muestra una vez y hay que aceptarlo para reservar. El texto
  es un borrador en `ladme/pwa/src/lib/reglamento.ts`: **revíselo con la coordinación antes de publicar**.
- **Reportes de fallas**: botón en la ficha de cada equipo; llegan a todo el personal y se atienden en
  Administración → Reportes.
- **Categorías**: en Administración → Equipos, el campo «Categoría» agrupa el inicio (p. ej.
  «Realidad aumentada»). Con una sola categoría no aparecen pestañas.
- **«Avisarme cuando se libere»**, **«Reservar otra vez»** y la pregunta **«¿Todo funcionó bien?»** al terminar.

### Etiquetas NFC y QR

La PWA entiende `https://<dominio-pwa>/?asset=UNAL-05` y `https://<dominio-pwa>/equipo/UNAL-05`: ambas
abren la ficha de ese equipo. Las etiquetas actuales apuntan a Apps Script; tras el corte muestran
«LADME se mudó» con un botón hacia la ficha correcta (un toque adicional, porque un script web no puede
redirigir por sí solo). Para que sea directo, regrabe los NFC y reimprima los QR con la URL de la PWA:
use `ladme/scripts/generar_qr_ladme.py` con la URL de la PWA como base (genera `https://<dominio-pwa>?asset=UNAL-05`).

## 9. Tercera tanda: estabilidad, instalación y movimiento (migración 0004)

1. SQL Editor → ejecute `ladme/db/migrations/0004_errores_app.sql` (después de 0003).
2. Despliegue la PWA. No hay cambios en Apps Script.

Qué cambia:

- **Ya no se queda cargando.** Se corrigió un bloqueo de la librería de Supabase al reanudar la app y
  cada paso del arranque tiene un límite de tiempo. Si a los 8 s sigue cargando, aparece «Reintentar»;
  al segundo intento, «Limpiar y recargar» (borra los archivos guardados de la app, no la sesión).
- **Actualizaciones**: la versión nueva se descarga sola y aparece «Hay una versión nueva — Actualizar».
  Si alguien tenía abierta una versión vieja y le falta una pantalla, la app recarga sola una vez.
- **Errores de la app**: Administración → Errores muestra los fallos ocurridos en los dispositivos de
  los usuarios (incluida la carga lenta), agrupados, con navegador y versión.
- **Instalación**: banner «Instale LADME» (diálogo nativo en Chrome/Edge/Android; instrucciones en iPhone).
  Si se cierra, vuelve al mes.
- **Usuarios**: búsqueda en el servidor, filtros con conteo y páginas de 30. Tocar a una persona abre su ficha.
- También: transiciones suaves, pestañas con indicador, tema claro/oscuro/automático (Mi cuenta),
  «Mi uso» con exportación CSV, accesos directos al mantener presionado el icono, contador de avisos en
  el icono, copia sin conexión de la disponibilidad, Mis reservas y el pase, y deslizar para actualizar
  en la app instalada.

## 10. Cuarta tanda: sistema operativo, tope de 30 días y copias de seguridad (migración 0005)

1. SQL Editor → ejecute `ladme/db/migrations/0005_so_tope_absoluto.sql` (después de 0004).
2. Vuelva a pegar `ladme/appsscript/Código.gs` en Apps Script, ejecute `respaldarAhora` una vez
   (pedirá permiso para usar Google Drive) y luego `instalarDisparadores`.
3. En Administración → Equipos, registre el **sistema operativo** y la **versión o distribución** de cada
   equipo (p. ej. «Windows 11 Pro», «Ubuntu 24.04 LTS»). Se muestra en el inicio, en la ficha y al
   reservar, y permite filtrar por sistema.

- **Tope absoluto**: ninguna reserva puede durar más de 30 días, ni la de un administrador. Cuando un
  administrador supera el límite normal, la app le pide confirmarlo antes de reservar o extender. El
  tope se cambia en Administración → Políticas.
- **Copias de seguridad**: cada domingo a las 3 a. m. se guardan todas las tablas como CSV en la carpeta
  de Drive «LADME · Copias de Supabase» (se conservan 12 semanas). Contiene datos personales: no la
  comparta. Si una copia falla, llega un correo a labdatos_paz. Pruebe una restauración una vez
  (Supabase → Table Editor → Insert → Import data from CSV) antes de necesitarla.

## 11. Faro, el agente de los computadores (migración 0006)

Guía completa en `ladme/faro/README.md`. En resumen:

1. Ejecute `ladme/db/migrations/0006_faro.sql` en el SQL Editor de Supabase (después de 0005).
2. Cree en GitHub las variables `FARO_SUPABASE_URL`, `FARO_SUPABASE_KEY` (clave pública) y `FARO_PWA_URL`.
   Luego ejecute Actions → **Faro** para generar los instaladores de Windows y Linux.
3. Instale Faro en cada PC junto con TI/OTIC y vincúlelo desde Administración → **Faro** → Vincular.
4. Empiece con la sala en **Observar**. Con los datos de «uso sin reserva», pase a **Avisar** y luego a
   **Bloquear**.
5. Cree la clave de emergencia (Administración → Faro, solo administradores) y guárdela donde solo la vea
   el personal.

## 12. Faro 0.2: actualizaciones, instalación masiva, uso real, modo clase y chat (migración 0007)

1. SQL Editor → `ladme/db/migrations/0007_faro_uso_clase_chat.sql` (después de 0006).
2. Vuelva a pegar `ladme/appsscript/Código.gs`. Si quiere avisos en un chat del personal, configure
   `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`, o `GCHAT_WEBHOOK_URL`, y ejecute `probarChatPersonal`.
3. Cree la clave de firma de Faro y publique la etiqueta `faro-v0.2.0` (ver `ladme/faro/README.md`).
4. Instale en cada PC con `instalar-windows.ps1` o `instalar-linux.sh`, que vienen en la release.

- Las acciones de la isla abren páginas directas: `/pc/UNAL-05/extender`, `/liberar`, `/reportar` y
  `/reservar`. Al iniciar sesión, la PWA vuelve a la página que se abrió.
- La pestaña Faro suma el uso real (mapa de calor y uso por equipo) y el modo clase.
- El chat del personal recibe reportes, solicitudes y alertas de Faro, sin datos personales.

## 13. Faro 0.4: gestión remota, llegada por QR, inventario y mapa de la sala (migración 0008)

1. SQL Editor → `ladme/db/migrations/0008_faro_gestion.sql` (después de 0007).
2. Vuelva a pegar `ladme/appsscript/Código.gs` y ejecute `instalarDisparadores` (agrega el reporte
   mensual). Para ver el reporte sin esperar, ejecute `probarReporteMensual`.
3. Publique la etiqueta `faro-v0.4.0`; los Faro con AppImage o Windows se actualizan solos.

- **Corrección:** los campos de texto dentro de ventanas (p. ej. el serial al editar un equipo) cerraban
  el teclado al escribir una letra. Ya no.
- **«Tu reserva» en la ficha:** quien tiene la reserva del equipo ve ahí la cuenta regresiva, registrar
  llegada, extender, liberar y su pase.
- Los QR de la isla abren `/reservar?equipo=…` y `/equipo/…?accion=…`; el enlace corto es `/e/UNAL-05`.
- **Llegada en fases** con `llegada_modo`: empiece en `1` (solo personal) y con
  `faro_llegada_automatica = 0`; después pase a `2` (QR rotativo de la isla, que solo sirve al titular).
- Órdenes remotas, anuncios, inventario y salud, filtro por programa, sesión limpia, lista de espera,
  mapa público `/sala` (y `?kiosco=1`), canal de pruebas y liberación por no-show (apagada por defecto).

## 14. Una reserva a la vez (migración 0009)

1. SQL Editor → `ladme/db/migrations/0009_una_reserva.sql` (después de 0008).
2. Vuelva a pegar `ladme/appsscript/Código.gs` (el sistema actual también queda en una reserva a la vez).

- Cada usuario puede tener una sola reserva vigente o futura; el personal está exento. Se cambia en
  Políticas → «Reservas a la vez por usuario».
- El formulario de reserva y la ficha del equipo avisan antes de llenar nada y muestran la reserva que ya
  tiene. Las reservas que ya existían se respetan.

## Qué queda fuera

- **Pase en Google/Apple Wallet**: descartado (ROADMAP C-01). La credencial vive en la PWA y se actualiza sola.
- **Liberación automática por no-show**: existe desde 0.4 como política (`liberar_no_show_min`), apagada por defecto; mientras esté en `0`, solo se avisa al titular y al personal.
