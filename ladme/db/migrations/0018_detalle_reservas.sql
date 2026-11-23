-- 0018 · Detalle completo de cada reserva y docente responsable
-- Ejecutar después de 0017. Idempotente.
--
--   A. Docente responsable: obligatorio cuando la actividad es Trabajo de grado (TDG), PAE o
--      Semilleros. Se guarda en la reserva (y en la solicitud de reserva larga, que lo pasa a la
--      reserva al aprobarse). Las reservas anteriores y las importadas no lo exigen.
--   B. reserva_detalle(): todo lo que se sabe de una reserva en una sola consulta, para la página
--      de detalle del panel: titular, equipo, uso, reserva larga, clase, migración, historial con
--      quién hizo cada cambio, eventos de Faro durante la reserva, inasistencia, software pedido
--      y fallas reportadas. Solo el personal.
--   C. docentes_sugeridos(): nombres para autocompletar el campo (los docentes que la persona ya
--      usó y los docentes verificados en LADME).
begin;

-- ===================================================================== A. Docente responsable
alter table reservas add column if not exists docente text check (char_length(docente) <= 120);
alter table solicitudes_excepcion add column if not exists docente text check (char_length(docente) <= 120);

create or replace function _actividad_pide_docente(p text) returns boolean
language sql immutable as $$ select coalesce(p in ('Trabajo de grado', 'PAE', 'Semilleros'), false) $$;

-- Devuelve el docente limpio, o falla si la actividad lo exige y no viene.
create or replace function _docente_para(p_actividad text, p_docente text) returns text
language plpgsql immutable as $$
declare v text := nullif(regexp_replace(btrim(coalesce(p_docente, '')), '\s+', ' ', 'g'), ''); begin
  if not _actividad_pide_docente(p_actividad) then return null; end if;
  if v is null or char_length(v) < 3 then
    raise exception 'Indique el docente responsable (director del trabajo de grado, tutor del PAE o docente del semillero).';
  end if;
  if char_length(v) > 120 then raise exception 'El nombre del docente es demasiado largo (máximo 120 caracteres).'; end if;
  return v;
end $$;

-- crear_reserva gana p_docente (al final, con valor por omisión: las llamadas anteriores siguen sirviendo).
drop function if exists crear_reserva(text, timestamptz, timestamptz, text, text, boolean, text, text);
create or replace function crear_reserva(p_equipo text, p_inicio timestamptz, p_fin timestamptz, p_actividad text default null,
                              p_detalle text default null, p_desatendido boolean default false,
                              p_mensaje text default null, p_id_solicitud text default null,
                              p_docente text default null)
