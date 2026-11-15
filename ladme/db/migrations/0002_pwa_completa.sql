-- ============================================================================
-- 0002 — PWA completa
--
-- Aplicar UNA vez en el SQL Editor de Supabase, sobre un proyecto que ya tiene
-- schema_ladme.sql (y, si aplica, 0001). Todo corre en una transacción: si algo
-- falla, no queda nada a medias.
--
-- Qué agrega:
--   A. Perfil académico (tipo de usuario, programa, matrícula) y nombre de Google.
--   B. Políticas nuevas (excepciones, contacto, recordatorio).
--   C. Reservas: actividad validada, datos académicos congelados, fecha de
--      cancelación real, límites que solo el administrador puede saltarse.
--   D. Avisos con título y texto (centro de avisos, Web Push y correo).
--   E. Contacto anónimo al titular de un equipo.
--   F. Solicitudes de reserva larga con aprobación.
--   G. Bloqueos (cancelar), llegada registrada por el personal, validación QR.
--   H. Mantenimiento: avisos a TODO el personal.
--   I. Recordatorios de fin, aviso de no-show y cola de correo para Apps Script.
--   J. Estadísticas.
--   K. Importación desde Google Sheets (con reclamo automático al ingresar).
--   L. Permisos.
-- ============================================================================

begin;

-- ------------------------------------------------------------------ A. PERFIL
alter table perfiles add column if not exists tipo_usuario text
  check (tipo_usuario in ('Estudiante', 'Docente/Investigador'));
alter table perfiles add column if not exists matricula text
  check (matricula is null or char_length(matricula) <= 40);
alter table perfiles drop constraint if exists perfiles_programa_largo;
alter table perfiles add constraint perfiles_programa_largo
  check (programa is null or char_length(programa) <= 150);

-- Google entrega el nombre real en full_name o name.
create or replace function crear_perfil_al_registrarse() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if split_part(lower(coalesce(new.email, '')), '@', 2) <> 'unal.edu.co' then
    raise exception 'Solo se permiten cuentas institucionales @unal.edu.co.' using errcode = '42501';
  end if;
  insert into perfiles (id, correo, nombre)
  values (new.id, lower(new.email),
          left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
                        nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
                        split_part(new.email, '@', 1)), 120))
  on conflict (id) do nothing;
  return new;
end $$;

-- --------------------------------------------------------------- B. POLÍTICAS
insert into politicas (clave, valor, descripcion) values
  ('excepcion_max_horas',  '720', 'Duración máxima que se puede pedir en una solicitud de reserva larga (30 días).'),
  ('contacto_espera_min',  '15',  'Minutos que deben pasar antes de volver a escribir al titular del mismo equipo.'),
  ('recordatorio_fin_min', '60',  'Con cuántos minutos de anticipación se avisa que la reserva termina.')
on conflict (clave) do nothing;

-- ---------------------------------------------------------------- C. RESERVAS
alter table reservas add column if not exists programa text;
alter table reservas add column if not exists matricula text;
alter table reservas add column if not exists tipo_usuario text;
alter table reservas add column if not exists excepcion boolean not null default false;

-- El esquema base intentaba fijar cancelada_en desde un trigger AFTER (no tiene
-- efecto). Se fija aquí, antes de guardar.
create or replace function trg_cancelada() returns trigger language plpgsql as $$
begin
  if new.estado = 'cancelada' and old.estado <> 'cancelada' then
    new.cancelada_en := coalesce(new.cancelada_en, now());
  end if;
  return new;
end $$;
drop trigger if exists reservas_cancelada on reservas;
create trigger reservas_cancelada before update on reservas for each row execute function trg_cancelada();

-- La vista se recrea para que incluya las columnas nuevas.
drop view if exists reservas_estado;
create view reservas_estado with (security_invoker = true) as
select r.*,
       case when r.estado = 'cancelada' then 'cancelada'
            when r.liberada_en is not null or r.fin <= now() then 'finalizada'
            when r.inicio > now() then 'activa'
            when r.llegada_en is null and now() > r.inicio + make_interval(mins => politica_int('tolerancia_llegada_min')) then 'sin_llegada'
            else 'en_curso' end as estado_vigente
from reservas r;

-- ------------------------------------------------------------------ D. AVISOS
alter table cola_notificaciones drop constraint if exists cola_un_origen;
alter table cola_notificaciones add constraint cola_un_origen
  check (num_nonnulls(reserva_id, mantenimiento_id) <= 1);
alter table cola_notificaciones add column if not exists titulo text;
alter table cola_notificaciones add column if not exists cuerpo text;
alter table cola_notificaciones add column if not exists url text;
alter table cola_notificaciones add column if not exists responder_a text;
alter table cola_notificaciones add column if not exists leido_en timestamptz;
alter table cola_notificaciones add column if not exists correo boolean not null default true;
create index if not exists cola_usuario_idx on cola_notificaciones (usuario_id, creado_en desc);

-- Lo que ya estaba en la cola (pruebas) se da por atendido: evita una ráfaga de
-- correos y avisos viejos al activar los envíos.
update cola_notificaciones
   set enviado_en = coalesce(enviado_en, now()),
       push_enviado_en = coalesce(push_enviado_en, now()),
       leido_en = coalesce(leido_en, now());

