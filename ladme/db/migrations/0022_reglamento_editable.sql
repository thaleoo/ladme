-- 0022 · Reglamento de uso editable, con versiones y lectura obligatoria
-- Ejecutar después de 0021. Idempotente.
--
--   A. El texto del reglamento deja de estar en el código: vive en reglamento_versiones y la administración
--      lo edita desde la PWA. Cada publicación crea una versión nueva.
--   B. Al publicar se puede pedir que todas las personas lo lean de nuevo (obligatoria). Quien no haya aceptado
--      la última versión obligatoria no puede reservar (el servidor lo exige, no solo la pantalla).
--   C. Constancia de cada aceptación (persona, versión, fecha).
--
-- Al ejecutar esta migración todas las personas verán el reglamento una vez más: la versión 2 es obligatoria.
-- Si no lo desea, cambie «true» por «false» en la fila de la versión 2 antes de ejecutarla.
begin;

alter table perfiles add column if not exists reglamento_version int;

create table if not exists reglamento_versiones (
  version      int primary key,
  reglas       jsonb not null check (jsonb_typeof(reglas) = 'array' and jsonb_array_length(reglas) between 1 and 40),
  obligatoria  boolean not null default true,
  nota         text check (char_length(nota) <= 300),
  publicado_en timestamptz not null default now(),
  publicado_por uuid references perfiles (id) on delete set null
);

create table if not exists reglamento_aceptaciones (
  perfil_id   uuid not null references perfiles (id) on delete cascade,
  version     int  not null references reglamento_versiones (version),
  aceptado_en timestamptz not null default now(),
  primary key (perfil_id, version)
);

alter table reglamento_versiones enable row level security;
alter table reglamento_aceptaciones enable row level security;
drop policy if exists reglamento_versiones_lectura on reglamento_versiones;
create policy reglamento_versiones_lectura on reglamento_versiones for select to authenticated using (true);
drop policy if exists reglamento_aceptaciones_lectura on reglamento_aceptaciones;
create policy reglamento_aceptaciones_lectura on reglamento_aceptaciones for select to authenticated using (perfil_id = auth.uid() or es_staff());
revoke all on reglamento_versiones, reglamento_aceptaciones from public, anon;
grant select on reglamento_versiones, reglamento_aceptaciones to authenticated;

