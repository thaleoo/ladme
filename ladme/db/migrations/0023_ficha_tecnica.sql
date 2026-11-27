-- 0023 · Ficha técnica de cada equipo, llenada por Faro
-- Ejecutar después de 0022. Idempotente.
--
--   A. Columnas de hardware en equipos (procesador, RAM, tarjeta de video, cámara, disco) para filtrar y
--      ordenar en Disponibilidad. Antes vivían solo en agentes.inventario (jsonb) y no se podían filtrar.
--   B. Cada inventario de Faro actualiza la ficha del equipo (del puesto: el código y la tarjeta NFC son del
--      puesto). Cuando Faro informa un dato, manda; cuando no lo sabe (p. ej. falta una herramienta en Linux),
--      se conserva lo que había, también lo que el personal escribió a mano.
--   C. El sistema operativo y su versión se actualizan en cada inventario. Antes solo se escribían si estaban
--      vacíos (coalesce), así que una reinstalación dejaba la ficha vieja.
--   D. Se llena ya la ficha con el último inventario de cada equipo.
begin;

-- ===================================================================== A. Columnas
alter table equipos add column if not exists cpu_modelo   text check (char_length(cpu_modelo) <= 120);
alter table equipos add column if not exists cpu_nucleos  smallint check (cpu_nucleos between 1 and 512);
alter table equipos add column if not exists cpu_hilos    smallint check (cpu_hilos between 1 and 1024);
alter table equipos add column if not exists ram_gb       numeric(6,1) check (ram_gb > 0 and ram_gb < 10000);
alter table equipos add column if not exists gpu_modelo   text check (char_length(gpu_modelo) <= 120);
alter table equipos add column if not exists gpu_vram_gb  numeric(5,1) check (gpu_vram_gb > 0 and gpu_vram_gb < 1000);
alter table equipos add column if not exists gpu_dedicada boolean;
alter table equipos add column if not exists camara       boolean;
alter table equipos add column if not exists disco_gb     numeric(7,1) check (disco_gb > 0 and disco_gb < 1000000);
alter table equipos add column if not exists ficha_en     timestamptz;   -- última vez que Faro la actualizó

-- ===================================================================== B. Desde el inventario
-- Número positivo de un texto que viene de Faro (null si no lo es o pasa del máximo).
create or replace function _num_inv(p text, p_max numeric) returns numeric
language sql immutable set search_path = public as $$
  select case when p ~ '^\d{1,7}(\.\d{1,3})?$' and p::numeric > 0 and p::numeric < p_max then p::numeric end $$;

create or replace function _ficha_desde_inventario(p_equipo uuid, v jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  g jsonb; v_gpus jsonb; v_cams jsonb;
  v_so text := case when v ->> 'so_tipo' in ('Windows', 'Linux', 'macOS') then v ->> 'so_tipo' end;
  v_so_ver text := nullif(left(btrim(coalesce(v ->> 'so_nombre', v ->> 'so_version', '')), 60), '');
begin
  if p_equipo is null or v is null or jsonb_typeof(v) <> 'object' then return; end if;
  v_gpus := case when jsonb_typeof(v -> 'gpus') = 'array' then v -> 'gpus' end;
  v_cams := case when jsonb_typeof(v -> 'camaras') = 'array' then v -> 'camaras' end;
  -- Tarjeta principal: la dedicada con más memoria; si no hay, la primera.
  select x into g from jsonb_array_elements(coalesce(v_gpus, '[]')) x
   where jsonb_typeof(x) = 'object' and btrim(coalesce(x ->> 'nombre', '')) <> ''
   order by (x ->> 'dedicada') = 'true' desc, _num_inv(x ->> 'vram_gb', 1000) desc nulls last
   limit 1;

  update equipos set
    cpu_modelo   = coalesce(nullif(left(btrim(coalesce(v ->> 'cpu', '')), 120), ''), cpu_modelo),
    cpu_nucleos  = coalesce(_num_inv(v ->> 'nucleos', 513)::smallint, cpu_nucleos),
    cpu_hilos    = coalesce(_num_inv(v ->> 'hilos', 1025)::smallint, cpu_hilos),
    ram_gb       = coalesce(round(_num_inv(v ->> 'ram_gb', 10000), 1), ram_gb),
    disco_gb     = coalesce(round(_num_inv(v ->> 'disco_gb', 1000000), 1), disco_gb),
    -- Si Faro nombró una tarjeta, la ficha es esa (también si cambió de dedicada a integrada).
    gpu_modelo   = case when g is not null then left(btrim(g ->> 'nombre'), 120) else gpu_modelo end,
    gpu_vram_gb  = case when g is not null then round(_num_inv(g ->> 'vram_gb', 1000), 1) else gpu_vram_gb end,
    gpu_dedicada = case when g is not null then (g ->> 'dedicada') = 'true' else gpu_dedicada end,
    -- Faro 0.5.6 o superior envía la lista de cámaras (vacía = ninguna). Uno anterior no la envía.
    camara       = case when v_cams is not null then jsonb_array_length(v_cams) > 0 else camara end,
    sistema_operativo = coalesce(v_so, sistema_operativo),
    so_version   = coalesce(v_so_ver, so_version),
    ficha_en     = now()
   where id = p_equipo;
end $$;

create or replace function trg_agentes_ficha() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.equipo_id is not null and new.inventario is not null
     and (new.inventario is distinct from old.inventario or new.inventario_en is distinct from old.inventario_en) then
    perform _ficha_desde_inventario(new.equipo_id, new.inventario);
  end if;
  return null;
end $$;
drop trigger if exists agentes_ficha on agentes;
create trigger agentes_ficha after update of inventario, inventario_en on agentes
  for each row execute function trg_agentes_ficha();

revoke execute on function _num_inv(text, numeric), _ficha_desde_inventario(uuid, jsonb) from public, anon, authenticated;

-- ===================================================================== D. Llenar ya
select count(_ficha_desde_inventario(equipo_id, inventario)) as fichas_llenadas from agentes where equipo_id is not null and inventario is not null;

commit;