create or replace function _fmt(p timestamptz) returns text language sql stable as $$
  select to_char(p at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') $$;

create or replace function _avisar(p_usuario uuid, p_tipo text, p_dedupe text, p_titulo text, p_cuerpo text,
                                   p_url text, p_reserva uuid default null, p_mant uuid default null,
                                   p_responder text default null, p_correo boolean default true)
returns void language sql security definer set search_path = public as $$
  insert into cola_notificaciones (usuario_id, tipo, dedupe_key, titulo, cuerpo, url, reserva_id, mantenimiento_id, responder_a, correo)
  select p_usuario, p_tipo, p_dedupe, p_titulo, p_cuerpo, p_url, p_reserva, p_mant, p_responder, p_correo
   where p_usuario is not null
  on conflict (dedupe_key) do nothing $$;

-- Una fila por cada persona del personal (o solo administradores).
create or replace function _avisar_staff(p_tipo text, p_dedupe text, p_titulo text, p_cuerpo text, p_url text,
                                         p_reserva uuid default null, p_mant uuid default null,
                                         p_solo_admin boolean default false)
returns void language sql security definer set search_path = public as $$
  insert into cola_notificaciones (usuario_id, tipo, dedupe_key, titulo, cuerpo, url, reserva_id, mantenimiento_id)
  select p.id, p_tipo, p_dedupe || ':' || p.id, p_titulo, p_cuerpo, p_url, p_reserva, p_mant
    from perfiles p
   where p.activo and (p.rol = 'administrador' or (not p_solo_admin and p.rol = 'laboratorista'))
  on conflict (dedupe_key) do nothing $$;

create or replace function marcar_avisos_leidos() returns void
language sql security definer set search_path = public as $$
  update cola_notificaciones set leido_en = now() where usuario_id = auth.uid() and leido_en is null $$;

-- Historial + avisos de cada cambio de una reserva.
create or replace function trg_historial() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_accion text; v_cod text; v_tit text; v_txt text; v_tipo text; v_correo boolean := true; begin
  if tg_op = 'INSERT' then v_accion := 'creada';
  elsif new.estado = 'cancelada' and old.estado <> 'cancelada' then v_accion := 'cancelada';
  elsif new.liberada_en is not null and old.liberada_en is null then v_accion := 'liberada';
  elsif new.fin > old.fin then v_accion := 'extendida';
  else v_accion := 'modificada'; end if;

  insert into reservas_historial (reserva_id, accion, actor, antes, despues)
  values (new.id, v_accion, auth.uid(), case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new));

  if new.tipo = 'reserva' and v_accion in ('creada', 'extendida', 'liberada', 'cancelada') then
    select codigo into v_cod from equipos where id = new.equipo_id;
    if v_accion = 'creada' then
      v_tipo := 'confirmacion'; v_tit := 'Reserva confirmada: ' || v_cod;
      v_txt := 'Su reserva ' || new.codigo_legible || ' del equipo ' || v_cod || ' va del ' || _fmt(new.inicio) ||
               ' al ' || _fmt(new.fin) || '. Abra LADME para ver su credencial con QR.';
    elsif v_accion = 'extendida' then
      v_tipo := 'extension'; v_tit := 'Reserva extendida: ' || v_cod;
      v_txt := 'Su reserva ' || new.codigo_legible || ' ahora termina el ' || _fmt(new.fin) || '.';
    elsif v_accion = 'liberada' then
      v_tipo := 'liberacion'; v_tit := 'Equipo liberado: ' || v_cod; v_correo := false;
      v_txt := 'Gracias por liberar el equipo. Ya está disponible para otra persona.';
    else
      v_tipo := 'cancelacion'; v_tit := 'Reserva cancelada: ' || v_cod;
      v_correo := auth.uid() is distinct from new.usuario_id;   -- solo se envía correo si la canceló otra persona
      v_txt := 'La reserva ' || new.codigo_legible || ' (' || _fmt(new.inicio) || ' a ' || _fmt(new.fin) || ') fue cancelada' ||
               case when v_correo then ' por el laboratorio' else '' end || '.' ||
               case when nullif(trim(coalesce(new.motivo, '')), '') is not null then ' Motivo: ' || new.motivo else '' end;
    end if;
    perform _avisar(new.usuario_id, v_tipo,
                    v_accion || ':' || new.id || ':' || extract(epoch from new.fin)::text,
                    v_tit, v_txt, '/credencial/' || new.id, new.id, null, null, v_correo);
  end if;
  return new;
end $$;

-- ------------------------------------------------- C (cont.). RPC DE RESERVAS
create or replace function _actividad_valida(p text) returns boolean language sql immutable as $$
  select p in ('Docencia', 'Investigación', 'PAE', 'Semilleros', 'Trabajo de grado', 'Otro') $$;

create or replace function crear_reserva(p_equipo text, p_inicio timestamptz, p_fin timestamptz, p_actividad text default null,
                              p_detalle text default null, p_desatendido boolean default false,
                              p_mensaje text default null, p_id_solicitud text default null)
returns reservas language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); v_eq equipos; v_res reservas; v_admin boolean := es_admin(); v_p perfiles; begin
  if p_id_solicitud is not null then                                     -- reintento: devuelve la misma reserva
    select * into v_res from reservas where id_solicitud = p_id_solicitud and usuario_id = v;
    if found then return v_res; end if;
  end if;
  select * into v_p from perfiles where id = v;
  if v_p.tipo_usuario is null or nullif(trim(coalesce(v_p.programa, '')), '') is null
     or (v_p.tipo_usuario = 'Estudiante' and nullif(trim(coalesce(v_p.matricula, '')), '') is null) then
    raise exception 'Complete su perfil (tipo de usuario, programa y matrícula) antes de reservar.';
  end if;
  if not _actividad_valida(p_actividad) then raise exception 'Seleccione el tipo de actividad.'; end if;
  select * into v_eq from equipos where codigo = upper(p_equipo) and not archivado;
  if not found then raise exception 'Equipo no encontrado.'; end if;
  if v_eq.estado <> 'activo' then raise exception 'El equipo no está disponible (%).', replace(v_eq.estado::text, '_', ' '); end if;
  if p_inicio < now() - interval '5 minutes' then raise exception 'La hora de inicio no puede ser anterior a 5 minutos respecto a la actual.'; end if;
  if p_fin <= p_inicio then raise exception 'El fin debe ser posterior al inicio.'; end if;
  if not v_admin then        -- solo el administrador puede saltarse los límites (el laboratorista no)
    if p_fin - p_inicio > make_interval(hours => politica_int('duracion_max_horas')) then
      raise exception 'Supera el máximo de % h. Para más tiempo, envíe una solicitud de reserva larga.',
        politica_int('duracion_max_horas');
    end if;
    if p_inicio > now() + make_interval(days => politica_int('anticipacion_max_dias')) then
      raise exception 'Solo se puede reservar con % días de anticipación.', politica_int('anticipacion_max_dias');
    end if;
    if politica_int('reservas_activas_max') > 0
       and (select count(*) from reservas r
             where r.usuario_id = v and r.tipo = 'reserva' and r.estado = 'activa' and r.fin > now())
           >= politica_int('reservas_activas_max') then
      raise exception 'Ya tiene el máximo de reservas vigentes permitido (%).', politica_int('reservas_activas_max');
    end if;
  end if;
  begin
    insert into reservas (tipo, equipo_id, usuario_id, inicio, fin, actividad, detalle, desatendido, mensaje_llegada,
                          id_solicitud, programa, matricula, tipo_usuario)
    values ('reserva', v_eq.id, v, p_inicio, p_fin, p_actividad, nullif(trim(p_detalle), ''), coalesce(p_desatendido, false),
            nullif(trim(p_mensaje), ''), p_id_solicitud, v_p.programa, v_p.matricula, v_p.tipo_usuario)
    returning * into v_res;
  exception when exclusion_violation then
    raise exception 'El equipo ya está reservado (o en revisión) en ese intervalo.' using errcode = 'P0001';
  end;
  return v_res;
