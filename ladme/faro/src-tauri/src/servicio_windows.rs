//! Lo propio de Windows del servicio del sistema: el administrador de servicios (SCM), la tubería con
//! nombre y la interfaz abierta en la sesión de quien usa el equipo.
//!
//! El servicio corre como LocalSystem en la sesión 0, donde no se ven ventanas: la isla y las
//! pantallas las abre en la sesión de la consola con el token de esa cuenta (CreateProcessAsUser).

use super::Flujo;
use crate::registro;
use std::ffi::c_void;
use std::os::windows::io::AsRawHandle;
use std::path::{Path, PathBuf};
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicPtr, Ordering};
use std::sync::OnceLock;
use std::time::Duration;
use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeServer, ServerOptions};
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::Security::Authorization::{ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1};
use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;
use windows_sys::Win32::System::Environment::{CreateEnvironmentBlock, DestroyEnvironmentBlock};
use windows_sys::Win32::System::Pipes::{GetNamedPipeClientProcessId, GetNamedPipeServerProcessId};
use windows_sys::Win32::System::RemoteDesktop::{
    ProcessIdToSessionId, WTSFreeMemory, WTSGetActiveConsoleSessionId, WTSQuerySessionInformationW, WTSQueryUserToken, WTSUserName,
    WTS_CURRENT_SERVER_HANDLE,
};
use windows_sys::Win32::System::Services::{
    RegisterServiceCtrlHandlerExW, SetServiceStatus, StartServiceCtrlDispatcherW, SERVICE_ACCEPT_SHUTDOWN, SERVICE_ACCEPT_STOP,
    SERVICE_CONTROL_SHUTDOWN, SERVICE_CONTROL_STOP, SERVICE_RUNNING, SERVICE_STATUS, SERVICE_STATUS_CURRENT_STATE, SERVICE_STOPPED,
    SERVICE_TABLE_ENTRYW, SERVICE_WIN32_OWN_PROCESS,
};
use windows_sys::Win32::System::Threading::{CreateProcessAsUserW, CREATE_UNICODE_ENVIRONMENT, PROCESS_INFORMATION, STARTUPINFOW};

const NOMBRE: &str = "ladme-faro";
const TUBERIA: &str = r"\\.\pipe\ladme-faro";
pub const COMO_INICIAR: &str = "as administrator: sc start ladme-faro";
/// Aquí nadie más abre la interfaz: el guardián la abre apenas hay una sesión.
pub const ESPERA_GUARDIAN: Duration = Duration::from_secs(5);
/// Claves de latest.json: el ejecutable firmado (el instalador NSIS es para Faro por cuenta).
pub const PLATAFORMAS: &[&str] = &["windows-x86_64-exe"];

fn ancho(t: &str) -> Vec<u16> {
    t.encode_utf16().chain(std::iter::once(0)).collect()
}

pub fn carpeta() -> PathBuf {
    PathBuf::from(std::env::var("ProgramData").unwrap_or_else(|_| r"C:\ProgramData".into())).join("LADME Faro")
}

/// Donde el instalador deja el programa (el servicio lo reemplaza al actualizarse).
pub fn programa() -> PathBuf {
    PathBuf::from(std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into())).join("LADME Faro").join("ladme-faro.exe")
}

/// ¿Está registrado el servicio en este equipo?
pub fn instalado() -> bool {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    winreg::RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(format!(r"SYSTEM\CurrentControlSet\Services\{NOMBRE}")).is_ok()
}

// ------------------------------------------------------------------ administrador de servicios

static ESTADO: AtomicPtr<c_void> = AtomicPtr::new(null_mut());

fn informar(estado: SERVICE_STATUS_CURRENT_STATE) {
    let h = ESTADO.load(Ordering::SeqCst);
    if h.is_null() {
        return;
    }
    let s = SERVICE_STATUS {
        dwServiceType: SERVICE_WIN32_OWN_PROCESS,
        dwCurrentState: estado,
        dwControlsAccepted: if estado == SERVICE_RUNNING { SERVICE_ACCEPT_STOP | SERVICE_ACCEPT_SHUTDOWN } else { 0 },
        dwWin32ExitCode: 0,
        dwServiceSpecificExitCode: 0,
        dwCheckPoint: 0,
        dwWaitHint: 0,
    };
    unsafe { SetServiceStatus(h, &s) };
}

unsafe extern "system" fn control(codigo: u32, _: u32, _: *mut c_void, _: *mut c_void) -> u32 {
    if codigo == SERVICE_CONTROL_STOP || codigo == SERVICE_CONTROL_SHUTDOWN {
        registro::info("El servicio de Faro se detiene (Windows)");
        informar(SERVICE_STOPPED);
        std::process::exit(0);
    }
    0
}

