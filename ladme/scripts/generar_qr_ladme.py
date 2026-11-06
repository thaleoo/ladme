#!/usr/bin/env python3
"""
Genera las PLACAS con QR de los equipos del LADME (una por equipo) y una hoja A4 lista para imprimir.
Corre en Windows, macOS y Linux. No usa internet: todo se genera en su máquina.

Instalación (una sola vez):
    pip install "qrcode[pil]" pillow

Uso básico (equipos UNAL-01 a UNAL-16):
    python generar_qr_ladme.py --url "https://script.google.com/a/macros/unal.edu.co/s/XXXXXXXX/exec"

Otros ejemplos:
    python generar_qr_ladme.py --url "..." --desde 1 --hasta 5          # solo UNAL-01 a UNAL-05
    python generar_qr_ladme.py --url "..." --ids UNAL-03 UNAL-07        # solo esos
    python generar_qr_ladme.py --url "..." --archivo equipos.csv        # ID[,descripcion] por línea
    python generar_qr_ladme.py --url "..." --sin-zona-borrable          # sin recuadro de aviso borrable

Salida (carpeta placas_qr/): placas_A4.pdf, png/<ID>.png (placa), qr_solo/<ID>.png (solo el QR).
Cada QR abre:  <url>?asset=<ID>   (el mismo parámetro que usan las etiquetas NFC).
"""
import argparse, os, re, sys
from urllib.parse import quote

try:
    import qrcode
    from qrcode.constants import ERROR_CORRECT_Q
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit('Faltan dependencias. Ejecute:  pip install "qrcode[pil]" pillow')

DPI = 300
def mm(x): return int(round(x * DPI / 25.4))

PLACA_W, PLACA_H = 100, 62           # milímetros
MORADO, GRIS = (91, 33, 182), (110, 110, 110)

def fuente(tam, negrita=False):
    candidatas = (["arialbd.ttf", "DejaVuSans-Bold.ttf", "LiberationSans-Bold.ttf", "Helvetica Bold.ttf"] if negrita
                  else ["arial.ttf", "DejaVuSans.ttf", "LiberationSans-Regular.ttf", "Helvetica.ttf"])
    candidatas += ["/System/Library/Fonts/Helvetica.ttc", "/Library/Fonts/Arial.ttf"]
    for nombre in candidatas:
        try:
            return ImageFont.truetype(nombre, tam)
        except OSError:
            continue
    try:
        return ImageFont.load_default(size=tam)
    except TypeError:
        return ImageFont.load_default()

def ajustar(draw, texto, ancho_max, tam, negrita=False, minimo=18):
    """Reduce el tamaño de la letra hasta que el texto quepa en ancho_max (píxeles)."""
    while tam > minimo:
        f = fuente(tam, negrita)
        if draw.textlength(texto, font=f) <= ancho_max:
            return f
        tam -= 2
    return fuente(minimo, negrita)

ID_VALIDO = re.compile(r"^[A-Za-z0-9-]{3,20}$")   # misma regla que valida la app

def leer_ids(a):
    if a.archivo:
        pares = []
        with open(a.archivo, encoding="utf-8-sig") as fh:
            for n, linea in enumerate(fh, 1):
                linea = linea.strip()
                if not linea or linea.startswith("#"):
                    continue
                partes = re.split(r"[;,\t]", linea, maxsplit=1)
                pares.append((n, partes[0].strip(), partes[1].strip() if len(partes) > 1 else ""))
    elif a.ids:
        pares = [(0, i.strip(), "") for i in a.ids]
    else:
        pares = [(0, f"{a.prefijo}-{n:0{a.digitos}d}", "") for n in range(a.desde, a.hasta + 1)]
    for n, eid, _ in pares:
        if not ID_VALIDO.match(eid):
            sys.exit(f"ID no valido{f' (linea {n})' if n else ''}: '{eid}'. Use solo letras, numeros y guiones (3 a 20 caracteres).")
    return [(eid, desc) for _, eid, desc in pares]

def crear_qr(url, lado_px):
    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_Q, box_size=10, border=2)
    qr.add_data(url); qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    return img.resize((lado_px, lado_px), Image.NEAREST)

