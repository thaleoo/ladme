-- =============================================================================
-- LADME · Migración 0008 · Faro: gestión remota, inventario, llegada por QR y sala
-- -----------------------------------------------------------------------------
-- Ejecutar en Supabase → SQL Editor, después de 0007. Es idempotente.
--
-- A. Llegada: política llegada_modo (0 = la persona desde la app, 1 = solo el
--    personal, 2 = la persona escaneando el QR de la isla o el personal). El QR de
--    la isla cambia cada 30 s y solo sirve a quien tiene la reserva de ESE equipo.
-- B. Órdenes remotas a Faro (reiniciar, actualizar, apagar, encender, desinstalar)
--    y anuncios en las islas.
-- C. Inventario y salud que informa Faro (procesador, RAM, disco, software); el
--    software se copia a equipos.software para filtrar al reservar.
-- D. Proceso desatendido verificado y liberación por no presentarse (desactivada
--    por defecto: política liberar_no_show_min).
-- E. Lista de espera, plano de la sala (público, sin datos personales), canal de
--    pruebas de Faro y reporte mensual para el personal.
-- =============================================================================

begin;

insert into politicas (clave, valor, descripcion) values
  ('llegada_modo', '1', 'Quién registra la llegada: 0 = la persona desde la app; 1 = solo el personal (y Faro si la llegada automática está activa); 2 = la persona con el QR de la isla del equipo, o el personal.'),
  ('liberar_no_show_min', '0', 'Minutos tras el inicio de una reserva sin llegada ni uso del PC (medido por Faro) para liberarla sola. 0 = desactivado.'),
  ('faro_sesion_limpia', '1', 'Faro ofrece borrar los archivos que la persona dejó en Descargas y Escritorio al terminar: 1 = sí, 0 = no.')
on conflict (clave) do nothing;

-- ---------------------------------------------------------------- COLUMNAS
alter table agentes add column if not exists qr_secreto text;
alter table agentes add column if not exists inventario jsonb;
alter table agentes add column if not exists inventario_en timestamptz;
alter table agentes add column if not exists cpu_pct int;
alter table agentes add column if not exists ultimo_uso_en timestamptz;
alter table agentes add column if not exists canal text not null default 'estable';
alter table agentes add column if not exists aviso_desatendido_reserva uuid;
alter table agentes drop constraint if exists agentes_canal_check;
alter table agentes add constraint agentes_canal_check check (canal in ('estable', 'pruebas'));
update agentes set qr_secreto = replace(gen_random_uuid()::text, '-', '') where qr_secreto is null;
-- Los equipos que se vinculen después también reciben su secreto.
alter table agentes alter column qr_secreto set default replace(gen_random_uuid()::text, '-', '');
alter table agentes alter column qr_secreto set not null;

alter table equipos add column if not exists software text[] not null default '{}';
alter table equipos add column if not exists plano_x int check (plano_x between 1 and 30);
alter table equipos add column if not exists plano_y int check (plano_y between 1 and 30);

alter table agente_eventos drop constraint if exists agente_eventos_tipo_check;
alter table agente_eventos add constraint agente_eventos_tipo_check check (tipo in (
  'vinculado', 'desvinculado', 'inicio', 'uso_sin_reserva', 'llegada_detectada', 'bloqueo', 'desbloqueo',
  'desbloqueo_personal', 'desbloqueo_emergencia', 'cierre_intentado', 'modo', 'cierre_forzado', 'actualizado',
  'clase_inicio', 'clase_fin', 'llegada_qr', 'comando', 'retirado'));

-- ---------------------------------------------------------------- TABLAS
create table if not exists agente_comandos (
  id             bigint generated always as identity primary key,
  equipo_id      uuid not null references equipos (id),
  tipo           text not null check (tipo in ('reiniciar', 'actualizar', 'apagar', 'despertar', 'desinstalar')),
  datos          jsonb not null default '{}'::jsonb,
  creado_por     uuid references perfiles (id),
  creado_en      timestamptz not null default now(),
  entregado_en   timestamptz,
  completado_en  timestamptz,
  ok             boolean,
  resultado      text
);
create index if not exists agente_comandos_pendientes_idx on agente_comandos (equipo_id) where entregado_en is null;

