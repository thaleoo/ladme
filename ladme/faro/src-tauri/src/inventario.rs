//! Inventario y salud del equipo: procesador, memoria, tarjeta de video, cámaras, disco, MAC (para
//! encenderlo por la red), sistema operativo y distribución, y los programas de una lista conocida
//! (R, Python, SPSS…). Faro lo envía al arrancar y cada hora; la base de datos copia lo que sirve para
//! filtrar al reservar (programas, RAM, gráfica, procesador, cámara) a la ficha del equipo.
//! Nunca abre la cámara ni lee archivos de la persona: solo nombres de dispositivos y programas.

use serde_json::{json, Value};
use sysinfo::{CpuRefreshKind, Disks, MemoryRefreshKind, Networks, ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System, UpdateKind};

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
        "hilos": sys.cpus().len(),
        "gpus": graficas(),
        "camaras": camaras(),
        "so_nombre": nombre_sistema(),
        "cuenta": cuenta(),
        "ram_gb": redondear(sys.total_memory() as f64 / GB),
        "disco_gb": principal.map(|d| redondear(d.total_space() as f64 / GB)),
        "disco_libre_gb": principal.map(|d| redondear(d.available_space() as f64 / GB)),
        "mac": mac,
        "so_tipo": so_tipo,
        "so_version": System::long_os_version(),
        "arranque_h": System::uptime() / 3600,
        "software": software(),
        "disco_salud": salud_disco(),
    })
}

// ------------------------------------------------------------------ tarjeta de video

/// ¿Tarjeta dedicada (con memoria propia) o integrada en el procesador? Por el nombre: los fabricantes
/// usan marcas distintas para cada tipo.
pub fn es_dedicada(nombre: &str) -> bool {
    let n = nombre.to_lowercase();
    ["nvidia", "geforce", "quadro", "rtx", "tesla", "radeon rx", "radeon pro", "firepro", "arc(tm) a", "arc a"]
        .iter()
        .any(|m| n.contains(m))
}

/// Adaptadores que no son una tarjeta real (pantallas remotas, virtuales o el controlador genérico).
fn es_virtual(nombre: &str) -> bool {
    let n = nombre.to_lowercase();
    ["microsoft basic", "remote", "virtual", "parsec", "citrix", "hyper-v", "mirror", "vmware", "virtualbox", "llvmpipe"]
        .iter()
        .any(|m| n.contains(m))
}

fn grafica(nombre: String, vram_bytes: Option<u64>) -> Value {
    let vram = vram_bytes.filter(|b| *b >= 256 * 1024 * 1024).map(|b| redondear(b as f64 / GB));
    json!({ "nombre": nombre, "vram_gb": vram, "dedicada": es_dedicada(&nombre) })
}

/// Windows: el registro de la clase «Display» tiene el nombre del controlador y la memoria real de la
/// tarjeta (WMI la corta en 4 GB). Sin PowerShell: es rápido.
#[cfg(windows)]
fn graficas() -> Vec<Value> {
    use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ};
    use winreg::RegKey;
    let ruta = r"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}";
    let Ok(clase) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey_with_flags(ruta, KEY_READ) else { return vec![] };
    let mut vistas: Vec<String> = Vec::new();
    let mut v = Vec::new();
    for sub in clase.enum_keys().flatten().filter(|k| k.chars().all(|c| c.is_ascii_digit())) {
        let Ok(k) = clase.open_subkey_with_flags(&sub, KEY_READ) else { continue };
        let Ok(nombre) = k.get_value::<String, _>("DriverDesc") else { continue };
        let nombre = nombre.trim().to_string();
        if nombre.is_empty() || es_virtual(&nombre) || vistas.contains(&nombre) {
            continue;
        }
        let bytes = |valor: &str| {
            k.get_raw_value(valor).ok().and_then(|r| match r.bytes.len() {
                8 => Some(u64::from_le_bytes(r.bytes[..8].try_into().ok()?)),
                4 => Some(u32::from_le_bytes(r.bytes[..4].try_into().ok()?) as u64),
                _ => None,
            })
        };
        let vram = bytes("HardwareInformation.qwMemorySize").or_else(|| bytes("HardwareInformation.MemorySize"));
        vistas.push(nombre.clone());
        v.push(grafica(nombre, vram));
    }
    v
}

