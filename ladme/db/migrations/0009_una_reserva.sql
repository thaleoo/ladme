-- 0009 · Una reserva a la vez por usuario
-- Ejecutar después de 0008. Idempotente.
--
-- Hasta ahora la política reservas_activas_max valía 0 (sin límite): una persona podía reservar
-- varios equipos a la vez. Desde aquí:
--   * reservas_activas_max = 1: cada usuario puede tener UNA reserva vigente o futura a la vez.
--     Al terminar, liberarla o cancelarla puede hacer otra. Se puede cambiar en Políticas.
--   * El personal (laboratoristas y administración) queda exento, como el resto del personal que
--     reserva para clases o mantenimiento.
--   * Un candado por persona evita que dos reservas enviadas al mismo tiempo pasen las dos.
--   * Las reservas largas aprobadas por el personal (solicitudes de excepción) no pasan por aquí:
--     las decide el personal.
begin;

update politicas set valor = '1' where clave = 'reservas_activas_max' and valor = '0';
update politicas set descripcion = 'Reservas vigentes o futuras que puede tener cada usuario a la vez (el personal está exento); 0 = sin límite.'
 where clave = 'reservas_activas_max';

create or replace function crear_reserva(p_equipo text, p_inicio timestamptz, p_fin timestamptz, p_actividad text default null,
                              p_detalle text default null, p_desatendido boolean default false,
                              p_mensaje text default null, p_id_solicitud text default null)
returns reservas language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); v_eq equipos; v_res reservas; v_admin boolean := es_admin(); v_p perfiles;
        v_max int; v_otra reservas; v_cod text; begin
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
                          id_solicitud, programa, matricula, tipo_usuario)
    values ('reserva', v_eq.id, v, p_inicio, p_fin, p_actividad, nullif(trim(p_detalle), ''), coalesce(p_desatendido, false),
            nullif(trim(p_mensaje), ''), p_id_solicitud, v_p.programa, v_p.matricula, v_p.tipo_usuario)
    returning * into v_res;
  exception when exclusion_violation then
    raise exception 'El equipo ya está reservado (o en revisión) en ese intervalo.' using errcode = 'P0001';
  end;
  return v_res;
end $$;

revoke execute on function crear_reserva from public, anon;
grant execute on function crear_reserva to authenticated;

commit;
