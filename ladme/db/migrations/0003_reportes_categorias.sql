-- ============================================================================
-- 0003 — Reportes de fallas, categorías, alertas de liberación, reglamento
--
-- Aplicar UNA vez en el SQL Editor de Supabase, después de 0002.
-- Todo corre en una transacción.
--
--   A. Categoría de cada recurso (ya existía; se acota y la PWA agrupa por ella).
--   B. Reportes de fallas hechos por los usuarios.
--   C. «Avíseme cuando se libere».
--   D. Reglamento aceptado una vez (requisito para reservar).
--   E. Valoración al terminar («¿todo funcionó bien?»).
--   F. Cola de correo con equipo y horario, para la plantilla nueva.
--   G. Permisos.
-- ============================================================================

begin;

-- -------------------------------------------------------------- A. CATEGORÍAS
-- `equipos.categoria` ya existe en el esquema base (por defecto «Estación de trabajo»).
-- La PWA ahora agrupa el inicio por esa columna; aquí solo se acota su longitud.
alter table equipos drop constraint if exists equipos_categoria_largo;
alter table equipos add constraint equipos_categoria_largo check (char_length(categoria) between 2 and 40);

-- ---------------------------------------------------------------- B. REPORTES
create table if not exists reportes (
  id               uuid primary key default gen_random_uuid(),
  equipo_id        uuid not null references equipos (id),
  usuario_id       uuid not null references perfiles (id),
  categoria        text not null check (categoria in ('No enciende', 'Lento o se congela', 'Software', 'Pantalla o periféricos', 'Red o internet', 'Otro')),
  descripcion      text not null check (char_length(descripcion) between 5 and 800),
  estado           text not null default 'abierto' check (estado in ('abierto', 'en_revision', 'resuelto', 'descartado')),
  respuesta        text check (char_length(respuesta) <= 500),
  resuelto_por     uuid references perfiles (id),
  resuelto_en      timestamptz,
  creado_en        timestamptz not null default now()
);
create index if not exists reportes_equipo_idx on reportes (equipo_id, creado_en desc);
create index if not exists reportes_usuario_idx on reportes (usuario_id, creado_en desc);
alter table reportes enable row level security;
drop policy if exists reportes_ver on reportes;
create policy reportes_ver on reportes for select to authenticated using (usuario_id = auth.uid() or es_staff());

create or replace function reportar_falla(p_equipo text, p_categoria text, p_descripcion text)
returns reportes language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); v_eq equipos; v_r reportes; v_nombre text;
        v_txt text := regexp_replace(trim(coalesce(p_descripcion, '')), '[\r\n\t]+', ' ', 'g'); begin
  select * into v_eq from equipos where codigo = upper(p_equipo) and not archivado;
  if not found then raise exception 'Equipo no encontrado.'; end if;
  if p_categoria not in ('No enciende', 'Lento o se congela', 'Software', 'Pantalla o periféricos', 'Red o internet', 'Otro') then
    raise exception 'Seleccione el tipo de problema.';
  end if;
  if char_length(v_txt) < 5 then raise exception 'Describa el problema (mínimo 5 caracteres).'; end if;
  if (select count(*) from reportes where usuario_id = v and creado_en > now() - interval '1 hour') >= 5 then
    raise exception 'Ha enviado varios reportes seguidos. Espere un momento o escriba a labdatos_paz@unal.edu.co.';
  end if;
  insert into reportes (equipo_id, usuario_id, categoria, descripcion)
  values (v_eq.id, v, p_categoria, left(v_txt, 800)) returning * into v_r;
  select nombre into v_nombre from perfiles where id = v;
  perform _avisar_staff('reporte_falla', 'reporte:' || v_r.id,
                        'Reporte de falla: ' || v_eq.codigo,
                        v_nombre || ' reporta «' || p_categoria || '» en ' || v_eq.codigo || ': ' || left(v_txt, 300),
                        '/admin?tab=reportes');
  return v_r;
end $$;

-- Personal: cambia el estado, responde al usuario y, si hace falta, saca el equipo de servicio.
create or replace function atender_reporte(p_id uuid, p_estado text, p_respuesta text default null,
                                           p_fuera_de_servicio boolean default false)
