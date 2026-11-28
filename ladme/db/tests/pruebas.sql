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
  update perfiles set reglamento_aceptado_en = now(), reglamento_version = (select max(version) from reglamento_versiones) where correo <> 'beto@unal.edu.co';
  update perfiles set rol = 'administrador', tipo_usuario = 'Docente/Investigador', programa = 'Profesor/Investigador' where correo = 'admin@unal.edu.co';
  update perfiles set rol = 'laboratorista', tipo_usuario = 'Docente/Investigador', programa = 'Profesor/Investigador' where correo = 'lab@unal.edu.co';
  update perfiles set tipo_usuario = 'Estudiante', programa = 'Estadística', matricula = 'Octava matrícula' where correo = 'beto@unal.edu.co';

  -- Perfil y actividad obligatorios.
  perform pg_temp.como('ana@unal.edu.co');
  perform pg_temp.falla(format($q$select crear_reserva('UNAL-01', %L, %L, 'Docencia')$q$, t0, t0 + interval '2 hours'), 'Complete su perfil');
  update perfiles set tipo_usuario = 'Estudiante', programa = 'Ingeniería Mecatrónica', matricula = 'Décima matrícula' where correo = 'ana@unal.edu.co';
  perform pg_temp.falla(format($q$select crear_reserva('UNAL-01', %L, %L, 'Fiesta')$q$, t0, t0 + interval '2 hours'), 'tipo de actividad');

  -- 0018: TDG, PAE y Semilleros exigen el docente responsable.
  perform pg_temp.falla(format($q$select crear_reserva('UNAL-01', %L, %L, 'Trabajo de grado', 'Tesis')$q$, t0, t0 + interval '2 hours'), 'docente responsable');
  perform pg_temp.falla(format($q$select crear_reserva('UNAL-01', %L, %L, 'Semilleros', null, false, null, null, '  ')$q$, t0, t0 + interval '2 hours'), 'docente responsable');
  r := crear_reserva('UNAL-01', t0, t0 + interval '2 hours', 'Trabajo de grado', 'Tesis', true, 'No apagar', 'sol-0000000000000001', '  Marta   Ruiz ');
  perform pg_temp.ok(r.docente = 'Marta Ruiz', 'el docente se guarda limpio');
  perform pg_temp.ok(r.programa = 'Ingeniería Mecatrónica' and r.matricula = 'Décima matrícula', 'la reserva congela programa y matrícula');
  perform pg_temp.ok(docentes_sugeridos() ->> 0 = 'Marta Ruiz', 'el docente ya usado se sugiere primero');
  perform pg_temp.ok((crear_reserva('UNAL-01', t0, t0 + interval '2 hours', 'Trabajo de grado', null, false, null, 'sol-0000000000000001')).id = r.id, 'reintento con el mismo id no duplica');
  perform pg_temp.falla(format($q$select crear_reserva('UNAL-01', %L, %L, 'Docencia')$q$, t0 + interval '1 hour', t0 + interval '3 hours'), 'ya está reservado');

  -- Límites: usuario y laboratorista no los saltan; administrador sí.
  perform pg_temp.falla(format($q$select crear_reserva('UNAL-02', %L, %L, 'Docencia')$q$, t0, t0 + interval '169 hours'), 'Supera el máximo');
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
  r := crear_reserva('UNAL-03', now(), now() + interval '3 hours', 'Docencia');
  perform pg_temp.falla($q$select contactar_titular('UNAL-03', 'hola')$q$, 'Usted es quien');
  perform pg_temp.como('beto@unal.edu.co');
  perform contactar_titular('UNAL-03', E'¿Le falta\nmucho?');
  perform pg_temp.ok((select cuerpo like '%beto@unal.edu.co%¿Le falta mucho?%' and responder_a = 'beto@unal.edu.co'
                        from cola_notificaciones where tipo = 'contacto'), 'el titular recibe el mensaje y a quién responder');
  perform pg_temp.falla($q$select contactar_titular('UNAL-03', 'otra vez')$q$, 'hace poco');
  perform pg_temp.falla($q$select contactar_titular('UNAL-04', 'hola')$q$, 'no hay una reserva en curso');

  -- No-show (0014: cuenta como inasistencia): avisa una sola vez (titular + personal).
  update politicas set valor = to_jsonb((now() - interval '3 days')::text) where clave = 'inasistencias_desde';
  update politicas set valor = '0' where clave = 'llegada_modo';
  update reservas set inicio = now() - interval '45 minutes' where id = r.id;
  perform pg_temp.ok(encolar_avisos_no_show() = 1, 'no-show detectado');
  perform pg_temp.ok(encolar_avisos_no_show() = 0, 'el no-show no se repite');
  perform pg_temp.ok((select count(*) from cola_notificaciones where tipo = 'sin_llegada_staff') = 2, 'el no-show llega a todo el personal');
  update politicas set valor = '1' where clave = 'llegada_modo';

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
  perform pg_temp.falla(format($q$select solicitar_excepcion('UNAL-07', %L, %L, 'Docencia', null, 'Necesito correr un modelo largo')$q$, t0, t0 + interval '10 hours'), 'no necesita solicitud');
  perform pg_temp.falla(format($q$select solicitar_excepcion('UNAL-07', %L, %L, 'Trabajo de grado', null, 'Entrenamiento de 12 días para la tesis')$q$, t0, t0 + interval '300 hours'), 'docente responsable');
  s := solicitar_excepcion('UNAL-07', t0, t0 + interval '300 hours', 'Trabajo de grado', null, 'Entrenamiento de 12 días para la tesis', 'Luis Pérez');
  perform pg_temp.falla(format($q$select resolver_excepcion(%L, true)$q$, s.id), 'Solo un administrador');
  perform pg_temp.como('admin@unal.edu.co');
  s := resolver_excepcion(s.id, true, 'Aprobado por el comité');
  perform pg_temp.ok(s.estado = 'aprobada' and (select excepcion and usuario_id = s.usuario_id from reservas where id = s.reserva_id), 'aprobar crea la reserva a nombre del solicitante');
  perform pg_temp.ok((select docente from reservas where id = s.reserva_id) = 'Luis Pérez', 'el docente de la solicitud pasa a la reserva');
  perform pg_temp.como('beto@unal.edu.co');
  s := solicitar_excepcion('UNAL-08', t0, t0 + interval '200 hours', 'Trabajo de grado', null, 'Otra corrida larga de la tesis', 'Luis Pérez');
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
  perform pg_temp.falla(format($q$select crear_reserva('UNAL-12', %L, %L, 'Docencia')$q$, t0, t0 + interval '1 hour'), 'aceptar el reglamento');
  perform aceptar_reglamento();
  r := crear_reserva('UNAL-12', now() - interval '1 minute', now() + interval '1 hour', 'Docencia');
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
  perform pg_temp.falla(format($q$select crear_reserva('UNAL-08', %L, %L, 'Docencia')$q$, now() + interval '5 minutes', now() + interval '30 minutes'), '');
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
  perform pg_temp.falla(format('select registrar_llegada(%L)', r.id), 'código que muestra Faro');

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
  update perfiles set reglamento_aceptado_en = now(), reglamento_version = (select max(version) from reglamento_versiones), tipo_usuario = 'Estudiante', programa = 'Biología', matricula = 'Novena matrícula'
   where correo = 'caro@unal.edu.co';
  perform pg_temp.como('caro@unal.edu.co');
  r := crear_reserva('UNAL-15', t0, t0 + interval '2 hours', 'Docencia');
  perform pg_temp.falla(format($q$select crear_reserva('UNAL-16', %L, %L, 'Docencia')$q$, t0 + interval '5 hours', t0 + interval '6 hours'), 'Solo se permite una a la vez');
  perform pg_temp.falla(format($q$select crear_reserva('UNAL-16', %L, %L, 'Docencia')$q$, t0, t0 + interval '2 hours'), 'UNAL-15');
  perform cancelar_reserva(r.id, 'cambio de planes');
  r2 := crear_reserva('UNAL-16', t0 + interval '5 hours', t0 + interval '6 hours', 'Docencia');
  perform pg_temp.ok(r2.id is not null, 'al cancelar la reserva puede hacer otra');
  -- Una reserva ya terminada no cuenta.
  update reservas set inicio = now() - interval '3 hours', fin = now() - interval '1 hour' where id = r2.id;
  r := crear_reserva('UNAL-14', t0, t0 + interval '1 hour', 'Docencia');
  perform pg_temp.ok(r.id is not null, 'una reserva terminada no cuenta para el límite');
  -- Reintento con el mismo id de solicitud: devuelve la misma reserva, no choca con el límite.
  update reservas set id_solicitud = 'sol-0000000000000099' where id = r.id;
  perform pg_temp.ok((crear_reserva('UNAL-14', t0, t0 + interval '1 hour', 'Docencia', null, false, null, 'sol-0000000000000099')).id = r.id,
                     'el reintento de la misma reserva no choca con el límite');
  -- El personal queda exento.
  perform pg_temp.como('lab@unal.edu.co');
  r := crear_reserva('UNAL-11', t0 + interval '20 hours', t0 + interval '21 hours', 'Docencia');
  r2 := crear_reserva('UNAL-10', t0 + interval '20 hours', t0 + interval '21 hours', 'Docencia');
  perform pg_temp.ok(r.id is not null and r2.id is not null, 'el laboratorista puede tener varias reservas');
  -- Con la política en 2, se permiten dos.
  update politicas set valor = '2' where clave = 'reservas_activas_max';
  perform pg_temp.como('caro@unal.edu.co');
  r := crear_reserva('UNAL-16', t0 + interval '8 hours', t0 + interval '9 hours', 'Docencia');
  perform pg_temp.falla(format($q$select crear_reserva('UNAL-15', %L, %L, 'Docencia')$q$, t0 + interval '10 hours', t0 + interval '11 hours'), 'el máximo permitido');
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

