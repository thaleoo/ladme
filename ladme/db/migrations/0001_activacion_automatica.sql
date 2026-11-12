-- ============================================================================
-- 0001 — Activación automática de cuentas @unal.edu.co
--
-- Motivo: el alta manual de cada persona se vuelve un cuello de botella. El
-- dominio institucional ya es el filtro. La administración conserva el flag
-- `activo` para inhabilitar cuentas concretas desde la PWA o por SQL.
--
-- Aplicar una vez sobre el proyecto que ya tiene schema_ladme.sql.
-- ============================================================================

alter table perfiles
  alter column activo set default true;

comment on column perfiles.activo is
  'Alta automática para correos @unal.edu.co; la administración puede inhabilitar.';

-- Las cuentas que ya existían no cambian solas. Para activar a quienes se
-- registraron antes de este cambio, ejecutar (revisar antes la lista):
--
-- update perfiles set activo = true where activo = false and correo like '%@unal.edu.co';
