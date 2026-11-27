# Faro · el agente de los computadores de LADME

Faro corre en cada PC de la sala. Del borde superior de la pantalla cuelga una **isla** negra, como el
notch de un celular, con tres tamaños:

- **Mini.** Después de unos segundos sin usarla se encoge a un notch pequeño: el punto de estado y la hora
  o la cuenta regresiva. Así casi no ocupa espacio.
- **Compacta.** Al pasar el mouse muestra el equipo, el estado y la cuenta regresiva. También aparece sola
  unos segundos cuando algo cambia (empieza la reserva, se libera el equipo…).
- **Abierta.** Al hacer clic se abre un panel con la cuenta regresiva y las acciones del momento. Desde
  Faro 0.6, extender, liberar, reportar una falla y pedir ayuda se hacen **en la isla, sin el celular**
  (ver «Acciones en la isla»). Se cierra sola al sacar el mouse.

Para que no estorbe:
- **Solo la isla recibe clics.** Alrededor, aunque la ventana sea más grande, los clics pasan a la app de
  abajo. La ventana tiene tamaño fijo y las transiciones son animación pura, con efecto resorte.
- **Se puede arrastrar.** Al soltarla a la izquierda, al centro o a la derecha del borde superior, se
  ajusta a ese lugar y cada PC lo recuerda.
- **Pantalla completa.** Mientras una app está a pantalla completa (presentación, video, juego) la isla se
  oculta. Solo vuelve para los avisos urgentes.

### Acciones en la isla (Faro 0.6)

| Acción | Cómo | Reglas |
| --- | --- | --- |
| Extender | +30 min o +1 hora con un toque | Las mismas de la app (extensiones, horas máximas, otra reserva después). Solo si la llegada se confirmó en ese equipo. |
| Liberar | «¿Terminaste?» y confirmar | Solo si la llegada se confirmó en ese equipo: así nadie libera la reserva de otra persona. |
| Reportar falla | Elegir el tipo de problema | Se adjunta un diagnóstico del equipo (memoria, disco, red, reloj). Con el equipo libre el reporte queda «desde el equipo». Máx. 3 por hora. |
| Pedir ayuda | Un toque | Avisa al chat del personal con el código del equipo (una vez cada 10 min). |

Quien tiene la reserva recibe un aviso de todo lo que se haga desde el equipo sobre ella. Solo quedan dos QR,
cada uno con su propósito: **Reservar este equipo** (`/reservar?equipo=UNAL-05`, con la cuenta de la persona) y
el **código de llegada**. Con el equipo libre, la isla y la pantalla de bloqueo invitan además a **acercar el
celular a la tarjeta NFC** de la base del monitor (política `faro_nfc`). Los enlaces de versiones anteriores
(`/equipo/UNAL-05?accion=extender`…) siguen funcionando en la PWA.

En los últimos minutos de la reserva la isla muestra **«Antes de irte»** (guardar el trabajo, cerrar las cuentas
personales, liberar). Si Faro pierde la conexión o el reloj del PC está desfasado, lo explica en la isla.

### Línea de comandos `faro`

El mismo Faro responde en una terminal. Al arrancar deja el comando disponible sin permisos de administrador:
en Linux un enlace `~/.local/bin/faro` al AppImage; en Windows un `faro.cmd` en
`%LOCALAPPDATA%\Microsoft\WindowsApps` (ya está en el PATH; funciona en cmd y PowerShell).

