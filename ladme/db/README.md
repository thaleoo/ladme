# `db/` — base de datos (Supabase / PostgreSQL)

Contiene el esquema y, a futuro, las migraciones incrementales de la PWA.

## Archivos

| Archivo | Descripción |
|---|---|
| `schema_ladme.sql` | Esquema base: tablas, enums, RLS, RPC, exclusión de solapamientos, historial, cola de notificaciones y mantenimiento |

## Convenciones

1. `schema_ladme.sql` es el **punto de partida**, no se edita después de aplicar en producción.
2. Cada cambio posterior va en `migrations/NNNN_descripcion.sql`, numerado y en orden.
3. Toda tabla nueva lleva RLS activo y políticas explícitas.
4. Las operaciones privilegiadas van en funciones `security definer` con `search_path` fijo.
5. No se guardan contraseñas, claves ni cadenas de conexión en el repo. Usa variables de entorno.

## Parches conocidos al esquema

Antes de aplicar en producción, revisar `docs/ROADMAP.md`, sección 12.2:

- `reservas.extensiones` y tope total (168/192 h).
- `cola_notificaciones.reserva_id` debe ser nullable y admitir `equipo_id` / `mantenimiento_id`.
- Campos de mantenimiento: `desde`, `hasta`, `validacion`, `validado_por`, `validado_en`, `bloqueo_id`.
- Rol `responsable_tecnico` o permiso `puede_validar_mantenimiento`.
- Tabla `push_suscripciones`.
- Funciones `validar_mantenimiento`, `cerrar_mantenimiento`, `encolar_alertas_mantenimiento`.
- Políticas de retención y minimización (cédula fuera de la PWA).

## Cómo aplicar

En el SQL Editor de Supabase o con `psql`:

```bash
psql "$DATABASE_URL" -f db/schema_ladme.sql
```

> No hay proyecto de Supabase creado todavía. No apliques el esquema a ciegas: primero revisa los parches y prueba en un proyecto de desarrollo.
