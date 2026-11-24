-- 0019 · Límites al guardar el perfil
-- Ejecutar después de 0018. Idempotente.
--
-- Antes se podía pulsar «Guardar perfil» sin parar, y alternar Estudiante ↔ Docente abría
-- una verificación nueva cada vez, con su mensaje al chat del personal y sus avisos.
--   A. Guardar sin cambios no escribe nada.
--   B. Una persona puede cambiar sus datos hasta 6 veces por hora; luego debe esperar.
--   C. Volver a elegir Docente/Investigador dentro de 24 h reabre la misma verificación, sin
--      volver a avisar al personal.
begin;

alter table perfiles add column if not exists perfil_cambios_desde timestamptz;
alter table perfiles add column if not exists perfil_cambios int not null default 0;

-- Se dispara antes que perfiles_docente (los disparadores van en orden alfabético), así un
-- cambio rechazado no alcanza a abrir una verificación.
create or replace function trg_perfiles_limite() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Solo cuando la persona edita su propio perfil; el personal usa otras funciones.
  if auth.uid() is distinct from new.id then return new; end if;
  if new is not distinct from old then return null; end if;   -- nada cambió: no se escribe
  if (new.nombre, new.programa, new.tipo_usuario, new.matricula)
     is not distinct from (old.nombre, old.programa, old.tipo_usuario, old.matricula) then
    return new;                                                -- cambió otra cosa: no cuenta
  end if;
  if old.perfil_cambios_desde is null or old.perfil_cambios_desde < now() - interval '1 hour' then
    new.perfil_cambios_desde := now();
    new.perfil_cambios := 1;
  elsif old.perfil_cambios >= 6 then
    raise exception 'Ya cambió su perfil varias veces en la última hora. Intente de nuevo más tarde.' using errcode = 'P0001';
  else
    new.perfil_cambios := old.perfil_cambios + 1;
  end if;
  return new;
end $$;
drop trigger if exists perfiles_a_limite on perfiles;
create trigger perfiles_a_limite before update of nombre, programa, tipo_usuario, matricula on perfiles
  for each row execute function trg_perfiles_limite();

-- Abre (o completa) la verificación pendiente y avisa al personal una sola vez. Si la persona
-- la retiró hace menos de 24 h (pasó a Estudiante y volvió), se reabre la misma en silencio.
create or replace function _abrir_verificacion(p_perfil uuid, p_mensaje text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_nombre text; begin
  update verificaciones_docente set mensaje = coalesce(left(nullif(btrim(p_mensaje), ''), 300), mensaje)
   where perfil_id = p_perfil and estado = 'pendiente';
  if found then return; end if;
  update verificaciones_docente
     set estado = 'pendiente', resuelto_en = null,
         mensaje = coalesce(left(nullif(btrim(p_mensaje), ''), 300), mensaje)
   where id = (select id from verificaciones_docente
                where perfil_id = p_perfil and estado = 'retirada' and creado_en > now() - interval '24 hours'
                order by creado_en desc limit 1);
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

revoke execute on function trg_perfiles_limite(), _abrir_verificacion(uuid, text) from public, anon, authenticated;

commit;
