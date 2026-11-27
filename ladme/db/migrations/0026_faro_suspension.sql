-- 0026 · Faro 0.7: suspender la pantalla y desbloquearla con la reserva
-- Ejecutar después de 0025. Idempotente.
--
--   A. Suspensión: el personal puede «bloquear ya» un equipo (Administración → Faro) y un anuncio marcado obligatorio
--      que nadie confirma en N minutos (política faro_suspension_min, 10) también suspende la pantalla. Faro tapa la
--      pantalla sin cerrar programas.
--   B. Para quitarla, solo quien tiene la reserva vigente (o el personal):
--        - con el código de su reserva (8 caracteres, en «Tu reserva» de la app): Faro lo verifica aunque no haya red;
--        - con el QR de un solo uso de la pantalla (dura 2 minutos), escaneado con su cuenta (si el equipo no
--          tiene reserva vigente, cualquier cuenta frente al equipo; queda registrado);
--        - con una clave temporal del personal (vence en minutos) o desde el panel.
--   C. Claves temporales del personal: desbloquean cualquier equipo (o uno) por poco tiempo. Faro las recibe
--      cifradas y las acepta donde acepta la clave de emergencia.
--   D. Anuncios obligatorios: se confirman con «Entendido» en la isla.
begin;

-- ===================================================================== Columnas y tablas
alter table agentes add column if not exists suspendido_desde timestamptz;
alter table agentes add column if not exists suspendido_hasta timestamptz;
alter table agentes add column if not exists suspension_motivo text;
alter table agentes add column if not exists qr_desbloqueo text;
alter table agentes add column if not exists qr_desbloqueo_en timestamptz;

alter table reservas add column if not exists codigo_desbloqueo text;

alter table faro_anuncios add column if not exists obligatorio boolean not null default false;
create table if not exists faro_anuncio_lecturas (
  anuncio_id bigint not null references faro_anuncios (id) on delete cascade,
  equipo_id  uuid not null references equipos (id) on delete cascade,
  leido_en   timestamptz not null default now(),
  primary key (anuncio_id, equipo_id)
);
alter table faro_anuncio_lecturas enable row level security;
drop policy if exists lecturas_personal on faro_anuncio_lecturas;
create policy lecturas_personal on faro_anuncio_lecturas for select to authenticated using (es_staff());
revoke all on faro_anuncio_lecturas from public, anon;
grant select on faro_anuncio_lecturas to authenticated;

create table if not exists faro_claves_temporales (
  id         bigint generated always as identity primary key,
  equipo_id  uuid references equipos (id) on delete cascade,   -- null: cualquier equipo
  sal        text not null,
  hash       text not null,
  hasta      timestamptz not null,
  creado_por uuid references perfiles (id) on delete set null,
  creado_en  timestamptz not null default now()
);
alter table faro_claves_temporales enable row level security;
revoke all on faro_claves_temporales from public, anon, authenticated;

alter table agente_eventos drop constraint if exists agente_eventos_tipo_check;
alter table agente_eventos add constraint agente_eventos_tipo_check check (tipo in (
  'vinculado', 'desvinculado', 'inicio', 'uso_sin_reserva', 'llegada_detectada', 'bloqueo', 'desbloqueo',
  'desbloqueo_personal', 'desbloqueo_emergencia', 'cierre_intentado', 'modo', 'cierre_forzado', 'actualizado',
  'clase_inicio', 'clase_fin', 'llegada_qr', 'comando', 'retirado', 'accion', 'suspension', 'reanudado'));

insert into politicas (clave, valor, descripcion) values
  ('faro_suspension_min', '10', 'Minutos que tiene un anuncio obligatorio para ser confirmado antes de suspender la pantalla del equipo (0 = no suspende).')
on conflict (clave) do nothing;

-- ===================================================================== Códigos
-- 8 caracteres sin los que se confunden (0/O, 1/I/L).
create or replace function _codigo_corto() returns text
language sql volatile set search_path = public as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
    from generate_series(1, 8) $$;

create or replace function trg_reservas_codigo_desbloqueo() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.tipo = 'reserva' and new.codigo_desbloqueo is null then new.codigo_desbloqueo := _codigo_corto(); end if;
  return new;
