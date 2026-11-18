#!/usr/bin/env bash
# Faro · instalación en Linux (AppImage) para la cuenta en la que se ejecuta, sin sudo.
#
#   1. Copie en una carpeta este script y el archivo «...AppImage».
#   2. Inicie sesión en la cuenta del equipo y, en esa carpeta:
#        bash instalar-linux.sh ABCD-EFGH
#      El código sale en LADME → Administración → Faro → el equipo → Vincular (vence en 30 min).
#
# Copia Faro a ~/.local/bin, deja el código para que se vincule solo y crea un servicio de la
# cuenta (systemd) que lo abre al iniciar sesión y lo vuelve a abrir si alguien lo cierra.
# Con el AppImage, Faro también se actualiza solo.
set -euo pipefail

dir="$(cd "$(dirname "$0")" && pwd)"
appimage="$(ls -t "$dir"/*.AppImage 2>/dev/null | head -n 1 || true)"
if [ -z "$appimage" ]; then
  echo "No encontré el archivo .AppImage de Faro junto a este script." >&2
  exit 1
fi

destino="$HOME/.local/bin/ladme-faro.AppImage"
config="${XDG_CONFIG_HOME:-$HOME/.config}"
carpeta="$config/co.edu.unal.ladme.faro"

systemctl --user stop ladme-faro.service 2>/dev/null || true
pkill -f "ladme-faro" 2>/dev/null || true
mkdir -p "$HOME/.local/bin" "$carpeta" "$config/systemd/user"
cp "$appimage" "$destino"
chmod +x "$destino"

if [ -n "${1:-}" ]; then
  codigo="$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]' | tr -cd 'A-Z0-9')"
  if [ "${#codigo}" -ne 8 ]; then
    echo "El código de vinculación tiene 8 caracteres (por ejemplo ABCD-EFGH)." >&2
    exit 1
  fi
  if [ -f "$carpeta/faro.json" ] && grep -q '"token"' "$carpeta/faro.json"; then
    echo "Este equipo ya estaba vinculado: se conserva el vínculo actual."
  else
    printf '{ "codigo_vinculo": "%s" }\n' "$codigo" > "$carpeta/faro.json"
  fi
fi

cat > "$config/systemd/user/ladme-faro.service" <<UNIT
[Unit]
Description=Faro · LADME
PartOf=graphical-session.target
After=graphical-session.target

[Service]
ExecStart=$destino
Restart=always
RestartSec=3

[Install]
WantedBy=graphical-session.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now ladme-faro.service
echo "Listo. Faro quedó en $destino y lo maneja el servicio «ladme-faro» de esta cuenta."
[ -n "${1:-}" ] && echo "En unos segundos se vincula solo; compruébelo en LADME → Administración → Faro."
exit 0