returns reservas language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); v_eq equipos; v_res reservas; v_admin boolean := es_admin(); v_p perfiles;
        v_max int; v_otra reservas; v_cod text; v_docente text; begin
  if p_id_solicitud is not null then                                     -- reintento: devuelve la misma reserva
    select * into v_res from reservas where id_solicitud = p_id_solicitud and usuario_id = v;
    if found then return v_res; end if;
  end if;
  select * into v_p from perfiles where id = v;
  if v_p.tipo_usuario is null or nullif(trim(coalesce(v_p.programa, '')), '') is null
     or (v_p.tipo_usuario = 'Estudiante' and nullif(trim(coalesce(v_p.matricula, '')), '') is null) then
    raise exception 'Complete su perfil (tipo de usuario, programa y matrícula) antes de reservar.';
  end if;
  if not _actividad_valida(p_actividad) then raise exception 'Seleccione el tipo de actividad.'; end if;
  v_docente := _docente_para(p_actividad, p_docente);
  select * into v_eq from equipos where codigo = upper(p_equipo) and not archivado;
  if not found then raise exception 'Equipo no encontrado.'; end if;
  if v_eq.estado <> 'activo' then raise exception 'El equipo no está disponible (%).', replace(v_eq.estado::text, '_', ' '); end if;
  if p_inicio < now() - interval '5 minutes' then raise exception 'La hora de inicio no puede ser anterior a 5 minutos respecto a la actual.'; end if;
  if p_fin <= p_inicio then raise exception 'El fin debe ser posterior al inicio.'; end if;
  if not v_admin then        -- solo el administrador puede saltarse los límites (el laboratorista no)
    if p_fin - p_inicio > make_interval(hours => politica_int('duracion_max_horas')) then
      raise exception 'Supera el máximo de % h. Para más tiempo, envíe una solicitud de reserva larga.',
        politica_int('duracion_max_horas');
    end if;
    if p_inicio > now() + make_interval(days => politica_int('anticipacion_max_dias')) then
      raise exception 'Solo se puede reservar con % días de anticipación.', politica_int('anticipacion_max_dias');
    end if;
  end if;
  -- Reservas a la vez: rige para usuarios; el personal (laboratorista y administración) queda exento.
  v_max := coalesce(politica_int('reservas_activas_max'), 0);
  if v_max > 0 and not es_staff() then
    -- Un candado por persona: dos reservas enviadas al mismo tiempo no pueden pasar las dos.
    perform pg_advisory_xact_lock(hashtextextended('ladme:reservas:' || v::text, 0));
    select r.* into v_otra from reservas r
     where r.usuario_id = v and r.tipo = 'reserva' and r.estado = 'activa' and r.liberada_en is null and r.fin > now()
     order by r.inicio limit 1;
    if found and (select count(*) from reservas r
                   where r.usuario_id = v and r.tipo = 'reserva' and r.estado = 'activa' and r.liberada_en is null
                     and r.fin > now()) >= v_max then
      select codigo into v_cod from equipos where id = v_otra.equipo_id;
      if v_max = 1 then
        raise exception 'Ya tiene una reserva vigente (% · %). Solo se permite una a la vez: libérela o cancélela antes de hacer otra.',
          v_cod, to_char(v_otra.inicio at time zone 'America/Bogota', 'DD/MM HH24:MI') || '–' ||
                 to_char(v_otra.fin at time zone 'America/Bogota', 'DD/MM HH24:MI');
      else
        raise exception 'Ya tiene % reservas vigentes, el máximo permitido. Libere o cancele una antes de hacer otra.', v_max;
      end if;
    end if;
  end if;
  begin
    insert into reservas (tipo, equipo_id, usuario_id, inicio, fin, actividad, detalle, desatendido, mensaje_llegada,
                          id_solicitud, programa, matricula, tipo_usuario, docente)
    values ('reserva', v_eq.id, v, p_inicio, p_fin, p_actividad, nullif(trim(p_detalle), ''), coalesce(p_desatendido, false),
            nullif(trim(p_mensaje), ''), p_id_solicitud, v_p.programa, v_p.matricula, v_p.tipo_usuario, v_docente)
    returning * into v_res;
  exception when exclusion_violation then
    raise exception 'El equipo ya está reservado (o en revisión) en ese intervalo.' using errcode = 'P0001';
  end;
  return v_res;
end $$;

-- solicitar_excepcion gana p_docente.
drop function if exists solicitar_excepcion(text, timestamptz, timestamptz, text, text, text);
create or replace function solicitar_excepcion(p_equipo text, p_inicio timestamptz, p_fin timestamptz,
                                               p_actividad text, p_detalle text, p_justificacion text,
                                               p_docente text default null)
