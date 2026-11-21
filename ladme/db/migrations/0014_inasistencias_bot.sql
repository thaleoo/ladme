-- 0014 · Inasistencias con strikes, solicitudes de clase vencidas y bot de Telegram con botones
-- Ejecutar después de 0013. Idempotente.
--
--   A. Solicitudes de clase vencidas: si a una solicitud pendiente ya no le queda ninguna sesión
--      futura, se cierra sola (estado «vencida») y el docente recibe un aviso.
--   B. Llegada e inasistencias: recordatorio al empezar la reserva y 10 minutos antes de que venza la
--      tolerancia; si no hay llegada registrada dentro de la tolerancia (30 min), cuenta como
--      inasistencia (strike). En los últimos 60 días: 1.ª = aviso, 2.ª = 3 días sin reservar,
--      3.ª o más = 7 días. Cancelar no cuenta. La persona puede apelar cada strike y el personal lo
--      anula o lo mantiene. Solo cuenta si la persona tenía cómo registrar la llegada.
--      Todo corre dentro de encolar_avisos_no_show(), que el worker ya llama cada 5 minutos.
--   C. Faro recibe la hora límite de la llegada para mostrarla en la isla.
--   D. Bot de Telegram: botones en los mensajes del chat (aprobar o rechazar clases, verificar
--      docentes, resolver apelaciones) y confirmaciones pendientes guardadas en la base.
begin;

-- ===================================================================== Políticas
insert into politicas (clave, valor, descripcion) values
  ('inasistencias_activas', '1', 'Cuenta inasistencias (reservas sin llegada dentro de la tolerancia) y aplica sanciones: 1 = sí, 0 = no.'),
  ('inasistencia_ventana_dias', '60', 'Días hacia atrás en que se cuentan las inasistencias para la sanción.'),
  ('inasistencia_sancion_2_dias', '3', 'Días sin poder reservar al acumular 2 inasistencias en la ventana.'),
  ('inasistencia_sancion_3_dias', '7', 'Días sin poder reservar al acumular 3 o más inasistencias en la ventana.'),
  ('inasistencias_desde', to_jsonb(now()::text), 'Solo cuentan las reservas que empiezan desde esta fecha (se fija al instalar).')
on conflict (clave) do nothing;

create or replace function _hora(p timestamptz) returns text language sql stable as $$
  select replace(replace(to_char(p at time zone 'America/Bogota', 'FMHH12:MI AM'), 'AM', 'a. m.'), 'PM', 'p. m.') $$;

-- ===================================================================== A. Clases vencidas
alter table clases drop constraint if exists clases_estado_check;
alter table clases add constraint clases_estado_check check (estado in ('pendiente', 'aprobada', 'rechazada', 'cancelada', 'vencida'));

create or replace function cerrar_clases_vencidas() returns int
language plpgsql security definer set search_path = public as $$
declare c clases; n int := 0; begin
  for c in select * from clases where estado = 'pendiente' for update skip locked loop
    if exists (select 1 from _clase_sesiones(c) s where s.inicio > now()) then continue; end if;
    update clases set estado = 'vencida', resuelto_en = now(),
                      respuesta = 'Las fechas pasaron sin que la solicitud se revisara.'
     where id = c.id;
    perform _avisar(c.solicitante, 'clase_vencida', 'clase_vencida:' || c.id, 'Solicitud vencida: ' || c.nombre,
      'Su solicitud de sala para ' || c.nombre || ' (grupo ' || c.grupo || ') venció porque sus fechas pasaron sin revisarse. ' ||
      'Si aún necesita la sala, envíe una nueva con fechas futuras.', '/clases', null, null, null, false);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ===================================================================== B. Inasistencias
