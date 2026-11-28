-- 0028 · Faro 0.8.2: código del personal que cambia cada 30 segundos
-- Ejecutar después de 0027. Idempotente.
--
--   A. Código del personal: 8 dígitos por equipo que cambian cada 30 s. El personal los ve en la app
--      (Administración → Faro → Código del personal) y los escribe en la isla o en la pantalla de
--      bloqueo: desbloquea y quita suspensiones como la clave de emergencia, aunque no haya internet.
--      Si alguien lo ve por encima del hombro, deja de servir en un minuto.
--      Cada equipo recibe solo su propio secreto (derivado del secreto del laboratorio) y solo si Faro
--      corre como servicio del sistema, donde ninguna cuenta puede leerlo.
--   B. La clave de emergencia fija se puede desactivar cuando todos los equipos usan el servicio:
--      se reemplaza por una que nadie conoce. Para volver a tenerla, se crea otra.
begin;

-- ===================================================================== A. Código del personal
create table if not exists faro_secreto_personal (
  id        boolean primary key default true check (id),
  secreto   text not null,
  creado_en timestamptz not null default now()
);
alter table faro_secreto_personal enable row level security;
revoke all on faro_secreto_personal from public, anon, authenticated;
insert into faro_secreto_personal (secreto)
values (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (id) do nothing;

-- Faro avisa en cada latido si corre como servicio del sistema (lo muestra el panel).
alter table agentes add column if not exists servicio boolean not null default false;

-- El secreto de un equipo (lo que recibe su Faro).
create or replace function _faro_secreto_equipo(p_equipo text) returns text
language sql stable security definer set search_path = public as $$
  select encode(sha256(convert_to(s.secreto || ':' || upper(p_equipo), 'UTF8')), 'hex') from faro_secreto_personal s $$;

-- 8 dígitos (mismo cálculo en Faro: ordenes::codigo_personal).
create or replace function _faro_codigo_personal(p_secreto text, p_equipo text, p_ventana bigint) returns text
language sql immutable as $$
  select lpad((('x' || substr(encode(sha256(convert_to(p_secreto || ':' || p_equipo || ':' || p_ventana, 'UTF8')), 'hex'), 1, 8))::bit(32)::bigint
               % 100000000)::text, 8, '0') $$;

-- Los códigos vigentes de los equipos que corren como servicio (solo el personal).
create or replace function faro_codigos_personal() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_ahora numeric := extract(epoch from now()); v_vent bigint := floor(v_ahora / 30);
begin
  perform _faro_staff();
  return jsonb_build_object(
    'cambia_en', 30 - (floor(v_ahora)::bigint % 30),
    'codigos', coalesce((
      select jsonb_agg(jsonb_build_object('equipo', e.codigo,
                                          'codigo', _faro_codigo_personal(_faro_secreto_equipo(e.codigo), e.codigo, v_vent))
                       order by e.codigo)
        from agentes a join equipos e on e.id = a.equipo_id
       where a.token_hash is not null and a.servicio), '[]'::jsonb));
end $$;

do $$ begin
  if not exists (select 1 from pg_proc where proname = '_faro_estado_0027') then
    alter function faro_estado(text, jsonb) rename to _faro_estado_0027;
  end if;
end $$;
revoke execute on function _faro_estado_0027(text, jsonb) from public, anon, authenticated;

create or replace function faro_estado(p_token text, p_info jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb; v_servicio boolean := coalesce((p_info ->> 'servicio')::boolean, false);
begin
  v := _faro_estado_0027(p_token, p_info);
  update agentes set servicio = v_servicio where token_hash = _faro_hash_token(p_token) and token_hash is not null and servicio is distinct from v_servicio;
  -- Faro por cuenta guarda su copia donde la cuenta la lee: ahí el secreto no viaja.
  if v_servicio and v -> 'equipo' ->> 'codigo' is not null then
    v := v || jsonb_build_object('personal', _faro_secreto_equipo(v -> 'equipo' ->> 'codigo'));
  end if;
  return v;
end $$;
grant execute on function faro_estado(text, jsonb) to anon, authenticated;

-- ===================================================================== B. Clave de emergencia fija
alter table faro_clave add column if not exists desactivada_en timestamptz;

create or replace function faro_generar_clave() returns text
language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); v_clave text := _faro_codigo(12); v_sal text := _faro_codigo(16); begin
  if not es_admin() then raise exception 'Solo un administrador puede generar la clave de emergencia.' using errcode = '42501'; end if;
  insert into faro_clave (id, sal, hash, iteraciones, creada_por, creada_en, desactivada_en)
  values (true, v_sal, _faro_hash_clave(v_sal, v_clave, 20000), 20000, v, now(), null)
  on conflict (id) do update set sal = excluded.sal, hash = excluded.hash, iteraciones = excluded.iteraciones,
                                 creada_por = excluded.creada_por, creada_en = excluded.creada_en, desactivada_en = null;
  insert into consola_registro (actor, comando, ok, resultado) values (v, 'Nueva clave de emergencia de Faro', true, 'Se mostró una vez');
  return substr(v_clave, 1, 4) || '-' || substr(v_clave, 5, 4) || '-' || substr(v_clave, 9, 4);
end $$;

-- Reemplaza la clave por una que nadie conoce (no se muestra ni se guarda en ningún lado).
create or replace function faro_desactivar_clave() returns void
language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); v_sal text := _faro_codigo(16); begin
  if not es_admin() then raise exception 'Solo un administrador puede desactivar la clave de emergencia.' using errcode = '42501'; end if;
  insert into faro_clave (id, sal, hash, iteraciones, creada_por, creada_en, desactivada_en)
  values (true, v_sal, _faro_hash_clave(v_sal, _faro_codigo(24), 20000), 20000, v, now(), now())
  on conflict (id) do update set sal = excluded.sal, hash = excluded.hash, iteraciones = excluded.iteraciones,
                                 creada_por = excluded.creada_por, creada_en = excluded.creada_en, desactivada_en = now();
  insert into consola_registro (actor, comando, ok, resultado) values (v, 'Clave de emergencia de Faro desactivada', true, 'Queda el código del personal');
end $$;

-- ===================================================================== Panel del personal
do $$ begin
  if not exists (select 1 from pg_proc where proname = '_faro_panel_0026') then
    alter function faro_panel() rename to _faro_panel_0026;
  end if;
end $$;
revoke execute on function _faro_panel_0026() from public, anon, authenticated;

create or replace function faro_panel() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb := _faro_panel_0026();
begin
  v := jsonb_set(v, '{equipos}', coalesce((
         select jsonb_agg(x || jsonb_build_object(
                  'servicio', coalesce((select a.servicio from agentes a join equipos e on e.id = a.equipo_id
                                         where e.codigo = x ->> 'codigo' and a.token_hash is not null), false))
                order by o)
           from jsonb_array_elements(v -> 'equipos') with ordinality t(x, o)), '[]'::jsonb));
  return v || jsonb_build_object('clave_desactivada_en', (select desactivada_en from faro_clave));
end $$;

revoke execute on function faro_panel(), faro_codigos_personal(), faro_generar_clave(), faro_desactivar_clave() from public, anon;
grant execute on function faro_panel(), faro_codigos_personal(), faro_generar_clave(), faro_desactivar_clave() to authenticated;
revoke execute on function _faro_secreto_equipo(text), _faro_codigo_personal(text, text, bigint) from public, anon, authenticated;

commit;