returns solicitudes_excepcion language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); v_eq equipos; v_s solicitudes_excepcion; v_p perfiles; v_docente text; begin
  select * into v_p from perfiles where id = v;
  if v_p.tipo_usuario is null or nullif(trim(coalesce(v_p.programa, '')), '') is null then
    raise exception 'Complete su perfil antes de enviar una solicitud.';
  end if;
  if not _actividad_valida(p_actividad) then raise exception 'Seleccione el tipo de actividad.'; end if;
  v_docente := _docente_para(p_actividad, p_docente);
  if char_length(trim(coalesce(p_justificacion, ''))) < 10 then
    raise exception 'Explique por qué necesita más tiempo (mínimo 10 caracteres).';
  end if;
  select * into v_eq from equipos where codigo = upper(p_equipo) and not archivado;
  if not found then raise exception 'Equipo no encontrado.'; end if;
  if p_inicio < now() - interval '5 minutes' then raise exception 'La hora de inicio no puede estar en el pasado.'; end if;
  if p_fin - p_inicio <= make_interval(hours => politica_int('duracion_max_horas')) then
    raise exception 'Esa duración no necesita solicitud: reserve directamente.';
  end if;
  if p_fin - p_inicio > make_interval(hours => politica_int('excepcion_max_horas')) then
    raise exception 'Una solicitud admite como máximo % h.', politica_int('excepcion_max_horas');
  end if;
  if (select count(*) from solicitudes_excepcion where usuario_id = v and estado = 'pendiente') >= 3 then
    raise exception 'Ya tiene 3 solicitudes pendientes. Espere la respuesta o retire una.';
  end if;
  insert into solicitudes_excepcion (usuario_id, equipo_id, inicio, fin, actividad, detalle, justificacion, docente)
  values (v, v_eq.id, p_inicio, p_fin, p_actividad, nullif(trim(p_detalle), ''), trim(p_justificacion), v_docente)
  returning * into v_s;
  perform _avisar_staff('solicitud_excepcion', 'sol:' || v_s.id,
                        'Solicitud de reserva larga: ' || v_eq.codigo,
                        v_p.nombre || ' pide el equipo ' || v_eq.codigo || ' del ' || _fmt(p_inicio) || ' al ' || _fmt(p_fin) ||
                        '. Revísela en el panel de administración.',
                        '/admin?tab=solicitudes', null, null, true);
  return v_s;
end $$;

-- Al aprobar una reserva larga, el docente pasa a la reserva.
create or replace function resolver_excepcion(p_id uuid, p_aprobar boolean, p_respuesta text default null)
returns solicitudes_excepcion language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); v_s solicitudes_excepcion; v_res reservas; v_p perfiles; v_cod text; begin
  if not es_admin() then raise exception 'Solo un administrador puede resolver solicitudes.' using errcode = '42501'; end if;
  select * into v_s from solicitudes_excepcion where id = p_id for update;
  if not found then raise exception 'Solicitud no encontrada.'; end if;
  if v_s.estado <> 'pendiente' then raise exception 'La solicitud ya fue resuelta.'; end if;
  select codigo into v_cod from equipos where id = v_s.equipo_id;

  if p_aprobar then
    if v_s.fin <= now() then raise exception 'El intervalo solicitado ya pasó.'; end if;
    select * into v_p from perfiles where id = v_s.usuario_id;
    begin
      insert into reservas (tipo, equipo_id, usuario_id, inicio, fin, actividad, detalle, programa, matricula, tipo_usuario, excepcion, docente)
      values ('reserva', v_s.equipo_id, v_s.usuario_id, v_s.inicio, v_s.fin, v_s.actividad, v_s.detalle,
              v_p.programa, v_p.matricula, v_p.tipo_usuario, true, v_s.docente)
      returning * into v_res;
    exception when exclusion_violation then
      raise exception 'No se puede aprobar: el equipo ya tiene otra reserva o bloqueo en ese intervalo.' using errcode = 'P0001';
    end;
    update solicitudes_excepcion
       set estado = 'aprobada', respuesta = nullif(trim(p_respuesta), ''), resuelto_por = v, resuelto_en = now(), reserva_id = v_res.id
     where id = p_id returning * into v_s;
    -- El aviso (y el correo) de confirmación lo genera la propia reserva.
  else
    if char_length(trim(coalesce(p_respuesta, ''))) < 3 then raise exception 'Escriba el motivo del rechazo.'; end if;
    update solicitudes_excepcion
       set estado = 'rechazada', respuesta = trim(p_respuesta), resuelto_por = v, resuelto_en = now()
     where id = p_id returning * into v_s;
    perform _avisar(v_s.usuario_id, 'solicitud_rechazada', 'sol_rech:' || v_s.id,
                    'Solicitud de reserva larga no aprobada',
                    'Su solicitud del equipo ' || v_cod || ' (' || _fmt(v_s.inicio) || ' a ' || _fmt(v_s.fin) ||
                    ') no fue aprobada. Motivo: ' || trim(p_respuesta),
                    '/mis-reservas');
  end if;
  return v_s;
