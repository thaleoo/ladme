# Mudanza del sistema anterior (Apps Script + Sheets) a la PWA

Los dos sistemas no se sincronizan: durante la mudanza ninguno debe aceptar reservas. El plan deja
una ventana corta (unos 30 minutos, de noche) en la que el sistema anterior queda congelado y la PWA
pausada; se copian las reservas y se abre la PWA.

**Importar no reemplaza nada:** `migrar_sheets.py` solo agrega lo que no se ha importado antes. Las
reservas de prueba se quedarían y hasta podrían chocar con las reales («conflicto»). Por eso, justo
antes de importar, se borran con `db/reiniciar_datos_prueba.sql`.

## Antes (con calma, el mismo día)

1. **Código.** `git am` de los parches pendientes y `git push`. Espere a que GitHub Actions publique la
   PWA (pestaña Actions en verde).
2. **Base de datos.** Supabase → SQL Editor, en orden, las migraciones que falten (0013, 0014, 0015,
   0016). Cada una debe terminar sin error.
3. **Apps Script.** Pegue el `Código.gs` más reciente y guarde.
4. **Políticas** (Administración → Herramientas → Políticas): revise que los valores sean los reales
   (durante las pruebas pudieron cambiar). Revise también en Inventario que ningún equipo quedó en
   mantenimiento por una prueba.
5. **Aviso a los usuarios**, por ejemplo: «Hoy de 10:00 a 10:30 p. m. el sistema de reservas del LADME
   se actualiza. Sus reservas se conservan. Desde mañana se reserva en <URL de la PWA> con la cuenta
   UNAL».

## La mudanza (ventana de ~30 minutos)

1. **Pausar la PWA.** Políticas → «Pausar las reservas nuevas» = 1. Nadie (salvo el personal) puede
   crear reservas; la app lo explica en «Nueva reserva».
2. **Congelar el sistema anterior.** Apps Script → Configuración del proyecto → Propiedades del script
   → agregar `PWA_URL` = URL de la PWA (https://…). Abra el enlace del sistema anterior: debe mostrar
   «LADME se mudó». Desde aquí no entra ninguna reserva nueva en ninguno de los dos.
3. **Descargar la hoja**, ya sin cambios: Archivo → Descargar → Microsoft Excel (.xlsx). Guárdela como
   `ladme/sheets/LADME.xlsx` (esa carpeta no se sube a GitHub).
4. **Borrar los datos de prueba.** SQL Editor → pegue `ladme/db/reiniciar_datos_prueba.sql`, cambie
   `'NO'` por `'SI'` en la línea marcada y ejecútelo. Al final muestra lo que queda: equipos, cuentas,
   personal y Faro vinculados, y **0 reservas**. No toca la configuración ni las cuentas.
5. **Importar.** En su computador:
   `python ladme/scripts/migrar_sheets.py "ladme/sheets/LADME.xlsx" > ladme/sheets/migracion.sql`.
   Pegue `migracion.sql` en el SQL Editor y ejecútelo. Revise el resumen del final:
   - `historica`: pasadas o canceladas (quedan para estadísticas).
   - `vigente`: la persona ya tenía cuenta; la reserva quedó a su nombre.
   - `vigente_pendiente`: ocupa el equipo y pasa a su titular cuando entre por primera vez.
   - `conflicto` / `equipo_desconocido`: aparecen listadas; resuélvalas a mano (un bloqueo o un aviso).
   Si algo se corta, puede volver a ejecutarlo: no duplica.
6. **Comprobar.** Administración → Reservas y la agenda de dos o tres equipos, contra la hoja.
7. **Abrir la PWA.** Políticas → «Pausar las reservas nuevas» = 0.
8. **Limpiar.** Borre `migracion.sql` (tiene nombres y correos). La hoja original queda en Drive como
   archivo de consulta; conviene dejarla de solo lectura al menos un semestre.

## Después

- Avisar que ya está abierta: al entrar con la cuenta UNAL aparecen sus reservas.
- Publicar la versión de Faro que corresponda (tag `faro-v…`), ya con la PWA y la base actualizadas.
- Bot por webhook, si aún no está: PWA_COMPLETA §19.
- Reemplazar las etiquetas NFC/QR por la URL de la PWA (PWA_COMPLETA §8): mientras tanto las viejas
  muestran «LADME se mudó» con un botón.

## Si hay que devolverse

Borre la propiedad `PWA_URL`: el sistema anterior vuelve a recibir reservas. Deje la PWA pausada
(«Pausar las reservas nuevas» = 1). Lo que alguien haya reservado en la PWA en el intermedio hay que
pasarlo a mano a la hoja.
