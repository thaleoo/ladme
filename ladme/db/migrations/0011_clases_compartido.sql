-- 0011 · Clases, uso compartido y mejoras de Faro
-- Ejecutar después de 0010. Idempotente.
--
--   A. Uso compartido: quien deja un proceso corriendo puede compartir su reserva. Otras personas
--      pueden usar y reservar el equipo en ese horario sin cerrar los programas protegidos.
--   B. Clases: los docentes solicitan la sala para una clase semanal; el personal aprueba con los
--      equipos libres en todas las sesiones y se crean los bloqueos de una vez.
--   (Las notificaciones al teléfono ya existían: push_suscripciones, push-sw.js y la función
--    enviar-avisos. Solo falta desplegarlas; ver docs/DESPLIEGUE.md §4.)
--   D. Faro: clases aprobadas quedan desbloqueadas, datos de uso compartido y lista de espera,
--      programas usados, salud del disco, diagnóstico en las fallas, horario automático de la sala
--      y aviso de posible caída de la red.
begin;

insert into politicas (clave, valor, descripcion) values
  ('uso_compartido', '1', 'Permite marcar una reserva como uso compartido (otras personas pueden usar el equipo sin cerrar los programas protegidos): 1 = sí, 0 = no.'),
  ('clase_semanas_max', '20', 'Semanas máximas que puede abarcar una solicitud de sala para clase.'),
  ('sala_encender_hhmm', '0', 'Hora a la que Faro enciende la sala (Wake-on-LAN), en formato HHMM, p. ej. 700. 0 = desactivado.'),
  ('sala_apagar_hhmm', '0', 'Hora a la que Faro apaga la sala (los equipos con reserva o clase en curso se omiten), formato HHMM, p. ej. 1900. 0 = desactivado.'),
  ('sala_aviso_cierre_min', '15', 'Minutos antes de apagar la sala en que se muestra el anuncio de cierre en todos los equipos.'),
  ('sala_sabado', '0', 'El horario automático también aplica los sábados: 1 = sí, 0 = no. Los domingos nunca.')
on conflict (clave) do nothing;

-- ===================================================================== A. Uso compartido
alter table reservas add column if not exists compartida boolean not null default false;
alter table reservas add column if not exists protegidos text[];

-- Las reservas compartidas («anfitrionas») no chocan con quienes las usan como invitados, pero sí
-- entre ellas; las demás reservas siguen sin poder solaparse entre sí.
alter table reservas drop constraint if exists sin_solapamiento;
alter table reservas add constraint sin_solapamiento
  exclude using gist (equipo_id with =, periodo with &&) where (estado = 'activa' and not compartida);
alter table reservas drop constraint if exists sin_solapamiento_compartidas;
alter table reservas add constraint sin_solapamiento_compartidas
  exclude using gist (equipo_id with =, periodo with &&) where (estado = 'activa' and compartida);

-- Reglas que una restricción no puede expresar:
--   * compartir solo vale para reservas y no puede quedar encima de otras reservas existentes;
--   * un bloqueo (clase, mantenimiento) nunca puede caer sobre un proceso compartido en curso.
create or replace function trg_reservas_compartida() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_nuevo tstzrange := tstzrange(new.inicio, new.fin, '[)'); v_viejo tstzrange; begin
  if new.estado <> 'activa' or new.liberada_en is not null then return new; end if;
  if new.compartida then
    if new.tipo <> 'reserva' then raise exception 'Solo una reserva puede ser de uso compartido.'; end if;
    v_viejo := case when tg_op = 'UPDATE' and old.compartida and old.estado = 'activa'
                    then tstzrange(old.inicio, old.fin, '[)') else 'empty'::tstzrange end;
    if exists (select 1 from reservas x
                where x.equipo_id = new.equipo_id and x.id <> new.id and x.estado = 'activa' and not x.compartida
                  and x.liberada_en is null and x.periodo && v_nuevo and not (x.periodo && v_viejo)) then
      raise exception 'No se puede compartir ese horario: el equipo ya tiene otra reserva o un bloqueo en ese tramo.';
    end if;
  elsif new.tipo = 'bloqueo' and exists (select 1 from reservas x
                where x.equipo_id = new.equipo_id and x.id <> new.id and x.estado = 'activa' and x.compartida
                  and x.liberada_en is null and x.periodo && v_nuevo) then
    raise exception 'El equipo tiene un proceso de uso compartido en ese tramo: cancélelo primero o elija otro horario.'
      using errcode = 'exclusion_violation';
  end if;
  return new;
