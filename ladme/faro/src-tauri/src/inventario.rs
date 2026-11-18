//! Inventario y salud del equipo: procesador, memoria, disco, MAC (para encenderlo por la
//! red), sistema operativo y los programas de una lista conocida (R, Python, SPSS…).
//! Faro lo envía unas veces al día; el software se copia a la PWA para filtrar al reservar.

use serde_json::{json, Value};
use sysinfo::{CpuRefreshKind, Disks, MemoryRefreshKind, Networks, RefreshKind, System};

/// Medidor del uso del procesador (necesita dos lecturas separadas en el tiempo).
pub struct Medidor {
    sys: System,
}

impl Medidor {
    pub fn new() -> Self {
        let sys = System::new_with_specifics(RefreshKind::nothing().with_cpu(CpuRefreshKind::nothing().with_cpu_usage()));
        Medidor { sys }
    }

    /// Porcentaje de uso del procesador desde la lectura anterior.
    pub fn cpu_pct(&mut self) -> u32 {
        self.sys.refresh_cpu_usage();
        self.sys.global_cpu_usage().round().clamp(0.0, 100.0) as u32
    }
}

const GB: f64 = 1024.0 * 1024.0 * 1024.0;

fn redondear(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

pub fn recolectar() -> Value {
    let mut sys = System::new_with_specifics(
        RefreshKind::nothing().with_cpu(CpuRefreshKind::everything()).with_memory(MemoryRefreshKind::everything()),
    );
    sys.refresh_memory();
    let cpu = sys.cpus().first().map(|c| c.brand().trim().to_string()).filter(|s| !s.is_empty());

    // Disco principal: el que contiene el sistema (C:\ o /).
    let discos = Disks::new_with_refreshed_list();
    let principal = discos
        .list()
        .iter()
        .find(|d| {
            let m = d.mount_point().to_string_lossy();
            m == "/" || m.eq_ignore_ascii_case("C:\\")
        })
        .or_else(|| discos.list().iter().max_by_key(|d| d.total_space()));

    // MAC de la tarjeta de red con tráfico (la que sirve para Wake-on-LAN).
    let redes = Networks::new_with_refreshed_list();
    let mac = redes
        .iter()
        .filter(|(nombre, _)| !nombre.starts_with("lo") && !nombre.to_lowercase().contains("loopback"))
        .filter(|(_, d)| !d.mac_address().is_unspecified())
        .max_by_key(|(_, d)| d.total_received() + d.total_transmitted())
        .map(|(_, d)| d.mac_address().to_string());

    let so_tipo = if cfg!(windows) { "Windows" } else if cfg!(target_os = "linux") { "Linux" } else { "Otro" };
    json!({
        "cpu": cpu,
        "nucleos": sys.physical_core_count(),
        "ram_gb": redondear(sys.total_memory() as f64 / GB),
        "disco_gb": principal.map(|d| redondear(d.total_space() as f64 / GB)),
        "disco_libre_gb": principal.map(|d| redondear(d.available_space() as f64 / GB)),
        "mac": mac,
        "so_tipo": so_tipo,
        "so_version": System::long_os_version(),
        "arranque_h": System::uptime() / 3600,
        "software": software(),
    })
}

/// Programas que interesan al laboratorio: (nombre visible, coincidencias en Windows, ejecutables en Linux).
const CONOCIDOS: &[(&str, &[&str], &[&str])] = &[
    ("R", &["R for Windows"], &["R", "Rscript"]),
    ("RStudio", &["RStudio"], &["rstudio"]),
    ("Python", &["Python 3", "Python 2"], &["python3"]),
    ("Anaconda", &["Anaconda", "Miniconda"], &["conda"]),
    ("Jupyter", &["Jupyter"], &["jupyter", "jupyter-lab"]),
    ("Visual Studio Code", &["Microsoft Visual Studio Code"], &["code", "codium"]),
    ("PyCharm", &["PyCharm"], &["pycharm", "pycharm-community"]),
    ("MATLAB", &["MATLAB"], &["matlab"]),
    ("GNU Octave", &["GNU Octave", "Octave"], &["octave"]),
    ("Julia", &["Julia"], &["julia"]),
    ("SPSS", &["IBM SPSS"], &["spss", "stats"]),
    ("Stata", &["Stata"], &["stata", "xstata"]),
    ("SAS", &["SAS 9", "SAS Studio"], &["sas"]),
    ("Minitab", &["Minitab"], &[]),
    ("Weka", &["Weka"], &["weka"]),
    ("Orange", &["Orange"], &["orange-canvas"]),
    ("QGIS", &["QGIS"], &["qgis"]),
    ("ArcGIS", &["ArcGIS"], &[]),
    ("Power BI", &["Microsoft Power BI"], &[]),
    ("Tableau", &["Tableau"], &[]),
    ("Microsoft Office", &["Microsoft Office", "Microsoft 365"], &[]),
    ("LibreOffice", &["LibreOffice"], &["libreoffice", "soffice"]),
    ("LaTeX", &["MiKTeX", "TeX Live"], &["pdflatex", "xelatex"]),
    ("Git", &["Git version", "Git"], &["git"]),
    ("Docker", &["Docker Desktop"], &["docker"]),
    ("GeoGebra", &["GeoGebra"], &["geogebra"]),
];

#[cfg(windows)]
fn software() -> Vec<String> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY};
    use winreg::RegKey;
    let mut nombres: Vec<String> = Vec::new();
    let ruta = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";
    for (raiz, vista) in [
        (HKEY_LOCAL_MACHINE, KEY_WOW64_64KEY),
        (HKEY_LOCAL_MACHINE, KEY_WOW64_32KEY),
        (HKEY_CURRENT_USER, 0),
    ] {
        let Ok(clave) = RegKey::predef(raiz).open_subkey_with_flags(ruta, KEY_READ | vista) else { continue };
        for sub in clave.enum_keys().flatten() {
            if let Ok(k) = clave.open_subkey_with_flags(&sub, KEY_READ | vista) {
                if let Ok(n) = k.get_value::<String, _>("DisplayName") {
                    nombres.push(n);
                }
            }
        }
    }
    let mut v: Vec<String> = CONOCIDOS
        .iter()
        .filter(|(_, win, _)| win.iter().any(|p| nombres.iter().any(|n| n.starts_with(p) || n.contains(&format!(" {p}")))))
        .map(|(nombre, _, _)| nombre.to_string())
        .collect();
    v.dedup();
    v
}