unsafe extern "system" fn principal(_: u32, _: *mut windows_sys::core::PWSTR) {
    let nombre = ancho(NOMBRE);
    let h = RegisterServiceCtrlHandlerExW(nombre.as_ptr(), Some(control), null());
    ESTADO.store(h, Ordering::SeqCst);
    informar(SERVICE_RUNNING);
    super::correr();
    informar(SERVICE_STOPPED);
}

pub fn entrada() {
    let mut nombre = ancho(NOMBRE);
    let tabla = [
        SERVICE_TABLE_ENTRYW { lpServiceName: nombre.as_mut_ptr(), lpServiceProc: Some(principal) },
        SERVICE_TABLE_ENTRYW { lpServiceName: null_mut(), lpServiceProc: None },
    ];
    // Fuera del administrador de servicios (desde una consola, para probar) corre directo.
    if unsafe { StartServiceCtrlDispatcherW(tabla.as_ptr()) } == 0 {
        super::correr();
    }
}

/// Sale sin informar «detenido»: el administrador lo toma como una caída y lo vuelve a abrir según las
/// acciones de recuperación que deja el instalador (`sc failure … restart`).
pub fn reiniciar() -> ! {
    std::process::exit(1)
}

pub fn detener() {
    informar(SERVICE_STOPPED);
    std::process::exit(0);
}

/// Solo el sistema y los administradores leen la carpeta (por defecto, ProgramData la leen todos).
pub fn proteger_carpeta(carpeta: &Path) {
    use std::os::windows::process::CommandExt;
    let _ = std::process::Command::new("icacls")
        .arg(carpeta)
        .args(["/inheritance:r", "/grant:r", "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F", "/T", "/Q"])
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .status();
}

/// El programa de antes de la última actualización (renombrado mientras corría).
pub fn limpiar_anterior() {
    let _ = std::fs::remove_file(programa().with_extension("exe.viejo"));
}

// ------------------------------------------------------------------ tubería

/// Sistema y administradores: todo; cuentas autenticadas: leer y escribir (conectarse).
fn descriptor() -> *mut c_void {
    static SD: OnceLock<usize> = OnceLock::new();
    *SD.get_or_init(|| {
        let sddl = ancho("D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGW;;;AU)");
        let mut sd: *mut c_void = null_mut();
        if unsafe { ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.as_ptr(), SDDL_REVISION_1, &mut sd, null_mut()) } == 0 {
            registro::error("No se pudo armar el permiso de la tubería de Faro");
        }
        sd as usize
    }) as *mut c_void
}

fn crear(primera: bool) -> std::io::Result<NamedPipeServer> {
    let mut sa = SECURITY_ATTRIBUTES { nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32, lpSecurityDescriptor: descriptor(), bInheritHandle: 0 };
    unsafe {
        ServerOptions::new()
            .first_pipe_instance(primera)
            .reject_remote_clients(true)
            .create_with_security_attributes_raw(TUBERIA, &mut sa as *mut SECURITY_ATTRIBUTES as *mut c_void)
    }
}

fn sesion_de(pid: u32) -> Option<u32> {
    let mut sesion = 0u32;
    (unsafe { ProcessIdToSessionId(pid, &mut sesion) } != 0).then_some(sesion)
}