end $$;
drop trigger if exists reservas_codigo_desbloqueo on reservas;
create trigger reservas_codigo_desbloqueo before insert on reservas for each row execute function trg_reservas_codigo_desbloqueo();
update reservas set codigo_desbloqueo = _codigo_corto() where tipo = 'reserva' and codigo_desbloqueo is null and fin > now();

-- Iteraciones del cifrado que recibe Faro para los códigos de reserva y las claves temporales (verificación local).
create or replace function _faro_iter_corto() returns int language sql immutable as $$ select 2000 $$;

-- ===================================================================== A. Suspender y reanudar (personal)
create or replace function faro_suspender(p_equipos text[], p_minutos int default 60) returns int
language plpgsql security definer set search_path = public as $$
declare v uuid := _faro_staff(); n int;
begin
  if p_minutos is null or p_minutos < 1 or p_minutos > 720 then raise exception 'La suspensión dura entre 1 minuto y 12 horas.'; end if;
  update agentes a set suspendido_desde = now(), suspendido_hasta = now() + make_interval(mins => p_minutos), suspension_motivo = 'bloqueo'
    from equipos e
   where e.id = a.equipo_id and a.token_hash is not null and (p_equipos is null or e.codigo = any (select upper(x) from unnest(p_equipos) x));
  get diagnostics n = row_count;
  insert into agente_eventos (equipo_id, tipo, detalle, actor)
  select a.equipo_id, 'suspension', jsonb_build_object('minutos', p_minutos, 'motivo', 'bloqueo'), v
    from agentes a join equipos e on e.id = a.equipo_id
   where a.suspension_motivo = 'bloqueo' and a.suspendido_desde = now();
  return n;
end $$;

