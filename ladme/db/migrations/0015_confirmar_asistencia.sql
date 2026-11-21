-- 0015 · Confirmar asistencia con el código de Faro
-- Ejecutar después de 0014. Idempotente.
--
-- La llegada solo vale si la persona está frente al equipo: Faro muestra en la isla un código de
-- 6 dígitos que cambia cada 30 segundos (y un QR con el mismo código); la persona lo escribe en
-- «Confirmar asistencia» de la app. Ya no se puede registrar la llegada con un botón desde la app.
-- El personal sigue pudiendo registrarla por cualquier persona.
begin;

-- Todos los PCs tienen Faro: la llegada se confirma con su código.
update politicas
   set valor = '2',
       descripcion = 'Quién registra la llegada: 0 = la persona desde la app, sin comprobar que está (no recomendado); 1 = solo el personal; 2 = la persona con el código o el QR que muestra Faro en el equipo, o el personal.'
 where clave = 'llegada_modo';

-- Código de 6 dígitos: sale del mismo resumen que el código del QR (mismo cálculo en Faro).
create or replace function _faro_codigo_numero(p_secreto text, p_equipo text, p_ventana bigint) returns text
language sql immutable as $$
  select lpad((('x' || substr(encode(sha256(convert_to(p_secreto || ':' || p_equipo || ':' || p_ventana, 'UTF8')), 'hex'), 1, 8))::bit(32)::bigint
               % 1000000)::text, 6, '0') $$;

-- Intentos fallidos (para que nadie adivine el código a la fuerza).
create table if not exists llegada_intentos (
  id          bigint generated always as identity primary key,
  usuario_id  uuid not null references perfiles (id) on delete cascade,
  creado_en   timestamptz not null default now()
);
create index if not exists llegada_intentos_idx on llegada_intentos (usuario_id, creado_en desc);
alter table llegada_intentos enable row level security;

-- La reserva que espera llegada (la que empieza en los próximos 15 min o ya empezó).
create or replace function mi_llegada_pendiente() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', r.id, 'codigo_legible', r.codigo_legible, 'equipo', e.codigo, 'inicio', r.inicio, 'fin', r.fin,
                            'limite', r.inicio + make_interval(mins => coalesce(politica_int('tolerancia_llegada_min'), 30)))
    from reservas r join equipos e on e.id = r.equipo_id
   where r.usuario_id = auth.uid() and r.tipo = 'reserva' and r.estado = 'activa' and r.liberada_en is null
     and r.llegada_en is null and r.inicio <= now() + interval '15 minutes' and r.fin > now()
   order by r.inicio desc limit 1 $$;

-- Confirmar asistencia: el código de 6 dígitos de la isla del equipo reservado. Devuelve
-- {ok, equipo} o {ok: false, error}; no lanza error con un código equivocado, para que el intento
-- quede contado (5 fallidos en 10 minutos bloquean un rato).
create or replace function confirmar_llegada(p_codigo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v uuid := _perfil_activo(); r reservas; v_eq text; a agentes; v_cod text := regexp_replace(coalesce(p_codigo, ''), '\D', '', 'g');
  v_vent bigint := floor(extract(epoch from now()) / 30)::bigint; n int;
begin
  select count(*) into n from llegada_intentos where usuario_id = v and creado_en > now() - interval '10 minutes';
  if n >= 5 then
    return jsonb_build_object('ok', false, 'error', 'Demasiados códigos equivocados. Espere unos minutos o pida al personal que registre su llegada.');
  end if;
  select * into r from reservas
   where usuario_id = v and tipo = 'reserva' and estado = 'activa' and liberada_en is null
     and inicio <= now() + interval '15 minutes' and fin > now()
   order by (llegada_en is not null), inicio desc limit 1 for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'No tiene una reserva que esté empezando ahora.');
  end if;
  select codigo into v_eq from equipos where id = r.equipo_id;
  if r.llegada_en is not null then
    return jsonb_build_object('ok', true, 'equipo', v_eq, 'ya', true);
  end if;
  select * into a from agentes where equipo_id = r.equipo_id and token_hash is not null;
  if not found then
    return jsonb_build_object('ok', false, 'error', v_eq || ' no tiene Faro activo: pida al personal que registre su llegada.');
  end if;
  if length(v_cod) <> 6 or v_cod not in (_faro_codigo_numero(a.qr_secreto, v_eq, v_vent), _faro_codigo_numero(a.qr_secreto, v_eq, v_vent - 1),
                                          _faro_codigo_numero(a.qr_secreto, v_eq, v_vent - 2), _faro_codigo_numero(a.qr_secreto, v_eq, v_vent + 1)) then
    insert into llegada_intentos (usuario_id) values (v);
    return jsonb_build_object('ok', false, 'error',
      'Ese no es el código de ' || v_eq || '. Escriba el que muestra ahora la isla de Faro en ese equipo (cambia cada 30 s).');
  end if;
  update reservas set llegada_en = now() where id = r.id;
  insert into agente_eventos (equipo_id, tipo, detalle) values (r.equipo_id, 'llegada_qr', jsonb_build_object('reserva', r.codigo_legible, 'via', 'codigo'));
  delete from llegada_intentos where usuario_id = v;
  return jsonb_build_object('ok', true, 'equipo', v_eq);