/// Linux: `nvidia-smi` da nombre y memoria de las NVIDIA; `lspci` nombra las demás; las AMD publican su
/// memoria en /sys. Si falta alguna herramienta se informa lo que se pueda.
#[cfg(not(windows))]
fn graficas() -> Vec<Value> {
    let mut v: Vec<Value> = Vec::new();
    let mut hay_nvidia = false;
    if let Some(texto) = salida("nvidia-smi", &["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]) {
        for linea in texto.lines() {
            let mut partes = linea.split(',').map(str::trim);
            let (Some(nombre), mib) = (partes.next(), partes.next().and_then(|m| m.parse::<u64>().ok())) else { continue };
            if nombre.is_empty() {
                continue;
            }
            hay_nvidia = true;
            v.push(grafica(nombre.to_string(), mib.map(|m| m * 1024 * 1024)));
        }
    }
    let vram_amd = std::fs::read_dir("/sys/class/drm")
        .ok()
        .into_iter()
        .flat_map(|it| it.flatten())
        .filter_map(|d| std::fs::read_to_string(d.path().join("device/mem_info_vram_total")).ok())
        .filter_map(|t| t.trim().parse::<u64>().ok())
        .max();
    if let Some(texto) = salida("lspci", &["-mm"]) {
        for (clase, fabricante, modelo) in texto.lines().filter_map(linea_lspci) {
            if !(clase.contains("VGA") || clase.contains("3D") || clase.contains("Display")) {
                continue;
            }
            let nvidia = fabricante.to_lowercase().contains("nvidia");
            if nvidia && hay_nvidia {
                continue; // ya vino con nombre y memoria de nvidia-smi
            }
            let nombre = nombre_lspci(&fabricante, &modelo);
            if es_virtual(&nombre) {
                continue;
            }
            let amd = fabricante.contains("AMD") || fabricante.contains("ATI");
            v.push(grafica(nombre, if amd { vram_amd } else { None }));
        }
    }
    v
}

/// Una línea de `lspci -mm`: `00:02.0 "VGA compatible controller" "Intel Corporation" "AlderLake-S GT1" …`.
#[cfg(not(windows))]
fn linea_lspci(linea: &str) -> Option<(String, String, String)> {
    let campos: Vec<&str> = linea.split('"').collect();
    // [ranura, clase, " ", fabricante, " ", modelo, …]
    Some((campos.get(1)?.to_string(), campos.get(3)?.to_string(), campos.get(5)?.to_string()))
}

/// «NVIDIA Corporation» + «GA106GL [RTX A2000 12GB]» → «NVIDIA RTX A2000 12GB».
#[cfg(not(windows))]
fn nombre_lspci(fabricante: &str, modelo: &str) -> String {
    let marca = match fabricante {
        f if f.contains("NVIDIA") => "NVIDIA",
        f if f.contains("Intel") => "Intel",
        f if f.contains("AMD") || f.contains("ATI") => "AMD",
        f => f.split_whitespace().next().unwrap_or(f),
    };
    let comercial = match (modelo.rfind('['), modelo.rfind(']')) {
        (Some(a), Some(b)) if b > a => &modelo[a + 1..b],
        _ => modelo,
    };
    format!("{marca} {}", comercial.trim())
}

#[cfg(not(windows))]
fn salida(programa: &str, args: &[&str]) -> Option<String> {
    let s = std::process::Command::new(programa).args(args).output().ok()?;
    s.status.success().then(|| String::from_utf8_lossy(&s.stdout).into_owned())
}

// ------------------------------------------------------------------ cámaras

/// Nombres de las cámaras conectadas. No se abre ningún dispositivo.
#[cfg(windows)]
fn camaras() -> Vec<String> {
    use std::os::windows::process::CommandExt;
    let Ok(s) = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-PnpDevice -PresentOnly -Status OK -Class Camera,Image -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FriendlyName",
        ])
        .creation_flags(0x0800_0000)
        .output()
    else {
        return vec![];
    };
    let mut v: Vec<String> = String::from_utf8_lossy(&s.stdout)
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty() && !l.to_lowercase().contains("scan"))
        .collect();
    v.sort();
    v.dedup();
    v
}

