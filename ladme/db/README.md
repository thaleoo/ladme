# `db/` — base de datos (Supabase / PostgreSQL)

Contiene el esquema base de la PWA y, a futuro, las migraciones incrementales.

## Archivos

| Archivo | Descripción |
|---|---|
| `schema_ladme.sql` | Esquema completo: tipos, tablas, RLS, RPC, exclusión de solapamientos, historial, soft-cancel, mantenimiento, notificaciones y Web Push |
| `seed_equipos.sql` | Catálogo inicial de los 16 equipos (`UNAL-01`..`UNAL-16`). Idempotente |
| `verificar.sql` | Consultas de verificación: RLS, políticas, políticas de negocio, equipos, RPC y permisos |
| `migrations/0001_activacion_automatica.sql` | Alta automática de cuentas `@unal.edu.co`; la administración conserva la opción de inhabilitar |

## Qué garantiza el esquema

- Dos ocupaciones activas del mismo equipo **no pueden solaparse** (`EXCLUDE USING gist`).
- Las reservas **no se borran**: `DELETE` está bloqueado y la cancelación es lógica (`estado = 'cancelada'`).
- La duración se valida en la base: 168 h base, una extensión de 24 h, tope absoluto 192 h.
- El cliente **no escribe** reservas ni perfiles privilegiados: todo pasa por funciones `security definer`.
- El historial es append-only y la cola de notificaciones evita duplicados con `dedupe_key`.
- Los mantenimientos bloquean el equipo y requieren validación con el permiso `validar_mantenimiento`.
- Los datos públicos (calendario y ficha) salen de `ocupacion_publica`, sin nombres ni correos.

## Cómo aplicar

En el **SQL Editor** de Supabase, sobre un proyecto vacío:

```text
ladme/db/schema_ladme.sql
```

Con `psql`:

```bash
psql "$DATABASE_URL" -f ladme/db/schema_ladme.sql
```

> El esquema asume el entorno de Supabase (`auth.users`, `auth.uid()`, roles `anon`, `authenticated`, `service_role`). No está pensado para un PostgreSQL sin Supabase Auth.

## Después de aplicar

1. Cree el primer administrador (ver `docs/DESPLIEGUE.md`, sección 2.2).
2. Habilite `pg_cron` y `pg_net` para los recordatorios.
3. Configure `VAPID_*` y despliegue la Edge Function `enviar-avisos`.
4. No vuelva a ejecutar `schema_ladme.sql` completo: use `migrations/NNNN_descripcion.sql`.

## Convenciones

1. Toda tabla nueva lleva RLS activo y políticas explícitas.
2. Las operaciones privilegiadas van en funciones `security definer` con `search_path = public`.
3. No se guardan contraseñas, claves ni cadenas de conexión en el repo.
4. Los clientes solo reciben `GRANT` mínimos; las escrituras sensibles son RPC.
5. Los datos personales se minimizan: no se almacena cédula en la PWA.

## Migración 0002 — PWA completa

`migrations/0002_pwa_completa.sql` se aplica **una vez**, después del esquema (y de 0001 si aplica).
Agrega el perfil académico, los avisos con texto (centro de avisos, push y correo), el contacto al
titular, las solicitudes de reserva larga, las estadísticas, la importación desde Sheets y corrige
que el laboratorista pudiera saltarse los límites (ahora solo el administrador).

Pasos completos de activación: [`../docs/PWA_COMPLETA.md`](../docs/PWA_COMPLETA.md).

## Pruebas

`tests/ejecutar.sh` monta una base desechable en un PostgreSQL local (con un sustituto mínimo de
`auth` de Supabase), aplica esquema + migraciones y ejecuta `tests/pruebas.sql`.

## Migración 0003 — reportes, categorías y reglamento

`migrations/0003_reportes_categorias.sql`, después de 0002: reportes de fallas de los usuarios,
alerta «ya está libre», reglamento aceptado (requisito para reservar), valoración al terminar y la
cola de correo con equipo y horario para la plantilla nueva.

## Migración 0004 — errores de la app

`migrations/0004_errores_app.sql`, después de 0003: tabla `errores_app` y la función
`registrar_error` (con límites por persona y por hora) para ver en Administración los fallos que
ocurren en los dispositivos de los usuarios.

## Migración 0005 — sistema operativo y tope absoluto

