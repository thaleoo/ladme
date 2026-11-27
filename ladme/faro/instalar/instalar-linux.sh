#!/usr/bin/env bash
# Faro · instalación en Linux (AppImage).
#
#   1. Copie en una carpeta este script y el archivo «...AppImage».
#   2. En esa carpeta, con la contraseña de administrador del equipo:
#        sudo bash instalar-linux.sh ABCD-EFGH
#      El código sale en LADME → Administración → Faro → el equipo → Vincular (vence en 30 min).
#      Si el equipo ya estaba vinculado (Faro por cuenta), no hace falta código: se conserva el vínculo.
#
# Con sudo (recomendado), Faro queda como servicio del sistema para todas las cuentas:
#   · /opt/ladme-faro/ladme-faro.AppImage       el programa (se actualiza solo)
#   · ladme-faro-servicio.service (systemd)     el núcleo, como root: vínculo, estado, claves, servidor
#   · ladme-faro.service (cada cuenta)          la isla y las pantallas de la sesión que está en uso
#   · /var/lib/ladme-faro                       vínculo y estado (solo root)
#   · /usr/local/bin/faro                       la línea de comandos
# Una cuenta sin permisos de administrador no puede cerrar ni desvincular Faro.
#
# Sin sudo, se instala como antes, solo para la cuenta que lo ejecuta (~/.local/bin, servicio de la cuenta).
# Para retirarlo: sudo bash desinstalar-linux.sh
set -euo pipefail

dir="$(cd "$(dirname "$0")" && pwd)"
appimage="$(ls -t "$dir"/*.AppImage 2>/dev/null | head -n 1 || true)"
if [ -z "$appimage" ]; then
  echo "No encontré el archivo .AppImage de Faro junto a este script." >&2
  exit 1
fi

codigo=""
if [ -n "${1:-}" ]; then
  codigo="$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]' | tr -cd 'A-Z0-9')"
  if [ "${#codigo}" -ne 8 ]; then
    echo "El código de vinculación tiene 8 caracteres (por ejemplo ABCD-EFGH)." >&2
    exit 1
  fi
fi

# ------------------------------------------------------------------ solo para esta cuenta (sin sudo)

if [ "$(id -u)" -ne 0 ]; then
  if [ -f /etc/systemd/system/ladme-faro-servicio.service ]; then
    echo "En este equipo Faro está instalado como servicio del sistema. Para actualizarlo:" >&2
    echo "  sudo bash instalar-linux.sh" >&2
    exit 1
  fi
  destino="$HOME/.local/bin/ladme-faro.AppImage"
  config="${XDG_CONFIG_HOME:-$HOME/.config}"
  carpeta="$config/co.edu.unal.ladme.faro"

  systemctl --user stop ladme-faro.service 2>/dev/null || true
  pkill -x ladme-faro 2>/dev/null || true
  pkill -f "[l]adme-faro\.AppImage" 2>/dev/null || true
  mkdir -p "$HOME/.local/bin" "$carpeta" "$config/systemd/user"
  cp "$appimage" "$destino"
  chmod +x "$destino"

  if [ -n "$codigo" ]; then
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
  echo "Para que nadie pueda cerrarlo, instálelo como servicio del sistema: sudo bash instalar-linux.sh"
  [ -n "$codigo" ] && echo "En unos segundos se vincula solo; compruébelo en LADME → Administración → Faro."
  exit 0
fi

# ------------------------------------------------------------------ servicio del sistema (sudo)

opt=/opt/ladme-faro
programa="$opt/ladme-faro.AppImage"
datos=/var/lib/ladme-faro

# El AppImage necesita FUSE 2 para abrirse.
if ! ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2'; then
  echo "Instalando FUSE 2 (lo necesita el AppImage)…"
  if command -v dnf >/dev/null; then
    dnf install -y fuse-libs
  elif command -v apt-get >/dev/null; then
    apt-get install -y libfuse2t64 2>/dev/null || apt-get install -y libfuse2
  else
    echo "Instale la biblioteca FUSE 2 (libfuse.so.2) y vuelva a ejecutar el script." >&2
    exit 1
  fi
fi

# Cuentas con carpeta personal (para migrar y limpiar lo de Faro por cuenta).
casas=()
while IFS=: read -r _ _ uid _ _ casa _; do
  if [ "$uid" -ge 1000 ] && [ "$uid" -lt 65534 ] && [ -d "$casa" ]; then casas+=("$casa"); fi
done < /etc/passwd
casas+=(/root)

# Detener lo que haya: el servicio, las interfaces abiertas y cualquier Faro por cuenta (y su vigía).
systemctl stop ladme-faro-servicio.service 2>/dev/null || true
for u in $(loginctl list-users --no-legend 2>/dev/null | awk '{print $2}'); do
  systemctl --user -M "$u@" stop ladme-faro.service 2>/dev/null || true
done
# Por nombre de proceso: «pkill -f ladme-faro» también cerraría este script si la carpeta se llama así.
pkill -x ladme-faro 2>/dev/null || true
pkill -f "[l]adme-faro\.AppImage" 2>/dev/null || true
sleep 1