create table if not exists inasistencias (
  id             bigint generated always as identity primary key,
  reserva_id     uuid not null unique references reservas (id) on delete cascade,
  usuario_id     uuid not null references perfiles (id) on delete cascade,
  equipo_codigo  text not null,
  inicio         timestamptz not null,
  numero         int not null default 1,
  sancion_hasta  timestamptz,
  estado         text not null default 'vigente' check (estado in ('vigente', 'anulada')),
  apelacion      text check (char_length(apelacion) <= 500),
  apelada_en     timestamptz,
  respuesta      text check (char_length(respuesta) <= 300),
  resuelto_por   uuid references perfiles (id),
  resuelto_en    timestamptz,
  creado_en      timestamptz not null default now()
);
create index if not exists inasistencias_usuario_idx on inasistencias (usuario_id, inicio desc);
alter table inasistencias enable row level security;
drop policy if exists inasistencias_lectura on inasistencias;
create policy inasistencias_lectura on inasistencias for select using (usuario_id = auth.uid() or es_staff());

-- ¿La persona tenía cómo registrar su llegada? Desde la app (modos 0 y 2: si el equipo no tiene Faro,
-- el modo 2 también deja hacerlo desde la app) o porque Faro estaba activo y la marca solo al usar el PC.
create or replace function _podia_llegar(p_equipo uuid, p_inicio timestamptz) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(politica_int('llegada_modo'), 0) in (0, 2)
      or exists (select 1 from agentes a where a.equipo_id = p_equipo and a.token_hash is not null
                    and a.ultimo_latido > p_inicio and coalesce(politica_int('faro_llegada_automatica'), 1) = 1) $$;

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
      perform _avisar(r.usuario_id, 'llegada_ultimo', 'llegada2:' || r.id, 'Quedan minutos para registrar su llegada: ' || r.codigo,
        'Registre su llegada a ' || r.codigo || ' antes de las ' || _hora(r.limite) ||
        '; si no, cuenta como inasistencia. Si ya no la va a usar, cancélela.', '/mis-reservas', r.id, null, null, false);
      v_rec := v_rec + 1;
    elsif r.creado_en < r.inicio - interval '5 minutes' then
      perform _avisar(r.usuario_id, 'llegada_recordatorio', 'llegada1:' || r.id, 'Su reserva empezó: ' || r.codigo,
        'Registre su llegada antes de las ' || _hora(r.limite) || ': en el equipo (con Faro basta con usarlo) o desde Mis reservas. ' ||
        'También aplica si dejó un proceso desatendido.', '/mis-reservas', r.id, null, null, false);
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

-- El worker ya llama a esta función cada 5 minutos: ahora hace recordatorios, inasistencias y
-- cierra las solicitudes de clase vencidas.
create or replace function encolar_avisos_no_show() returns int
language plpgsql security definer set search_path = public as $$
declare j jsonb; n int; begin
  j := revisar_llegadas();
  n := cerrar_clases_vencidas();
  return coalesce((j ->> 'recordatorios')::int, 0) + coalesce((j ->> 'inasistencias')::int, 0) + n;
end $$;

-- Sanción vigente: no puede crear reservas (el personal sí puede crearlas por la persona).
create or replace function trg_reservas_sancion() returns trigger
language plpgsql security definer set search_path = public as $$
declare v timestamptz; begin
  if new.tipo <> 'reserva' or es_staff() then return new; end if;
  select max(sancion_hasta) into v from inasistencias
   where usuario_id = new.usuario_id and estado = 'vigente' and sancion_hasta > now();
  if v is not null then
    raise exception 'No puede reservar hasta el % por inasistencias (reservas sin llegada registrada). Si alguna fue un error, apélela desde Mis reservas.', _fmt(v);
  end if;
  return new;
end $$;
drop trigger if exists reservas_sancion on reservas;
create trigger reservas_sancion before insert on reservas for each row execute function trg_reservas_sancion();