returns reportes language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); v_r reportes; v_cod text; begin
  if not es_staff() then raise exception 'Solo el personal del laboratorio atiende reportes.' using errcode = '42501'; end if;
  if p_estado not in ('en_revision', 'resuelto', 'descartado') then raise exception 'Estado no válido.'; end if;
  if p_estado in ('resuelto', 'descartado') and char_length(trim(coalesce(p_respuesta, ''))) < 3 then
    raise exception 'Escriba una respuesta para quien reportó.';
  end if;
  update reportes
     set estado = p_estado,
         respuesta = coalesce(nullif(trim(p_respuesta), ''), respuesta),
         resuelto_por = case when p_estado in ('resuelto', 'descartado') then v else resuelto_por end,
         resuelto_en = case when p_estado in ('resuelto', 'descartado') then now() else resuelto_en end
   where id = p_id and estado in ('abierto', 'en_revision')
  returning * into v_r;
  if not found then raise exception 'El reporte no existe o ya fue cerrado.'; end if;
  select codigo into v_cod from equipos where id = v_r.equipo_id;
  if p_fuera_de_servicio then
    update equipos set estado = 'fuera_de_servicio' where id = v_r.equipo_id and estado = 'activo';
  end if;
  perform _avisar(v_r.usuario_id, 'reporte_respuesta', 'reporte_resp:' || v_r.id || ':' || p_estado,
                  case p_estado when 'en_revision' then 'Estamos revisando su reporte: ' || v_cod
                                when 'resuelto' then 'Reporte resuelto: ' || v_cod
                                else 'Reporte cerrado: ' || v_cod end,
                  case when nullif(trim(coalesce(p_respuesta, '')), '') is not null then trim(p_respuesta)
                       else 'El laboratorio ya está revisando el problema que reportó. Gracias por avisar.' end,
                  '/equipo/' || v_cod, null, null, null, p_estado <> 'en_revision');
  return v_r;
end $$;

-- ------------------------------------------------------- C. ALERTA DE LIBERACIÓN
create table if not exists alertas_liberacion (
  usuario_id uuid not null references perfiles (id),
  equipo_id  uuid not null references equipos (id),
  creado_en  timestamptz not null default now(),
  primary key (usuario_id, equipo_id)
);
alter table alertas_liberacion enable row level security;
drop policy if exists alertas_ver on alertas_liberacion;
create policy alertas_ver on alertas_liberacion for select to authenticated using (usuario_id = auth.uid());

-- Activa o desactiva la alerta. Devuelve true si quedó activa.
create or replace function alternar_alerta_liberacion(p_equipo text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); v_eq uuid; begin
  select id into v_eq from equipos where codigo = upper(p_equipo) and not archivado;
  if v_eq is null then raise exception 'Equipo no encontrado.'; end if;
  delete from alertas_liberacion where usuario_id = v and equipo_id = v_eq;
  if found then return false; end if;
  if (select count(*) from alertas_liberacion where usuario_id = v) >= 5 then
    raise exception 'Puede tener hasta 5 alertas activas a la vez.';
  end if;
  insert into alertas_liberacion (usuario_id, equipo_id) values (v, v_eq);
  return true;
end $$;

-- Cron (lo llama el worker de Apps Script cada 5 min): avisa a quien pidió la
-- alerta cuando el equipo queda libre y activo, y la borra. Vencen a los 14 días.
create or replace function encolar_alertas_liberacion() returns int
language plpgsql security definer set search_path = public as $$
declare v_n int := 0; r record; begin
  delete from alertas_liberacion where creado_en < now() - interval '14 days';
  for r in
    select a.usuario_id, a.equipo_id, e.codigo
      from alertas_liberacion a join equipos e on e.id = a.equipo_id
     where e.estado = 'activo' and not e.archivado
       and not exists (select 1 from reservas x where x.equipo_id = a.equipo_id and x.estado = 'activa'
                         and x.inicio <= now() and x.fin > now())
  loop
    perform _avisar(r.usuario_id, 'equipo_libre', 'libre:' || r.equipo_id || ':' || r.usuario_id || ':' || extract(epoch from now())::bigint,
                    'Ya está libre: ' || r.codigo,
                    'El equipo ' || r.codigo || ' quedó disponible. Resérvelo pronto: el aviso no lo aparta.',
                    '/equipo/' || r.codigo);
    delete from alertas_liberacion where usuario_id = r.usuario_id and equipo_id = r.equipo_id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- --------------------------------------------------------------- D. REGLAMENTO
alter table perfiles add column if not exists reglamento_aceptado_en timestamptz;

create or replace function aceptar_reglamento() returns void
language sql security definer set search_path = public as $$
  update perfiles set reglamento_aceptado_en = coalesce(reglamento_aceptado_en, now()) where id = auth.uid() $$;