end $$;

create or replace function extender_reserva(p_reserva uuid, p_nuevo_fin timestamptz)
returns reservas language plpgsql security definer set search_path = public as $$
declare
  v uuid := _perfil_activo(); v_res reservas;
  v_staff boolean := es_staff(); v_admin boolean := es_admin();
begin
  select * into v_res from reservas where id = p_reserva and tipo = 'reserva' for update;
  if not found or (v_res.usuario_id <> v and not v_staff) then raise exception 'Reserva no encontrada.'; end if;
  if v_res.estado <> 'activa' then raise exception 'La reserva está cancelada.'; end if;
  if v_res.fin <= now() then raise exception 'La reserva ya terminó: haga una nueva.'; end if;
  if p_nuevo_fin <= v_res.fin then raise exception 'El nuevo fin debe ser posterior al actual.'; end if;

  if not v_admin then
    if v_res.extensiones >= politica_int('extensiones_max') then
      raise exception 'Esta reserva ya usó su extensión permitida.';
    end if;
    if p_nuevo_fin - v_res.fin > make_interval(hours => politica_int('extension_max_horas')) then
      raise exception 'Una extensión admite como máximo % h.', politica_int('extension_max_horas');
    end if;
    if not v_res.excepcion
       and p_nuevo_fin - v_res.inicio > make_interval(hours => politica_int('duracion_max_total_horas')) then
      raise exception 'La reserva no puede superar % h en total.', politica_int('duracion_max_total_horas');
    end if;
  end if;

  begin
    update reservas set fin = p_nuevo_fin, extensiones = extensiones + 1
     where id = p_reserva returning * into v_res;
  exception when exclusion_violation then
    raise exception 'No se puede extender: el equipo tiene otra reserva o revisión en ese tramo.' using errcode = 'P0001';
  end;
  return v_res;
end $$;

-- ---------------------------------------------- G. LLEGADA, BLOQUEOS, QR
-- El titular o el personal (al validar el QR) registran la llegada.
create or replace function registrar_llegada(p_reserva uuid) returns reservas
language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); v_res reservas; begin
  select * into v_res from reservas where id = p_reserva and tipo = 'reserva' for update;
  if not found or (v_res.usuario_id <> v and not es_staff()) then raise exception 'Reserva no encontrada.'; end if;
  if v_res.estado <> 'activa' or v_res.fin <= now() then raise exception 'La reserva ya terminó o está cancelada.'; end if;
  if v_res.inicio > now() + interval '15 minutes' then raise exception 'La reserva aún no comienza.'; end if;
  update reservas set llegada_en = coalesce(llegada_en, now()) where id = p_reserva returning * into v_res;
  return v_res;
end $$;

