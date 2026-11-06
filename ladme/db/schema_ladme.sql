-- ============================================================================
-- LADME: esquema PostgreSQL (Supabase) PROPUESTO. Borrador para aprobación.
-- Principios:
--  * La BASE DE DATOS garantiza la integridad (no el frontend, no una hoja de cálculo).
--  * Ninguna escritura directa de los clientes: todo pasa por funciones (RPC) con permisos explícitos.
--  * Reservas y bloqueos de gestión viven en UNA tabla, así un solo constraint evita todo solapamiento.
--  * Todo cambio queda en un historial append-only; las notificaciones salen de una cola sin duplicados.
-- En Supabase: perfiles.id referencia auth.users(id) y auth.uid() ya existe.
-- ============================================================================

create extension if not exists btree_gist;

create type rol_usuario    as enum ('usuario', 'laboratorista', 'administrador');
create type estado_equipo  as enum ('activo', 'mantenimiento', 'fuera_de_servicio');
create type tipo_ocupacion as enum ('reserva', 'bloqueo');
create type estado_reserva as enum ('activa', 'cancelada');

-- ---------------------------------------------------------------- USUARIOS
create table perfiles (
  id        uuid primary key references auth.users (id) on delete cascade,
  correo    text not null unique check (correo = lower(correo) and correo like '%@unal.edu.co'),
  nombre    text not null check (char_length(nombre) between 1 and 120),
  programa  text,
  rol       rol_usuario not null default 'usuario',
  activo    boolean not null default true,
  creado_en timestamptz not null default now()
  -- No se guarda la cédula: minimización de datos (Ley 1581). Añadir solo si la administración lo justifica.
);

create function crear_perfil_al_registrarse() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if lower(coalesce(new.email, '')) not like '%@unal.edu.co' then
    raise exception 'Solo se permiten cuentas institucionales @unal.edu.co.' using errcode = '42501';
  end if;
  insert into perfiles (id, correo, nombre)
  values (new.id, lower(new.email), left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)), 120));
  return new;
end $$;
create trigger auth_nuevo_usuario after insert on auth.users for each row execute function crear_perfil_al_registrarse();

-- ----------------------------------------------------------------- EQUIPOS
create table equipos (
  id               uuid primary key default gen_random_uuid(),
  codigo           text not null unique check (codigo ~ '^[A-Z0-9-]{3,20}$'),  -- UNAL-05: ID interno estable (QR/NFC)
  nombre           text not null,
  categoria        text not null default 'Estación de trabajo',
  marca            text,
  modelo           text,
  especificaciones jsonb not null default '{}'::jsonb,
  ubicacion        text,
  placa_oficial    text unique,          -- placa de la Universidad (se completa tras la verificación física)
  serial           text,
  nfc_uid          text unique,
  fecha_adquisicion date,
  estado           estado_equipo not null default 'activo',
  archivado        boolean not null default false,
  creado_en        timestamptz not null default now()
);

-- ------------------------------------------------------------ POLÍTICAS (configurables)
create table politicas (
  clave       text primary key,
  valor       jsonb not null,
  descripcion text
);
insert into politicas (clave, valor, descripcion) values
  ('duracion_max_horas',   '168', 'Duración máxima de una reserva de usuario (h). Valor inicial = uso actual (máx. observado 176 h). VALIDAR con el responsable.'),
  ('anticipacion_max_dias', '30', 'Con cuántos días de anticipación se puede reservar. VALIDAR.'),
  ('extension_max_horas',   '24', 'Máximo de horas que se pueden añadir en una extensión. VALIDAR.'),
  ('tolerancia_llegada_min', '30', 'Minutos de tolerancia para registrar la llegada (para medir reservas no utilizadas). VALIDAR.');