`migrations/0005_so_tope_absoluto.sql`, después de 0004: columnas `sistema_operativo` y `so_version` en
`equipos`, y un tope absoluto de 30 días (política `reserva_max_absoluta_horas`) que aplica incluso a los
administradores. No afecta reservas importadas.

## Migración 0006 — Faro

`migrations/0006_faro.sql`, después de 0005: tablas `agentes`, `agente_eventos` y `faro_clave` (sin acceso
directo desde la PWA). Funciones del personal: `faro_panel`, `faro_codigo_vinculo`, `faro_modo`,
`faro_desbloquear`, `faro_desvincular` y `faro_generar_clave`. Funciones de Faro, sin sesión y con token:
`faro_vincular`, `faro_estado` y `faro_evento`. También agrega las políticas `faro_*`. Ver `ladme/faro/README.md`.

## Migración 0007 — Faro: uso real, modo clase y chat

`migrations/0007_faro_uso_clase_chat.sql`, después de 0006.

- `faro_uso`: tiempo encendido, en uso y en uso sin reserva por equipo y hora. Lo suma `faro_estado` en
  cada latido, con un máximo de 2 minutos por latido. `faro_estadisticas` lo resume.
- `faro_clase` / `faro_clase_terminar`: bloquean los equipos para reservas y los dejan libres para la
  clase.
- `cola_chat`: avisos sin datos personales para Telegram o Google Chat. Se llena con triggers en
  `reportes` y `solicitudes_excepcion`, con `encolar_alertas_faro` y con los eventos de Faro. Apps Script
  la lee con `chat_pendientes` y `marcar_chat_enviado` (`service_role`).
- Eventos nuevos de Faro: `cierre_forzado`, `actualizado`, `clase_inicio` y `clase_fin`.

## Migración 0008 — Faro 0.4: gestión remota, llegada por QR, inventario y sala

`migrations/0008_faro_gestion.sql`, después de 0007.

- Políticas nuevas: `llegada_modo` (0 la persona, 1 solo el personal, 2 QR de la isla; por defecto 1),
  `liberar_no_show_min` (0 = apagada) y `faro_sesion_limpia` (1).
- `registrar_llegada` respeta `llegada_modo`. `registrar_llegada_pc(equipo, código)` valida el código
  rotativo (`_faro_codigo_llegada`, ventanas de 30 s, ±1) y solo registra la reserva vigente **de quien
  llama** en ese equipo.
- `agente_comandos` y `faro_comando` / `faro_comando_resultado`: órdenes remotas (reiniciar, actualizar,
  apagar, despertar por Wake-on-LAN, desinstalar). Apagar omite equipos con reserva en curso; desinstalar
  es solo para administradores.
- `faro_anuncios` (`faro_anunciar`, `faro_quitar_anuncio`) y `faro_canal` (estable/pruebas).
- `faro_estado` recibe inventario y uso del procesador, copia los programas a `equipos.software`, avisa
  por disco casi lleno y por proceso desatendido verificado, y entrega órdenes y anuncios.
- `lista_espera` (`unirse_espera`, `salir_espera`, `encolar_avisos_espera`), `liberar_no_show`,
  `sala_publica` (anónima, sin datos personales) y `reporte_mensual` (`service_role`).
- `equipos.plano_x` / `plano_y` para el mapa de la sala.

## Migración 0009 — una reserva a la vez

`migrations/0009_una_reserva.sql`, después de 0008.

- `reservas_activas_max` pasa de 0 (sin límite) a **1**: cada usuario puede tener una sola reserva
  vigente o futura. Al terminar, liberarla o cancelarla puede hacer otra. Se cambia en Políticas.
- El personal (laboratoristas y administración) queda exento. Las reservas largas aprobadas por el
  personal no pasan por este límite.
- `crear_reserva` toma un candado por persona (`pg_advisory_xact_lock`), así que dos reservas enviadas al
  mismo tiempo no pueden pasar las dos.

## Migración 0010 — Registro, consola y mantenimientos al chat

`migrations/0010_registro_consola.sql`, después de 0009.

- `registro(fuentes, equipo, desde, hasta, buscar, limite, offset)`: el historial completo (reservas,
  Faro, fallas, mantenimientos, solicitudes, errores de la app y comandos de la consola) en un solo
  lugar, de a páginas y con filtros. Solo personal. Nada se borra; la PWA exporta lo filtrado a CSV.
  La descripción de las fallas no aparece (puede traer datos personales).
