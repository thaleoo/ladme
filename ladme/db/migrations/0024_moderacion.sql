-- 0024 · Límites y moderación de lo que escriben las personas
-- Ejecutar después de 0023. Idempotente.
--
--   A. Limpieza en el servidor de todo texto escrito por usuarios: sin caracteres invisibles ni de control de
--      dirección, sin acentos apilados («zalgo»), espacios colapsados y, en los textos de una línea, sin saltos.
--   B. Filtro de palabras con lista que edita la administración (Administración → Moderación).
--      La comparación no distingue mayúsculas ni tildes y reconoce variantes: p.u.t.a, p u t a, pu7a, mierdaaa,
--      plurales. Compara palabras completas («computadora» no coincide con nada).
--   C. Texto que otras personas ven (mensaje en la pantalla de Faro, programas protegidos, nombre, mensajes al
--      titular, docente, clases): si trae una palabra de la lista, NO se guarda. Texto privado que solo ve el
--      personal (reportes, apelaciones, justificaciones, solicitudes): se guarda y queda marcado para revisión.
--      El personal y los procesos del sistema no se rechazan (solo se limpia).
--   D. Límites de frecuencia que faltaban: solicitudes de software y de la sala para clases.
begin;

-- ===================================================================== A. Limpieza
-- Marcas combinantes (acentos sueltos). Más de dos seguidas sobre una letra es «zalgo»: se recorta.
create or replace function _limpiar_texto(t text, una_linea boolean default true) returns text
language sql immutable set search_path = public as $$
  select nullif(btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(normalize(t, NFC), '[​-‏‪-‮⁠-⁩﻿]', '', 'g'),
            '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g'),
          '([̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]{2})[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]+',
          '\1', 'g'),
        case when una_linea then '\s+' else '[ \t\r]+' end, ' ', 'g'),
      '\n( ?\n){2,}', E'\n\n', 'g')
  ), '') $$;

-- ===================================================================== B. Lista y comparación
create table if not exists palabras_bloqueadas (
  palabra    text primary key check (palabra ~ '^[a-z]+( [a-z]+)*$' and char_length(palabra) between 2 and 60),
  creada_en  timestamptz not null default now(),
  creada_por uuid references perfiles (id) on delete set null
);
alter table palabras_bloqueadas enable row level security;
drop policy if exists palabras_personal on palabras_bloqueadas;
create policy palabras_personal on palabras_bloqueadas for select to authenticated using (es_staff());
revoke all on palabras_bloqueadas from public, anon;
grant select on palabras_bloqueadas to authenticated;

-- Forma comparable: minúsculas, sin tildes, «leet» (4→a, 3→e, 1→i, 0→o, 5/$→s, 7→t, @→a, !→i), signos como
-- espacios y letras sueltas seguidas unidas (p u t a → puta).
create or replace function _norm_mod(t text) returns text
language sql immutable set search_path = public as $$
  select regexp_replace(
           btrim(regexp_replace(
             translate(regexp_replace(normalize(lower(coalesce(t, '')), NFKD), '[̀-ͯ]', '', 'g'), '4@31!0$57', 'aaeiiosst'),
             '[^a-z]+', ' ', 'g')),
           '(?<=\m[a-z]) (?=[a-z]\M)', '', 'g') $$;

-- La palabra de la lista que aparece en el texto, o null.
create or replace function _palabra_bloqueada(t text) returns text
language plpgsql stable security definer set search_path = public as $$
declare s text := _norm_mod(t); r text;
begin
  if s = '' then return null; end if;
  -- Palabra por palabra, con sus variantes: estirada (mierdaaa), con letras repetidas y en plural.
  select b.palabra into r
    from regexp_split_to_table(s, ' ') tok
    cross join lateral (values (tok), (regexp_replace(tok, '(.)\1{2,}', '\1', 'g')), (regexp_replace(tok, '(.)\1{2,}', '\1\1', 'g'))) v(x)
    cross join lateral (values (v.x), (regexp_replace(v.x, '(es|s)$', ''))) w(y)
    join palabras_bloqueadas b on b.palabra = w.y
   where tok <> '' and char_length(w.y) >= 2
   limit 1;
  if r is not null then return r; end if;
  -- Frases de la lista (con espacio), como palabras completas.
  select b.palabra into r from palabras_bloqueadas b
   where b.palabra like '% %' and position(' ' || b.palabra || ' ' in ' ' || s || ' ') > 0
   limit 1;
  return r;