def crear_placa(equipo_id, descripcion, url, borrable):
    W, H = mm(PLACA_W), mm(PLACA_H)
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W - 1, H - 1], outline=(150, 150, 150), width=3)       # línea de corte

    m = mm(4)
    qr_lado = mm(40)
    img.paste(crear_qr(url, qr_lado), (m, m))
    leyenda = "Escanee o acerque el celular (NFC)"
    d.text((m, m + qr_lado + mm(1)), leyenda, font=ajustar(d, leyenda, qr_lado, mm(2.6)), fill=GRIS)

    x = m + qr_lado + mm(5)
    ancho = W - x - m
    d.text((x, m), "LADME", font=fuente(mm(5), True), fill=MORADO)
    d.text((x, m + mm(6.5)), equipo_id, font=ajustar(d, equipo_id, ancho, mm(10), True), fill="black")
    if descripcion:
        d.text((x, m + mm(18)), descripcion, font=ajustar(d, descripcion, ancho, mm(3.6)), fill=GRIS)
    d.text((x, m + mm(24)), "Estado, reservar y contactar", font=ajustar(d, "Estado, reservar y contactar", ancho, mm(3.4), True), fill="black")

    if borrable:
        top = H - m - mm(17)
        d.rectangle([x, top, W - m, H - m], outline=(120, 120, 120), width=2)
        d.text((x + mm(1.5), top + mm(1)), "Aviso de gestión (borrable)", font=fuente(mm(2.4)), fill=GRIS)

    pie = "Un papel no reserva el equipo: vale lo que dice el sistema."
    d.text((m, H - m - mm(3.2)), pie, font=ajustar(d, pie, qr_lado + mm(1), mm(2.4)), fill=GRIS)
    return img

def hoja_a4(placas):
    A4W, A4H = mm(210), mm(297)
    cols, filas = 2, 4
    por_hoja = cols * filas
    pw, ph = mm(PLACA_W), mm(PLACA_H)
    x0, y0 = (A4W - cols * pw) // 2, (A4H - filas * ph) // 2
    paginas = []
    for i in range(0, len(placas), por_hoja):
        pag = Image.new("RGB", (A4W, A4H), "white")
        for k, placa in enumerate(placas[i:i + por_hoja]):
            pag.paste(placa, (x0 + (k % cols) * pw, y0 + (k // cols) * ph))
        paginas.append(pag)
    return paginas

def main():
    p = argparse.ArgumentParser(description="Genera placas con QR para los equipos del LADME.")
    p.add_argument("--url", required=True, help="URL de producción de la app (termina en /exec)")
    p.add_argument("--prefijo", default="UNAL"); p.add_argument("--desde", type=int, default=1)
    p.add_argument("--hasta", type=int, default=16); p.add_argument("--digitos", type=int, default=2)
    p.add_argument("--ids", nargs="+", help="lista explícita de IDs")
    p.add_argument("--archivo", help="CSV/TXT: ID[,descripcion] por línea")
    p.add_argument("--salida", default="placas_qr")
    p.add_argument("--sin-zona-borrable", action="store_true")
    a = p.parse_args()

    if not a.url.startswith("https://"):
        sys.exit("La URL debe empezar por https://")
    if "/exec" not in a.url:
        print("AVISO: la URL no contiene '/exec'. Use la URL de producción de la implementación.")
    sep = "&" if "?" in a.url else "?"

    equipos = leer_ids(a)
    if not equipos:
        sys.exit("No hay equipos para generar.")
    os.makedirs(os.path.join(a.salida, "png"), exist_ok=True)
    os.makedirs(os.path.join(a.salida, "qr_solo"), exist_ok=True)

    placas = []
    for eid, desc in equipos:
        url = f"{a.url}{sep}asset={quote(eid)}"
        placa = crear_placa(eid, desc, url, not a.sin_zona_borrable)
        placa.save(os.path.join(a.salida, "png", f"{eid}.png"), dpi=(DPI, DPI))
        crear_qr(url, mm(40)).save(os.path.join(a.salida, "qr_solo", f"{eid}.png"), dpi=(DPI, DPI))
        placas.append(placa)

    paginas = hoja_a4(placas)
    pdf = os.path.join(a.salida, "placas_A4.pdf")
    paginas[0].save(pdf, save_all=True, append_images=paginas[1:], resolution=DPI)
    print(f"Listo: {len(equipos)} placas en '{a.salida}/'  ->  {pdf}")
    print("Imprima el PDF al 100% (sin 'ajustar a página'). Cada placa mide "
          f"{PLACA_W} x {PLACA_H} mm. Pruebe un QR con el celular antes de imprimir todo.")
    print("Ejemplo de URL generada:", f"{a.url}{sep}asset={quote(equipos[0][0])}")

if __name__ == "__main__":
    main()