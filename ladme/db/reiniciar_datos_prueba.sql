-- Reiniciar los datos de prueba antes de la mudanza (una sola vez, ANTES de importar la hoja).
--
-- BORRA toda la actividad: reservas, clases, solicitudes, fallas, mantenimientos, avisos, registro
-- de la consola, eventos y órdenes de Faro, inasistencias, apelaciones, verificaciones pendientes,
-- reservas importadas y errores. Los contadores (N.º de clase CL-00001, etc.) vuelven a empezar.
--
-- CONSERVA la configuración: equipos, políticas, cuentas (perfiles, roles, docentes verificados),
-- Faro vinculado en cada PC (y su clave de emergencia), suscripciones push y cuentas de Telegram.
--
-- Para ejecutarlo, cambie 'NO' por 'SI' en la línea marcada. Si algo falla, no se borra nada.
begin;

do $$ begin
  if 'NO' <> 'SI' then   -- ← cambie 'NO' por 'SI' para confirmar
    raise exception 'No se borró nada: cambie ''NO'' por ''SI'' en la primera línea del bloque para confirmar.';
  end if;
end $$;

do $$
declare
  t text; n bigint; lista text[] := '{}';
  tablas text[] := array[
    'reservas', 'reservas_historial', 'reservas_importadas', 'contactos', 'alertas_liberacion', 'lista_espera',
    'solicitudes_excepcion', 'clases', 'reportes', 'mantenimientos', 'inasistencias', 'llegada_intentos',
    'verificaciones_docente', 'cola_notificaciones', 'cola_chat', 'consola_registro', 'agente_eventos',
    'agente_comandos', 'faro_anuncios', 'faro_uso', 'faro_programas', 'sala_horario_log', 'errores_app',
    'telegram_pendientes', 'telegram_codigos'];
begin
  foreach t in array tablas loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I', t) into n;
      raise notice '%: % filas', t, n;
      lista := lista || format('public.%I', t);
    end if;
  end loop;
  execute 'truncate ' || array_to_string(lista, ', ') || ' restart identity';
end $$;

-- Las inasistencias solo cuentan desde la mudanza.
update politicas set valor = to_jsonb(now()::text) where clave = 'inasistencias_desde';

commit;

-- Lo que queda (debería ser solo la configuración):
select 'equipos' as que, count(*) from equipos
union all select 'cuentas', count(*) from perfiles
union all select 'personal', count(*) from perfiles where rol <> 'usuario'
union all select 'Faro vinculados', count(*) from agentes where token_hash is not null
union all select 'reservas', count(*) from reservas;
