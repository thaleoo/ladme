-- 0012 · Órdenes de Faro con motivo por equipo y acciones desde Telegram
-- Ejecutar después de 0011. Idempotente.
--
--   A. faro_orden(): como faro_comando, pero dice qué equipos recibieron la orden y por qué se
--      omitió cada uno (ya encendido, sin MAC, reserva en curso…). La PWA arma el mensaje distinto
--      si la orden es para un equipo o para toda la sala.
--   B. Telegram con acciones: cada persona del personal vincula su cuenta de Telegram con un código
--      que genera en la PWA. telegram_accion() ejecuta la acción COMO esa persona (mismas
--      funciones y permisos que la PWA) y la deja en el Registro.
begin;

-- ===================================================================== A. Órdenes con detalle
create or replace function faro_orden(p_equipos text[], p_tipo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v uuid := _faro_staff(); r record; v_ayudante uuid; v_ayudante_cod text; v_macs jsonb := '[]'::jsonb;
  v_env text[] := '{}'; v_omit jsonb := '[]'::jsonb; v_vivo boolean; v_res reservas;
begin
  if p_tipo not in ('reiniciar', 'actualizar', 'apagar', 'encender', 'desinstalar') then raise exception 'Orden no válida.'; end if;
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
      -- En órdenes para toda la sala, los equipos sin Faro no son noticia.
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
    insert into agente_comandos (equipo_id, tipo, creado_por) values (r.id, p_tipo, v);
    insert into agente_eventos (equipo_id, tipo, detalle, actor) values (r.id, 'comando', jsonb_build_object('orden', p_tipo), v);
    v_env := v_env || r.codigo;
    if not v_vivo then v_omit := v_omit || jsonb_build_object('codigo', r.codigo, 'motivo', 'en_espera'); end if;
  end loop;

  -- Encender: otro Faro encendido de la misma red envía el «paquete mágico».
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

-- ===================================================================== B. Telegram
create table if not exists telegram_vinculos (
  telegram_id  bigint primary key,
  perfil_id    uuid not null unique references perfiles (id) on delete cascade,
  nombre       text check (char_length(nombre) <= 120),
  creado_en    timestamptz not null default now()
);
create table if not exists telegram_codigos (
  codigo     text primary key,
  perfil_id  uuid not null references perfiles (id) on delete cascade,
  vence      timestamptz not null
);
alter table telegram_vinculos enable row level security;
alter table telegram_codigos enable row level security;

-- La persona del personal pide un código y lo escribe en el grupo: /vincular 123456
create or replace function telegram_codigo() returns text
language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); c text; begin
  if not es_staff() then raise exception 'Solo el personal puede usar los comandos de Telegram.' using errcode = '42501'; end if;
  delete from telegram_codigos where perfil_id = v or vence < now();
  loop
    c := lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (select 1 from telegram_codigos where codigo = c);
  end loop;
  insert into telegram_codigos (codigo, perfil_id, vence) values (c, v, now() + interval '10 minutes');
  return c;
end $$;

create or replace function telegram_mi_vinculo() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('nombre', nombre, 'creado_en', creado_en) from telegram_vinculos where perfil_id = auth.uid() $$;

create or replace function telegram_desvincular() returns void
language sql security definer set search_path = public as $$
  delete from telegram_vinculos where perfil_id = auth.uid() $$;

-- Para Apps Script (clave secreta).
create or replace function telegram_vincular(p_telegram_id bigint, p_nombre text, p_codigo text) returns text
language plpgsql security definer set search_path = public as $$
declare k telegram_codigos; v_nombre text; begin
  select * into k from telegram_codigos where codigo = btrim(p_codigo) and vence > now();
  if not found then raise exception 'Código no válido o vencido. Genere uno nuevo en la app (Administración → Herramientas → Consola).'; end if;
  delete from telegram_codigos where codigo = k.codigo;
  delete from telegram_vinculos where telegram_id = p_telegram_id or perfil_id = k.perfil_id;
  insert into telegram_vinculos (telegram_id, perfil_id, nombre) values (p_telegram_id, k.perfil_id, left(p_nombre, 120));
  select split_part(nombre, ' ', 1) into v_nombre from perfiles where id = k.perfil_id;
  return v_nombre;
end $$;

