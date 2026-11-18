-- =============================================================================
-- LADME · Migración 0006 · Faro, el agente de los computadores de la sala
-- -----------------------------------------------------------------------------
-- Ejecutar en Supabase → SQL Editor, después de 0005. Es idempotente.
--
-- Cada PC de la sala corre Faro: una «isla» arriba de la pantalla que muestra la
-- reserva vigente y, según el modo, avisa o bloquea el equipo cuando nadie lo
-- reservó. Faro no inicia sesión como persona: el personal lo vincula a un
-- equipo con un código de un solo uso y desde entonces se identifica con un
-- token propio (aquí solo se guarda su huella SHA-256).
--
-- Modos, por equipo (Administración → Faro):
--   observar  solo muestra la isla y registra el uso sin reserva (fase 1).
--   avisar    además insiste cuando el equipo se usa sin reserva (fase 2).
--   bloquear  pantalla de bloqueo cuando no hay reserva vigente (fase 3).
--
-- Desbloqueo: lo normal es reservar desde el celular (la pantalla muestra un QR).
-- El personal puede desbloquear un equipo por un rato desde la PWA y, si no hay
-- internet, con la clave de emergencia del laboratorio.
-- =============================================================================

begin;

-- ---------------------------------------------------------------- TABLAS
create table if not exists agentes (
  equipo_id              uuid primary key references equipos (id),
  token_hash             text unique,
  codigo_vinculo         text unique,
  codigo_vence           timestamptz,
  modo                   text not null default 'observar' check (modo in ('observar', 'avisar', 'bloquear')),
  desbloqueo_hasta       timestamptz,
  desbloqueo_por         uuid references perfiles (id),
  host                   text,
  so                     text,
  version                text,
  ultimo_latido          timestamptz,
  inactivo_seg           int,
  bloqueado              boolean not null default false,
  vinculado_en           timestamptz,
  ultimo_uso_sin_reserva timestamptz
);

create table if not exists agente_eventos (
  id         bigint generated always as identity primary key,
  equipo_id  uuid not null references equipos (id),
  tipo       text not null check (tipo in ('vinculado', 'desvinculado', 'inicio', 'uso_sin_reserva', 'llegada_detectada',
                                           'bloqueo', 'desbloqueo', 'desbloqueo_personal', 'desbloqueo_emergencia',
                                           'cierre_intentado', 'modo')),
  detalle    jsonb not null default '{}'::jsonb,
  actor      uuid references perfiles (id),
  creado_en  timestamptz not null default now()
);
create index if not exists agente_eventos_equipo_idx on agente_eventos (equipo_id, creado_en desc);
create index if not exists agente_eventos_fecha_idx on agente_eventos (creado_en desc);

-- La clave de emergencia del laboratorio (una sola). Se guarda con sal e iteraciones.
create table if not exists faro_clave (
  id          boolean primary key default true check (id),
  sal         text not null,
  hash        text not null,
  iteraciones int not null,
  creada_por  uuid references perfiles (id),
  creada_en   timestamptz not null default now()
);

-- Nadie las lee directamente: el personal usa faro_panel() y Faro usa faro_estado().
alter table agentes enable row level security;
alter table agente_eventos enable row level security;
alter table faro_clave enable row level security;
revoke all on agentes, agente_eventos, faro_clave from public, anon, authenticated;

insert into politicas (clave, valor, descripcion) values
  ('faro_aviso_min',          '10', 'Faro: minutos antes del fin de la reserva en que la isla empieza a avisar.'),
  ('faro_gracia_min',         '3',  'Faro: minutos de gracia al terminar la reserva antes de bloquear (modo bloquear).'),
  ('faro_desatendido_min',    '10', 'Faro: minutos sin uso tras los cuales un proceso desatendido muestra su aviso en pantalla.'),
  ('faro_llegada_automatica', '1',  'Faro: 1 = registrar la llegada cuando detecta uso del equipo durante la reserva; 0 = no.')
on conflict (clave) do nothing;

