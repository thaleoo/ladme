-- =============================================================================
-- LADME · Migración 0007 · Faro: uso real, modo clase y avisos al chat del personal
-- -----------------------------------------------------------------------------
-- Ejecutar en Supabase → SQL Editor, después de 0006. Es idempotente.
--
-- A. Uso real por hora: cada latido de Faro suma el tiempo encendido, en uso y en
--    uso sin reserva del equipo (sin guardar cada latido). faro_estadisticas() lo
--    resume para la pestaña Faro.
-- B. Modo clase: faro_clase() bloquea los equipos para reservas y los deja libres
--    para la clase; faro_clase_terminar() lo deshace.
-- C. Chat del personal: cola_chat guarda avisos breves y SIN datos personales
--    (reportes, solicitudes, Faro). Apps Script los envía a Telegram o Google Chat.
-- D. Faro informa cierres forzados (su vigía lo volvió a abrir) y actualizaciones.
-- =============================================================================

begin;

-- ------------------------------------------------- D. NUEVOS EVENTOS DE FARO
alter table agente_eventos drop constraint if exists agente_eventos_tipo_check;
alter table agente_eventos add constraint agente_eventos_tipo_check check (tipo in (
  'vinculado', 'desvinculado', 'inicio', 'uso_sin_reserva', 'llegada_detectada', 'bloqueo', 'desbloqueo',
  'desbloqueo_personal', 'desbloqueo_emergencia', 'cierre_intentado', 'modo',
  'cierre_forzado', 'actualizado', 'clase_inicio', 'clase_fin'));

-- ------------------------------------------------- C. COLA DEL CHAT DEL PERSONAL
create table if not exists cola_chat (
  id          bigint generated always as identity primary key,
  tipo        text not null,
  dedupe_key  text not null unique,
  texto       text not null check (char_length(texto) <= 500),
  url         text,
  creado_en   timestamptz not null default now(),
  enviado_en  timestamptz
);
create index if not exists cola_chat_pendientes_idx on cola_chat (creado_en) where enviado_en is null;
alter table cola_chat enable row level security;
revoke all on cola_chat from public, anon, authenticated;

create or replace function _avisar_chat(p_tipo text, p_dedupe text, p_texto text, p_url text default null)
returns void language sql security definer set search_path = public as $$
  insert into cola_chat (tipo, dedupe_key, texto, url) values (p_tipo, p_dedupe, left(p_texto, 500), p_url)
  on conflict (dedupe_key) do nothing $$;

-- Reportes de falla: solo equipo y categoría (la descripción puede traer datos personales).
create or replace function trg_chat_reporte() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform _avisar_chat('reporte', 'reporte:' || new.id,
    'Nuevo reporte de falla en ' || (select codigo from equipos where id = new.equipo_id) || ': ' || new.categoria || '.',
    '/admin?tab=reportes');
  return new;
end $$;
drop trigger if exists reportes_chat on reportes;
create trigger reportes_chat after insert on reportes for each row execute function trg_chat_reporte();

create or replace function trg_chat_solicitud() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform _avisar_chat('solicitud', 'solicitud:' || new.id,
    'Nueva solicitud de reserva larga para ' || (select codigo from equipos where id = new.equipo_id) || ' (' ||
    round(extract(epoch from new.fin - new.inicio) / 86400.0, 1) || ' días).',
    '/admin?tab=solicitudes');
  return new;
end $$;
drop trigger if exists solicitudes_chat on solicitudes_excepcion;
create trigger solicitudes_chat after insert on solicitudes_excepcion for each row execute function trg_chat_solicitud();