end $$;
drop trigger if exists reservas_compartida on reservas;
create trigger reservas_compartida before insert or update of inicio, fin, estado, compartida, equipo_id, liberada_en
  on reservas for each row execute function trg_reservas_compartida();

-- Avisa al titular de un equipo compartido cuando alguien reserva en su horario (sin decir quién).
create or replace function trg_reservas_invitado() returns trigger
language plpgsql security definer set search_path = public as $$
declare h reservas; v_cod text; begin
  if new.tipo <> 'reserva' or new.compartida or new.estado <> 'activa' then return new; end if;
  select * into h from reservas x
   where x.equipo_id = new.equipo_id and x.estado = 'activa' and x.compartida and x.liberada_en is null
     and x.periodo && tstzrange(new.inicio, new.fin, '[)') and x.usuario_id <> new.usuario_id
   limit 1;
  if found then
    select codigo into v_cod from equipos where id = new.equipo_id;
    perform _avisar(h.usuario_id, 'compartida_invitado', 'compartida:' || new.id,
                    'Alguien usará tu equipo compartido ' || v_cod,
                    'Otra persona reservó ' || v_cod || ' de ' || _fmt(new.inicio) || ' a ' || _fmt(new.fin) ||
                    ', dentro de tu uso compartido. Verá tus programas protegidos y el aviso de no cerrarlos.',
                    '/mis-reservas', h.id, null, null, false);
  end if;
  return new;
end $$;
drop trigger if exists reservas_invitado on reservas;
create trigger reservas_invitado after insert on reservas for each row execute function trg_reservas_invitado();

-- El titular marca (o desmarca) su reserva como compartida, con los programas que nadie debe cerrar.
create or replace function marcar_compartida(p_reserva uuid, p_compartida boolean, p_protegidos text[] default null,
                                             p_nota text default null) returns reservas
language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); r reservas; v_prot text[]; begin
  if coalesce(p_compartida, false) and coalesce(politica_int('uso_compartido'), 1) = 0 then
    raise exception 'El uso compartido está desactivado por el laboratorio.';
  end if;
  select * into r from reservas where id = p_reserva and tipo = 'reserva' for update;
  if not found or (r.usuario_id <> v and not es_staff()) then raise exception 'Reserva no encontrada.'; end if;
  if r.estado <> 'activa' or r.liberada_en is not null or r.fin <= now() then raise exception 'La reserva ya no está vigente.'; end if;
  select array_agg(distinct left(btrim(x), 40)) into v_prot
    from unnest(coalesce(p_protegidos, '{}')) x where btrim(x) <> '';
  if cardinality(v_prot) > 10 then raise exception 'Indique como máximo 10 programas protegidos.'; end if;
  begin
    update reservas set compartida = coalesce(p_compartida, false),
                        protegidos = case when p_compartida then v_prot end,
                        desatendido = desatendido or coalesce(p_compartida, false),
                        mensaje_llegada = coalesce(left(nullif(btrim(p_nota), ''), 140), mensaje_llegada)
     where id = p_reserva returning * into r;
  exception when exclusion_violation then
    raise exception 'Ya hay alguien con reserva dentro de tu horario compartido: no puedes dejar de compartir hasta que termine.';
  end;
  return r;
end $$;

-- Un equipo en uso compartido cuenta como disponible para reservar en ese horario.
create or replace function equipos_disponibles(p_inicio timestamptz, p_fin timestamptz)
returns table (codigo text, nombre text)
language sql stable security definer set search_path = public as $$
  select e.codigo, e.nombre
    from equipos e
   where p_fin > p_inicio
     and not e.archivado and e.estado = 'activo'
     and not exists (
       select 1 from reservas r
        where r.equipo_id = e.id and r.estado = 'activa' and not r.compartida
          and r.periodo && tstzrange(p_inicio, p_fin, '[)'))
   order by e.codigo $$;

