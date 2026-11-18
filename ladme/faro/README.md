# Faro · el agente de los computadores de LADME

Faro corre en cada PC de la sala. Arriba al centro de la pantalla muestra una **isla** negra (como el
notch de un celular) con el equipo, quién lo tiene reservado y cuánto falta. Al tocarla se abre un panel
con la cuenta regresiva y accesos para extender, liberar, reservar o reportar una falla. Esas acciones
abren un QR para hacerlas desde el celular, porque la cuenta «estudiantes» es compartida y Faro no sabe
quién está sentado frente al PC.

Las acciones de la isla abren páginas directas en la PWA, sin pasar por la ficha del equipo:

| Página | Qué hace |
| --- | --- |
| `/pc/UNAL-05/extender` | Extender con un toque (+30 min, +1 h…), dentro de los límites. |
| `/pc/UNAL-05/liberar` | Confirmar y liberar, con una pregunta rápida sobre si el equipo funcionó. |
| `/pc/UNAL-05/reportar` | Reportar una falla. |
| `/pc/UNAL-05/reservar` | Abrir el formulario de reserva con el equipo ya elegido. |

Si la persona no ha iniciado sesión en el celular, después de entrar vuelve a esa misma página.

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
- **Registro.** Todo queda en «Actividad reciente»: bloqueos, desbloqueos, uso sin reserva, cierres e
  intentos de cerrar la pantalla de bloqueo.
- **Modo clase** (Administración → Faro). Aparta toda la sala para una clase: nadie puede reservarla y los
  PCs quedan libres para usarlos sin reserva, con «Clase en curso» en la isla. Los equipos que ya tenían
  una reserva en ese horario se respetan. Se termina con «Terminar clase» o al vencer.
- **Uso real.** Cada latido suma el tiempo encendido, el tiempo en uso y el tiempo en uso sin reserva de
  cada equipo, por hora. La pestaña Faro muestra:
  - horas en uso, uso sin reserva, horas reservadas y reservas en las que nadie usó el PC;
  - un mapa de calor por día y hora;
  - una comparación por equipo.

  Sirve para decidir cuándo pasar de fase y para ver qué horarios necesitan más equipos.
- **Vigía.** Si alguien cierra Faro a la fuerza, un segundo proceso lo vuelve a abrir en unos 3 segundos
  y queda el registro «cierre forzado», con aviso al chat del personal. En Linux con el script de
  instalación, ese papel lo cumple un servicio de systemd de la cuenta.
- **Actualizaciones automáticas.** Cada 6 horas, Faro revisa si hay una versión nueva firmada en los
  Releases de GitHub. Si la hay, la instala cuando no hay una reserva en curso y se reinicia solo. Funciona
  en Windows y con el AppImage de Linux; los `.deb` y `.rpm` pedirían contraseña de administrador, así que
  esos los actualiza TI.

## Instalación (con TI/OTIC)

### Una sola vez: firma de las actualizaciones

Faro solo instala actualizaciones firmadas con la clave del laboratorio, así nadie puede colar una versión
falsa. En un computador con Node instalado, dentro de `ladme/faro/`:

```bash
npx tauri signer generate -w ~/.tauri/faro.key
```

Pide una contraseña y crea dos archivos: `faro.key` (privada) y `faro.key.pub` (pública). En GitHub, vaya
a Settings → Secrets and variables → Actions:

- En **Secrets**, cree `TAURI_SIGNING_PRIVATE_KEY` con el contenido de `faro.key`, y
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` con la contraseña.
- En **Variables**, cree `FARO_UPDATER_PUBKEY` con el contenido de `faro.key.pub`.

Guarde `faro.key` y su contraseña en un lugar seguro del laboratorio. Sin ella no se pueden publicar
actualizaciones para los Faro ya instalados, y habría que reinstalarlos.

### Pasos

1. **Base de datos:** ejecute `0006_faro.sql` y `0007_faro_uso_clase_chat.sql` en Supabase.
2. **Variables** (Settings → Secrets and variables → Actions → **Variables**):
   - `FARO_SUPABASE_URL` y `FARO_SUPABASE_KEY`: la URL y la clave **pública** de la PWA (nunca la secreta).
   - `FARO_PWA_URL`: la dirección de la PWA, para los QR.
   - `FARO_UPDATER_PUBKEY`: ver arriba.
3. **Publicar una versión:** cree la etiqueta `faro-v0.2.0` (igual a la versión de
   `src-tauri/tauri.conf.json`):
   ```bash
   git tag faro-v0.2.0 && git push origin faro-v0.2.0
   ```
   GitHub genera los instaladores y los publica en **Releases** con `latest.json`. Las versiones
   siguientes se instalan solas en todos los Faro. Para una prueba sin publicar, use Actions → Faro →
   Run workflow y descargue los artefactos.
4. **Instalar en cada PC** con los archivos de la release. Basta copiar a una memoria USB el instalador y
   el script, y antes generar en Administración → Faro → **Vincular** el código de cada equipo:
   - **Windows 10/11.** Con la sesión de «estudiantes» abierta, en la carpeta de la memoria:
     ```powershell
     powershell -ExecutionPolicy Bypass -File instalar-windows.ps1 -Codigo ABCD-EFGH
     ```
     Instala en silencio solo para esa cuenta, sin permisos de administrador, y deja el código para que
     Faro se vincule solo. Faro queda en el inicio de sesión de esa cuenta.
   - **Linux con AppImage** (recomendado: se actualiza solo):
     ```bash
     bash instalar-linux.sh ABCD-EFGH
     ```
     Sin sudo. Crea el servicio `ladme-faro` de la cuenta, que lo abre al iniciar sesión y lo reabre si
     lo cierran.
   - **Linux con paquete** (lo hace TI; se actualiza a mano):
     - Ubuntu/Debian: `sudo apt install ./faro-*.deb`
     - Fedora: `sudo dnf install ./faro-*.rpm`
5. **Fases:** deje la sala en **Observar** una o dos semanas y mire el uso real y el «uso sin reserva» en
   la pestaña Faro. Luego pase a **Avisar**, y finalmente a **Bloquear**.

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

- **Cerrar Faro a la fuerza.** El vigía lo vuelve a abrir y deja registro, pero alguien decidido puede
  terminar los dos procesos a la vez (por ejemplo, con «Finalizar árbol de procesos»).
  - Faro impide Alt+F4 sobre el bloqueo y registra el intento.
  - Si el proceso muere, el panel muestra el equipo «sin señal».
  - Para impedirlo de verdad hace falta una fase 3b con TI: un servicio de Windows (o de systemd en
    Linux) que corra como sistema y vuelva a abrir Faro si lo cierran, o una directiva que bloquee el
    Administrador de tareas para esa cuenta.
- **Linux con Wayland.** Fedora y Ubuntu 22.04+ usan Wayland por defecto, y en Wayland una app no puede
  fijar su ventana arriba ni quedarse siempre encima. Por eso Faro arranca en modo XWayland y lee la
  inactividad desde GNOME.
  - En escritorios que no son GNOME (KDE, XFCE con Wayland) no puede saber si el PC está en uso, así que
    el «uso sin reserva» no se registra ahí.
  - Si algo se ve mal, la sesión «en Xorg» de la pantalla de inicio es lo más fiable.
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