end $$;

-- El botón de la app ya no registra la llegada (salvo el modo 0 o el personal).
create or replace function registrar_llegada(p_reserva uuid) returns reservas
language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); v_res reservas; begin
  select * into v_res from reservas where id = p_reserva and tipo = 'reserva' for update;
  if not found or (v_res.usuario_id <> v and not es_staff()) then raise exception 'Reserva no encontrada.'; end if;
  if not es_staff() then
    case coalesce(politica_int('llegada_modo'), 0)
      when 1 then raise exception 'La llegada la registra el personal del laboratorio: muestre su pase.';
      when 2 then raise exception 'Confirme su asistencia con el código que muestra Faro en el equipo.';
      else null;
    end case;
  end if;
  if v_res.estado <> 'activa' or v_res.fin <= now() then raise exception 'La reserva ya terminó o está cancelada.'; end if;
  if v_res.inicio > now() + interval '15 minutes' then raise exception 'La reserva aún no comienza.'; end if;
  update reservas set llegada_en = coalesce(llegada_en, now()) where id = p_reserva returning * into v_res;
  return v_res;
end $$;

-- Para contar una inasistencia, la persona tuvo que poder confirmar: con el modo 2, Faro debió
-- estar en línea durante la reserva.
create or replace function _podia_llegar(p_equipo uuid, p_inicio timestamptz) returns boolean
language sql stable security definer set search_path = public as $$
  select case coalesce(politica_int('llegada_modo'), 0)
           when 0 then true
           when 2 then exists (select 1 from agentes a where a.equipo_id = p_equipo and a.token_hash is not null and a.ultimo_latido > p_inicio)
           else exists (select 1 from agentes a where a.equipo_id = p_equipo and a.token_hash is not null
                           and a.ultimo_latido > p_inicio and coalesce(politica_int('faro_llegada_automatica'), 1) = 1)
         end $$;