create table if not exists faro_anuncios (
  id          bigint generated always as identity primary key,
  texto       text not null check (char_length(texto) between 3 and 160),
  equipos     text[],                       -- null = toda la sala
  hasta       timestamptz not null,
  creado_por  uuid references perfiles (id),
  creado_en   timestamptz not null default now()
);

create table if not exists lista_espera (
  id              bigint generated always as identity primary key,
  usuario_id      uuid not null references perfiles (id),
  software        text,
  creado_en       timestamptz not null default now(),
  vence           timestamptz not null default now() + interval '3 hours',
  avisado_en      timestamptz,
  equipo_avisado  uuid references equipos (id)
);
create unique index if not exists lista_espera_una_por_persona on lista_espera (usuario_id) where avisado_en is null;

alter table agente_comandos enable row level security;
alter table faro_anuncios enable row level security;
alter table lista_espera enable row level security;
revoke all on agente_comandos, faro_anuncios, lista_espera from public, anon, authenticated;
grant select on lista_espera to authenticated;
drop policy if exists lista_espera_propia on lista_espera;
create policy lista_espera_propia on lista_espera for select to authenticated using (usuario_id = auth.uid());

-- ---------------------------------------------------------------- A. LLEGADA
-- Código del QR de llegada: cambia cada 30 s; lo calcula Faro con el mismo secreto.
create or replace function _faro_codigo_llegada(p_secreto text, p_equipo text, p_ventana bigint) returns text
language sql immutable as $$
  select left(encode(sha256(convert_to(p_secreto || ':' || p_equipo || ':' || p_ventana, 'UTF8')), 'hex'), 10) $$;

-- La persona solo puede registrar su llegada desde la app si la política lo permite.
create or replace function registrar_llegada(p_reserva uuid) returns reservas
language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); v_res reservas; begin
  select * into v_res from reservas where id = p_reserva and tipo = 'reserva' for update;
  if not found or (v_res.usuario_id <> v and not es_staff()) then raise exception 'Reserva no encontrada.'; end if;
  if not es_staff() then
    case coalesce(politica_int('llegada_modo'), 0)
      when 1 then raise exception 'La llegada la registra el personal del laboratorio: muestre su pase.';
      when 2 then raise exception 'Para registrar la llegada, escanee el QR que muestra la isla del equipo.';
      else null;
    end case;
  end if;
  if v_res.estado <> 'activa' or v_res.fin <= now() then raise exception 'La reserva ya terminó o está cancelada.'; end if;
  if v_res.inicio > now() + interval '15 minutes' then raise exception 'La reserva aún no comienza.'; end if;
  update reservas set llegada_en = coalesce(llegada_en, now()) where id = p_reserva returning * into v_res;
  return v_res;
end $$;

-- Llegada con el QR de la isla. Solo registra la reserva DE QUIEN ESCANEA en ESE equipo:
-- si otra persona lo escanea, no pasa nada con la reserva ajena. El código vale ~1 minuto.
create or replace function registrar_llegada_pc(p_equipo text, p_codigo text) returns reservas
language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); v_eq equipos; a agentes; r reservas;
        v_vent bigint := floor(extract(epoch from now()) / 30)::bigint; v_cod text := lower(trim(coalesce(p_codigo, ''))); begin
  if coalesce(politica_int('llegada_modo'), 0) = 1 and not es_staff() then
    raise exception 'Por ahora la llegada la registra el personal del laboratorio: muestre su pase.';
  end if;
  select * into v_eq from equipos where codigo = upper(trim(p_equipo)) and not archivado;
  if not found then raise exception 'Equipo no encontrado.'; end if;
  select * into a from agentes where equipo_id = v_eq.id and token_hash is not null;
  if not found or a.qr_secreto is null then raise exception 'Este equipo no tiene Faro activo.'; end if;
  if v_cod not in (_faro_codigo_llegada(a.qr_secreto, v_eq.codigo, v_vent),
                   _faro_codigo_llegada(a.qr_secreto, v_eq.codigo, v_vent - 1),
                   _faro_codigo_llegada(a.qr_secreto, v_eq.codigo, v_vent + 1)) then
    raise exception 'El código del QR venció. Vuelva a escanear el que muestra la isla ahora.';
  end if;
  select * into r from reservas
   where equipo_id = v_eq.id and usuario_id = v and tipo = 'reserva' and estado = 'activa' and liberada_en is null
     and inicio <= now() + interval '15 minutes' and fin > now()
   order by inicio limit 1 for update;
  if not found then
    raise exception 'No tiene una reserva vigente en %. Solo quien reservó el equipo puede registrar su llegada.', v_eq.codigo;
  end if;
  update reservas set llegada_en = coalesce(llegada_en, now()) where id = r.id returning * into r;
  insert into agente_eventos (equipo_id, tipo, detalle) values (v_eq.id, 'llegada_qr', jsonb_build_object('reserva', r.codigo_legible));
  return r;
