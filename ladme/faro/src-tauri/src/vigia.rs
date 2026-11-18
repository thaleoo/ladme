//! El vigía: un segundo proceso, muy liviano, que vuelve a abrir Faro si alguien lo
//! cierra a la fuerza (Administrador de tareas, `kill`). Faro, a su vez, vuelve a
//! lanzar al vigía si este desaparece. No reemplaza un servicio del sistema instalado
//! por TI, pero obliga a cerrar los dos casi al mismo tiempo y deja registro.
//!
//! - faro.pid y vigia.pid, en la carpeta de Faro, dicen quién está vivo.
//! - vigia-pausa (marca de tiempo) detiene al vigía un rato: lo usa la actualización.
//! - Si el equipo se desvincula (faro.json sin token), el vigía se retira.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const ARG: &str = "--vigia";
pub const REABIERTO: &str = "--reabierto";

fn ahora() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

pub fn escribir_pid(carpeta: &Path, nombre: &str) {
    let _ = std::fs::create_dir_all(carpeta);
    let _ = std::fs::write(carpeta.join(nombre), std::process::id().to_string());
}

fn leer_pid(carpeta: &Path, nombre: &str) -> Option<u32> {
    std::fs::read_to_string(carpeta.join(nombre)).ok()?.trim().parse().ok()
}

/// Detiene al vigía durante unos segundos (p. ej. mientras se instala una actualización).
pub fn pausar(carpeta: &Path, segundos: u64) {
    let _ = std::fs::write(carpeta.join("vigia-pausa"), (ahora() + segundos).to_string());
}

pub fn quitar_pausa(carpeta: &Path) {
    let _ = std::fs::remove_file(carpeta.join("vigia-pausa"));
}

fn en_pausa(carpeta: &Path) -> bool {
    std::fs::read_to_string(carpeta.join("vigia-pausa"))
        .ok()
        .and_then(|t| t.trim().parse::<u64>().ok())
        .map(|hasta| hasta > ahora())
        .unwrap_or(false)
}

fn vinculado(carpeta: &Path) -> bool {
    std::fs::read_to_string(carpeta.join("faro.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .map(|v| v["token"].is_string())
        .unwrap_or(false)
}

#[cfg(windows)]
pub fn vivo(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
    use windows_sys::Win32::System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    // SAFETY: llamadas de solo consulta; el identificador se cierra siempre.
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return false;
        }
        let mut codigo: u32 = 0;
        let ok = GetExitCodeProcess(h, &mut codigo);
        CloseHandle(h);
        ok != 0 && codigo == STILL_ACTIVE as u32
    }
}

#[cfg(not(windows))]
pub fn vivo(pid: u32) -> bool {
    std::fs::read_to_string(format!("/proc/{pid}/stat"))
        .map(|s| !s.contains(") Z ")) // un proceso «zombi» ya terminó
        .unwrap_or(false)
}

/// Lo que hay que ejecutar para abrir Faro de nuevo. En un AppImage el binario vive en un
/// montaje temporal que desaparece al cerrarse, así que se usa el archivo .AppImage.
fn ejecutable() -> Option<PathBuf> {
    std::env::var_os("APPIMAGE").map(PathBuf::from).or_else(|| std::env::current_exe().ok())
}

fn lanzar(args: &[&std::ffi::OsStr]) {
    let Some(exe) = ejecutable() else { return };
    let mut c = Command::new(exe);
    c.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        c.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    let _ = c.spawn();
}

/// Lanza al vigía si no hay uno vivo. Lo llama Faro cada pocos segundos.
pub fn asegurar(carpeta: &Path) {
    if leer_pid(carpeta, "vigia.pid").map(vivo) == Some(true) {
        return;
    }
    lanzar(&[ARG.as_ref(), carpeta.as_os_str()]);
}

/// El ciclo del vigía. No usa Tauri: es solo este bucle.
pub fn correr(carpeta: PathBuf) -> ! {
    escribir_pid(&carpeta, "vigia.pid");
    let yo = std::process::id();
    loop {
        std::thread::sleep(Duration::from_secs(1));
        // Otro vigía tomó el relevo, o el equipo ya no está vinculado: este se retira.
        if leer_pid(&carpeta, "vigia.pid") != Some(yo) || !vinculado(&carpeta) {
            std::process::exit(0);
        }
        if en_pausa(&carpeta) || leer_pid(&carpeta, "faro.pid").map(vivo) == Some(true) {
            continue;
        }
        // Faro no está: se espera un momento por si se está reiniciando a propósito.
        std::thread::sleep(Duration::from_millis(1500));
        if en_pausa(&carpeta) || leer_pid(&carpeta, "faro.pid").map(vivo) == Some(true) {
            continue;
        }
        lanzar(&[REABIERTO.as_ref()]);
        std::thread::sleep(Duration::from_secs(8));
    }
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn pausa_y_pids() {
        let dir = std::env::temp_dir().join(format!("faro-vigia-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        escribir_pid(&dir, "faro.pid");
        assert_eq!(leer_pid(&dir, "faro.pid"), Some(std::process::id()));
        assert!(vivo(std::process::id()));
        assert!(!vivo(u32::MAX - 7));
        assert!(!en_pausa(&dir));
        pausar(&dir, 60);
        assert!(en_pausa(&dir));
        quitar_pausa(&dir);
        assert!(!en_pausa(&dir));
        assert!(!vinculado(&dir));
        std::fs::write(dir.join("faro.json"), r#"{"token":"x"}"#).unwrap();
        assert!(vinculado(&dir));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