create function politica_int(p_clave text) returns int
language sql stable as $$ select (valor #>> '{}')::int from politicas where clave = p_clave $$;

-- ------------------------------------------------- RESERVAS Y BLOQUEOS (una sola tabla)
create table reservas (
  id              uuid primary key default gen_random_uuid(),
  codigo_legible  text not null unique
                  default ('RES-' || to_char(now(), 'YYMMDD') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
  tipo            tipo_ocupacion not null default 'reserva',
  equipo_id       uuid not null references equipos (id),
  usuario_id      uuid not null references perfiles (id),      -- titular (o autor del bloqueo)
  inicio          timestamptz not null,
  fin             timestamptz not null,
  periodo         tstzrange generated always as (tstzrange(inicio, fin, '[)')) stored,   -- intervalo semiabierto
  estado          estado_reserva not null default 'activa',
  actividad       text,
  detalle         text check (char_length(detalle) <= 800),
  desatendido     boolean not null default false,
  mensaje_llegada text check (char_length(mensaje_llegada) <= 140),
  motivo          text,                                         -- bloqueos y cancelaciones
  llegada_en      timestamptz,                                  -- check-in (permite medir "reservas no utilizadas")
  liberada_en     timestamptz,
  token_credencial text not null unique
                  default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),  -- QR: aleatorio, sin datos
  id_solicitud    text unique,                                  -- idempotencia ante reintentos del cliente
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint fin_posterior check (fin > inicio),
  -- LA garantía: dos ocupaciones activas del mismo equipo no pueden solaparse. Aunque haya mil solicitudes simultáneas.
  constraint sin_solapamiento exclude using gist (equipo_id with =, periodo with &&) where (estado = 'activa')
);
create index reservas_usuario_idx on reservas (usuario_id, inicio desc);

create function trg_tocar() returns trigger language plpgsql as $$
begin new.actualizado_en := now(); return new; end $$;
create trigger reservas_tocar before update on reservas for each row execute function trg_tocar();

create function trg_no_borrar() returns trigger language plpgsql as $$
begin raise exception 'Las reservas no se borran: se cancelan (queda historial).'; end $$;
create trigger reservas_no_borrar before delete on reservas for each row execute function trg_no_borrar();

-- ------------------------------------------------- HISTORIAL (append-only) Y COLA DE NOTIFICACIONES
create table reservas_historial (
  id         bigint generated always as identity primary key,
  reserva_id uuid not null,
  accion     text not null,           -- creada | extendida | liberada | cancelada | modificada
  actor      uuid,
  antes      jsonb,
  despues    jsonb,
  creado_en  timestamptz not null default now()
);

create table cola_notificaciones (
  id          bigint generated always as identity primary key,
  reserva_id  uuid not null,
  tipo        text not null,           -- confirmacion | extension | liberacion | cancelacion | fin_proximo
  usuario_id  uuid not null,
  dedupe_key  text not null unique,    -- evita avisos repetidos
  creado_en   timestamptz not null default now(),
  enviado_en  timestamptz
);

create function trg_historial() returns trigger language plpgsql security definer set search_path = public as $$
declare v_accion text; begin
  if tg_op = 'INSERT' then v_accion := 'creada';
  elsif new.estado = 'cancelada' and old.estado <> 'cancelada' then v_accion := 'cancelada';
  elsif new.liberada_en is not null and old.liberada_en is null then v_accion := 'liberada';
  elsif new.fin > old.fin then v_accion := 'extendida';
  else v_accion := 'modificada'; end if;

  insert into reservas_historial (reserva_id, accion, actor, antes, despues)
  values (new.id, v_accion, auth.uid(), case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new));

  if new.tipo = 'reserva' and v_accion in ('creada', 'extendida', 'liberada', 'cancelada') then
    insert into cola_notificaciones (reserva_id, tipo, usuario_id, dedupe_key)
    values (new.id,
            case v_accion when 'creada' then 'confirmacion' when 'extendida' then 'extension'
                          when 'liberada' then 'liberacion' else 'cancelacion' end,
            new.usuario_id, v_accion || ':' || new.id || ':' || extract(epoch from new.fin)::text)
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
end $$;
create trigger reservas_historial_t after insert or update on reservas for each row execute function trg_historial();

-- ------------------------------------------------------------------ MANTENIMIENTO
create table mantenimientos (
  id              uuid primary key default gen_random_uuid(),
  equipo_id       uuid not null references equipos (id),
  tipo            text not null check (tipo in ('preventivo', 'correctivo', 'calibracion', 'inspeccion', 'otro')),
  descripcion     text not null,
  fecha           date not null,
  responsable     text,
  frecuencia_dias int check (frecuencia_dias > 0),   -- solo si lo define el fabricante o el responsable técnico
  proximo         date,
  estado          text not null default 'realizado' check (estado in ('programado', 'realizado', 'cancelado')),
  costo           numeric(12, 2),
  enlace_evidencia text,
  creado_por      uuid references perfiles (id),
  creado_en       timestamptz not null default now()
);

create view equipos_mantenimiento with (security_invoker = true) as
select e.id as equipo_id, e.codigo,
       u.fecha as ultimo,
       coalesce(p.proximo, u.proximo) as proximo,
       coalesce(coalesce(p.proximo, u.proximo) < current_date, false) as vencido
from equipos e
left join lateral (select fecha, proximo from mantenimientos
                    where equipo_id = e.id and estado = 'realizado' order by fecha desc, creado_en desc limit 1) u on true
