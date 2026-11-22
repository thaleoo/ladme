-- 0016 · Pausar las reservas (para la mudanza o un mantenimiento general)
-- Ejecutar después de 0015. Idempotente.
--
-- Con la política reservas_pausadas = 1 nadie, salvo el personal, puede crear reservas nuevas; las
-- que ya existen siguen igual. La app muestra el aviso en «Nueva reserva». Se vuelve a abrir con 0.
begin;

insert into politicas (clave, valor, descripcion) values
  ('reservas_pausadas', '0', 'Pausa las reservas nuevas (salvo el personal), por ejemplo durante la mudanza: 1 = pausadas, 0 = abiertas.')
on conflict (clave) do nothing;

create or replace function trg_reservas_pausa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tipo = 'reserva' and coalesce(politica_int('reservas_pausadas'), 0) = 1 and not es_staff() then
    raise exception 'Las reservas están pausadas unos minutos mientras el laboratorio actualiza el sistema. Intente de nuevo en un rato.';
  end if;
  return new;
end $$;
drop trigger if exists reservas_pausa on reservas;
create trigger reservas_pausa before insert on reservas for each row execute function trg_reservas_pausa();
revoke execute on function trg_reservas_pausa() from public, anon, authenticated;

commit;