/// Linux: cada cámara aparece en /sys/class/video4linux (una cámara puede tener varios nodos; se toma
/// el principal, índice 0).
#[cfg(not(windows))]
fn camaras() -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir("/sys/class/video4linux")
        .ok()
        .into_iter()
        .flat_map(|it| it.flatten())
        .filter(|d| std::fs::read_to_string(d.path().join("index")).map(|i| i.trim() == "0").unwrap_or(true))
        .filter_map(|d| std::fs::read_to_string(d.path().join("name")).ok())
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .collect();
    v.sort();
    v.dedup();
    v
}

// ------------------------------------------------------------------ sistema y cuenta

/// Nombre del sistema con su versión: «Ubuntu 24.04.1 LTS», «Windows 11 Pro».
pub fn nombre_sistema() -> Option<String> {
    #[cfg(not(windows))]
    if let Ok(t) = std::fs::read_to_string("/etc/os-release") {
        if let Some(n) = t.lines().find_map(|l| l.strip_prefix("PRETTY_NAME=")) {
            let n = n.trim().trim_matches('"').trim();
            if !n.is_empty() {
                return Some(n.to_string());
            }
        }
    }
    System::long_os_version()
}

/// Cuenta del sistema en la que corre Faro (p. ej. «estudiantes»): dice qué perfil está en uso.
fn cuenta() -> Option<String> {
    std::env::var("USERNAME").or_else(|_| std::env::var("USER")).ok().map(|c| c.trim().to_string()).filter(|c| !c.is_empty())
}

/// Procesos que delatan cada programa (nombre del ejecutable, sin «.exe», en minúsculas).
const PROCESOS: &[(&str, &[&str])] = &[
    ("R", &["r", "rgui", "rterm", "rsession", "rscript"]),
    ("RStudio", &["rstudio"]),
    ("Python", &["python", "python3", "pythonw", "ipython"]),
    ("Jupyter", &["jupyter-lab", "jupyter-notebook", "jupyter"]),
    ("Visual Studio Code", &["code", "codium"]),
    ("PyCharm", &["pycharm64", "pycharm"]),
    ("MATLAB", &["matlab"]),
    ("GNU Octave", &["octave", "octave-gui"]),
    ("Julia", &["julia"]),
    ("SPSS", &["stats", "spss"]),
    ("Stata", &["stata", "statamp-64", "statase-64", "statabe-64", "xstata"]),
    ("SAS", &["sas"]),
    ("Minitab", &["mtb", "minitab"]),
    ("Orange", &["orange-canvas"]),
    ("QGIS", &["qgis", "qgis-bin", "qgis-ltr-bin"]),
    ("ArcGIS", &["arcgispro"]),
    ("Power BI", &["pbidesktop"]),
    ("Tableau", &["tableau"]),
    ("Microsoft Office", &["excel", "winword", "powerpnt"]),
    ("LibreOffice", &["soffice.bin", "soffice"]),
    ("LaTeX", &["texstudio", "texmaker", "pdflatex", "xelatex"]),
    ("GeoGebra", &["geogebra"]),
];

/// Lee qué programas de la lista están abiertos ahora. Solo nombres de programas: nunca archivos,
/// ventanas ni lo que la persona hace en ellos.
pub struct Programas {
    sys: System,
}