create or replace function cancelar_bloqueo(p_bloqueo uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _perfil_activo();
  if not es_staff() then raise exception 'Solo el personal del laboratorio puede quitar bloqueos.' using errcode = '42501'; end if;
  update reservas set estado = 'cancelada', motivo = coalesce(motivo, '') || ' (bloqueo retirado)'
   where id = p_bloqueo and tipo = 'bloqueo' and estado = 'activa';
  if not found then raise exception 'El bloqueo no existe o ya fue retirado.'; end if;
end $$;

create or replace function validar_credencial(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
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
         case when v_staff then jsonb_build_object(
                'reserva', v_r.id, 'codigo', v_r.codigo_legible, 'equipo', v_e.codigo,
                'inicio', v_r.inicio, 'fin', v_r.fin, 'llegada', v_r.llegada_en,
                'titular', (select nombre from perfiles where id = v_r.usuario_id))
              else '{}'::jsonb end;
end $$;

-- ---------------------------------------------------------------- E. CONTACTO
create table if not exists contactos (
  id          bigint generated always as identity primary key,
  solicitante uuid not null references perfiles (id),
  equipo_id   uuid not null references equipos (id),
  reserva_id  uuid not null references reservas (id),
  mensaje     text check (char_length(mensaje) <= 300),
  creado_en   timestamptz not null default now()
);
create index if not exists contactos_idx on contactos (solicitante, equipo_id, creado_en desc);
alter table contactos enable row level security;
drop policy if exists contactos_ver on contactos;
create policy contactos_ver on contactos for select to authenticated using (es_staff());

-- Escribe a quien tiene el equipo AHORA, sin revelar al solicitante quién es.
-- El titular sí ve el correo de quien pregunta, para poder responderle.
create or replace function contactar_titular(p_equipo text, p_mensaje text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); v_eq equipos; v_r reservas; v_correo text; v_msg text; v_id bigint; begin
  select * into v_eq from equipos where codigo = upper(p_equipo) and not archivado;
  if not found then raise exception 'Equipo no encontrado.'; end if;
  v_msg := left(regexp_replace(trim(coalesce(p_mensaje, '')), '[\r\n\t]+', ' ', 'g'), 300);
  select * into v_r from reservas
   where equipo_id = v_eq.id and tipo = 'reserva' and estado = 'activa' and inicio <= now() and fin > now()
   order by fin desc limit 1;
  if not found then raise exception 'En este momento no hay una reserva en curso en ese equipo.'; end if;
  if v_r.usuario_id = v then raise exception 'Usted es quien tiene este equipo reservado.'; end if;
  if exists (select 1 from contactos c where c.solicitante = v and c.equipo_id = v_eq.id
               and c.creado_en > now() - make_interval(mins => politica_int('contacto_espera_min'))) then
    raise exception 'Ya envió un mensaje sobre este equipo hace poco. Espere unos minutos antes de insistir.';
  end if;
  select correo into v_correo from perfiles where id = v;
  insert into contactos (solicitante, equipo_id, reserva_id, mensaje) values (v, v_eq.id, v_r.id, nullif(v_msg, ''))
  returning id into v_id;
  perform _avisar(v_r.usuario_id, 'contacto', 'contacto:' || v_id,
                  'Preguntan por el equipo ' || v_eq.codigo,
                  v_correo || ' quiere saber si puede usar el equipo ' || v_eq.codigo ||
                  ', que usted tiene reservado hasta el ' || _fmt(v_r.fin) || '.' ||
                  case when v_msg <> '' then ' Mensaje: «' || v_msg || '»' else '' end ||
                  ' Si ya terminó, libere el equipo desde Mis reservas.',
                  '/mis-reservas', v_r.id, null, v_correo);
end $$;

-- ------------------------------------------- F. SOLICITUDES DE RESERVA LARGA
create table if not exists solicitudes_excepcion (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid not null references perfiles (id),
  equipo_id     uuid not null references equipos (id),
  inicio        timestamptz not null,
  fin           timestamptz not null,
  actividad     text,
  detalle       text check (char_length(detalle) <= 800),
  justificacion text not null check (char_length(justificacion) between 10 and 800),
  estado        text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada', 'retirada')),
  respuesta     text check (char_length(respuesta) <= 500),
  resuelto_por  uuid references perfiles (id),
  resuelto_en   timestamptz,
  reserva_id    uuid references reservas (id),
  creado_en     timestamptz not null default now(),
  constraint sol_fin_posterior check (fin > inicio)
);
create index if not exists solicitudes_usuario_idx on solicitudes_excepcion (usuario_id, creado_en desc);
alter table solicitudes_excepcion enable row level security;
drop policy if exists solicitudes_ver on solicitudes_excepcion;
create policy solicitudes_ver on solicitudes_excepcion for select to authenticated
  using (usuario_id = auth.uid() or es_staff());

create or replace function solicitar_excepcion(p_equipo text, p_inicio timestamptz, p_fin timestamptz,
                                               p_actividad text, p_detalle text, p_justificacion text)
returns solicitudes_excepcion language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); v_eq equipos; v_s solicitudes_excepcion; v_p perfiles; begin
  select * into v_p from perfiles where id = v;
  if v_p.tipo_usuario is null or nullif(trim(coalesce(v_p.programa, '')), '') is null then
    raise exception 'Complete su perfil antes de enviar una solicitud.';
  end if;
  if not _actividad_valida(p_actividad) then raise exception 'Seleccione el tipo de actividad.'; end if;
  if char_length(trim(coalesce(p_justificacion, ''))) < 10 then
    raise exception 'Explique por qué necesita más tiempo (mínimo 10 caracteres).';
  end if;
  select * into v_eq from equipos where codigo = upper(p_equipo) and not archivado;
  if not found then raise exception 'Equipo no encontrado.'; end if;
  if p_inicio < now() - interval '5 minutes' then raise exception 'La hora de inicio no puede estar en el pasado.'; end if;
  if p_fin - p_inicio <= make_interval(hours => politica_int('duracion_max_horas')) then
    raise exception 'Esa duración no necesita solicitud: reserve directamente.';
  end if;
  if p_fin - p_inicio > make_interval(hours => politica_int('excepcion_max_horas')) then
    raise exception 'Una solicitud admite como máximo % h.', politica_int('excepcion_max_horas');
  end if;
  if (select count(*) from solicitudes_excepcion where usuario_id = v and estado = 'pendiente') >= 3 then
    raise exception 'Ya tiene 3 solicitudes pendientes. Espere la respuesta o retire una.';
  end if;
  insert into solicitudes_excepcion (usuario_id, equipo_id, inicio, fin, actividad, detalle, justificacion)
  values (v, v_eq.id, p_inicio, p_fin, p_actividad, nullif(trim(p_detalle), ''), trim(p_justificacion))
  returning * into v_s;
  perform _avisar_staff('solicitud_excepcion', 'sol:' || v_s.id,
                        'Solicitud de reserva larga: ' || v_eq.codigo,
                        v_p.nombre || ' pide el equipo ' || v_eq.codigo || ' del ' || _fmt(p_inicio) || ' al ' || _fmt(p_fin) ||
                        '. Revísela en el panel de administración.',
                        '/admin?tab=solicitudes', null, null, true);
  return v_s;
end $$;

create or replace function retirar_solicitud(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); begin
  update solicitudes_excepcion set estado = 'retirada', resuelto_en = now()
   where id = p_id and usuario_id = v and estado = 'pendiente';
  if not found then raise exception 'La solicitud no existe o ya fue resuelta.'; end if;
end $$;

-- Solo administración. Al aprobar se crea la reserva a nombre del solicitante.
create or replace function resolver_excepcion(p_id uuid, p_aprobar boolean, p_respuesta text default null)
returns solicitudes_excepcion language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); v_s solicitudes_excepcion; v_res reservas; v_p perfiles; v_cod text; begin
  if not es_admin() then raise exception 'Solo un administrador puede resolver solicitudes.' using errcode = '42501'; end if;
  select * into v_s from solicitudes_excepcion where id = p_id for update;
  if not found then raise exception 'Solicitud no encontrada.'; end if;
  if v_s.estado <> 'pendiente' then raise exception 'La solicitud ya fue resuelta.'; end if;
  select codigo into v_cod from equipos where id = v_s.equipo_id;

  if p_aprobar then
    if v_s.fin <= now() then raise exception 'El intervalo solicitado ya pasó.'; end if;
    select * into v_p from perfiles where id = v_s.usuario_id;
    begin
      insert into reservas (tipo, equipo_id, usuario_id, inicio, fin, actividad, detalle, programa, matricula, tipo_usuario, excepcion)
      values ('reserva', v_s.equipo_id, v_s.usuario_id, v_s.inicio, v_s.fin, v_s.actividad, v_s.detalle,
              v_p.programa, v_p.matricula, v_p.tipo_usuario, true)
      returning * into v_res;
    exception when exclusion_violation then
      raise exception 'No se puede aprobar: el equipo ya tiene otra reserva o bloqueo en ese intervalo.' using errcode = 'P0001';
    end;
    update solicitudes_excepcion
       set estado = 'aprobada', respuesta = nullif(trim(p_respuesta), ''), resuelto_por = v, resuelto_en = now(), reserva_id = v_res.id
     where id = p_id returning * into v_s;
    -- El aviso (y el correo) de confirmación lo genera la propia reserva.
  else
    if char_length(trim(coalesce(p_respuesta, ''))) < 3 then raise exception 'Escriba el motivo del rechazo.'; end if;
    update solicitudes_excepcion
       set estado = 'rechazada', respuesta = trim(p_respuesta), resuelto_por = v, resuelto_en = now()
     where id = p_id returning * into v_s;
    perform _avisar(v_s.usuario_id, 'solicitud_rechazada', 'sol_rech:' || v_s.id,
                    'Solicitud de reserva larga no aprobada',
                    'Su solicitud del equipo ' || v_cod || ' (' || _fmt(v_s.inicio) || ' a ' || _fmt(v_s.fin) ||
                    ') no fue aprobada. Motivo: ' || trim(p_respuesta),
                    '/mis-reservas');
  end if;
  return v_s;