mkdir -p "$opt" "$datos"
chmod 700 "$datos"
cp "$appimage" "$programa.nuevo"
chmod 755 "$programa.nuevo"
mv -f "$programa.nuevo" "$programa"

# El vínculo: el del servicio si ya existe; si no, el de la cuenta que ejecuta sudo (o la primera
# cuenta que tenga uno); si no, el código.
if [ -f "$datos/faro.json" ] && grep -q '"token"' "$datos/faro.json"; then
  echo "Se conserva el vínculo del servicio."
else
  origen=""
  if [ -n "${SUDO_USER:-}" ]; then
    casa_sudo="$(getent passwd "$SUDO_USER" | cut -d: -f6)"
    c="$casa_sudo/.config/co.edu.unal.ladme.faro"
    if [ -f "$c/faro.json" ] && grep -q '"token"' "$c/faro.json"; then origen="$c"; fi
  fi
  if [ -z "$origen" ]; then
    for casa in "${casas[@]}"; do
      c="$casa/.config/co.edu.unal.ladme.faro"
      if [ -f "$c/faro.json" ] && grep -q '"token"' "$c/faro.json"; then origen="$c"; break; fi
    done
  fi
  if [ -n "$origen" ]; then
    cp "$origen/faro.json" "$datos/faro.json"
    [ -f "$origen/estado.json" ] && cp "$origen/estado.json" "$datos/estado.json"
    echo "Se trasladó el vínculo de $origen al servicio."
  elif [ -n "$codigo" ]; then
    printf '{ "codigo_vinculo": "%s" }\n' "$codigo" > "$datos/faro.json"
  else
    echo "Aviso: el equipo no está vinculado. Vincúlelo con: faro link ABCD-EFGH"
  fi
fi
chmod 600 "$datos"/*.json 2>/dev/null || true

# Faro por cuenta: su servicio, su entrada de inicio de sesión, su AppImage y su comando «faro».
# (El servicio de la cuenta tendría prioridad sobre el del sistema; el vínculo ya está en el servicio.)
for casa in "${casas[@]}"; do
  rm -f "$casa/.config/systemd/user/ladme-faro.service" \
        "$casa/.config/systemd/user/graphical-session.target.wants/ladme-faro.service" \
        "$casa/.config/systemd/user/default.target.wants/ladme-faro.service"
  for f in "$casa"/.config/autostart/*.desktop; do
    [ -f "$f" ] && grep -qi 'ladme.faro\|LADME Faro' "$f" && rm -f "$f"
  done
  if [ -L "$casa/.local/bin/faro" ]; then
    case "$(readlink "$casa/.local/bin/faro")" in *aro*.AppImage|*ladme-faro*) rm -f "$casa/.local/bin/faro" ;; esac
  fi
  rm -f "$casa/.local/bin/ladme-faro.AppImage"
  c="$casa/.config/co.edu.unal.ladme.faro"
  [ -f "$c/faro.json" ] && mv -f "$c/faro.json" "$c/faro.json.trasladado"
done

cat > /etc/systemd/system/ladme-faro-servicio.service <<UNIT
[Unit]
Description=Faro · LADME (servicio del sistema)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=$programa --servicio
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

mkdir -p /etc/systemd/user
cat > /etc/systemd/user/ladme-faro.service <<UNIT
[Unit]
Description=Faro · LADME (interfaz de la sesión)
PartOf=graphical-session.target
After=graphical-session.target

[Service]
ExecStart=$programa
Restart=always
RestartSec=3

[Install]
WantedBy=graphical-session.target
UNIT

# Escritorios que no llegan a graphical-session.target (XFCE, MATE…): se arranca al iniciar sesión.
mkdir -p /etc/xdg/autostart
cat > /etc/xdg/autostart/ladme-faro.desktop <<DESKTOP
[Desktop Entry]
Type=Application
Name=Faro · LADME
Exec=sh -c "systemctl --user import-environment DISPLAY XAUTHORITY WAYLAND_DISPLAY XDG_SESSION_TYPE; systemctl --user start ladme-faro.service"
NoDisplay=true
X-GNOME-Autostart-Phase=Applications
DESKTOP

ln -sf "$programa" /usr/local/bin/faro

systemctl daemon-reload
systemctl enable --now ladme-faro-servicio.service
systemctl --global enable ladme-faro.service

# La sesión que está abierta ahora (las demás lo abren al iniciar sesión).
for u in $(loginctl list-users --no-legend 2>/dev/null | awk '{print $2}'); do
  systemctl --user -M "$u@" daemon-reload 2>/dev/null || true
  systemctl --user -M "$u@" start ladme-faro.service 2>/dev/null || true
done

echo
echo "Listo. Faro quedó como servicio del sistema para todas las cuentas ($programa)."
echo "Compruébelo con: faro status"
[ -n "$codigo" ] && echo "En unos segundos se vincula solo; compruébelo en LADME → Administración → Faro."
exit 0