pub async fn escuchar(atender: impl Fn(Box<dyn Flujo>, u32) + Send + 'static) -> std::io::Result<()> {
    // La primera instancia asegura que la tubería es del servicio (si otro programa la tomó, se reintenta).
    let mut servidor = loop {
        match crear(true) {
            Ok(s) => break s,
            Err(e) => {
                registro::error(format!("No se pudo crear la tubería {TUBERIA}: {e}"));
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        }
    };
    loop {
        let conectado = servidor.connect().await;
        let anterior = std::mem::replace(&mut servidor, crear(false)?);
        if conectado.is_err() {
            continue;
        }
        let mut pid = 0u32;
        let ok = unsafe { GetNamedPipeClientProcessId(anterior.as_raw_handle() as HANDLE, &mut pid) } != 0;
        let sesion = if ok { sesion_de(pid).unwrap_or(u32::MAX) } else { u32::MAX };
        atender(Box::new(anterior), sesion);
    }
}

/// Del otro lado tiene que estar el servicio (sesión 0, donde ninguna cuenta abre programas): así nadie
/// puede hacerse pasar por Faro para leer las claves que se escriben en la isla.
fn es_el_servicio(h: HANDLE) -> bool {
    let mut pid = 0u32;
    let ok = unsafe { GetNamedPipeServerProcessId(h, &mut pid) } != 0;
    ok && sesion_de(pid) == Some(0)
}

pub async fn conectar() -> std::io::Result<Box<dyn Flujo>> {
    for _ in 0..40 {
        match ClientOptions::new().open(TUBERIA) {
            Ok(c) => {
                if !es_el_servicio(c.as_raw_handle() as HANDLE) {
                    return Err(std::io::Error::other("la tubería de Faro no es del servicio"));
                }
                return Ok(Box::new(c));
            }
            Err(e) if e.raw_os_error() == Some(231) => tokio::time::sleep(Duration::from_millis(50)).await, // ERROR_PIPE_BUSY
            Err(e) => return Err(e),
        }
    }
    Err(std::io::Error::other("la tubería de Faro está ocupada"))
}

pub fn conectar_bloqueante() -> std::io::Result<(Box<dyn std::io::Read + Send>, Box<dyn std::io::Write + Send>)> {
    for _ in 0..40 {
        match std::fs::OpenOptions::new().read(true).write(true).open(TUBERIA) {
            Ok(f) => {
                if !es_el_servicio(f.as_raw_handle() as HANDLE) {
                    return Err(std::io::Error::other("la tubería de Faro no es del servicio"));
                }
                return Ok((Box::new(f.try_clone()?), Box::new(f)));
            }
            Err(e) if e.raw_os_error() == Some(231) => std::thread::sleep(Duration::from_millis(50)),
            Err(e) => return Err(e),
        }
    }
    Err(std::io::Error::other("la tubería de Faro está ocupada"))
}

// ------------------------------------------------------------------ la interfaz en la sesión de la consola

/// Cuenta y número de la sesión de la consola, si alguien inició sesión.
pub fn sesion_activa() -> Option<(String, u32)> {
    let sesion = unsafe { WTSGetActiveConsoleSessionId() };
    if sesion == u32::MAX {
        return None;
    }
    let mut buf: windows_sys::core::PWSTR = null_mut();
    let mut bytes = 0u32;
    if unsafe { WTSQuerySessionInformationW(WTS_CURRENT_SERVER_HANDLE, sesion, WTSUserName, &mut buf, &mut bytes) } == 0 || buf.is_null() {
        return None;
    }
    let largo = (bytes as usize / 2).saturating_sub(1);
    let usuario = String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(buf, largo) }).trim_end_matches('\0').to_string();
    unsafe { WTSFreeMemory(buf as *mut c_void) };
    (!usuario.is_empty()).then_some((usuario, sesion))
}

/// Abre Faro (la interfaz) en esa sesión, con la cuenta que la usa.
pub fn abrir_interfaz(_usuario: &str, sesion: u32) -> Result<(), String> {
    let exe = programa();
    unsafe {
        let mut token: HANDLE = null_mut();
        if WTSQueryUserToken(sesion, &mut token) == 0 {
            return Err(format!("WTSQueryUserToken: {}", std::io::Error::last_os_error()));
        }
        let mut entorno: *mut c_void = null_mut();
        if CreateEnvironmentBlock(&mut entorno, token, 0) == 0 {
            entorno = null_mut();
        }
        let app = ancho(&exe.to_string_lossy());
        let mut linea = ancho(&format!("\"{}\"", exe.display()));
        let dir = ancho(&exe.parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default());
        let mut escritorio = ancho(r"winsta0\default");
        let mut si: STARTUPINFOW = std::mem::zeroed();
        si.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
        si.lpDesktop = escritorio.as_mut_ptr();
        let mut pi: PROCESS_INFORMATION = std::mem::zeroed();
        let ok = CreateProcessAsUserW(token, app.as_ptr(), linea.as_mut_ptr(), null(), null(), 0, CREATE_UNICODE_ENVIRONMENT, entorno, dir.as_ptr(), &si, &mut pi);
        let error = std::io::Error::last_os_error();
        if !entorno.is_null() {
            DestroyEnvironmentBlock(entorno);
        }
        CloseHandle(token);
        if ok == 0 {
            return Err(format!("CreateProcessAsUser: {error}"));
        }
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
    }
    Ok(())
}

// ------------------------------------------------------------------ actualización

/// Windows no deja sobrescribir un programa abierto, pero sí renombrarlo: el actual pasa a «.viejo»
/// (se borra en el próximo arranque) y el nuevo ocupa su lugar.
pub fn instalar(datos: &[u8]) -> Result<(), String> {
    let destino = programa();
    let nuevo = destino.with_extension("exe.nuevo");
    let viejo = destino.with_extension("exe.viejo");
    std::fs::write(&nuevo, datos).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&viejo);
    if destino.exists() {
        std::fs::rename(&destino, &viejo).map_err(|e| format!("no se pudo apartar el programa actual: {e}"))?;
    }
    if let Err(e) = std::fs::rename(&nuevo, &destino) {
        let _ = std::fs::rename(&viejo, &destino);
        return Err(e.to_string());
    }
    registro::info(format!("Programa reemplazado en {}", destino.display()));
    Ok(())
}