-- 0011: uso compartido, clases, diagnóstico en fallas, Faro (compartido, clases, programas, disco) y horario de la sala.
do $$
declare h reservas; g reservas; j jsonb; t6 text; t4 text; c clases; n int; v_hhmm int; v_hoy date := (now() at time zone 'America/Bogota')::date;
begin
  insert into auth.users (email, raw_user_meta_data) values ('dora@unal.edu.co', '{"name": "Dora"}'), ('doc@unal.edu.co', '{"name": "Docente Uno"}');
  update perfiles set tipo_usuario = 'Docente/Investigador', programa = 'Estadística', reglamento_aceptado_en = now(), reglamento_version = (select max(version) from reglamento_versiones) where correo = 'doc@unal.edu.co';
  update perfiles set docente_verificado_en = now() where correo = 'doc@unal.edu.co';   -- 0013: docente verificado

  -- Uso compartido: Ana deja un proceso y comparte su reserva.
  insert into reservas (equipo_id, usuario_id, inicio, fin, actividad)
  select e.id, p.id, now() - interval '5 minutes', now() + interval '3 hours', 'Investigación'
    from equipos e, perfiles p where e.codigo = 'UNAL-06' and p.correo = 'ana@unal.edu.co' returning * into h;
  perform pg_temp.como('ana@unal.edu.co');
  h := marcar_compartida(h.id, true, array['RStudio', ' RStudio ', 'Python'], 'No cerrar RStudio: modelo corriendo');
  perform pg_temp.ok(h.compartida and h.desatendido and cardinality(h.protegidos) = 2, 'una reserva se marca como uso compartido con programas protegidos');
  perform pg_temp.ok((select compartida and 'RStudio' = any (protegidos) from ocupacion_publica where codigo = 'UNAL-06' and inicio = h.inicio),
                     'la agenda pública muestra el tramo compartido');
  -- Otra persona puede reservar dentro del horario compartido; dos invitados a la vez no.
  insert into reservas (equipo_id, usuario_id, inicio, fin, actividad)
  select e.id, p.id, now() - interval '1 minute', now() + interval '1 hour', 'PAE'
    from equipos e, perfiles p where e.codigo = 'UNAL-06' and p.correo = 'dora@unal.edu.co' returning * into g;
  perform pg_temp.ok(g.id is not null, 'se puede reservar un equipo en uso compartido');
  perform pg_temp.ok(exists (select 1 from cola_notificaciones where dedupe_key = 'compartida:' || g.id and usuario_id = h.usuario_id),
                     'la titular recibe aviso cuando alguien usa su equipo compartido');
  perform pg_temp.falla(format($q$insert into reservas (equipo_id, usuario_id, inicio, fin, actividad)
    select e.id, p.id, now() + interval '30 minutes', now() + interval '90 minutes', 'PAE' from equipos e, perfiles p
     where e.codigo = 'UNAL-06' and p.correo = 'caro@unal.edu.co'$q$), 'sin_solapamiento');
  perform pg_temp.falla($q$insert into reservas (tipo, equipo_id, usuario_id, inicio, fin, motivo)
    select 'bloqueo', e.id, p.id, now() + interval '2 hours', now() + interval '4 hours', 'Mantenimiento' from equipos e, perfiles p
     where e.codigo = 'UNAL-06' and p.correo = 'lab@unal.edu.co'$q$, 'uso compartido');
  perform pg_temp.falla(format($q$select marcar_compartida(%L, false)$q$, h.id), 'no puedes dejar de compartir');
  perform pg_temp.como('dora@unal.edu.co');
  perform pg_temp.falla(format($q$select marcar_compartida(%L, false)$q$, h.id), 'no encontrada');

  -- Faro en el equipo compartido.
  perform pg_temp.como('lab@unal.edu.co');
  t6 := faro_vincular(faro_codigo_vinculo('UNAL-06') ->> 'codigo', 'PC-06', 'Windows 11', '0.5.0') ->> 'token';
  update agentes set ultimo_latido = now() - interval '60 seconds' where equipo_id = (select id from equipos where codigo = 'UNAL-06');
  j := faro_estado(t6, '{"inactivo_seg": 5, "cpu": 40, "programas": ["RStudio", "Python"], "inventario": {"disco_salud": "advertencia", "disco_gb": 500, "disco_libre_gb": 200}}');
  perform pg_temp.ok(j -> 'compartido' -> 'protegidos' ? 'RStudio' and j -> 'compartido' ->> 'titular' is not null, 'Faro recibe los programas protegidos');
  perform pg_temp.ok(j -> 'actual' ->> 'tipo' = 'reserva' and (j -> 'actual' ->> 'inicio')::timestamptz = g.inicio, 'con invitado, Faro ve la reserva del invitado');
  perform pg_temp.ok(j ? 'espera', 'Faro recibe cuántas personas esperan equipo');
  perform pg_temp.ok((select sum(minutos) from faro_programas where programa = 'RStudio') >= 1, 'Faro suma minutos de uso por programa');
  perform pg_temp.ok(exists (select 1 from cola_chat where tipo = 'faro_disco_salud'), 'un disco con advertencias avisa al chat');
  update reservas set estado = 'cancelada' where id = g.id;
  j := faro_estado(t6, '{"inactivo_seg": 5}');
  perform pg_temp.ok(j -> 'actual' = 'null'::jsonb and j ? 'compartido', 'sin invitado, el equipo compartido queda libre para usarlo');
  perform pg_temp.ok((faro_programas_resumen(v_hoy, v_hoy) -> 0 ->> 'programa') is not null, 'resumen de programas usados');

  -- Diagnóstico automático al reportar una falla.
  perform pg_temp.como('dora@unal.edu.co');
  perform reportar_falla('UNAL-06', 'Lento o se congela', 'Va muy lento hoy, se congela al abrir R');
  perform pg_temp.ok((select (diagnostico ->> 'en_linea')::boolean and diagnostico ->> 'version' = '0.5.0' from reportes
                       where equipo_id = (select id from equipos where codigo = 'UNAL-06') order by creado_en desc limit 1),
                     'la falla reportada trae el diagnóstico de Faro');

  -- Clases: solo docentes solicitan; el personal aprueba con los equipos libres.
  perform pg_temp.falla($q$select solicitar_clase('Estadística I', 'Prof. Uno', 2, array[2, 4], '14:00', '16:00', current_date + 7, current_date + 20)$q$,
                        'Solo docentes');
  perform pg_temp.como('doc@unal.edu.co');
  perform pg_temp.falla(format($q$select solicitar_clase('Estadística I', 'Prof. Uno', 2, array[2, 4], '14:00', '16:00', %L, %L)$q$,
                               v_hoy - 1, v_hoy + 10), 'pasado');
  perform pg_temp.falla(format($q$select solicitar_clase('Estadística I', 'Prof. Uno', 2, array[2], '14:00', '16:00', %L, %L)$q$,
                               v_hoy, v_hoy + 400), 'semanas');
  c := solicitar_clase('Estadística I', 'Prof. Uno', 2, array[2, 4], '14:00', '16:00', v_hoy + 7, v_hoy + 20, 5, 'Taller de R');
  perform pg_temp.ok(c.estado = 'pendiente' and c.dias = array[2, 4]::smallint[], 'un docente solicita la sala para una clase semanal');
  perform pg_temp.ok(exists (select 1 from cola_chat where dedupe_key = 'clase:' || c.id), 'la solicitud de clase avisa al chat del personal');
  perform pg_temp.como('lab@unal.edu.co');
  j := clase_previa(c.id);
  n := (j ->> 'total_sesiones')::int;
  perform pg_temp.ok(n between 3 and 5 and jsonb_array_length(j -> 'equipos') > 10, 'la vista previa calcula sesiones y equipos libres');
  j := aprobar_clase(c.id, array['unal-10', 'UNAL-11'], 'Lleguen 5 min antes');
  perform pg_temp.ok((j ->> 'creadas')::int = 2 * n, 'aprobar crea un bloqueo por equipo y sesión');
  perform pg_temp.ok(exists (select 1 from cola_notificaciones where dedupe_key = 'clase_ok:' || c.id), 'el docente recibe la aprobación con los equipos');
  perform pg_temp.ok((select ocupacion_publica.motivo from ocupacion_publica where codigo = 'UNAL-10' and motivo like 'Clase · Estadística I%' limit 1) is not null,
                     'la agenda muestra la clase sin datos personales');
  perform pg_temp.falla(format($q$select aprobar_clase(%s, array['UNAL-10'])$q$, c.id), 'ya fue aprobada');
  perform pg_temp.como('doc@unal.edu.co');
  perform pg_temp.ok(cancelar_clase(c.id, 'Cambio de horario') = 2 * n, 'el docente cancela y se liberan las sesiones futuras');

  -- Clase en curso: el equipo habilitado queda desbloqueado en Faro.
  perform pg_temp.como('lab@unal.edu.co');
  t4 := faro_vincular(faro_codigo_vinculo('UNAL-04') ->> 'codigo', 'PC-04', 'Windows 11', '0.5.0') ->> 'token';
  insert into reservas (tipo, equipo_id, usuario_id, inicio, fin, motivo, clase_id)
  select 'bloqueo', e.id, p.id, now() - interval '5 minutes', now() + interval '1 hour', 'Clase · Estadística I · grupo 2', c.id
    from equipos e, perfiles p where e.codigo = 'UNAL-04' and p.correo = 'lab@unal.edu.co';
  j := faro_estado(t4, '{"inactivo_seg": 5}');
  perform pg_temp.ok(j ->> 'desbloqueo_hasta' is not null, 'durante la clase, Faro deja usar los equipos habilitados');

  -- Horario automático: apagar omite los equipos con reserva o uso compartido en curso.
  v_hhmm := extract(hour from now() at time zone 'America/Bogota')::int * 100 + extract(minute from now() at time zone 'America/Bogota')::int;
  update politicas set valor = to_jsonb(v_hhmm) where clave = 'sala_apagar_hhmm';
  update politicas set valor = '1' where clave = 'sala_sabado';
  update agentes set ultimo_latido = now() where token_hash is not null;
  j := sala_tick();
  if extract(isodow from now() at time zone 'America/Bogota') < 7 then
    perform pg_temp.ok(j -> 'acciones' ? 'apagar', 'a la hora de cierre se ordena apagar la sala');
    perform pg_temp.ok(not exists (select 1 from agente_comandos where tipo = 'apagar' and equipo_id in
                                     (select id from equipos where codigo in ('UNAL-06', 'UNAL-04')) and creado_por is null),
                       'no se apagan equipos con uso compartido o clase en curso');
    perform pg_temp.ok(not (sala_tick() -> 'acciones' ? 'apagar'), 'el cierre se ordena una sola vez al día');
  end if;
  update politicas set valor = '0' where clave in ('sala_apagar_hhmm', 'sala_sabado');
  -- Red caída: varios Faro dejan de responder a la vez.
  update agentes set ultimo_latido = now() - interval '5 minutes' where token_hash is not null;
  perform pg_temp.ok(sala_tick() -> 'acciones' ? 'red_caida', 'si varios Faro dejan de responder a la vez, se avisa de posible caída de red');
end $$;