#[cfg(not(windows))]
fn software() -> Vec<String> {
    let carpetas: Vec<std::path::PathBuf> = ["/usr/bin", "/usr/local/bin", "/bin", "/snap/bin", "/var/lib/flatpak/exports/bin"]
        .iter()
        .map(std::path::PathBuf::from)
        .chain(dirs::home_dir().map(|h| h.join(".local/bin")))
        .chain(dirs::home_dir().map(|h| h.join(".local/share/flatpak/exports/bin")))
        .chain(dirs::home_dir().map(|h| h.join("anaconda3/bin")))
        .chain(dirs::home_dir().map(|h| h.join("miniconda3/bin")))
        .collect();
    let existe = |exe: &str| carpetas.iter().any(|c| c.join(exe).exists())
        || std::path::Path::new("/opt").read_dir().map(|it| it.flatten().any(|d| d.path().join("bin").join(exe).exists())).unwrap_or(false);
    // Flatpak usa identificadores (org.qgis.qgis, com.visualstudio.code…): se busca por la última parte.
    let flatpak: Vec<String> = ["/var/lib/flatpak/exports/bin"]
        .iter()
        .filter_map(|c| std::fs::read_dir(c).ok())
        .flat_map(|it| it.flatten().map(|d| d.file_name().to_string_lossy().to_lowercase()))
        .collect();
    CONOCIDOS
        .iter()
        .filter(|(_, _, lin)| lin.iter().any(|exe| existe(exe) || flatpak.iter().any(|f| f.ends_with(&format!(".{}", exe.to_lowercase())))))
        .map(|(nombre, _, _)| nombre.to_string())
        .collect()
}

#[cfg(test)]
mod pruebas {
    #[test]
    fn recolecta_algo_razonable() {
        let v = super::recolectar();
        assert!(v["ram_gb"].as_f64().unwrap_or(0.0) > 0.0);
        assert!(v["software"].is_array());
        let mut m = super::Medidor::new();
        std::thread::sleep(std::time::Duration::from_millis(250));
        assert!(m.cpu_pct() <= 100);
    }
}