-- La agenda pública muestra si un tramo es compartido y qué programas no se deben cerrar.
create or replace view ocupacion_publica as
select r.equipo_id, e.codigo, r.tipo, r.inicio, r.fin, r.desatendido, r.mensaje_llegada,
       case when r.tipo = 'bloqueo' then r.motivo end as motivo,
       r.compartida, r.protegidos
from reservas r join equipos e on e.id = r.equipo_id
where r.estado = 'activa' and r.fin > now() - interval '1 day';
grant select on ocupacion_publica to authenticated;

-- ===================================================================== B. Clases
create table if not exists clases (
  id               bigint generated always as identity primary key,
  solicitante      uuid not null references perfiles (id),
  nombre           text not null check (char_length(btrim(nombre)) between 3 and 120),
  docente          text not null check (char_length(btrim(docente)) between 3 and 120),
  grupo            int not null check (grupo between 1 and 999),
  dias             smallint[] not null check (cardinality(dias) between 1 and 6 and dias <@ array[1, 2, 3, 4, 5, 6]::smallint[]),
  hora_inicio      time not null,
  hora_fin         time not null,
  desde            date not null,
  hasta            date not null,
  equipos_pedidos  int check (equipos_pedidos between 1 and 200),
  notas            text check (char_length(notas) <= 500),
  estado           text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada', 'cancelada')),
  equipos          text[],
  respuesta        text check (char_length(respuesta) <= 500),
  resuelto_por     uuid references perfiles (id),
  resuelto_en      timestamptz,
  creado_en        timestamptz not null default now(),
  check (hora_fin > hora_inicio),
  check (hasta >= desde)
);
create index if not exists clases_estado_idx on clases (estado, creado_en desc);
alter table reservas add column if not exists clase_id bigint references clases (id) on delete set null;
create index if not exists reservas_clase_idx on reservas (clase_id) where clase_id is not null;

alter table clases enable row level security;
drop policy if exists clases_lectura on clases;
create policy clases_lectura on clases for select using (solicitante = auth.uid() or es_staff());

-- Sesiones de una clase: cada día de la semana elegido entre desde y hasta (hora de Bogotá).
create or replace function _clase_sesiones(c clases) returns table (inicio timestamptz, fin timestamptz)
language sql stable set search_path = public as $$
  select (d::date + c.hora_inicio) at time zone 'America/Bogota', (d::date + c.hora_fin) at time zone 'America/Bogota'
    from generate_series(c.desde::timestamp, c.hasta::timestamp, interval '1 day') d
   where extract(isodow from d)::smallint = any (c.dias)
   order by 1 $$;

create or replace function _texto_dias(p smallint[]) returns text language sql immutable as $$
  select string_agg((array['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'])[d], ', ' order by d)
    from unnest(p) d $$;

create or replace function solicitar_clase(p_nombre text, p_docente text, p_grupo int, p_dias int[], p_hora_inicio time,
                                           p_hora_fin time, p_desde date, p_hasta date, p_equipos int default null,
                                           p_notas text default null) returns clases