-- 0012: órdenes con motivo por equipo y acciones desde Telegram como la persona vinculada.
do $$
declare j jsonb; cod text; c clases; v_hoy date := (now() at time zone 'America/Bogota')::date; begin
  perform pg_temp.como('lab@unal.edu.co');
  update agentes set ultimo_latido = now() where token_hash is not null;
  j := faro_orden(array['UNAL-06'], 'encender');
  perform pg_temp.ok(jsonb_array_length(j -> 'enviados') = 0 and j -> 'omitidos' -> 0 ->> 'motivo' = 'ya_encendido',
                     'encender un equipo ya encendido explica el motivo');
  j := faro_orden(array['UNAL-01'], 'encender');
  perform pg_temp.ok(j -> 'omitidos' -> 0 ->> 'motivo' = 'sin_faro', 'un equipo sin Faro lo dice');
  update agentes set ultimo_latido = now() - interval '10 minutes', inventario = jsonb_build_object('mac', 'aa:bb:cc:dd:ee:04')
   where equipo_id = (select id from equipos where codigo = 'UNAL-04');
  j := faro_orden(null, 'encender');
  perform pg_temp.ok(j -> 'enviados' ? 'UNAL-04' and j ->> 'ayudante' is not null and (j ->> 'sala')::boolean, 'encender la sala usa otro Faro como ayudante');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(j -> 'omitidos') x where x ->> 'motivo' = 'sin_faro'),
                     'en la sala no se listan los equipos sin Faro');
  j := faro_orden(array['UNAL-06'], 'apagar');
  perform pg_temp.ok(j -> 'omitidos' -> 0 ->> 'motivo' = 'compartido', 'no apaga un uso compartido y lo dice');
  perform pg_temp.falla($q$select faro_orden(array['UNAL-99'], 'apagar')$q$, 'No existe');

  -- Telegram: vincular con código y actuar como esa persona.
  cod := telegram_codigo();
  perform pg_temp.ok(cod ~ '^\d{6}$', 'el personal genera un código de 6 dígitos');
  perform pg_temp.ok(telegram_vincular(555, '@lab', cod) is not null, 'el código vincula la cuenta de Telegram');
  perform pg_temp.falla(format($q$select telegram_vincular(556, 'x', %L)$q$, cod), 'vencido');
  perform pg_temp.como('ana@unal.edu.co');
  perform pg_temp.falla($q$select telegram_codigo()$q$, 'Solo el personal');
  perform set_config('request.jwt.claim.sub', '', false);
  j := telegram_accion(999, 'anuncio', '{"texto": "Hola", "minutos": 30}');
  perform pg_temp.ok(not (j ->> 'ok')::boolean and j ->> 'error' ilike '%no está vinculada%', 'una cuenta sin vincular no puede actuar');
  j := telegram_accion(555, 'anuncio', '{"texto": "Cerramos temprano", "minutos": 30}');
  perform pg_temp.ok((j ->> 'ok')::boolean and exists (select 1 from faro_anuncios where texto = 'Cerramos temprano'
                       and creado_por = (select id from perfiles where correo = 'lab@unal.edu.co')),
                     'Telegram publica un anuncio a nombre de quien vinculó la cuenta');
  j := telegram_accion(555, 'orden', '{"tipo": "apagar", "equipos": ["UNAL-06"]}');
  perform pg_temp.ok((j ->> 'ok')::boolean and j -> 'datos' -> 'omitidos' -> 0 ->> 'motivo' = 'compartido', 'Telegram usa las mismas reglas de las órdenes');
  j := telegram_accion(555, 'liberar', '{"equipo": "UNAL-19"}');
  perform pg_temp.ok(not (j ->> 'ok')::boolean, 'un error se devuelve como texto, sin romper');
  perform pg_temp.ok(exists (select 1 from consola_registro where comando like 'Telegram /anuncio%' and ok), 'las acciones de Telegram quedan en el Registro');
  -- Aprobar una clase desde Telegram con la preselección de la app.
  perform pg_temp.como('doc@unal.edu.co');
  c := solicitar_clase('Muestreo', 'Prof. Uno', 3, array[3], '08:00', '10:00', v_hoy + 14, v_hoy + 28, 2);
  perform set_config('request.jwt.claim.sub', '', false);
  j := telegram_accion(555, 'aprobar', jsonb_build_object('id', c.id));
  perform pg_temp.ok((j ->> 'ok')::boolean and jsonb_array_length(j -> 'datos' -> 'equipos') = 2
                     and (select estado from clases where id = c.id) = 'aprobada', 'Telegram aprueba una clase con los equipos libres');

  -- 0013: docentes verificados.
  insert into auth.users (email, raw_user_meta_data) values ('eva@unal.edu.co', '{"name": "Eva Docente"}'), ('fer@unal.edu.co', '{"name": "Fer"}');
  update perfiles set reglamento_aceptado_en = now(), reglamento_version = (select max(version) from reglamento_versiones), programa = 'Estadística' where correo in ('eva@unal.edu.co', 'fer@unal.edu.co');
  perform pg_temp.como('eva@unal.edu.co');
  update perfiles set tipo_usuario = 'Docente/Investigador' where id = auth.uid();
  perform pg_temp.ok(exists (select 1 from verificaciones_docente where perfil_id = auth.uid() and estado = 'pendiente'),
                     'elegir «docente» en el perfil abre una verificación');
  perform pg_temp.ok(exists (select 1 from cola_chat where tipo = 'verificacion_docente' and texto not like '%Eva%'),
                     'el chat del personal se entera sin datos personales');
  perform pg_temp.falla(format($q$select solicitar_clase('Cálculo', 'x', 1, array[1,2,3,4,5,6], '14:00', '16:00', %L, %L)$q$, v_hoy + 1, v_hoy + 8),
                        'verificados');
  perform pg_temp.falla($q$select pedir_verificacion_docente('x')$q$, 'asignaturas');
  perform pedir_verificacion_docente('Dicto Cálculo I en Ingeniería');
  perform pg_temp.ok((select mensaje from verificaciones_docente where perfil_id = auth.uid() and estado = 'pendiente') like 'Dicto%',
                     'la persona explica qué asignaturas dicta');
  perform pg_temp.falla($q$select * from verificaciones_pendientes()$q$, 'personal');
  perform pg_temp.como('lab@unal.edu.co');
  perform resolver_verificacion((select v.id from verificaciones_docente v join perfiles p on p.id = v.perfil_id
                                  where p.correo = 'eva@unal.edu.co' and v.estado = 'pendiente'), true);
  perform pg_temp.ok((select docente_verificado_en is not null from perfiles where correo = 'eva@unal.edu.co'), 'el personal verifica al docente');
  perform pg_temp.como('eva@unal.edu.co');
  perform pg_temp.falla(format($q$select solicitar_clase('Cálculo', 'x', 1, array[1,2,3,4,5,6], '14:00', '16:00', %L, %L, 999)$q$, v_hoy + 1, v_hoy + 8),
                        'entre 1 y');
  if extract(isodow from v_hoy) < 7 then   -- los domingos no hay clases
    perform pg_temp.falla(format($q$select solicitar_clase('Cálculo', 'x', 1, array[%s], '00:00', '00:30', %L, %L)$q$,
                                 extract(isodow from v_hoy)::int, v_hoy, v_hoy), 'pasaron');
  end if;
  c := solicitar_clase('Cálculo', 'Otro nombre', 1, array[1,2,3,4,5,6], '18:00', '20:00', v_hoy + 1, v_hoy + 3, null);
  perform pg_temp.ok(c.docente = 'Eva Docente' and c.docente_correo = 'eva@unal.edu.co' and c.equipos_pedidos is null,
                     'el docente es siempre quien solicita, con su correo; sin cantidad = los disponibles');
  perform pg_temp.como('lab@unal.edu.co');
  j := clase_previa(c.id);
  perform pg_temp.ok(j ? 'pasadas' and (j ->> 'total_equipos')::int > 10, 'la vista previa dice cuántas sesiones ya pasaron y cuántos equipos hay');
  j := aprobar_clase(c.id, array['UNAL-15', 'UNAL-16']);
  perform pg_temp.ok((select responder_a from cola_notificaciones where dedupe_key = 'clase_ok:' || c.id) = 'lab@unal.edu.co',
                     'el correo de autorización se responde a quien aprobó');
  perform clase_reenviar(c.id);
  perform pg_temp.ok((select count(*) from cola_notificaciones where dedupe_key like 'clase_ok:' || c.id || '%') = 2, 'el personal puede reenviar la autorización');
  perform pg_temp.como('eva@unal.edu.co');
  j := clase_hoja(c.id);
  perform pg_temp.ok(j ->> 'consecutivo' = 'CL-' || lpad(c.id::text, 5, '0') and jsonb_array_length(j -> 'equipos') = 2
                     and j ->> 'aprobado_por' is not null and jsonb_array_length(j -> 'sesiones') >= 2, 'la hoja de autorización trae todo');
  perform pg_temp.como('beto@unal.edu.co');
  perform pg_temp.falla(format('select clase_hoja(%s)', c.id), 'no encontrada');
  -- Rechazo: vuelve a pedir el tipo de usuario.
  perform pg_temp.como('fer@unal.edu.co');
  update perfiles set tipo_usuario = 'Docente/Investigador' where id = auth.uid();
  perform pg_temp.como('admin@unal.edu.co');
  perform pg_temp.falla(format('select resolver_verificacion(%s, false, %L)',
                        (select v.id from verificaciones_docente v join perfiles p on p.id = v.perfil_id where p.correo = 'fer@unal.edu.co' and v.estado = 'pendiente'), ''),
                        'motivo');
  perform resolver_verificacion((select v.id from verificaciones_docente v join perfiles p on p.id = v.perfil_id
                                  where p.correo = 'fer@unal.edu.co' and v.estado = 'pendiente'), false, 'No aparece en la planta docente');
  perform pg_temp.ok((select tipo_usuario is null from perfiles where correo = 'fer@unal.edu.co')
                     and exists (select 1 from cola_notificaciones n join perfiles p on p.id = n.usuario_id
                                  where p.correo = 'fer@unal.edu.co' and n.tipo = 'docente_rechazado'), 'si no se verifica, se le pide actualizar su tipo');
  perform marcar_docente((select id from perfiles where correo = 'fer@unal.edu.co'), true);
  perform pg_temp.ok((select docente_verificado_en is not null and tipo_usuario = 'Docente/Investigador' from perfiles where correo = 'fer@unal.edu.co'),
                     'el personal puede marcar a alguien como docente directamente');
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
  perform pg_temp.ok((select count(*) from clases) = 0, 'las solicitudes de clase ajenas no se ven');
  perform pg_temp.falla($q$select sala_tick()$q$, 'permission denied');
  perform pg_temp.falla($q$select * from faro_programas$q$, 'permission denied');
  perform pg_temp.falla($q$select telegram_accion(1, 'anuncio')$q$, 'permission denied');
  perform pg_temp.falla($q$select * from telegram_vinculos$q$, 'permission denied');
  perform pg_temp.falla($q$select clase_hoja_correo(1)$q$, 'permission denied');
  perform pg_temp.falla($q$select _faro_codigo_numero('a', 'b', 1)$q$, 'permission denied');
  perform pg_temp.falla($q$select * from llegada_intentos$q$, 'permission denied');
  perform pg_temp.falla($q$update perfiles set docente_verificado_en = now() where id = auth.uid()$q$, 'permission denied');
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
  perform pg_temp.falla($q$select reserva_detalle(gen_random_uuid())$q$, 'Solo el personal');
  perform pg_temp.ok((select count(*) from reservas_importadas) = 0, 'las reservas importadas solo las ve el personal');
  perform pg_temp.falla($q$select _docente_para('PAE', 'Ana')$q$, 'permission denied');
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

