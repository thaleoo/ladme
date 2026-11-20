-- 0013 · Docentes verificados y aprobación completa de la sala para clases
-- Ejecutar después de 0012. Idempotente.
--
--   A. Docente verificado: cualquiera puede indicar en su perfil que es docente/investigador (así
--      sigue reservando con normalidad), pero pedir la sala para clases exige que el personal lo
--      verifique. Al elegir ese tipo se abre una verificación; el personal la aprueba o la rechaza.
--   B. Solicitudes de clase: el docente responsable es siempre quien la pide (nombre y correo, no
--      editables); «equipos_pedidos» vacío significa «los que haya disponibles»; no se aceptan
--      solicitudes cuyas sesiones ya pasaron.
--   C. Autorización para el docente: clase_hoja() reúne todo lo que necesita la hoja imprimible y el
--      correo con PDF que envía el Apps Script; clase_reenviar() vuelve a mandar ese correo.
begin;

-- ===================================================================== A. Docentes verificados
alter table perfiles add column if not exists docente_verificado_en timestamptz;

create table if not exists verificaciones_docente (
  id            bigint generated always as identity primary key,
  perfil_id     uuid not null references perfiles (id) on delete cascade,
  mensaje       text check (char_length(mensaje) <= 300),
  estado        text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada', 'retirada')),
  respuesta     text check (char_length(respuesta) <= 300),
  resuelto_por  uuid references perfiles (id),
  resuelto_en   timestamptz,
  creado_en     timestamptz not null default now()
);
create unique index if not exists verificaciones_docente_pendiente on verificaciones_docente (perfil_id) where estado = 'pendiente';
alter table verificaciones_docente enable row level security;
drop policy if exists verificaciones_lectura on verificaciones_docente;
create policy verificaciones_lectura on verificaciones_docente for select using (perfil_id = auth.uid() or es_staff());

-- Abre (o completa) la verificación pendiente de una persona y avisa al personal una sola vez.
create or replace function _abrir_verificacion(p_perfil uuid, p_mensaje text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_nombre text; begin
  update verificaciones_docente set mensaje = coalesce(left(nullif(btrim(p_mensaje), ''), 300), mensaje)
   where perfil_id = p_perfil and estado = 'pendiente';
  if found then return; end if;
  insert into verificaciones_docente (perfil_id, mensaje) values (p_perfil, left(nullif(btrim(p_mensaje), ''), 300))
  returning id into v_id;
  select nombre into v_nombre from perfiles where id = p_perfil;
  -- El chat del personal no lleva datos personales; el aviso en la app sí lleva el nombre.
  perform _avisar_chat('verificacion_docente', 'verif:' || v_id, 'Hay una nueva solicitud de verificación docente en la app.', '/admin?tab=solicitudes');
  perform _avisar_staff('verificacion_docente', 'verif_staff:' || v_id, 'Verificación docente: ' || coalesce(v_nombre, ''),
    coalesce(v_nombre, 'Una persona') || ' indicó que es docente/investigador. Verifíquelo para que pueda pedir la sala para clases.',
    '/admin?tab=solicitudes');
end $$;

-- Al cambiar el tipo de usuario: elegir docente abre la verificación; dejarlo la quita.
create or replace function trg_perfiles_docente() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tipo_usuario is not distinct from old.tipo_usuario then return new; end if;
  if new.tipo_usuario = 'Docente/Investigador' then
    if new.docente_verificado_en is null and new.rol = 'usuario' then perform _abrir_verificacion(new.id); end if;
  else
    new.docente_verificado_en := null;
    update verificaciones_docente set estado = 'retirada', resuelto_en = now() where perfil_id = new.id and estado = 'pendiente';
  end if;
  return new;
end $$;
drop trigger if exists perfiles_docente on perfiles;
create trigger perfiles_docente before update of tipo_usuario on perfiles for each row execute function trg_perfiles_docente();

-- La persona explica a qué se dedica (asignaturas, dependencia) para que el personal lo verifique.
create or replace function pedir_verificacion_docente(p_mensaje text) returns void
language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); p perfiles; begin
  select * into p from perfiles where id = v;
  if p.tipo_usuario is distinct from 'Docente/Investigador' then
    raise exception 'Primero indique en su perfil que es docente/investigador.';
  end if;
  if p.docente_verificado_en is not null then return; end if;
  if char_length(btrim(coalesce(p_mensaje, ''))) < 5 then raise exception 'Cuéntenos qué asignaturas dicta o en qué dependencia trabaja.'; end if;
  perform _abrir_verificacion(v, p_mensaje);