language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); c clases; n int; v_hoy date := (now() at time zone 'America/Bogota')::date; begin
  if not es_staff() and coalesce((select tipo_usuario from perfiles where id = v), '') <> 'Docente/Investigador' then
    raise exception 'Solo docentes pueden solicitar la sala para una clase. Si es docente, actualice su perfil en «Cuenta».';
  end if;
  if p_desde < v_hoy then raise exception 'La primera fecha no puede estar en el pasado.'; end if;
  if p_hasta > p_desde + 7 * coalesce(politica_int('clase_semanas_max'), 20) then
    raise exception 'La solicitud puede abarcar como máximo % semanas.', coalesce(politica_int('clase_semanas_max'), 20);
  end if;
  if p_hora_fin - p_hora_inicio > interval '8 hours' or p_hora_fin - p_hora_inicio < interval '30 minutes' then
    raise exception 'Cada sesión debe durar entre 30 minutos y 8 horas.';
  end if;
  insert into clases (solicitante, nombre, docente, grupo, dias, hora_inicio, hora_fin, desde, hasta, equipos_pedidos, notas)
  values (v, btrim(p_nombre), btrim(p_docente), p_grupo, (select array_agg(distinct x::smallint order by x::smallint) from unnest(p_dias) x),
          p_hora_inicio, p_hora_fin, p_desde, p_hasta, p_equipos, nullif(btrim(p_notas), ''))
  returning * into c;
  select count(*) into n from _clase_sesiones(c);
  if n = 0 then raise exception 'Entre esas fechas no cae ninguno de los días elegidos.'; end if;
  perform _avisar_chat('clase_solicitud', 'clase:' || c.id,
    'Nueva solicitud de sala para clase: ' || c.nombre || ' (grupo ' || c.grupo || '), ' || _texto_dias(c.dias) || ' ' ||
    to_char(c.hora_inicio, 'HH24:MI') || '–' || to_char(c.hora_fin, 'HH24:MI') || ', del ' || to_char(c.desde, 'DD/MM') ||
    ' al ' || to_char(c.hasta, 'DD/MM') || ' (' || n || ' sesiones' ||
    coalesce(', ' || c.equipos_pedidos || ' equipos', '') || ').', '/admin?tab=solicitudes');
  perform _avisar_staff('clase_solicitud', 'clase_staff:' || c.id, 'Solicitud de sala para clase: ' || c.nombre,
    c.docente || ' solicita la sala para ' || c.nombre || ' (grupo ' || c.grupo || '): ' || _texto_dias(c.dias) || ', ' ||
    to_char(c.hora_inicio, 'HH24:MI') || '–' || to_char(c.hora_fin, 'HH24:MI') || '.', '/admin?tab=solicitudes');
  return c;
end $$;