-- 0014: inasistencias, clases vencidas y bot con botones.
do $$
declare g uuid; e17 uuid; i inasistencias; c clases; j jsonb; n int; r reservas;
begin
  update politicas set valor = to_jsonb((now() - interval '3 days')::text) where clave = 'inasistencias_desde';
  update politicas set valor = '0' where clave = 'llegada_modo';
  insert into auth.users (email, raw_user_meta_data) values ('gil@unal.edu.co', '{"name": "Gil"}');
  select id into g from perfiles where correo = 'gil@unal.edu.co';
  update perfiles set reglamento_aceptado_en = now(), reglamento_version = (select max(version) from reglamento_versiones), programa = 'Estadística', tipo_usuario = 'Estudiante', matricula = 'Primera' where id = g;
  select id into e17 from equipos where codigo = 'UNAL-14';
  perform pg_temp.como('lab@unal.edu.co');
  insert into reservas (equipo_id, usuario_id, inicio, fin, actividad) values
    (e17, g, now() - interval '30 hours', now() - interval '29 hours', 'PAE'),
    (e17, g, now() - interval '28 hours', now() - interval '27 hours', 'PAE'),
    (e17, g, now() - interval '26 hours', now() - interval '25 hours', 'PAE'),
    (e17, g, now() - interval '24 hours', now() - interval '23 hours', 'PAE');
  update reservas set estado = 'cancelada' where equipo_id = e17 and inicio < now() - interval '25 hours' and inicio > now() - interval '27 hours';
  update reservas set llegada_en = inicio + interval '5 minutes' where equipo_id = e17 and inicio < now() - interval '23 hours' and inicio > now() - interval '25 hours';
  perform pg_temp.ok(not exists (select 1 from inasistencias where usuario_id = g), 'aún no hay inasistencias');
  j := revisar_llegadas();
  perform pg_temp.ok((select count(*) from inasistencias where usuario_id = g) = 2, 'cuentan solo las reservas sin llegada ni cancelación');
  select * into i from inasistencias where usuario_id = g order by inicio desc limit 1;
  perform pg_temp.ok(i.numero = 2 and i.sancion_hasta > now() + interval '2 days' and i.sancion_hasta < now() + interval '4 days',
                     'la segunda inasistencia da 3 días sin reservar');
  perform pg_temp.ok((select sancion_hasta is null from inasistencias where usuario_id = g and numero = 1), 'la primera es solo un aviso');
  perform pg_temp.ok(exists (select 1 from cola_notificaciones where usuario_id = g and tipo = 'inasistencia' and titulo like 'No podrá reservar%'),
                     'la persona recibe el aviso con la sanción');
  perform pg_temp.ok((revisar_llegadas() ->> 'inasistencias')::int = 0, 'no se cuenta dos veces');
  perform pg_temp.como('gil@unal.edu.co');
  perform pg_temp.falla(format($q$insert into reservas (equipo_id, usuario_id, inicio, fin, actividad) values (%L, %L, now() + interval '300 hours', now() + interval '301 hours', 'PAE')$q$, e17, g),
                        'No puede reservar hasta');
  -- Apelación.
  perform pg_temp.falla(format('select apelar_inasistencia(%s, %L)', i.id, 'corto'), '10 caracteres');
  perform apelar_inasistencia(i.id, 'Llegué a tiempo pero el QR no funcionó');
  perform pg_temp.falla(format('select apelar_inasistencia(%s, %L)', i.id, 'Llegué a tiempo pero el QR no funcionó'), 'Ya apeló');
  perform pg_temp.ok(exists (select 1 from cola_chat where dedupe_key = 'apel:' || i.id), 'el chat del personal recibe la apelación');
  perform pg_temp.falla('select * from inasistencias_apeladas()', 'personal');
  perform pg_temp.como('lab@unal.edu.co');
  perform pg_temp.ok((select count(*) from inasistencias_apeladas()) = 1, 'el personal ve las apelaciones pendientes');
  perform pg_temp.falla(format('select resolver_apelacion(%s, false, %L)', i.id, ''), 'motivo');
  -- Desde Telegram con el botón «Anular» (la cuenta 555 del personal se vinculó antes).
  j := telegram_ejecutar(555, 'anular', jsonb_build_object('id', i.id));
  perform pg_temp.ok((j ->> 'ok')::boolean and j ->> 'actor' is not null and (select estado from inasistencias where id = i.id) = 'anulada',
                     'el botón de Telegram anula el strike y dice quién lo hizo');
  perform pg_temp.como('gil@unal.edu.co');
  insert into reservas (equipo_id, usuario_id, inicio, fin, actividad) values (e17, g, now() + interval '300 hours', now() + interval '301 hours', 'PAE') returning * into r;
  perform pg_temp.ok(r.id is not null, 'al anular la inasistencia se levanta la sanción');
  update reservas set estado = 'cancelada' where id = r.id;
  -- Recordatorios de llegada.
  perform pg_temp.como('lab@unal.edu.co');
  insert into reservas (equipo_id, usuario_id, inicio, fin, actividad, creado_en) values
    (e17, g, now() - interval '3 minutes', now() + interval '1 hour', 'PAE', now() - interval '2 hours') returning * into r;
  perform revisar_llegadas();
  perform pg_temp.ok(exists (select 1 from cola_notificaciones where dedupe_key = 'llegada1:' || r.id), 'recordatorio al empezar la reserva');
  update reservas set inicio = now() - interval '25 minutes' where id = r.id;
  perform revisar_llegadas();
  perform pg_temp.ok(exists (select 1 from cola_notificaciones where dedupe_key = 'llegada2:' || r.id), 'último aviso 10 minutos antes del límite');
  -- Sin forma de registrar la llegada (modo 1 y sin Faro): no cuenta.
  update politicas set valor = '1' where clave = 'llegada_modo';
  update reservas set inicio = now() - interval '45 minutes' where id = r.id;
  perform revisar_llegadas();
  perform pg_temp.ok(not exists (select 1 from inasistencias where reserva_id = r.id), 'si no podía registrar la llegada, no cuenta');
  update politicas set valor = '0' where clave = 'llegada_modo';
  -- El personal no acumula inasistencias.
  insert into reservas (equipo_id, usuario_id, inicio, fin, actividad)
  select e17, id, now() - interval '20 hours', now() - interval '19 hours', 'PAE' from perfiles where correo = 'lab@unal.edu.co';
  perform revisar_llegadas();
  perform pg_temp.ok(not exists (select 1 from inasistencias i2 join perfiles p on p.id = i2.usuario_id where p.correo = 'lab@unal.edu.co'),
                     'el personal no acumula inasistencias');
  -- Solicitud de clase vencida.
  insert into clases (solicitante, nombre, docente, grupo, dias, hora_inicio, hora_fin, desde, hasta)
  select id, 'Vieja', 'Doc', 1, array[1,2,3,4,5,6]::smallint[], '08:00', '10:00', current_date - 10, current_date - 3
    from perfiles where correo = 'doc@unal.edu.co' returning * into c;
  n := cerrar_clases_vencidas();
  perform pg_temp.ok((select estado from clases where id = c.id) = 'vencida'
                     and exists (select 1 from cola_notificaciones where dedupe_key = 'clase_vencida:' || c.id),
                     'la solicitud sin sesiones futuras se cierra sola y avisa al docente');
  perform pg_temp.ok((select dedupe_key from chat_pendientes(50) where dedupe_key = 'apel:' || i.id) is not null, 'el bot recibe la clave de cada mensaje');
end $$;

-- 0015: confirmar asistencia con el código de 6 dígitos de Faro.
do $$
declare g uuid; e uuid; t text; sec text; r reservas; j jsonb; v_vent bigint := floor(extract(epoch from now()) / 30)::bigint;
begin
  perform pg_temp.ok(_faro_codigo_numero('abc', 'UNAL-08', 123) = '199997', 'el código de 6 dígitos coincide con el de Faro');
  update politicas set valor = '2' where clave = 'llegada_modo';
  select id into g from perfiles where correo = 'gil@unal.edu.co';
  select id into e from equipos where codigo = 'UNAL-15';
  update reservas set estado = 'cancelada' where usuario_id = g and estado = 'activa' and fin > now();
  perform pg_temp.como('lab@unal.edu.co');
  t := faro_vincular(faro_codigo_vinculo('UNAL-15') ->> 'codigo', 'PC-15', 'Windows 11', '0.5.3') ->> 'token';
  j := faro_estado(t, '{}');
  sec := j #>> '{qr,secreto}';
  insert into reservas (equipo_id, usuario_id, inicio, fin, actividad) values (e, g, now() - interval '2 minutes', now() + interval '1 hour', 'PAE') returning * into r;
  perform pg_temp.como('gil@unal.edu.co');
  perform pg_temp.falla(format('select registrar_llegada(%L)', r.id), 'código que muestra Faro');
  perform pg_temp.ok(mi_llegada_pendiente() ->> 'equipo' = 'UNAL-15', 'la app sabe qué reserva espera confirmar asistencia');
  j := confirmar_llegada('000000');
  if j ->> 'ok' = 'true' then j := confirmar_llegada('999999'); end if;
  perform pg_temp.ok(j ->> 'ok' = 'false' and j ->> 'error' like '%UNAL-15%' and (select llegada_en from reservas where id = r.id) is null,
                     'un código equivocado no registra la llegada');
  perform pg_temp.ok(exists (select 1 from llegada_intentos where usuario_id = g), 'el intento fallido queda contado');
  j := confirmar_llegada(substr(_faro_codigo_numero(sec, 'UNAL-15', v_vent - 1), 1, 3) || ' ' || substr(_faro_codigo_numero(sec, 'UNAL-15', v_vent - 1), 4));
  perform pg_temp.ok(j ->> 'ok' = 'true' and (select llegada_en from reservas where id = r.id) is not null,
                     'con el código que muestra Faro se confirma la asistencia (acepta espacios y el código anterior)');
  perform pg_temp.ok(mi_llegada_pendiente() is null and confirmar_llegada('123') ->> 'ya' = 'true', 'confirmar dos veces no falla');
  insert into llegada_intentos (usuario_id) select g from generate_series(1, 5);
  perform pg_temp.ok(confirmar_llegada('123456') ->> 'error' like 'Demasiados%', 'tras 5 códigos equivocados hay que esperar');
end $$;

-- 0016: pausar las reservas.
do $$
declare g uuid; e uuid;
begin
  select id into g from perfiles where correo = 'gil@unal.edu.co';
  select id into e from equipos where codigo = 'UNAL-14';
  update politicas set valor = '1' where clave = 'reservas_pausadas';
  perform pg_temp.como('gil@unal.edu.co');
  perform pg_temp.falla(format($q$insert into reservas (equipo_id, usuario_id, inicio, fin, actividad) values (%L, %L, now() + interval '500 hours', now() + interval '501 hours', 'PAE')$q$, e, g),
                        'pausadas');
  perform pg_temp.como('lab@unal.edu.co');
  insert into reservas (equipo_id, usuario_id, inicio, fin, actividad) values (e, g, now() + interval '500 hours', now() + interval '501 hours', 'PAE');
  perform pg_temp.ok(true, 'con las reservas pausadas, el personal sí puede crear reservas');
  update politicas set valor = '0' where clave = 'reservas_pausadas';
end $$;

