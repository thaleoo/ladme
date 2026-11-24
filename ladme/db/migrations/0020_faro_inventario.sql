-- 0020 · Faro 0.5.4: inventario cada hora y bajo pedido, sin perder los programas marcados a mano
-- Ejecutar después de 0019. Idempotente.
--
--   A. Orden «inventario»: el personal pide desde la app (o el chat) que Faro vuelva a medir el
--      equipo (salud del disco, memoria, espacio libre) y a leer sus programas en ese momento.
--      Faro 0.5.4 además lo hace solo cada hora (antes, cada 6 horas).
--   B. Programas: Faro reconoce una lista conocida de programas. Lo que el personal marca como
--      instalado y Faro no reconoce (p. ej. al resolver una solicitud de software) ya no se borra en
--      el siguiente inventario. Lo que Faro sí reconocía y deja de ver se quita: se desinstaló.
begin;

-- ===================================================================== A. Orden «inventario»
do $$ declare c text; begin
  for c in select conname from pg_constraint
            where conrelid = 'agente_comandos'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%tipo%'
  loop
    execute format('alter table agente_comandos drop constraint %I', c);
  end loop;
end $$;
alter table agente_comandos add constraint agente_comandos_tipo_check
  check (tipo in ('reiniciar', 'actualizar', 'apagar', 'despertar', 'desinstalar', 'inventario'));

