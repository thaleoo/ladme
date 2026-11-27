-- 0025 · Faro 0.6: acciones en la isla, sin el celular
-- Ejecutar después de 0024. Idempotente.
--
--   A. faro_accion(): desde la isla se puede extender (+30 min o +1 h), liberar, reportar una falla y pedir ayuda.
--      Extender y liberar usan las mismas funciones que la app (extender_reserva, liberar_reserva), con todas sus
--      reglas, actuando como la persona de la reserva. Solo valen si su llegada se confirmó en ese equipo: así
--      quien se sienta en un equipo reservado por otra persona no puede liberarlo. La persona recibe un aviso.
--   B. Un reporte hecho desde el equipo puede no tener persona (equipo libre): reportes.usuario_id admite null y
--      reportes.origen dice de dónde vino. Lleva el diagnóstico que manda Faro.
--   C. faro_estado() dice si el equipo tiene tarjeta NFC (política faro_nfc) para mostrar «acerca tu celular».
begin;

-- ===================================================================== B. Reportes desde el equipo
alter table reportes alter column usuario_id drop not null;
alter table reportes add column if not exists origen text not null default 'app';
alter table reportes drop constraint if exists reportes_origen_check;
alter table reportes add constraint reportes_origen_check check (origen in ('app', 'faro'));

alter table agente_eventos drop constraint if exists agente_eventos_tipo_check;
alter table agente_eventos add constraint agente_eventos_tipo_check check (tipo in (
  'vinculado', 'desvinculado', 'inicio', 'uso_sin_reserva', 'llegada_detectada', 'bloqueo', 'desbloqueo',
  'desbloqueo_personal', 'desbloqueo_emergencia', 'cierre_intentado', 'modo', 'cierre_forzado', 'actualizado',
  'clase_inicio', 'clase_fin', 'llegada_qr', 'comando', 'retirado', 'accion'));

insert into politicas (clave, valor, descripcion) values
  ('faro_nfc', '1', 'Los equipos tienen tarjeta NFC en la base del monitor: Faro invita a acercar el celular para reservar (1 = sí, 0 = no).')
on conflict (clave) do nothing;

