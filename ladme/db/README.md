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