end $$;

-- ---------------------------------------------------------------- B. ÓRDENES Y ANUNCIOS
-- Encola una orden para uno, varios o todos los equipos vinculados (p_equipos null).
--   reiniciar · actualizar · apagar (se omiten los que tienen una reserva en curso)
--   encender  (Wake-on-LAN: un Faro encendido de la sala despierta a los apagados)
--   desinstalar (solo administradores)
create or replace function faro_comando(p_equipos text[], p_tipo text) returns int
language plpgsql security definer set search_path = public as $$
declare v uuid := _faro_staff(); n int := 0; r record; v_ayudante uuid; v_macs jsonb := '[]'::jsonb; begin
  if p_tipo not in ('reiniciar', 'actualizar', 'apagar', 'encender', 'desinstalar') then raise exception 'Orden no válida.'; end if;
  if p_tipo = 'desinstalar' and not es_admin() then
    raise exception 'Solo un administrador puede desinstalar Faro.' using errcode = '42501';
  end if;
  if p_tipo = 'encender' then
    for r in
      select e.id, a.inventario ->> 'mac' as mac from agentes a join equipos e on e.id = a.equipo_id
       where a.token_hash is not null and not e.archivado
         and (p_equipos is null or e.codigo = any (select upper(x) from unnest(p_equipos) x))
         and coalesce(a.ultimo_latido, '-infinity') < now() - interval '2 minutes'
         and a.inventario ->> 'mac' is not null
    loop
      v_macs := v_macs || to_jsonb(r.mac);
      n := n + 1;
    end loop;
    if n = 0 then return 0; end if;
    select a.equipo_id into v_ayudante from agentes a
     where a.token_hash is not null and a.ultimo_latido > now() - interval '2 minutes'
     order by a.ultimo_latido desc limit 1;
    if v_ayudante is null then
      raise exception 'No hay ningún equipo encendido con Faro que pueda despertar a los demás.';
    end if;
    insert into agente_comandos (equipo_id, tipo, datos, creado_por)
    values (v_ayudante, 'despertar', jsonb_build_object('macs', v_macs), v);
    return n;
  end if;
  for r in
    select e.id, e.codigo from agentes a join equipos e on e.id = a.equipo_id
     where a.token_hash is not null and not e.archivado
       and (p_equipos is null or e.codigo = any (select upper(x) from unnest(p_equipos) x))
  loop
    if p_tipo = 'apagar' and exists (select 1 from reservas x where x.equipo_id = r.id and x.estado = 'activa'
                                      and x.liberada_en is null and x.inicio <= now() and x.fin > now()) then
      continue;
    end if;
    insert into agente_comandos (equipo_id, tipo, creado_por) values (r.id, p_tipo, v);
    insert into agente_eventos (equipo_id, tipo, detalle, actor) values (r.id, 'comando', jsonb_build_object('orden', p_tipo), v);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function faro_comando_resultado(p_token text, p_id bigint, p_ok boolean, p_resultado text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a agentes; c agente_comandos; begin
  select * into a from agentes where token_hash = _faro_hash_token(p_token) and token_hash is not null;
  if not found then raise exception 'Faro no está vinculado a ningún equipo.' using errcode = '28000'; end if;
  update agente_comandos set completado_en = now(), ok = p_ok, resultado = left(p_resultado, 300)
   where id = p_id and equipo_id = a.equipo_id returning * into c;
  if c.tipo = 'desinstalar' and p_ok then
    update agentes set token_hash = null, vinculado_en = null where equipo_id = a.equipo_id;
    insert into agente_eventos (equipo_id, tipo, detalle) values (a.equipo_id, 'retirado', jsonb_build_object('por', 'orden del panel'));
  end if;
end $$;

create or replace function faro_anunciar(p_texto text, p_minutos int, p_equipos text[] default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare v uuid := _faro_staff(); v_id bigint; begin
  if p_minutos is null or p_minutos < 1 or p_minutos > 1440 then raise exception 'El anuncio dura entre 1 minuto y 24 horas.'; end if;
  insert into faro_anuncios (texto, equipos, hasta, creado_por)
  values (trim(p_texto), (select array_agg(upper(x)) from unnest(p_equipos) x), now() + make_interval(mins => p_minutos), v)
  returning id into v_id;
  return v_id;
end $$;

create or replace function faro_quitar_anuncio(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _faro_staff();
  update faro_anuncios set hasta = now() where id = p_id;
end $$;

create or replace function faro_canal(p_equipos text[], p_canal text) returns int
language plpgsql security definer set search_path = public as $$
declare n int; begin
  perform _faro_staff();
  if p_canal not in ('estable', 'pruebas') then raise exception 'Canal no válido.'; end if;
  update agentes a set canal = p_canal from equipos e
   where e.id = a.equipo_id and (p_equipos is null or e.codigo = any (select upper(x) from unnest(p_equipos) x));
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- C/D. LATIDO DE FARO
-- p_info: { inactivo_seg, bloqueado, host, so, version, cpu, inventario? }
-- inventario (cada pocas horas): { cpu, nucleos, ram_gb, disco_gb, disco_libre_gb, mac, so_tipo, so_version, software: [] }
create or replace function faro_estado(p_token text, p_info jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a agentes; v_eq equipos; r reservas; s reservas; v_titular text; c faro_clave;
  v_inact int := case when p_info ->> 'inactivo_seg' ~ '^\d{1,9}$' then (p_info ->> 'inactivo_seg')::int end;
  v_cpu int := case when p_info ->> 'cpu' ~ '^\d{1,3}$' then least((p_info ->> 'cpu')::int, 100) end;
  v_inv jsonb := case when jsonb_typeof(p_info -> 'inventario') = 'object' then p_info -> 'inventario' end;
  v_en_uso boolean; v_delta int; v_libre boolean; v_comandos jsonb; v_anuncio jsonb; v_pct numeric;
begin
  select * into a from agentes where token_hash = _faro_hash_token(p_token) and token_hash is not null for update;
  if not found then raise exception 'Faro no está vinculado a ningún equipo.' using errcode = '28000'; end if;
  v_en_uso := v_inact is not null and v_inact < 120;
  -- Tiempo desde el latido anterior (máximo 2 min: si Faro estuvo apagado, eso no cuenta).
  v_delta := least(greatest(extract(epoch from now() - coalesce(a.ultimo_latido, now()))::int, 0), 120);
  update agentes set ultimo_latido = now(), inactivo_seg = v_inact, cpu_pct = v_cpu,
                     ultimo_uso_en = case when v_en_uso then now() else ultimo_uso_en end,
                     bloqueado = coalesce(p_info ->> 'bloqueado' = 'true', false),
                     host = coalesce(left(p_info ->> 'host', 80), host), so = coalesce(left(p_info ->> 'so', 80), so),
                     version = coalesce(left(p_info ->> 'version', 20), version),
                     qr_secreto = coalesce(qr_secreto, replace(gen_random_uuid()::text, '-', '')),
                     inventario = coalesce(v_inv, inventario),
                     inventario_en = case when v_inv is not null then now() else inventario_en end
   where equipo_id = a.equipo_id
   returning * into a;
  select * into v_eq from equipos where id = a.equipo_id;

  -- Inventario: software para filtrar al reservar, sistema operativo si falta, alerta de disco.
  if v_inv is not null then
    update equipos set
      software = coalesce((select array_agg(distinct left(x, 40)) from jsonb_array_elements_text(coalesce(v_inv -> 'software', '[]')) x), '{}'),
      sistema_operativo = coalesce(sistema_operativo, case when v_inv ->> 'so_tipo' in ('Windows', 'Linux', 'macOS') then v_inv ->> 'so_tipo' end),
      so_version = coalesce(so_version, left(v_inv ->> 'so_version', 60))
     where id = v_eq.id;
    v_pct := case when (v_inv ->> 'disco_gb') ~ '^[0-9.]+$' and (v_inv ->> 'disco_libre_gb') ~ '^[0-9.]+$'
                       and (v_inv ->> 'disco_gb')::numeric > 0
                  then (v_inv ->> 'disco_libre_gb')::numeric * 100 / (v_inv ->> 'disco_gb')::numeric end;
    if v_pct is not null and v_pct < 10 then
      perform _avisar_chat('faro_disco', 'faro_disco:' || v_eq.codigo || ':' || to_char(now() at time zone 'America/Bogota', 'YYYY-MM-DD'),
                           v_eq.codigo || ' tiene el disco casi lleno (' || round(v_pct) || ' % libre).', '/admin?tab=faro');
    end if;
  end if;

  select * into r from reservas
   where equipo_id = v_eq.id and estado = 'activa' and liberada_en is null and inicio <= now() and fin > now()
   order by inicio desc limit 1;
  select * into s from reservas
   where equipo_id = v_eq.id and estado = 'activa' and liberada_en is null and inicio > now() and inicio < now() + interval '24 hours'
   order by inicio limit 1;
  v_libre := coalesce(a.desbloqueo_hasta, '-infinity') > now();

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
    -- Proceso desatendido que parece haber terminado: 30 min sin uso y casi sin carga.
    if r.desatendido and coalesce(v_inact, 0) > 1800 and v_cpu is not null and v_cpu < 5
       and a.aviso_desatendido_reserva is distinct from r.id then
      update agentes set aviso_desatendido_reserva = r.id where equipo_id = a.equipo_id;
      perform _avisar(r.usuario_id, 'desatendido_inactivo', 'desatendido_inactivo:' || r.id,
                      'Tu proceso en ' || v_eq.codigo || ' parece haber terminado',
                      'El equipo lleva más de 30 minutos sin uso y casi sin carga. Si ya terminó, libéralo para que otra persona lo use.',
                      '/equipo/' || v_eq.codigo || '?accion=liberar', r.id);
    end if;
  end if;

  if r.id is null and v_en_uso and not v_libre
     and coalesce(a.ultimo_uso_sin_reserva, '-infinity') < now() - interval '30 minutes' then
    update agentes set ultimo_uso_sin_reserva = now() where equipo_id = a.equipo_id;
    insert into agente_eventos (equipo_id, tipo, detalle) values (v_eq.id, 'uso_sin_reserva', jsonb_build_object('modo', a.modo));
  end if;

  -- Órdenes pendientes: se entregan una vez.
  with p as (
    update agente_comandos set entregado_en = now()
     where equipo_id = a.equipo_id and entregado_en is null and creado_en > now() - interval '1 day'
    returning id, tipo, datos
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'tipo', tipo, 'datos', datos) order by id), '[]'::jsonb) into v_comandos from p;

  select jsonb_build_object('id', x.id, 'texto', x.texto, 'hasta', x.hasta) into v_anuncio
    from faro_anuncios x
   where x.hasta > now() and (x.equipos is null or v_eq.codigo = any (x.equipos))
   order by x.creado_en desc limit 1;

  select * into c from faro_clave;
  return jsonb_build_object(
    'ahora', now(),
    'equipo', jsonb_build_object('codigo', v_eq.codigo, 'nombre', v_eq.nombre,
                                 'estado', case when v_eq.archivado then 'fuera_de_servicio' else v_eq.estado::text end,
                                 'sistema', concat_ws(' ', v_eq.sistema_operativo, v_eq.so_version)),
    'modo', a.modo,
    'canal', a.canal,
    'desbloqueo_hasta', case when v_libre then a.desbloqueo_hasta end,
    'actual', case when r.id is not null then jsonb_build_object(
                'tipo', r.tipo, 'inicio', r.inicio, 'fin', r.fin, 'titular', v_titular,
                'desatendido', r.desatendido, 'mensaje', r.mensaje_llegada,
                'motivo', case when r.tipo = 'bloqueo' then r.motivo end,
                'llegada', r.llegada_en is not null) end,
    'siguiente', case when s.id is not null then jsonb_build_object('tipo', s.tipo, 'inicio', s.inicio, 'fin', s.fin) end,
    'politicas', jsonb_build_object('aviso_min', coalesce(politica_int('faro_aviso_min'), 10),
                                    'gracia_min', coalesce(politica_int('faro_gracia_min'), 3),
                                    'desatendido_min', coalesce(politica_int('faro_desatendido_min'), 10),
                                    'llegada_modo', coalesce(politica_int('llegada_modo'), 0),
                                    'sesion_limpia', coalesce(politica_int('faro_sesion_limpia'), 1)),
    'clave', case when c.hash is not null then jsonb_build_object('sal', c.sal, 'hash', c.hash, 'iteraciones', c.iteraciones) end,
    'qr', jsonb_build_object('secreto', a.qr_secreto),
    'comandos', v_comandos,
    'anuncio', v_anuncio
  );
end $$;

-- Liberación por no presentarse (solo si la política está activa y Faro lo puede medir):
-- el PC tiene Faro encendido y nadie lo ha usado desde que empezó la reserva.
create or replace function liberar_no_show() returns int
language plpgsql security definer set search_path = public as $$
declare v_min int := coalesce(politica_int('liberar_no_show_min'), 0); n int := 0; r record; begin
  if v_min <= 0 then return 0; end if;
  for r in
    select x.id, x.usuario_id, e.codigo from reservas x
      join equipos e on e.id = x.equipo_id join agentes a on a.equipo_id = e.id
     where x.tipo = 'reserva' and x.estado = 'activa' and x.llegada_en is null and x.liberada_en is null
       and x.inicio < now() - make_interval(mins => v_min) and x.fin > now()
       and a.token_hash is not null and a.ultimo_latido > now() - interval '5 minutes'
       and coalesce(a.ultimo_uso_en, '-infinity') < x.inicio
  loop
    update reservas set fin = now(), liberada_en = now() where id = r.id;
    perform _avisar(r.usuario_id, 'no_show_liberada', 'no_show_liberada:' || r.id,
                    'Liberamos tu reserva de ' || r.codigo,
                    'Pasaron ' || v_min || ' minutos sin que nadie usara el equipo, así que quedó disponible para otra persona.',
                    '/mis-reservas', r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- E. LISTA DE ESPERA
create or replace function unirse_espera(p_software text default null) returns lista_espera
language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); l lista_espera; begin
  delete from lista_espera where usuario_id = v and avisado_en is null;
  insert into lista_espera (usuario_id, software) values (v, nullif(trim(p_software), '')) returning * into l;
  return l;
end $$;

create or replace function salir_espera() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from lista_espera where usuario_id = _perfil_activo() and avisado_en is null;
end $$;

-- Para cada persona en espera (en orden de llegada), busca un equipo libre la próxima hora.
create or replace function encolar_avisos_espera() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; l record; v_eq equipos; begin
  for l in select * from lista_espera where avisado_en is null and vence > now() order by creado_en loop
    select e.* into v_eq from equipos e
     where not e.archivado and e.estado = 'activo'
       and (l.software is null or l.software = any (e.software))
       and not exists (select 1 from reservas x where x.equipo_id = e.id and x.estado = 'activa' and x.liberada_en is null
                        and x.periodo && tstzrange(now(), now() + interval '1 hour', '[)'))
       and not exists (select 1 from lista_espera o where o.equipo_avisado = e.id and o.avisado_en > now() - interval '10 minutes')
     order by e.codigo limit 1;
    continue when v_eq.id is null;
    update lista_espera set avisado_en = now(), equipo_avisado = v_eq.id where id = l.id;
    perform _avisar(l.usuario_id, 'espera', 'espera:' || l.id, v_eq.codigo || ' está libre ahora',
                    'Estabas en la lista de espera' || coalesce(' para ' || l.software, '') || '. Resérvalo antes de que alguien más lo tome.',
                    '/reservar?equipo=' || v_eq.codigo);
    n := n + 1;
  end loop;
  delete from lista_espera where vence < now() - interval '1 day';
  return n;
end $$;

-- ---------------------------------------------------------------- E. SALA PÚBLICA Y PANEL
-- Para la pantalla de la sala (sin sesión): estado de cada equipo, sin datos personales.
create or replace function sala_publica() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'codigo', e.codigo, 'categoria', e.categoria, 'x', e.plano_x, 'y', e.plano_y,
           'sistema', concat_ws(' ', e.sistema_operativo, e.so_version),
           'estado', case when e.estado <> 'activo' then 'mantenimiento'
                          when act.tipo = 'bloqueo' then 'bloqueado'
                          when act.tipo = 'reserva' then 'ocupado' else 'libre' end,
           'hasta', act.fin,
           'proxima', (select min(x.inicio) from reservas x where x.equipo_id = e.id and x.estado = 'activa'
                         and x.liberada_en is null and x.inicio > now() and x.inicio < now() + interval '6 hours'),
           'faro', a.ultimo_latido > now() - interval '2 minutes')
         order by e.categoria, e.codigo), '[]'::jsonb)
    from equipos e
    left join lateral (select x.tipo, x.fin from reservas x where x.equipo_id = e.id and x.estado = 'activa'
                         and x.liberada_en is null and x.inicio <= now() and x.fin > now() order by x.inicio desc limit 1) act on true
    left join agentes a on a.equipo_id = e.id
   where not e.archivado $$;