left join lateral (select min(proximo) as proximo from mantenimientos
                    where equipo_id = e.id and estado = 'programado' and proximo is not null) p on true;

-- ------------------------------------------------------------------ SEGURIDAD
create function es_staff() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles where id = auth.uid() and activo and rol in ('laboratorista', 'administrador')) $$;
create function es_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles where id = auth.uid() and activo and rol = 'administrador') $$;

alter table perfiles            enable row level security;
alter table equipos             enable row level security;
alter table politicas           enable row level security;
alter table reservas            enable row level security;
alter table reservas_historial  enable row level security;
alter table cola_notificaciones enable row level security;
alter table mantenimientos      enable row level security;

create policy perfiles_ver  on perfiles for select to authenticated using (id = auth.uid() or es_staff());
create policy perfiles_edit on perfiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and rol = (select p.rol from perfiles p where p.id = auth.uid()) and activo);   -- nadie se asciende solo

create policy equipos_ver   on equipos for select to authenticated using (not archivado or es_staff());
create policy equipos_staff on equipos for all to authenticated using (es_staff()) with check (es_staff());
create policy politicas_ver on politicas for select to authenticated using (true);
create policy politicas_adm on politicas for all to authenticated using (es_admin()) with check (es_admin());

create policy reservas_ver  on reservas for select to authenticated using (usuario_id = auth.uid() or es_staff());
-- (sin políticas de insert/update/delete: los clientes NO escriben reservas directamente; solo las funciones de abajo)
create policy historial_ver on reservas_historial for select to authenticated
  using (es_staff() or exists (select 1 from reservas r where r.id = reserva_id and r.usuario_id = auth.uid()));
create policy mant_ver      on mantenimientos for select to authenticated using (es_staff());
create policy mant_staff    on mantenimientos for all to authenticated using (es_staff()) with check (es_staff());

revoke all on all tables in schema public from anon, authenticated;
grant select on perfiles, equipos, politicas, reservas, reservas_historial, mantenimientos to authenticated;
grant update (nombre, programa) on perfiles to authenticated;
grant insert, update, delete on equipos, mantenimientos to authenticated;      -- filtrado por RLS (solo staff)
grant update, insert, delete on politicas to authenticated;                    -- filtrado por RLS (solo administrador)

-- Ocupación pública: horarios y avisos, SIN datos personales (calendario y ficha del equipo)
create view ocupacion_publica as
select r.equipo_id, e.codigo, r.tipo, r.inicio, r.fin, r.desatendido, r.mensaje_llegada,
       case when r.tipo = 'bloqueo' then r.motivo end as motivo
from reservas r join equipos e on e.id = r.equipo_id
where r.estado = 'activa' and r.fin > now() - interval '1 day';
grant select on ocupacion_publica to authenticated;

-- Estado "visible" calculado a partir del tiempo (no se almacena: no puede quedar desactualizado)
create view reservas_estado with (security_invoker = true) as
select r.*,
       case when r.estado = 'cancelada' then 'cancelada'
            when r.liberada_en is not null or r.fin <= now() then 'finalizada'
            when r.inicio > now() then 'activa'
            when r.llegada_en is null and now() > r.inicio + make_interval(mins => politica_int('tolerancia_llegada_min')) then 'sin_llegada'
            else 'en_curso' end as estado_vigente
from reservas r;
grant select on reservas_estado to authenticated;

-- ----------------------------------------------------------- FUNCIONES DE NEGOCIO (RPC)
create function asignar_rol(p_usuario uuid, p_rol rol_usuario) returns void language plpgsql security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'Solo un administrador puede asignar roles.' using errcode = '42501'; end if;
  if p_usuario = auth.uid() then raise exception 'No puede cambiar su propio rol.'; end if;
  update perfiles set rol = p_rol where id = p_usuario;