-- 0017: solicitudes de software.
do $$
declare g uuid; e uuid; s solicitudes_software; r reservas; j jsonb; v_lejos date;
begin
  select id into g from perfiles where correo = 'gil@unal.edu.co';
  select id into e from equipos where codigo = 'UNAL-14';
  v_lejos := (now() at time zone 'America/Bogota')::date + 14;
  perform pg_temp.como('gil@unal.edu.co');
  perform pg_temp.falla($q$select solicitar_software('', 'Para la tesis de grado')$q$, 'qué software');
  perform pg_temp.falla($q$select solicitar_software('QGIS', 'corto')$q$, '10 caracteres');
  perform pg_temp.falla(format($q$select solicitar_software('QGIS', 'Mapas para la tesis de grado', null, null, null, null, %L)$q$,
                               (now() at time zone 'America/Bogota')::date + 1), 'días hábiles');
  s := solicitar_software('QGIS', 'Mapas para la tesis de grado', '3.34', null, null, 'unal-14', v_lejos);
  perform pg_temp.ok(s.estado = 'pendiente' and s.equipo_id = e and s.para_fecha = v_lejos, 'se pide software sin reserva, para un equipo y una fecha');
  perform pg_temp.ok(exists (select 1 from cola_chat where dedupe_key = 'soft:' || s.id and texto not like '%Gil%'), 'el chat recibe la solicitud sin datos personales');
  perform pg_temp.falla(format('select actualizar_software(%s, %L)', s.id, 'en_tramite'), 'personal');
  -- Con una reserva: la fecha es la de la reserva.
  perform pg_temp.como('lab@unal.edu.co');
  insert into reservas (equipo_id, usuario_id, inicio, fin, actividad) values (e, g, now() + interval '20 days', now() + interval '20 days 2 hours', 'PAE') returning * into r;
  perform pg_temp.como('gil@unal.edu.co');
  perform pg_temp.ok((solicitar_software('Stata', 'Modelos de panel para la clase', null, null, r.id)).para_fecha = (r.inicio at time zone 'America/Bogota')::date,
                     'con reserva, la fecha sale de la reserva');
  -- El personal avanza la primera.
  perform pg_temp.como('lab@unal.edu.co');
  perform actualizar_software(s.id, 'en_tramite');
  perform pg_temp.falla(format('select actualizar_software(%s, %L)', s.id, 'instalado'), 'qué equipos');
  -- Desde el botón de Telegram, con los equipos escritos.
  j := telegram_ejecutar(555, 'software_instalado', jsonb_build_object('id', s.id, 'motivo', '14 7'));
  perform pg_temp.ok((j ->> 'ok')::boolean and (select equipos_instalados from solicitudes_software where id = s.id) = array['UNAL-07', 'UNAL-14'],
                     'el botón «Instalado en…» de Telegram entiende «14 7»');
  perform pg_temp.ok((select 'QGIS' = any (software) from equipos where codigo = 'UNAL-14'), 'el programa instalado se agrega al equipo');
  perform pg_temp.ok(exists (select 1 from cola_notificaciones where usuario_id = g and tipo = 'software_instalado'), 'la persona recibe el aviso de instalado');
  perform pg_temp.falla(format('select actualizar_software(%s, %L)', s.id, 'rechazada'), 'ya está');
  perform pg_temp.como('gil@unal.edu.co');
  perform pg_temp.ok((select count(*) from solicitudes_software) = 2, 'cada persona ve sus solicitudes');
  perform cancelar_software((select id from solicitudes_software where software = 'Stata'));
  perform pg_temp.ok((select estado from solicitudes_software where software = 'Stata') = 'cancelada', 'la persona puede cancelar la suya');
end $$;

-- 0018: detalle completo de una reserva para el personal.
do $$
declare r reservas; j jsonb; begin
  select * into r from reservas where docente = 'Marta Ruiz' limit 1;
  perform pg_temp.como('lab@unal.edu.co');
  update reservas set fin = fin + interval '30 minutes' where id = r.id;
  j := reserva_detalle(r.id);
  perform pg_temp.ok(j -> 'reserva' ->> 'docente' = 'Marta Ruiz' and not (j -> 'reserva' ? 'token_credencial'), 'el detalle trae el docente y no el token de la credencial');
  perform pg_temp.ok(j -> 'titular' ->> 'correo' = 'ana@unal.edu.co' and j -> 'equipo' ->> 'codigo' = 'UNAL-01', 'el detalle trae titular y equipo');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(j -> 'historial') h
                              where h ->> 'accion' = 'extendida' and h ->> 'actor' is not null
                                and exists (select 1 from jsonb_array_elements(h -> 'cambios') c where c ->> 'campo' = 'fin')),
                     'el historial dice quién extendió y qué cambió');
  perform pg_temp.ok(reserva_detalle(gen_random_uuid()) is null, 'una reserva que no existe da nulo');
end $$;

-- 0019: guardar el perfil sin cambios no escribe; hay un límite por hora y alternar docente no reabre verificaciones.
do $$
declare v perfiles; n int; begin
  perform pg_temp.como('beto@unal.edu.co');
  update perfiles set perfil_cambios = 0, perfil_cambios_desde = null where id = auth.uid();
  select * into v from perfiles where id = auth.uid();
  update perfiles set nombre = v.nombre, programa = v.programa where id = auth.uid();
  perform pg_temp.ok((select perfil_cambios from perfiles where id = auth.uid()) = 0, 'guardar sin cambios no cuenta');
  for i in 1..6 loop update perfiles set nombre = 'Beto ' || i where id = auth.uid(); end loop;
  perform pg_temp.falla($q$update perfiles set nombre = 'Beto 7' where id = auth.uid()$q$, 'varias veces');
  update perfiles set perfil_cambios = 0, perfil_cambios_desde = null where id = auth.uid();
  n := (select count(*) from verificaciones_docente where perfil_id = auth.uid());
  update perfiles set tipo_usuario = 'Docente/Investigador' where id = auth.uid();
  update perfiles set tipo_usuario = 'Estudiante' where id = auth.uid();
  update perfiles set tipo_usuario = 'Docente/Investigador' where id = auth.uid();
  perform pg_temp.ok((select count(*) from verificaciones_docente where perfil_id = auth.uid()) = n + 1, 'alternar docente no abre verificaciones nuevas');
  perform pg_temp.ok(exists (select 1 from verificaciones_docente where perfil_id = auth.uid() and estado = 'pendiente'), 'la verificación reabierta queda pendiente');
  update perfiles set perfil_cambios = 0, perfil_cambios_desde = null where id = auth.uid();
  update perfiles set tipo_usuario = 'Estudiante', nombre = v.nombre where id = auth.uid();
end $$;

-- 0020: orden de inventario y programas marcados a mano que Faro no reconoce.
do $$
declare t text; j jsonb; begin
  perform pg_temp.como('lab@unal.edu.co');
  t := faro_vincular(faro_codigo_vinculo('UNAL-12') ->> 'codigo', 'PC-12', 'Windows', '0.5.4') ->> 'token';
  j := faro_orden(array['UNAL-12'], 'inventario');
  perform faro_orden(array['UNAL-12'], 'inventario');
  perform pg_temp.ok(j -> 'enviados' ? 'UNAL-12' and (select count(*) from agente_comandos c join equipos e on e.id = c.equipo_id
                       where e.codigo = 'UNAL-12' and c.tipo = 'inventario' and c.entregado_en is null) = 1,
                     'el personal pide el inventario y queda una sola orden pendiente');
  perform pg_temp.falla($q$select faro_orden(array['UNAL-12'], 'formatear')$q$, 'no válida');

  -- Faro latido sin sesión de usuario, como en producción.
  perform set_config('request.jwt.claim.sub', '', false);
  j := faro_estado(t, '{"inactivo_seg": 5}');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(j -> 'comandos') c where c ->> 'tipo' = 'inventario'), 'Faro recibe la orden de inventario');
  perform faro_estado(t, '{"inventario": {"software": ["R", "Python"]}}');
  perform pg_temp.ok((select software from equipos where codigo = 'UNAL-12') = array['Python', 'R'], 'el primer inventario llena los programas');
  -- El personal marca un programa que Faro no conoce (como al resolver una solicitud de software).
  update equipos set software = software || array['GeoDa'] where codigo = 'UNAL-12';
  perform faro_estado(t, '{"inventario": {"software": ["R", "Python", "QGIS"]}}');
  perform pg_temp.ok((select software from equipos where codigo = 'UNAL-12') = array['GeoDa', 'Python', 'QGIS', 'R'],
                     'un inventario nuevo agrega lo instalado y conserva lo marcado a mano');
  perform faro_estado(t, '{"inventario": {"software": ["R", "QGIS"]}}');
  perform pg_temp.ok((select software from equipos where codigo = 'UNAL-12') = array['GeoDa', 'QGIS', 'R'],
                     'lo que Faro deja de ver se quita (se desinstaló) y lo marcado a mano sigue');
  -- Con sesión del personal, la edición manual se respeta tal cual.
  perform pg_temp.como('lab@unal.edu.co');
  update equipos set software = array['QGIS', 'R'] where codigo = 'UNAL-12';
  perform pg_temp.ok((select software from equipos where codigo = 'UNAL-12') = array['QGIS', 'R'], 'el personal puede quitar a mano un programa');
end $$;

-- 0021: renombrar el código de un equipo conserva las etiquetas viejas.
do $$
declare j jsonb; v_id uuid; v_otro uuid;
begin
  perform pg_temp.como('lab@unal.edu.co');
  select id into v_id from equipos where codigo = 'UNAL-12';
  select id into v_otro from equipos where codigo = 'UNAL-11';
  insert into faro_anuncios (texto, equipos, hasta) values ('Prueba de renombrado', array['UNAL-12', 'UNAL-11'], now() + interval '1 hour');

  perform pg_temp.como('beto@unal.edu.co');
  perform pg_temp.falla(format($q$select renombrar_equipo(%L, 'UNAL-90')$q$, v_id), 'Solo el personal');

  perform pg_temp.como('lab@unal.edu.co');
  perform pg_temp.falla(format($q$select renombrar_equipo(%L, 'x')$q$, v_id), 'letras, números y guiones');
  perform pg_temp.falla(format($q$select renombrar_equipo(%L, 'UNAL-11')$q$, v_id), 'Ya existe un equipo');
  perform pg_temp.falla(format($q$select renombrar_equipo(%L, 'UNAL-12')$q$, v_id), 'ya es el código');

  j := renombrar_equipo(v_id, ' unal-90 ');
  perform pg_temp.ok(j ->> 'codigo' = 'UNAL-90' and j ->> 'anterior' = 'UNAL-12', 'renombrar devuelve el código nuevo y el anterior');
  perform pg_temp.ok((select codigo from equipos where id = v_id) = 'UNAL-90', 'el equipo quedó con el código nuevo');
  perform pg_temp.ok(resolver_codigo_equipo('UNAL-12') = 'UNAL-90', 'la etiqueta vieja sigue llevando al equipo');
  perform pg_temp.ok(resolver_codigo_equipo('unal-90') = 'UNAL-90', 'el código nuevo se resuelve a sí mismo');
  perform pg_temp.ok(resolver_codigo_equipo('UNAL-77') is null, 'un código que nunca existió no se resuelve');
  perform pg_temp.ok((select equipos from faro_anuncios where texto = 'Prueba de renombrado') = array['UNAL-90', 'UNAL-11'], 'los anuncios de Faro siguen al equipo');
  perform pg_temp.ok(exists (select 1 from consola_registro where comando like '%UNAL-12 → UNAL-90%'), 'el cambio queda en el registro');

  -- Intercambio de códigos: UNAL-11 ↔ UNAL-90 pasando por uno provisional.
  perform renombrar_equipo(v_otro, 'UNAL-TMP');
  perform renombrar_equipo(v_id, 'UNAL-11');
  perform renombrar_equipo(v_otro, 'UNAL-90');
  perform pg_temp.ok((select codigo from equipos where id = v_id) = 'UNAL-11' and (select codigo from equipos where id = v_otro) = 'UNAL-90', 'dos equipos pueden intercambiar códigos');
  perform pg_temp.ok(resolver_codigo_equipo('UNAL-TMP') = 'UNAL-90', 'el código provisional también se resuelve');
  perform pg_temp.ok(not exists (select 1 from equipo_codigos_anteriores a join equipos e on e.codigo = a.codigo), 'un código vigente nunca figura como anterior');

  -- Volver a dar de alta un código anterior lo toma el equipo nuevo.
  insert into equipos (codigo, nombre) values ('UNAL-TMP', 'Equipo nuevo');
  perform pg_temp.ok(resolver_codigo_equipo('UNAL-TMP') = 'UNAL-TMP', 'un código anterior puede reutilizarse en un equipo nuevo');