-- Apelación: una por strike, con el motivo.
create or replace function apelar_inasistencia(p_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); i inasistencias; v_nombre text; begin
  select * into i from inasistencias where id = p_id and usuario_id = v for update;
  if not found then raise exception 'Inasistencia no encontrada.'; end if;
  if i.estado <> 'vigente' then raise exception 'Esa inasistencia ya fue anulada.'; end if;
  if i.apelacion is not null then raise exception 'Ya apeló esta inasistencia; el personal la está revisando.'; end if;
  if char_length(btrim(coalesce(p_motivo, ''))) < 10 then raise exception 'Cuéntenos qué pasó (al menos 10 caracteres).'; end if;
  update inasistencias set apelacion = left(btrim(p_motivo), 500), apelada_en = now() where id = i.id;
  select nombre into v_nombre from perfiles where id = v;
  perform _avisar_chat('inasistencia_apelacion', 'apel:' || i.id, 'Apelaron una inasistencia (' || i.equipo_codigo || ', ' ||
    _fmt(i.inicio) || '): «' || left(btrim(p_motivo), 200) || '»', '/admin?tab=solicitudes');
  perform _avisar_staff('inasistencia_apelacion', 'apel_staff:' || i.id, 'Apelación de inasistencia: ' || coalesce(v_nombre, ''),
    coalesce(v_nombre, 'Una persona') || ' apeló la inasistencia de ' || i.equipo_codigo || ' (' || _fmt(i.inicio) || ').',
    '/admin?tab=solicitudes');
end $$;

create or replace function _resolver_inasistencia(i inasistencias, p_anular boolean, p_respuesta text) returns void
language plpgsql security definer set search_path = public as $$
declare v uuid := auth.uid(); begin
  update inasistencias set estado = case when p_anular then 'anulada' else estado end,
                           respuesta = nullif(btrim(p_respuesta), ''), resuelto_por = v, resuelto_en = now()
   where id = i.id;
  if p_anular then
    perform _avisar(i.usuario_id, 'inasistencia_anulada', 'inasistencia_anulada:' || i.id, 'Inasistencia anulada: ' || i.equipo_codigo,
      'El laboratorio anuló la inasistencia de ' || i.equipo_codigo || ' (' || _fmt(i.inicio) || ')' ||
      case when i.sancion_hasta > now() then ' y su sanción.' else '.' end ||
      coalesce(' Nota: ' || nullif(btrim(p_respuesta), ''), ''), '/mis-reservas#inasistencias', null, null, null, false);
  else
    perform _avisar(i.usuario_id, 'inasistencia_mantenida', 'inasistencia_mantenida:' || i.id, 'Apelación revisada: ' || i.equipo_codigo,
      'El laboratorio mantuvo la inasistencia de ' || i.equipo_codigo || ' (' || _fmt(i.inicio) || '). Motivo: ' || btrim(p_respuesta),
      '/mis-reservas#inasistencias', null, null, null, false);
  end if;
end $$;

create or replace function resolver_apelacion(p_id bigint, p_anular boolean, p_respuesta text default null) returns void
language plpgsql security definer set search_path = public as $$
declare i inasistencias; begin
  if not es_staff() then raise exception 'Solo el personal.' using errcode = '42501'; end if;
  select * into i from inasistencias where id = p_id for update;
  if not found or i.apelacion is null or i.resuelto_en is not null then raise exception 'La apelación ya no está pendiente.'; end if;
  if not p_anular and char_length(btrim(coalesce(p_respuesta, ''))) < 5 then raise exception 'Escriba el motivo para la persona.'; end if;
  perform _resolver_inasistencia(i, p_anular, p_respuesta);
end $$;