-- ---------------------------------------------------------------- AYUDAS
-- Caracteres sin ambigüedad (sin 0/O, 1/I/L).
create or replace function _faro_codigo(p_largo int) returns text language plpgsql volatile as $$
declare v_abc text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; v text := ''; begin
  for i in 1 .. p_largo loop
    v := v || substr(v_abc, 1 + get_byte(uuid_send(gen_random_uuid()), 0) % 31, 1);
  end loop;
  return v;
end $$;

create or replace function _faro_normalizar(p text) returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) $$;

create or replace function _faro_hash_token(p text) returns text language sql immutable as $$
  select encode(sha256(convert_to(coalesce(p, ''), 'UTF8')), 'hex') $$;

-- Mismo cálculo que hace Faro sin conexión: SHA-256 de «sal:CLAVE», y luego
-- SHA-256 del resultado (bytes) tantas veces como iteraciones.
create or replace function _faro_hash_clave(p_sal text, p_clave text, p_iter int) returns text
language plpgsql immutable as $$
declare v bytea := sha256(convert_to(p_sal || ':' || _faro_normalizar(p_clave), 'UTF8')); begin
  for i in 2 .. p_iter loop v := sha256(v); end loop;
  return encode(v, 'hex');
end $$;

create or replace function _faro_equipo(p_equipo text) returns equipos
language plpgsql stable security definer set search_path = public as $$
declare v equipos; begin
  select * into v from equipos where codigo = upper(trim(p_equipo)) and not archivado;
  if not found then raise exception 'Equipo no encontrado.'; end if;
  return v;
end $$;

create or replace function _faro_staff() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid := _perfil_activo(); begin
  if not es_staff() then raise exception 'Solo el personal del laboratorio puede administrar Faro.' using errcode = '42501'; end if;
  return v;
end $$;

-- ------------------------------------------------- PERSONAL (desde la PWA)
-- Código de un solo uso para vincular Faro en un PC. Vence en 30 minutos.
create or replace function faro_codigo_vinculo(p_equipo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_eq equipos; v_cod text; v_vence timestamptz := now() + interval '30 minutes'; begin
  perform _faro_staff();
  v_eq := _faro_equipo(p_equipo);
  loop
    v_cod := _faro_codigo(8);
    exit when not exists (select 1 from agentes where codigo_vinculo = v_cod);
  end loop;
  insert into agentes (equipo_id, codigo_vinculo, codigo_vence) values (v_eq.id, v_cod, v_vence)
  on conflict (equipo_id) do update set codigo_vinculo = excluded.codigo_vinculo, codigo_vence = excluded.codigo_vence;
  return jsonb_build_object('codigo', substr(v_cod, 1, 4) || '-' || substr(v_cod, 5, 4), 'vence', v_vence, 'equipo', v_eq.codigo);
end $$;

-- Cambia el modo de uno, varios o todos los equipos (p_equipos null = todos los vinculados).
create or replace function faro_modo(p_equipos text[], p_modo text) returns int
language plpgsql security definer set search_path = public as $$
declare v uuid := _faro_staff(); n int; begin
  if p_modo not in ('observar', 'avisar', 'bloquear') then raise exception 'Modo no válido.'; end if;
  with c as (
    update agentes a set modo = p_modo
      from equipos e
     where e.id = a.equipo_id and a.modo <> p_modo
       and (p_equipos is null or e.codigo = any (select upper(x) from unnest(p_equipos) x))
    returning a.equipo_id
  ), ev as (
    insert into agente_eventos (equipo_id, tipo, detalle, actor)
    select equipo_id, 'modo', jsonb_build_object('modo', p_modo), v from c
  )
  select count(*) into n from c;
  return n;
end $$;

-- Desbloquea un equipo por unos minutos (0 = quitar el desbloqueo). Máximo 12 h.
create or replace function faro_desbloquear(p_equipo text, p_minutos int) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v uuid := _faro_staff(); v_eq equipos; v_hasta timestamptz; begin
  v_eq := _faro_equipo(p_equipo);
  if p_minutos is null or p_minutos < 0 or p_minutos > 720 then raise exception 'Indique entre 0 y 720 minutos.'; end if;
  v_hasta := case when p_minutos = 0 then null else now() + make_interval(mins => p_minutos) end;
  update agentes set desbloqueo_hasta = v_hasta, desbloqueo_por = case when v_hasta is null then null else v end
   where equipo_id = v_eq.id;
  if not found then raise exception 'Ese equipo no tiene Faro vinculado.'; end if;
  insert into agente_eventos (equipo_id, tipo, detalle, actor)
  values (v_eq.id, 'desbloqueo_personal', jsonb_build_object('minutos', p_minutos), v);
  return v_hasta;
end $$;

create or replace function faro_desvincular(p_equipo text) returns void
language plpgsql security definer set search_path = public as $$
declare v uuid := _faro_staff(); v_eq equipos; begin
  v_eq := _faro_equipo(p_equipo);
  update agentes set token_hash = null, codigo_vinculo = null, codigo_vence = null, vinculado_en = null,
                     desbloqueo_hasta = null, desbloqueo_por = null
   where equipo_id = v_eq.id;
  insert into agente_eventos (equipo_id, tipo, actor) values (v_eq.id, 'desvinculado', v);
end $$;

-- Genera (o reemplaza) la clave de emergencia y la devuelve UNA sola vez.
create or replace function faro_generar_clave() returns text
language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); v_clave text := _faro_codigo(12); v_sal text := _faro_codigo(16); begin
  if not es_admin() then raise exception 'Solo un administrador puede generar la clave de emergencia.' using errcode = '42501'; end if;
  insert into faro_clave (id, sal, hash, iteraciones, creada_por, creada_en)
  values (true, v_sal, _faro_hash_clave(v_sal, v_clave, 20000), 20000, v, now())
  on conflict (id) do update set sal = excluded.sal, hash = excluded.hash, iteraciones = excluded.iteraciones,
                                 creada_por = excluded.creada_por, creada_en = excluded.creada_en;
  return substr(v_clave, 1, 4) || '-' || substr(v_clave, 5, 4) || '-' || substr(v_clave, 9, 4);