end $$;

-- Lista inicial: insultos frecuentes. La administración la amplía o corrige. Se dejaron fuera palabras que también
-- son normales en el laboratorio («cono», «retrasado», «polla»): se comparan palabras completas, sin contexto.
insert into palabras_bloqueadas (palabra) values
  ('puta'), ('puto'), ('hijueputa'), ('hijuputa'), ('hijoeputa'), ('malparido'), ('malparida'), ('gonorrea'),
  ('marica'), ('maricon'), ('verga'), ('mierda'), ('culo'), ('culero'), ('pendejo'), ('pendeja'), ('idiota'),
  ('imbecil'), ('estupido'), ('estupida'), ('perra'), ('zorra'), ('cabron'), ('carechimba'), ('careverga'),
  ('huevon'), ('guevon'), ('gueva'), ('mamaguevo'), ('mamahuevo'), ('pirobo'), ('piroba'), ('malnacido'),
  ('malnacida'), ('tarado'), ('mongolico'), ('subnormal'),
  ('fuck'), ('shit'), ('bitch')
on conflict do nothing;

-- Marcas para revisión (texto privado con una palabra de la lista).
create table if not exists moderacion_marcas (
  id          bigint generated always as identity primary key,
  tabla       text not null,
  fila        text not null,
  campo       text not null,
  palabra     text not null,
  usuario_id  uuid references perfiles (id) on delete set null,
  revisada    boolean not null default false,
  creado_en   timestamptz not null default now()
);
create index if not exists moderacion_marcas_pendientes on moderacion_marcas (creado_en desc) where not revisada;
alter table moderacion_marcas enable row level security;
drop policy if exists marcas_personal on moderacion_marcas;
create policy marcas_personal on moderacion_marcas for select to authenticated using (es_staff());
revoke all on moderacion_marcas from public, anon;
grant select on moderacion_marcas to authenticated;

-- ===================================================================== C. Aplicar
-- ¿Se rechaza a quien escribe? Solo a personas usuarias: el personal y los procesos del sistema (importaciones,
-- tareas programadas, Faro) no, para no bloquear la operación.
create or replace function _moderar_rechaza() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and not es_staff() $$;

-- Texto público: si trae una palabra de la lista, no se guarda.
create or replace function _exigir_publicable(t text, que text) returns void
language plpgsql stable security definer set search_path = public as $$
declare p text;
begin
  if t is null or not _moderar_rechaza() then return; end if;
  p := _palabra_bloqueada(t);
  if p is not null then
    raise exception 'Ese texto no se puede publicar: % incluye una palabra no permitida («%»). Cámbiela e intente de nuevo.', que, p
      using errcode = '22023';
  end if;
end $$;

-- Texto privado: se guarda y, si trae una palabra de la lista, queda marcado para el personal.
create or replace function _marcar_si_hace_falta(t text, p_tabla text, p_fila text, p_campo text) returns void
language plpgsql security definer set search_path = public as $$
declare p text;
begin
  if t is null or auth.uid() is null then return; end if;
  p := _palabra_bloqueada(t);
  if p is not null then
    insert into moderacion_marcas (tabla, fila, campo, palabra, usuario_id) values (p_tabla, p_fila, p_campo, p, auth.uid());
  end if;
end $$;

-- ¿Cambió este campo? (en un INSERT, siempre)
create or replace function _cambio(op text, a text, b text) returns boolean
language sql immutable as $$ select op = 'INSERT' or a is distinct from b $$;

-- Reservas: el mensaje y los programas protegidos salen en la pantalla de Faro; el docente, en documentos.
create or replace function trg_mod_reservas() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.mensaje_llegada := left(_limpiar_texto(new.mensaje_llegada), 140);
  new.docente := left(_limpiar_texto(new.docente), 120);
  new.detalle := left(_limpiar_texto(new.detalle, false), 800);
  if new.protegidos is not null then
    new.protegidos := (select array_agg(distinct left(_limpiar_texto(x), 40)) from unnest(new.protegidos) x where _limpiar_texto(x) is not null);
  end if;
  if _cambio(tg_op, new.mensaje_llegada, case when tg_op = 'UPDATE' then old.mensaje_llegada end) then
    perform _exigir_publicable(new.mensaje_llegada, 'el mensaje para quien llegue');
  end if;
  if _cambio(tg_op, new.docente, case when tg_op = 'UPDATE' then old.docente end) then
    perform _exigir_publicable(new.docente, 'el nombre del docente');
  end if;
  if _cambio(tg_op, array_to_string(new.protegidos, ' '), case when tg_op = 'UPDATE' then array_to_string(old.protegidos, ' ') end) then
    perform _exigir_publicable(array_to_string(new.protegidos, ' '), 'la lista de programas protegidos');
  end if;
  if _cambio(tg_op, new.detalle, case when tg_op = 'UPDATE' then old.detalle end) then
    perform _marcar_si_hace_falta(new.detalle, 'reservas', new.id::text, 'detalle');
  end if;
  return new;