- `consola_registro` y `consola_anotar()`: cada comando de la consola queda con quién lo ejecutó.
- Un mantenimiento nuevo avisa al chat del personal.
- Trigger en `equipos`: la versión del sistema se guarda sin repetir el tipo («Windows 11 Pro» →
  sistema `Windows`, versión `11 Pro`).

## Migración 0011 — Clases, uso compartido y mejoras de Faro

`migrations/0011_clases_compartido.sql`, después de 0010.

- **Uso compartido:** `reservas.compartida` y `protegidos`. Las reservas compartidas no chocan con
  sus invitados pero sí entre ellas (dos restricciones de exclusión); un trigger impide compartir
  encima de otras reservas y poner un bloqueo sobre un proceso compartido. `marcar_compartida()`;
  `ocupacion_publica` y `equipos_disponibles` lo tienen en cuenta. La titular recibe aviso cuando
  alguien reserva dentro de su horario.
- **Clases:** tabla `clases` y `reservas.clase_id`. `solicitar_clase()` (solo
  Docente/Investigador o personal), `clase_previa()`, `aprobar_clase()` (un bloqueo por equipo y
  sesión), `rechazar_clase()` y `cancelar_clase()`. Avisos al chat del personal y al docente.
- **Faro:** `faro_estado` queda envuelto (`_faro_estado_base` + lo nuevo): clases aprobadas en curso
  desbloquean el equipo, datos de uso compartido y lista de espera, minutos por programa
  (`faro_programas`) y aviso de salud del disco.
- `reportes.diagnostico`: lo último que Faro sabía del equipo al reportar la falla.
- `sala_tick()` (lo llama el worker cada 5 min): horario automático de encendido y apagado
  (políticas `sala_*`) y aviso de posible caída de la red.
- Las notificaciones al teléfono ya existían (`push_suscripciones`, `push-sw.js` y la función
  `enviar-avisos`); ver `docs/DESPLIEGUE.md` §4.

## Migración 0012 — Órdenes con motivo y Telegram con acciones

`migrations/0012_ordenes_telegram.sql`, después de 0011.

- `faro_orden(equipos, tipo)` reemplaza a `faro_comando` en la PWA: devuelve qué equipos recibieron
  la orden y, para cada uno de los demás, el motivo (`ya_encendido`, `sin_mac`, `apagado`,
  `compartido`, `clase`, `bloqueo`, `reserva`, `en_espera`, `sin_faro`). Para encender busca un
  equipo con Faro en línea que envíe la señal; si no hay ninguno lo dice.
- **Telegram:** `telegram_vinculos` y `telegram_codigos`. Cada persona del personal vincula su cuenta
  con un código de 6 dígitos (`telegram_codigo()`, vence en 10 min) que escribe en el grupo como
  `/vincular 123456`. `telegram_accion()` (solo service_role, la llama el Apps Script) ejecuta la
  acción en nombre de esa persona con sus mismos permisos y deja el registro en la consola.

## Migración 0013 — Docentes verificados y autorización de clases

`migrations/0013_docentes_clases.sql`, después de 0012.

- `perfiles.docente_verificado_en` y `verificaciones_docente`. Elegir «Docente/Investigador» en el
  perfil abre una verificación (aviso al personal; al chat sin datos personales); la persona puede
  explicar qué dicta con `pedir_verificacion_docente()`. El personal usa `verificaciones_pendientes()`,
  `resolver_verificacion()` o `marcar_docente()`. Si se rechaza, el tipo de usuario queda vacío y se le
  pide actualizarlo. Quien ya figuraba como docente queda con su verificación pendiente.
- `solicitar_clase()` exige docente verificado, toma el nombre y correo del solicitante
  (`clases.docente_correo`), acepta «los que haya disponibles» (`equipos_pedidos` nulo) o de 1 al total
  de equipos activos, y rechaza solicitudes cuyas sesiones ya empezaron.
- `clase_previa()` cuenta solo sesiones futuras y dice cuántas pasaron; `aprobar_clase()` no aprueba si no
  queda ninguna. `clase_hoja()` (docente o personal) y `clase_hoja_correo()` (service_role) devuelven la
  autorización completa; `clase_reenviar()` vuelve a mandarla (una vez cada 10 min).