end $$;

-- ===================================================================== C. Sugerencias de docentes
-- Primero los que la persona ya escribió en sus reservas o solicitudes; luego los docentes
-- verificados en LADME. Solo nombres.
create or replace function docentes_sugeridos() returns jsonb
language sql stable security definer set search_path = public as $$
  with propios as (
    select docente as nombre, max(creado_en) as en from reservas
     where usuario_id = auth.uid() and docente is not null group by docente
    union all
    select docente, max(creado_en) from solicitudes_excepcion
     where usuario_id = auth.uid() and docente is not null group by docente
  ), lista as (
    select nombre, 0 as grupo, max(en) as en from propios group by nombre
    union all
    select p.nombre, 1, null from perfiles p
     where p.docente_verificado_en is not null and p.activo
       and not exists (select 1 from propios x where lower(x.nombre) = lower(p.nombre))
  )
  select coalesce(jsonb_agg(nombre order by grupo, en desc nulls last, nombre), '[]'::jsonb)
    from (select * from lista order by grupo, en desc nulls last, nombre limit 80) l $$;

-- ===================================================================== B. Detalle de una reserva
create or replace function reserva_detalle(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r reservas; v_hasta timestamptz; v jsonb; begin
  if not es_staff() then raise exception 'Solo el personal ve el detalle de las reservas.' using errcode = '42501'; end if;
  select * into r from reservas where id = p_id;
  if not found then return null; end if;
  v_hasta := least(coalesce(r.liberada_en, r.cancelada_en, r.fin), r.fin);

  select jsonb_build_object(
    'reserva', to_jsonb(r) - 'token_credencial' - 'id_solicitud',
    'estado_vigente', (select estado_vigente from reservas_estado where id = r.id),
    'equipo', (select jsonb_build_object('codigo', e.codigo, 'nombre', e.nombre, 'ubicacion', e.ubicacion, 'marca', e.marca,
                                         'modelo', e.modelo, 'sistema_operativo', e.sistema_operativo, 'so_version', e.so_version,
                                         'foto_url', e.foto_url, 'estado', e.estado)
                 from equipos e where e.id = r.equipo_id),
    'titular', (select jsonb_build_object('id', p.id, 'nombre', p.nombre, 'correo', p.correo, 'rol', p.rol, 'activo', p.activo,
                                          'tipo_usuario', p.tipo_usuario, 'programa', p.programa, 'matricula', p.matricula,
                                          'docente_verificado_en', p.docente_verificado_en, 'creado_en', p.creado_en,
                                          'reservas', (select count(*) from reservas x where x.usuario_id = p.id and x.tipo = 'reserva'),
                                          'inasistencias', (select count(*) from inasistencias i where i.usuario_id = p.id and i.estado = 'vigente'))
                  from perfiles p where p.id = r.usuario_id),
    'importada', (select jsonb_build_object('nombre', i.nombre_titular, 'correo', i.correo_titular, 'codigo_origen', i.codigo_origen,
                                            'reclamada_en', i.reclamada_en, 'importado_en', i.importado_en)
                    from reservas_importadas i where i.reserva_id = r.id order by i.id limit 1),
    'solicitud_larga', (select jsonb_build_object('justificacion', s.justificacion, 'creado_en', s.creado_en, 'respuesta', s.respuesta,
                                                  'resuelto_en', s.resuelto_en, 'resuelto_por', pr.nombre)
                          from solicitudes_excepcion s left join perfiles pr on pr.id = s.resuelto_por
                         where s.reserva_id = r.id limit 1),
    'clase', (select jsonb_build_object('id', c.id, 'nombre', c.nombre, 'grupo', c.grupo, 'docente', c.docente)
                from clases c where c.id = r.clase_id),
    'historial', coalesce((
      select jsonb_agg(jsonb_build_object(
               'en', h.creado_en, 'accion', h.accion, 'actor', pa.nombre, 'actor_es_titular', h.actor = r.usuario_id,
               'cambios', (select coalesce(jsonb_agg(jsonb_build_object('campo', k, 'antes', h.antes -> k, 'despues', h.despues -> k)), '[]'::jsonb)
                             from unnest(array['inicio', 'fin', 'equipo_id', 'usuario_id', 'tipo', 'llegada_en', 'desatendido',
                                               'mensaje_llegada', 'compartida', 'protegidos', 'funciono', 'motivo', 'docente']) k
                            where h.antes is not null and (h.antes -> k) is distinct from (h.despues -> k)))
             order by h.creado_en, h.id)
        from reservas_historial h left join perfiles pa on pa.id = h.actor
       where h.reserva_id = r.id), '[]'::jsonb),
    'faro', coalesce((
      select jsonb_agg(jsonb_build_object('en', a.creado_en, 'tipo', a.tipo, 'detalle', a.detalle, 'actor', pa.nombre) order by a.creado_en)
        from (select * from agente_eventos
               where equipo_id = r.equipo_id
                 and creado_en >= r.inicio - interval '15 minutes' and creado_en <= v_hasta + interval '15 minutes'
                 and tipo <> 'inicio'
               order by creado_en limit 80) a
        left join perfiles pa on pa.id = a.actor), '[]'::jsonb),
    'inasistencia', (select jsonb_build_object('numero', i.numero, 'estado', i.estado, 'sancion_hasta', i.sancion_hasta,
                                               'apelacion', i.apelacion, 'apelada_en', i.apelada_en, 'respuesta', i.respuesta,
                                               'resuelto_en', i.resuelto_en, 'creado_en', i.creado_en)
                       from inasistencias i where i.reserva_id = r.id),
    'software', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'software', s.software, 'version', s.version, 'estado', s.estado,
                                          'creado_en', s.creado_en, 'respuesta', s.respuesta) order by s.creado_en)
        from solicitudes_software s where s.reserva_id = r.id), '[]'::jsonb),
    'fallas', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'categoria', f.categoria, 'descripcion', f.descripcion, 'estado', f.estado,
                                          'respuesta', f.respuesta, 'creado_en', f.creado_en) order by f.creado_en)
        from reportes f
       where f.equipo_id = r.equipo_id and f.usuario_id = r.usuario_id
         and f.creado_en >= r.inicio - interval '30 minutes' and f.creado_en <= v_hasta + interval '6 hours'), '[]'::jsonb)
  ) into v;
  return v;
end $$;

-- ===================================================================== Permisos
grant select on reservas_importadas to authenticated;   -- la política importadas_ver la limita al personal
revoke execute on function _actividad_pide_docente(text), _docente_para(text, text) from public, anon, authenticated;
revoke execute on function crear_reserva(text, timestamptz, timestamptz, text, text, boolean, text, text, text) from public, anon;
grant execute on function crear_reserva(text, timestamptz, timestamptz, text, text, boolean, text, text, text) to authenticated;
revoke execute on function solicitar_excepcion(text, timestamptz, timestamptz, text, text, text, text) from public, anon;
grant execute on function solicitar_excepcion(text, timestamptz, timestamptz, text, text, text, text) to authenticated;
revoke execute on function docentes_sugeridos(), reserva_detalle(uuid) from public, anon;
grant execute on function docentes_sugeridos(), reserva_detalle(uuid) to authenticated;

commit;