-- Equipos con Faro vinculado que dejaron de dar señal en horario del laboratorio
-- (lunes a sábado, 7:00–19:00 de Bogotá). Un aviso por equipo y día.
create or replace function encolar_alertas_faro() returns int
language plpgsql security definer set search_path = public as $$
declare v_local timestamp := now() at time zone 'America/Bogota'; n int := 0; r record; begin
  if extract(isodow from v_local) = 7 or extract(hour from v_local) not between 7 and 18 then return 0; end if;
  for r in
    select e.codigo, a.ultimo_latido from agentes a join equipos e on e.id = a.equipo_id
     where a.token_hash is not null and e.estado = 'activo' and not e.archivado
       and a.ultimo_latido < now() - interval '15 minutes'
       and a.ultimo_latido > now() - interval '12 hours'   -- apagado desde ayer no es una alerta
  loop
    perform _avisar_chat('faro_sin_senal', 'faro_sin_senal:' || r.codigo || ':' || to_char(v_local, 'YYYY-MM-DD'),
      r.codigo || ' lleva ' || round(extract(epoch from now() - r.ultimo_latido) / 60) ||
      ' min sin señal de Faro. ¿Lo apagaron o cerraron Faro?', '/admin?tab=faro');
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function chat_pendientes(p_limite int default 20)
returns table (id bigint, tipo text, texto text, url text, creado_en timestamptz)
language sql security definer set search_path = public as $$
  select c.id, c.tipo, c.texto, c.url, c.creado_en from cola_chat c
   where c.enviado_en is null and c.creado_en > now() - interval '2 days'
   order by c.creado_en limit least(greatest(p_limite, 1), 50) $$;