-- Equipos libres en cada sesión de la clase (para aprobar con un clic).
create or replace function clase_previa(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c clases; v jsonb; begin
  if not es_staff() then raise exception 'Solo el personal.' using errcode = '42501'; end if;
  select * into c from clases where id = p_id;
  if not found then raise exception 'Solicitud no encontrada.'; end if;
  with s as (select * from _clase_sesiones(c) where fin > now()),
       e as (select id, codigo from equipos where not archivado and estado = 'activo'),
       libre as (
         select e.codigo, s.inicio,
                not exists (select 1 from reservas x where x.equipo_id = e.id and x.estado = 'activa' and x.liberada_en is null
                              and x.periodo && tstzrange(s.inicio, s.fin, '[)') and coalesce(x.clase_id, 0) <> c.id) as ok
           from e cross join s)
  select jsonb_build_object(
    'sesiones', coalesce((select jsonb_agg(jsonb_build_object('inicio', s.inicio, 'fin', s.fin,
                 'libres', (select count(*) from libre l where l.inicio = s.inicio and l.ok)) order by s.inicio) from s), '[]'),
    'total_sesiones', (select count(*) from s),
    'equipos', coalesce((select jsonb_agg(jsonb_build_object('codigo', x.codigo, 'libres', x.n) order by x.codigo)
                  from (select codigo, count(*) filter (where ok) as n from libre group by codigo) x), '[]'))
    into v;
  return v;
end $$;

create or replace function aprobar_clase(p_id bigint, p_equipos text[], p_respuesta text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); c clases; s record; e record; n int := 0; v_omit jsonb := '[]'::jsonb; v_lista text; begin
  if not es_staff() then raise exception 'Solo el personal.' using errcode = '42501'; end if;
  select * into c from clases where id = p_id for update;
  if not found then raise exception 'Solicitud no encontrada.'; end if;
  if c.estado <> 'pendiente' then raise exception 'La solicitud ya fue %.', c.estado; end if;
  if coalesce(cardinality(p_equipos), 0) = 0 then raise exception 'Elija al menos un equipo.'; end if;
  for s in select * from _clase_sesiones(c) where fin > now() loop
    for e in select id, codigo from equipos where codigo = any (select upper(x) from unnest(p_equipos) x) and not archivado order by codigo loop
      begin
        insert into reservas (tipo, equipo_id, usuario_id, inicio, fin, motivo, clase_id)
        values ('bloqueo', e.id, v, s.inicio, s.fin, left('Clase · ' || c.nombre || ' · grupo ' || c.grupo, 200), c.id);
        n := n + 1;
      exception when exclusion_violation then
        v_omit := v_omit || jsonb_build_object('codigo', e.codigo, 'inicio', s.inicio);
      end;
    end loop;
  end loop;
  select string_agg(x, ', ' order by x) into v_lista from unnest(p_equipos) x;
  update clases set estado = 'aprobada', equipos = (select array_agg(upper(x) order by upper(x)) from unnest(p_equipos) x),
                    respuesta = nullif(btrim(p_respuesta), ''), resuelto_por = v, resuelto_en = now()
   where id = c.id;
  perform _avisar(c.solicitante, 'clase_aprobada', 'clase_ok:' || c.id, 'Sala aprobada: ' || c.nombre,
    'Su clase ' || c.nombre || ' (grupo ' || c.grupo || ') tiene la sala aprobada: ' || _texto_dias(c.dias) || ', ' ||
    to_char(c.hora_inicio, 'HH24:MI') || '–' || to_char(c.hora_fin, 'HH24:MI') || '. Equipos habilitados: ' || v_lista ||
    '. Imprima la lista desde la app y pida a sus estudiantes usar solo esos equipos.' ||
    coalesce(' Nota del laboratorio: ' || nullif(btrim(p_respuesta), ''), ''),
    '/clases/' || c.id);
  return jsonb_build_object('creadas', n, 'omitidas', v_omit);
end $$;

create or replace function rechazar_clase(p_id bigint, p_respuesta text) returns void
language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); c clases; begin
  if not es_staff() then raise exception 'Solo el personal.' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_respuesta, ''))) < 5 then raise exception 'Escriba el motivo para el docente.'; end if;
  update clases set estado = 'rechazada', respuesta = btrim(p_respuesta), resuelto_por = v, resuelto_en = now()
   where id = p_id and estado = 'pendiente' returning * into c;
  if not found then raise exception 'La solicitud ya no está pendiente.'; end if;
  perform _avisar(c.solicitante, 'clase_rechazada', 'clase_no:' || c.id, 'Solicitud de sala no aprobada: ' || c.nombre,
                  'No fue posible aprobar la sala para ' || c.nombre || ' (grupo ' || c.grupo || '). Motivo: ' || c.respuesta,
                  '/clases/' || c.id);
end $$;

-- El docente o el personal cancelan una clase: se liberan las sesiones futuras.
create or replace function cancelar_clase(p_id bigint, p_motivo text default null) returns int
language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); c clases; n int; begin
  select * into c from clases where id = p_id for update;
  if not found or (c.solicitante <> v and not es_staff()) then raise exception 'Solicitud no encontrada.'; end if;
  if c.estado not in ('pendiente', 'aprobada') then raise exception 'La solicitud ya está %.', c.estado; end if;
  update reservas set estado = 'cancelada', cancelada_en = now(),
                      motivo = left(motivo || ' · cancelada: ' || coalesce(nullif(btrim(p_motivo), ''), 'clase cancelada'), 200)
   where clase_id = c.id and estado = 'activa' and inicio > now();
  get diagnostics n = row_count;
  update clases set estado = 'cancelada', respuesta = coalesce(nullif(btrim(p_motivo), ''), respuesta) where id = c.id;
  if c.solicitante = v and not es_staff() then
    perform _avisar_chat('clase_cancelada', 'clase_cancel:' || c.id,
      'El docente canceló la clase ' || c.nombre || ' (grupo ' || c.grupo || '): ' || n || ' sesiones liberadas.', '/admin?tab=solicitudes');
  end if;
  return n;
end $$;

