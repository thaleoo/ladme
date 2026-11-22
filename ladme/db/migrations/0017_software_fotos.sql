-- 0017 · Solicitudes de software y foto de cada equipo
-- Ejecutar después de 0016. Idempotente.
--
--   A. Solicitudes de software: al reservar («Necesito un software que no está instalado») o sin
--      reserva, desde Disponibilidad. La reserva no depende de la solicitud. Se pide con
--      anticipación (política software_anticipacion_dias, días hábiles). El personal la marca
--      «Enviada a TI», «Instalado en…» (y el programa se agrega a esos equipos) o «Rechazada»;
--      la persona recibe un aviso en cada cambio. Llega al chat con botones.
--   B. Foto del equipo: equipos.foto_url, guardada en el almacenamiento público «equipos».
begin;

insert into politicas (clave, valor, descripcion) values
  ('software_anticipacion_dias', '3', 'Días hábiles de anticipación para pedir que se instale un software (TI y OTIC necesitan tiempo).')
on conflict (clave) do nothing;

-- Días hábiles (lunes a viernes) entre hoy y una fecha, sin contar hoy.
create or replace function _dias_habiles_hasta(p_fecha date) returns int
language sql stable as $$
  select count(*)::int from generate_series((now() at time zone 'America/Bogota')::date + 1, p_fecha, interval '1 day') d
   where extract(isodow from d) < 6 $$;

-- ===================================================================== A. Solicitudes de software
create table if not exists solicitudes_software (
  id                 bigint generated always as identity primary key,
  solicitante        uuid not null references perfiles (id) on delete cascade,
  reserva_id         uuid references reservas (id) on delete set null,
  equipo_id          uuid references equipos (id) on delete set null,
  software           text not null check (char_length(software) between 2 and 200),
  version            text check (char_length(version) <= 60),
  uso                text not null check (char_length(uso) between 10 and 600),
  enlace             text check (char_length(enlace) <= 300),
  para_fecha         date,
  estado             text not null default 'pendiente' check (estado in ('pendiente', 'en_tramite', 'instalado', 'rechazada', 'cancelada')),
  equipos_instalados text[] not null default '{}',
  respuesta          text check (char_length(respuesta) <= 400),
  resuelto_por       uuid references perfiles (id),
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now()
);
create index if not exists solicitudes_software_estado_idx on solicitudes_software (estado, creado_en);
alter table solicitudes_software enable row level security;
drop policy if exists software_lectura on solicitudes_software;
create policy software_lectura on solicitudes_software for select using (solicitante = auth.uid() or es_staff());

create or replace function solicitar_software(p_software text, p_uso text, p_version text default null, p_enlace text default null,
                                              p_reserva uuid default null, p_equipo text default null, p_fecha date default null)
returns solicitudes_software
language plpgsql security definer set search_path = public as $$
declare
  v uuid := _perfil_activo(); s solicitudes_software; r reservas; v_eq uuid; v_fecha date := p_fecha; v_nombre text;
  v_dias int := coalesce(politica_int('software_anticipacion_dias'), 3);
begin
  if char_length(btrim(coalesce(p_software, ''))) < 2 then raise exception 'Escriba qué software necesita.'; end if;
  if char_length(btrim(coalesce(p_uso, ''))) < 10 then raise exception 'Cuente para qué lo va a usar (al menos 10 caracteres).'; end if;
  if p_reserva is not null then
    select * into r from reservas where id = p_reserva and usuario_id = v and estado = 'activa';
    if not found then raise exception 'Reserva no encontrada.'; end if;
    v_eq := r.equipo_id;
    v_fecha := (r.inicio at time zone 'America/Bogota')::date;
  elsif nullif(btrim(coalesce(p_equipo, '')), '') is not null then
    select id into v_eq from equipos where codigo = upper(btrim(p_equipo)) and not archivado;
    if v_eq is null then raise exception 'No existe el equipo %.', p_equipo; end if;
  end if;
  if v_fecha is not null and not es_staff() and _dias_habiles_hasta(v_fecha) < v_dias then
    raise exception 'Para instalar software se necesitan % días hábiles de anticipación: pídalo para una fecha posterior.', v_dias;
  end if;
  insert into solicitudes_software (solicitante, reserva_id, equipo_id, software, version, uso, enlace, para_fecha)
  values (v, p_reserva, v_eq, btrim(p_software), nullif(btrim(coalesce(p_version, '')), ''), btrim(p_uso),
          nullif(btrim(coalesce(p_enlace, '')), ''), v_fecha)
  returning * into s;
  select nombre into v_nombre from perfiles where id = v;
  perform _avisar_chat('software_solicitud', 'soft:' || s.id,
    'Solicitud de software #' || s.id || ': ' || s.software || coalesce(' (' || s.version || ')', '') ||
    coalesce(' para el ' || to_char(s.para_fecha, 'DD/MM'), '') ||
    coalesce(' en ' || (select codigo from equipos where id = s.equipo_id), '') || '. Uso: «' || left(s.uso, 200) || '»',
    '/admin?tab=software');
  perform _avisar_staff('software_solicitud', 'soft_staff:' || s.id, 'Solicitud de software: ' || s.software,
    coalesce(v_nombre, 'Una persona') || ' pide instalar ' || s.software || coalesce(' para el ' || to_char(s.para_fecha, 'DD/MM'), '') || '.',
    '/admin?tab=software');
  return s;