end $$;
drop trigger if exists aa_moderacion on reservas;
create trigger aa_moderacion before insert or update of mensaje_llegada, docente, detalle, protegidos on reservas
  for each row execute function trg_mod_reservas();

-- Nombre de la persona: sale en la credencial, en Faro («Reservado · …») y al personal. El que viene de Google
-- al crear la cuenta solo se limpia; el que la persona escribe después, se revisa.
create or replace function trg_mod_perfiles() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.nombre := coalesce(left(_limpiar_texto(new.nombre), 120), new.nombre);
  if tg_op = 'UPDATE' and new.nombre is distinct from old.nombre then
    perform _exigir_publicable(new.nombre, 'el nombre');
  end if;
  return new;
end $$;
drop trigger if exists aa_moderacion on perfiles;
create trigger aa_moderacion before insert or update of nombre on perfiles
  for each row execute function trg_mod_perfiles();

-- Mensaje al titular de un equipo: va de una persona a otra.
create or replace function trg_mod_contactos() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.mensaje := left(_limpiar_texto(new.mensaje, false), 300);
  perform _exigir_publicable(new.mensaje, 'el mensaje');
  return new;
end $$;
drop trigger if exists aa_moderacion on contactos;
create trigger aa_moderacion before insert on contactos for each row execute function trg_mod_contactos();

-- Clases: nombre, docente y notas salen en la agenda de la sala y en la autorización en PDF.
-- Además, como máximo 5 solicitudes pendientes por docente.
create or replace function trg_mod_clases() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.nombre := left(_limpiar_texto(new.nombre), 120);
  new.docente := left(_limpiar_texto(new.docente), 120);
  new.notas := left(_limpiar_texto(new.notas, false), 500);
  if _cambio(tg_op, new.nombre, case when tg_op = 'UPDATE' then old.nombre end) then perform _exigir_publicable(new.nombre, 'el nombre de la clase'); end if;
  if _cambio(tg_op, new.docente, case when tg_op = 'UPDATE' then old.docente end) then perform _exigir_publicable(new.docente, 'el nombre del docente'); end if;
  if _cambio(tg_op, new.notas, case when tg_op = 'UPDATE' then old.notas end) then perform _exigir_publicable(new.notas, 'las notas'); end if;
  if tg_op = 'INSERT' and _moderar_rechaza()
     and (select count(*) from clases where solicitante = new.solicitante and estado = 'pendiente') >= 5 then
    raise exception 'Ya tiene 5 solicitudes de clase pendientes. Espere la respuesta del laboratorio o cancele alguna.';
  end if;
  return new;
end $$;
drop trigger if exists aa_moderacion on clases;
create trigger aa_moderacion before insert or update of nombre, docente, notas on clases
  for each row execute function trg_mod_clases();