-- Panel de Faro con inventario, canal, órdenes pendientes y anuncios.
create or replace function faro_panel() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _faro_staff();
  return jsonb_build_object(
    'ahora', now(),
    'clave_creada_en', (select creada_en from faro_clave),
    'anuncios', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'texto', texto, 'equipos', equipos, 'hasta', hasta) order by creado_en desc)
                            from faro_anuncios where hasta > now()), '[]'::jsonb),
    'equipos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'codigo', e.codigo, 'nombre', e.nombre, 'categoria', e.categoria, 'estado', e.estado,
               'sistema_operativo', e.sistema_operativo, 'software', e.software,
               'vinculado', a.token_hash is not null, 'vinculado_en', a.vinculado_en,
               'codigo_vinculo', case when a.codigo_vence > now() then substr(a.codigo_vinculo, 1, 4) || '-' || substr(a.codigo_vinculo, 5, 4) end,
               'codigo_vence', case when a.codigo_vence > now() then a.codigo_vence end,
               'modo', coalesce(a.modo, 'observar'), 'canal', coalesce(a.canal, 'estable'),
               'ultimo_latido', a.ultimo_latido, 'version', a.version,
               'host', a.host, 'so', a.so, 'inactivo_seg', a.inactivo_seg, 'cpu_pct', a.cpu_pct, 'bloqueado', coalesce(a.bloqueado, false),
               'inventario', a.inventario, 'inventario_en', a.inventario_en,
               'desbloqueo_hasta', case when a.desbloqueo_hasta > now() then a.desbloqueo_hasta end,
               'comandos_pendientes', (select count(*) from agente_comandos c where c.equipo_id = e.id and c.completado_en is null
                                        and c.creado_en > now() - interval '1 day'),
               'usos_sin_reserva_7d', (select count(*) from agente_eventos v
                                        where v.equipo_id = e.id and v.tipo = 'uso_sin_reserva'
                                          and v.creado_en > now() - interval '7 days'))
             order by e.categoria, e.codigo)
        from equipos e left join agentes a on a.equipo_id = e.id
       where not e.archivado), '[]'::jsonb),
    'eventos', coalesce((
      select jsonb_agg(x order by x ->> 'creado_en' desc) from (
        select jsonb_build_object('id', v.id, 'equipo', e.codigo, 'tipo', v.tipo, 'detalle', v.detalle,
                                  'actor', p.nombre, 'creado_en', v.creado_en) x
          from agente_eventos v join equipos e on e.id = v.equipo_id left join perfiles p on p.id = v.actor
         order by v.creado_en desc limit 40) t), '[]'::jsonb)
  );