end $$;

create or replace function cancelar_software(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  update solicitudes_software set estado = 'cancelada', actualizado_en = now()
   where id = p_id and solicitante = _perfil_activo() and estado in ('pendiente', 'en_tramite');
  if not found then raise exception 'La solicitud no existe o ya fue resuelta.'; end if;
end $$;

-- El personal avanza la solicitud. «instalado» agrega el programa a la lista de esos equipos.
create or replace function actualizar_software(p_id bigint, p_estado text, p_equipos text[] default null, p_respuesta text default null)
returns solicitudes_software
language plpgsql security definer set search_path = public as $$
declare v uuid := _perfil_activo(); s solicitudes_software; v_eqs text[]; v_titulo text; v_cuerpo text; begin
  if not es_staff() then raise exception 'Solo el personal.' using errcode = '42501'; end if;
  select * into s from solicitudes_software where id = p_id for update;
  if not found then raise exception 'Solicitud no encontrada.'; end if;
  if s.estado in ('instalado', 'rechazada', 'cancelada') then raise exception 'La solicitud ya está %.', s.estado; end if;
  if p_estado not in ('en_tramite', 'instalado', 'rechazada') then raise exception 'Estado no válido.'; end if;
  if p_estado = 'rechazada' and char_length(btrim(coalesce(p_respuesta, ''))) < 5 then raise exception 'Escriba el motivo para la persona.'; end if;
  if p_estado = 'instalado' then
    if coalesce(cardinality(p_equipos), 0) = 0 then raise exception 'Indique en qué equipos quedó instalado.'; end if;
    if exists (select 1 from unnest(p_equipos) x where upper(x) in ('SALA', 'TODOS')) then
      select array_agg(codigo order by codigo) into v_eqs from equipos where not archivado;
    else
      select array_agg(distinct upper(x) order by upper(x)) into v_eqs from unnest(p_equipos) x;
      if exists (select 1 from unnest(v_eqs) c where not exists (select 1 from equipos e where e.codigo = c and not e.archivado)) then
        raise exception 'Alguno de esos equipos no existe.';
      end if;
    end if;
    update equipos set software = (select array_agg(distinct p order by p) from unnest(software || array[s.software]) p)
     where codigo = any (v_eqs) and not (s.software = any (software));
  end if;
  update solicitudes_software set estado = p_estado, equipos_instalados = coalesce(v_eqs, equipos_instalados),
                                  respuesta = coalesce(nullif(btrim(p_respuesta), ''), respuesta), resuelto_por = v, actualizado_en = now()
   where id = s.id returning * into s;
  v_titulo := case p_estado when 'en_tramite' then 'Software en trámite: ' when 'instalado' then 'Software instalado: ' else 'Software no instalado: ' end || s.software;
  v_cuerpo := case p_estado
    when 'en_tramite' then 'El laboratorio envió su solicitud de ' || s.software || ' a TI. Le avisaremos cuando quede instalado.'
    when 'instalado' then s.software || ' quedó instalado en ' || array_to_string(s.equipos_instalados, ', ') || '.'
    else 'No se pudo instalar ' || s.software || '. Motivo: ' || btrim(p_respuesta) || '.' end ||
    case when p_estado <> 'rechazada' and nullif(btrim(p_respuesta), '') is not null then ' Nota: ' || btrim(p_respuesta) else '' end;
  perform _avisar(s.solicitante, 'software_' || p_estado, 'soft_' || p_estado || ':' || s.id, v_titulo, v_cuerpo, '/mis-reservas#software',
                  null, null, null, p_estado <> 'en_tramite');
  return s;
end $$;

-- ===================================================================== Bot: botones de software
create or replace function telegram_ejecutar(p_telegram_id bigint, p_accion text, p_args jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_perfil uuid; v_nombre text; v_res jsonb; s solicitudes_software; v_eqs text[]; begin
  select t.perfil_id, split_part(p.nombre, ' ', 1) into v_perfil, v_nombre
    from telegram_vinculos t join perfiles p on p.id = t.perfil_id where t.telegram_id = p_telegram_id;
  if p_accion not in ('verificar', 'no_verificar', 'anular', 'mantener', 'software_tramite', 'software_instalado', 'software_rechazar') then
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
      when 'software_tramite' then s := actualizar_software((p_args ->> 'id')::bigint, 'en_tramite');
      when 'software_rechazar' then s := actualizar_software((p_args ->> 'id')::bigint, 'rechazada', null, p_args ->> 'motivo');
      when 'software_instalado' then
        -- Los equipos llegan como respuesta escrita («3 5 UNAL-07» o «sala»).
        select array_agg(case when x ~ '^\d+$' then 'UNAL-' || lpad(x, 2, '0') when upper(x) ~ '^[A-Z]+\d+$'
                              then regexp_replace(upper(x), '^([A-Z]+)(\d+)$', '\1-\2') else upper(x) end)
          into v_eqs from regexp_split_to_table(btrim(coalesce(p_args ->> 'equipos', p_args ->> 'motivo', '')), '[\s,;]+') x where x <> '';
        s := actualizar_software((p_args ->> 'id')::bigint, 'instalado', v_eqs);
    end case;
    v_res := jsonb_build_object('id', p_args ->> 'id') ||
             case when s.id is not null then jsonb_build_object('software', s.software, 'equipos', to_jsonb(s.equipos_instalados)) else '{}'::jsonb end;
  exception when others then
    insert into consola_registro (actor, comando, ok, resultado)
    values (v_perfil, left('Telegram /' || p_accion || ' ' || p_args::text, 300), false, left(sqlerrm, 500));
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'actor', v_nombre);
  end;
  insert into consola_registro (actor, comando, ok, resultado)
  values (v_perfil, left('Telegram /' || p_accion || ' ' || p_args::text, 300), true, left(v_res::text, 500));
  return jsonb_build_object('ok', true, 'datos', v_res, 'actor', v_nombre);
end $$;

-- ===================================================================== B. Foto del equipo
alter table equipos add column if not exists foto_url text check (char_length(foto_url) <= 500);

-- Almacenamiento público «equipos» (solo en Supabase; en una base local sin almacenamiento se omite).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('equipos', 'equipos', true, 3145728, array['image/webp', 'image/jpeg', 'image/png'])
    on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    execute 'drop policy if exists equipos_fotos_subir on storage.objects';
    execute 'drop policy if exists equipos_fotos_cambiar on storage.objects';
    execute 'drop policy if exists equipos_fotos_borrar on storage.objects';
    execute $p$create policy equipos_fotos_subir on storage.objects for insert to authenticated with check (bucket_id = 'equipos' and public.es_staff())$p$;
    execute $p$create policy equipos_fotos_cambiar on storage.objects for update to authenticated using (bucket_id = 'equipos' and public.es_staff())$p$;
    execute $p$create policy equipos_fotos_borrar on storage.objects for delete to authenticated using (bucket_id = 'equipos' and public.es_staff())$p$;
  end if;
end $$;

-- ===================================================================== Permisos
revoke all on solicitudes_software from anon, authenticated;
grant select on solicitudes_software to authenticated;
revoke execute on function _dias_habiles_hasta(date) from public, anon, authenticated;
revoke execute on function telegram_ejecutar(bigint, text, jsonb) from public, anon, authenticated;
grant execute on function telegram_ejecutar(bigint, text, jsonb) to service_role;
revoke execute on function solicitar_software(text, text, text, text, uuid, text, date), cancelar_software(bigint),
  actualizar_software(bigint, text, text[], text) from public, anon;
grant execute on function solicitar_software(text, text, text, text, uuid, text, date), cancelar_software(bigint),
  actualizar_software(bigint, text, text[], text) to authenticated;

commit;