-- Quien reserva para sí mismo debe haber aceptado el reglamento. No aplica a
-- importaciones ni a reservas creadas por la administración a nombre de otro.
create or replace function trg_exigir_reglamento() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tipo = 'reserva' and auth.uid() = new.usuario_id
     and (select reglamento_aceptado_en from perfiles where id = new.usuario_id) is null then
    raise exception 'Antes de reservar debe aceptar el reglamento de uso del laboratorio.';
  end if;
  return new;
end $$;
drop trigger if exists reservas_reglamento on reservas;
create trigger reservas_reglamento before insert on reservas for each row execute function trg_exigir_reglamento();

-- --------------------------------------------------------------- E. VALORACIÓN
alter table reservas add column if not exists funciono boolean;

create or replace function valorar_reserva(p_reserva uuid, p_funciono boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  update reservas set funciono = p_funciono
   where id = p_reserva and usuario_id = _perfil_activo() and tipo = 'reserva' and inicio <= now();
  if not found then raise exception 'Reserva no encontrada.'; end if;
end $$;

-- La valoración no es un cambio de la reserva: no debe generar historial ruidoso
-- ni avisos (trg_historial la registra como «modificada», sin aviso).

drop view if exists reservas_estado;
create view reservas_estado with (security_invoker = true) as
select r.*,
       case when r.estado = 'cancelada' then 'cancelada'
            when r.liberada_en is not null or r.fin <= now() then 'finalizada'
            when r.inicio > now() then 'activa'
            when r.llegada_en is null and now() > r.inicio + make_interval(mins => politica_int('tolerancia_llegada_min')) then 'sin_llegada'
            else 'en_curso' end as estado_vigente
from reservas r;

-- ---------------------------------------------------------- F. COLA DE CORREO
drop function if exists correos_pendientes(int);
create function correos_pendientes(p_limite int default 40)
returns table (id bigint, correo text, nombre text, tipo text, titulo text, cuerpo text, url text, responder_a text,
               equipo text, inicio text, fin text, codigo text)
language sql stable security definer set search_path = public as $$
  select c.id, p.correo, p.nombre, c.tipo, c.titulo, c.cuerpo, c.url, c.responder_a,
         e.codigo, _fmt(r.inicio), _fmt(r.fin), r.codigo_legible
    from cola_notificaciones c
    join perfiles p on p.id = c.usuario_id
    left join reservas r on r.id = c.reserva_id
    left join equipos e on e.id = r.equipo_id
   where c.enviado_en is null and c.correo and c.titulo is not null and p.activo
     and c.creado_en > now() - interval '2 days'
   order by c.id
   limit greatest(1, least(coalesce(p_limite, 40), 100)) $$;

-- Estadísticas: se agregan los reportes y las valoraciones negativas del período.
create or replace function estadisticas_soporte(p_desde timestamptz, p_hasta timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _perfil_activo();
  if not es_staff() then raise exception 'No autorizado.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'reportes', (select count(*) from reportes where creado_en >= p_desde and creado_en < p_hasta),
    'reportes_abiertos', (select count(*) from reportes where estado in ('abierto', 'en_revision')),
    'valoradas', (select count(*) from reservas where funciono is not null and inicio >= p_desde and inicio < p_hasta),
    'con_problemas', (select count(*) from reservas where funciono = false and inicio >= p_desde and inicio < p_hasta),
    'reportes_por_equipo', (select coalesce(jsonb_agg(jsonb_build_object('clave', codigo, 'n', n) order by n desc), '[]'::jsonb)
                              from (select e.codigo, count(*) n from reportes x join equipos e on e.id = x.equipo_id
                                     where x.creado_en >= p_desde and x.creado_en < p_hasta group by e.codigo) t));
end $$;

-- ------------------------------------------------------------------ G. PERMISOS
revoke all on reportes, alertas_liberacion from anon, authenticated;
grant select on reportes, alertas_liberacion, reservas_estado to authenticated;

revoke execute on function reportar_falla, atender_reporte, alternar_alerta_liberacion, encolar_alertas_liberacion,
                           aceptar_reglamento, trg_exigir_reglamento, valorar_reserva, correos_pendientes,
                           estadisticas_soporte from public, anon, authenticated;
grant execute on function reportar_falla, atender_reporte, alternar_alerta_liberacion, aceptar_reglamento,
                          valorar_reserva, estadisticas_soporte to authenticated;
grant execute on function correos_pendientes, encolar_alertas_liberacion to service_role;

commit;