end $$;

-- Reporte mensual para el personal (lo envía Apps Script el día 1 de cada mes).
create or replace function reporte_mensual(p_desde timestamptz, p_hasta timestamptz) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta,
    'destinatarios', (select coalesce(jsonb_agg(correo), '[]'::jsonb) from perfiles where activo and rol in ('laboratorista', 'administrador')),
    'reservas', (select count(*) from reservas where tipo = 'reserva' and inicio >= p_desde and inicio < p_hasta and estado <> 'cancelada'),
    'personas', (select count(distinct usuario_id) from reservas where tipo = 'reserva' and inicio >= p_desde and inicio < p_hasta and estado <> 'cancelada'),
    'horas_reservadas', (select round(coalesce(sum(extract(epoch from least(fin, p_hasta) - greatest(inicio, p_desde))), 0) / 3600.0, 1)
                           from reservas where tipo = 'reserva' and estado = 'activa' and inicio < p_hasta and fin > p_desde),
    'sin_llegada', (select count(*) from reservas where tipo = 'reserva' and estado = 'activa' and llegada_en is null
                     and inicio >= p_desde and inicio < p_hasta and fin < now()),
    'horas_uso_real', (select round(coalesce(sum(uso_seg), 0) / 3600.0, 1) from faro_uso where hora >= p_desde and hora < p_hasta),
    'horas_sin_reserva', (select round(coalesce(sum(uso_sin_reserva_seg), 0) / 3600.0, 1) from faro_uso where hora >= p_desde and hora < p_hasta),
    'equipos_mas_usados', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select e.codigo, round(sum(extract(epoch from least(x.fin, p_hasta) - greatest(x.inicio, p_desde))) / 3600.0, 1) as horas
          from reservas x join equipos e on e.id = x.equipo_id
         where x.tipo = 'reserva' and x.estado = 'activa' and x.inicio < p_hasta and x.fin > p_desde
         group by e.codigo order by 2 desc limit 5) t),
    'horas_pico', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select extract(hour from hora at time zone 'America/Bogota')::int as hora, round(sum(uso_seg) / 3600.0, 1) as horas
          from faro_uso where hora >= p_desde and hora < p_hasta group by 1 order by 2 desc limit 3) t),
    'reportes', (select count(*) from reportes where creado_en >= p_desde and creado_en < p_hasta),
    'equipos_con_mas_reportes', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select e.codigo, count(*) as reportes from reportes r join equipos e on e.id = r.equipo_id
         where r.creado_en >= p_desde and r.creado_en < p_hasta group by e.codigo order by 2 desc limit 3) t)
  ) $$;

-- ---------------------------------------------------------------- PERMISOS
revoke execute on function _faro_codigo_llegada, registrar_llegada, registrar_llegada_pc, faro_comando, faro_comando_resultado,
                           faro_anunciar, faro_quitar_anuncio, faro_canal, faro_estado, liberar_no_show, unirse_espera,
                           salir_espera, encolar_avisos_espera, sala_publica, faro_panel, reporte_mensual
  from public, anon, authenticated;
grant execute on function registrar_llegada, registrar_llegada_pc, faro_comando, faro_anunciar, faro_quitar_anuncio, faro_canal,
                          unirse_espera, salir_espera, faro_panel to authenticated;
grant execute on function faro_estado, faro_comando_resultado to anon, authenticated;
grant execute on function sala_publica to anon, authenticated;
grant execute on function liberar_no_show, encolar_avisos_espera, reporte_mensual to service_role;

commit;