end $$;

-- ----------------------------------------------------------- H. MANTENIMIENTO
create or replace function crear_mantenimiento(p_equipo text, p_tipo text, p_descripcion text,
                                    p_inicio timestamptz, p_fin timestamptz, p_responsable text,
                                    p_periodicidad_dias int default 0,
                                    p_cancelar_conflictos boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); v_eq equipos; v_b reservas; v_m mantenimientos; v_n int;
        v_motivo text; begin
  if not es_staff() then raise exception 'Solo el personal del laboratorio puede registrar mantenimientos.' using errcode = '42501'; end if;
  if p_tipo not in ('preventivo', 'correctivo', 'mejora') then raise exception 'Tipo de mantenimiento no válido.'; end if;
  if char_length(trim(coalesce(p_descripcion, ''))) < 3 then raise exception 'Describa la intervención.'; end if;
  if p_fin <= p_inicio then raise exception 'El fin debe ser posterior al inicio.'; end if;
  if split_part(lower(trim(coalesce(p_responsable, ''))), '@', 2) <> 'unal.edu.co' then
    raise exception 'El responsable técnico debe tener un correo @unal.edu.co.';
  end if;
  if p_periodicidad_dias < 0 or p_periodicidad_dias > 3650 then raise exception 'Periodicidad inválida.'; end if;

  select * into v_eq from equipos where codigo = upper(p_equipo) and not archivado;
  if not found then raise exception 'Equipo no encontrado.'; end if;

  v_motivo := 'Mantenimiento: ' || left(trim(p_descripcion), 120);
  select count(*) into v_n from reservas
   where equipo_id = v_eq.id and estado = 'activa' and periodo && tstzrange(p_inicio, p_fin, '[)');
  if v_n > 0 and not p_cancelar_conflictos then
    raise exception 'Hay % reserva(s) en ese intervalo. Cancélelas primero o repita con cancelar_conflictos.', v_n using errcode = 'P0001';
  end if;
  if v_n > 0 then
    update reservas set estado = 'cancelada', motivo = v_motivo
     where equipo_id = v_eq.id and estado = 'activa' and periodo && tstzrange(p_inicio, p_fin, '[)');
  end if;

  if p_fin > now() then
    insert into reservas (tipo, equipo_id, usuario_id, inicio, fin, motivo)
    values ('bloqueo', v_eq.id, v, p_inicio, p_fin, v_motivo)
    returning * into v_b;
  end if;

  insert into mantenimientos (equipo_id, tipo, descripcion, inicio, fin, responsable,
                              periodicidad_dias, bloqueo_id, creado_por)
  values (v_eq.id, p_tipo, trim(p_descripcion), p_inicio, p_fin, lower(trim(p_responsable)),
          p_periodicidad_dias, v_b.id, v)
  returning * into v_m;

  perform _avisar_staff('mantenimiento_programado', 'mnt_prog:' || v_m.id,
                        'Mantenimiento programado: ' || v_eq.codigo,
                        initcap(p_tipo) || ' del ' || _fmt(p_inicio) || ' al ' || _fmt(p_fin) || '. ' || trim(p_descripcion) ||
                        ' Responsable: ' || lower(trim(p_responsable)) || '.',
                        '/mantenimiento', null, v_m.id);

  return jsonb_build_object('mantenimiento', v_m.id, 'bloqueo', v_b.id, 'canceladas', v_n);
end $$;

