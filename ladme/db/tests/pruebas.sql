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

  -- Estadísticas.
  perform pg_temp.como('lab@unal.edu.co');
  j := estadisticas(now() - interval '30 days', now() + interval '60 days');
  perform pg_temp.ok((j ->> 'total')::int >= 5 and (j ->> 'canceladas')::int >= 1 and jsonb_array_length(j -> 'por_programa') >= 2, 'estadísticas agregadas (incluye lo importado)');
  perform pg_temp.como('ana@unal.edu.co');
  perform pg_temp.falla($q$select estadisticas(now() - interval '1 day', now())$q$, 'No autorizado');
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
  perform pg_temp.ok((select count(*) from cola_notificaciones where usuario_id <> auth.uid()) = 0, 'cada quien ve solo sus avisos');
  perform pg_temp.ok((select count(*) from ocupacion_publica) > 0, 'la ocupación pública es visible');
end $$;
reset role;