-- Ejecuta una acción como la persona vinculada. Devuelve { ok, datos | error }.
create or replace function telegram_accion(p_telegram_id bigint, p_accion text, p_args jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_perfil uuid; v_res jsonb; c clases; p jsonb; v_eq text; v_r reservas; v_min int; v_lista text[];
begin
  select perfil_id into v_perfil from telegram_vinculos where telegram_id = p_telegram_id;
  if v_perfil is null then
    return jsonb_build_object('ok', false, 'error', 'Su cuenta de Telegram no está vinculada. En la app: Administración → Herramientas → Consola → «Vincular Telegram».');
  end if;
  -- Desde aquí, las funciones ven a esa persona como si usara la PWA (auth.uid()).
  perform set_config('request.jwt.claim.sub', v_perfil::text, true);
  if not es_staff() then
    return jsonb_build_object('ok', false, 'error', 'Su cuenta ya no tiene permisos del personal.');
  end if;

  begin
    case p_accion
      when 'aprobar' then
        select * into c from clases where id = (p_args ->> 'id')::bigint;
        if not found then raise exception 'No existe la solicitud #%.', p_args ->> 'id'; end if;
        p := clase_previa(c.id);
        -- Los equipos libres en todas las sesiones, hasta los que pidió el docente (igual que en la app).
        select coalesce(array_agg(codigo order by codigo), '{}') into v_lista from (
          select x ->> 'codigo' as codigo from jsonb_array_elements(p -> 'equipos') x
           where (x ->> 'libres')::int = (p ->> 'total_sesiones')::int
           order by x ->> 'codigo' limit coalesce(c.equipos_pedidos, 10000)) q;
        v_res := aprobar_clase(c.id, v_lista, nullif(p_args ->> 'nota', ''))
                 || jsonb_build_object('equipos', to_jsonb(v_lista), 'clase', c.nombre, 'grupo', c.grupo);
      when 'rechazar' then
        perform rechazar_clase((p_args ->> 'id')::bigint, p_args ->> 'motivo');
        v_res := jsonb_build_object('id', p_args ->> 'id');
      when 'liberar' then
        v_eq := upper(p_args ->> 'equipo');
        select x.* into v_r from reservas x join equipos e on e.id = x.equipo_id
         where (e.codigo = v_eq or x.codigo_legible = v_eq) and x.tipo = 'reserva' and x.estado = 'activa'
           and x.liberada_en is null and x.inicio <= now() and x.fin > now()
         order by x.inicio desc limit 1;
        if not found then raise exception 'No hay una reserva en curso en %.', v_eq; end if;
        perform liberar_reserva(v_r.id);
        v_res := jsonb_build_object('codigo', v_r.codigo_legible, 'equipo', v_eq);
      when 'bloquear' then
        v_min := (p_args ->> 'minutos')::int;
        v_res := crear_bloqueo(upper(p_args ->> 'equipo'), now(), now() + make_interval(mins => v_min), p_args ->> 'motivo', false);
      when 'desbloquear' then
        v_res := jsonb_build_object('hasta', faro_desbloquear(upper(p_args ->> 'equipo'), coalesce((p_args ->> 'minutos')::int, 120)));
      when 'anuncio' then
        v_res := jsonb_build_object('id', faro_anunciar(p_args ->> 'texto', (p_args ->> 'minutos')::int, null));
      when 'orden' then
        v_res := faro_orden(case when jsonb_typeof(p_args -> 'equipos') = 'array'
                                 then (select array_agg(upper(x)) from jsonb_array_elements_text(p_args -> 'equipos') x) end,
                            p_args ->> 'tipo');
      else
        raise exception 'Acción desconocida: %.', p_accion;
    end case;
  exception when others then
    insert into consola_registro (actor, comando, ok, resultado)
    values (v_perfil, left('Telegram /' || p_accion || ' ' || coalesce(p_args::text, ''), 500), false, left(sqlerrm, 500));
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;

  insert into consola_registro (actor, comando, ok, resultado)
  values (v_perfil, left('Telegram /' || p_accion || ' ' || coalesce(p_args::text, ''), 500), true, left(v_res::text, 500));
  return jsonb_build_object('ok', true, 'datos', v_res);
end $$;

-- ===================================================================== Permisos
revoke execute on function faro_orden(text[], text), telegram_codigo(), telegram_mi_vinculo(), telegram_desvincular() from public, anon;
grant execute on function faro_orden(text[], text), telegram_codigo(), telegram_mi_vinculo(), telegram_desvincular() to authenticated;
revoke execute on function telegram_vincular(bigint, text, text), telegram_accion(bigint, text, jsonb) from public, anon, authenticated;
grant execute on function telegram_vincular(bigint, text, text), telegram_accion(bigint, text, jsonb) to service_role;

commit;