end $$;

-- Todo lo que necesita la pestaña Faro del panel, en una sola llamada.
create or replace function faro_panel() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _faro_staff();
  return jsonb_build_object(
    'ahora', now(),
    'clave_creada_en', (select creada_en from faro_clave),
    'equipos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'codigo', e.codigo, 'nombre', e.nombre, 'categoria', e.categoria, 'estado', e.estado,
               'sistema_operativo', e.sistema_operativo,
               'vinculado', a.token_hash is not null, 'vinculado_en', a.vinculado_en,
               'codigo_vinculo', case when a.codigo_vence > now() then substr(a.codigo_vinculo, 1, 4) || '-' || substr(a.codigo_vinculo, 5, 4) end,
               'codigo_vence', case when a.codigo_vence > now() then a.codigo_vence end,
               'modo', coalesce(a.modo, 'observar'), 'ultimo_latido', a.ultimo_latido, 'version', a.version,
               'host', a.host, 'so', a.so, 'inactivo_seg', a.inactivo_seg, 'bloqueado', coalesce(a.bloqueado, false),
               'desbloqueo_hasta', case when a.desbloqueo_hasta > now() then a.desbloqueo_hasta end,
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

-- -------------------------------------------------- FARO (desde cada PC, sin sesión)
-- Canjea el código de vinculación por el token del PC. Devuelve el token una sola vez.
create or replace function faro_vincular(p_codigo text, p_host text default null, p_so text default null,
                                         p_version text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a agentes; v_eq equipos; v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''); begin
  select * into a from agentes where codigo_vinculo = _faro_normalizar(p_codigo) and codigo_vence > now() for update;
  if not found then raise exception 'El código no es válido o ya venció. Genere otro en Administración → Faro.'; end if;
  update agentes set token_hash = _faro_hash_token(v_token), codigo_vinculo = null, codigo_vence = null,
                     vinculado_en = now(), host = left(p_host, 80), so = left(p_so, 80), version = left(p_version, 20)
   where equipo_id = a.equipo_id;
  select * into v_eq from equipos where id = a.equipo_id;
  insert into agente_eventos (equipo_id, tipo, detalle)
  values (a.equipo_id, 'vinculado', jsonb_build_object('host', left(p_host, 80), 'so', left(p_so, 80)));
  return jsonb_build_object('token', v_token, 'equipo', v_eq.codigo, 'nombre', v_eq.nombre);
end $$;

-- Latido de Faro (cada ~30 s): guarda su estado y devuelve lo que debe mostrar.
-- p_info: { inactivo_seg, bloqueado, host, so, version }
create or replace function faro_estado(p_token text, p_info jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a agentes; v_eq equipos; r reservas; s reservas; v_titular text; c faro_clave;
  v_inact int := case when p_info ->> 'inactivo_seg' ~ '^\d{1,9}$' then (p_info ->> 'inactivo_seg')::int end;
  v_en_uso boolean;
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

  if r.id is not null and r.tipo = 'reserva' then
    select split_part(nombre, ' ', 1) into v_titular from perfiles where id = r.usuario_id;
    -- Si alguien usa el equipo durante la reserva, se da por registrada la llegada.
    if r.llegada_en is null and v_en_uso and coalesce(politica_int('faro_llegada_automatica'), 1) = 1 then
      update reservas set llegada_en = now() where id = r.id returning * into r;
      insert into agente_eventos (equipo_id, tipo, detalle)
      values (v_eq.id, 'llegada_detectada', jsonb_build_object('reserva', r.codigo_legible));
    end if;
  end if;

  -- Uso sin reserva (una marca cada 30 min como máximo): es el dato de la fase de observación.
  if r.id is null and v_en_uso and coalesce(a.desbloqueo_hasta, '-infinity') < now()
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
    'desbloqueo_hasta', case when a.desbloqueo_hasta > now() then a.desbloqueo_hasta end,
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

-- Eventos que Faro informa por su cuenta (bloqueos, cierres intentados, uso de la clave).
create or replace function faro_evento(p_token text, p_tipo text, p_detalle jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare a agentes; v_cod text; begin
  if p_tipo not in ('inicio', 'bloqueo', 'desbloqueo', 'desbloqueo_emergencia', 'cierre_intentado') then return; end if;
  select * into a from agentes where token_hash = _faro_hash_token(p_token) and token_hash is not null;
  if not found then raise exception 'Faro no está vinculado a ningún equipo.' using errcode = '28000'; end if;
  if (select count(*) from agente_eventos where equipo_id = a.equipo_id and creado_en > now() - interval '1 hour') >= 120 then return; end if;
  delete from agente_eventos where creado_en < now() - interval '180 days';
  insert into agente_eventos (equipo_id, tipo, detalle)
  values (a.equipo_id, p_tipo, coalesce((select jsonb_object_agg(k, left(v, 200)) from jsonb_each_text(p_detalle) t(k, v)), '{}'));
  if p_tipo = 'desbloqueo_emergencia' then
    select codigo into v_cod from equipos where id = a.equipo_id;
    perform _avisar_staff('faro', 'faro_emergencia:' || a.equipo_id || ':' || to_char(now(), 'YYYYMMDDHH24'),
                          'Faro: clave de emergencia usada en ' || v_cod,
                          'Alguien desbloqueó ' || v_cod || ' con la clave de emergencia del laboratorio. Si no fue el personal, cámbiela en Administración → Faro.',
                          '/admin?tab=faro');
  end if;
end $$;

-- ---------------------------------------------------------------- PERMISOS
revoke execute on function _faro_codigo, _faro_normalizar, _faro_hash_token, _faro_hash_clave, _faro_equipo, _faro_staff,
                           faro_codigo_vinculo, faro_modo, faro_desbloquear, faro_desvincular, faro_generar_clave,
                           faro_panel, faro_vincular, faro_estado, faro_evento
  from public, anon, authenticated;
grant execute on function faro_codigo_vinculo, faro_modo, faro_desbloquear, faro_desvincular, faro_generar_clave,
                          faro_panel to authenticated;
grant execute on function faro_vincular, faro_estado, faro_evento to anon, authenticated;

commit;
