-- 0027 · Faro 0.7.5: «Salir un rato» y avisos al titular
-- Ejecutar después de 0026. Idempotente.
--
--   A. «Salir un rato» (faro_accion 'salir'): quien tiene la reserva (con la llegada confirmada) tapa la
--      pantalla sin cerrar nada, con un mensaje opcional («Entrenando un modelo, no apagar») y una hora
--      opcional de regreso. Dura hasta el fin de la reserva y se quita con el código de la reserva o el QR.
--   B. El personal con el QR de la pantalla ya no desbloquea en silencio: la app pide confirmación
--      («Este equipo es de Ana. ¿Desbloquearlo como personal?») y el titular recibe un aviso.
--   C. Avisos al titular: el personal suspendió su pantalla, alguien que no es él la desbloqueó, o en su
--      equipo escribieron varios códigos equivocados.
begin;

-- ===================================================================== Columnas
alter table agentes add column if not exists suspension_mensaje text;
alter table agentes add column if not exists suspension_vuelvo timestamptz;

alter table agente_eventos drop constraint if exists agente_eventos_tipo_check;
alter table agente_eventos add constraint agente_eventos_tipo_check check (tipo in (
  'vinculado', 'desvinculado', 'inicio', 'uso_sin_reserva', 'llegada_detectada', 'bloqueo', 'desbloqueo',
  'desbloqueo_personal', 'desbloqueo_emergencia', 'cierre_intentado', 'modo', 'cierre_forzado', 'actualizado',
  'clase_inicio', 'clase_fin', 'llegada_qr', 'comando', 'retirado', 'accion', 'suspension', 'reanudado',
  'codigos_fallidos'));

-- Reserva vigente de un equipo (la usan varias funciones de aquí).
create or replace function _reserva_vigente(p_equipo uuid) returns reservas
language sql stable security definer set search_path = public as $$
  select * from reservas
   where equipo_id = p_equipo and tipo = 'reserva' and estado = 'activa' and liberada_en is null and inicio <= now() and fin > now()
   order by inicio desc limit 1 $$;

-- ===================================================================== C. Avisos al titular
-- Al reanudar: si lo hizo alguien distinto del titular (personal, clave temporal o de emergencia), se le avisa.
do $$ begin
  if not exists (select 1 from pg_proc where proname = '_faro_reanudar_0026') then
    alter function _faro_reanudar(uuid, text, uuid) rename to _faro_reanudar_0026;
  end if;
end $$;
revoke execute on function _faro_reanudar_0026(uuid, text, uuid) from public, anon, authenticated;

