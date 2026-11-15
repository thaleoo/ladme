#!/usr/bin/env python3
"""Genera el SQL que pasa las reservas de Google Sheets a Supabase.

Uso (desde la raíz del repo):
    python ladme/scripts/migrar_sheets.py "ladme/sheets/LADME.xlsx" > ladme/sheets/migracion.sql

Luego abra migracion.sql, péguelo en el SQL Editor de Supabase y ejecútelo.

Qué hace el SQL generado (ver importar_reserva_hoja en la migración 0002):
  - Toda reserva queda respaldada en `reservas_importadas` (historial y estadísticas).
  - Las vigentes o futuras ocupan además su equipo en `reservas`: a nombre del
    titular si ya ingresó a la PWA; si no, como bloqueo provisional que pasa a
    ser SU reserva la primera vez que ingrese.
  - Los bloqueos de gestión vigentes se recrean.
  - Es idempotente: ejecutarlo dos veces no duplica nada.

Privacidad:
  - La cédula NO se migra (decisión D-04).
  - El archivo generado contiene nombres y correos: NO lo suba al repositorio
    (ladme/sheets/*.sql está en .gitignore) y bórrelo al terminar.
  - Por pantalla (stderr) solo se imprimen conteos.

Solo usa la biblioteca estándar. Las horas de la hoja se interpretan en hora de
Colombia (UTC-5, sin horario de verano).
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from auditoria_xlsx import Xlsx, excel_dt  # noqa: E402

CODIGO = re.compile(r"\[([A-Za-z0-9-]{3,20})\]|\b(UNAL-\d{1,3})\b")
FORMATOS = ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M")


def q(valor: object) -> str:
    """Literal SQL seguro (comillas duplicadas; sin barras invertidas especiales)."""
    if valor is None or valor == "":
        return "null"
    return "'" + str(valor).replace("\x00", "").replace("'", "''") + "'"


def ts(momento: dt.datetime | None) -> str:
    return "null" if momento is None else f"'{momento:%Y-%m-%d %H:%M:%S}-05'::timestamptz"


def fecha_hora(fecha: str | None, hora: str | None) -> dt.datetime | None:
    """Acepta seriales de Excel o texto (dd/mm/aaaa, aaaa-mm-dd; hh:mm)."""
    serial = excel_dt(fecha, hora)
    if serial:
        return serial
    texto = f"{(fecha or '').strip()} {(hora or '').strip()}".strip()
    for formato in FORMATOS:
        try:
            return dt.datetime.strptime(texto, formato)
        except ValueError:
            continue
    return None


def momento(texto: str | None) -> dt.datetime | None:
    """Una sola celda con fecha y hora: serial de Excel o texto."""
    texto = (texto or "").strip()
    try:
        return dt.datetime(1899, 12, 30) + dt.timedelta(days=float(texto))
    except ValueError:
        pass
    for formato in FORMATOS:
        try:
            return dt.datetime.strptime(texto, formato)
        except ValueError:
            continue
    return None


def codigos(celda: str | None) -> list[str]:
    vistos: list[str] = []
    for a, b in CODIGO.findall(celda or ""):
        c = (a or b).upper()
        if c not in vistos:
            vistos.append(c)
    return vistos


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    libro = Xlsx(sys.argv[1])
    if "Reservas_LADME" not in libro.sheets:
        print("No existe la pestaña Reservas_LADME.", file=sys.stderr)
        return 1

    salida = [
        "-- Generado por scripts/migrar_sheets.py el " + dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "-- CONTIENE DATOS PERSONALES: no lo suba al repositorio; bórrelo al terminar.",
        "begin;",
        "create temp table _resultado (origen text, resultado text) on commit drop;",
    ]
    total = omitidas = 0
    for n, fila in enumerate(libro.rows("Reservas_LADME")[1:], start=2):
        inicio = fecha_hora(fila.get(8), fila.get(9))
        fin = fecha_hora(fila.get(10), fila.get(11))
        equipos = codigos(fila.get(12))
        correo = (fila.get(5) or "").strip().lower()
        if not inicio or not fin or fin <= inicio or not equipos or "@" not in correo:
            omitidas += 1
            continue
        origen = (fila.get(15) or "").strip() or f"FILA-{n}"
        cancelada = (fila.get(19) or "").strip().lower().startswith("cancel")
        actividad = (fila.get(13) or "").strip() or None
        try:
            extensiones = int(float(fila.get(22) or 0))
        except ValueError:
            extensiones = 0
        datos = {
            "programa": (fila.get(6) or "").strip(),
            "matricula": (fila.get(7) or "").strip(),
            "tipo_usuario": (fila.get(2) or "").strip(),
            "motivo_cancelacion": (fila.get(21) or "").strip(),
            "fila": n,
        }
        for equipo in equipos:
            total += 1
            # Una reserva con varios equipos se separa: una por equipo.
            clave = origen if len(equipos) == 1 else f"{origen}/{equipo}"
            salida.append(
                "insert into _resultado select " + q(clave) + ", importar_reserva_hoja("
                + ", ".join([
                    q(clave), q(equipo), q(correo), q((fila.get(3) or "").strip()[:120]),
                    ts(inicio), ts(fin), "true" if cancelada else "false",
                    q(actividad), q((fila.get(14) or "").strip()[:800]),
                    "true" if (fila.get(17) or "").strip() else "false",
                    q((fila.get(18) or "").strip()[:140]), str(extensiones),
                    q(json.dumps(datos, ensure_ascii=False)) + "::jsonb",
                ]) + ");"
            )

    bloqueos = 0
    if "Bloqueos_LADME" in libro.sheets:
        # Columnas: A ID, B Equipo, C Desde, D Hasta, E Motivo, F Creado por, G Creado en, H Estado.
        for fila in libro.rows("Bloqueos_LADME")[1:]:
            desde, hasta = momento(fila.get(3)), momento(fila.get(4))
            equipos = codigos(fila.get(2))
            if not desde or not hasta or not equipos or (fila.get(8) or "").strip().lower() != "activo":
                continue
            bloqueos += 1
            salida.append(
                "insert into _resultado select " + q("BLOQUEO " + equipos[0]) + ", importar_bloqueo_hoja("
                + ", ".join([q(equipos[0]), ts(desde), ts(hasta), q((fila.get(5) or "").strip()[:200])]) + ");"
            )

    salida += [
        "-- Resumen: revise que no haya 'conflicto' ni 'equipo_desconocido'.",
        "select resultado, count(*) from _resultado group by resultado order by resultado;",
        "select origen, resultado from _resultado where resultado in ('conflicto', 'equipo_desconocido') order by origen;",
        "commit;",
    ]
    print("\n".join(salida))
    print(f"Reservas a importar: {total} · filas omitidas por datos incompletos: {omitidas} · bloqueos activos: {bloqueos}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
