-- 0021 · Renombrar el código de un equipo sin romper etiquetas NFC/QR ni enlaces viejos
-- Ejecutar después de 0020. Idempotente.
--
--   A. Los códigos anteriores de un equipo se conservan: una etiqueta grabada con «UNAL-05» sigue
--      llevando al equipo aunque hoy se llame «UNAL-17», sin regrabar ni reemplazar la tarjeta.
--   B. renombrar_equipo() cambia el código en una sola transacción y actualiza los lugares donde el
--      código se guardó como texto (clases, anuncios de Faro, solicitudes de software, inasistencias).
--      Todo lo demás (reservas, mantenimientos, Faro) se enlaza por el id del equipo y no cambia.
--   C. resolver_codigo_equipo() traduce un código viejo al vigente; la PWA lo usa en la ficha y en Reservar.
begin;

-- ===================================================================== A. Códigos anteriores
create table if not exists equipo_codigos_anteriores (
  codigo          text primary key check (codigo ~ '^[A-Z0-9-]{3,20}$'),
  equipo_id       uuid not null references equipos (id) on delete cascade,
  reemplazado_en  timestamptz not null default now(),
  reemplazado_por uuid references perfiles (id) on delete set null
);
create index if not exists equipo_codigos_anteriores_equipo_idx on equipo_codigos_anteriores (equipo_id);

alter table equipo_codigos_anteriores enable row level security;
drop policy if exists codigos_anteriores_personal on equipo_codigos_anteriores;
create policy codigos_anteriores_personal on equipo_codigos_anteriores for select to authenticated using (es_staff());
revoke all on equipo_codigos_anteriores from public, anon;
grant select on equipo_codigos_anteriores to authenticated;

-- Un código vigente nunca es a la vez un código anterior: si alguien vuelve a usar uno (alta de un
-- equipo nuevo, o dos equipos que intercambian códigos), el código pasa a ser del equipo actual.
create or replace function trg_equipos_codigo_libre() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from equipo_codigos_anteriores where codigo = new.codigo;
  return new;
end $$;
drop trigger if exists equipos_codigo_libre on equipos;
create trigger equipos_codigo_libre before insert or update of codigo on equipos
  for each row execute function trg_equipos_codigo_libre();

-- ===================================================================== B. Renombrar
create or replace function renombrar_equipo(p_equipo uuid, p_codigo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v uuid := _perfil_activo(); e equipos; n text := upper(btrim(coalesce(p_codigo, ''))); v_ant text;
begin
  if not es_staff() then raise exception 'Solo el personal del laboratorio puede cambiar el código de un equipo.' using errcode = '42501'; end if;
  if n !~ '^[A-Z0-9-]{3,20}$' then
    raise exception 'El código usa solo letras, números y guiones (3 a 20), p. ej. UNAL-17.';
  end if;
  select * into e from equipos where id = p_equipo for update;
  if not found then raise exception 'Equipo no encontrado.'; end if;
  if e.codigo = n then raise exception 'Ese ya es el código de este equipo.'; end if;
  if exists (select 1 from equipos where codigo = n) then
    raise exception 'Ya existe un equipo con el código %. Para intercambiar dos códigos, pase uno por uno provisional.', n;
  end if;
  v_ant := e.codigo;

  -- El trigger equipos_codigo_libre quita «n» de los códigos anteriores si lo era.
  update equipos set codigo = n where id = e.id;
  insert into equipo_codigos_anteriores (codigo, equipo_id, reemplazado_por) values (v_ant, e.id, v)
  on conflict (codigo) do update set equipo_id = excluded.equipo_id, reemplazado_en = now(), reemplazado_por = excluded.reemplazado_por;

  -- Lugares donde el código se guardó como texto.
  update clases set equipos = array_replace(equipos, v_ant, n) where v_ant = any (equipos);
  update faro_anuncios set equipos = array_replace(equipos, v_ant, n) where v_ant = any (equipos);
  update solicitudes_software set equipos_instalados = array_replace(equipos_instalados, v_ant, n) where v_ant = any (equipos_instalados);
  update inasistencias set equipo_codigo = n where equipo_codigo = v_ant;

  insert into consola_registro (actor, comando, ok, resultado)
  values (v, 'Cambiar código de equipo: ' || v_ant || ' → ' || n, true, 'Las etiquetas NFC/QR con «' || v_ant || '» siguen funcionando.');
  return jsonb_build_object('anterior', v_ant, 'codigo', n);
end $$;

-- ===================================================================== C. Resolver un código
-- Devuelve el código vigente del equipo que hoy se llama así o que antes se llamaba así (null si no existe).
create or replace function resolver_codigo_equipo(p_codigo text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select codigo from equipos where codigo = upper(btrim(p_codigo))),
    (select e.codigo from equipo_codigos_anteriores a join equipos e on e.id = a.equipo_id where a.codigo = upper(btrim(p_codigo)))
  ) $$;

revoke execute on function renombrar_equipo(uuid, text), resolver_codigo_equipo(text) from public, anon;
grant execute on function renombrar_equipo(uuid, text), resolver_codigo_equipo(text) to authenticated;

commit;