end $$;

-- 0022: reglamento editable, con versiones y lectura obligatoria.
do $$
declare v int; j jsonb; t0 timestamptz := date_trunc('hour', now()) + interval '30 hours';
begin
  update politicas set valor = '0' where clave = 'reservas_activas_max';   -- el límite de una a la vez no es lo que se prueba aquí
  perform pg_temp.como('ana@unal.edu.co');
  j := reglamento_vigente();
  perform pg_temp.ok((j ->> 'version')::int = 2 and jsonb_array_length(j -> 'reglas') >= 10, 'la versión vigente trae las reglas nuevas');
  perform pg_temp.ok((j ->> 'debe_aceptar')::boolean = false, 'quien aceptó la última versión no tiene que volver a aceptar');
  perform pg_temp.falla($q$select publicar_reglamento('[{"titulo": "A", "texto": "B"}]'::jsonb)$q$, 'administración');
  perform pg_temp.como('lab@unal.edu.co');
  perform pg_temp.falla($q$select publicar_reglamento('[{"titulo": "A", "texto": "B"}]'::jsonb)$q$, 'administración');

  perform pg_temp.como('admin@unal.edu.co');
  perform pg_temp.falla($q$select publicar_reglamento('[]'::jsonb)$q$, 'entre 1 y 40');
  perform pg_temp.falla($q$select publicar_reglamento('[{"titulo": "", "texto": "B"}]'::jsonb)$q$, 'título y texto');
  perform pg_temp.falla($q$select publicar_reglamento('[{"titulo": "A"}]'::jsonb)$q$, 'título y texto');
  perform pg_temp.falla(format($q$select publicar_reglamento('[{"titulo": "A", "texto": "%s"}]'::jsonb)$q$, repeat('x', 1201)), '1200');

  -- Cambio menor: no obliga a aceptar de nuevo.
  v := publicar_reglamento('[{"titulo": " Regla  ", "texto": " Texto ", "otro": 1}]'::jsonb, false, ' corrección ');
  perform pg_temp.ok(v = 3, 'la publicación crea la versión siguiente');
  perform pg_temp.ok((select reglas from reglamento_versiones where version = 3) = '[{"titulo": "Regla", "texto": "Texto"}]'::jsonb, 'el texto se guarda limpio y sin campos extra');
  perform pg_temp.como('ana@unal.edu.co');
  perform pg_temp.ok((reglamento_vigente() ->> 'version')::int = 3 and (reglamento_vigente() ->> 'debe_aceptar')::boolean = false, 'un cambio menor no pide aceptar de nuevo');

  -- Cambio de fondo: todas las personas deben aceptar de nuevo, y el servidor lo exige al reservar.
  perform pg_temp.como('admin@unal.edu.co');
  v := publicar_reglamento('[{"titulo": "Regla nueva", "texto": "Texto nuevo"}]'::jsonb, true, null);
  perform pg_temp.como('ana@unal.edu.co');
  perform pg_temp.ok((reglamento_vigente() ->> 'debe_aceptar')::boolean = true, 'un cambio obligatorio pide aceptar de nuevo');
  perform pg_temp.falla(format($q$select crear_reserva('UNAL-03', %L, %L, 'Docencia')$q$, t0, t0 + interval '1 hour'), 'aceptar el reglamento');
  perform aceptar_reglamento();
  perform pg_temp.ok((reglamento_vigente() ->> 'debe_aceptar')::boolean = false and (reglamento_vigente() ->> 'aceptada_version')::int = v, 'tras aceptar queda en la última versión');
  perform pg_temp.ok((crear_reserva('UNAL-03', t0, t0 + interval '1 hour', 'Docencia')).id is not null, 'tras aceptar de nuevo se puede reservar');
  perform pg_temp.ok((select count(*) from reglamento_aceptaciones where perfil_id = (select id from perfiles where correo = 'ana@unal.edu.co') and version = v) = 1, 'queda constancia de la aceptación');
  perform aceptar_reglamento();
  perform pg_temp.ok((select count(*) from reglamento_aceptaciones where perfil_id = (select id from perfiles where correo = 'ana@unal.edu.co') and version = v) = 1, 'aceptar dos veces no duplica la constancia');
  perform pg_temp.ok(exists (select 1 from consola_registro where comando = 'Publicar reglamento v' || v), 'la publicación queda en el registro');
end $$;


-- 0023: ficha técnica llenada por Faro.
do $$
declare t text; e equipos;
begin
  perform pg_temp.como('lab@unal.edu.co');
  update equipos set sistema_operativo = 'Windows', so_version = 'Windows 10 Pro', gpu_modelo = null where codigo = 'UNAL-08';
  t := faro_vincular(faro_codigo_vinculo('UNAL-08') ->> 'codigo', 'PC-08', 'Linux', '0.5.6') ->> 'token';
  perform set_config('request.jwt.claim.sub', '', false);

  perform faro_estado(t, $j${"inventario": {"cpu": "13th Gen Intel(R) Core(TM) i7-13700", "nucleos": 16, "hilos": 24, "ram_gb": 31.7,
    "disco_gb": 953.9, "so_tipo": "Linux", "so_version": "Linux 24.04 Ubuntu", "so_nombre": "Ubuntu 24.04.1 LTS",
    "gpus": [{"nombre": "Intel AlderLake-S GT1", "vram_gb": null, "dedicada": false},
             {"nombre": "NVIDIA RTX A2000 12GB", "vram_gb": 12.0, "dedicada": true}],
    "camaras": ["Logitech BRIO"], "software": ["R"]}}$j$);
  select * into e from equipos where codigo = 'UNAL-08';
  perform pg_temp.ok(e.cpu_modelo like '%i7-13700' and e.cpu_nucleos = 16 and e.cpu_hilos = 24 and e.ram_gb = 31.7 and e.disco_gb = 953.9,
                     'Faro llena procesador, RAM y disco');
  perform pg_temp.ok(e.gpu_modelo = 'NVIDIA RTX A2000 12GB' and e.gpu_vram_gb = 12.0 and e.gpu_dedicada, 'la tarjeta principal es la dedicada');
  perform pg_temp.ok(e.camara, 'se detecta la cámara');
  perform pg_temp.ok(e.sistema_operativo = 'Linux' and e.so_version = 'Ubuntu 24.04.1 LTS' and e.ficha_en is not null,
                     'el sistema operativo se actualiza aunque ya tuviera uno (antes solo si estaba vacío)');

  -- Sin la cámara, sin poder leer la tarjeta y con un dato basura: lo que Faro no sabe se conserva.
  perform faro_estado(t, $j${"inventario": {"cpu": "13th Gen Intel(R) Core(TM) i7-13700", "ram_gb": "mucha", "gpus": [], "camaras": []}}$j$);
  select * into e from equipos where codigo = 'UNAL-08';
  perform pg_temp.ok(not e.camara, 'si se quita la cámara, la ficha lo refleja');
  perform pg_temp.ok(e.gpu_modelo = 'NVIDIA RTX A2000 12GB' and e.ram_gb = 31.7, 'un dato que falta o no es válido no borra el anterior');

  -- Un Faro anterior (sin «camaras» ni «gpus») no cambia esos campos; si cambia la tarjeta, cambia la ficha.
  perform faro_estado(t, $j${"inventario": {"ram_gb": 15.6}}$j$);
  perform pg_temp.ok((select camara from equipos where codigo = 'UNAL-08') = false and (select ram_gb from equipos where codigo = 'UNAL-08') = 15.6,
                     'un Faro anterior no borra la cámara');
  perform faro_estado(t, $j${"inventario": {"gpus": [{"nombre": "Intel(R) UHD Graphics 770", "dedicada": false}]}}$j$);
  select * into e from equipos where codigo = 'UNAL-08';
  perform pg_temp.ok(e.gpu_modelo = 'Intel(R) UHD Graphics 770' and e.gpu_vram_gb is null and not e.gpu_dedicada,
                     'si quitan la tarjeta dedicada, la ficha queda con la integrada');
  perform pg_temp.como('lab@unal.edu.co');
end $$;