-- Corrección de 0014: si en una misma revisión aparecen dos inasistencias de la misma persona, se
-- numeran en orden de fecha (la sanción va con la más reciente).
create or replace function revisar_llegadas() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tol int := coalesce(politica_int('tolerancia_llegada_min'), 30);
  v_desde timestamptz := coalesce((select (valor #>> '{}')::timestamptz from politicas where clave = 'inasistencias_desde'), now());
  v_ventana int := coalesce(politica_int('inasistencia_ventana_dias'), 60);
  v_d2 int := coalesce(politica_int('inasistencia_sancion_2_dias'), 3);
  v_d3 int := coalesce(politica_int('inasistencia_sancion_3_dias'), 7);
  v_activas boolean := coalesce(politica_int('inasistencias_activas'), 1) = 1;
  r record; v_id bigint; n int; v_hasta timestamptz; v_rec int := 0; v_ina int := 0; v_titulo text; v_cuerpo text;
begin
  -- 1) Recordatorios: al empezar (si se reservó con antelación) y 10 minutos antes del límite.
  for r in
    select x.id, x.usuario_id, x.inicio, x.creado_en, e.codigo,
           x.inicio + make_interval(mins => v_tol) as limite
      from reservas x join equipos e on e.id = x.equipo_id
     where x.tipo = 'reserva' and x.estado = 'activa' and x.llegada_en is null and x.liberada_en is null
       and x.inicio <= now() and x.inicio + make_interval(mins => v_tol) > now() and x.fin > now()
  loop
    if now() >= r.limite - interval '10 minutes' then
      perform _avisar(r.usuario_id, 'llegada_ultimo', 'llegada2:' || r.id, 'Quedan minutos para confirmar su asistencia: ' || r.codigo,
        'Confirme su asistencia en ' || r.codigo || ' antes de las ' || _hora(r.limite) ||
        ' con el código de Faro; si no, cuenta como inasistencia. Si ya no la va a usar, cancélela.', '/llegada', r.id, null, null, false);
      v_rec := v_rec + 1;
    elsif r.creado_en < r.inicio - interval '5 minutes' then
      perform _avisar(r.usuario_id, 'llegada_recordatorio', 'llegada1:' || r.id, 'Su reserva empezó: ' || r.codigo,
        'Confirme su asistencia antes de las ' || _hora(r.limite) || ': en la isla de Faro del equipo toque «Confirmar asistencia» ' ||
        'y escriba el código en la app. También aplica si dejó un proceso desatendido.', '/llegada', r.id, null, null, false);
      v_rec := v_rec + 1;
    end if;
  end loop;

  if not v_activas then return jsonb_build_object('recordatorios', v_rec, 'inasistencias', 0); end if;

  -- 2) Inasistencias: sin llegada al vencer la tolerancia. Cancelar o liberar antes no cuenta;
  --    sí cuenta si la liberó el sistema por no presentarse (liberar_no_show).
  for r in
    select x.id, x.usuario_id, x.inicio, x.fin, x.equipo_id, e.codigo, p.nombre
      from reservas x join equipos e on e.id = x.equipo_id join perfiles p on p.id = x.usuario_id
     where x.tipo = 'reserva' and x.estado = 'activa' and x.llegada_en is null
       and x.inicio >= v_desde and x.inicio > now() - interval '2 days'
       and x.inicio + make_interval(mins => v_tol) <= now()
       and (x.liberada_en is null or x.liberada_en >= x.inicio + make_interval(mins => v_tol)
            or exists (select 1 from cola_notificaciones c where c.dedupe_key = 'no_show_liberada:' || x.id))
       and p.rol = 'usuario'
       and not exists (select 1 from inasistencias i where i.reserva_id = x.id)
       and not exists (select 1 from reservas_importadas ri where ri.reserva_id = x.id)
       and _podia_llegar(x.equipo_id, x.inicio)
     order by x.inicio
     for update of x skip locked
  loop
    insert into inasistencias (reserva_id, usuario_id, equipo_codigo, inicio)
    values (r.id, r.usuario_id, r.codigo, r.inicio) on conflict (reserva_id) do nothing returning id into v_id;
    if v_id is null then continue; end if;
    select count(*) into n from inasistencias
     where usuario_id = r.usuario_id and estado = 'vigente' and inicio > now() - make_interval(days => v_ventana);
    v_hasta := case when n = 2 then now() + make_interval(days => v_d2) when n >= 3 then now() + make_interval(days => v_d3) end;
    update inasistencias set numero = n, sancion_hasta = v_hasta where id = v_id;
    v_titulo := case when v_hasta is null then 'Inasistencia registrada: ' || r.codigo
                     else 'No podrá reservar hasta el ' || to_char(v_hasta at time zone 'America/Bogota', 'DD/MM') end;
    v_cuerpo := 'Su reserva de ' || r.codigo || ' del ' || _fmt(r.inicio) || ' no tuvo llegada registrada en los primeros ' || v_tol ||
      ' minutos. Lleva ' || n || ' inasistencia' || case when n = 1 then '' else 's' end || ' en los últimos ' || v_ventana || ' días. ' ||
      case when v_hasta is null then 'A la segunda, no podrá reservar durante ' || v_d2 || ' días. '
           else 'No podrá hacer reservas hasta el ' || _fmt(v_hasta) || '. ' end ||
      'Si fue un error, apélela desde Mis reservas.';
    perform _avisar(r.usuario_id, 'inasistencia', 'inasistencia:' || v_id, v_titulo, v_cuerpo, '/mis-reservas#inasistencias', r.id);
    perform _avisar_staff('sin_llegada_staff', 'noshow_staff:' || r.id, 'Inasistencia: ' || r.codigo,
      r.nombre || ' no registró llegada en ' || r.codigo || ' (' || _fmt(r.inicio) || '). Inasistencia ' || n ||
      ' en ' || v_ventana || ' días' || case when v_hasta is null then '.' else '; sin reservar hasta el ' || _fmt(v_hasta) || '.' end,
      '/admin?tab=ronda', r.id);
    v_ina := v_ina + 1;
  end loop;
  return jsonb_build_object('recordatorios', v_rec, 'inasistencias', v_ina);
end $$;

revoke all on llegada_intentos from anon, authenticated;
revoke execute on function _faro_codigo_numero(text, text, bigint) from public, anon, authenticated;
revoke execute on function mi_llegada_pendiente(), confirmar_llegada(text) from public, anon;
grant execute on function mi_llegada_pendiente(), confirmar_llegada(text), registrar_llegada(uuid) to authenticated;

commit;
