-- ============================================================================
-- Catálogo inicial de equipos LADME (16 estaciones)
--
-- Aplicar DESPUÉS de schema_ladme.sql, en el SQL Editor de Supabase.
-- Es idempotente: se puede volver a ejecutar sin duplicar filas.
--
-- Fuente: hoja Computadores_LADME (corte 2026-11-06). Los códigos UNAL-XX son
-- los mismos de las etiquetas NFC/QR y NO deben cambiarse.
--
-- Notas:
--  * UNAL-13 y UNAL-14 figuran como "Z1" en la hoja; UNAL-03..06 como "Z1 G6".
--    Se conserva el valor de origen. Corregir aquí si el laboratorio confirma
--    que son la misma familia.
--  * UNAL-10 no tiene reservas en el histórico. Se deja "activo"; confirmar
--    físicamente antes de anunciar disponibilidad.
--  * El estado no se sobrescribe al reejecutar: si el laboratorio lo cambió a
--    mantenimiento o fuera_de_servicio, se respeta.
-- ============================================================================

insert into equipos (codigo, nombre, marca, modelo, ubicacion, estado, especificaciones)
values
  ('UNAL-01', 'Precision 7920', 'Dell', 'Precision 7920', 'Sala LADME', 'activo', '{"familia": "Dell Precision 7920"}'::jsonb),
  ('UNAL-02', 'Precision 7920', 'Dell', 'Precision 7920', 'Sala LADME', 'activo', '{"familia": "Dell Precision 7920"}'::jsonb),
  ('UNAL-03', 'Z1 G6',         'HP',   'Z1 G6',         'Sala LADME', 'activo', '{"familia": "HP Z1 G6"}'::jsonb),
  ('UNAL-04', 'Z1 G6',         'HP',   'Z1 G6',         'Sala LADME', 'activo', '{"familia": "HP Z1 G6"}'::jsonb),
  ('UNAL-05', 'Z1 G6',         'HP',   'Z1 G6',         'Sala LADME', 'activo', '{"familia": "HP Z1 G6"}'::jsonb),
  ('UNAL-06', 'Z1 G6',         'HP',   'Z1 G6',         'Sala LADME', 'activo', '{"familia": "HP Z1 G6"}'::jsonb),
  ('UNAL-07', 'Precision 3660', 'Dell', 'Precision 3660', 'Sala LADME', 'activo', '{"familia": "Dell Precision 3660"}'::jsonb),
  ('UNAL-08', 'Precision 3660', 'Dell', 'Precision 3660', 'Sala LADME', 'activo', '{"familia": "Dell Precision 3660"}'::jsonb),
  ('UNAL-09', 'Precision 3660', 'Dell', 'Precision 3660', 'Sala LADME', 'activo', '{"familia": "Dell Precision 3660"}'::jsonb),
  ('UNAL-10', 'Precision 3660', 'Dell', 'Precision 3660', 'Sala LADME', 'activo', '{"familia": "Dell Precision 3660", "nota": "sin reservas en el histórico; verificar estado físico"}'::jsonb),
  ('UNAL-11', 'Precision 3660', 'Dell', 'Precision 3660', 'Sala LADME', 'activo', '{"familia": "Dell Precision 3660"}'::jsonb),
  ('UNAL-12', 'Precision 3660', 'Dell', 'Precision 3660', 'Sala LADME', 'activo', '{"familia": "Dell Precision 3660"}'::jsonb),
  ('UNAL-13', 'Z1',             'HP',   'Z1',             'Sala LADME', 'activo', '{"familia": "HP Z1"}'::jsonb),
  ('UNAL-14', 'Z1',             'HP',   'Z1',             'Sala LADME', 'activo', '{"familia": "HP Z1"}'::jsonb),
  ('UNAL-15', 'Precision 3660', 'Dell', 'Precision 3660', 'Sala LADME', 'activo', '{"familia": "Dell Precision 3660"}'::jsonb),
  ('UNAL-16', 'Precision 3660', 'Dell', 'Precision 3660', 'Sala LADME', 'activo', '{"familia": "Dell Precision 3660"}'::jsonb)
on conflict (codigo) do update
  set nombre          = excluded.nombre,
      marca           = excluded.marca,
      modelo          = excluded.modelo,
      ubicacion       = excluded.ubicacion,
      especificaciones = excluded.especificaciones;

-- Verificación rápida: deben salir 16 filas.
select codigo, nombre, marca, estado
  from equipos
 order by codigo;