-- ===================================================================== D. Faro y la sala
alter table reportes add column if not exists diagnostico jsonb;
create table if not exists faro_programas (
  dia        date not null,
  equipo_id  uuid not null references equipos (id),
  programa   text not null check (char_length(programa) <= 40),
  minutos    int not null default 0,
  primary key (dia, equipo_id, programa)
);
alter table faro_programas enable row level security;
create table if not exists sala_horario_log (
  dia     date not null,
  accion  text not null,
  en      timestamptz not null default now(),
  primary key (dia, accion)
);
alter table sala_horario_log enable row level security;

-- Diagnóstico automático: al reportar una falla, se guarda lo último que Faro sabe del equipo.
create or replace function trg_reportes_diagnostico() returns trigger
language plpgsql security definer set search_path = public as $$
declare a agentes; begin
  select * into a from agentes where equipo_id = new.equipo_id and token_hash is not null;
  if found then
    new.diagnostico := jsonb_build_object(
      'en_linea', coalesce(a.ultimo_latido > now() - interval '2 minutes', false),
      'ultimo_latido', a.ultimo_latido, 'version', a.version, 'cpu_pct', a.cpu_pct,
      'inactivo_seg', a.inactivo_seg, 'bloqueado', a.bloqueado, 'so', a.so,
      'ram_gb', a.inventario -> 'ram_gb', 'disco_gb', a.inventario -> 'disco_gb',
      'disco_libre_gb', a.inventario -> 'disco_libre_gb', 'disco_salud', a.inventario -> 'disco_salud',
      'arranque_h', a.inventario -> 'arranque_h', 'inventario_en', a.inventario_en);
  end if;
  return new;
end $$;
drop trigger if exists reportes_diagnostico on reportes;
create trigger reportes_diagnostico before insert on reportes for each row execute function trg_reportes_diagnostico();

-- faro_estado se envuelve: lo de antes queda en _faro_estado_base y aquí se agrega lo nuevo.
do $$ begin
  if not exists (select 1 from pg_proc where proname = '_faro_estado_base') then
    alter function faro_estado(text, jsonb) rename to _faro_estado_base;
  end if;
end $$;
revoke execute on function _faro_estado_base(text, jsonb) from public, anon, authenticated;