-- Versión 1: el reglamento que venía en el código. Versión 2: el nuevo.
insert into reglamento_versiones (version, reglas, obligatoria, nota) values
  (1, $j$[{"titulo": "La reserva es personal", "texto": "Reserve solo para su propio trabajo académico y no preste su credencial. Usted responde por el equipo durante su reserva."}, {"titulo": "Registre su llegada y libere al terminar", "texto": "Marque su llegada al empezar. Si no va a usar el equipo, cancele; si termina antes, libérelo para que otra persona pueda usarlo."}, {"titulo": "Respete los procesos de otros", "texto": "No apague, reinicie ni cierre la sesión de un equipo con un proceso desatendido. Si necesita el equipo, escriba a quien lo tiene desde su ficha."}, {"titulo": "Cuide el equipo y el software", "texto": "No instale programas sin autorización, no desconecte periféricos ni mueva los equipos. No consuma alimentos ni bebidas junto a ellos."}, {"titulo": "Sus archivos son su responsabilidad", "texto": "Guarde su trabajo en su propio almacenamiento. El laboratorio puede limpiar los discos durante un mantenimiento."}, {"titulo": "Reporte las fallas", "texto": "Si algo no funciona, repórtelo desde la ficha del equipo. No intente repararlo por su cuenta."}, {"titulo": "Sus datos", "texto": "El laboratorio guarda su nombre, correo institucional, programa y el historial de sus reservas para operar el servicio y elaborar estadísticas de uso."}]$j$::jsonb, true, 'Reglamento original.'),
  (2, $j$[{"titulo": "Un papel no reserva nada", "texto": "Para apartar un equipo se usa **únicamente la plataforma LADME** (ladme.pages.dev). Una hoja pegada en un equipo no es una reserva. Si un equipo figura reservado en un papel pero no tiene reserva en LADME, avise a un laboratorista: retirará el papel y revisará los procesos en ejecución. Después haga su reserva en LADME y podrá usar el equipo."}, {"titulo": "La reserva es personal", "texto": "Reserve solo para su propio trabajo académico o de investigación. No preste su credencial, no reserve a nombre de otra persona ni aparte equipos «por si acaso». Usted responde por el equipo durante su reserva."}, {"titulo": "Registre su llegada a tiempo", "texto": "Registre su llegada en LADME dentro de los **{tolerancia} minutos** de tolerancia de su reserva. Si no lo hace, la reserva puede liberarse y contarse como inasistencia. Si algo se lo impide, repórtelo desde el sistema de inasistencias o hable con un laboratorista."}, {"titulo": "Libere o cancele lo que no use", "texto": "Si no va a usar el equipo, cancele la reserva. Si termina antes, libérelo desde LADME o desde Faro para que otra persona pueda usarlo. Si necesita más tiempo, extienda la reserva antes de que termine y mientras el equipo siga libre."}, {"titulo": "Faro no se toca", "texto": "Faro es el programa que gestiona los equipos del laboratorio. **No cierre, detenga ni desinstale sus procesos**, ni intente evitar sus avisos o el bloqueo de pantalla. Atienda sus anuncios y, cuando termine su reserva, guarde su trabajo. Incumplir esta norma puede acarrear sanciones."}, {"titulo": "Uso compartido y procesos de otras personas", "texto": "En un equipo en uso compartido, **nunca apague ni reinicie el equipo, no cierre la sesión y no cierre los programas o procesos que protegió quien hizo la reserva original**. Use solo lo que quede libre. Si necesita el equipo y hay un proceso desatendido, no lo interrumpa: escriba al titular desde la ficha del equipo o avise a un laboratorista."}, {"titulo": "Cuide los equipos", "texto": "No mueva los equipos ni desconecte cables o periféricos, y no consuma alimentos ni bebidas cerca de ellos. Deje el puesto ordenado y avise de inmediato si algo se daña o falta."}, {"titulo": "Software", "texto": "No instale programas por su cuenta. Si necesita uno, solicítelo desde LADME con al menos **{software_dias} días hábiles** de anticipación. Use solo software con licencia o de uso libre."}, {"titulo": "Sus archivos y sus cuentas", "texto": "Guarde su trabajo en su propio almacenamiento o en la nube: el laboratorio puede limpiar los discos durante un mantenimiento o al terminar su sesión. Al irse, cierre la sesión de su correo, de la nube y de cualquier cuenta personal, y no guarde contraseñas en el navegador."}, {"titulo": "Reporte las fallas", "texto": "Si algo no funciona, repórtelo desde la ficha del equipo en LADME o desde Faro. No intente repararlo por su cuenta."}, {"titulo": "Convivencia en la sala", "texto": "La sala es un espacio de trabajo compartido: mantenga el volumen bajo, use audífonos para audio y videollamadas, y trate con respeto a las demás personas usuarias y al personal."}, {"titulo": "Sus datos", "texto": "El laboratorio guarda su nombre, correo institucional, programa y el historial de sus reservas para operar el servicio y elaborar estadísticas de uso."}, {"titulo": "Si no se cumplen las reglas", "texto": "Incumplir estas reglas puede llevar a perder reservas, a suspender su acceso a LADME o a otras medidas que determine la coordinación del laboratorio. Las reglas pueden actualizarse: cuando cambien de fondo se le pedirá que las lea de nuevo."}]$j$::jsonb, true, 'Se añaden: un papel no reserva, no cerrar los procesos de Faro, uso compartido, software, cuentas y convivencia.')
on conflict (version) do nothing;

-- Quien ya había aceptado el reglamento original queda en la versión 1.
update perfiles set reglamento_version = 1 where reglamento_aceptado_en is not null and reglamento_version is null;
insert into reglamento_aceptaciones (perfil_id, version, aceptado_en)
select id, 1, reglamento_aceptado_en from perfiles where reglamento_version = 1
on conflict do nothing;

-- ===================================================================== Lectura
create or replace function reglamento_minima() returns int
language sql stable security definer set search_path = public as $$
  select coalesce(max(version), 0) from reglamento_versiones where obligatoria $$;

