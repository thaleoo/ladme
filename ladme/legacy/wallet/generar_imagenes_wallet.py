#!/usr/bin/env python3
"""
Genera las imágenes de los pases de Google Wallet del LADME:
  logo_660.png               (1:1)   logo del pase; Google lo recorta en círculo, por eso el dibujo deja margen
  logo_ancho_1280x400.png    (3.2:1) logo ancho (opcional)
  banner_1032x336.png        (3.07:1) banner del pase

Instalación:  pip install pillow
Uso:          python generar_imagenes_wallet.py            (crea la carpeta wallet_imagenes/)
Cambiar colores o textos: edite las constantes de abajo y vuelva a ejecutar.
"""
import math, os
from PIL import Image, ImageDraw, ImageFont

MORADO, MORADO_OSC, MORADO_CLARO, LAVANDA, BLANCO = (91, 33, 182), (59, 20, 130), (139, 92, 246), (221, 214, 254), (255, 255, 255)
TITULO = "LADME"
SUBTITULO = "Laboratorio de Aprendizaje de Datos y Modelado Estadístico"
PIE = "Universidad Nacional de Colombia · Sede La Paz"
SS = 2  # sobremuestreo para bordes suaves

def fuente(tam, negrita=False):
    nombres = (["DejaVuSans-Bold.ttf", "arialbd.ttf", "LiberationSans-Bold.ttf", "Helvetica Bold.ttf"] if negrita
               else ["DejaVuSans.ttf", "arial.ttf", "LiberationSans-Regular.ttf", "Helvetica.ttf"])
    for n in nombres + ["/System/Library/Fonts/Helvetica.ttc"]:
        try:
            return ImageFont.truetype(n, tam)
        except OSError:
            pass
    return ImageFont.load_default()

def degradado(w, h, c1, c2):
    img = Image.new("RGB", (w, h)); px = img.load()
    for y in range(h):
        for x in range(w):
            t = (x / w * 0.7 + y / h * 0.3)
            px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
    return img

def glifo(d, cx, cy, lado, color_barras=BLANCO, color_linea=LAVANDA):
    """Barras ascendentes con línea de tendencia: 'datos y estadística'."""
    ancho_barra, sep = lado * 0.17, lado * 0.075
    alturas = [0.34, 0.54, 0.78]
    x0 = cx - (3 * ancho_barra + 2 * sep) / 2
    base = cy + lado * 0.42
    puntos = []
    for i, a in enumerate(alturas):
        x = x0 + i * (ancho_barra + sep); alto = lado * a
        d.rounded_rectangle([x, base - alto, x + ancho_barra, base], radius=ancho_barra * 0.3, fill=color_barras)
        puntos.append((x + ancho_barra / 2, base - alto - lado * 0.09))
    d.line(puntos, fill=color_linea, width=int(lado * 0.035), joint="curve")
    for (px_, py_) in puntos:
        r = lado * 0.035
        d.ellipse([px_ - r, py_ - r, px_ + r, py_ + r], fill=color_linea)

def logo(lado=660):
    w = lado * SS
    img = Image.new("RGB", (w, w), MORADO); d = ImageDraw.Draw(img)
    glifo(d, w / 2, w / 2, w * 0.52)               # dentro del 15 % de margen de seguridad
    return img.resize((lado, lado), Image.LANCZOS)

def logo_ancho(w=1280, h=400):
    W, H = w * SS, h * SS
    img = Image.new("RGB", (W, H), MORADO); d = ImageDraw.Draw(img)
    glifo(d, H * 0.55, H * 0.5, H * 0.62)
    x = H * 1.05
    d.text((x, H * 0.16), TITULO, font=fuente(int(H * 0.36), True), fill=BLANCO)
    sub = fuente(int(H * 0.082))
    d.text((x, H * 0.62), "Laboratorio de Aprendizaje de Datos", font=sub, fill=LAVANDA)
    d.text((x, H * 0.72), "y Modelado Estadístico", font=sub, fill=LAVANDA)
    return img.resize((w, h), Image.LANCZOS)

def banner(w=1032, h=336):
    W, H = w * SS, h * SS
    img = degradado(W, H, MORADO_OSC, MORADO_CLARO); d = ImageDraw.Draw(img, "RGBA")
    for gx in range(0, W, int(H * 0.11)):          # trama de puntos muy suave
        for gy in range(0, H, int(H * 0.11)):
            d.ellipse([gx - 3, gy - 3, gx + 3, gy + 3], fill=(255, 255, 255, 22))
    pts = [(W * (0.34 + 0.62 * t / 60), H * (0.78 - 0.40 * (t / 60) - 0.10 * math.sin(t / 5.0) * (t / 60)))
           for t in range(61)]
    d.line([(x, y + 8) for x, y in pts], fill=(0, 0, 0, 40), width=int(H * 0.035), joint="curve")
    d.line(pts, fill=(255, 255, 255, 235), width=int(H * 0.028), joint="curve")
    for i in (6, 20, 34, 48, 60):
        x, y = pts[i]; r = H * 0.032
        d.ellipse([x - r * 1.9, y - r * 1.9, x + r * 1.9, y + r * 1.9], fill=(255, 255, 255, 50))
        d.ellipse([x - r, y - r, x + r, y + r], fill=BLANCO)
    d.text((H * 0.10, H * 0.14), TITULO, font=fuente(int(H * 0.27), True), fill=BLANCO)
    d.text((H * 0.10, H * 0.46), "Reserva de equipos de cómputo", font=fuente(int(H * 0.08)), fill=LAVANDA)
    d.text((H * 0.10, H * 0.83), PIE, font=fuente(int(H * 0.058)), fill=(255, 255, 255, 190))
    return img.convert("RGB").resize((w, h), Image.LANCZOS)

if __name__ == "__main__":
    os.makedirs("wallet_imagenes", exist_ok=True)
    logo().save("wallet_imagenes/logo_660.png")
    logo_ancho().save("wallet_imagenes/logo_ancho_1280x400.png")
    banner().save("wallet_imagenes/banner_1032x336.png")
    print("Listo: wallet_imagenes/ (logo_660.png, logo_ancho_1280x400.png, banner_1032x336.png)")
    print("Suba los PNG a una URL pública HTTPS y copie esas URL en las propiedades WALLET_LOGO_URL, WALLET_WIDE_LOGO_URL y WALLET_HERO_URL.")