create or replace function completar_mantenimiento(p_id uuid, p_hallazgos text) returns mantenimientos
language plpgsql security definer set search_path = public as $$
declare v_m mantenimientos; v_cod text; begin
  perform _perfil_activo();
  if not es_staff() then raise exception 'No autorizado.' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_hallazgos, ''))) < 3 then raise exception 'Registre los hallazgos de la intervención.'; end if;
  update mantenimientos set estado = 'completado', hallazgos = trim(p_hallazgos)
   where id = p_id and estado in ('programado', 'en_curso') returning * into v_m;
  if not found then raise exception 'El mantenimiento no existe o ya fue cerrado.'; end if;
  select codigo into v_cod from equipos where id = v_m.equipo_id;
  perform _avisar_staff('mantenimiento_por_validar', 'mnt_validar:' || v_m.id,
                        'Mantenimiento por validar: ' || v_cod,
                        'La intervención fue completada y espera la validación del responsable técnico.',
                        '/mantenimiento', null, v_m.id);
  return v_m;
end $$;

-- Cron diario: una vez por día y por persona, mientras el asunto siga abierto.
create or replace function encolar_recordatorios_mantenimiento() returns int
language plpgsql security definer set search_path = public as $$
declare v_n int := 0; r record; begin
  for r in
    select m.id, e.codigo, m.estado, m.fin,
           case when m.estado = 'completado' then 'Mantenimiento por validar: ' || e.codigo
                when m.fin < now() then 'Mantenimiento vencido sin cerrar: ' || e.codigo
                else 'Mantenimiento próximo: ' || e.codigo end as titulo
      from mantenimientos m join equipos e on e.id = m.equipo_id
     where m.estado in ('programado', 'en_curso', 'completado')
       and (m.estado = 'completado' or m.fin <= now() + interval '7 days')
  loop
    perform _avisar_staff(case when r.estado = 'completado' then 'mantenimiento_por_validar' else 'mantenimiento_proximo' end,
                          'mnt_aviso:' || r.id || ':' || current_date,
                          r.titulo, 'Intervención con fin el ' || _fmt(r.fin) || '. Revísela en Mantenimiento.',
                          '/mantenimiento', null, r.id);
    v_n := v_n + 1;
  end loop;
  -- Próximo mantenimiento calculado por periodicidad (equipos con fecha a 7 días o menos).
  for r in
    select em.equipo_id, em.codigo, em.proximo from equipos_mantenimiento em
     where em.proximo is not null and em.proximo <= current_date + 7
       and not exists (select 1 from mantenimientos m where m.equipo_id = em.equipo_id and m.estado in ('programado', 'en_curso'))
  loop
    perform _avisar_staff('mantenimiento_proximo', 'mnt_prox:' || r.equipo_id || ':' || r.proximo || ':' || to_char(current_date, 'IYYY-IW'),
                          'Toca mantenimiento: ' || r.codigo,
                          'Por periodicidad, el próximo mantenimiento era para el ' || to_char(r.proximo, 'DD/MM/YYYY') || ' y no está programado.',
                          '/mantenimiento');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ------------------------------------------ I. RECORDATORIOS, NO-SHOW, CORREO
create or replace function encolar_recordatorios_fin(p_minutos int default 30) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int; v_min int := greatest(coalesce(p_minutos, 0), coalesce(politica_int('recordatorio_fin_min'), 60)); begin
  with ins as (
    insert into cola_notificaciones (reserva_id, tipo, usuario_id, dedupe_key, titulo, cuerpo, url)
    select r.id, 'fin_proximo', r.usuario_id, 'fin_proximo:' || r.id || ':' || extract(epoch from r.fin)::text,
           'Su reserva termina pronto: ' || e.codigo,
           'Su reserva del equipo ' || e.codigo || ' termina el ' || _fmt(r.fin) ||
           '. Si ya terminó, libérelo. Si necesita más tiempo, extiéndala desde Mis reservas.',
           '/mis-reservas'
      from reservas r join equipos e on e.id = r.equipo_id
     where r.tipo = 'reserva' and r.estado = 'activa' and r.liberada_en is null
       and r.inicio <= now() and r.fin > now() and r.fin <= now() + make_interval(mins => v_min)
    on conflict (dedupe_key) do nothing returning 1)
  select count(*) into v_n from ins;
  return v_n;
end $$;

