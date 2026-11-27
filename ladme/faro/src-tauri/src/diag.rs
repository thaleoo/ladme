//! Diagnóstico rápido del equipo: lo que se adjunta a un reporte de falla hecho desde la isla y lo que
//! muestra `faro status`. Solo cifras del equipo (memoria, disco, procesador, red, sesión), nada de la persona.

use serde_json::{json, Value};
use sysinfo::{Disks, MemoryRefreshKind, RefreshKind, System};

const GB: f64 = 1024.0 * 1024.0 * 1024.0;

fn r1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

/// Tipo de sesión gráfica en Linux («wayland», «x11»); en otros sistemas, nada.
pub fn sesion_grafica() -> Option<String> {
    if cfg!(target_os = "linux") {
        std::env::var("XDG_SESSION_TYPE").ok().filter(|s| !s.is_empty())
    } else {
        None
    }
}

/// `en_linea`: si el último contacto con el servidor fue hace menos de 90 s; `sin_red_seg`: hace cuánto.
pub fn rapido(en_linea: bool, sin_red_seg: Option<u64>, cpu_pct: Option<u32>, desfase_ms: i64) -> Value {
    let mut sys = System::new_with_specifics(RefreshKind::nothing().with_memory(MemoryRefreshKind::everything()));
    sys.refresh_memory();
    let discos = Disks::new_with_refreshed_list();
    let principal = discos
        .list()
        .iter()
        .find(|d| {
            let m = d.mount_point().to_string_lossy();
            m == "/" || m.eq_ignore_ascii_case("C:\\")
        })
        .or_else(|| discos.list().iter().max_by_key(|d| d.total_space()));
    json!({
        "version": env!("CARGO_PKG_VERSION"),
        "en_linea": en_linea,
        "sin_red_seg": sin_red_seg,
        "desfase_reloj_seg": desfase_ms / 1000,
        "cpu_pct": cpu_pct,
        "ram_total_gb": r1(sys.total_memory() as f64 / GB),
        "ram_libre_gb": r1(sys.available_memory() as f64 / GB),
        "disco_libre_gb": principal.map(|d| r1(d.available_space() as f64 / GB)),
        "disco_total_gb": principal.map(|d| r1(d.total_space() as f64 / GB)),
        "arranque_h": System::uptime() / 3600,
        "sesion": sesion_grafica(),
    })
}

#[cfg(test)]
mod pruebas {
    #[test]
    fn diagnostico_razonable() {
        let v = super::rapido(true, Some(3), Some(12), 1500);
        assert!(v["ram_total_gb"].as_f64().unwrap() > 0.0);
        assert_eq!(v["desfase_reloj_seg"], 1);
        assert_eq!(v["version"], env!("CARGO_PKG_VERSION"));
    }
}