create or replace function anular_inasistencia(p_id bigint, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare i inasistencias; begin
  if not es_staff() then raise exception 'Solo el personal.' using errcode = '42501'; end if;
  select * into i from inasistencias where id = p_id for update;
  if not found or i.estado <> 'vigente' then raise exception 'La inasistencia no existe o ya fue anulada.'; end if;
  perform _resolver_inasistencia(i, true, p_motivo);
end $$;

create or replace function inasistencias_apeladas()
returns table (id bigint, usuario_id uuid, nombre text, correo text, equipo_codigo text, inicio timestamptz, numero int,
               sancion_hasta timestamptz, apelacion text, apelada_en timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not es_staff() then raise exception 'Solo el personal.' using errcode = '42501'; end if;
  return query
    select i.id, i.usuario_id, p.nombre, p.correo, i.equipo_codigo, i.inicio, i.numero, i.sancion_hasta, i.apelacion, i.apelada_en
      from inasistencias i join perfiles p on p.id = i.usuario_id
     where i.apelacion is not null and i.resuelto_en is null and i.estado = 'vigente'
     order by i.apelada_en;
end $$;

-- Llegada desde la app: con el modo 2 (QR de la isla), si el equipo no tiene Faro activo se permite
-- desde la app, para que nadie quede sin forma de registrarla.
create or replace function registrar_llegada(p_reserva uuid) returns reservas
language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); v_res reservas; begin
  select * into v_res from reservas where id = p_reserva and tipo = 'reserva' for update;
  if not found or (v_res.usuario_id <> v and not es_staff()) then raise exception 'Reserva no encontrada.'; end if;
  if not es_staff() then
    case coalesce(politica_int('llegada_modo'), 0)
      when 1 then raise exception 'La llegada la registra el personal del laboratorio: muestre su pase.';
      when 2 then
        if exists (select 1 from agentes a where a.equipo_id = v_res.equipo_id and a.token_hash is not null
                      and coalesce(a.ultimo_latido, now()) > now() - interval '5 minutes') then
          raise exception 'Para registrar la llegada, escanee el QR que muestra la isla del equipo.';
        end if;
      else null;
    end case;
  end if;
  if v_res.estado <> 'activa' or v_res.fin <= now() then raise exception 'La reserva ya terminó o está cancelada.'; end if;
  if v_res.inicio > now() + interval '15 minutes' then raise exception 'La reserva aún no comienza.'; end if;
  update reservas set llegada_en = coalesce(llegada_en, now()) where id = p_reserva returning * into v_res;
  return v_res;
end $$;

-- ===================================================================== C. Faro: hora límite de la llegada
do $$ begin
  if not exists (select 1 from pg_proc where proname = '_faro_estado_0011') then
    alter function faro_estado(text, jsonb) rename to _faro_estado_0011;
  end if;
end $$;
revoke execute on function _faro_estado_0011(text, jsonb) from public, anon, authenticated;

create or replace function faro_estado(p_token text, p_info jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb; begin
  v := _faro_estado_0011(p_token, p_info);
  if jsonb_typeof(v -> 'actual') = 'object' and v -> 'actual' ->> 'llegada' = 'false' then
    v := jsonb_set(v, '{actual,llegada_hasta}',
           to_jsonb((v -> 'actual' ->> 'inicio')::timestamptz + make_interval(mins => coalesce(politica_int('tolerancia_llegada_min'), 30))));
  end if;
  return v;
end $$;
grant execute on function faro_estado(text, jsonb) to anon, authenticated;

-- ===================================================================== D. Bot de Telegram
-- Confirmaciones y respuestas pendientes (motivo de un rechazo, /si): las guarda el bot.
create table if not exists telegram_pendientes (
  id           bigint generated always as identity primary key,
  telegram_id  bigint not null,
  accion       text not null,
  args         jsonb not null default '{}',
  mensaje_id   bigint,
  origen       jsonb,
  creado_en    timestamptz not null default now(),
  vence        timestamptz not null default now() + interval '10 minutes'
);
create index if not exists telegram_pendientes_idx on telegram_pendientes (telegram_id, creado_en desc);
alter table telegram_pendientes enable row level security;

-- Los mensajes del chat traen su clave para que el bot sepa qué botones ponerles.
drop function if exists chat_pendientes(int);
create function chat_pendientes(p_limite int default 20)
returns table (id bigint, tipo text, texto text, url text, creado_en timestamptz, dedupe_key text)
language sql security definer set search_path = public as $$
  select c.id, c.tipo, c.texto, c.url, c.creado_en, c.dedupe_key from cola_chat c
   where c.enviado_en is null and c.creado_en > now() - interval '2 days'
   order by c.creado_en limit least(greatest(p_limite, 1), 50) $$;

-- Acciones de los botones que no estaban en telegram_accion; las demás se delegan a ella.
-- Devuelve además el nombre de quien actuó, para que el bot lo escriba en el mensaje.
create or replace function telegram_ejecutar(p_telegram_id bigint, p_accion text, p_args jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_perfil uuid; v_nombre text; v_res jsonb; begin
  select t.perfil_id, split_part(p.nombre, ' ', 1) into v_perfil, v_nombre
    from telegram_vinculos t join perfiles p on p.id = t.perfil_id where t.telegram_id = p_telegram_id;
  if p_accion not in ('verificar', 'no_verificar', 'anular', 'mantener') then
    return telegram_accion(p_telegram_id, p_accion, p_args) || jsonb_build_object('actor', v_nombre);
  end if;
  if v_perfil is null then
    return jsonb_build_object('ok', false, 'error', 'Su cuenta de Telegram no está vinculada. En la app: Administración → Herramientas → Consola → «Vincular Telegram».');
  end if;
  perform set_config('request.jwt.claim.sub', v_perfil::text, true);
  if not es_staff() then return jsonb_build_object('ok', false, 'error', 'Su cuenta ya no tiene permisos del personal.'); end if;
  begin
    case p_accion
      when 'verificar' then perform resolver_verificacion((p_args ->> 'id')::bigint, true);
      when 'no_verificar' then perform resolver_verificacion((p_args ->> 'id')::bigint, false, p_args ->> 'motivo');
      when 'anular' then perform resolver_apelacion((p_args ->> 'id')::bigint, true, nullif(p_args ->> 'motivo', ''));
      when 'mantener' then perform resolver_apelacion((p_args ->> 'id')::bigint, false, p_args ->> 'motivo');
    end case;
    v_res := jsonb_build_object('id', p_args ->> 'id');
  exception when others then
    insert into consola_registro (actor, comando, ok, resultado)
    values (v_perfil, left('Telegram /' || p_accion || ' ' || p_args::text, 300), false, left(sqlerrm, 500));
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'actor', v_nombre);
  end;
  insert into consola_registro (actor, comando, ok, resultado)
  values (v_perfil, left('Telegram /' || p_accion || ' ' || p_args::text, 300), true, left(v_res::text, 500));
  return jsonb_build_object('ok', true, 'datos', v_res, 'actor', v_nombre);
end $$;

-- ===================================================================== Permisos
revoke all on inasistencias, telegram_pendientes from anon, authenticated;
grant select on inasistencias to authenticated;
revoke execute on function cerrar_clases_vencidas(), revisar_llegadas(), _podia_llegar(uuid, timestamptz), trg_reservas_sancion(),
  _resolver_inasistencia(inasistencias, boolean, text), chat_pendientes(int), telegram_ejecutar(bigint, text, jsonb)
  from public, anon, authenticated;
grant execute on function cerrar_clases_vencidas(), revisar_llegadas(), chat_pendientes(int), telegram_ejecutar(bigint, text, jsonb)
  to service_role;
grant all on telegram_pendientes to service_role;
revoke execute on function apelar_inasistencia(bigint, text), resolver_apelacion(bigint, boolean, text), anular_inasistencia(bigint, text),
  inasistencias_apeladas() from public, anon;
grant execute on function apelar_inasistencia(bigint, text), resolver_apelacion(bigint, boolean, text), anular_inasistencia(bigint, text),
  inasistencias_apeladas(), registrar_llegada(uuid) to authenticated;

commit;