create or replace function marcar_chat_enviado(p_ids bigint[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int; begin
  update cola_chat set enviado_en = now() where id = any (p_ids) and enviado_en is null;
  get diagnostics n = row_count;
  delete from cola_chat where creado_en < now() - interval '60 days';
  return n;
end $$;

-- ------------------------------------------------- A. USO REAL POR HORA
create table if not exists faro_uso (
  equipo_id            uuid not null references equipos (id),
  hora                 timestamptz not null,           -- inicio de la hora
  encendido_seg        int not null default 0,
  uso_seg              int not null default 0,
  uso_sin_reserva_seg  int not null default 0,
  primary key (equipo_id, hora)
);
alter table faro_uso enable row level security;
revoke all on faro_uso from public, anon, authenticated;

-- Latido de Faro (cada ~30 s): guarda su estado, suma el uso y devuelve lo que debe mostrar.
create or replace function faro_estado(p_token text, p_info jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a agentes; v_eq equipos; r reservas; s reservas; v_titular text; c faro_clave;
  v_inact int := case when p_info ->> 'inactivo_seg' ~ '^\d{1,9}$' then (p_info ->> 'inactivo_seg')::int end;
  v_en_uso boolean; v_delta int; v_libre boolean;
begin
  select * into a from agentes where token_hash = _faro_hash_token(p_token) and token_hash is not null for update;
  if not found then raise exception 'Faro no está vinculado a ningún equipo.' using errcode = '28000'; end if;
  update agentes set ultimo_latido = now(), inactivo_seg = v_inact,
                     bloqueado = coalesce(p_info ->> 'bloqueado' = 'true', false),
                     host = coalesce(left(p_info ->> 'host', 80), host), so = coalesce(left(p_info ->> 'so', 80), so),
                     version = coalesce(left(p_info ->> 'version', 20), version)
   where equipo_id = a.equipo_id;
  select * into v_eq from equipos where id = a.equipo_id;

  select * into r from reservas
   where equipo_id = v_eq.id and estado = 'activa' and liberada_en is null and inicio <= now() and fin > now()
   order by inicio desc limit 1;
  select * into s from reservas
   where equipo_id = v_eq.id and estado = 'activa' and liberada_en is null and inicio > now() and inicio < now() + interval '24 hours'
   order by inicio limit 1;
  v_en_uso := v_inact is not null and v_inact < 120;
  v_libre := coalesce(a.desbloqueo_hasta, '-infinity') > now();

  -- Tiempo desde el latido anterior (máximo 2 min: si Faro estuvo apagado, eso no cuenta).
  v_delta := least(greatest(extract(epoch from now() - coalesce(a.ultimo_latido, now()))::int, 0), 120);
  if v_delta > 0 then
    insert into faro_uso (equipo_id, hora, encendido_seg, uso_seg, uso_sin_reserva_seg)
    values (v_eq.id, date_trunc('hour', now()), v_delta,
            case when v_en_uso then v_delta else 0 end,
            case when v_en_uso and r.id is null and not v_libre then v_delta else 0 end)
    on conflict (equipo_id, hora) do update set
      encendido_seg = faro_uso.encendido_seg + excluded.encendido_seg,
      uso_seg = faro_uso.uso_seg + excluded.uso_seg,
      uso_sin_reserva_seg = faro_uso.uso_sin_reserva_seg + excluded.uso_sin_reserva_seg;
  end if;

  if r.id is not null and r.tipo = 'reserva' then
    select split_part(nombre, ' ', 1) into v_titular from perfiles where id = r.usuario_id;
    if r.llegada_en is null and v_en_uso and coalesce(politica_int('faro_llegada_automatica'), 1) = 1 then
      update reservas set llegada_en = now() where id = r.id returning * into r;
      insert into agente_eventos (equipo_id, tipo, detalle)
      values (v_eq.id, 'llegada_detectada', jsonb_build_object('reserva', r.codigo_legible));
    end if;
  end if;

  if r.id is null and v_en_uso and not v_libre
     and coalesce(a.ultimo_uso_sin_reserva, '-infinity') < now() - interval '30 minutes' then
    update agentes set ultimo_uso_sin_reserva = now() where equipo_id = a.equipo_id;
    insert into agente_eventos (equipo_id, tipo, detalle) values (v_eq.id, 'uso_sin_reserva', jsonb_build_object('modo', a.modo));
  end if;

  select * into c from faro_clave;
  return jsonb_build_object(
    'ahora', now(),
    'equipo', jsonb_build_object('codigo', v_eq.codigo, 'nombre', v_eq.nombre,
                                 'estado', case when v_eq.archivado then 'fuera_de_servicio' else v_eq.estado::text end,
                                 'sistema', concat_ws(' ', v_eq.sistema_operativo, v_eq.so_version)),
    'modo', a.modo,
    'desbloqueo_hasta', case when v_libre then a.desbloqueo_hasta end,
    'actual', case when r.id is not null then jsonb_build_object(
                'tipo', r.tipo, 'inicio', r.inicio, 'fin', r.fin, 'titular', v_titular,
                'desatendido', r.desatendido, 'mensaje', r.mensaje_llegada,
                'motivo', case when r.tipo = 'bloqueo' then r.motivo end,
                'llegada', r.llegada_en is not null) end,
    'siguiente', case when s.id is not null then jsonb_build_object('tipo', s.tipo, 'inicio', s.inicio, 'fin', s.fin) end,
    'politicas', jsonb_build_object('aviso_min', coalesce(politica_int('faro_aviso_min'), 10),
                                    'gracia_min', coalesce(politica_int('faro_gracia_min'), 3),
                                    'desatendido_min', coalesce(politica_int('faro_desatendido_min'), 10)),
    'clave', case when c.hash is not null then jsonb_build_object('sal', c.sal, 'hash', c.hash, 'iteraciones', c.iteraciones) end
  );
end $$;

create or replace function faro_evento(p_token text, p_tipo text, p_detalle jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare a agentes; v_cod text; begin
  if p_tipo not in ('inicio', 'bloqueo', 'desbloqueo', 'desbloqueo_emergencia', 'cierre_intentado', 'cierre_forzado', 'actualizado') then
    return;
  end if;
  select * into a from agentes where token_hash = _faro_hash_token(p_token) and token_hash is not null;
  if not found then raise exception 'Faro no está vinculado a ningún equipo.' using errcode = '28000'; end if;
  if (select count(*) from agente_eventos where equipo_id = a.equipo_id and creado_en > now() - interval '1 hour') >= 120 then return; end if;
  delete from agente_eventos where creado_en < now() - interval '180 days';
  delete from faro_uso where hora < now() - interval '400 days';
  insert into agente_eventos (equipo_id, tipo, detalle)
  values (a.equipo_id, p_tipo, coalesce((select jsonb_object_agg(k, left(v, 200)) from jsonb_each_text(p_detalle) t(k, v)), '{}'));
  select codigo into v_cod from equipos where id = a.equipo_id;
  if p_tipo = 'desbloqueo_emergencia' then
    perform _avisar_staff('faro', 'faro_emergencia:' || a.equipo_id || ':' || to_char(now(), 'YYYYMMDDHH24'),
                          'Faro: clave de emergencia usada en ' || v_cod,
                          'Alguien desbloqueó ' || v_cod || ' con la clave de emergencia del laboratorio. Si no fue el personal, cámbiela en Administración → Faro.',
                          '/admin?tab=faro');
    perform _avisar_chat('faro_emergencia', 'faro_emergencia:' || v_cod || ':' || to_char(now(), 'YYYYMMDDHH24'),
                         'Se usó la clave de emergencia de Faro en ' || v_cod || '.', '/admin?tab=faro');
  elsif p_tipo = 'cierre_forzado' then
    perform _avisar_chat('faro_cierre', 'faro_cierre:' || v_cod || ':' || to_char(now(), 'YYYYMMDDHH24'),
                         'Alguien cerró Faro a la fuerza en ' || v_cod || ' y se volvió a abrir solo.', '/admin?tab=faro');
  end if;
end $$;

-- Resumen de uso para la pestaña Faro (horas en hora local de Bogotá).
create or replace function faro_estadisticas(p_desde timestamptz, p_hasta timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _faro_staff();
  if p_hasta <= p_desde or p_hasta - p_desde > interval '400 days' then raise exception 'Intervalo no válido.'; end if;
  return jsonb_build_object(
    'por_equipo', coalesce((
      select jsonb_agg(x order by x ->> 'codigo') from (
        select jsonb_build_object(
          'codigo', e.codigo,
          'encendido_h', round(coalesce(sum(u.encendido_seg), 0) / 3600.0, 1),
          'uso_h', round(coalesce(sum(u.uso_seg), 0) / 3600.0, 1),
          'sin_reserva_h', round(coalesce(sum(u.uso_sin_reserva_seg), 0) / 3600.0, 1),
          'reservado_h', (select round(coalesce(sum(extract(epoch from
                              least(coalesce(r.liberada_en, r.fin), r.fin, p_hasta, now()) - greatest(r.inicio, p_desde))), 0) / 3600.0, 1)
                            from reservas r
                           where r.equipo_id = e.id and r.tipo = 'reserva' and r.estado = 'activa'
                             and r.inicio < least(p_hasta, now()) and coalesce(r.liberada_en, r.fin) > p_desde),
          'reservas_sin_uso', (select count(*) from reservas r
                                where r.equipo_id = e.id and r.tipo = 'reserva' and r.estado = 'activa'
                                  and r.llegada_en is null and r.fin <= now() and r.inicio >= p_desde and r.inicio < p_hasta
                                  and a.vinculado_en is not null and a.vinculado_en < r.inicio)) x
          from equipos e
          join agentes a on a.equipo_id = e.id
          left join faro_uso u on u.equipo_id = e.id and u.hora >= p_desde and u.hora < p_hasta
         where not e.archivado and (a.token_hash is not null or exists (select 1 from faro_uso f where f.equipo_id = e.id))
         group by e.id, e.codigo, a.vinculado_en) t), '[]'::jsonb),
    'por_hora', coalesce((
      select jsonb_agg(jsonb_build_object('dia', d, 'hora', h, 'uso_h', round(s / 3600.0, 2), 'sin_reserva_h', round(sr / 3600.0, 2)))
        from (select extract(isodow from u.hora at time zone 'America/Bogota')::int d,
                     extract(hour from u.hora at time zone 'America/Bogota')::int h,
                     sum(u.uso_seg) s, sum(u.uso_sin_reserva_seg) sr
                from faro_uso u where u.hora >= p_desde and u.hora < p_hasta group by 1, 2) t), '[]'::jsonb)
  );
end $$;

-- ------------------------------------------------- B. MODO CLASE
-- Bloquea los equipos para reservas y los deja libres para la clase (Faro no bloquea).
-- Los equipos con una reserva en ese horario se omiten y se informan.
create or replace function faro_clase(p_equipos text[], p_minutos int, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := _faro_staff(); v_fin timestamptz; v_mot text := trim(coalesce(p_motivo, '')); e equipos;
        v_ok text[] := '{}'; v_omit text[] := '{}'; begin
  if p_minutos is null or p_minutos < 15 or p_minutos > 720 then raise exception 'La clase debe durar entre 15 minutos y 12 horas.'; end if;
  if char_length(v_mot) < 3 then raise exception 'Escriba el nombre de la clase.'; end if;
  v_fin := date_trunc('minute', now()) + make_interval(mins => p_minutos);
  for e in select * from equipos
            where not archivado and estado = 'activo'
              and (p_equipos is null or codigo = any (select upper(x) from unnest(p_equipos) x))
            order by codigo
  loop
    if exists (select 1 from reservas where equipo_id = e.id and estado = 'activa' and liberada_en is null
                and periodo && tstzrange(now(), v_fin, '[)')) then
      v_omit := v_omit || e.codigo;
      continue;
    end if;
    insert into reservas (tipo, equipo_id, usuario_id, inicio, fin, motivo)
    values ('bloqueo', e.id, v, now(), v_fin, left('Clase · ' || v_mot, 200));
    update agentes set desbloqueo_hasta = v_fin, desbloqueo_por = v where equipo_id = e.id;
    insert into agente_eventos (equipo_id, tipo, detalle, actor)
    values (e.id, 'clase_inicio', jsonb_build_object('motivo', left(v_mot, 120), 'minutos', p_minutos), v);
    v_ok := v_ok || e.codigo;
  end loop;
  return jsonb_build_object('equipos', to_jsonb(v_ok), 'omitidos', to_jsonb(v_omit), 'fin', v_fin);
end $$;

create or replace function faro_clase_terminar(p_equipos text[]) returns int
language plpgsql security definer set search_path = public as $$
declare v uuid := _faro_staff(); n int := 0; b record; begin
  for b in
    select r.id, r.equipo_id from reservas r join equipos e on e.id = r.equipo_id
     where r.tipo = 'bloqueo' and r.estado = 'activa' and r.motivo like 'Clase · %' and r.fin > now()
       and (p_equipos is null or e.codigo = any (select upper(x) from unnest(p_equipos) x))
  loop
    update reservas set estado = 'cancelada', cancelada_en = now(), motivo = motivo || ' (terminada)' where id = b.id;
    update agentes set desbloqueo_hasta = null, desbloqueo_por = null where equipo_id = b.equipo_id;
    insert into agente_eventos (equipo_id, tipo, actor) values (b.equipo_id, 'clase_fin', v);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- PERMISOS
revoke execute on function _avisar_chat, trg_chat_reporte, trg_chat_solicitud, encolar_alertas_faro, chat_pendientes,
                           marcar_chat_enviado, faro_estado, faro_evento, faro_estadisticas, faro_clase, faro_clase_terminar
  from public, anon, authenticated;
grant execute on function faro_estado, faro_evento to anon, authenticated;
grant execute on function faro_estadisticas, faro_clase, faro_clase_terminar to authenticated;
grant execute on function encolar_alertas_faro, chat_pendientes, marcar_chat_enviado to service_role;

commit;
