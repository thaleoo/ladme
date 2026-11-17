-- ============================================================================
-- 0004 — Registro de errores de la aplicación
--
-- Aplicar UNA vez en el SQL Editor de Supabase, después de 0003.
--
-- La PWA reporta aquí los fallos que ocurren en los teléfonos de los usuarios
-- (errores de JavaScript, pantallas que se quedan cargando, partes de la app
-- que no se pudieron descargar). El personal los consulta en Administración →
-- Errores. No guarda contenido de formularios ni datos personales más allá de
-- quién estaba conectado.
-- ============================================================================

begin;

create table if not exists errores_app (
  id          bigint generated always as identity primary key,
  tipo        text not null check (tipo in ('error', 'promesa', 'carga_lenta', 'chunk', 'render')),
  mensaje     text not null,
  pila        text,
  ruta        text,
  agente      text,
  version     text,
  usuario_id  uuid references perfiles (id) on delete set null,
  creado_en   timestamptz not null default now()
);
create index if not exists errores_app_fecha_idx on errores_app (creado_en desc);
alter table errores_app enable row level security;
drop policy if exists errores_ver on errores_app;
create policy errores_ver on errores_app for select to authenticated using (es_staff());

-- Se puede llamar sin sesión (la pantalla de ingreso también puede fallar).
-- Límites para que nadie llene la tabla: textos recortados, 20 por persona cada
-- 10 minutos, 400 en total por hora; se borran los de más de 90 días.
create or replace function registrar_error(p_tipo text, p_mensaje text, p_pila text default null,
                                           p_ruta text default null, p_agente text default null,
                                           p_version text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v uuid := auth.uid(); begin
  if p_tipo not in ('error', 'promesa', 'carga_lenta', 'chunk', 'render') then return; end if;
  if nullif(trim(coalesce(p_mensaje, '')), '') is null then return; end if;
  if (select count(*) from errores_app where creado_en > now() - interval '1 hour') >= 400 then return; end if;
  if (select count(*) from errores_app
       where creado_en > now() - interval '10 minutes'
         and usuario_id is not distinct from v
         and (v is not null or agente is not distinct from left(p_agente, 300))) >= 20 then return; end if;
  delete from errores_app where creado_en < now() - interval '90 days';
  insert into errores_app (tipo, mensaje, pila, ruta, agente, version, usuario_id)
  values (p_tipo, left(p_mensaje, 500), left(p_pila, 2000), left(p_ruta, 200), left(p_agente, 300),
          left(p_version, 40), case when exists (select 1 from perfiles where id = v) then v end);
end $$;

revoke all on errores_app from anon, authenticated;
grant select on errores_app to authenticated;
revoke execute on function registrar_error from public;
grant execute on function registrar_error to anon, authenticated;

commit;