end $$;

create or replace function verificaciones_pendientes()
returns table (id bigint, perfil_id uuid, nombre text, correo text, programa text, mensaje text, creado_en timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not es_staff() then raise exception 'Solo el personal.' using errcode = '42501'; end if;
  return query
    select v.id, p.id, p.nombre, p.correo, p.programa, v.mensaje, v.creado_en
      from verificaciones_docente v join perfiles p on p.id = v.perfil_id
     where v.estado = 'pendiente' order by v.creado_en;
end $$;

create or replace function resolver_verificacion(p_id bigint, p_aprobar boolean, p_respuesta text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); s verificaciones_docente; begin
  if not es_staff() then raise exception 'Solo el personal.' using errcode = '42501'; end if;
  select * into s from verificaciones_docente where id = p_id for update;
  if not found or s.estado <> 'pendiente' then raise exception 'La verificación ya no está pendiente.'; end if;
  if p_aprobar then
    update verificaciones_docente set estado = 'aprobada', respuesta = nullif(btrim(p_respuesta), ''), resuelto_por = v, resuelto_en = now()
     where id = s.id;
    update perfiles set docente_verificado_en = now() where id = s.perfil_id;
    perform _avisar(s.perfil_id, 'docente_verificado', 'docente_ok:' || s.id, 'Ya puede pedir la sala para sus clases',
      'El laboratorio verificó que es docente. Desde «Sala para clases» puede solicitar los computadores para sus clases.', '/clases');
  else
    if char_length(btrim(coalesce(p_respuesta, ''))) < 5 then raise exception 'Escriba el motivo para la persona.'; end if;
    update verificaciones_docente set estado = 'rechazada', respuesta = btrim(p_respuesta), resuelto_por = v, resuelto_en = now()
     where id = s.id;
    update perfiles set tipo_usuario = null where id = s.perfil_id;
    perform _avisar(s.perfil_id, 'docente_rechazado', 'docente_no:' || s.id, 'No pudimos verificar que sea docente',
      'Motivo: ' || btrim(p_respuesta) || '. Actualice su tipo de usuario en «Cuenta» para seguir reservando.', '/cuenta#perfil');
  end if;
end $$;

-- El personal marca o quita la verificación directamente (desde Usuarios).
create or replace function marcar_docente(p_perfil uuid, p_verificado boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); begin
  if not es_staff() then raise exception 'Solo el personal.' using errcode = '42501'; end if;
  if p_verificado then
    update perfiles set tipo_usuario = 'Docente/Investigador', docente_verificado_en = coalesce(docente_verificado_en, now())
     where id = p_perfil;
    update verificaciones_docente set estado = 'aprobada', resuelto_por = v, resuelto_en = now()
     where perfil_id = p_perfil and estado = 'pendiente';
  else
    update perfiles set docente_verificado_en = null where id = p_perfil;
  end if;
end $$;

-- Quien ya figuraba como docente queda con su verificación pendiente para aprobarla con un clic.
insert into verificaciones_docente (perfil_id, mensaje)
select p.id, 'Ya figuraba como docente/investigador antes de la verificación.'
  from perfiles p
 where p.tipo_usuario = 'Docente/Investigador' and p.rol = 'usuario' and p.docente_verificado_en is null
   and not exists (select 1 from verificaciones_docente v where v.perfil_id = p.id and v.estado = 'pendiente');

-- ===================================================================== B. Solicitudes de clase
alter table clases add column if not exists docente_correo text;
update clases c set docente_correo = p.correo from perfiles p where p.id = c.solicitante and c.docente_correo is null;

create or replace function solicitar_clase(p_nombre text, p_docente text, p_grupo int, p_dias int[], p_hora_inicio time,
                                           p_hora_fin time, p_desde date, p_hasta date, p_equipos int default null,
                                           p_notas text default null) returns clases
language plpgsql security definer set search_path = public as $$
declare
  v uuid := _perfil_activo(); p perfiles; c clases; n int; v_total int;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
begin
  select * into p from perfiles where id = v;
  if not es_staff() and p.docente_verificado_en is null then
    raise exception 'Solo docentes verificados pueden solicitar la sala para una clase. Solicite la verificación en «Cuenta».';
  end if;
  if p_desde < v_hoy then raise exception 'La primera fecha no puede estar en el pasado.'; end if;
  if p_hasta > p_desde + 7 * coalesce(politica_int('clase_semanas_max'), 20) then
    raise exception 'La solicitud puede abarcar como máximo % semanas.', coalesce(politica_int('clase_semanas_max'), 20);
  end if;
  if p_hora_fin - p_hora_inicio > interval '8 hours' or p_hora_fin - p_hora_inicio < interval '30 minutes' then
    raise exception 'Cada sesión debe durar entre 30 minutos y 8 horas.';
  end if;
  select count(*) into v_total from equipos where not archivado and estado = 'activo';
  if p_equipos is not null and (p_equipos < 1 or p_equipos > greatest(v_total, 1)) then
    raise exception 'Puede pedir entre 1 y % equipos, o «los que haya disponibles».', v_total;
  end if;
  -- El docente responsable es quien hace la solicitud: nombre y correo de su cuenta.
  insert into clases (solicitante, nombre, docente, docente_correo, grupo, dias, hora_inicio, hora_fin, desde, hasta, equipos_pedidos, notas)
  values (v, btrim(p_nombre), left(coalesce(nullif(btrim(p.nombre), ''), split_part(p.correo, '@', 1)), 120), p.correo, p_grupo,
          (select array_agg(distinct x::smallint order by x::smallint) from unnest(p_dias) x),
          p_hora_inicio, p_hora_fin, p_desde, p_hasta, p_equipos, nullif(btrim(p_notas), ''))
  returning * into c;
  select count(*) into n from _clase_sesiones(c);
  if n = 0 then raise exception 'Entre esas fechas no cae ninguno de los días elegidos.'; end if;
  select count(*) into n from _clase_sesiones(c) s where s.inicio > now();
  if n = 0 then raise exception 'Las sesiones de esas fechas ya empezaron o pasaron: elija fechas u horas futuras.'; end if;
  perform _avisar_chat('clase_solicitud', 'clase:' || c.id,
    'Nueva solicitud de sala para clase: ' || c.nombre || ' (grupo ' || c.grupo || '), ' || _texto_dias(c.dias) || ' ' ||
    to_char(c.hora_inicio, 'HH24:MI') || '–' || to_char(c.hora_fin, 'HH24:MI') || ', del ' || to_char(c.desde, 'DD/MM') ||
    ' al ' || to_char(c.hasta, 'DD/MM') || ' (' || n || ' sesiones, ' ||
    coalesce(c.equipos_pedidos || ' equipos', 'los equipos disponibles') || ').', '/admin/clases/' || c.id);
  perform _avisar_staff('clase_solicitud', 'clase_staff:' || c.id, 'Solicitud de sala para clase: ' || c.nombre,
    c.docente || ' solicita la sala para ' || c.nombre || ' (grupo ' || c.grupo || '): ' || _texto_dias(c.dias) || ', ' ||
    to_char(c.hora_inicio, 'HH24:MI') || '–' || to_char(c.hora_fin, 'HH24:MI') || '.', '/admin/clases/' || c.id);
  return c;
end $$;

-- Vista previa: solo cuentan las sesiones que aún no empiezan; también dice cuántas ya pasaron.
create or replace function clase_previa(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c clases; v jsonb; begin
  if not es_staff() then raise exception 'Solo el personal.' using errcode = '42501'; end if;
  select * into c from clases where id = p_id;
  if not found then raise exception 'Solicitud no encontrada.'; end if;
  with s as (select * from _clase_sesiones(c) where inicio > now()),
       e as (select id, codigo, nombre from equipos where not archivado and estado = 'activo'),
       libre as (
         select e.codigo, s.inicio,
                not exists (select 1 from reservas x where x.equipo_id = e.id and x.estado = 'activa' and x.liberada_en is null
                              and x.periodo && tstzrange(s.inicio, s.fin, '[)') and coalesce(x.clase_id, 0) <> c.id) as ok
           from e cross join s)
  select jsonb_build_object(
    'sesiones', coalesce((select jsonb_agg(jsonb_build_object('inicio', s.inicio, 'fin', s.fin,
                 'libres', (select count(*) from libre l where l.inicio = s.inicio and l.ok)) order by s.inicio) from s), '[]'),
    'total_sesiones', (select count(*) from s),
    'pasadas', (select count(*) from _clase_sesiones(c) x where x.inicio <= now()),
    'total_equipos', (select count(*) from e),
    'equipos', coalesce((select jsonb_agg(jsonb_build_object('codigo', e.codigo, 'nombre', e.nombre,
                  'libres', (select count(*) from libre l where l.codigo = e.codigo and l.ok)) order by e.codigo) from e), '[]'))
    into v;
  return v;
end $$;

create or replace function aprobar_clase(p_id bigint, p_equipos text[], p_respuesta text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); c clases; s record; e record; n int := 0; v_omit jsonb := '[]'::jsonb; v_lista text; v_eq text[]; begin
  if not es_staff() then raise exception 'Solo el personal.' using errcode = '42501'; end if;
  select * into c from clases where id = p_id for update;
  if not found then raise exception 'Solicitud no encontrada.'; end if;
  if c.estado <> 'pendiente' then raise exception 'La solicitud ya fue %.', c.estado; end if;
  if coalesce(cardinality(p_equipos), 0) = 0 then raise exception 'Elija al menos un equipo.'; end if;
  if not exists (select 1 from _clase_sesiones(c) x where x.inicio > now()) then
    raise exception 'Todas las sesiones de esta solicitud ya empezaron o pasaron: rechácela o pida al docente una nueva.';
  end if;
  select array_agg(distinct upper(x) order by upper(x)) into v_eq from unnest(p_equipos) x;
  for s in select * from _clase_sesiones(c) where inicio > now() loop
    for e in select id, codigo from equipos where codigo = any (v_eq) and not archivado order by codigo loop
      begin
        insert into reservas (tipo, equipo_id, usuario_id, inicio, fin, motivo, clase_id)
        values ('bloqueo', e.id, v, s.inicio, s.fin, left('Clase · ' || c.nombre || ' · grupo ' || c.grupo, 200), c.id);
        n := n + 1;
      exception when exclusion_violation then
        v_omit := v_omit || jsonb_build_object('codigo', e.codigo, 'inicio', s.inicio);
      end;
    end loop;
  end loop;
  select string_agg(x, ', ' order by x) into v_lista from unnest(v_eq) x;
  update clases set estado = 'aprobada', equipos = v_eq,
                    respuesta = nullif(btrim(p_respuesta), ''), resuelto_por = v, resuelto_en = now()
   where id = c.id;
  -- El correo de este aviso lo arma el Apps Script como autorización formal con PDF (clase_hoja_correo).
  perform _avisar(c.solicitante, 'clase_aprobada', 'clase_ok:' || c.id, 'Sala aprobada: ' || c.nombre || ' · grupo ' || c.grupo,
    'Su clase ' || c.nombre || ' (grupo ' || c.grupo || ') tiene la sala aprobada: ' || _texto_dias(c.dias) || ', ' ||
    to_char(c.hora_inicio, 'HH24:MI') || '–' || to_char(c.hora_fin, 'HH24:MI') || '. Equipos habilitados: ' || v_lista ||
    '. Imprima la autorización y pida a sus estudiantes usar solo esos equipos.' ||
    coalesce(' Nota del laboratorio: ' || nullif(btrim(p_respuesta), ''), ''),
    '/clases/' || c.id, null, null, (select correo from perfiles where id = v));
  return jsonb_build_object('creadas', n, 'omitidas', v_omit, 'equipos', to_jsonb(v_eq));
end $$;

-- ===================================================================== C. Autorización para el docente
create or replace function _clase_hoja(p_id bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', c.id, 'consecutivo', 'CL-' || lpad(c.id::text, 5, '0'), 'nombre', c.nombre, 'grupo', c.grupo,
    'docente', c.docente, 'docente_correo', coalesce(c.docente_correo, p.correo), 'estado', c.estado,
    'dias', c.dias, 'dias_texto', _texto_dias(c.dias), 'hora_inicio', to_char(c.hora_inicio, 'HH24:MI'),
    'hora_fin', to_char(c.hora_fin, 'HH24:MI'), 'desde', c.desde, 'hasta', c.hasta, 'notas', c.notas,
    'equipos_pedidos', c.equipos_pedidos, 'equipos', coalesce(to_jsonb(c.equipos), '[]'), 'respuesta', c.respuesta,
    'aprobado_por', a.nombre, 'aprobado_correo', a.correo, 'resuelto_en', c.resuelto_en,
    'sesiones', coalesce((select jsonb_agg(jsonb_build_object('inicio', s.inicio, 'fin', s.fin,
                   'equipos', (select count(*) from reservas r where r.clase_id = c.id and r.estado = 'activa' and r.inicio = s.inicio),
                   'pasada', s.fin <= now()) order by s.inicio) from _clase_sesiones(c) s), '[]'),
    'omitidos', coalesce((select jsonb_agg(jsonb_build_object('codigo', e.codigo, 'inicio', s.inicio) order by s.inicio, e.codigo)
                   from _clase_sesiones(c) s cross join unnest(c.equipos) q(cod) join equipos e on e.codigo = q.cod
                  where c.estado = 'aprobada' and s.inicio >= c.resuelto_en
                    and not exists (select 1 from reservas r where r.clase_id = c.id and r.equipo_id = e.id and r.inicio = s.inicio)), '[]'))
    from clases c join perfiles p on p.id = c.solicitante left join perfiles a on a.id = c.resuelto_por
   where c.id = p_id $$;

create or replace function clase_hoja(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid := _perfil_activo(); begin
  if not exists (select 1 from clases where id = p_id and (solicitante = v or es_staff())) then
    raise exception 'Solicitud no encontrada.';
  end if;
  return _clase_hoja(p_id);
end $$;

-- Para el correo con la autorización en PDF (lo llama el Apps Script con la clave de servicio).
create or replace function clase_hoja_correo(p_id bigint) returns jsonb
language sql stable security definer set search_path = public as $$ select _clase_hoja(p_id) $$;

create or replace function clase_reenviar(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); c clases; begin
  if not es_staff() then raise exception 'Solo el personal.' using errcode = '42501'; end if;
  select * into c from clases where id = p_id;
  if not found or c.estado <> 'aprobada' then raise exception 'Solo se puede reenviar una clase aprobada.'; end if;
  -- Uno cada 10 minutos como máximo, para no llenar el correo del docente.
  perform _avisar(c.solicitante, 'clase_aprobada', 'clase_ok:' || c.id || ':' || (extract(epoch from now())::bigint / 600),
    'Autorización de sala: ' || c.nombre || ' · grupo ' || c.grupo,
    'Le reenviamos la autorización de su clase ' || c.nombre || ' (grupo ' || c.grupo || ') con los equipos habilitados: ' ||
    array_to_string(c.equipos, ', ') || '.', '/clases/' || c.id, null, null, (select correo from perfiles where id = v));
end $$;

-- ===================================================================== Permisos
revoke all on verificaciones_docente from anon, authenticated;
grant select on verificaciones_docente to authenticated;
revoke execute on function _abrir_verificacion(uuid, text), trg_perfiles_docente(), _clase_hoja(bigint), clase_hoja_correo(bigint)
  from public, anon, authenticated;
grant execute on function clase_hoja_correo(bigint) to service_role;
revoke execute on function pedir_verificacion_docente(text), verificaciones_pendientes(), resolver_verificacion(bigint, boolean, text),
  marcar_docente(uuid, boolean), clase_hoja(bigint), clase_reenviar(bigint) from public, anon;
grant execute on function pedir_verificacion_docente(text), verificaciones_pendientes(), resolver_verificacion(bigint, boolean, text),
  marcar_docente(uuid, boolean), clase_hoja(bigint), clase_reenviar(bigint), solicitar_clase(text, text, int, int[], time, time, date, date, int, text),
  clase_previa(bigint), aprobar_clase(bigint, text[], text) to authenticated;

commit;
