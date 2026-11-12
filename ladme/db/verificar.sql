-- ============================================================================
-- LADME — verificación posterior a schema_ladme.sql y seed_equipos.sql
--
-- Ejecutar completo en el SQL Editor de Supabase. Es solo lectura.
-- Cada bloque devuelve una tabla; revise que los valores coincidan con lo
-- indicado en el comentario.
-- ============================================================================

-- 1) Tablas del esquema público y si tienen RLS.
--    Esperado: 9 tablas, todas con rowsecurity = true.
select tablename, rowsecurity
  from pg_tables
 where schemaname = 'public'
 order by tablename;

-- 2) Políticas RLS.
--    Esperado: al menos una política por tabla operativa; ninguna tabla con
--    RLS activo y cero políticas (salvo que sea intencional).
select tablename, policyname, cmd, roles
  from pg_policies
 where schemaname = 'public'
 order by tablename, policyname;

-- 3) Políticas de negocio (D-02).
--    Esperado: duracion_max_horas=168, extension_max_horas=24,
--    extensiones_max=1, duracion_max_total_horas=192.
select clave, valor
  from politicas
 order by clave;

-- 4) Equipos.
--    Esperado: 16 filas, códigos UNAL-01 .. UNAL-16.
select count(*) as equipos from equipos;

select codigo, nombre, marca, estado
  from equipos
 order by codigo;

-- 5) Funciones RPC que usa la PWA.
--    Esperado: las 13 funciones listadas.
select proname
  from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname in (
     'equipos_disponibles', 'crear_reserva', 'extender_reserva',
     'cancelar_reserva', 'liberar_reserva', 'registrar_llegada',
     'crear_mantenimiento', 'iniciar_mantenimiento', 'completar_mantenimiento',
     'validar_mantenimiento', 'cancelar_mantenimiento',
     'asignar_rol', 'activar_usuario', 'otorgar_permiso'
   )
 order by proname;

-- 6) Extensiones necesarias.
--    btree_gist es obligatoria para el constraint de solapamiento.
--    pg_cron y pg_net solo hacen falta para los avisos programados.
select extname
  from pg_extension
 where extname in ('btree_gist', 'pg_cron', 'pg_net')
 order by extname;

-- 7) Trigger que crea el perfil al registrarse.
--    Esperado: auth_nuevo_usuario.
select tgname
  from pg_trigger
 where tgname = 'auth_nuevo_usuario';

-- 8) Nadie debe tener escritura directa sobre reservas.
--    Esperado: authenticated solo con SELECT; sin INSERT/UPDATE/DELETE.
select grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name = 'reservas'
   and grantee in ('anon', 'authenticated')
 order by grantee, privilege_type;

-- 9) Primer administrador (ejecutar después del primer inicio de sesión).
--    Descomente y ajuste el correo.
-- select id, correo, rol, activo, permisos
--   from perfiles
--  order by creado_en;