create or replace function _faro_reanudar(p_equipo uuid, p_via text, p_actor uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r reservas := _reserva_vigente(p_equipo); v_cod text; v_quien text;
begin
  perform _faro_reanudar_0026(p_equipo, p_via, p_actor);
  update agentes set suspension_mensaje = null, suspension_vuelvo = null where equipo_id = p_equipo;
  if r.id is null or p_via in ('codigo', 'qr') or p_actor = r.usuario_id then return; end if;
  select codigo into v_cod from equipos where id = p_equipo;
  v_quien := case p_via
    when 'qr_personal' then coalesce((select nombre from perfiles where id = p_actor), 'El personal del laboratorio')
    when 'panel' then coalesce((select nombre from perfiles where id = p_actor), 'El personal del laboratorio')
    when 'clave_temporal' then 'El personal del laboratorio (con una clave temporal)'
    when 'emergencia' then 'El personal del laboratorio (con la clave de emergencia)'
    else 'El personal del laboratorio' end;
  perform _avisar(r.usuario_id, 'faro_desbloqueada', 'faro_desbloqueada:' || r.id || ':' || extract(epoch from now())::bigint,
                  'Desbloquearon ' || v_cod, v_quien || ' desbloqueó la pantalla de ' || v_cod || ' durante su reserva.',
                  '/mis-reservas', r.id, null, null, false);
end $$;
revoke execute on function _faro_reanudar(uuid, text, uuid) from public, anon, authenticated;

-- «Bloquear ya» del personal: el titular se entera.
do $$ begin
  if not exists (select 1 from pg_proc where proname = '_faro_suspender_0026') then
    alter function faro_suspender(text[], int) rename to _faro_suspender_0026;
  end if;
end $$;
revoke execute on function _faro_suspender_0026(text[], int) from public, anon, authenticated;

create or replace function faro_suspender(p_equipos text[], p_minutos int default 60) returns int
language plpgsql security definer set search_path = public as $$
declare n int; e equipos; r reservas;
begin
  n := _faro_suspender_0026(p_equipos, p_minutos);
  for e in select q.* from equipos q join agentes a on a.equipo_id = q.id
            where a.suspension_motivo = 'bloqueo' and a.suspendido_desde = now() loop
    update agentes set suspension_mensaje = null, suspension_vuelvo = null where equipo_id = e.id;
    r := _reserva_vigente(e.id);
    if r.id is not null then
      perform _avisar(r.usuario_id, 'faro_suspendida', 'faro_suspendida:' || r.id || ':' || extract(epoch from now())::bigint,
                      'Suspendieron la pantalla de ' || e.codigo,
                      'El laboratorio suspendió la pantalla. Sus programas siguen abiertos; la quita con el código de su reserva (Mis reservas).',
                      '/mis-reservas', r.id, null, null, false);
    end if;
  end loop;
  return n;
end $$;

-- Faro avisa con el evento codigos_fallidos tras varios códigos equivocados en la pantalla.
do $$ begin
  if not exists (select 1 from pg_proc where proname = '_faro_evento_0026') then
    alter function faro_evento(text, text, jsonb) rename to _faro_evento_0026;
  end if;
end $$;
revoke execute on function _faro_evento_0026(text, text, jsonb) from public, anon, authenticated;

create or replace function faro_evento(p_token text, p_tipo text, p_detalle jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare a agentes; r reservas; v_cod text;
begin
  perform _faro_evento_0026(p_token, p_tipo, p_detalle);
  if p_tipo <> 'codigos_fallidos' then return; end if;
  select * into a from agentes where token_hash = _faro_hash_token(p_token) and token_hash is not null;
  r := _reserva_vigente(a.equipo_id);
  if r.id is null then return; end if;
  select codigo into v_cod from equipos where id = a.equipo_id;
  -- Un aviso cada 10 minutos como mucho.
  perform _avisar(r.usuario_id, 'faro_codigos', 'faro_codigos:' || r.id || ':' || floor(extract(epoch from now()) / 600)::bigint,
                  'Intentaron desbloquear ' || v_cod,
                  'Escribieron varios códigos equivocados en la pantalla de ' || v_cod || '. Si no fue usted, avise al personal.',
                  '/mis-reservas', r.id, null, null, false);
end $$;
revoke execute on function faro_evento(text, text, jsonb) from public;
grant execute on function faro_evento(text, text, jsonb) to anon, authenticated;

-- ===================================================================== A. «Salir un rato»
do $$ begin
  if not exists (select 1 from pg_proc where proname = '_faro_accion_0026') then
    alter function faro_accion(text, text, jsonb) rename to _faro_accion_0026;
  end if;
end $$;
revoke execute on function _faro_accion_0026(text, text, jsonb) from public, anon, authenticated;

create or replace function faro_accion(p_token text, p_accion text, p_datos jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a agentes; e equipos; r reservas; v_msg text; v_vuelvo timestamptz; v_min int;
begin
  if p_accion <> 'salir' then return _faro_accion_0026(p_token, p_accion, p_datos); end if;
  select * into a from agentes where token_hash = _faro_hash_token(p_token) and token_hash is not null;
  if not found then raise exception 'Faro no está vinculado a ningún equipo.' using errcode = '28000'; end if;
  select * into e from equipos where id = a.equipo_id;
  r := _reserva_vigente(e.id);
  if r.id is null then raise exception 'Este equipo no tiene una reserva vigente.'; end if;
  if r.llegada_en is null then raise exception 'Primero confirme su asistencia en este equipo.'; end if;
  if (select count(*) from agente_eventos where equipo_id = e.id and tipo = 'accion' and creado_en > now() - interval '1 hour') >= 20 then
    raise exception 'Demasiadas acciones desde este equipo. Intente más tarde.';
  end if;
  v_msg := _limpiar_texto(p_datos ->> 'mensaje', true);
  if v_msg is not null and char_length(v_msg) > 120 then raise exception 'El mensaje tiene máximo 120 caracteres.'; end if;
  if v_msg is not null and _palabra_bloqueada(v_msg) is not null then raise exception 'El mensaje tiene palabras que no se permiten.'; end if;
  v_min := nullif(p_datos ->> 'vuelvo_min', '')::int;
  if v_min is not null then
    if v_min < 5 or v_min > 600 then raise exception 'La hora de regreso está entre 5 minutos y 10 horas.'; end if;
    v_vuelvo := least(now() + make_interval(mins => v_min), r.fin);
  end if;
  update agentes set suspendido_desde = now(), suspendido_hasta = r.fin, suspension_motivo = 'titular',
                     suspension_mensaje = v_msg, suspension_vuelvo = v_vuelvo, qr_desbloqueo = null
   where equipo_id = e.id;
  insert into agente_eventos (equipo_id, tipo, detalle) values (e.id, 'accion', jsonb_build_object('accion', 'salir'));
  insert into agente_eventos (equipo_id, tipo, detalle) values (e.id, 'suspension', jsonb_build_object('motivo', 'titular'));
  return jsonb_build_object('ok', true, 'texto', 'Pantalla bloqueada. Quítala con el código de tu reserva.');
end $$;
revoke execute on function faro_accion(text, text, jsonb) from public;
grant execute on function faro_accion(text, text, jsonb) to anon, authenticated;

-- Faro recibe el mensaje y la hora de regreso junto con la suspensión.
do $$ begin
  if not exists (select 1 from pg_proc where proname = '_faro_estado_0026') then
    alter function faro_estado(text, jsonb) rename to _faro_estado_0026;
  end if;
end $$;
revoke execute on function _faro_estado_0026(text, jsonb) from public, anon, authenticated;

create or replace function faro_estado(p_token text, p_info jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb; a agentes; r reservas;
begin
  -- «Salir un rato» dura lo que la reserva: si se extendió, sigue; si terminó o se liberó, se quita.
  select * into a from agentes where token_hash = _faro_hash_token(p_token) and token_hash is not null;
  if a.suspension_motivo = 'titular' and a.suspendido_desde is not null then
    r := _reserva_vigente(a.equipo_id);
    update agentes set suspendido_hasta = coalesce(r.fin, now()) where equipo_id = a.equipo_id;
  end if;
  v := _faro_estado_0026(p_token, p_info);
  if jsonb_typeof(v -> 'suspension') = 'object' and v -> 'suspension' ->> 'motivo' = 'titular' then
    select * into a from agentes where token_hash = _faro_hash_token(p_token) and token_hash is not null;
    v := jsonb_set(v, '{suspension}', (v -> 'suspension') || jsonb_strip_nulls(jsonb_build_object('mensaje', a.suspension_mensaje, 'vuelvo', a.suspension_vuelvo)));
  end if;
  return v;
end $$;
grant execute on function faro_estado(text, jsonb) to anon, authenticated;

-- ===================================================================== B. QR del personal con confirmación
drop function if exists desbloquear_con_qr(text, text);
create or replace function desbloquear_con_qr(p_equipo text, p_codigo text, p_confirmar boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); e equipos; a agentes; r reservas; v_titular text;
begin
  select * into e from equipos where codigo = upper(p_equipo);
  if not found then raise exception 'No existe el equipo %.', p_equipo; end if;
  select * into a from agentes where equipo_id = e.id;
  if a.suspendido_desde is null and not exists (select 1 from faro_anuncios f where f.obligatorio and f.hasta > now()
                                                   and (f.equipos is null or e.codigo = any (f.equipos))) then
    return jsonb_build_object('ok', true, 'texto', e.codigo || ' no está suspendido.');
  end if;
  if a.qr_desbloqueo is null or a.qr_desbloqueo <> p_codigo or a.qr_desbloqueo_en < now() - interval '2 minutes' then
    raise exception 'El código venció. Escanee de nuevo el QR que muestra la pantalla.';
  end if;
  r := _reserva_vigente(e.id);
  -- Con reserva vigente: su titular, o el personal confirmándolo (el titular recibe un aviso). Sin reserva:
  -- quien escanea frente al equipo con su cuenta (queda registrado).
  if r.id is not null and r.usuario_id <> v then
    if not es_staff() then
      raise exception 'Solo quien tiene la reserva de % puede desbloquearlo. Si lo necesita, pida ayuda al personal.', e.codigo;
    end if;
    if not coalesce(p_confirmar, false) then
      select nombre into v_titular from perfiles where id = r.usuario_id;
      return jsonb_build_object('ok', false, 'confirmar', true, 'equipo', e.codigo, 'titular', coalesce(v_titular, 'otra persona'),
                                'hasta', r.fin);
    end if;
    perform _faro_reanudar(e.id, 'qr_personal', v);
    return jsonb_build_object('ok', true, 'texto', e.codigo || ' quedó desbloqueado. Su titular recibió un aviso.');
  end if;
  perform _faro_reanudar(e.id, 'qr', v);
  return jsonb_build_object('ok', true, 'texto', e.codigo || ' quedó desbloqueado. Ya puede seguir trabajando.');
end $$;
revoke execute on function desbloquear_con_qr(text, text, boolean) from public, anon;
grant execute on function desbloquear_con_qr(text, text, boolean) to authenticated;
revoke execute on function _reserva_vigente(uuid) from public, anon, authenticated;

commit;
