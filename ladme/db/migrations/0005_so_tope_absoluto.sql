-- ============================================================================
-- 0005 — Sistema operativo de cada equipo y tope absoluto de duración
--
-- Aplicar UNA vez en el SQL Editor de Supabase, después de 0004.
--
--   A. Sistema operativo y versión/distribución de cada equipo (se muestran
--      antes de reservar y se pueden filtrar). Se llenan en Administración →
--      Equipos; aquí no se adivinan.
--   B. Tope absoluto: ninguna reserva hecha desde la aplicación puede durar más
--      de 30 días, ni siquiera la de un administrador (evita errores al escribir
--      la fecha). Las reservas importadas de Sheets no se ven afectadas.
-- ============================================================================

begin;

-- ---------------------------------------------------------- A. SISTEMA OPERATIVO
alter table equipos add column if not exists sistema_operativo text
  check (sistema_operativo in ('Windows', 'Linux', 'macOS', 'Otro'));
alter table equipos add column if not exists so_version text
  check (so_version is null or char_length(so_version) <= 60);


-- ---------------------------------------------------------- B. TOPE ABSOLUTO
insert into politicas (clave, valor, descripcion) values
  ('reserva_max_absoluta_horas', '720', 'Duración máxima de cualquier reserva, incluso de un administrador (30 días).')
on conflict (clave) do nothing;

create or replace function trg_tope_absoluto() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_tope int := coalesce(politica_int('reserva_max_absoluta_horas'), 720); begin
  -- Sin sesión = importación o tarea interna: no aplica.
  if new.tipo <> 'reserva' or auth.uid() is null then return new; end if;
  if tg_op = 'UPDATE' and new.fin <= old.fin then return new; end if;
  if new.fin - new.inicio > make_interval(hours => v_tope) then
    raise exception 'Ninguna reserva puede superar % días (tope absoluto del laboratorio).', round(v_tope / 24.0)
      using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists reservas_tope_absoluto on reservas;
create trigger reservas_tope_absoluto before insert or update of fin on reservas
  for each row execute function trg_tope_absoluto();

revoke execute on function trg_tope_absoluto from public, anon, authenticated;

commit;