## Migración 0014 — Inasistencias, solicitudes vencidas y bot con botones

`migrations/0014_inasistencias_bot.sql`, después de 0013.

- `encolar_avisos_no_show()` (el worker ya la llama cada 5 min) ahora hace tres cosas:
  `revisar_llegadas()` (recordatorio al empezar la reserva y 10 min antes del límite; inasistencia al
  vencer la tolerancia) y `cerrar_clases_vencidas()` (estado `vencida`, aviso al docente).
- `inasistencias`: una por reserva sin llegada. En `inasistencia_ventana_dias` (60): 1.ª aviso, 2.ª
  `inasistencia_sancion_2_dias` (3), 3.ª o más `inasistencia_sancion_3_dias` (7). Cancelar o liberar antes
  no cuenta; el personal no acumula; solo cuenta si la persona tenía cómo registrar la llegada
  (`_podia_llegar`) y desde `inasistencias_desde` (fecha de instalación). El trigger `reservas_sancion`
  impide reservar con una sanción vigente. `apelar_inasistencia()`, `resolver_apelacion()`,
  `anular_inasistencia()`, `inasistencias_apeladas()`.
- `registrar_llegada()`: en el modo 2, si el equipo no tiene Faro activo, se permite desde la app.
- `faro_estado` (envuelto otra vez, `_faro_estado_0011`) agrega `actual.llegada_hasta`.
- Bot: `telegram_pendientes`, `chat_pendientes()` devuelve `dedupe_key` y `telegram_ejecutar()` (verificar,
  anular o mantener strikes; lo demás lo delega en `telegram_accion`, y devuelve quién actuó).

## Migración 0015 — Confirmar asistencia con el código de Faro

`migrations/0015_confirmar_asistencia.sql`, después de 0014.

- `llegada_modo` pasa a 2: la persona confirma la llegada con el código de Faro (o la registra el personal).
- `_faro_codigo_numero()`: 6 dígitos que cambian cada 30 s (mismo cálculo que Faro 0.5.3).
- `confirmar_llegada(codigo)`: busca la reserva de la persona que está empezando y valida el código de
  la isla de ese equipo (ventana actual, las dos anteriores y la siguiente). Devuelve `{ok, error}`; los
  fallos quedan en `llegada_intentos` y 5 en 10 minutos bloquean un rato.
- `mi_llegada_pendiente()`: la reserva que espera confirmación (desde 15 min antes hasta el límite).
- `registrar_llegada()` ya no sirve a la persona en el modo 2 (sí al personal).
- `_podia_llegar()`: con el modo 2, la inasistencia solo cuenta si Faro estuvo en línea en la reserva.
- `revisar_llegadas()` corregida: numera en orden de fecha y los recordatorios llevan a `/llegada`.

## Migración 0016 — Pausar las reservas

`migrations/0016_pausar_reservas.sql`, después de 0015. Política `reservas_pausadas` (0/1): con 1, el
trigger `reservas_pausa` impide crear reservas a quien no es del personal. Sirve para la mudanza
(`docs/MUDANZA.md`) o un mantenimiento general.

## Reiniciar los datos de prueba

`reiniciar_datos_prueba.sql` borra toda la actividad (reservas, clases, avisos, registro, eventos de
Faro, inasistencias, reservas importadas…) y conserva la configuración (equipos, políticas, cuentas,
Faro vinculado, push y Telegram). Pide confirmación editando una línea. Se usa una vez, justo antes de
importar la hoja (`docs/MUDANZA.md`).

## Migración 0017 — Solicitudes de software y foto del equipo

`migrations/0017_software_fotos.sql`, después de 0016.

- `solicitudes_software` (pendiente → en_tramite → instalado / rechazada; la persona puede cancelar).
  `solicitar_software()` con o sin reserva (la reserva no depende de la solicitud); exige
  `software_anticipacion_dias` días hábiles (3). `actualizar_software()` (personal): al marcar
  «instalado» agrega el programa a `equipos.software` de esos equipos. Avisos a la persona en cada
  cambio; al chat sin datos personales y con botones (`telegram_ejecutar` suma software_tramite,
  software_instalado —entiende «3 5 UNAL-07» o «sala»— y software_rechazar).
- `equipos.foto_url` y el almacenamiento público `equipos` (solo el personal sube; 3 MB, webp/jpeg/png).