-- Textos privados (los ve el personal): se limpian y se marcan si hace falta.
create or replace function trg_mod_privado() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  case tg_table_name
    when 'reportes' then
      new.descripcion := left(_limpiar_texto(new.descripcion, false), 800);
      if tg_op = 'INSERT' then perform _marcar_si_hace_falta(new.descripcion, 'reportes', new.id::text, 'descripcion'); end if;
    when 'solicitudes_excepcion' then
      new.justificacion := left(_limpiar_texto(new.justificacion, false), 800);
      new.detalle := left(_limpiar_texto(new.detalle, false), 800);
      if tg_op = 'INSERT' then perform _marcar_si_hace_falta(concat_ws(' ', new.justificacion, new.detalle), 'solicitudes_excepcion', new.id::text, 'justificacion'); end if;
    when 'solicitudes_software' then
      new.software := left(_limpiar_texto(new.software), 200);
      new.version := left(_limpiar_texto(new.version), 60);
      new.uso := left(_limpiar_texto(new.uso, false), 600);
      new.enlace := left(_limpiar_texto(new.enlace), 300);
      if tg_op = 'INSERT' then
        perform _marcar_si_hace_falta(concat_ws(' ', new.software, new.uso), 'solicitudes_software', new.id::text, 'uso');
        if _moderar_rechaza() then
          if (select count(*) from solicitudes_software where solicitante = new.solicitante and estado in ('pendiente', 'en_tramite')) >= 5 then
            raise exception 'Ya tiene 5 solicitudes de software en curso. Espere la respuesta del laboratorio o cancele alguna.';
          end if;
          if (select count(*) from solicitudes_software where solicitante = new.solicitante and creado_en > now() - interval '24 hours') >= 5 then
            raise exception 'Ha enviado varias solicitudes de software hoy. Intente de nuevo mañana o escriba al laboratorio.';
          end if;
        end if;
      end if;
    when 'verificaciones_docente' then
      new.mensaje := left(_limpiar_texto(new.mensaje, false), 300);
      if tg_op = 'INSERT' then perform _marcar_si_hace_falta(new.mensaje, 'verificaciones_docente', new.id::text, 'mensaje'); end if;
    when 'inasistencias' then
      new.apelacion := left(_limpiar_texto(new.apelacion, false), 500);
      if tg_op = 'UPDATE' and new.apelacion is distinct from old.apelacion then
        perform _marcar_si_hace_falta(new.apelacion, 'inasistencias', new.id::text, 'apelacion');
      end if;
    else null;
  end case;
  return new;
end $$;
drop trigger if exists aa_moderacion on reportes;
create trigger aa_moderacion before insert or update of descripcion on reportes for each row execute function trg_mod_privado();
drop trigger if exists aa_moderacion on solicitudes_excepcion;
create trigger aa_moderacion before insert or update of justificacion, detalle on solicitudes_excepcion for each row execute function trg_mod_privado();
drop trigger if exists aa_moderacion on solicitudes_software;
create trigger aa_moderacion before insert or update of software, version, uso, enlace on solicitudes_software for each row execute function trg_mod_privado();
drop trigger if exists aa_moderacion on verificaciones_docente;
create trigger aa_moderacion before insert or update of mensaje on verificaciones_docente for each row execute function trg_mod_privado();
drop trigger if exists aa_moderacion on inasistencias;
create trigger aa_moderacion before update of apelacion on inasistencias for each row execute function trg_mod_privado();

-- ===================================================================== Administración
-- Agregar o quitar una palabra (solo administración). Se guarda en su forma comparable.
create or replace function moderacion_palabra(p_palabra text, p_agregar boolean default true) returns text
language plpgsql security definer set search_path = public as $$
declare n text := _norm_mod(p_palabra);
begin
  if not es_admin() then raise exception 'Solo la administración puede cambiar la lista de palabras.' using errcode = '42501'; end if;
  if n !~ '^[a-z]+( [a-z]+)*$' or char_length(n) not between 2 and 60 then
    raise exception 'Escriba una palabra o frase corta (letras, de 2 a 60).';
  end if;
  if p_agregar then
    insert into palabras_bloqueadas (palabra, creada_por) values (n, auth.uid()) on conflict do nothing;
  else
    delete from palabras_bloqueadas where palabra = n;
  end if;
  insert into consola_registro (actor, comando, ok, resultado)
  values (auth.uid(), case when p_agregar then 'Moderación: agregar palabra' else 'Moderación: quitar palabra' end, true, null);
  return n;
end $$;

-- Probar un texto: devuelve la palabra que lo bloquearía (o null). Para el personal.
create or replace function moderacion_probar(p_texto text) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if not es_staff() then raise exception 'Solo el personal.' using errcode = '42501'; end if;
  return _palabra_bloqueada(left(p_texto, 2000));
end $$;

create or replace function moderacion_revisar(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_staff() then raise exception 'Solo el personal.' using errcode = '42501'; end if;
  update moderacion_marcas set revisada = true where id = p_id;
end $$;

revoke execute on function _limpiar_texto(text, boolean), _norm_mod(text), _palabra_bloqueada(text), _moderar_rechaza(),
  _exigir_publicable(text, text), _marcar_si_hace_falta(text, text, text, text) from public, anon, authenticated;
revoke execute on function moderacion_palabra(text, boolean), moderacion_probar(text), moderacion_revisar(bigint) from public, anon;
grant execute on function moderacion_palabra(text, boolean), moderacion_probar(text), moderacion_revisar(bigint) to authenticated;

commit;
