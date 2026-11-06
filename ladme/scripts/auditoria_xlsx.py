#!/usr/bin/env python3
"""Auditoría agregada de las hojas LADME exportadas a XLSX.

Uso:
    python scripts/auditoria_xlsx.py "sheets/Alojamiento de código.xlsx"

Lee el XLSX sin dependencias externas (solo biblioteca estándar) y muestra:
  - pestañas y número de filas;
  - conteos y duraciones de Reservas_LADME;
  - reservas activas/futuras al momento de correr;
  - catálogo de equipos;
  - distribución por programa, actividad y tipo de usuario.

Privacidad: NO imprime nombres, cédulas, correos ni mensajes. Solo agregados,
equipos, fechas, duraciones e IDs de reserva.
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import statistics
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
MAIN = "{%s}" % NS["m"]


def _colnum(ref: str) -> int:
    n = 0
    for ch in "".join(c for c in ref if c.isalpha()):
        n = n * 26 + (ord(ch.upper()) - 64)
    return n


def _serial(value: str | None) -> float | None:
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


class Xlsx:
    def __init__(self, path: str) -> None:
        self.zip = zipfile.ZipFile(path)
        shared = self.zip.read("xl/sharedStrings.xml")
        self.strings = [
            "".join(t.text or "" for t in si.iter(MAIN + "t"))
            for si in ET.fromstring(shared).findall("m:si", NS)
        ]
        wb = ET.fromstring(self.zip.read("xl/workbook.xml"))
        rels = ET.fromstring(self.zip.read("xl/_rels/workbook.xml.rels"))
        relmap = {r.attrib["Id"]: r.attrib["Target"] for r in rels}
        self.sheets: dict[str, str] = {}
        for sheet in wb.find("m:sheets", NS):
            target = relmap[sheet.attrib["{%s}id" % NS["r"]]]
            if not target.startswith("/"):
                target = "xl/" + target
            else:
                target = target.lstrip("/")
            self.sheets[sheet.attrib["name"]] = target

    def rows(self, name: str) -> list[dict[int, str]]:
        root = ET.fromstring(self.zip.read(self.sheets[name]))
        data = root.find("m:sheetData", NS)
        out: list[dict[int, str]] = []
        for row in (data.findall("m:row", NS) if data is not None else []):
            vals: dict[int, str] = {}
            for cell in row.findall("m:c", NS):
                kind = cell.attrib.get("t", "")
                v = cell.find("m:v", NS)
                inline = cell.find("m:is", NS)
                if kind == "s" and v is not None:
                    val = self.strings[int(v.text)]
                elif kind == "inlineStr" and inline is not None:
                    val = "".join(t.text or "" for t in inline.iter(MAIN + "t"))
                elif v is not None:
                    val = v.text or ""
                else:
                    val = ""
                vals[_colnum(cell.attrib.get("r", ""))] = val
            out.append(vals)
        return out


def excel_dt(date_value: str | None, time_value: str | None) -> dt.datetime | None:
    d = _serial(date_value)
    t = _serial(time_value)
    if d is None or t is None:
        return None
    try:
        return dt.datetime(1899, 12, 30) + dt.timedelta(
            days=int(d), seconds=round(t * 86400)
        )
    except (OverflowError, ValueError):
        return None


def parse_reservation_datetimes(row: dict[int, str]) -> tuple[dt.datetime | None, dt.datetime | None]:
    """H=8 Fecha Inicio, I=9 Hora Inicio, J=10 Fecha Fin, K=11 Hora Fin."""
    return excel_dt(row.get(8), row.get(9)), excel_dt(row.get(10), row.get(11))


def pct(part: int, total: int) -> str:
    return f"{100 * part / total:.1f}%" if total else "0.0%"


def main() -> int:
    parser = argparse.ArgumentParser(description="Auditoría agregada de hojas LADME")
    parser.add_argument("xlsx", help="Ruta al archivo XLSX exportado")
    args = parser.parse_args()

    try:
        book = Xlsx(args.xlsx)
    except (FileNotFoundError, KeyError, zipfile.BadZipFile) as exc:
        print(f"No se pudo abrir el XLSX: {exc}", file=sys.stderr)
        return 1

    print("=" * 62)
    print("AUDITORÍA AGREGADA — LADME")
    print("=" * 62)
    for name, target in book.sheets.items():
        print(f"  {name}: {max(0, len(book.rows(name)) - 1)} filas de datos")

    if "Reservas_LADME" not in book.sheets:
        print("\nNo existe la pestaña Reservas_LADME.", file=sys.stderr)
        return 1

    rows = book.rows("Reservas_LADME")[1:]
    print(f"\nRESERVAS: {len(rows)}")

    durations: list[float] = []
    starts: list[dt.datetime] = []
    ends: list[dt.datetime] = []
    invalid = 0
    for row in rows:
        start, end = parse_reservation_datetimes(row)
        if not start or not end or end <= start:
            invalid += 1
            continue
        starts.append(start)
        ends.append(end)
        durations.append((end - start).total_seconds() / 3600)

    if not durations:
        print("No hay reservas con fechas válidas.", file=sys.stderr)
        return 1

    print(f"  inicio mínimo: {min(starts):%Y-%m-%d %H:%M}")
    print(f"  inicio máximo: {max(starts):%Y-%m-%d %H:%M}")
    print(f"  fin máximo:    {max(ends):%Y-%m-%d %H:%M}")
    print(f"  duración mín.: {min(durations):.2f} h")
    print(f"  duración máx.: {max(durations):.2f} h")
    print(f"  mediana:       {statistics.median(durations):.2f} h")
    print(f"  media:         {statistics.mean(durations):.2f} h")
    print(f"  inválidas:     {invalid}")

    print("\nDISTRIBUCIÓN POR DURACIÓN")
    buckets = [
        ("<= 2 h", 0, 2),
        ("2-8 h", 2, 8),
        ("8-24 h", 8, 24),
        ("1-3 días", 24, 72),
        ("3-7 días", 72, 168),
        ("> 7 días", 168, float("inf")),
    ]
    for label, lo, hi in buckets:
        count = sum(1 for d in durations if lo < d <= hi)
        print(f"  {label:>9}: {count:4d}  ({pct(count, len(durations))})")

    now = dt.datetime.now()
    past = sum(1 for s, e in zip(starts, ends) if e <= now)
    active = sum(1 for s, e in zip(starts, ends) if s <= now < e)
    future = sum(1 for s in starts if s > now)
    print(f"\nAL MOMENTO DE CORRER ({now:%Y-%m-%d %H:%M})")
    print(f"  pasadas:  {past}")
    print(f"  activas:  {active}")
    print(f"  futuras:  {future}")

    print("\nRESERVAS DE MÁS DE 168 H")
    long = []
    for index, (row, start, end, hours) in enumerate(
        zip(rows, starts, ends, durations), start=2
    ):
        if hours > 168:
            long.append((index, row.get(12, ""), start, end, hours, row.get(15, "")))
    if not long:
        print("  ninguna")
    for index, equipment, start, end, hours, res_id in long:
        print(
            f"  fila {index:>3} | {equipment:<38} | "
            f"{start:%Y-%m-%d %H:%M} -> {end:%Y-%m-%d %H:%M} | "
            f"{hours:7.1f} h | {res_id}"
        )

    print("\nCOLUMNAS ESPECIALES")
    print(f"  P ID Solicitud:        {sum(1 for r in rows if str(r.get(16, '')).strip())}")
    print(f"  Q Proceso Desatendido: {sum(1 for r in rows if str(r.get(17, '')).strip())}")
    print(f"  R Mensaje:             {sum(1 for r in rows if str(r.get(18, '')).strip())}")
    extra = sorted({k for r in rows for k in r if k > 18})
    print(f"  columnas > R:          {extra or 'ninguna'}")

    print("\nPERFIL (solo agregados)")
    for column, label in ((2, "Tipo de usuario"), (6, "Programa"), (13, "Actividad")):
        counter = collections.Counter(r.get(column, "") for r in rows)
        values = " · ".join(f"{k or '(vacío)'} {v}" for k, v in counter.most_common())
        print(f"  {label}: {values}")

    if "Computadores_LADME" in book.sheets:
        catalog = book.rows("Computadores_LADME")[1:]
        print(f"\nCATÁLOGO: {len(catalog)} equipos")
        states = collections.Counter(r.get(5, "") for r in catalog)
        print("  estados: " + " · ".join(f"{k or '(vacío)'} {v}" for k, v in states.most_common()))
        used = collections.Counter(r.get(12, "") for r in rows)
        unused = [
            r.get(1, "")
            for r in catalog
            if not any(r.get(1, "") in key for key in used)
        ]
        print(f"  sin reservas en el período: {unused or 'ninguno'}")

    print("\nListo. No se imprimieron datos personales.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
