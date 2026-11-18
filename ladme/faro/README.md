# Faro · el agente de los computadores de LADME

Faro corre en cada PC de la sala. Arriba al centro de la pantalla muestra una **isla** negra (como el
notch de un celular) con el equipo, quién lo tiene reservado y cuánto falta. Al tocarla se abre un panel
con la cuenta regresiva y accesos para extender, liberar, reservar o reportar una falla. Esas acciones
abren un QR para hacerlas desde el celular, porque la cuenta «estudiantes» es compartida y Faro no sabe
quién está sentado frente al PC.

Según el **modo** que elija el laboratorio para cada equipo (Administración → Faro):

| Modo | Qué hace |
| --- | --- |
| **Observar** | Solo muestra la isla y registra cuándo se usa el equipo sin reserva. Es la fase 1. |
| **Avisar** | Además, si alguien usa el equipo sin reserva, la isla se abre sola y pide reservarlo. |
| **Bloquear** | Si no hay reserva vigente, cubre todas las pantallas con un bloqueo y un QR para reservar. Al detectar la reserva se desbloquea solo (en unos 10 s). |

Más detalles:

- **Nunca cierra la sesión ni detiene programas.** El bloqueo solo cubre la pantalla, así que los
  procesos desatendidos siguen corriendo.
- **Aviso antes de terminar.** Diez minutos antes del fin, la isla avisa. Al terminar la reserva hay 3
  minutos de gracia antes de bloquear. Los dos tiempos se cambian en Políticas.
- **Proceso desatendido.** Si la reserva dejó un proceso corriendo y nadie toca el PC, se muestra un aviso
  «No apagues ni cierres la sesión» con el mensaje del titular. Desaparece al mover el mouse.
- **Llegada automática.** Si Faro detecta uso del equipo durante una reserva, registra la llegada. Así
  nadie recibe el correo de «no registró su llegada» mientras está usando el PC.
- **Sin internet.** Faro sigue las mismas reglas con lo último que supo. Una reserva vale hasta su fin, y
  un equipo sin reserva sigue sin ella. Desconectar el cable no desbloquea nada.
- **Desbloqueo del personal.** Desde la PWA, un equipo puede quedar libre por 30 min, 1 h o 4 h. Sin
  internet se usa la **clave de emergencia** del laboratorio (Administración → Faro), que deja el equipo
  libre por 2 horas. Cada uso de la clave avisa al personal.
- **Registro.** Todo queda en «Actividad reciente»: bloqueos, desbloqueos, uso sin reserva e intentos de
  cerrar la pantalla de bloqueo.

## Instalación (con TI/OTIC)

1. **Base de datos:** ejecute `ladme/db/migrations/0006_faro.sql` en Supabase.
2. **Instaladores:** en GitHub, Settings → Secrets and variables → Actions → **Variables**, cree:
   - `FARO_SUPABASE_URL`: la URL del proyecto, la misma de la PWA.
   - `FARO_SUPABASE_KEY`: la clave **pública** (anon o `sb_publishable_…`), la misma de la PWA. No use la
     clave secreta.
   - `FARO_PWA_URL`: la dirección donde está publicada la PWA, para los QR.

   Luego vaya a Actions → **Faro** → Run workflow. Al terminar, descargue los artefactos:
   - `faro-Windows`: `LADME Faro_x.y.z_x64-setup.exe`.
   - `faro-Linux`: `.deb` y `.AppImage`.

   Si crea una etiqueta `faro-v0.1.0`, los instaladores también se publican en Releases.
3. **En cada PC:**
   - **Windows 10/11:** el instalador puede instalar Faro solo para la cuenta «estudiantes» (sin
     permisos de administrador) o para todo el equipo (con permisos, lo hace TI). Faro se registra para
     arrancar al iniciar sesión. En Windows 10 sin WebView2, el instalador lo trae incluido.
   - **Linux:** `sudo apt install ./ladme-faro_*.deb` (lo hace TI), o el `.AppImage` en la carpeta de la
     cuenta. Faro se agrega solo al inicio de sesión (`~/.config/autostart`).
4. **Vincular:** la primera vez Faro abre «Vincular este equipo». En la PWA, vaya a Administración → Faro
   → el equipo → **Vincular**, y escriba en el PC el código de 8 caracteres (vence en 30 min). Listo.
5. **Fases:** deje la sala en **Observar** una o dos semanas y mire cuántos «uso sin reserva» aparecen.
   Luego pase a **Avisar**, y finalmente a **Bloquear** cuando la gente ya esté acostumbrada a reservar.

### Opcional: configuración del equipo

Si TI prefiere no compilar las direcciones en el instalador, puede dejarlas en un archivo que Faro lee al
arrancar. En Windows es `C:\ProgramData\LADME\faro.json`; en Linux, `/etc/ladme/faro.json`:

```json
{ "supabase_url": "https://xxxx.supabase.co", "supabase_key": "sb_publishable_…", "pwa_url": "https://…" }
```

El token del PC se guarda en la carpeta de la cuenta, nunca en ese archivo:
- Windows: `%APPDATA%\co.edu.unal.ladme.faro\faro.json`
- Linux: `~/.config/co.edu.unal.ladme.faro/faro.json`

En la base de datos solo queda su huella.

## Límites conocidos (y qué haría falta para cerrarlos)

- **Cerrar Faro a la fuerza.** En la cuenta «estudiantes», alguien que sepa usar el Administrador de
  tareas puede terminar el proceso de Faro.
  - Faro impide Alt+F4 sobre el bloqueo y registra el intento.
  - Si el proceso muere, el panel muestra el equipo «sin señal».
  - Para impedirlo de verdad hace falta una fase 3b con TI: un servicio de Windows (o de systemd en
    Linux) que corra como sistema y vuelva a abrir Faro si lo cierran, o una directiva que bloquee el
    Administrador de tareas para esa cuenta.
- **Linux con Wayland.** Ubuntu 22.04+ usa Wayland por defecto. Ahí no se puede saber si el PC está en uso
  (el «uso sin reserva» no se registra), y las ventanas «siempre encima» no están garantizadas. Para esos
  equipos se recomienda la sesión «Ubuntu en Xorg».
- **Combinaciones del sistema.** Ctrl+Alt+Supr y la tecla Windows no se pueden bloquear desde una
  aplicación normal. El bloqueo vuelve a ponerse delante cada segundo.

## Desarrollo

```bash
cd ladme/faro
npm install
npm run dev                         # con FARO_SUPABASE_URL, FARO_SUPABASE_KEY y FARO_PWA_URL definidas
cd src-tauri && cargo test          # reglas de decisión y clave de emergencia
```

- La lógica de qué mostrar está en `src-tauri/src/decision.rs`, como una función pura con pruebas.
- Las ventanas están en `ui/`: HTML, CSS y JS sin compilar. `isla.*` es la isla, `bloqueo.*` la pantalla
  de bloqueo y `vincular.*` la vinculación.