-- ===================================================================== A. Acciones
create or replace function faro_accion(p_token text, p_accion text, p_datos jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a agentes; e equipos; r reservas; v_min int; v_cat text; v_rep reportes; v_prev text; v_diag jsonb;
  v_hora text;
begin
  select * into a from agentes where token_hash = _faro_hash_token(p_token) and token_hash is not null;
  if not found then raise exception 'Faro no está vinculado a ningún equipo.' using errcode = '28000'; end if;
  select * into e from equipos where id = a.equipo_id;
  -- Freno: como máximo 20 acciones por equipo y por hora.
  if (select count(*) from agente_eventos where equipo_id = e.id and tipo = 'accion' and creado_en > now() - interval '1 hour') >= 20 then
    raise exception 'Se hicieron muchas acciones desde este equipo en la última hora. Intente más tarde o hable con el personal.';
  end if;
  select * into r from reservas
   where equipo_id = e.id and tipo = 'reserva' and estado = 'activa' and liberada_en is null and inicio <= now() and fin > now()
   order by inicio desc limit 1;

  if p_accion in ('extender', 'liberar') then
    if r.id is null then raise exception 'No hay una reserva en curso en este equipo.'; end if;
    if r.llegada_en is null then
      raise exception 'Primero confirme su llegada con el código de la isla; así sabemos que es usted quien está en el equipo.';
    end if;
    -- Se actúa como la persona de la reserva: valen las mismas reglas que en la app.
    v_prev := current_setting('request.jwt.claim.sub', true);
    perform set_config('request.jwt.claim.sub', r.usuario_id::text, true);
    begin
      if p_accion = 'extender' then
        v_min := case when p_datos ->> 'minutos' in ('30', '60') then (p_datos ->> 'minutos')::int else 30 end;
        r := extender_reserva(r.id, r.fin + make_interval(mins => v_min));
      else
        r := liberar_reserva(r.id);
      end if;
    exception when others then
      perform set_config('request.jwt.claim.sub', coalesce(v_prev, ''), true);
      raise;
    end;
    perform set_config('request.jwt.claim.sub', coalesce(v_prev, ''), true);
    v_hora := lower(to_char(r.fin at time zone 'America/Bogota', 'FMHH12:MI am'));
    insert into agente_eventos (equipo_id, tipo, detalle) values (e.id, 'accion', jsonb_build_object('accion', p_accion, 'minutos', v_min));
    if p_accion = 'extender' then
      perform _avisar(r.usuario_id, 'faro_extendida', 'faro_extendida:' || r.id || ':' || r.extensiones,
                      'Reserva extendida: ' || e.codigo, 'Se extendió desde el equipo. Ahora termina a las ' || v_hora || '.',
                      '/mis-reservas', r.id, null, null, false);
      return jsonb_build_object('ok', true, 'texto', 'Listo: su reserva termina a las ' || v_hora || '.', 'fin', r.fin);
    end if;
    perform _avisar(r.usuario_id, 'faro_liberada', 'faro_liberada:' || r.id,
                    'Equipo liberado: ' || e.codigo, 'Su reserva se liberó desde el equipo. Gracias por dejarlo libre.',
                    '/mis-reservas', r.id, null, null, false);
    return jsonb_build_object('ok', true, 'texto', 'Listo: el equipo quedó libre. Gracias.');
  end if;

  if p_accion = 'reportar' then
    v_cat := p_datos ->> 'categoria';
    if v_cat is null or v_cat not in ('No enciende', 'Lento o se congela', 'Software', 'Pantalla o periféricos', 'Red o internet', 'Otro') then
      raise exception 'Elija qué tipo de problema tiene el equipo.';
    end if;
    if (select count(*) from reportes where equipo_id = e.id and origen = 'faro' and creado_en > now() - interval '1 hour') >= 3 then
      raise exception 'Ya se reportaron varias fallas de este equipo en la última hora. El personal ya está avisado.';
    end if;
    -- Si quien está en el equipo confirmó su llegada, el reporte es suyo; si no, es del equipo.
    insert into reportes (equipo_id, usuario_id, categoria, descripcion, origen)
    values (e.id, case when r.llegada_en is not null then r.usuario_id end, v_cat,
            'Reportado desde el equipo: ' || lower(v_cat) || '.', 'faro')
    returning * into v_rep;
    v_diag := case when jsonb_typeof(p_datos -> 'diagnostico') = 'object' and pg_column_size(p_datos -> 'diagnostico') < 4000
                   then p_datos -> 'diagnostico' end;
    if v_diag is not null then
      update reportes set diagnostico = coalesce(diagnostico, '{}'::jsonb) || jsonb_build_object('faro', v_diag) where id = v_rep.id;
    end if;
    insert into agente_eventos (equipo_id, tipo, detalle) values (e.id, 'accion', jsonb_build_object('accion', 'reportar', 'categoria', v_cat));
    perform _avisar_staff('reporte_falla', 'reporte:' || v_rep.id, 'Reporte de falla: ' || e.codigo,
                          'Desde el equipo ' || e.codigo || ' reportan «' || v_cat || '».', '/admin?tab=reportes');
    return jsonb_build_object('ok', true, 'texto', 'Listo: el laboratorio ya sabe que ' || e.codigo || ' tiene un problema.');
  end if;

  if p_accion = 'ayuda' then
    -- Un aviso por equipo cada 10 minutos.
    perform _avisar_chat('faro_ayuda', 'faro_ayuda:' || e.codigo || ':' || floor(extract(epoch from now()) / 600)::bigint,
                         'Piden ayuda en ' || e.codigo || '.', '/admin?tab=faro');
    insert into agente_eventos (equipo_id, tipo, detalle) values (e.id, 'accion', jsonb_build_object('accion', 'ayuda'));
    return jsonb_build_object('ok', true, 'texto', 'Listo: el personal del laboratorio ya fue avisado.');
  end if;

  raise exception 'Acción no válida.';
end $$;
revoke execute on function faro_accion(text, text, jsonb) from public;
grant execute on function faro_accion(text, text, jsonb) to anon, authenticated;

-- ===================================================================== C. NFC en la respuesta de Faro
do $$ begin
  if not exists (select 1 from pg_proc where proname = '_faro_estado_0014') then
    alter function faro_estado(text, jsonb) rename to _faro_estado_0014;
  end if;
end $$;
revoke execute on function _faro_estado_0014(text, jsonb) from public, anon, authenticated;

create or replace function faro_estado(p_token text, p_info jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb; begin
  v := _faro_estado_0014(p_token, p_info);
  return v || jsonb_build_object('nfc', coalesce(politica_int('faro_nfc'), 1) = 1);
end $$;
grant execute on function faro_estado(text, jsonb) to anon, authenticated;

commit;