create or replace function _faro_reanudar(p_equipo uuid, p_via text, p_actor uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a agentes;
begin
  select * into a from agentes where equipo_id = p_equipo;
  update agentes set suspendido_desde = null, suspendido_hasta = null, suspension_motivo = null, qr_desbloqueo = null
   where equipo_id = p_equipo;
  -- Lo que motivó la suspensión por anuncio queda como leído.
  insert into faro_anuncio_lecturas (anuncio_id, equipo_id)
  select f.id, p_equipo from faro_anuncios f join equipos e on e.id = p_equipo
   where f.obligatorio and f.hasta > now() and (f.equipos is null or e.codigo = any (f.equipos))
  on conflict do nothing;
  insert into agente_eventos (equipo_id, tipo, detalle, actor) values (p_equipo, 'reanudado', jsonb_build_object('via', p_via), p_actor);
end $$;

create or replace function faro_reanudar(p_equipos text[]) returns int
language plpgsql security definer set search_path = public as $$
declare v uuid := _faro_staff(); e equipos; n int := 0;
begin
  for e in select * from equipos where p_equipos is null or codigo = any (select upper(x) from unnest(p_equipos) x) loop
    perform _faro_reanudar(e.id, 'panel', v);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ===================================================================== C. Claves temporales
create or replace function faro_clave_temporal(p_equipo text default null, p_minutos int default 30) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := _faro_staff(); c text := _codigo_corto(); s text := replace(gen_random_uuid()::text, '-', ''); e uuid; h timestamptz;
begin
  if p_minutos is null or p_minutos < 5 or p_minutos > 480 then raise exception 'La clave temporal dura entre 5 minutos y 8 horas.'; end if;
  if p_equipo is not null then
    select id into e from equipos where codigo = upper(p_equipo);
    if e is null then raise exception 'No existe el equipo %.', p_equipo; end if;
  end if;
  h := now() + make_interval(mins => p_minutos);
  insert into faro_claves_temporales (equipo_id, sal, hash, hasta, creado_por) values (e, s, _faro_hash_clave(s, c, _faro_iter_corto()), h, v);
  insert into consola_registro (actor, comando, ok, resultado)
  values (v, 'Clave temporal de Faro' || coalesce(' para ' || upper(p_equipo), ' para toda la sala'), true, 'Vence ' || _fmt(h));
  return jsonb_build_object('clave', substr(c, 1, 4) || '-' || substr(c, 5), 'hasta', h);
end $$;

-- ===================================================================== B. Desbloquear con la reserva
-- Desde la app, con el QR de un solo uso de la pantalla suspendida.
create or replace function desbloquear_con_qr(p_equipo text, p_codigo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); e equipos; a agentes; r reservas;
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
  select * into r from reservas
   where equipo_id = e.id and tipo = 'reserva' and estado = 'activa' and liberada_en is null and inicio <= now() and fin > now()
   order by inicio desc limit 1;
  -- Si hay una reserva vigente, solo su titular (protege su sesión). Sin reserva, quien escanea frente al
  -- equipo con su cuenta (queda registrado).
  if not es_staff() and r.id is not null and r.usuario_id <> v then
    raise exception 'Solo quien tiene la reserva de % puede desbloquearlo. Si lo necesita, pida ayuda al personal.', e.codigo;
  end if;
  perform _faro_reanudar(e.id, 'qr', v);
  return jsonb_build_object('ok', true, 'texto', e.codigo || ' quedó desbloqueado. Ya puede seguir trabajando.');
end $$;

-- ===================================================================== D. Faro: confirmar anuncio y reanudar
-- Se agrega a faro_accion: 'leido' (anuncio obligatorio confirmado) y 'reanudar' (código de la reserva, clave
-- temporal o clave de emergencia, que Faro ya verificó; el servidor lo verifica de nuevo).
do $$ begin
  if not exists (select 1 from pg_proc where proname = '_faro_accion_0025') then
    alter function faro_accion(text, text, jsonb) rename to _faro_accion_0025;
  end if;
end $$;
revoke execute on function _faro_accion_0025(text, text, jsonb) from public, anon, authenticated;

create or replace function faro_accion(p_token text, p_accion text, p_datos jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a agentes; e equipos; r reservas; c text := upper(regexp_replace(coalesce(p_datos ->> 'codigo', ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if p_accion not in ('leido', 'reanudar') then return _faro_accion_0025(p_token, p_accion, p_datos); end if;
  select * into a from agentes where token_hash = _faro_hash_token(p_token) and token_hash is not null;
  if not found then raise exception 'Faro no está vinculado a ningún equipo.' using errcode = '28000'; end if;
  select * into e from equipos where id = a.equipo_id;
  if p_accion = 'leido' then
    insert into faro_anuncio_lecturas (anuncio_id, equipo_id)
    select f.id, e.id from faro_anuncios f where f.id = (p_datos ->> 'anuncio')::bigint and f.obligatorio
    on conflict do nothing;
    return jsonb_build_object('ok', true, 'texto', 'Gracias.');
  end if;
  select * into r from reservas
   where equipo_id = e.id and tipo = 'reserva' and estado = 'activa' and liberada_en is null and inicio <= now() and fin > now()
   order by inicio desc limit 1;
  if (r.id is not null and c = r.codigo_desbloqueo)
     or exists (select 1 from faro_clave fc where fc.hash is not null and fc.hash = _faro_hash_clave(fc.sal, c, fc.iteraciones))
     or exists (select 1 from faro_claves_temporales k where k.hasta > now() and (k.equipo_id is null or k.equipo_id = e.id)
                   and k.hash = _faro_hash_clave(k.sal, c, _faro_iter_corto())) then
    perform _faro_reanudar(e.id, p_datos ->> 'via', null);
    return jsonb_build_object('ok', true, 'texto', e.codigo || ' quedó desbloqueado.');
  end if;
  raise exception 'Ese código no desbloquea este equipo.';
end $$;
revoke execute on function faro_accion(text, text, jsonb) from public;
grant execute on function faro_accion(text, text, jsonb) to anon, authenticated;

-- Con la clave de emergencia (o una temporal) en la pantalla, Faro avisa con el evento desbloqueo_emergencia:
-- eso también quita la suspensión en el servidor.
do $$ begin
  if not exists (select 1 from pg_proc where proname = '_faro_evento_0007') then
    alter function faro_evento(text, text, jsonb) rename to _faro_evento_0007;
  end if;
end $$;
revoke execute on function _faro_evento_0007(text, text, jsonb) from public, anon, authenticated;

create or replace function faro_evento(p_token text, p_tipo text, p_detalle jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare a agentes;
begin
  perform _faro_evento_0007(p_token, p_tipo, p_detalle);
  if p_tipo = 'desbloqueo_emergencia' then
    select * into a from agentes where token_hash = _faro_hash_token(p_token) and token_hash is not null;
    if a.suspendido_desde is not null then perform _faro_reanudar(a.equipo_id, coalesce(p_detalle ->> 'via', 'emergencia'), null); end if;
  end if;
end $$;
revoke execute on function faro_evento(text, text, jsonb) from public;
grant execute on function faro_evento(text, text, jsonb) to anon, authenticated;

-- ===================================================================== Respuesta de Faro
do $$ begin
  if not exists (select 1 from pg_proc where proname = '_faro_estado_0025') then
    alter function faro_estado(text, jsonb) rename to _faro_estado_0025;
  end if;
end $$;
revoke execute on function _faro_estado_0025(text, jsonb) from public, anon, authenticated;

create or replace function faro_estado(p_token text, p_info jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v jsonb; a agentes; e equipos; r reservas; f faro_anuncios; v_leido boolean; v_min int := coalesce(politica_int('faro_suspension_min'), 10);
  v_susp jsonb; v_hasta timestamptz;
begin
  v := _faro_estado_0025(p_token, p_info);
  select * into a from agentes where token_hash = _faro_hash_token(p_token) and token_hash is not null;
  select * into e from equipos where id = a.equipo_id;

  -- Anuncio vigente para este equipo: primero uno obligatorio sin confirmar; si no, el más reciente.
  select * into f from faro_anuncios x
   where x.hasta > now() and (x.equipos is null or e.codigo = any (x.equipos))
   order by (x.obligatorio and not exists (select 1 from faro_anuncio_lecturas l where l.anuncio_id = x.id and l.equipo_id = e.id)) desc,
            x.creado_en desc
   limit 1;
  if f.id is not null then
    v_leido := exists (select 1 from faro_anuncio_lecturas l where l.anuncio_id = f.id and l.equipo_id = e.id);
    v := jsonb_set(v, '{anuncio}', coalesce(v -> 'anuncio', '{}'::jsonb)
           || jsonb_build_object('id', f.id, 'texto', f.texto, 'hasta', f.hasta, 'obligatorio', f.obligatorio, 'leido', v_leido));
  end if;

  -- Suspensión: «bloquear ya» del personal, o un anuncio obligatorio sin confirmar después de v_min minutos.
  if a.suspendido_hasta is not null and a.suspendido_hasta <= now() then
    update agentes set suspendido_desde = null, suspendido_hasta = null, suspension_motivo = null where equipo_id = a.equipo_id;
    a.suspendido_desde := null;
  end if;
  if a.suspendido_desde is not null then
    v_susp := jsonb_build_object('desde', a.suspendido_desde, 'hasta', a.suspendido_hasta, 'motivo', a.suspension_motivo);
  elsif f.id is not null and f.obligatorio and not v_leido and v_min > 0 and f.creado_en + make_interval(mins => v_min) <= now() then
    v_susp := jsonb_build_object('desde', f.creado_en + make_interval(mins => v_min), 'hasta', f.hasta, 'motivo', 'anuncio', 'texto', f.texto);
  end if;
  if v_susp is not null then
    -- QR de un solo uso: cambia cada minuto mientras dure la suspensión.
    if a.qr_desbloqueo is null or a.qr_desbloqueo_en < now() - interval '1 minute' then
      update agentes set qr_desbloqueo = replace(gen_random_uuid()::text, '-', ''), qr_desbloqueo_en = now()
       where equipo_id = a.equipo_id returning * into a;
    end if;
    v := v || jsonb_build_object('suspension', v_susp || jsonb_build_object('qr', a.qr_desbloqueo));
  end if;

  -- Código de la reserva vigente, cifrado: Faro lo verifica aunque no haya red.
  select * into r from reservas
   where equipo_id = e.id and tipo = 'reserva' and estado = 'activa' and liberada_en is null and inicio <= now() and fin > now()
   order by inicio desc limit 1;
  if r.codigo_desbloqueo is not null and jsonb_typeof(v -> 'actual') = 'object' then
    v := jsonb_set(v, '{actual,desbloqueo}', jsonb_build_object('sal', r.id::text, 'hash', _faro_hash_clave(r.id::text, r.codigo_desbloqueo, _faro_iter_corto()),
                                                                'iteraciones', _faro_iter_corto()));
  end if;

  -- Claves temporales del personal vigentes para este equipo.
  v := v || jsonb_build_object('claves_temporales', coalesce((
         select jsonb_agg(jsonb_build_object('sal', k.sal, 'hash', k.hash, 'iteraciones', _faro_iter_corto(), 'hasta', k.hasta))
           from faro_claves_temporales k where k.hasta > now() and (k.equipo_id is null or k.equipo_id = e.id)), '[]'::jsonb));
  return v;
end $$;
grant execute on function faro_estado(text, jsonb) to anon, authenticated;

-- ===================================================================== Panel del personal
-- Suspensión vigente por equipo y, en cada anuncio obligatorio, cuántos equipos ya lo confirmaron.
do $$ begin
  if not exists (select 1 from pg_proc where proname = '_faro_panel_0008') then
    alter function faro_panel() rename to _faro_panel_0008;
  end if;
end $$;
revoke execute on function _faro_panel_0008() from public, anon, authenticated;

create or replace function faro_panel() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb := _faro_panel_0008();
begin
  v := jsonb_set(v, '{equipos}', coalesce((
         select jsonb_agg(x || jsonb_build_object(
                  'suspendido_hasta', (select a.suspendido_hasta from agentes a join equipos e on e.id = a.equipo_id
                                        where e.codigo = x ->> 'codigo' and a.suspendido_desde is not null and a.suspendido_hasta > now()))
                order by o)
           from jsonb_array_elements(v -> 'equipos') with ordinality t(x, o)), '[]'::jsonb));
  v := jsonb_set(v, '{anuncios}', coalesce((
         select jsonb_agg(x || jsonb_build_object(
                  'obligatorio', f.obligatorio,
                  'confirmados', (select count(*) from faro_anuncio_lecturas l where l.anuncio_id = f.id))
                order by o)
           from jsonb_array_elements(v -> 'anuncios') with ordinality t(x, o) join faro_anuncios f on f.id = (x ->> 'id')::bigint), '[]'::jsonb));
  return v;
end $$;
revoke execute on function faro_panel() from public, anon;
grant execute on function faro_panel() to authenticated;

-- ===================================================================== Anuncio obligatorio
create or replace function faro_anunciar(p_texto text, p_minutos int, p_equipos text[] default null, p_obligatorio boolean default false) returns bigint
language plpgsql security definer set search_path = public as $$
declare v uuid := _faro_staff(); v_id bigint; begin
  if p_minutos is null or p_minutos < 1 or p_minutos > 1440 then raise exception 'El anuncio dura entre 1 minuto y 24 horas.'; end if;
  insert into faro_anuncios (texto, equipos, hasta, creado_por, obligatorio)
  values (trim(p_texto), (select array_agg(upper(x)) from unnest(p_equipos) x), now() + make_interval(mins => p_minutos), v, coalesce(p_obligatorio, false))
  returning id into v_id;
  return v_id;
end $$;
drop function if exists faro_anunciar(text, int, text[]);

revoke execute on function faro_suspender(text[], int), faro_reanudar(text[]), faro_clave_temporal(text, int), desbloquear_con_qr(text, text),
  faro_anunciar(text, int, text[], boolean) from public, anon;
grant execute on function faro_suspender(text[], int), faro_reanudar(text[]), faro_clave_temporal(text, int), desbloquear_con_qr(text, text),
  faro_anunciar(text, int, text[], boolean) to authenticated;
revoke execute on function _faro_reanudar(uuid, text, uuid), _codigo_corto() from public, anon, authenticated;

commit;