create or replace function reglamento_vigente() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'version', v.version, 'reglas', v.reglas, 'publicado_en', v.publicado_en, 'nota', v.nota,
    'aceptada_version', p.reglamento_version,
    'aceptada_en', (select a.aceptado_en from reglamento_aceptaciones a where a.perfil_id = p.id and a.version = p.reglamento_version),
    'debe_aceptar', coalesce(p.reglamento_version, 0) < reglamento_minima())
  from reglamento_versiones v, perfiles p
  where p.id = auth.uid()
  order by v.version desc limit 1 $$;

-- ===================================================================== Aceptar
create or replace function aceptar_reglamento() returns void
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if auth.uid() is null then return; end if;
  select max(version) into v from reglamento_versiones;
  update perfiles set reglamento_aceptado_en = coalesce(reglamento_aceptado_en, now()),
                      reglamento_version = greatest(coalesce(reglamento_version, 0), coalesce(v, 0))
   where id = auth.uid();
  if v is not null then
    insert into reglamento_aceptaciones (perfil_id, version) values (auth.uid(), v) on conflict do nothing;
  end if;
end $$;

-- Quien reserva para sí mismo debe haber aceptado la última versión obligatoria.
create or replace function trg_exigir_reglamento() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tipo = 'reserva' and auth.uid() = new.usuario_id
     and coalesce((select reglamento_version from perfiles where id = new.usuario_id), 0) < reglamento_minima() then
    raise exception 'Antes de reservar debe aceptar el reglamento de uso del laboratorio.';
  end if;
  return new;
end $$;

-- ===================================================================== Publicar (solo administración)
create or replace function publicar_reglamento(p_reglas jsonb, p_obligatoria boolean default true, p_nota text default null) returns int
language plpgsql security definer set search_path = public as $$
declare v uuid := auth.uid(); r jsonb; limpias jsonb := '[]'::jsonb; t text; x text; n int;
begin
  if not es_admin() then raise exception 'Solo la administración puede cambiar el reglamento.' using errcode = '42501'; end if;
  if p_reglas is null or jsonb_typeof(p_reglas) <> 'array' or jsonb_array_length(p_reglas) not between 1 and 40 then
    raise exception 'El reglamento debe tener entre 1 y 40 reglas.';
  end if;
  for r in select * from jsonb_array_elements(p_reglas) loop
    t := btrim(coalesce(r ->> 'titulo', ''));
    x := btrim(coalesce(r ->> 'texto', ''));
    if t = '' or x = '' then raise exception 'Cada regla necesita título y texto.'; end if;
    if char_length(t) > 120 then raise exception 'El título «%» supera los 120 caracteres.', left(t, 30); end if;
    if char_length(x) > 1200 then raise exception 'El texto de «%» supera los 1200 caracteres.', left(t, 30); end if;
    limpias := limpias || jsonb_build_array(jsonb_build_object('titulo', t, 'texto', x));
  end loop;
  p_nota := nullif(btrim(coalesce(p_nota, '')), '');
  if char_length(coalesce(p_nota, '')) > 300 then raise exception 'La nota supera los 300 caracteres.'; end if;
  lock table reglamento_versiones in share row exclusive mode;
  select coalesce(max(version), 0) + 1 into n from reglamento_versiones;
  insert into reglamento_versiones (version, reglas, obligatoria, nota, publicado_por)
  values (n, limpias, coalesce(p_obligatoria, true), p_nota, v);
  insert into consola_registro (actor, comando, ok, resultado)
  values (v, 'Publicar reglamento v' || n, true, case when coalesce(p_obligatoria, true) then 'Todas las personas deberán aceptarlo de nuevo.' else 'Cambio menor: no se pide aceptarlo de nuevo.' end);
  return n;
end $$;

revoke execute on function reglamento_minima(), reglamento_vigente(), aceptar_reglamento(), publicar_reglamento(jsonb, boolean, text) from public, anon;
grant execute on function reglamento_minima(), reglamento_vigente(), aceptar_reglamento(), publicar_reglamento(jsonb, boolean, text) to authenticated;

commit;