create or replace function faro_orden(p_equipos text[], p_tipo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v uuid := _faro_staff(); r record; v_ayudante uuid; v_ayudante_cod text; v_macs jsonb := '[]'::jsonb;
  v_env text[] := '{}'; v_omit jsonb := '[]'::jsonb; v_vivo boolean; v_res reservas;
begin
  if p_tipo not in ('reiniciar', 'actualizar', 'apagar', 'encender', 'desinstalar', 'inventario') then raise exception 'Orden no válida.'; end if;
  if p_tipo = 'desinstalar' and not es_admin() then
    raise exception 'Solo un administrador puede desinstalar Faro.' using errcode = '42501';
  end if;
  if p_equipos is not null and exists (select 1 from unnest(p_equipos) x where upper(x) not in (select codigo from equipos)) then
    raise exception 'No existe el equipo %.', (select string_agg(x, ', ') from unnest(p_equipos) x where upper(x) not in (select codigo from equipos));
  end if;

  for r in
    select e.id, e.codigo, a.equipo_id is not null and a.token_hash is not null as vinculado, a.ultimo_latido, a.inventario ->> 'mac' as mac
      from equipos e left join agentes a on a.equipo_id = e.id
     where not e.archivado
       and (p_equipos is null or e.codigo = any (select upper(x) from unnest(p_equipos) x))
     order by e.codigo
  loop
    v_vivo := coalesce(r.ultimo_latido > now() - interval '2 minutes', false);
    if not r.vinculado then
      if p_equipos is not null then v_omit := v_omit || jsonb_build_object('codigo', r.codigo, 'motivo', 'sin_faro'); end if;
      continue;
    end if;
    if p_tipo = 'encender' then
      if v_vivo then v_omit := v_omit || jsonb_build_object('codigo', r.codigo, 'motivo', 'ya_encendido'); continue; end if;
      if r.mac is null then v_omit := v_omit || jsonb_build_object('codigo', r.codigo, 'motivo', 'sin_mac'); continue; end if;
      v_macs := v_macs || to_jsonb(r.mac);
      v_env := v_env || r.codigo;
      continue;
    end if;
    if p_tipo = 'apagar' then
      if not v_vivo then v_omit := v_omit || jsonb_build_object('codigo', r.codigo, 'motivo', 'apagado'); continue; end if;
      select * into v_res from reservas x
       where x.equipo_id = r.id and x.estado = 'activa' and x.liberada_en is null and x.inicio <= now() and x.fin > now()
       order by x.compartida desc, x.clase_id nulls last limit 1;
      if found then
        v_omit := v_omit || jsonb_build_object('codigo', r.codigo, 'motivo',
          case when v_res.compartida then 'compartido' when v_res.clase_id is not null or v_res.motivo like 'Clase · %' then 'clase'
               when v_res.tipo = 'bloqueo' then 'bloqueo' else 'reserva' end);
        continue;
      end if;
    end if;
    -- Pedir el inventario dos veces seguidas no sirve de nada: se deja una sola orden pendiente.
    if p_tipo = 'inventario' then
      delete from agente_comandos where equipo_id = r.id and tipo = 'inventario' and entregado_en is null;
    end if;
    insert into agente_comandos (equipo_id, tipo, creado_por) values (r.id, p_tipo, v);
    insert into agente_eventos (equipo_id, tipo, detalle, actor) values (r.id, 'comando', jsonb_build_object('orden', p_tipo), v);
    v_env := v_env || r.codigo;
    if not v_vivo then v_omit := v_omit || jsonb_build_object('codigo', r.codigo, 'motivo', 'en_espera'); end if;
  end loop;

  if p_tipo = 'encender' and cardinality(v_env) > 0 then
    select a.equipo_id, e.codigo into v_ayudante, v_ayudante_cod from agentes a join equipos e on e.id = a.equipo_id
     where a.token_hash is not null and a.ultimo_latido > now() - interval '2 minutes'
     order by a.ultimo_latido desc limit 1;
    if v_ayudante is null then
      raise exception 'No hay ningún equipo con Faro encendido que pueda enviar la señal de encendido. Encienda uno a mano y vuelva a intentarlo.';
    end if;
    insert into agente_comandos (equipo_id, tipo, datos, creado_por)
    values (v_ayudante, 'despertar', jsonb_build_object('macs', v_macs), v);
    insert into agente_eventos (equipo_id, tipo, detalle, actor)
    select id, 'comando', jsonb_build_object('orden', 'encender', 'por', v_ayudante_cod), v from equipos where codigo = any (v_env);
  end if;

  return jsonb_build_object('tipo', p_tipo, 'sala', p_equipos is null, 'enviados', to_jsonb(v_env),
                            'omitidos', v_omit, 'ayudante', v_ayudante_cod);
end $$;

-- ===================================================================== B. Programas marcados a mano
-- Lo último que Faro reportó antes del inventario actual: así se sabe qué dejó de ver.
alter table agentes add column if not exists software_previo text[];

create or replace function trg_agentes_software_previo() returns trigger
language plpgsql set search_path = public as $$
begin
  -- Cada inventario nuevo (cambia la fecha o el contenido) guarda la lista que había antes.
  if new.inventario_en is distinct from old.inventario_en or new.inventario is distinct from old.inventario then
    new.software_previo := coalesce((select array_agg(distinct left(x, 40))
                                       from jsonb_array_elements_text(coalesce(old.inventario -> 'software', '[]')) x), '{}');
  end if;
  return new;
end $$;
drop trigger if exists agentes_software_previo on agentes;
create trigger agentes_software_previo before update of inventario, inventario_en on agentes
  for each row execute function trg_agentes_software_previo();

-- Cuando Faro reemplaza la lista del equipo, se conservan los programas que no venían de Faro.
-- Solo actúa con la llamada de Faro (sin sesión de usuario): si el personal edita la lista a mano
-- en la app, su cambio se respeta tal cual.
create or replace function trg_equipos_software_conserva() returns trigger
language plpgsql set search_path = public as $$
declare v_faro text[]; v_previo text[];
begin
  if auth.uid() is not null then return new; end if;
  select coalesce((select array_agg(distinct left(x, 40)) from jsonb_array_elements_text(coalesce(a.inventario -> 'software', '[]')) x), '{}'),
         coalesce(a.software_previo, '{}')
    into v_faro, v_previo
    from agentes a where a.equipo_id = new.id;
  if v_faro is null or not (new.software @> v_faro and v_faro @> new.software) then return new; end if;
  -- Quedan los de Faro y los que estaban antes sin venir de Faro (ni ahora ni en el inventario anterior).
  new.software := (select coalesce(array_agg(distinct p order by p), '{}') from unnest(
                     v_faro || array(select p from unnest(coalesce(old.software, '{}')) p where not (p = any (v_previo)))) p);
  return new;
end $$;
drop trigger if exists equipos_software_conserva on equipos;
create trigger equipos_software_conserva before update of software on equipos
  for each row execute function trg_equipos_software_conserva();

commit;