end $$;
create function activar_usuario(p_usuario uuid, p_activo boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'Solo un administrador puede habilitar o inhabilitar usuarios.' using errcode = '42501'; end if;
  if p_usuario = auth.uid() then raise exception 'No puede inhabilitarse a sí mismo.'; end if;
  update perfiles set activo = p_activo where id = p_usuario;
end $$;

create function _perfil_activo() returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid := auth.uid(); begin
  if v is null then raise exception 'Debe iniciar sesión.' using errcode = '28000'; end if;
  if not exists (select 1 from perfiles where id = v and activo) then raise exception 'Su cuenta no está habilitada.' using errcode = '42501'; end if;
  return v;
end $$;

create function crear_reserva(p_equipo text, p_inicio timestamptz, p_fin timestamptz, p_actividad text default null,
                              p_detalle text default null, p_desatendido boolean default false,
                              p_mensaje text default null, p_id_solicitud text default null)
returns reservas language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); v_eq equipos; v_res reservas; v_staff boolean := es_staff(); begin
  if p_id_solicitud is not null then                                     -- reintento: devuelve la misma reserva
    select * into v_res from reservas where id_solicitud = p_id_solicitud and usuario_id = v;
    if found then return v_res; end if;
  end if;
  select * into v_eq from equipos where codigo = upper(p_equipo) and not archivado;
  if not found then raise exception 'Equipo no encontrado.'; end if;
  if v_eq.estado <> 'activo' then raise exception 'El equipo no está disponible (% ).', v_eq.estado; end if;
  if p_inicio < now() - interval '5 minutes' then raise exception 'La hora de inicio no puede ser anterior a 5 minutos respecto a la actual.'; end if;
  if p_fin <= p_inicio then raise exception 'El fin debe ser posterior al inicio.'; end if;
  if not v_staff then
    if p_fin - p_inicio > make_interval(hours => politica_int('duracion_max_horas')) then raise exception 'Supera la duración máxima permitida (% h).', politica_int('duracion_max_horas'); end if;
    if p_inicio > now() + make_interval(days => politica_int('anticipacion_max_dias')) then raise exception 'Solo se puede reservar con % días de anticipación.', politica_int('anticipacion_max_dias'); end if;
  end if;
  begin
    insert into reservas (tipo, equipo_id, usuario_id, inicio, fin, actividad, detalle, desatendido, mensaje_llegada, id_solicitud)
    values ('reserva', v_eq.id, v, p_inicio, p_fin, p_actividad, p_detalle, coalesce(p_desatendido, false), nullif(trim(p_mensaje), ''), p_id_solicitud)
    returning * into v_res;
  exception when exclusion_violation then
    raise exception 'El equipo ya está reservado (o en revisión) en ese intervalo.' using errcode = 'P0001';
  end;
  return v_res;
end $$;

create function extender_reserva(p_reserva uuid, p_nuevo_fin timestamptz)
returns reservas language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); v_res reservas; begin
  select * into v_res from reservas where id = p_reserva and tipo = 'reserva' for update;
  if not found or (v_res.usuario_id <> v and not es_staff()) then raise exception 'Reserva no encontrada.'; end if;
  if v_res.estado <> 'activa' then raise exception 'La reserva está cancelada.'; end if;
  if v_res.fin <= now() then raise exception 'La reserva ya terminó: haga una nueva.'; end if;
  if p_nuevo_fin <= v_res.fin then raise exception 'El nuevo fin debe ser posterior al actual.'; end if;
  if not es_staff() and p_nuevo_fin - v_res.fin > make_interval(hours => politica_int('extension_max_horas')) then
    raise exception 'Una extensión admite como máximo % h.', politica_int('extension_max_horas'); end if;
  if not es_staff() and p_nuevo_fin - v_res.inicio > make_interval(hours => politica_int('duracion_max_horas')) then
    raise exception 'Supera la duración máxima permitida (% h).', politica_int('duracion_max_horas'); end if;
  begin
    update reservas set fin = p_nuevo_fin where id = p_reserva returning * into v_res;
  exception when exclusion_violation then
    raise exception 'No se puede extender: el equipo tiene otra reserva o revisión en ese tramo.' using errcode = 'P0001';
  end;
  return v_res;
end $$;

create function cancelar_reserva(p_reserva uuid, p_motivo text default null)
returns reservas language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); v_res reservas; begin
  select * into v_res from reservas where id = p_reserva and tipo = 'reserva' for update;
  if not found or (v_res.usuario_id <> v and not es_staff()) then raise exception 'Reserva no encontrada.'; end if;
  if v_res.estado = 'cancelada' then raise exception 'La reserva ya estaba cancelada.'; end if;
  if v_res.fin <= now() then raise exception 'La reserva ya terminó.'; end if;
  update reservas set estado = 'cancelada', motivo = nullif(trim(p_motivo), '') where id = p_reserva returning * into v_res;
  return v_res;
end $$;

create function liberar_reserva(p_reserva uuid)
returns reservas language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); v_res reservas; begin
  select * into v_res from reservas where id = p_reserva and tipo = 'reserva' for update;
  if not found or (v_res.usuario_id <> v and not es_staff()) then raise exception 'Reserva no encontrada.'; end if;
  if v_res.estado <> 'activa' or v_res.fin <= now() then raise exception 'La reserva ya terminó o está cancelada.'; end if;
  if v_res.inicio >= now() then raise exception 'La reserva aún no comienza: si no la va a usar, cancélela.'; end if;
  update reservas set fin = now(), liberada_en = now() where id = p_reserva returning * into v_res;
  return v_res;
