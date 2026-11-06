# `scripts/` — utilidades locales

Scripts que corren en tu máquina. No forman parte de la web app ni se despliegan.

| Script | Para qué | Dependencias |
|---|---|---|
| `auditoria_xlsx.py` | Lee un XLSX de hojas y muestra agregados sin imprimir datos personales | Ninguna (Python 3.9+) |
| `generar_qr_ladme.py` | Genera placas QR imprimibles (`<url>?asset=UNAL-XX`) y un A4 | `qrcode[pil]`, `pillow` |

## Auditoría

```bash
python scripts/auditoria_xlsx.py "sheets/Alojamiento de código.xlsx"
```

Salida: pestañas, conteos, duraciones, reservas > 168 h, columnas especiales, perfil agregado y equipos sin reservas.

## QR

```bash
pip install "qrcode[pil]" pillow
python scripts/generar_qr_ladme.py --url "<URL-del-deployment>"
```

Opciones útiles:

```bash
python scripts/generar_qr_ladme.py --url "<URL>" --desde 1 --hasta 5
python scripts/generar_qr_ladme.py --url "<URL>" --ids UNAL-03 UNAL-07
python scripts/generar_qr_ladme.py --url "<URL>" --archivo equipos.csv
```

Salida en `placas_qr/` (excluida del repo). El QR apunta a `?asset=<ID>`, el mismo parámetro de las etiquetas NFC. La URL es estable, así que las placas no caducan al actualizar el deployment.