impl Programas {
    pub fn new() -> Self {
        Programas { sys: System::new() }
    }

    pub fn activos(&mut self) -> Vec<String> {
        self.sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_exe(UpdateKind::Never));
        let mut nombres: Vec<String> = self
            .sys
            .processes()
            .values()
            .map(|p| p.name().to_string_lossy().to_lowercase().trim_end_matches(".exe").to_string())
            .collect();
        nombres.sort();
        nombres.dedup();
        PROCESOS
            .iter()
            .filter(|(_, exes)| exes.iter().any(|e| nombres.binary_search(&e.to_string()).is_ok()))
            .map(|(n, _)| n.to_string())
            .collect()
    }
}

/// Salud del disco según el sistema: «ok», «advertencia», «falla» o nada si no se puede saber.
#[cfg(windows)]
fn salud_disco() -> Option<&'static str> {
    use std::os::windows::process::CommandExt;
    let salida = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", "(Get-PhysicalDisk | Select-Object -ExpandProperty HealthStatus) -join ','"])
        .creation_flags(0x0800_0000)
        .output()
        .ok()?;
    let texto = String::from_utf8_lossy(&salida.stdout).to_lowercase();
    if texto.contains("unhealthy") {
        Some("falla")
    } else if texto.contains("warning") {
        Some("advertencia")
    } else if texto.contains("healthy") {
        Some("ok")
    } else {
        None
    }
}

/// En Linux leer SMART necesita permisos de administrador; solo se usa si el sistema lo expone.
#[cfg(not(windows))]
fn salud_disco() -> Option<&'static str> {
    None
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
    fn programas_activos_no_falla() {
        let mut p = super::Programas::new();
        let v = p.activos();
        assert!(v.iter().all(|n| super::PROCESOS.iter().any(|(x, _)| x == n)));
    }

    #[test]
    fn tarjetas_dedicadas_e_integradas() {
        use super::es_dedicada;
        for n in ["NVIDIA RTX A2000 12GB", "NVIDIA GeForce GTX 1650", "AMD Radeon RX 6600", "Quadro P620", "Intel(R) Arc(TM) A380"] {
            assert!(es_dedicada(n), "{n}");
        }
        for n in ["Intel(R) UHD Graphics 770", "Intel AlderLake-S GT1", "AMD Radeon(TM) Graphics", "Intel(R) Iris(R) Xe Graphics"] {
            assert!(!es_dedicada(n), "{n}");
        }
        assert!(super::es_virtual("Microsoft Basic Display Adapter"));
    }

    #[cfg(not(windows))]
    #[test]
    fn lee_lspci() {
        let l = r#"01:00.0 "VGA compatible controller" "NVIDIA Corporation" "GA106GL [RTX A2000 12GB]" -ra1 "Dell" "Device 151d""#;
        let (clase, fab, modelo) = super::linea_lspci(l).unwrap();
        assert_eq!(clase, "VGA compatible controller");
        assert_eq!(super::nombre_lspci(&fab, &modelo), "NVIDIA RTX A2000 12GB");
        let i = r#"00:02.0 "VGA compatible controller" "Intel Corporation" "AlderLake-S GT1" -r0c "Dell" "Device 0a9f""#;
        let (_, fab, modelo) = super::linea_lspci(i).unwrap();
        assert_eq!(super::nombre_lspci(&fab, &modelo), "Intel AlderLake-S GT1");
    }

    #[test]
    fn recolecta_algo_razonable() {
        let v = super::recolectar();
        assert!(v["ram_gb"].as_f64().unwrap_or(0.0) > 0.0);
        assert!(v["software"].is_array());
        assert!(v["gpus"].is_array() && v["camaras"].is_array());
        assert!(v["hilos"].as_u64().unwrap_or(0) >= 1);
        let mut m = super::Medidor::new();
        std::thread::sleep(std::time::Duration::from_millis(250));
        assert!(m.cpu_pct() <= 100);
    }
}