create or replace function faro_estado(p_token text, p_info jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a agentes; v_hay boolean; v_delta int := 0; v jsonb; c reservas; h reservas; v_cod text; v_titular text; v_salud text;
begin
  select * into a from agentes where token_hash = _faro_hash_token(p_token) and token_hash is not null;
  v_hay := found;
  if v_hay then
    v_delta := least(greatest(extract(epoch from now() - coalesce(a.ultimo_latido, now()))::int, 0), 120);
    -- Clase aprobada en curso en este equipo: queda libre para los estudiantes, como el modo clase.
    select * into c from reservas
     where equipo_id = a.equipo_id and tipo = 'bloqueo' and clase_id is not null and estado = 'activa'
       and inicio <= now() and fin > now() limit 1;
    if found and coalesce(a.desbloqueo_hasta, '-infinity') < c.fin then
      update agentes set desbloqueo_hasta = c.fin where equipo_id = a.equipo_id;
    end if;
  end if;

  v := _faro_estado_base(p_token, p_info);
  if not v_hay then return v; end if;
  select codigo into v_cod from equipos where id = a.equipo_id;

  -- Programas en uso (solo nombres de una lista conocida, sumados por día; sin datos de la persona).
  if v_delta > 0 and jsonb_typeof(p_info -> 'programas') = 'array' then
    insert into faro_programas (dia, equipo_id, programa, minutos)
    select (now() at time zone 'America/Bogota')::date, a.equipo_id, left(p, 40), 0
      from (select distinct x as p from jsonb_array_elements_text(p_info -> 'programas') x limit 20) q
    on conflict do nothing;
    -- Se acumulan segundos en minutos enteros: cada latido suma su fracción redondeada.
    update faro_programas set minutos = minutos + greatest(1, round(v_delta / 60.0)::int)
     where dia = (now() at time zone 'America/Bogota')::date and equipo_id = a.equipo_id
       and programa in (select left(x, 40) from jsonb_array_elements_text(p_info -> 'programas') x);
  end if;

  -- Salud del disco (SMART o el estado que da el sistema).
  v_salud := p_info -> 'inventario' ->> 'disco_salud';
  if v_salud in ('advertencia', 'falla') then
    perform _avisar_chat('faro_disco_salud', 'faro_disco_salud:' || v_cod || ':' || to_char(now() at time zone 'America/Bogota', 'YYYY-MM-DD'),
      v_cod || ': el disco reporta ' || case v_salud when 'falla' then 'FALLA' else 'advertencias' end ||
      ' de salud. Conviene respaldar y revisarlo pronto.', '/admin?tab=faro');
  end if;

  -- Uso compartido en curso: Faro muestra los programas protegidos y, si no hay invitado, deja usar el equipo.
  select * into h from reservas
   where equipo_id = a.equipo_id and compartida and estado = 'activa' and liberada_en is null
     and inicio <= now() and fin > now() limit 1;
  if found then
    select split_part(nombre, ' ', 1) into v_titular from perfiles where id = h.usuario_id;
    v := v || jsonb_build_object('compartido', jsonb_build_object(
           'hasta', h.fin, 'protegidos', coalesce(to_jsonb(h.protegidos), '[]'::jsonb),
           'nota', h.mensaje_llegada, 'titular', v_titular));
    if (v -> 'actual' ->> 'inicio')::timestamptz = h.inicio and (v -> 'actual' ->> 'fin')::timestamptz = h.fin then
      v := jsonb_set(v, '{actual}', 'null'::jsonb);
    end if;
  end if;

  -- Personas esperando un equipo libre (para animar a liberar a tiempo).
  v := v || jsonb_build_object('espera', (select count(*) from lista_espera where avisado_en is null and vence > now()));
  return v;
end $$;

-- Horario automático, red caída y avisos que dependen de la hora. Lo llama el worker cada 5 min.
create or replace function sala_tick() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_local timestamp := now() at time zone 'America/Bogota';
  v_dia date := v_local::date; v_hhmm int := extract(hour from v_local)::int * 100 + extract(minute from v_local)::int;
  v_dow int := extract(isodow from v_local)::int;
  v_on int := coalesce(politica_int('sala_encender_hhmm'), 0); v_off int := coalesce(politica_int('sala_apagar_hhmm'), 0);
  v_aviso int := coalesce(politica_int('sala_aviso_cierre_min'), 15);
  v_aplica boolean; v_acciones text[] := '{}'; n int; v_ayudante uuid; v_macs jsonb; v_min_off int; v_min_now int;
  v_caidos int; v_vivos int;
begin
  v_aplica := v_dow between 1 and 5 or (v_dow = 6 and coalesce(politica_int('sala_sabado'), 0) = 1);
  v_min_now := (v_hhmm / 100) * 60 + v_hhmm % 100;

  -- Encender (Wake-on-LAN desde un Faro que ya esté encendido).
  if v_aplica and v_on > 0 and v_min_now between (v_on / 100) * 60 + v_on % 100 and (v_on / 100) * 60 + v_on % 100 + 30 then
    select coalesce(jsonb_agg(a.inventario ->> 'mac'), '[]'::jsonb) into v_macs
      from agentes a join equipos e on e.id = a.equipo_id
     where a.token_hash is not null and not e.archivado and e.estado = 'activo'
       and coalesce(a.ultimo_latido, '-infinity') < now() - interval '2 minutes' and a.inventario ->> 'mac' is not null;
    select a.equipo_id into v_ayudante from agentes a
     where a.token_hash is not null and a.ultimo_latido > now() - interval '2 minutes' order by a.ultimo_latido desc limit 1;
    if jsonb_array_length(v_macs) > 0 and v_ayudante is not null then
      insert into sala_horario_log (dia, accion) values (v_dia, 'encender') on conflict do nothing;
      get diagnostics n = row_count;
      if n > 0 then
        insert into agente_comandos (equipo_id, tipo, datos) values (v_ayudante, 'despertar', jsonb_build_object('macs', v_macs));
        v_acciones := array_append(v_acciones, 'encender');
      end if;
    end if;
  end if;

  if v_aplica and v_off > 0 then
    v_min_off := (v_off / 100) * 60 + v_off % 100;
    -- Anuncio de cierre.
    if v_min_now between v_min_off - v_aviso and v_min_off - 1 then
      insert into sala_horario_log (dia, accion) values (v_dia, 'aviso_cierre') on conflict do nothing;
      get diagnostics n = row_count;
      if n > 0 then
        insert into faro_anuncios (texto, hasta)
        values ('El laboratorio cierra a las ' || to_char(make_time(v_off / 100, v_off % 100, 0), 'HH12:MI AM') ||
                '. Guarda tu trabajo: los equipos se apagarán.',
                (v_dia + make_time(v_off / 100, v_off % 100, 0)) at time zone 'America/Bogota');
        v_acciones := array_append(v_acciones, 'aviso_cierre');
      end if;
    end if;
    -- Apagar (los equipos con reserva, uso compartido o clase en curso se omiten).
    if v_min_now between v_min_off and v_min_off + 30 then
      insert into sala_horario_log (dia, accion) values (v_dia, 'apagar') on conflict do nothing;
      get diagnostics n = row_count;
      if n > 0 then
        insert into agente_comandos (equipo_id, tipo)
        select a.equipo_id, 'apagar' from agentes a join equipos e on e.id = a.equipo_id
         where a.token_hash is not null and not e.archivado and a.ultimo_latido > now() - interval '2 minutes'
           and not exists (select 1 from reservas x where x.equipo_id = a.equipo_id and x.estado = 'activa'
                             and x.liberada_en is null and x.inicio <= now() and x.fin > now());
        v_acciones := array_append(v_acciones, 'apagar');
      end if;
    end if;
  end if;

  -- Posible caída de la red: varios Faro que estaban en línea dejaron de responder a la vez.
  select count(*) filter (where ultimo_latido between now() - interval '15 minutes' and now() - interval '3 minutes'),
         count(*) filter (where ultimo_latido > now() - interval '15 minutes')
    into v_caidos, v_vivos
    from agentes where token_hash is not null;
  if v_caidos >= 3 and v_caidos * 2 >= v_vivos then
    perform _avisar_chat('red_caida', 'red_caida:' || to_char(v_local, 'YYYY-MM-DD HH24'),
      'Posible caída de la red del laboratorio: ' || v_caidos || ' de ' || v_vivos ||
      ' equipos con Faro dejaron de responder en los últimos minutos.', '/admin?tab=faro');
    v_acciones := array_append(v_acciones, 'red_caida');
  end if;

  return jsonb_build_object('acciones', to_jsonb(v_acciones));
end $$;

-- Horas de uso por programa (para decidir licencias e instalaciones). Solo personal.
create or replace function faro_programas_resumen(p_desde date, p_hasta date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not es_staff() then raise exception 'Solo el personal.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('programa', programa, 'horas', round(minutos / 60.0, 1), 'equipos', equipos)
                                    order by minutos desc)
                     from (select programa, sum(minutos) as minutos, count(distinct equipo_id) as equipos
                             from faro_programas where dia between p_desde and p_hasta group by programa) x), '[]'::jsonb);
end $$;

-- ===================================================================== Permisos
revoke execute on function marcar_compartida(uuid, boolean, text[], text), solicitar_clase(text, text, int, int[], time, time, date, date, int, text),
  clase_previa(bigint), aprobar_clase(bigint, text[], text), rechazar_clase(bigint, text), cancelar_clase(bigint, text),
  faro_programas_resumen(date, date) from public, anon;
grant execute on function marcar_compartida(uuid, boolean, text[], text), solicitar_clase(text, text, int, int[], time, time, date, date, int, text),
  clase_previa(bigint), aprobar_clase(bigint, text[], text), rechazar_clase(bigint, text), cancelar_clase(bigint, text),
  faro_programas_resumen(date, date) to authenticated;
revoke execute on function sala_tick() from public, anon, authenticated;
grant execute on function sala_tick() to service_role;
revoke execute on function _clase_sesiones(clases), trg_reservas_compartida(), trg_reservas_invitado(), trg_reportes_diagnostico()
  from public, anon, authenticated;
grant execute on function faro_estado(text, jsonb) to anon, authenticated;
grant select on clases to authenticated;

commit;
