#!/usr/bin/env bash
# Faro · retirar el servicio del sistema en Linux.
#
#   sudo bash desinstalar-linux.sh              quita Faro y conserva el vínculo en /var/lib/ladme-faro
#   sudo bash desinstalar-linux.sh --todo       quita también el vínculo y el estado
#
# Para volver a instalarlo basta con instalar-linux.sh: si conservó el vínculo, no pide código.
# El equipo sigue en el panel de LADME (aparece sin conexión) hasta que lo retire allí.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Ejecútelo con la contraseña de administrador: sudo bash desinstalar-linux.sh" >&2
  exit 1
fi

systemctl disable --now ladme-faro-servicio.service 2>/dev/null || true
systemctl --global disable ladme-faro.service 2>/dev/null || true
for u in $(loginctl list-users --no-legend 2>/dev/null | awk '{print $2}'); do
  systemctl --user -M "$u@" stop ladme-faro.service 2>/dev/null || true
done
pkill -x ladme-faro 2>/dev/null || true
pkill -f "[l]adme-faro\.AppImage" 2>/dev/null || true

rm -f /etc/systemd/system/ladme-faro-servicio.service \
      /etc/systemd/user/ladme-faro.service \
      /etc/xdg/autostart/ladme-faro.desktop
if [ -L /usr/local/bin/faro ]; then rm -f /usr/local/bin/faro; fi
rm -rf /opt/ladme-faro /run/ladme-faro
systemctl daemon-reload 2>/dev/null || true

if [ "${1:-}" = "--todo" ]; then
  rm -rf /var/lib/ladme-faro
  echo "Faro quedó retirado de este equipo, con su vínculo."
else
  echo "Faro quedó retirado de este equipo. El vínculo se conserva en /var/lib/ladme-faro"
  echo "(para borrarlo también: sudo bash desinstalar-linux.sh --todo)."
fi
