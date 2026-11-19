-- Pruebas de reglas de negocio. Se ejecutan con ejecutar.sh sobre una base local
-- desechable; cualquier fallo aborta con un mensaje.
create function pg_temp.como(p_correo text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', (select id::text from auth.users where email = p_correo), false); end $$;

create function pg_temp.falla(p_sql text, p_patron text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ilike '%' || p_patron || '%' then return; end if;
    raise exception 'Se esperaba un error con «%» y salió: %', p_patron, sqlerrm;
  end;
  raise exception 'Se esperaba un error con «%» y no falló: %', p_patron, p_sql;
end $$;

create function pg_temp.ok(p_cond boolean, p_nombre text) returns void language plpgsql as $$
begin if p_cond is not true then raise exception 'FALLA: %', p_nombre; end if; raise notice 'OK    %', p_nombre; end $$;

do $$
declare r reservas; r2 reservas; s solicitudes_excepcion; j jsonb; n int; t text;
        t0 timestamptz := date_trunc('hour', now()) + interval '2 hours';
begin
  -- Registro: solo @unal.edu.co; Google trae el nombre.
  perform pg_temp.falla($q$insert into auth.users (email) values ('x@gmail.com')$q$, 'unal.edu.co');
  insert into auth.users (email, raw_user_meta_data) values
    ('ana@unal.edu.co', '{"name": "Ana Pérez"}'), ('beto@unal.edu.co', '{}'),
    ('admin@unal.edu.co', '{"full_name": "Admin LADME"}'), ('lab@unal.edu.co', '{}');
  perform pg_temp.ok((select nombre from perfiles where correo = 'ana@unal.edu.co') = 'Ana Pérez', 'nombre tomado de Google');
  -- 0009: por defecto, una reserva a la vez. Las pruebas que siguen reservan varias veces con la misma
  -- persona, así que se apaga aquí y el límite se prueba al final (bloque 0009).
  perform pg_temp.ok(politica_int('reservas_activas_max') = 1, 'por defecto, una reserva a la vez por usuario');
  update politicas set valor = '0' where clave = 'reservas_activas_max';
  -- Reglamento (0003): sin aceptarlo no se puede reservar para uno mismo.
  update perfiles set reglamento_aceptado_en = now() where correo <> 'beto@unal.edu.co';
  update perfiles set rol = 'administrador', tipo_usuario = 'Docente/Investigador', programa = 'Profesor/Investigador' where correo = 'admin@unal.edu.co';
  update perfiles set rol = 'laboratorista', tipo_usuario = 'Docente/Investigador', programa = 'Profesor/Investigador' where correo = 'lab@unal.edu.co';
  update perfiles set tipo_usuario = 'Estudiante', programa = 'Estadística', matricula = 'Octava matrícula' where correo = 'beto@unal.edu.co';

  -- Perfil y actividad obligatorios.
  perform pg_temp.como('ana@unal.edu.co');
  perform pg_temp.falla(format($q$select crear_reserva('UNAL-01', %L, %L, 'PAE')$q$, t0, t0 + interval '2 hours'), 'Complete su perfil');
  update perfiles set tipo_usuario = 'Estudiante', programa = 'Ingeniería Mecatrónica', matricula = 'Décima matrícula' where correo = 'ana@unal.edu.co';
  perform pg_temp.falla(format($q$select crear_reserva('UNAL-01', %L, %L, 'Fiesta')$q$, t0, t0 + interval '2 hours'), 'tipo de actividad');

  r := crear_reserva('UNAL-01', t0, t0 + interval '2 hours', 'Trabajo de grado', 'Tesis', true, 'No apagar', 'sol-0000000000000001');
  perform pg_temp.ok(r.programa = 'Ingeniería Mecatrónica' and r.matricula = 'Décima matrícula', 'la reserva congela programa y matrícula');
  perform pg_temp.ok((crear_reserva('UNAL-01', t0, t0 + interval '2 hours', 'Trabajo de grado', null, false, null, 'sol-0000000000000001')).id = r.id, 'reintento con el mismo id no duplica');
  perform pg_temp.falla(format($q$select crear_reserva('UNAL-01', %L, %L, 'PAE')$q$, t0 + interval '1 hour', t0 + interval '3 hours'), 'ya está reservado');

  -- Límites: usuario y laboratorista no los saltan; administrador sí.
  perform pg_temp.falla(format($q$select crear_reserva('UNAL-02', %L, %L, 'PAE')$q$, t0, t0 + interval '169 hours'), 'Supera el máximo');
  perform pg_temp.como('lab@unal.edu.co');
  perform pg_temp.falla(format($q$select crear_reserva('UNAL-02', %L, %L, 'Docencia')$q$, t0, t0 + interval '169 hours'), 'Supera el máximo');
  perform pg_temp.como('admin@unal.edu.co');
  r2 := crear_reserva('UNAL-02', t0, t0 + interval '169 hours', 'Investigación');
  perform pg_temp.ok(r2.id is not null, 'el administrador puede superar 168 h');

  -- Extensión única y cancelación con fecha.
  perform pg_temp.como('ana@unal.edu.co');
  perform pg_temp.falla(format($q$select extender_reserva(%L, %L)$q$, r.id, t0 + interval '27 hours'), 'como máximo');
  r := extender_reserva(r.id, t0 + interval '26 hours');
  perform pg_temp.ok(r.extensiones = 1, 'primera extensión de 24 h aceptada');
  perform pg_temp.falla(format($q$select extender_reserva(%L, %L)$q$, r.id, t0 + interval '27 hours'), 'ya usó');
  r := cancelar_reserva(r.id, 'No podré asistir');
  perform pg_temp.ok(r.cancelada_en is not null, 'la cancelación guarda su fecha');
  perform pg_temp.falla(format($q$delete from reservas where id = %L$q$, r.id), 'no se borran');

  -- Avisos con texto y cola de correo.
  select count(*) into n from cola_notificaciones c join perfiles p on p.id = c.usuario_id
   where p.correo = 'ana@unal.edu.co' and c.titulo is not null;
  perform pg_temp.ok(n = 3, 'confirmación, extensión y cancelación generan aviso con título');
  perform pg_temp.ok((select not correo from cola_notificaciones where tipo = 'cancelacion' and reserva_id = r.id), 'cancelar la propia reserva no envía correo');
  select count(*) into n from correos_pendientes(100);
  perform pg_temp.ok(n >= 2, 'correos_pendientes entrega la cola');
  perform marcar_correos_enviados((select array_agg(id) from correos_pendientes(100)));
  perform pg_temp.ok((select count(*) from correos_pendientes(100)) = 0, 'los correos marcados no se repiten');
  perform marcar_avisos_leidos();
  perform pg_temp.ok((select count(*) from cola_notificaciones where usuario_id = auth.uid() and leido_en is null) = 0, 'marcar avisos como leídos');

  -- Contacto anónimo al titular (reserva en curso).
  r := crear_reserva('UNAL-03', now(), now() + interval '3 hours', 'PAE');
  perform pg_temp.falla($q$select contactar_titular('UNAL-03', 'hola')$q$, 'Usted es quien');
  perform pg_temp.como('beto@unal.edu.co');
  perform contactar_titular('UNAL-03', E'¿Le falta\nmucho?');
  perform pg_temp.ok((select cuerpo like '%beto@unal.edu.co%¿Le falta mucho?%' and responder_a = 'beto@unal.edu.co'
                        from cola_notificaciones where tipo = 'contacto'), 'el titular recibe el mensaje y a quién responder');
  perform pg_temp.falla($q$select contactar_titular('UNAL-03', 'otra vez')$q$, 'hace poco');
  perform pg_temp.falla($q$select contactar_titular('UNAL-04', 'hola')$q$, 'no hay una reserva en curso');

  -- No-show: avisa una sola vez (titular + personal).
  update reservas set inicio = now() - interval '45 minutes' where id = r.id;
  perform pg_temp.ok(encolar_avisos_no_show() = 1, 'no-show detectado');
  perform pg_temp.ok(encolar_avisos_no_show() = 0, 'el no-show no se repite');
  perform pg_temp.ok((select count(*) from cola_notificaciones where tipo = 'sin_llegada_staff') = 2, 'el no-show llega a todo el personal');

  -- QR y llegada registrada por el personal.
  perform pg_temp.ok((validar_credencial(r.token_credencial)) ? 'titular' = false, 'un usuario común solo ve el veredicto');
  perform pg_temp.como('lab@unal.edu.co');
  j := validar_credencial(r.token_credencial);
  perform pg_temp.ok(j ->> 'resultado' = 'valida' and j ->> 'equipo' = 'UNAL-03' and (j ->> 'reserva')::uuid = r.id, 'el personal ve la reserva al validar');
  perform pg_temp.ok((registrar_llegada(r.id)).llegada_en is not null, 'el personal registra la llegada');

  -- Mantenimiento: aviso a todo el personal.
  j := crear_mantenimiento('UNAL-05', 'preventivo', 'Limpieza interna', t0, t0 + interval '2 hours', 'lab@unal.edu.co', 180);
  perform pg_temp.ok((select count(*) from cola_notificaciones where tipo = 'mantenimiento_programado') = 2, 'mantenimiento avisa a admin y laboratorista');
  perform pg_temp.ok(encolar_recordatorios_mantenimiento() >= 1, 'recordatorio diario de mantenimiento');

  -- Bloqueos.
  j := crear_bloqueo('UNAL-06', t0, t0 + interval '1 hour', 'Revisión de disco');
  perform cancelar_bloqueo((j ->> 'bloqueo')::uuid);
  perform pg_temp.ok((select estado = 'cancelada' from reservas where id = (j ->> 'bloqueo')::uuid), 'bloqueo retirado');

  -- Solicitud de reserva larga.
  perform pg_temp.como('beto@unal.edu.co');
  perform pg_temp.falla(format($q$select solicitar_excepcion('UNAL-07', %L, %L, 'PAE', null, 'Necesito correr un modelo largo')$q$, t0, t0 + interval '10 hours'), 'no necesita solicitud');
  s := solicitar_excepcion('UNAL-07', t0, t0 + interval '300 hours', 'Trabajo de grado', null, 'Entrenamiento de 12 días para la tesis');
  perform pg_temp.falla(format($q$select resolver_excepcion(%L, true)$q$, s.id), 'Solo un administrador');
  perform pg_temp.como('admin@unal.edu.co');
  s := resolver_excepcion(s.id, true, 'Aprobado por el comité');
  perform pg_temp.ok(s.estado = 'aprobada' and (select excepcion and usuario_id = s.usuario_id from reservas where id = s.reserva_id), 'aprobar crea la reserva a nombre del solicitante');
  perform pg_temp.como('beto@unal.edu.co');
  s := solicitar_excepcion('UNAL-08', t0, t0 + interval '200 hours', 'Trabajo de grado', null, 'Otra corrida larga de la tesis');
  perform pg_temp.como('admin@unal.edu.co');
  perform pg_temp.falla(format($q$select resolver_excepcion(%L, false, '')$q$, s.id), 'motivo del rechazo');
  s := resolver_excepcion(s.id, false, 'Equipo comprometido para un curso');
  perform pg_temp.ok(s.estado = 'rechazada' and exists (select 1 from cola_notificaciones where tipo = 'solicitud_rechazada'), 'rechazo con motivo y aviso');

  -- Importación desde Sheets y reclamo al ingresar.
  t := importar_reserva_hoja('RES-1', 'UNAL-09', 'carla@unal.edu.co', 'Carla Díaz', now() - interval '2 days', now() + interval '20 days',
                             false, 'Trabajo de grado', 'Tesis', true, 'No cerrar Chrome', 0,
                             '{"programa": "Ingeniería Biológica", "matricula": "Séptima matrícula", "tipo_usuario": "Estudiante"}');
  perform pg_temp.ok(t = 'vigente_pendiente', 'reserva vigente de alguien sin cuenta ocupa el equipo');
  perform pg_temp.ok(importar_reserva_hoja('RES-1', 'UNAL-09', 'carla@unal.edu.co', 'Carla', now(), now() + interval '1 day', false, null, null, false, null, 0, '{}') = 'repetida', 'la importación es idempotente');
  perform pg_temp.ok(importar_reserva_hoja('RES-2', 'UNAL-09', 'carla@unal.edu.co', 'Carla Díaz', now() - interval '9 days', now() - interval '8 days', false, 'PAE', null, false, null, 0, '{}') = 'historica', 'las pasadas quedan solo como historial');
  perform pg_temp.ok(importar_reserva_hoja('RES-3', 'UNAL-09', 'dario@unal.edu.co', 'Darío', now() + interval '1 day', now() + interval '2 days', false, 'PAE', null, false, null, 0, '{}') = 'conflicto', 'un choque en la hoja se reporta, no rompe');
  perform pg_temp.ok(importar_reserva_hoja('RES-4', 'UNAL-10', 'ana@unal.edu.co', 'Ana', now() + interval '1 day', now() + interval '2 days', false, 'PAE', null, false, null, 1, '{}') = 'vigente', 'con cuenta existente entra a su nombre');
  perform pg_temp.ok((select count(*) from correos_pendientes(100) c where c.correo = 'ana@unal.edu.co' and c.titulo = 'Reserva confirmada: UNAL-10') = 0, 'importar no dispara correos');
  perform pg_temp.ok((select count(*) from ocupacion_publica where codigo = 'UNAL-09' and motivo like '%@%') = 0, 'la ocupación pública no expone correos');
  perform pg_temp.ok(not exists (select 1 from cola_notificaciones c join reservas x on x.id = c.reserva_id
                                  join reservas_importadas i on i.reserva_id = x.id where c.tipo like 'sin_llegada%'), 'una reserva migrada en curso no cuenta como no-show');
  insert into auth.users (email, raw_user_meta_data) values ('carla@unal.edu.co', '{}');
  perform pg_temp.ok((select x.tipo = 'reserva' and p.correo = 'carla@unal.edu.co' and x.desatendido
                        from reservas_importadas i join reservas x on x.id = i.reserva_id join perfiles p on p.id = x.usuario_id
                       where i.codigo_origen = 'RES-1'), 'al ingresar, la reserva migrada pasa a su titular');
  perform pg_temp.ok((select programa = 'Ingeniería Biológica' and nombre = 'Carla Díaz' and tipo_usuario = 'Estudiante'
                        from perfiles where correo = 'carla@unal.edu.co'), 'el perfil se completa con los datos anteriores');
  perform pg_temp.ok(importar_bloqueo_hoja('UNAL-11', now() + interval '1 day', now() + interval '2 days', 'Verificación') = 'creado', 'bloqueo importado');

  -- 0003: reglamento, reportes, alerta de liberación, valoración, categorías.
  perform pg_temp.como('beto@unal.edu.co');
  perform pg_temp.falla(format($q$select crear_reserva('UNAL-12', %L, %L, 'PAE')$q$, t0, t0 + interval '1 hour'), 'aceptar el reglamento');
  perform aceptar_reglamento();
  r := crear_reserva('UNAL-12', now() - interval '1 minute', now() + interval '1 hour', 'PAE');
  perform pg_temp.ok(r.id is not null, 'tras aceptar el reglamento se puede reservar');
  perform pg_temp.falla($q$select reportar_falla('UNAL-12', 'Magia', 'No prende')$q$, 'tipo de problema');
  perform reportar_falla('UNAL-12', 'No enciende', E'El equipo no da\nvideo');
  perform pg_temp.ok((select count(*) from cola_notificaciones where tipo = 'reporte_falla') = 2, 'el reporte de falla llega a todo el personal');
  perform pg_temp.falla(format($q$select atender_reporte(%L, 'resuelto', 'ok')$q$, (select id from reportes limit 1)), 'Solo el personal');
  perform valorar_reserva(r.id, false);
  perform pg_temp.ok((select funciono = false from reservas where id = r.id), 'valoración guardada');
  perform pg_temp.como('ana@unal.edu.co');
  perform pg_temp.ok(alternar_alerta_liberacion('UNAL-12'), 'alerta de liberación activada');
  perform pg_temp.ok(encolar_alertas_liberacion() = 0, 'no avisa mientras el equipo sigue ocupado');
  perform pg_temp.como('beto@unal.edu.co');
  perform liberar_reserva(r.id);
  perform pg_temp.ok(encolar_alertas_liberacion() = 1, 'avisa cuando el equipo se libera');
  perform pg_temp.ok((select count(*) from alertas_liberacion) = 0, 'la alerta se borra al avisar');
  perform pg_temp.como('lab@unal.edu.co');
  perform pg_temp.falla(format($q$select atender_reporte(%L, 'resuelto', '')$q$, (select id from reportes limit 1)), 'Escriba una respuesta');
  perform atender_reporte((select id from reportes limit 1), 'resuelto', 'Se cambió el cable de video', true);
  perform pg_temp.ok((select estado = 'fuera_de_servicio' from equipos where codigo = 'UNAL-12')
                     and exists (select 1 from cola_notificaciones where tipo = 'reporte_respuesta'), 'atender un reporte responde y puede sacar el equipo de servicio');
  perform pg_temp.ok((select equipo = 'UNAL-12' and inicio is not null from correos_pendientes(100) where titulo like 'Reserva confirmada: UNAL-12'), 'el correo lleva equipo y horario');
  perform pg_temp.ok((estadisticas_soporte(now() - interval '1 day', now() + interval '1 day') ->> 'con_problemas')::int = 1, 'estadísticas de soporte');
  perform pg_temp.ok((select categoria = 'Estación de trabajo' from equipos where codigo = 'UNAL-01'), 'categoría del esquema base');

  -- 0004: registro de errores con límite por persona.
  perform pg_temp.como('beto@unal.edu.co');
  for n in 1..25 loop perform registrar_error('error', 'Fallo de prueba ' || n, 'pila', '/', 'Chrome', 'v1'); end loop;
  perform registrar_error('otro', 'tipo inválido');
  perform pg_temp.ok((select count(*) from errores_app) = 20, 'errores registrados con límite de 20 cada 10 minutos');

  -- 0005: tope absoluto de 30 días, incluso para el administrador.
  perform pg_temp.como('admin@unal.edu.co');
  perform pg_temp.falla(format($q$select crear_reserva('UNAL-13', %L, %L, 'Investigación')$q$, t0, t0 + interval '721 hours'), 'tope absoluto');
  r := crear_reserva('UNAL-13', t0, t0 + interval '700 hours', 'Investigación');
  perform pg_temp.falla(format($q$select extender_reserva(%L, %L)$q$, r.id, t0 + interval '730 hours'), 'tope absoluto');
  perform pg_temp.ok((extender_reserva(r.id, t0 + interval '720 hours')).fin = t0 + interval '720 hours', 'el administrador puede llegar justo al tope');
  update equipos set sistema_operativo = 'Linux', so_version = 'Ubuntu 24.04 LTS' where codigo = 'UNAL-14';
  perform pg_temp.falla($q$update equipos set sistema_operativo = 'DOS' where codigo = 'UNAL-14'$q$, 'check');

  perform pg_temp.como('lab@unal.edu.co');
  j := estadisticas(now() - interval '30 days', now() + interval '60 days');
  perform pg_temp.ok((j ->> 'total')::int >= 5 and (j ->> 'canceladas')::int >= 1 and jsonb_array_length(j -> 'por_programa') >= 2, 'estadísticas agregadas (incluye lo importado)');
  perform pg_temp.como('ana@unal.edu.co');
  perform pg_temp.falla($q$select estadisticas(now() - interval '1 day', now())$q$, 'No autorizado');
end $$;

-- Faro (0006): vinculación, latido, llegada automática, modos y desbloqueos.
do $$
declare j jsonb; k jsonb; t text; v_clave text; n int;
begin
  perform pg_temp.como('ana@unal.edu.co');
  perform pg_temp.falla($q$select faro_codigo_vinculo('UNAL-16')$q$, 'Solo el personal');
  perform pg_temp.como('lab@unal.edu.co');
  j := faro_codigo_vinculo('UNAL-16');
  perform pg_temp.ok(j ->> 'codigo' ~ '^[A-Z2-9]{4}-[A-Z2-9]{4}$', 'el personal genera un código de vinculación');
  k := faro_vincular(lower(j ->> 'codigo'), 'PC-SALA-16', 'Windows 11', '0.1.0');
  t := k ->> 'token';
  perform pg_temp.ok(length(t) = 64 and k ->> 'equipo' = 'UNAL-16', 'Faro canjea el código por un token');
  perform pg_temp.falla(format('select faro_vincular(%L)', j ->> 'codigo'), 'no es válido');
  perform pg_temp.ok((select token_hash from agentes a join equipos e on e.id = a.equipo_id where e.codigo = 'UNAL-16') <> t,
                     'el token no se guarda en claro');

  j := faro_estado(t, '{"inactivo_seg": 5, "bloqueado": false}');
  perform pg_temp.ok(j ->> 'modo' = 'observar' and j -> 'actual' = 'null'::jsonb and j #>> '{equipo,codigo}' = 'UNAL-16',
                     'el latido devuelve modo y equipo libre');
  perform faro_estado(t, '{"inactivo_seg": 3}');
  perform pg_temp.ok((select count(*) from agente_eventos v join equipos e on e.id = v.equipo_id
                       where e.codigo = 'UNAL-16' and v.tipo = 'uso_sin_reserva') = 1, 'el uso sin reserva se marca una vez cada 30 min');
  perform pg_temp.falla($q$select faro_estado('token-falso')$q$, 'no está vinculado');

  insert into reservas (equipo_id, usuario_id, inicio, fin, actividad)
  select e.id, p.id, now() - interval '5 minutes', now() + interval '2 hours', 'PAE'
    from equipos e, perfiles p where e.codigo = 'UNAL-16' and p.correo = 'ana@unal.edu.co';
  j := faro_estado(t, '{"inactivo_seg": 400}');
  perform pg_temp.ok(j #>> '{actual,titular}' = 'Ana' and (j #>> '{actual,llegada}')::boolean = false,
                     'muestra la reserva vigente con el nombre de pila (sin llegada si nadie usa el PC)');
  j := faro_estado(t, '{"inactivo_seg": 10}');
  perform pg_temp.ok((j #>> '{actual,llegada}')::boolean, 'Faro registra la llegada al detectar uso');

  n := faro_modo(null, 'bloquear');
  perform pg_temp.ok(n = 1 and faro_estado(t) ->> 'modo' = 'bloquear', 'el personal cambia el modo de todos los equipos');
  perform pg_temp.falla($q$select faro_modo(null, 'apagar')$q$, 'Modo no válido');
  perform pg_temp.ok(faro_desbloquear('UNAL-16', 60) > now() + interval '59 minutes'
                     and faro_estado(t) ->> 'desbloqueo_hasta' is not null, 'desbloqueo temporal desde la PWA');
  perform faro_desbloquear('UNAL-16', 0);
  perform pg_temp.ok(faro_estado(t) -> 'desbloqueo_hasta' = 'null'::jsonb, 'el desbloqueo se puede quitar');

  perform pg_temp.falla($q$select faro_generar_clave()$q$, 'administrador');
  perform pg_temp.como('admin@unal.edu.co');
  v_clave := faro_generar_clave();
  j := faro_estado(t) -> 'clave';
  perform pg_temp.ok(v_clave ~ '^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$'
                     and _faro_hash_clave(j ->> 'sal', lower(v_clave), (j ->> 'iteraciones')::int) = j ->> 'hash',
                     'la clave de emergencia se verifica con su huella');
  perform faro_evento(t, 'desbloqueo_emergencia', '{"motivo": "sin red"}');
  perform pg_temp.ok(exists (select 1 from cola_notificaciones where tipo = 'faro'), 'usar la clave de emergencia avisa al personal');
  perform faro_evento(t, 'borrar_todo');
  j := faro_panel();
  perform pg_temp.ok(jsonb_array_length(j -> 'equipos') >= 16 and j -> 'clave_creada_en' <> 'null'::jsonb
                     and exists (select 1 from jsonb_array_elements(j -> 'equipos') x where x ->> 'codigo' = 'UNAL-16' and (x ->> 'vinculado')::boolean),
                     'el panel resume todos los equipos');
  perform faro_desvincular('UNAL-16');
  perform pg_temp.falla(format('select faro_estado(%L)', t), 'no está vinculado');
  perform pg_temp.como('ana@unal.edu.co');
  perform pg_temp.falla($q$select faro_panel()$q$, 'Solo el personal');
end $$;

-- Faro 0007: uso real por hora, modo clase y chat del personal.
do $$
declare j jsonb; k jsonb; t text; n int;
begin
  perform pg_temp.como('lab@unal.edu.co');
  j := faro_codigo_vinculo('UNAL-16');
  t := faro_vincular(j ->> 'codigo', 'PC-16', 'Windows 11', '0.2.0') ->> 'token';
  update agentes set ultimo_latido = now() - interval '60 seconds' where token_hash = _faro_hash_token(t);
  perform faro_estado(t, '{"inactivo_seg": 5}');
  perform pg_temp.ok((select encendido_seg = 60 and uso_seg = 60 and uso_sin_reserva_seg = 0 from faro_uso u join equipos e on e.id = u.equipo_id
                       where e.codigo = 'UNAL-16'), 'el latido suma tiempo encendido y en uso (con reserva)');
  update agentes set ultimo_latido = now() - interval '10 hours' where token_hash = _faro_hash_token(t);
  perform faro_estado(t, '{"inactivo_seg": 5}');
  perform pg_temp.ok((select encendido_seg = 180 from faro_uso u join equipos e on e.id = u.equipo_id where e.codigo = 'UNAL-16'),
                     'si Faro estuvo apagado no se cuentan esas horas (máximo 2 min por latido)');
  j := faro_estadisticas(now() - interval '1 day', now() + interval '1 hour');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(j -> 'por_equipo') x where x ->> 'codigo' = 'UNAL-16')
                     and jsonb_array_length(j -> 'por_hora') >= 1, 'estadísticas de uso por equipo y por hora');

  j := faro_clase(array['UNAL-16', 'UNAL-08'], 60, 'Estadística I');
  perform pg_temp.ok(j -> 'omitidos' ? 'UNAL-16' and j -> 'equipos' ? 'UNAL-08',
                     'el modo clase omite los equipos con reserva y bloquea los demás');
  perform pg_temp.como('ana@unal.edu.co');
  perform pg_temp.falla(format($q$select crear_reserva('UNAL-08', %L, %L, 'PAE')$q$, now() + interval '5 minutes', now() + interval '30 minutes'), '');
  perform pg_temp.como('lab@unal.edu.co');
  perform pg_temp.ok(faro_clase_terminar(null) = 1, 'terminar la clase libera los equipos');
  perform pg_temp.falla($q$select faro_clase(null, 5, 'Corta')$q$, 'entre 15 minutos');

  perform pg_temp.como('beto@unal.edu.co');
  perform reportar_falla('UNAL-08', 'Software', 'No abre RStudio desde esta mañana.');
  perform pg_temp.ok(exists (select 1 from cola_chat where tipo = 'reporte' and texto like '%UNAL-08%Software%' and texto not ilike '%beto%'),
                     'los reportes llegan al chat del personal sin datos personales');
  perform pg_temp.ok((select count(*) from chat_pendientes(10)) >= 1, 'Apps Script lee la cola del chat');
  perform pg_temp.ok(marcar_chat_enviado(array(select id from cola_chat)) >= 1 and (select count(*) from chat_pendientes(10)) = 0,
                     'los avisos enviados salen de la cola');
end $$;

-- Faro 0008: llegada por QR, órdenes, inventario, anuncios, no-show, lista de espera, sala.
do $$
declare j jsonb; t8 text; t16 text; t7 text; sec text; cod text; r reservas; n int;
        v_vent bigint := floor(extract(epoch from now()) / 30)::bigint;
begin
  perform pg_temp.como('lab@unal.edu.co');
  t8 := faro_vincular(faro_codigo_vinculo('UNAL-08') ->> 'codigo', 'PC-08', 'Windows 11', '0.4.0') ->> 'token';
  insert into reservas (equipo_id, usuario_id, inicio, fin, actividad)
  select e.id, p.id, now() - interval '1 minute', now() + interval '1 hour', 'PAE'
    from equipos e, perfiles p where e.codigo = 'UNAL-08' and p.correo = 'beto@unal.edu.co';
  update politicas set valor = '0' where clave = 'faro_llegada_automatica';

  -- Modos de llegada.
  perform pg_temp.como('beto@unal.edu.co');
  select * into r from reservas x where x.equipo_id = (select id from equipos where codigo = 'UNAL-08') and x.estado = 'activa' and x.tipo = 'reserva';
  perform pg_temp.falla(format('select registrar_llegada(%L)', r.id), 'personal');
  update politicas set valor = '2' where clave = 'llegada_modo';
  perform pg_temp.falla(format('select registrar_llegada(%L)', r.id), 'QR que muestra la isla');

  j := faro_estado(t8, '{"inactivo_seg": 900}');
  sec := j #>> '{qr,secreto}';
  perform pg_temp.ok(length(sec) = 32 and (j #>> '{politicas,llegada_modo}')::int = 2, 'Faro recibe el secreto del QR y el modo de llegada');
  cod := _faro_codigo_llegada(sec, 'UNAL-08', v_vent);
  perform pg_temp.como('ana@unal.edu.co');
  perform pg_temp.falla(format($q$select registrar_llegada_pc('UNAL-08', %L)$q$, cod), 'No tiene una reserva vigente');
  perform pg_temp.como('beto@unal.edu.co');
  perform pg_temp.falla($q$select registrar_llegada_pc('UNAL-08', 'abcdef0123')$q$, 'venció');
  perform pg_temp.falla(format($q$select registrar_llegada_pc('UNAL-08', %L)$q$, _faro_codigo_llegada(sec, 'UNAL-08', v_vent - 3)), 'venció');
  perform pg_temp.ok((registrar_llegada_pc('UNAL-08', upper(cod))).llegada_en is not null,
                     'quien reservó registra su llegada con el QR de la isla (otra persona no puede)');
  update politicas set valor = '1' where clave = 'llegada_modo';
  perform pg_temp.falla(format($q$select registrar_llegada_pc('UNAL-08', %L)$q$, cod), 'personal');

  -- Órdenes remotas.
  perform pg_temp.como('lab@unal.edu.co');
  perform pg_temp.ok(faro_comando(array['UNAL-08'], 'reiniciar') = 1, 'el personal envía una orden a un equipo');
  j := faro_estado(t8);
  perform pg_temp.ok(j #>> '{comandos,0,tipo}' = 'reiniciar', 'Faro recibe la orden');
  perform pg_temp.ok(jsonb_array_length(faro_estado(t8) -> 'comandos') = 0,
                     'Faro recibe la orden una sola vez');
  perform pg_temp.ok(faro_comando(array['UNAL-08'], 'apagar') = 0, 'no se apaga un equipo con una reserva en curso');
  perform pg_temp.falla($q$select faro_comando(array['UNAL-08'], 'desinstalar')$q$, 'administrador');
  perform pg_temp.falla($q$select faro_comando(null, 'formatear')$q$, 'no válida');

  -- Inventario y salud.
  j := faro_estado(t8, '{"inactivo_seg": 5, "cpu": 40, "inventario": {"cpu": "Intel i5", "ram_gb": 16, "disco_gb": 100, "disco_libre_gb": 5,
                          "mac": "aa:bb:cc:dd:ee:08", "so_tipo": "Windows", "so_version": "Windows 11 Pro", "software": ["R", "RStudio", "Python"]}}');
  perform pg_temp.ok((select software @> array['R', 'Python'] from equipos where codigo = 'UNAL-08'), 'el software de Faro llega al equipo para filtrar');
  perform pg_temp.ok(exists (select 1 from cola_chat where tipo = 'faro_disco' and texto like 'UNAL-08%'), 'disco casi lleno avisa al chat');

  -- Encender (Wake-on-LAN): un Faro encendido despierta a uno apagado.
  t16 := faro_vincular(faro_codigo_vinculo('UNAL-16') ->> 'codigo', 'PC-16', 'Linux', '0.4.0') ->> 'token';
  perform faro_estado(t16, '{"inventario": {"mac": "aa:bb:cc:dd:ee:16"}}');
  update agentes set ultimo_latido = now() - interval '1 hour' where token_hash = _faro_hash_token(t16);
  n := faro_comando(array['UNAL-16'], 'encender');
  j := faro_estado(t8);
  perform pg_temp.ok(n = 1 and (j #>> '{comandos,0,datos,macs,0}') = 'aa:bb:cc:dd:ee:16',
                     'encender pide a un Faro encendido que despierte a los apagados');

  -- Anuncios y canal.
  perform faro_anunciar('La sala cierra hoy a las 5 p. m.', 60, null);
  perform faro_canal(array['UNAL-08'], 'pruebas');
  j := faro_estado(t8);
  perform pg_temp.ok(j #>> '{anuncio,texto}' like 'La sala cierra%' and j ->> 'canal' = 'pruebas', 'anuncio en la isla y canal de pruebas');

  -- Proceso desatendido que ya terminó.
  update reservas set desatendido = true where id = r.id;
  perform faro_estado(t8, '{"inactivo_seg": 2000, "cpu": 2}');
  perform pg_temp.ok(exists (select 1 from cola_notificaciones where tipo = 'desatendido_inactivo'), 'avisa si el proceso desatendido parece terminado');

  -- Liberación por no presentarse (desactivada por defecto).
  t7 := faro_vincular(faro_codigo_vinculo('UNAL-07') ->> 'codigo', 'PC-07', 'Windows 11', '0.4.0') ->> 'token';
  perform faro_estado(t7, '{"inactivo_seg": 5000}');
  insert into reservas (equipo_id, usuario_id, inicio, fin, actividad)
  select e.id, p.id, now() - interval '25 minutes', now() + interval '1 hour', 'PAE'
    from equipos e, perfiles p where e.codigo = 'UNAL-07' and p.correo = 'ana@unal.edu.co';
  perform pg_temp.ok(liberar_no_show() = 0, 'sin la política activa no se libera nada');
  update politicas set valor = '20' where clave = 'liberar_no_show_min';
  n := liberar_no_show();
  perform pg_temp.ok(n = 1 and exists (select 1 from cola_notificaciones where tipo = 'no_show_liberada'),
                     'con la política activa se libera la reserva sin uso medido por Faro');
  update politicas set valor = '0' where clave = 'liberar_no_show_min';

  -- Lista de espera.
  update equipos set software = array['SPSS'] where codigo = 'UNAL-05';
  perform pg_temp.como('ana@unal.edu.co');
  perform unirse_espera('SPSS');
  perform pg_temp.ok((select count(*) from lista_espera) = 1, 'la persona entra a la lista de espera');
  n := encolar_avisos_espera();
  perform pg_temp.ok(n = 1 and exists (select 1 from cola_notificaciones where tipo = 'espera' and titulo like 'UNAL-05%'),
                     'avisa cuando hay un equipo libre con el software pedido');

  -- Sala pública y reporte mensual.
  j := sala_publica();
  perform pg_temp.ok(jsonb_array_length(j) >= 16 and j::text not ilike '%beto%' and j::text not ilike '%ana%',
                     'la sala pública no expone datos personales');
  j := reporte_mensual(now() - interval '30 days', now() + interval '1 day');
  perform pg_temp.ok((j ->> 'reservas')::int > 0 and jsonb_array_length(j -> 'destinatarios') = 2, 'reporte mensual para el personal');

  -- Desinstalar desde el panel (solo administrador) desvincula el equipo al confirmarse.
  perform pg_temp.como('admin@unal.edu.co');
  perform pg_temp.ok(faro_comando(array['UNAL-07'], 'desinstalar') = 1, 'el administrador ordena desinstalar');
  j := faro_estado(t7);
  perform faro_comando_resultado(t7, (j #>> '{comandos,0,id}')::bigint, true, 'desinstalado');
  perform pg_temp.falla(format('select faro_estado(%L)', t7), 'no está vinculado');
  update politicas set valor = '1' where clave = 'faro_llegada_automatica';
end $$;

-- 0009: una reserva vigente o futura a la vez para usuarios; el personal queda exento.
do $$
declare r reservas; r2 reservas; t0 timestamptz := date_trunc('hour', now()) + interval '50 hours';
begin
  update politicas set valor = '1' where clave = 'reservas_activas_max';
  insert into auth.users (email, raw_user_meta_data) values ('caro@unal.edu.co', '{"name": "Caro"}');
  update perfiles set reglamento_aceptado_en = now(), tipo_usuario = 'Estudiante', programa = 'Biología', matricula = 'Novena matrícula'
   where correo = 'caro@unal.edu.co';
  perform pg_temp.como('caro@unal.edu.co');
  r := crear_reserva('UNAL-15', t0, t0 + interval '2 hours', 'PAE');
  perform pg_temp.falla(format($q$select crear_reserva('UNAL-16', %L, %L, 'PAE')$q$, t0 + interval '5 hours', t0 + interval '6 hours'), 'Solo se permite una a la vez');
  perform pg_temp.falla(format($q$select crear_reserva('UNAL-16', %L, %L, 'PAE')$q$, t0, t0 + interval '2 hours'), 'UNAL-15');
  perform cancelar_reserva(r.id, 'cambio de planes');
  r2 := crear_reserva('UNAL-16', t0 + interval '5 hours', t0 + interval '6 hours', 'PAE');
  perform pg_temp.ok(r2.id is not null, 'al cancelar la reserva puede hacer otra');
  -- Una reserva ya terminada no cuenta.
  update reservas set inicio = now() - interval '3 hours', fin = now() - interval '1 hour' where id = r2.id;
  r := crear_reserva('UNAL-14', t0, t0 + interval '1 hour', 'PAE');
  perform pg_temp.ok(r.id is not null, 'una reserva terminada no cuenta para el límite');
  -- Reintento con el mismo id de solicitud: devuelve la misma reserva, no choca con el límite.
  update reservas set id_solicitud = 'sol-0000000000000099' where id = r.id;
  perform pg_temp.ok((crear_reserva('UNAL-14', t0, t0 + interval '1 hour', 'PAE', null, false, null, 'sol-0000000000000099')).id = r.id,
                     'el reintento de la misma reserva no choca con el límite');
  -- El personal queda exento.
  perform pg_temp.como('lab@unal.edu.co');
  r := crear_reserva('UNAL-11', t0 + interval '20 hours', t0 + interval '21 hours', 'Docencia');
  r2 := crear_reserva('UNAL-10', t0 + interval '20 hours', t0 + interval '21 hours', 'Docencia');
  perform pg_temp.ok(r.id is not null and r2.id is not null, 'el laboratorista puede tener varias reservas');
  -- Con la política en 2, se permiten dos.
  update politicas set valor = '2' where clave = 'reservas_activas_max';
  perform pg_temp.como('caro@unal.edu.co');
  r := crear_reserva('UNAL-16', t0 + interval '8 hours', t0 + interval '9 hours', 'PAE');
  perform pg_temp.falla(format($q$select crear_reserva('UNAL-15', %L, %L, 'PAE')$q$, t0 + interval '10 hours', t0 + interval '11 hours'), 'el máximo permitido');
  update politicas set valor = '1' where clave = 'reservas_activas_max';
end $$;

-- 0010: registro unificado, consola auditada, mantenimientos al chat, sistema operativo sin repetir.
do $$
declare j jsonb; k jsonb; t0 timestamptz := date_trunc('hour', now()) + interval '200 hours'; begin
  perform pg_temp.como('lab@unal.edu.co');
  perform consola_anotar('estado', true, '12 equipos');
  j := registro(null, null, null, null, null, 25, 0);
  perform pg_temp.ok((j ->> 'total')::int > 25 and jsonb_array_length(j -> 'filas') = 25, 'el registro trae páginas de 25 y el total');
  k := registro(null, null, null, null, null, 25, 25);
  perform pg_temp.ok((k -> 'filas' -> 0 ->> 'en')::timestamptz <= (j -> 'filas' -> 24 ->> 'en')::timestamptz, 'la página 2 sigue a la 1 (más reciente primero)');
  j := registro(array['consola'], null, null, null, 'estado', 25, 0);
  perform pg_temp.ok((j ->> 'total')::int = 1 and j -> 'filas' -> 0 ->> 'actor' = (select nombre from perfiles where correo = 'lab@unal.edu.co'), 'los comandos de la consola quedan con quién los ejecutó');
  j := registro(array['faro'], 'unal-16', null, null, null, 100, 0);
  perform pg_temp.ok((j ->> 'total')::int > 0 and not exists (select 1 from jsonb_array_elements(j -> 'filas') x where x ->> 'equipo' <> 'UNAL-16'),
                     'filtro por fuente y equipo');
  j := registro(array['reservas'], null, now() - interval '1 hour', null, null, 5000, 0);
  perform pg_temp.ok((j ->> 'total')::int > 0 and jsonb_array_length(j -> 'filas') = least((j ->> 'total')::int, 5000), 'exportar por tandas de hasta 5000');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(registro(array['fallas'], null, null, null, null, 500, 0) -> 'filas') x
                                  where x ->> 'texto' ilike '%no da%video%'), 'el registro no expone la descripción de las fallas');
  -- Mantenimiento → chat.
  perform crear_mantenimiento('UNAL-09', 'correctivo', 'Cambio de fuente', t0 + interval '300 hours', t0 + interval '303 hours', 'lab@unal.edu.co', 0, true);
  perform pg_temp.ok(exists (select 1 from cola_chat where tipo = 'mantenimiento' and texto like 'UNAL-09 entra en mantenimiento correctivo%'),
                     'un mantenimiento nuevo avisa al chat');
  -- Sistema operativo sin repetir.
  update equipos set sistema_operativo = 'Windows', so_version = 'Windows 11 Pro' where codigo = 'UNAL-09';
  perform pg_temp.ok((select so_version from equipos where codigo = 'UNAL-09') = '11 Pro', 'la versión se guarda sin repetir el sistema');
  perform pg_temp.como('ana@unal.edu.co');
  perform pg_temp.falla($q$select registro()$q$, 'Solo el personal');
  perform pg_temp.falla($q$select consola_anotar('x', true)$q$, 'Solo el personal');
end $$;

-- Permisos reales del rol que usa la PWA.
select pg_temp.como('ana@unal.edu.co') \gset sin_
set role authenticated;
do $$ begin
  perform pg_temp.falla($q$insert into reservas (equipo_id, usuario_id, inicio, fin) select e.id, auth.uid(), now(), now() + interval '1 hour' from equipos e limit 1$q$, 'permission denied');
  perform pg_temp.falla($q$select * from correos_pendientes(5)$q$, 'permission denied');
  perform pg_temp.falla($q$select _avisar(auth.uid(), 'x', 'x', 'x', 'x', '/')$q$, 'permission denied');
  perform pg_temp.falla($q$select importar_bloqueo_hoja('UNAL-01', now(), now() + interval '1 hour', 'x')$q$, 'permission denied');
  perform pg_temp.falla($q$update perfiles set rol = 'administrador' where id = auth.uid()$q$, 'permission denied');
  update perfiles set matricula = 'Novena matrícula' where id = auth.uid();
  perform pg_temp.ok((select count(*) from perfiles) = 1, 'un usuario solo ve su propio perfil');
  perform pg_temp.ok((select count(*) from reservas where usuario_id <> auth.uid()) = 0, 'un usuario solo ve sus reservas');
  perform pg_temp.ok((select count(*) from contactos) = 0, 'los contactos solo los ve el personal');
  perform pg_temp.ok((select count(*) from reportes) = 0, 'los reportes ajenos no se ven');
  perform pg_temp.ok((select count(*) from errores_app) = 0, 'el registro de errores solo lo ve el personal');
  perform pg_temp.falla($q$select encolar_alertas_liberacion()$q$, 'permission denied');
  perform pg_temp.ok((select count(*) from cola_notificaciones where usuario_id <> auth.uid()) = 0, 'cada quien ve solo sus avisos');
  perform pg_temp.ok((select count(*) from ocupacion_publica) > 0, 'la ocupación pública es visible');
  perform pg_temp.falla($q$select * from agentes$q$, 'permission denied');
  perform pg_temp.falla($q$select * from faro_clave$q$, 'permission denied');
  perform pg_temp.falla($q$select * from chat_pendientes(5)$q$, 'permission denied');
  perform pg_temp.falla($q$select * from faro_uso$q$, 'permission denied');
  perform pg_temp.falla($q$select * from registro_v$q$, 'permission denied');
  perform pg_temp.falla($q$select * from consola_registro$q$, 'permission denied');
end $$;
reset role;

-- Sin sesión (como Faro): solo puede latir con un token válido.
select set_config('request.jwt.claim.sub', '', false);
set role anon;
do $$ begin
  perform pg_temp.falla($q$select faro_estado('x')$q$, 'no está vinculado');
  perform pg_temp.falla($q$select faro_panel()$q$, 'permission denied');
  perform pg_temp.falla($q$select faro_comando(null, 'reiniciar')$q$, 'permission denied');
  perform pg_temp.ok(jsonb_array_length(sala_publica()) > 0, 'la pantalla de la sala funciona sin sesión');
  perform pg_temp.falla($q$select * from agente_eventos$q$, 'permission denied');
  perform pg_temp.ok(true, 'sin sesión solo se puede latir con un token válido');
end $$;
reset role;