-- Cron: reservas que empezaron hace más de la tolerancia y nadie registró llegada.
-- Avisa una sola vez al titular y al personal. No libera nada automáticamente.
create or replace function encolar_avisos_no_show() returns int
language plpgsql security definer set search_path = public as $$
declare v_n int := 0; r record; begin
  for r in
    select x.id, x.usuario_id, x.inicio, x.fin, e.codigo, p.nombre
      from reservas x join equipos e on e.id = x.equipo_id join perfiles p on p.id = x.usuario_id
     where x.tipo = 'reserva' and x.estado = 'activa' and x.llegada_en is null and x.liberada_en is null
       and x.fin > now()
       and x.inicio + make_interval(mins => politica_int('tolerancia_llegada_min')) < now()
       and x.inicio > now() - interval '12 hours'
       and not exists (select 1 from cola_notificaciones c where c.dedupe_key = 'noshow:' || x.id)
  loop
    perform _avisar(r.usuario_id, 'sin_llegada', 'noshow:' || r.id,
                    'Registre su llegada: ' || r.codigo,
                    'Su reserva del equipo ' || r.codigo || ' empezó el ' || _fmt(r.inicio) ||
                    ' y no tiene llegada registrada. Si no la va a usar, cancélela para liberar el equipo.',
                    '/mis-reservas', r.id, null, null, false);
    perform _avisar_staff('sin_llegada_staff', 'noshow_staff:' || r.id,
                          'Reserva sin llegada: ' || r.codigo,
                          r.nombre || ' reservó ' || r.codigo || ' desde el ' || _fmt(r.inicio) || ' hasta el ' || _fmt(r.fin) ||
                          ' y no ha registrado llegada.',
                          '/admin?tab=ronda', r.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Cola de correo: la consume el worker de Apps Script con la clave secreta.
create or replace function correos_pendientes(p_limite int default 40)
returns table (id bigint, correo text, nombre text, titulo text, cuerpo text, url text, responder_a text)
language sql stable security definer set search_path = public as $$
  select c.id, p.correo, p.nombre, c.titulo, c.cuerpo, c.url, c.responder_a
    from cola_notificaciones c join perfiles p on p.id = c.usuario_id
   where c.enviado_en is null and c.correo and c.titulo is not null and p.activo
     and c.creado_en > now() - interval '2 days'
   order by c.id
   limit greatest(1, least(coalesce(p_limite, 40), 100)) $$;

create or replace function marcar_correos_enviados(p_ids bigint[]) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int; begin
  update cola_notificaciones set enviado_en = now() where id = any (p_ids) and enviado_en is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- -------------------------------------------------------------- J. ESTADÍSTICAS
alter table reservas_importadas add column if not exists codigo_origen text unique;
alter table reservas_importadas add column if not exists reserva_id uuid references reservas (id);
alter table reservas_importadas add column if not exists reclamada_en timestamptz;

create or replace function estadisticas(p_desde timestamptz, p_hasta timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb; begin
  perform _perfil_activo();
  if not es_staff() then raise exception 'No autorizado.' using errcode = '42501'; end if;
  with base as (
    select e.codigo, r.inicio, r.fin, r.estado::text as estado,
           coalesce(nullif(r.actividad, ''), 'Sin especificar') as actividad,
           coalesce(nullif(r.programa, ''), 'Sin especificar') as programa,
           coalesce(nullif(r.matricula, ''), 'N/A') as matricula,
           (r.estado = 'activa' and r.llegada_en is null and r.liberada_en is null
            and r.inicio + make_interval(mins => politica_int('tolerancia_llegada_min')) < now()) as sin_llegada
      from reservas r join equipos e on e.id = r.equipo_id
     where (r.tipo = 'reserva' or exists (select 1 from reservas_importadas i where i.reserva_id = r.id))
       and r.inicio >= p_desde and r.inicio < p_hasta
    union all
    select i.codigo_equipo, i.inicio, i.fin,
           case when lower(coalesce(i.estado, '')) like 'cancel%' then 'cancelada' else 'activa' end,
           coalesce(nullif(i.actividad, ''), 'Sin especificar'),
           coalesce(nullif(i.datos ->> 'programa', ''), 'Sin especificar'),
           coalesce(nullif(i.datos ->> 'matricula', ''), 'N/A'), false
      from reservas_importadas i
     where i.reserva_id is null and i.inicio >= p_desde and i.inicio < p_hasta
  ), ok as (select * from base where estado <> 'cancelada')
  select jsonb_build_object(
    'total', (select count(*) from ok),
    'canceladas', (select count(*) from base where estado = 'cancelada'),
    'sin_llegada', (select count(*) from ok where sin_llegada),
    'horas', (select coalesce(round(sum(extract(epoch from fin - inicio)) / 3600), 0) from ok),
    'por_equipo', (select coalesce(jsonb_agg(jsonb_build_object('clave', codigo, 'n', n, 'horas', h) order by codigo), '[]'::jsonb)
                     from (select codigo, count(*) n, round(sum(extract(epoch from fin - inicio)) / 3600) h from ok group by codigo) t),
    'por_actividad', (select coalesce(jsonb_agg(jsonb_build_object('clave', actividad, 'n', n) order by n desc), '[]'::jsonb)
                        from (select actividad, count(*) n from ok group by actividad) t),
    'por_programa', (select coalesce(jsonb_agg(jsonb_build_object('clave', programa, 'n', n) order by n desc), '[]'::jsonb)
                       from (select programa, count(*) n from ok group by programa) t),
    'por_matricula', (select coalesce(jsonb_agg(jsonb_build_object('clave', matricula, 'n', n) order by n desc), '[]'::jsonb)
                        from (select matricula, count(*) n from ok group by matricula) t),
    'por_hora', (select coalesce(jsonb_agg(jsonb_build_object('clave', h, 'n', n) order by h), '[]'::jsonb)
                   from (select extract(hour from inicio at time zone 'America/Bogota')::int h, count(*) n from ok group by 1) t),
    'por_dia', (select coalesce(jsonb_agg(jsonb_build_object('clave', d, 'n', n) order by d), '[]'::jsonb)
                  from (select extract(isodow from inicio at time zone 'America/Bogota')::int d, count(*) n from ok group by 1) t)
  ) into v;
  return v;
end $$;

-- ---------------------------------------------- K. IMPORTACIÓN DESDE SHEETS
-- Las usa scripts/migrar_sheets.py (SQL Editor / clave secreta; nunca la PWA).
-- * Toda fila queda respaldada en reservas_importadas (idempotente por codigo_origen).
-- * Las vigentes o futuras entran además a `reservas` para ocupar el equipo:
--     - si el titular ya tiene perfil, a su nombre;
--     - si no, como bloqueo provisional que se convierte en SU reserva la
--       primera vez que ingrese (trigger perfiles_reclamar).
-- * No se aplica el tope de 168 h (D-13: las existentes se respetan).
create or replace function importar_reserva_hoja(
  p_codigo_origen text, p_equipo text, p_correo text, p_nombre text,
  p_inicio timestamptz, p_fin timestamptz, p_cancelada boolean,
  p_actividad text, p_detalle text, p_desatendido boolean, p_mensaje text,
  p_extensiones int, p_datos jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_imp bigint; v_eq uuid; v_user uuid; v_admin uuid; v_res uuid; v_correo text := lower(trim(coalesce(p_correo, ''))); begin
  insert into reservas_importadas (codigo_origen, codigo_equipo, correo_titular, nombre_titular, inicio, fin, estado, actividad, detalle, datos)
  values (p_codigo_origen, upper(p_equipo), v_correo, p_nombre, p_inicio, p_fin,
          case when p_cancelada then 'Cancelada' else 'Activa' end, p_actividad, p_detalle, coalesce(p_datos, '{}'::jsonb))
  on conflict (codigo_origen) do nothing
  returning id into v_imp;
  if v_imp is null then return 'repetida'; end if;
  if p_cancelada or p_fin <= now() or p_fin <= p_inicio then return 'historica'; end if;

  select id into v_eq from equipos where codigo = upper(p_equipo);
  if v_eq is null then return 'equipo_desconocido'; end if;
  select id into v_user from perfiles where correo = v_correo;
  select id into v_admin from perfiles where rol = 'administrador' and activo order by creado_en limit 1;
  if v_user is null and v_admin is null then
    raise exception 'No hay un administrador activo: ingrese a la PWA y promueva su cuenta antes de importar.';
  end if;
  begin
    insert into reservas (tipo, equipo_id, usuario_id, inicio, fin, actividad, detalle, desatendido, mensaje_llegada,
                          motivo, extensiones, llegada_en, programa, matricula, tipo_usuario, excepcion)
    values ((case when v_user is null then 'bloqueo' else 'reserva' end)::tipo_ocupacion,
            v_eq, coalesce(v_user, v_admin), p_inicio, p_fin, p_actividad, left(p_detalle, 800),
            coalesce(p_desatendido, false), left(nullif(trim(coalesce(p_mensaje, '')), ''), 140),
            case when v_user is null then 'Reserva migrada del sistema anterior' end,
            greatest(coalesce(p_extensiones, 0), 0),
            case when p_inicio <= now() then p_inicio end,          -- ya está en uso: no es un no-show
            p_datos ->> 'programa', p_datos ->> 'matricula', p_datos ->> 'tipo_usuario',
            p_fin - p_inicio > make_interval(hours => politica_int('duracion_max_total_horas')))
    returning id into v_res;
  exception when exclusion_violation then
    update reservas_importadas set datos = datos || '{"conflicto": true}'::jsonb where id = v_imp;
    return 'conflicto';
  end;
  update reservas_importadas set reserva_id = v_res, reclamada_en = case when v_user is not null then now() end where id = v_imp;
  -- La importación no debe disparar correos ni avisos de "reserva confirmada".
  update cola_notificaciones set enviado_en = now(), push_enviado_en = now(), leido_en = now() where reserva_id = v_res;
  return case when v_user is null then 'vigente_pendiente' else 'vigente' end;
end $$;

create or replace function importar_bloqueo_hoja(p_equipo text, p_inicio timestamptz, p_fin timestamptz, p_motivo text)
returns text language plpgsql security definer set search_path = public as $$
declare v_eq uuid; v_admin uuid; begin
  if p_fin <= now() or p_fin <= p_inicio then return 'vencido'; end if;
  select id into v_eq from equipos where codigo = upper(p_equipo);
  if v_eq is null then return 'equipo_desconocido'; end if;
  select id into v_admin from perfiles where rol = 'administrador' and activo order by creado_en limit 1;
  if v_admin is null then raise exception 'No hay un administrador activo.'; end if;
  if exists (select 1 from reservas where equipo_id = v_eq and tipo = 'bloqueo' and estado = 'activa'
               and inicio = p_inicio and fin = p_fin) then return 'repetido'; end if;
  begin
    insert into reservas (tipo, equipo_id, usuario_id, inicio, fin, motivo)
    values ('bloqueo', v_eq, v_admin, p_inicio, p_fin, left(coalesce(nullif(trim(p_motivo), ''), 'Bloqueo de gestión'), 200));
  exception when exclusion_violation then return 'conflicto';
  end;
  return 'creado';
end $$;

-- Primera vez que la persona ingresa: sus reservas migradas pasan a su nombre y
-- su perfil se completa con los datos que ya había dado en el sistema anterior.
create or replace function trg_reclamar_importadas() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_i reservas_importadas; begin
  update reservas r
     set tipo = 'reserva', usuario_id = new.id, motivo = null
    from reservas_importadas i
   where i.reserva_id = r.id and i.correo_titular = new.correo and i.reclamada_en is null
     and r.tipo = 'bloqueo' and r.estado = 'activa';
  update reservas_importadas set reclamada_en = now()
   where correo_titular = new.correo and reserva_id is not null and reclamada_en is null;

  select * into v_i from reservas_importadas where correo_titular = new.correo order by inicio desc limit 1;
  if found then
    update perfiles
       set programa = coalesce(programa, nullif(v_i.datos ->> 'programa', '')),
           matricula = coalesce(matricula, nullif(v_i.datos ->> 'matricula', '')),
           tipo_usuario = coalesce(tipo_usuario,
                                   case when v_i.datos ->> 'tipo_usuario' in ('Estudiante', 'Docente/Investigador')
                                        then v_i.datos ->> 'tipo_usuario' end),
           nombre = case when nombre = split_part(correo, '@', 1) and nullif(trim(coalesce(v_i.nombre_titular, '')), '') is not null
                         then left(trim(v_i.nombre_titular), 120) else nombre end
     where id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists perfiles_reclamar on perfiles;
create trigger perfiles_reclamar after insert on perfiles for each row execute function trg_reclamar_importadas();

-- ------------------------------------------------------------------ L. PERMISOS
revoke all on contactos, solicitudes_excepcion from anon, authenticated;
grant select on contactos, solicitudes_excepcion, reservas_estado to authenticated;
grant update (nombre, programa, tipo_usuario, matricula) on perfiles to authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function es_staff, es_admin, politica_int, tiene_permiso to authenticated;
grant execute on function crear_reserva, extender_reserva, cancelar_reserva, liberar_reserva, registrar_llegada,
                          equipos_disponibles, crear_bloqueo, cancelar_bloqueo, validar_credencial,
                          asignar_rol, activar_usuario, otorgar_permiso,
                          crear_mantenimiento, iniciar_mantenimiento, completar_mantenimiento,
                          validar_mantenimiento, cancelar_mantenimiento,
                          contactar_titular, solicitar_excepcion, retirar_solicitud, resolver_excepcion,
                          marcar_avisos_leidos, estadisticas to authenticated;
grant execute on function incrementar_push_intentos, correos_pendientes, marcar_correos_enviados,
                          encolar_recordatorios_fin, encolar_recordatorios_mantenimiento, encolar_avisos_no_show,
                          importar_reserva_hoja, importar_bloqueo_hoja to service_role;

commit;