La línea de comandos está en inglés (con [clap](https://docs.rs/clap)); `faro --help` y `faro <comando> --help`
muestran la ayuda. Los nombres en español de Faro 0.6 siguen funcionando como alias ocultos.

| Comando | Qué hace |
| --- | --- |
| `faro status` | Vínculo, si Faro está abierto, último contacto con el servidor, modo de la sala, reserva actual y suspensión. |
| `faro doctor` | Revisa vínculo, Faro abierto, servidor y su demora, reloj, carpeta, arranque automático, sesión gráfica, herramientas del inventario (Linux), disco y versión publicada. Cada problema trae cómo arreglarlo. Sale con 1 si hay problemas. `--fix` arregla lo que se puede sin permisos (abrir Faro, arranque automático, reiniciar si no habla con el servidor); `-v` muestra rutas y detalles. |
| `faro logs` | Registro de Faro (`faro.log` en su carpeta). `-n 100`, `-f` para seguirlo, `--since 30m`/`2h`/`1d`, `--level warn|error`. |
| `faro inventory` | Lo que Faro envía: procesador, RAM, gráfica, cámaras, disco, sistema, cuenta y programas. |
| `faro version` | Versión, canal (stable o testing) e instalación. `faro -V` solo da el número. |
| `faro link ABCD-EFGH` | Vincula el equipo con un código del panel (si Faro está cerrado, se usa al abrirlo). |
| `faro update`, `faro unlink` | Piden la **clave de emergencia** (sin mostrarla) y se la pasan al Faro abierto, que la verifica como en la pantalla (5 intentos y una pausa). |
| `faro unlock` | Igual, y acepta también una **clave temporal** del personal (hasta que vence). |
| `faro start` | Abre Faro si está cerrado (en Linux, con el servicio `ladme-faro`). |
| `faro restart` | Reinicia Faro. |
| `faro stop` | Detiene Faro **y su vigía** hasta `faro start` o el próximo inicio de sesión. Pide clave del personal (sin Faro no hay bloqueo). |

Todos aceptan `--json` (para scripts o para pegar en un reporte) y `--no-color` (también `NO_COLOR`). Códigos
de salida: 0 bien, 1 hay un problema, 2 uso incorrecto. Una palabra mal escrita (`faro stauts`) da la sugerencia
de clap en vez de abrir Faro. Lo que solo lee funciona aunque Faro esté cerrado; las órdenes con clave
necesitan a Faro abierto.

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
- **Registro de llegada en fases** (política `llegada_modo`, en Administración → Políticas):

  | Valor | Quién registra la llegada |
  | --- | --- |
  | `0` | La misma persona, desde su pase o la ficha del equipo en la PWA. |
  | `1` | Solo el personal (escaneando el pase). **Recomendado al empezar.** |
  | `2` | La persona escanea con su celular el **QR de llegada** de la isla. |

  El QR de llegada es seguro aunque lo escanee otra persona: el servidor solo registra la llegada de
  **quien tiene la reserva vigente de ese equipo** y ha iniciado sesión con su cuenta; a cualquier otra
  persona le responde «No tiene una reserva vigente en UNAL-05». El código cambia cada 30 s (vale cerca de
  un minuto) y va atado al equipo, así que una foto del QR no sirve después ni en otro PC. El personal
  siempre puede registrar la llegada.

  Aparte, la **llegada automática** (política `faro_llegada_automatica`) registra la llegada cuando Faro
  detecta uso del equipo durante la reserva. Déjela en `0` mientras la sala esté en las fases 1 y 2.
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
- **Órdenes remotas** (Administración → Faro). Para toda la sala o un equipo:
  - **Anuncio**: un mensaje en la isla y en la pantalla de bloqueo hasta la hora que elija.
  - **Encender** (Wake-on-LAN): otro Faro encendido de la sala envía el «paquete mágico» a las MAC
    conocidas, por cada tarjeta de red y tres veces (desde 0.5.1). En cada PC hace falta: Wake-on-LAN
    activo en el BIOS/UEFI; en Windows, «Inicio rápido» desactivado (Opciones de energía) y, en las
    propiedades de la tarjeta de red → Administración de energía, «Permitir que este dispositivo
    reactive el equipo» y «Solo permitir un paquete mágico». Funciona en la misma red local; si el
    PC se desconectó de la corriente, el primer encendido debe ser manual.
  - **Llegada** (0.5.2): con el modo QR, la isla muestra hasta qué hora se puede registrar la llegada
    antes de que cuente como inasistencia. Desde la 0.5.3, «Confirmar asistencia» muestra un código de
    6 dígitos que cambia cada 30 s (y un QR con el mismo código) para escribir en la app.
  - **Apagar**: avisa y apaga en 1 minuto. Nunca apaga un equipo con una reserva en curso.
  - **Actualizar Faro** y **Reiniciar Faro**.
  - **Desinstalar** (solo administradores): Faro se quita solo y desvincula el equipo.

  Cada orden se entrega una sola vez y su resultado queda en «Actividad reciente».
- **Quitar Faro desde el propio PC.** En la isla, «Personal» (al pie) pide la **clave de emergencia** del
  laboratorio y ofrece «Desbloquear 2 h» o «Quitar Faro de este PC». Faro nunca pide ni guarda la
  contraseña de administrador del sistema. Con instalación `.deb` o `.rpm` no puede quitarse solo (lo hace
  TI con `dnf`/`apt`).
- **Inventario y salud.** Al minuto de arrancar y cada hora (o al pulsar «Actualizar datos»), Faro envía
  procesador (núcleos e hilos), RAM, tarjeta gráfica y su memoria, cámaras conectadas, disco, MAC, sistema y
  distribución, la cuenta en uso y los programas de análisis instalados (R, RStudio, Python, MATLAB, SPSS, QGIS…).
  Con eso se llena la ficha técnica de cada equipo (migración 0023). Nunca abre la cámara: solo lee su nombre.
  En Linux la gráfica se lee con `nvidia-smi` (NVIDIA), `lspci` (paquete `pciutils`) y `/sys` (memoria de AMD). La PWA permite
  filtrar la disponibilidad por programa y avisa al chat del personal si a un disco le queda menos del 10 %.
- **Sesión limpia** (política `faro_sesion_limpia`). Al terminar una reserva, la isla ofrece borrar los
  archivos guardados en Descargas y Escritorio durante esa reserva, con doble confirmación. No toca
  accesos directos ni lo que ya estaba antes.
- **Proceso desatendido verificado.** Si el PC lleva más de 30 min sin que nadie lo toque y el procesador
  está casi en reposo (menos del 5 %), se avisa al titular de que quizá su proceso ya terminó.
- **Mapa de la sala** (`/sala`, público y sin datos personales). Con `?kiosco=1` se convierte en una
  pantalla para un televisor en la entrada. La posición de cada equipo se ajusta en Equipos (columna/fila).
- **Lista de espera.** Si no hay equipos libres, la persona se anota y recibe un aviso al liberarse uno.
- **Liberación por no-show** (política `liberar_no_show_min`, `0` = apagada). Si se activa, libera la
  reserva cuando pasan esos minutos sin llegada y sin que Faro vea uso del PC.
- **Reporte mensual.** El día 1, Apps Script envía al personal un resumen del mes anterior.
- **Canal de pruebas.** En el detalle de un equipo puede marcarse «pruebas»: recibe las versiones
  publicadas con etiquetas `faro-pruebas-vX.Y.Z` antes que el resto de la sala.
- **Uso compartido (0.5).** Si la reserva en curso es compartida, la isla muestra «Uso compartido»
  con los programas que no se deben cerrar, deja usar el equipo y no se apaga ni ofrece borrar
  archivos mientras dure.
- **Programas usados (0.5).** En cada latido, Faro informa qué programas de la lista conocida están
  abiertos (solo el nombre del programa). El laboratorio ve horas por programa en Estadísticas.
- **Salud del disco (0.5, Windows).** El estado que da el sistema (`Get-PhysicalDisk`); si hay
  advertencias, avisa al chat del personal.
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
  inactividad desde GNOME. Con apps nativas de Wayland, la detección de pantalla completa no siempre
  funciona.
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