end $$;

create function registrar_llegada(p_reserva uuid) returns reservas language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); v_res reservas; begin
  select * into v_res from reservas where id = p_reserva and tipo = 'reserva' and usuario_id = v for update;
  if not found then raise exception 'Reserva no encontrada.'; end if;
  update reservas set llegada_en = coalesce(llegada_en, now()) where id = p_reserva returning * into v_res;
  return v_res;
end $$;

-- Bloqueo de gestión. Si hay reservas en el intervalo: falla, o las cancela (con motivo) en la MISMA transacción.
create function crear_bloqueo(p_equipo text, p_inicio timestamptz, p_fin timestamptz, p_motivo text, p_cancelar_conflictos boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); v_eq equipos; v_n int; v_b reservas; begin
  if not es_staff() then raise exception 'Solo la administración puede bloquear equipos.' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escriba el motivo del bloqueo.'; end if;
  if p_fin <= p_inicio or p_fin <= now() then raise exception 'Intervalo de bloqueo inválido.'; end if;
  select * into v_eq from equipos where codigo = upper(p_equipo) and not archivado;
  if not found then raise exception 'Equipo no encontrado.'; end if;

  select count(*) into v_n from reservas
   where equipo_id = v_eq.id and estado = 'activa' and periodo && tstzrange(p_inicio, p_fin, '[)');
  if v_n > 0 and not p_cancelar_conflictos then
    raise exception 'Hay % reserva(s) en ese intervalo. Cancélelas primero o repita con cancelar_conflictos.', v_n using errcode = 'P0001';
  end if;
  update reservas set estado = 'cancelada', motivo = 'Bloqueo de gestión: ' || trim(p_motivo)
   where equipo_id = v_eq.id and estado = 'activa' and periodo && tstzrange(p_inicio, p_fin, '[)');
  insert into reservas (tipo, equipo_id, usuario_id, inicio, fin, motivo)
  values ('bloqueo', v_eq.id, v, p_inicio, p_fin, trim(p_motivo)) returning * into v_b;
  return jsonb_build_object('bloqueo', v_b.id, 'canceladas', v_n);
end $$;

-- Validación del QR (la usa el laboratorista; un usuario común solo recibe el veredicto, sin datos de nadie)
create function validar_credencial(p_token text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_r reservas; v_e equipos; v_res text; v_staff boolean; begin
  perform _perfil_activo(); v_staff := es_staff();
  select * into v_r from reservas where token_credencial = p_token and tipo = 'reserva';
  if not found then return jsonb_build_object('resultado', 'no_encontrada'); end if;
  select * into v_e from equipos where id = v_r.equipo_id;
  v_res := case when v_r.estado = 'cancelada' then 'cancelada'
                when v_r.liberada_en is not null or v_r.fin <= now() then 'vencida'
                when v_r.inicio > now() then 'aun_no_vigente'
                else 'valida' end;
  return jsonb_build_object('resultado', v_res) ||
         case when v_staff then jsonb_build_object('equipo', v_e.codigo, 'inicio', v_r.inicio, 'fin', v_r.fin,
                   'titular', (select nombre from perfiles where id = v_r.usuario_id)) else '{}'::jsonb end;
end $$;

-- Recordatorio de fin (lo invoca un cron cada pocos minutos). Idempotente: no repite avisos.
create function encolar_recordatorios_fin(p_minutos int default 30) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int; begin
  with ins as (
    insert into cola_notificaciones (reserva_id, tipo, usuario_id, dedupe_key)
    select r.id, 'fin_proximo', r.usuario_id, 'fin_proximo:' || r.id || ':' || extract(epoch from r.fin)::text
      from reservas r
     where r.tipo = 'reserva' and r.estado = 'activa' and r.liberada_en is null
       and r.inicio <= now() and r.fin > now() and r.fin <= now() + make_interval(mins => p_minutos)
    on conflict (dedupe_key) do nothing returning 1)
  select count(*) into v_n from ins;
  return v_n;
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function es_staff, es_admin, politica_int to authenticated;                -- las usan las políticas y vistas
grant execute on function crear_reserva, extender_reserva, cancelar_reserva, liberar_reserva, registrar_llegada,
                          crear_bloqueo, validar_credencial, asignar_rol, activar_usuario to authenticated;
grant select on equipos_mantenimiento to authenticated;
-- encolar_recordatorios_fin: SOLO con la clave de servicio (cron / Edge Function), nunca desde el navegador.