-- 0024: limpieza de textos, palabras bloqueadas y límites.
do $$
declare r reservas; t0 timestamptz := date_trunc('hour', now()) + interval '200 hours'; v_ana uuid; n int;
begin
  -- Comparación: variantes que sí coinciden y palabras normales que no.
  perform pg_temp.ok(_palabra_bloqueada('No cerrar, MiErDa') = 'mierda', 'no distingue mayúsculas');
  perform pg_temp.ok(_palabra_bloqueada('p.u.t.a') = 'puta' and _palabra_bloqueada('p u t a') = 'puta', 'letras separadas por signos o espacios');
  perform pg_temp.ok(_palabra_bloqueada('pu7a') = 'puta' and _palabra_bloqueada('mierdaaaa') = 'mierda', 'números en lugar de letras y letras estiradas');
  perform pg_temp.ok(_palabra_bloqueada('qué imbéciles') = 'imbecil' and _palabra_bloqueada('IDIOTAS') = 'idiota', 'tildes y plurales');
  perform pg_temp.ok(_palabra_bloqueada('Entrenando un modelo en la computadora, no cerrar la terminal') is null, 'un texto normal pasa («computadora» no es «puta»)');
  perform pg_temp.ok(_palabra_bloqueada('pera, perro, cono, Vergara, el proceso va retrasado') is null, 'palabras parecidas o normales pasan');
  perform pg_temp.ok(_palabra_bloqueada(null) is null and _palabra_bloqueada('') is null, 'texto vacío');

  -- Limpieza: invisibles, saltos de línea, espacios y acentos apilados.
  perform pg_temp.ok(_limpiar_texto('  hola' || chr(8203) || chr(8238) || E'\n\n mundo  ') = 'hola mundo', 'se quitan invisibles, control de dirección y saltos en una línea');
  perform pg_temp.ok(_limpiar_texto(E'uno\n\n\n\n\ndos', false) = E'uno\n\ndos', 'en varias líneas se dejan como máximo dos saltos');
  perform pg_temp.ok(char_length(_limpiar_texto('z' || repeat(chr(769), 30))) = 3, 'el «zalgo» queda en dos acentos');
  perform pg_temp.ok(_limpiar_texto('   ') is null, 'solo espacios queda vacío');

  -- Público: el mensaje para quien llegue no se guarda con una palabra de la lista.
  perform pg_temp.como('ana@unal.edu.co');
  select id into v_ana from perfiles where correo = 'ana@unal.edu.co';
  r := crear_reserva('UNAL-03', t0, t0 + interval '1 hour', 'Docencia');
  perform pg_temp.falla(format($q$update reservas set mensaje_llegada = 'no tocar, gonorrea' where id = %L$q$, r.id), 'no se puede publicar');
  update reservas set mensaje_llegada = E'  Entrenando\nun modelo' || chr(8203) where id = r.id;
  perform pg_temp.ok((select mensaje_llegada from reservas where id = r.id) = 'Entrenando un modelo', 'el mensaje se guarda limpio y en una línea');
  perform pg_temp.falla(format($q$update reservas set protegidos = array['RStudio', 'm.i.e.r.d.a'] where id = %L$q$, r.id), 'programas protegidos');
  -- El nombre que escribe la persona también.
  perform pg_temp.falla($q$update perfiles set nombre = 'Ana Hijueputa' where id = auth.uid()$q$, 'el nombre');
  -- Privado: se guarda y queda marcado.
  perform reportar_falla('UNAL-03', 'Otro', 'La pantalla parpadea, qué mierda');
  perform pg_temp.ok(exists (select 1 from moderacion_marcas where tabla = 'reportes' and palabra = 'mierda' and usuario_id = v_ana and not revisada),
                     'un reporte con una palabra de la lista se guarda y queda marcado');

  -- El personal no se rechaza (solo se limpia).
  perform pg_temp.como('lab@unal.edu.co');
  update reservas set mensaje_llegada = 'Prueba del personal: mierda' where id = r.id;
  perform pg_temp.ok((select mensaje_llegada from reservas where id = r.id) like 'Prueba del personal%', 'al personal no se le rechaza el texto');

  -- Lista: solo la administración la cambia; se guarda en forma comparable.
  perform pg_temp.falla($q$select moderacion_palabra('Bobo')$q$, 'Solo la administración');
  perform pg_temp.como('admin@unal.edu.co');
  perform pg_temp.ok(moderacion_palabra(' BOBÓ ') = 'bobo', 'la administración agrega una palabra (sin tildes ni mayúsculas)');
  perform pg_temp.ok(moderacion_probar('qué bobos') = 'bobo', 'probar un texto dice qué palabra lo bloquearía');
  perform moderacion_palabra('bobo', false);
  perform pg_temp.ok(moderacion_probar('qué bobos') is null, 'quitar una palabra deja de bloquearla');
  perform pg_temp.falla($q$select moderacion_palabra('a')$q$, 'de 2 a 60');

  -- Límites de frecuencia: solicitudes de software.
  perform pg_temp.como('ana@unal.edu.co');
  for n in 1..5 loop
    insert into solicitudes_software (solicitante, software, uso, estado) values (v_ana, 'Programa ' || n, 'Para la tesis de grado', 'pendiente');
  end loop;
  perform pg_temp.falla(format($q$insert into solicitudes_software (solicitante, software, uso, estado) values (%L, 'Otro', 'Para la tesis de grado', 'pendiente')$q$, v_ana),
                        '5 solicitudes de software en curso');
  delete from solicitudes_software where solicitante = v_ana;
  perform pg_temp.como('lab@unal.edu.co');
end $$;

-- 0025: acciones desde la isla de Faro.
do $$
declare t text; j jsonb; v_ana uuid; v_eq uuid; r reservas; v_fin timestamptz; n int;
begin
  perform pg_temp.como('lab@unal.edu.co');
  t := faro_vincular(faro_codigo_vinculo('UNAL-13') ->> 'codigo', 'PC-13', 'Linux', '0.6.0') ->> 'token';
  select id into v_ana from perfiles where correo = 'ana@unal.edu.co';
  select id into v_eq from equipos where codigo = 'UNAL-13';
  update reservas set estado = 'cancelada' where equipo_id = v_eq and estado = 'activa' and fin > now();
  perform set_config('request.jwt.claim.sub', '', false);   -- Faro no tiene sesión

  perform pg_temp.falla($q$select faro_accion('token-falso', 'ayuda')$q$, 'no está vinculado');
  perform pg_temp.falla(format($q$select faro_accion(%L, 'extender')$q$, t), 'No hay una reserva en curso');
  perform pg_temp.ok((faro_estado(t) ->> 'nfc')::boolean, 'Faro sabe que el equipo tiene tarjeta NFC');

  -- Reserva en curso de Ana, sin llegada confirmada: no se puede liberar desde el equipo.
  insert into reservas (equipo_id, usuario_id, inicio, fin, actividad)
  values (v_eq, v_ana, now() - interval '10 minutes', now() + interval '50 minutes', 'Docencia') returning * into r;
  perform pg_temp.falla(format($q$select faro_accion(%L, 'liberar')$q$, t), 'Primero confirme su llegada');

  update reservas set llegada_en = now() where id = r.id;
  v_fin := r.fin;
  j := faro_accion(t, 'extender', '{"minutos": 30}');
  perform pg_temp.ok((j ->> 'ok')::boolean and (select fin from reservas where id = r.id) = v_fin + interval '30 minutes',
                     'desde la isla se extiende 30 minutos con las reglas de la app');
  perform pg_temp.ok(exists (select 1 from cola_notificaciones where usuario_id = v_ana and tipo = 'faro_extendida'), 'la persona recibe un aviso de la extensión');
  perform pg_temp.ok(current_setting('request.jwt.claim.sub', true) = '', 'después de actuar como la persona, Faro sigue sin sesión');
  perform pg_temp.falla(format($q$select faro_accion(%L, 'extender', '{"minutos": 60}')$q$, t), 'extensión');   -- política: una extensión

  j := faro_accion(t, 'liberar');
  perform pg_temp.ok((select liberada_en from reservas where id = r.id) is not null, 'desde la isla se libera el equipo');
  perform pg_temp.ok(exists (select 1 from cola_notificaciones where usuario_id = v_ana and tipo = 'faro_liberada'), 'la persona recibe un aviso de la liberación');

  -- Reportar con el equipo libre: el reporte es del equipo, con el diagnóstico de Faro.
  perform pg_temp.falla(format($q$select faro_accion(%L, 'reportar', '{"categoria": "Explotó"}')$q$, t), 'tipo de problema');
  j := faro_accion(t, 'reportar', '{"categoria": "Red o internet", "diagnostico": {"en_linea": false, "ram_libre_gb": 3.1}}');
  perform pg_temp.ok(exists (select 1 from reportes where equipo_id = v_eq and origen = 'faro' and usuario_id is null
                                and categoria = 'Red o internet' and diagnostico -> 'faro' ->> 'ram_libre_gb' = '3.1'),
                     'un reporte desde el equipo libre queda sin persona y con el diagnóstico de Faro');
  perform faro_accion(t, 'reportar', '{"categoria": "Otro"}');
  perform faro_accion(t, 'reportar', '{"categoria": "Software"}');
  perform pg_temp.falla(format($q$select faro_accion(%L, 'reportar', '{"categoria": "Otro"}')$q$, t), 'varias fallas');

  -- Pedir ayuda: un aviso al chat del personal, sin repetirse en 10 minutos.
  perform faro_accion(t, 'ayuda');
  perform faro_accion(t, 'ayuda');
  select count(*) into n from cola_chat where tipo = 'faro_ayuda' and texto like '%UNAL-13%';
  perform pg_temp.ok(n = 1, 'pedir ayuda avisa al personal una vez cada 10 minutos');
  perform pg_temp.falla(format($q$select faro_accion(%L, 'formatear')$q$, t), 'Acción no válida');
  perform pg_temp.como('lab@unal.edu.co');
end $$;

-- 0026: suspender la pantalla y desbloquearla con la reserva.
do $$
declare t text; j jsonb; v_ana uuid; v_beto uuid; v_eq uuid; r reservas; k jsonb; v_qr text; v_id bigint;
begin
  perform pg_temp.como('lab@unal.edu.co');
  t := faro_vincular(faro_codigo_vinculo('UNAL-06') ->> 'codigo', 'PC-06', 'Linux', '0.7.0') ->> 'token';
  select id into v_ana from perfiles where correo = 'ana@unal.edu.co';
  select id into v_beto from perfiles where correo = 'beto@unal.edu.co';
  select id into v_eq from equipos where codigo = 'UNAL-06';
  update reservas set estado = 'cancelada' where equipo_id = v_eq and estado = 'activa' and fin > now();
  insert into reservas (equipo_id, usuario_id, inicio, fin, actividad)
  values (v_eq, v_ana, now() - interval '5 minutes', now() + interval '1 hour', 'Docencia') returning * into r;
  perform pg_temp.ok(r.codigo_desbloqueo ~ '^[A-Z2-9]{8}$', 'cada reserva tiene su código de desbloqueo');

  -- Bloquear ya (personal).
  perform pg_temp.como('beto@unal.edu.co');
  perform pg_temp.falla($q$select faro_suspender(array['UNAL-06'], 30)$q$, 'Solo el personal');
  perform pg_temp.como('lab@unal.edu.co');
  perform pg_temp.ok(faro_suspender(array['UNAL-06'], 30) = 1, 'el personal suspende un equipo');
  perform pg_temp.ok((select x ->> 'suspendido_hasta' from jsonb_array_elements(faro_panel() -> 'equipos') x where x ->> 'codigo' = 'UNAL-06') is not null,
                     'el panel muestra la suspensión');
  perform set_config('request.jwt.claim.sub', '', false);
  j := faro_estado(t);
  perform pg_temp.ok(j -> 'suspension' ->> 'motivo' = 'bloqueo' and char_length(j -> 'suspension' ->> 'qr') = 32, 'Faro recibe la suspensión y un QR de un solo uso');
  perform pg_temp.ok(j -> 'actual' -> 'desbloqueo' ->> 'hash' = _faro_hash_clave(r.id::text, r.codigo_desbloqueo, 2000), 'Faro recibe el código de la reserva cifrado');
  v_qr := j -> 'suspension' ->> 'qr';

  -- Con un código equivocado no se desbloquea; con el de la reserva, sí.
  perform pg_temp.falla(format($q$select faro_accion(%L, 'reanudar', '{"codigo": "ZZZZ-ZZZZ"}')$q$, t), 'no desbloquea');
  j := faro_accion(t, 'reanudar', jsonb_build_object('codigo', lower(substr(r.codigo_desbloqueo, 1, 4)) || '-' || substr(r.codigo_desbloqueo, 5), 'via', 'codigo'));
  perform pg_temp.ok(faro_estado(t) -> 'suspension' is null, 'el código de la reserva quita la suspensión (sin importar mayúsculas ni guion)');

  -- QR de un solo uso: solo la persona de la reserva.
  perform pg_temp.como('lab@unal.edu.co');
  perform faro_suspender(array['UNAL-06'], 30);
  perform set_config('request.jwt.claim.sub', '', false);
  v_qr := faro_estado(t) -> 'suspension' ->> 'qr';
  perform pg_temp.como('beto@unal.edu.co');
  perform pg_temp.falla(format($q$select desbloquear_con_qr('UNAL-06', %L)$q$, v_qr), 'Solo quien tiene la reserva');
  perform pg_temp.como('ana@unal.edu.co');
  perform pg_temp.falla($q$select desbloquear_con_qr('UNAL-06', 'qr-viejo')$q$, 'venció');
  perform desbloquear_con_qr('UNAL-06', v_qr);
  perform set_config('request.jwt.claim.sub', '', false);
  perform pg_temp.ok(faro_estado(t) -> 'suspension' is null, 'quien tiene la reserva desbloquea con el QR');

  -- Clave temporal del personal.
  perform pg_temp.como('lab@unal.edu.co');
  perform faro_suspender(array['UNAL-06'], 30);
  k := faro_clave_temporal(null, 30);
  perform pg_temp.ok(k ->> 'clave' ~ '^[A-Z2-9]{4}-[A-Z2-9]{4}$', 'el personal genera una clave temporal');
  perform set_config('request.jwt.claim.sub', '', false);
  j := faro_estado(t);
  perform pg_temp.ok(jsonb_array_length(j -> 'claves_temporales') >= 1, 'Faro recibe las claves temporales vigentes');
  perform faro_accion(t, 'reanudar', jsonb_build_object('codigo', k ->> 'clave', 'via', 'clave_temporal'));
  perform pg_temp.ok(faro_estado(t) -> 'suspension' is null, 'la clave temporal quita la suspensión');
  perform pg_temp.como('lab@unal.edu.co');
  perform faro_suspender(array['UNAL-06'], 30);
  perform set_config('request.jwt.claim.sub', '', false);
  perform faro_evento(t, 'desbloqueo_emergencia', '{"via": "emergencia"}');
  perform pg_temp.ok(faro_estado(t) -> 'suspension' is null, 'la clave de emergencia en la pantalla también quita la suspensión');

  -- Anuncio obligatorio: suspende si nadie lo confirma; «Entendido» lo evita.
  perform pg_temp.como('lab@unal.edu.co');
  v_id := faro_anunciar('Simulacro de evacuación a las 3 p. m.', 60, array['UNAL-06'], true);
  update faro_anuncios set creado_en = now() - interval '11 minutes' where id = v_id;
  perform set_config('request.jwt.claim.sub', '', false);
  j := faro_estado(t);
  perform pg_temp.ok((j -> 'anuncio' ->> 'obligatorio')::boolean and j -> 'suspension' ->> 'motivo' = 'anuncio', 'un anuncio obligatorio sin confirmar suspende la pantalla');
  perform faro_accion(t, 'leido', jsonb_build_object('anuncio', v_id));
  j := faro_estado(t);
  perform pg_temp.ok(j -> 'suspension' is null and exists (select 1 from faro_anuncio_lecturas where anuncio_id = v_id and equipo_id = v_eq),
                     '«Entendido» confirma el anuncio y quita la suspensión');
  perform pg_temp.como('lab@unal.edu.co');
  perform faro_quitar_anuncio(v_id);
  update reservas set estado = 'cancelada' where id = r.id;
