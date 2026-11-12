# `db/` — base de datos (Supabase / PostgreSQL)

Contiene el esquema base de la PWA y, a futuro, las migraciones incrementales.

## Archivos

| Archivo | Descripción |
|---|---|
| `schema_ladme.sql` | Esquema completo: tipos, tablas, RLS, RPC, exclusión de solapamientos, historial, soft-cancel, mantenimiento, notificaciones y Web Push |
| `seed_equipos.sql` | Catálogo inicial de los 16 equipos (`UNAL-01`..`UNAL-16`). Idempotente |
| `verificar.sql` | Consultas de verificación: RLS, políticas, políticas de negocio, equipos, RPC y permisos |

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
