-- 0010 · Registro unificado, consola del personal, mantenimientos al chat
-- Ejecutar después de 0009. Idempotente.
--
--   A. registro(): todo el historial del laboratorio en un solo lugar (reservas, Faro, fallas,
--      mantenimientos, solicitudes, errores de la app y comandos de la consola), con filtros y
--      páginas. Nada se borra: el registro siempre queda; la PWA lo muestra de a páginas y lo exporta.
--   B. consola_registro + consola_anotar(): cada comando de la consola queda auditado.
--   C. Un mantenimiento nuevo avisa al chat del personal (sin datos personales).
--   D. El sistema operativo no se repite («Windows Windows 11 Pro» → «Windows 11 Pro»).
begin;

-- ------------------------------------------------------------------ B. Consola
create table if not exists consola_registro (
  id         bigint generated always as identity primary key,
  actor      uuid references perfiles (id),
  comando    text not null check (char_length(comando) <= 500),
  ok         boolean not null,
  resultado  text check (char_length(resultado) <= 500),
  creado_en  timestamptz not null default now()
);
create index if not exists consola_registro_fecha_idx on consola_registro (creado_en desc);
alter table consola_registro enable row level security;
-- Sin políticas: solo se escribe con consola_anotar() y se lee con registro().

create or replace function consola_anotar(p_comando text, p_ok boolean, p_resultado text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_staff() then raise exception 'Solo el personal usa la consola.' using errcode = '42501'; end if;
  insert into consola_registro (actor, comando, ok, resultado)
  values (auth.uid(), left(coalesce(p_comando, ''), 500), coalesce(p_ok, false), left(p_resultado, 500));
end $$;

-- ------------------------------------------------------------------ A. Registro
-- Vista interna (no se concede a nadie): la lee registro(), que exige ser del personal.
create or replace view registro_v as
-- Reservas y bloqueos: cada creación, extensión, liberación, cancelación o cambio.
select h.creado_en as en,
       'reservas'::text as fuente,
       h.accion as tipo,
       e.codigo as equipo,
       (case when coalesce(h.despues ->> 'tipo', r.tipo::text) = 'bloqueo' then 'Bloqueo ' else 'Reserva ' end) ||
       coalesce(h.despues ->> 'codigo_legible', r.codigo_legible, '') || ' ' || h.accion || ' · ' ||
       to_char((h.despues ->> 'inicio')::timestamptz at time zone 'America/Bogota', 'DD/MM HH24:MI') || '–' ||
       to_char((h.despues ->> 'fin')::timestamptz at time zone 'America/Bogota', 'DD/MM HH24:MI') as texto,
       pt.nombre as persona,
       pa.nombre as actor
  from reservas_historial h
  left join reservas r on r.id = h.reserva_id
  left join equipos e on e.id = coalesce((h.despues ->> 'equipo_id')::uuid, r.equipo_id)
  left join perfiles pt on pt.id = coalesce((h.despues ->> 'usuario_id')::uuid, r.usuario_id)
  left join perfiles pa on pa.id = h.actor
union all
-- Faro: vinculación, bloqueos, desbloqueos, órdenes, llegadas, uso sin reserva…
select v.creado_en, 'faro', v.tipo, e.codigo,
       (case v.tipo
          when 'vinculado' then 'Faro vinculado'
          when 'desvinculado' then 'Faro desvinculado'
          when 'inicio' then 'Faro inició'
          when 'uso_sin_reserva' then 'Uso sin reserva'
          when 'llegada_detectada' then 'Llegada detectada por Faro'
          when 'llegada_qr' then 'Llegada con el QR de la isla'
          when 'bloqueo' then 'Pantalla bloqueada'
          when 'desbloqueo' then 'Pantalla desbloqueada'
          when 'desbloqueo_personal' then 'Desbloqueo por el personal'
          when 'desbloqueo_emergencia' then 'Clave de emergencia usada'
          when 'cierre_intentado' then 'Faro cerrado a la fuerza'
          when 'modo' then 'Modo de Faro cambiado'
          when 'comando' then 'Orden remota'
          when 'retirado' then 'Faro retirado del equipo'
          else v.tipo end) ||
       coalesce(' · ' || coalesce(v.detalle ->> 'modo', v.detalle ->> 'orden', v.detalle ->> 'reserva', v.detalle ->> 'por',
                                  v.detalle ->> 'motivo'), ''),
       null, pa.nombre
  from agente_eventos v
  join equipos e on e.id = v.equipo_id
  left join perfiles pa on pa.id = v.actor
union all
-- Resultado de las órdenes remotas.
select c.completado_en, 'faro', 'orden_resultado', e.codigo,
       'Orden «' || c.tipo || '» ' || case when c.ok then 'cumplida' else 'falló' end || coalesce(' · ' || c.resultado, ''),
       null, pa.nombre
  from agente_comandos c
  join equipos e on e.id = c.equipo_id
  left join perfiles pa on pa.id = c.creado_por
 where c.completado_en is not null
union all
-- Fallas reportadas (la descripción no se muestra aquí: puede traer datos personales).
select f.creado_en, 'fallas', 'reporte', e.codigo, 'Falla reportada: ' || f.categoria, p.nombre, p.nombre
  from reportes f join equipos e on e.id = f.equipo_id left join perfiles p on p.id = f.usuario_id
union all
select f.resuelto_en, 'fallas', f.estado, e.codigo,
       'Falla ' || replace(f.estado, '_', ' ') || ': ' || f.categoria || coalesce(' · ' || left(f.respuesta, 160), ''),
       p.nombre, pr.nombre
  from reportes f join equipos e on e.id = f.equipo_id
  left join perfiles p on p.id = f.usuario_id left join perfiles pr on pr.id = f.resuelto_por
 where f.resuelto_en is not null
union all
-- Mantenimientos.
select m.creado_en, 'mantenimiento', m.tipo, e.codigo,
       'Mantenimiento ' || m.tipo || ' · ' ||
       to_char(m.inicio at time zone 'America/Bogota', 'DD/MM HH24:MI') || '–' ||
       to_char(m.fin at time zone 'America/Bogota', 'DD/MM HH24:MI') || ' · ' || left(m.descripcion, 160),
       m.responsable, pc.nombre
  from mantenimientos m join equipos e on e.id = m.equipo_id left join perfiles pc on pc.id = m.creado_por
union all
select m.validado_en, 'mantenimiento', 'validado', e.codigo, 'Mantenimiento validado · ' || left(m.descripcion, 160),
       m.responsable, pv.nombre
  from mantenimientos m join equipos e on e.id = m.equipo_id left join perfiles pv on pv.id = m.validado_por
 where m.validado_en is not null
union all
-- Solicitudes de reserva larga.
select s.creado_en, 'solicitudes', 'pendiente', e.codigo,
       'Solicitud de reserva larga · ' || round(extract(epoch from s.fin - s.inicio) / 86400.0, 1) || ' días',
       p.nombre, p.nombre
  from solicitudes_excepcion s join equipos e on e.id = s.equipo_id left join perfiles p on p.id = s.usuario_id
union all
select s.resuelto_en, 'solicitudes', s.estado, e.codigo,
       'Solicitud ' || s.estado || coalesce(' · ' || left(s.respuesta, 160), ''), p.nombre, pr.nombre
  from solicitudes_excepcion s join equipos e on e.id = s.equipo_id
  left join perfiles p on p.id = s.usuario_id left join perfiles pr on pr.id = s.resuelto_por
 where s.resuelto_en is not null
union all
-- Errores de la app (para soporte).
select x.creado_en, 'errores', x.tipo, null,
       'Error de la app: ' || left(x.mensaje, 180) || coalesce(' · ' || x.ruta, ''), p.nombre, null
  from errores_app x left join perfiles p on p.id = x.usuario_id
union all
-- Comandos de la consola.
select k.creado_en, 'consola', case when k.ok then 'ok' else 'error' end, null,
       '> ' || k.comando || coalesce(' · ' || k.resultado, ''), null, p.nombre
  from consola_registro k left join perfiles p on p.id = k.actor;

revoke all on registro_v from public, anon, authenticated;

-- Filtros opcionales; páginas con p_limite/p_offset (máx. 5000 filas por llamada, para exportar por tandas).
create or replace function registro(
  p_fuentes text[] default null,
  p_equipo  text default null,
  p_desde   timestamptz default null,
  p_hasta   timestamptz default null,
  p_buscar  text default null,
  p_limite  int default 25,
  p_offset  int default 0
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_total bigint; v_filas jsonb; v_buscar text := nullif(btrim(p_buscar), ''); begin
  if not es_staff() then raise exception 'Solo el personal ve el registro.' using errcode = '42501'; end if;
  with f as (
    select * from registro_v r
     where r.en is not null
       and (p_fuentes is null or cardinality(p_fuentes) = 0 or r.fuente = any (p_fuentes))
       and (nullif(btrim(p_equipo), '') is null or r.equipo = upper(btrim(p_equipo)))
       and (p_desde is null or r.en >= p_desde)
       and (p_hasta is null or r.en < p_hasta)
       and (v_buscar is null or concat_ws(' ', r.texto, r.equipo, r.persona, r.actor, r.tipo) ilike '%' || v_buscar || '%')
  )
  select (select count(*) from f),
         coalesce((select jsonb_agg(jsonb_build_object('en', t.en, 'fuente', t.fuente, 'tipo', t.tipo, 'equipo', t.equipo,
                                                       'texto', t.texto, 'persona', t.persona, 'actor', t.actor))
                     from (select * from f order by en desc
                            limit least(greatest(coalesce(p_limite, 25), 1), 5000)
                           offset greatest(coalesce(p_offset, 0), 0)) t), '[]'::jsonb)
    into v_total, v_filas;
  return jsonb_build_object('total', v_total, 'filas', v_filas);
end $$;

-- ------------------------------------------------------------------ C. Mantenimientos al chat
create or replace function trg_chat_mantenimiento() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform _avisar_chat('mantenimiento', 'mantenimiento:' || new.id,
    (select codigo from equipos where id = new.equipo_id) || ' entra en mantenimiento ' || new.tipo || ' del ' ||
    to_char(new.inicio at time zone 'America/Bogota', 'DD/MM HH24:MI') || ' al ' ||
    to_char(new.fin at time zone 'America/Bogota', 'DD/MM HH24:MI') || '.',
    '/mantenimiento');
  return new;
end $$;
drop trigger if exists mantenimientos_chat on mantenimientos;
create trigger mantenimientos_chat after insert on mantenimientos for each row execute function trg_chat_mantenimiento();

-- ------------------------------------------------------------------ D. Sistema operativo sin repetir
-- Faro llena sistema_operativo = 'Windows' y so_version = 'Windows 11 Pro'; la versión se guarda sin el tipo.
create or replace function trg_equipos_so() returns trigger
language plpgsql as $$
begin
  if new.so_version is not null and new.sistema_operativo is not null
     and lower(new.so_version) like lower(new.sistema_operativo) || ' %' then
    new.so_version := btrim(substr(new.so_version, char_length(new.sistema_operativo) + 1));
  end if;
  return new;
end $$;
drop trigger if exists equipos_so on equipos;
create trigger equipos_so before insert or update of so_version, sistema_operativo on equipos
  for each row execute function trg_equipos_so();
update equipos set so_version = so_version
 where so_version is not null and sistema_operativo is not null
   and lower(so_version) like lower(sistema_operativo) || ' %';

-- ------------------------------------------------------------------ Permisos
revoke execute on function consola_anotar(text, boolean, text) from public, anon;
revoke execute on function registro(text[], text, timestamptz, timestamptz, text, int, int) from public, anon;
grant execute on function consola_anotar(text, boolean, text) to authenticated;
grant execute on function registro(text[], text, timestamptz, timestamptz, text, int, int) to authenticated;
revoke execute on function trg_chat_mantenimiento() from public, anon, authenticated;

commit;
