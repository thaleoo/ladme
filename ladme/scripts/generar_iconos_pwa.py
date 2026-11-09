"""Genera los iconos PNG de la PWA sin dependencias externas.

Dibuja una «L» blanca y tres barras de datos sobre el morado institucional.
Uso: python scripts/generar_iconos_pwa.py
Salida: ladme/pwa/public/icon-192.png y icon-512.png
"""
from __future__ import annotations

import struct
import zlib
from pathlib import Path

MORADO = (109, 40, 217, 255)
BLANCO = (255, 255, 255, 255)


def dentro_rect(x: int, y: int, x0: int, y0: int, x1: int, y1: int) -> bool:
    return x0 <= x < x1 and y0 <= y < y1


def dentro_circulo(x: int, y: int, cx: int, cy: int, r: int) -> bool:
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def pixel(x: int, y: int, s: int) -> tuple[int, int, int, int]:
    # Coordenadas normalizadas sobre un lienzo de 512 y escaladas.
    def nx(v: float) -> int:
        return int(v * s / 512)

    if (
        dentro_rect(x, y, nx(140), nx(120), nx(200), nx(380))      # vertical de la L
        or dentro_rect(x, y, nx(140), nx(320), nx(340), nx(380))    # base de la L
        or dentro_rect(x, y, nx(260), nx(250), nx(290), nx(320))    # barra 1
        or dentro_rect(x, y, nx(310), nx(210), nx(340), nx(320))    # barra 2
        or dentro_rect(x, y, nx(360), nx(160), nx(390), nx(320))    # barra 3
        or dentro_circulo(x, y, nx(410), nx(135), nx(22))           # punto de datos
    ):
        return BLANCO
    return MORADO


def escribir_png(ruta: Path, s: int) -> None:
    filas = bytearray()
    for y in range(s):
        filas.append(0)  # filtro «None»
        for x in range(s):
            filas.extend(pixel(x, y, s))

    def chunk(tipo: bytes, datos: bytes) -> bytes:
        cuerpo = tipo + datos
        return struct.pack(">I", len(datos)) + cuerpo + struct.pack(">I", zlib.crc32(cuerpo) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", s, s, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(filas), 9))
        + chunk(b"IEND", b"")
    )
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_bytes(png)
    print(f"escrito {ruta} ({s}x{s})")


if __name__ == "__main__":
    base = Path(__file__).resolve().parent.parent / "pwa" / "public"
    escribir_png(base / "icon-192.png", 192)
    escribir_png(base / "icon-512.png", 512)