end $$;

-- 0027: «Salir un rato», QR del personal con confirmación y avisos al titular.
do $$
declare t text; j jsonb; v_ana uuid; v_eq uuid; r reservas; v_qr text;
begin
  perform pg_temp.como('lab@unal.edu.co');
  t := faro_vincular(faro_codigo_vinculo('UNAL-06') ->> 'codigo', 'PC-06', 'Linux', '0.7.5') ->> 'token';
  select id into v_ana from perfiles where correo = 'ana@unal.edu.co';
  select id into v_eq from equipos where codigo = 'UNAL-06';
  update reservas set estado = 'cancelada' where equipo_id = v_eq and estado = 'activa' and fin > now();
  insert into reservas (equipo_id, usuario_id, inicio, fin, actividad)
  values (v_eq, v_ana, now() - interval '5 minutes', now() + interval '1 hour', 'Docencia') returning * into r;
  perform set_config('request.jwt.claim.sub', '', false);

  perform pg_temp.falla(format($q$select faro_accion(%L, 'salir', '{}')$q$, t), 'confirme su asistencia');
  update reservas set llegada_en = now() where id = r.id;
  perform pg_temp.falla(format($q$select faro_accion(%L, 'salir', '{"mensaje": "no tocar, gonorrea"}')$q$, t), 'no se permiten');
  perform faro_accion(t, 'salir', '{"mensaje": "Entrenando un modelo, no apagar", "vuelvo_min": 30}');
  j := faro_estado(t);
  perform pg_temp.ok(j -> 'suspension' ->> 'motivo' = 'titular' and j -> 'suspension' ->> 'mensaje' = 'Entrenando un modelo, no apagar'
                     and (j -> 'suspension' ->> 'vuelvo') is not null, 'el titular bloquea su pantalla con mensaje y hora de regreso');

  -- Si la reserva se extiende, el bloqueo sigue hasta el nuevo fin.
  update reservas set fin = fin + interval '30 minutes' where id = r.id;
  j := faro_estado(t);
  perform pg_temp.ok((j -> 'suspension' ->> 'hasta')::timestamptz > now() + interval '80 minutes', 'el bloqueo del titular sigue la reserva extendida');

  -- Varios códigos equivocados: el titular recibe un aviso.
  perform faro_evento(t, 'codigos_fallidos', '{"intentos": 3}');
  perform pg_temp.ok(exists (select 1 from cola_notificaciones where usuario_id = v_ana and tipo = 'faro_codigos'), 'el titular se entera de los códigos equivocados');

  -- El personal con el QR: primero pide confirmación; al confirmar, desbloquea y avisa al titular.
  v_qr := j -> 'suspension' ->> 'qr';
  perform pg_temp.como('lab@unal.edu.co');
  j := desbloquear_con_qr('UNAL-06', v_qr);
  perform pg_temp.ok((j ->> 'confirmar')::boolean and j ->> 'titular' is not null, 'el personal debe confirmar antes de desbloquear el equipo de otra persona');
  j := desbloquear_con_qr('UNAL-06', v_qr, true);
  perform pg_temp.ok((j ->> 'ok')::boolean and exists (select 1 from cola_notificaciones where usuario_id = v_ana and tipo = 'faro_desbloqueada'),
                     'al confirmar se desbloquea y el titular recibe un aviso');
  perform pg_temp.ok(exists (select 1 from agente_eventos where equipo_id = v_eq and tipo = 'reanudado' and detalle ->> 'via' = 'qr_personal'),
                     'queda en la actividad como desbloqueo del personal');

  -- «Bloquear ya»: el titular recibe un aviso.
  perform faro_suspender(array['UNAL-06'], 30);
  perform pg_temp.ok(exists (select 1 from cola_notificaciones where usuario_id = v_ana and tipo = 'faro_suspendida'), 'el titular se entera de la suspensión');
  perform faro_reanudar(array['UNAL-06']);

  -- El titular con su código: sin aviso (fue él).
  delete from cola_notificaciones where usuario_id = v_ana and tipo = 'faro_desbloqueada';
  perform set_config('request.jwt.claim.sub', '', false);
  perform faro_accion(t, 'salir', '{}');
  perform faro_accion(t, 'reanudar', jsonb_build_object('codigo', r.codigo_desbloqueo, 'via', 'codigo'));
  perform pg_temp.ok(faro_estado(t) -> 'suspension' is null and not exists (select 1 from cola_notificaciones where usuario_id = v_ana and tipo = 'faro_desbloqueada'),
                     'el titular quita su propio bloqueo con el código, sin avisos');

  -- Al terminar la reserva, el bloqueo del titular se quita solo.
  perform faro_accion(t, 'salir', '{}');
  update reservas set liberada_en = now() where id = r.id;
  perform pg_temp.ok(faro_estado(t) -> 'suspension' is null, 'el bloqueo del titular termina con la reserva');
  perform pg_temp.como('lab@unal.edu.co');
  update reservas set estado = 'cancelada' where id = r.id;
end $$;

-- 0028: código del personal que cambia cada 30 s y clave de emergencia que se puede desactivar.
do $$
declare t text; j jsonb; v_sec text; v_vent bigint := floor(extract(epoch from now()) / 30); v_clave text;
begin
  perform pg_temp.como('lab@unal.edu.co');
  t := faro_vincular(faro_codigo_vinculo('UNAL-07') ->> 'codigo', 'PC-07', 'Windows', '0.8.2') ->> 'token';
  perform set_config('request.jwt.claim.sub', '', false);

  -- Faro por cuenta no recibe el secreto; como servicio, recibe el de su equipo.
  perform pg_temp.ok(faro_estado(t, '{"version": "0.8.2"}') -> 'personal' is null, 'Faro por cuenta no recibe el secreto del código del personal');
  v_sec := faro_estado(t, '{"version": "0.8.2", "servicio": true}') ->> 'personal';
  perform pg_temp.ok(v_sec ~ '^[0-9a-f]{64}$' and v_sec = _faro_secreto_equipo('UNAL-07') and v_sec <> _faro_secreto_equipo('UNAL-08'),
                     'el servicio recibe un secreto propio de su equipo');
  perform pg_temp.ok(_faro_codigo_personal('abc', 'UNAL-08', 123) ~ '^[0-9]{8}$', 'el código del personal tiene 8 dígitos');

  -- El personal ve el código vigente de los equipos con servicio; nadie más.
  perform pg_temp.como('ana@unal.edu.co');
  perform pg_temp.falla($q$select faro_codigos_personal()$q$, 'Solo el personal');
  perform pg_temp.como('lab@unal.edu.co');
  j := faro_codigos_personal();
  perform pg_temp.ok(j -> 'codigos' @> jsonb_build_array(jsonb_build_object('equipo', 'UNAL-07',
                       'codigo', _faro_codigo_personal(v_sec, 'UNAL-07', v_vent))) or
                     j -> 'codigos' @> jsonb_build_array(jsonb_build_object('equipo', 'UNAL-07',
                       'codigo', _faro_codigo_personal(v_sec, 'UNAL-07', v_vent + 1))),
                     'el personal ve el mismo código que calcula Faro');
  perform pg_temp.ok((select x ->> 'servicio' from jsonb_array_elements(faro_panel() -> 'equipos') x where x ->> 'codigo' = 'UNAL-07') = 'true',
                     'el panel muestra qué equipos corren como servicio');

  -- Desactivar la clave fija: la anterior deja de servir; crear otra la reactiva.
  perform pg_temp.falla($q$select faro_desactivar_clave()$q$, 'administrador');
  perform pg_temp.como('admin@unal.edu.co');
  v_clave := faro_generar_clave();
  perform faro_desactivar_clave();
  j := faro_estado(t, '{"servicio": true}') -> 'clave';
  perform pg_temp.ok(_faro_hash_clave(j ->> 'sal', v_clave, (j ->> 'iteraciones')::int) <> j ->> 'hash'
                     and faro_panel() ->> 'clave_desactivada_en' is not null, 'la clave fija desactivada deja de servir');
  v_clave := faro_generar_clave();
  j := faro_estado(t, '{"servicio": true}') -> 'clave';
  perform pg_temp.ok(_faro_hash_clave(j ->> 'sal', v_clave, (j ->> 'iteraciones')::int) = j ->> 'hash'
                     and faro_panel() ->> 'clave_desactivada_en' is null, 'una clave nueva la vuelve a activar');
end $$;
