//! Línea de comandos: `faro estado`, `faro doctor`, `faro logs`, `faro inventario`, `faro version`,
//! `faro vincular`, y con la clave de emergencia `faro actualizar`, `faro desbloquear`, `faro desvincular`.
//!
//! Es el mismo programa de Faro: `main` llama aquí cuando el primer argumento es un comando, antes de abrir
//! ninguna ventana. Lo que solo lee funciona aunque Faro esté cerrado. Lo que cambia algo se le pide al Faro
//! que está abierto con un archivo en su carpeta (`orden-cli.json`); Faro verifica la clave como en la isla
//! (cinco intentos y una pausa) y contesta en `respuesta-cli.json`.

use crate::api::{Api, Fallo};
use crate::config::{self, Config, Copia};
use crate::registro::{self, Nivel};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{IsTerminal, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const COMANDOS: &[&str] = &[
    "estado", "doctor", "logs", "inventario", "version", "vincular", "actualizar", "desbloquear", "desvincular", "ayuda",
    "--ayuda", "--help", "-h", "--version",
];

pub fn es_comando(a: &str) -> bool {
    COMANDOS.contains(&a)
}

/// La carpeta de Faro de esta cuenta (la misma que usa la app: configuración del sistema + identificador).
pub fn carpeta() -> PathBuf {
    dirs::config_dir().unwrap_or_else(std::env::temp_dir).join("co.edu.unal.ladme.faro")
}

// ------------------------------------------------------------------ órdenes al Faro abierto

#[derive(Debug, Serialize, Deserialize)]
pub struct OrdenCli {
    pub id: String,
    pub orden: String,
    #[serde(default)]
    pub clave: Option<String>,
    #[serde(default)]
    pub codigo: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RespuestaCli {
    pub id: String,
    pub ok: bool,
    pub texto: String,
}

pub fn archivo_orden(c: &Path) -> PathBuf {
    c.join("orden-cli.json")
}
pub fn archivo_respuesta(c: &Path) -> PathBuf {
    c.join("respuesta-cli.json")
}

/// Escribe un archivo que solo puede leer esta cuenta (lleva la clave unos segundos).
fn escribir_privado(ruta: &Path, contenido: &[u8]) -> std::io::Result<()> {
    let mut o = std::fs::OpenOptions::new();
    o.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600);
    }
    o.open(ruta)?.write_all(contenido)
}

pub fn responder(c: &Path, id: &str, ok: bool, texto: &str) {
    let r = RespuestaCli { id: id.to_string(), ok, texto: texto.to_string() };
    let _ = escribir_privado(&archivo_respuesta(c), &serde_json::to_vec(&r).unwrap_or_default());
}

fn faro_abierto(c: &Path) -> bool {
    std::fs::read_to_string(c.join("faro.pid"))
        .ok()
        .and_then(|t| t.trim().parse::<u32>().ok())
        .map(crate::vigia::vivo)
        .unwrap_or(false)
}

fn enviar_orden(c: &Path, orden: &str, clave: Option<String>, codigo: Option<String>, espera: Duration) -> Result<String, String> {
    let id = format!("{}-{}", std::process::id(), chrono::Utc::now().timestamp_millis());
    let _ = std::fs::remove_file(archivo_respuesta(c));
    let o = OrdenCli { id: id.clone(), orden: orden.into(), clave, codigo };
    escribir_privado(&archivo_orden(c), &serde_json::to_vec(&o).unwrap_or_default()).map_err(|e| format!("No se pudo escribir la orden: {e}"))?;
    let hasta = std::time::Instant::now() + espera;
    while std::time::Instant::now() < hasta {
        std::thread::sleep(Duration::from_millis(300));
        if let Some(r) = std::fs::read_to_string(archivo_respuesta(c)).ok().and_then(|t| serde_json::from_str::<RespuestaCli>(&t).ok()) {
            if r.id == id {
                let _ = std::fs::remove_file(archivo_respuesta(c));
                return if r.ok { Ok(r.texto) } else { Err(r.texto) };
            }
        }
    }
    let _ = std::fs::remove_file(archivo_orden(c));
    Err("Faro no respondió a tiempo. ¿Está abierto? Revise «faro estado».".into())
}

// ------------------------------------------------------------------ salida

struct Salida {
    json: bool,
    color: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Marca {
    Ok,
    Aviso,
    Falla,
}

impl Salida {
    fn pintar(&self, m: Marca) -> String {
        let (s, c) = match m {
            Marca::Ok => ("✔", "32"),
            Marca::Aviso => ("!", "33"),
            Marca::Falla => ("✖", "31"),
        };
        if self.color { format!("\x1b[{c}m{s}\x1b[0m") } else { s.to_string() }
    }
    fn tenue(&self, t: &str) -> String {
        if self.color { format!("\x1b[2m{t}\x1b[0m") } else { t.to_string() }
    }
}

fn hace(d: chrono::DateTime<chrono::Utc>) -> String {
    let s = (chrono::Utc::now() - d).num_seconds().max(0);
    match s {
        0..=59 => format!("hace {s} s"),
        60..=3599 => format!("hace {} min", s / 60),
        3600..=172_799 => format!("hace {} h", s / 3600),
        _ => format!("hace {} días", s / 86_400),
    }
}

fn hora_local(d: chrono::DateTime<chrono::Utc>) -> String {
    let l = d.with_timezone(&chrono::Local);
    if l.date_naive() == chrono::Local::now().date_naive() { l.format("%H:%M").to_string() } else { l.format("%d/%m %H:%M").to_string() }
}

// ------------------------------------------------------------------ entrada

/// Ejecuta un comando y devuelve el código de salida (0 bien, 1 problema, 2 uso incorrecto).
pub fn ejecutar(args: &[String]) -> i32 {
    #[cfg(windows)]
    conectar_consola();
    let cmd = args.first().map(String::as_str).unwrap_or("ayuda");
    let resto: Vec<&str> = args.iter().skip(1).map(String::as_str).collect();
    let json = resto.contains(&"--json");
    let s = Salida { json, color: !json && !resto.contains(&"--sin-color") && std::io::stdout().is_terminal() };
    let c = carpeta();
    match cmd {
        "estado" => estado(&s, &c),
        "doctor" => doctor(&s, &c),
        "logs" => logs(&s, &c, &resto),
        "inventario" => inventario(&s),
        "version" | "--version" => version(&s, &c),
        "vincular" => vincular(&c, &resto),
        "actualizar" | "desbloquear" | "desvincular" => con_clave(&c, cmd),
        _ => {
            ayuda();
            if matches!(cmd, "ayuda" | "--ayuda" | "--help" | "-h") { 0 } else { 2 }
        }
    }
}

fn ayuda() {
    println!(
        "Faro {v} · LADME

Uso: faro <comando> [opciones]

  estado        Vínculo, reserva actual y último contacto con el servidor
  doctor        Revisa el equipo y dice qué arreglar
  logs          Registro de Faro  (-n 100, -f para seguirlo, --desde 1h, --nivel aviso|error)
  inventario    Lo que Faro envía: hardware, gráfica, cámaras y programas
  version       Versión, canal e instalación
  vincular CÓDIGO   Vincula el equipo con el código de LADME → Administración → Faro
  actualizar    Instala ya la última versión          (pide la clave de emergencia)
  desbloquear   Desbloqueo del personal por {h} horas   (clave de emergencia o temporal)
  desvincular   Quita el vínculo de este equipo        (pide la clave de emergencia)

Opciones: --json  --sin-color  --ayuda",
        v = env!("CARGO_PKG_VERSION"),
        h = 2
    );
}

// ------------------------------------------------------------------ estado

fn estado(s: &Salida, c: &Path) -> i32 {
    let cfg = config::cargar(c);
    let copia = config::cargar_copia(c);
    let abierto = faro_abierto(c);
    let r = copia.remoto.as_ref();
    let equipo = cfg.equipo.clone().or_else(|| r.map(|r| r.equipo.codigo.clone()));
    let ahora_srv = chrono::Utc::now() + chrono::Duration::milliseconds(copia.desfase_ms);
    let ocupacion = r.and_then(|r| r.actual.as_ref()).filter(|o| o.fin > ahora_srv);
    let situacion = match ocupacion {
        Some(o) if o.tipo == "bloqueo" => format!("Bloqueado por el laboratorio hasta las {}", hora_local(o.fin)),
        Some(o) => format!("Reservado hasta las {}{}", hora_local(o.fin), if o.llegada { "" } else { " (llegada sin confirmar)" }),
        None => "Libre".to_string(),
    };
    if s.json {
        let v = json!({
            "version": env!("CARGO_PKG_VERSION"),
            "vinculado": cfg.token.is_some(),
            "equipo": equipo,
            "faro_abierto": abierto,
            "ultimo_contacto": copia.recibido_en,
            "modo": r.map(|r| r.modo),
            "situacion": situacion,
            "anuncio": r.and_then(|r| r.anuncio.as_ref()).map(|a| a.texto.clone()),
            "desfase_reloj_seg": copia.desfase_ms / 1000,
        });
        println!("{}", serde_json::to_string_pretty(&v).unwrap_or_default());
        return 0;
    }
    println!("Faro {} · {}", env!("CARGO_PKG_VERSION"), equipo.as_deref().unwrap_or("sin equipo"));
    let linea = |m: Marca, t: String| println!("{} {t}", s.pintar(m));
    linea(if cfg.token.is_some() { Marca::Ok } else { Marca::Falla }, if cfg.token.is_some() { "Vinculado".into() } else { "No está vinculado (use «faro vincular CÓDIGO»)".into() });
    linea(if abierto { Marca::Ok } else { Marca::Falla }, if abierto { "Faro está abierto".into() } else { "Faro no está abierto".into() });
    match copia.recibido_en {
        Some(d) => {
            let viejo = (chrono::Utc::now() - d).num_seconds() > 120;
            linea(if viejo { Marca::Aviso } else { Marca::Ok }, format!("Último contacto con el servidor: {}", hace(d)));
        }
        None => linea(Marca::Aviso, "Aún no ha hablado con el servidor".into()),
    }
    if let Some(r) = r {
        println!("  Modo de la sala: {}", match r.modo {
            crate::decision::Modo::Observar => "observar",
            crate::decision::Modo::Avisar => "avisar",
            crate::decision::Modo::Bloquear => "bloquear",
        });
        println!("  Ahora: {situacion}");
        if let Some(a) = &r.anuncio {
            println!("  Anuncio: «{}»", a.texto);
        }
    }
    if copia.desfase_ms.abs() > 120_000 {
        linea(Marca::Aviso, format!("El reloj del equipo está desfasado {} min (Faro usa la hora del servidor)", copia.desfase_ms.abs() / 60_000));
    }
    if cfg.token.is_some() && abierto { 0 } else { 1 }
}

// ------------------------------------------------------------------ doctor

#[derive(Serialize)]
struct Chequeo {
    estado: Marca,
    texto: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    arreglo: Option<String>,
}

fn chequeo(estado: Marca, texto: impl Into<String>, arreglo: Option<&str>) -> Chequeo {
    Chequeo { estado, texto: texto.into(), arreglo: arreglo.map(String::from) }
}

fn en_path(programa: &str) -> bool {
    std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).any(|d| d.join(programa).is_file() || d.join(format!("{programa}.exe")).is_file()))
        .unwrap_or(false)
}

fn version_mayor(a: &str, b: &str) -> bool {
    let n = |v: &str| v.trim_start_matches('v').split('.').map(|x| x.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
    n(a) > n(b)
}

fn doctor(s: &Salida, c: &Path) -> i32 {
    let cfg = config::cargar(c);
    let copia = config::cargar_copia(c);
    let mut v: Vec<Chequeo> = Vec::new();
    let sistema = crate::inventario::nombre_sistema().unwrap_or_default();

    if !cfg.completa() {
        v.push(chequeo(Marca::Falla, "Falta la dirección del servidor en la configuración", Some("Reinstale Faro con el instalador del laboratorio")));
    }
    match &cfg.equipo {
        Some(e) if cfg.token.is_some() => v.push(chequeo(Marca::Ok, format!("Vinculado como {e}"), None)),
        _ => v.push(chequeo(Marca::Falla, "Este equipo no está vinculado", Some("Genere un código en LADME → Administración → Faro → Vincular y ejecute: faro vincular ABCD-EFGH"))),
    }
    if faro_abierto(c) {
        v.push(chequeo(Marca::Ok, "Faro está abierto", None));
    } else if cfg!(target_os = "linux") {
        v.push(chequeo(Marca::Falla, "Faro no está abierto", Some("systemctl --user start ladme-faro   (o cierre sesión y vuelva a entrar)")));
    } else {
        v.push(chequeo(Marca::Falla, "Faro no está abierto", Some("Ábralo desde el menú Inicio («LADME Faro») o cierre sesión y vuelva a entrar")));
    }

    // Servidor y reloj (una sola consulta que no cuenta como latido).
    if cfg.completa() {
        match tauri::async_runtime::block_on(Api::new().ping(&cfg)) {
            Ok((ms, hora)) => {
                if ms > 1500 {
                    v.push(chequeo(Marca::Aviso, format!("El servidor de LADME responde, pero lento ({ms} ms)"), Some("Revise la red; si persiste, avise al personal")));
                } else {
                    v.push(chequeo(Marca::Ok, format!("El servidor de LADME responde ({ms} ms)"), None));
                }
                if let Some(h) = hora {
                    let dif = (chrono::Utc::now() - h).num_seconds();
                    let texto = format!("El reloj del equipo va {} {} {}", if dif.abs() >= 120 { dif.abs() / 60 } else { dif.abs() },
                                        if dif.abs() >= 120 { "min" } else { "s" }, if dif > 0 { "adelantado" } else { "atrasado" });
                    let arreglo = if cfg!(windows) { "Configuración → Hora e idioma → Establecer la hora automáticamente" } else { "sudo timedatectl set-ntp true" };
                    if dif.abs() >= 120 {
                        v.push(chequeo(Marca::Falla, texto, Some(arreglo)));
                    } else if dif.abs() >= 30 {
                        v.push(chequeo(Marca::Aviso, texto, Some(arreglo)));
                    } else {
                        v.push(chequeo(Marca::Ok, "El reloj del equipo está en hora", None));
                    }
                }
            }
            Err(Fallo::Red(_)) => v.push(chequeo(Marca::Falla, "No hay conexión con el servidor de LADME", Some("Revise el cable de red o el wifi y que la red de la universidad funcione"))),
            Err(Fallo::Mensaje(m)) => v.push(chequeo(Marca::Falla, m, None)),
            Err(Fallo::NoVinculado) => v.push(chequeo(Marca::Falla, "El servidor no reconoce este equipo", Some("Vincúlelo de nuevo con un código del panel"))),
        }
    }
    if let Some(d) = copia.recibido_en {
        if faro_abierto(c) && (chrono::Utc::now() - d).num_seconds() > 300 {
            v.push(chequeo(Marca::Aviso, format!("Faro no habla con el servidor desde {}", hace(d)), Some("Revise «faro logs --nivel aviso»")));
        }
    }

    // Carpeta de Faro.
    let prueba = c.join(".prueba-doctor");
    match std::fs::create_dir_all(c).and_then(|_| std::fs::write(&prueba, b"ok")) {
        Ok(_) => {
            let _ = std::fs::remove_file(&prueba);
            v.push(chequeo(Marca::Ok, "Faro puede guardar su configuración", None));
        }
        Err(e) => v.push(chequeo(Marca::Falla, format!("Faro no puede escribir en {} ({e})", c.display()), Some("Revise los permisos de esa carpeta"))),
    }

    // Arranque automático.
    let arranca = arranque_automatico();
    match arranca {
        Some(como) => v.push(chequeo(Marca::Ok, format!("Arranca solo ({como})"), None)),
        None => v.push(chequeo(Marca::Aviso, "No arranca solo al iniciar sesión", Some(if cfg!(windows) { "Abra Faro una vez desde el menú Inicio: se agrega solo" } else { "Vuelva a ejecutar instalar-linux.sh" }))),
    }

    // Linux: sesión gráfica y herramientas del inventario.
    if cfg!(target_os = "linux") {
        match crate::diag::sesion_grafica().as_deref() {
            Some("wayland") => v.push(chequeo(Marca::Ok, "Sesión Wayland (Faro usa XWayland para quedar encima)", None)),
            Some(t) => v.push(chequeo(Marca::Ok, format!("Sesión {t}"), None)),
            None => v.push(chequeo(Marca::Aviso, "No se detecta una sesión gráfica", Some("Ejecute doctor desde la sesión de escritorio, no por SSH"))),
        }
        if !en_path("lspci") {
            v.push(chequeo(Marca::Aviso, "lspci no está instalado: Faro no puede leer la tarjeta gráfica", Some("sudo apt install pciutils")));
        } else if std::process::Command::new("lspci").output().map(|o| String::from_utf8_lossy(&o.stdout).contains("NVIDIA")).unwrap_or(false) && !en_path("nvidia-smi") {
            v.push(chequeo(Marca::Aviso, "Hay una tarjeta NVIDIA pero no nvidia-smi: Faro no puede leer su memoria", Some("Instale el controlador de NVIDIA (Software y actualizaciones → Controladores adicionales)")));
        }
    }

    // Disco.
    let d = crate::diag::rapido(false, None, None, 0);
    if let (Some(libre), Some(total)) = (d["disco_libre_gb"].as_f64(), d["disco_total_gb"].as_f64()) {
        let pct = if total > 0.0 { libre * 100.0 / total } else { 100.0 };
        let texto = format!("Disco: {libre:.0} GB libres de {total:.0} GB");
        if pct < 10.0 {
            v.push(chequeo(Marca::Falla, texto, Some("Libere espacio o avise al personal")));
        } else if pct < 20.0 {
            v.push(chequeo(Marca::Aviso, texto, Some("Queda poco espacio")));
        } else {
            v.push(chequeo(Marca::Ok, texto, None));
        }
    }

    // Versión publicada.
    if let Some(url) = option_env!("FARO_UPDATER_URL").filter(|u| !u.is_empty()) {
        let pruebas = copia.remoto.as_ref().and_then(|r| r.canal.as_deref()) == Some("pruebas");
        let url = if pruebas { url.replace("/releases/latest/download/latest.json", "/releases/download/faro-pruebas/latest.json") } else { url.to_string() };
        let ultima = tauri::async_runtime::block_on(async {
            let r = reqwest::Client::builder().timeout(Duration::from_secs(8)).build().ok()?.get(url).send().await.ok()?;
            r.json::<Value>().await.ok()?["version"].as_str().map(String::from)
        });
        match ultima {
            Some(u) if version_mayor(&u, env!("CARGO_PKG_VERSION")) => v.push(chequeo(Marca::Aviso, format!("Hay una versión nueva de Faro ({u})"), Some("Se instala sola cuando nadie usa el equipo, o ejecute «faro actualizar»"))),
            Some(_) => v.push(chequeo(Marca::Ok, format!("Faro está al día ({})", env!("CARGO_PKG_VERSION")), None)),
            None => v.push(chequeo(Marca::Aviso, "No se pudo consultar la última versión publicada", None)),
        }
    }

    let fallas = v.iter().filter(|x| x.estado == Marca::Falla).count();
    let avisos = v.iter().filter(|x| x.estado == Marca::Aviso).count();
    if s.json {
        println!("{}", serde_json::to_string_pretty(&json!({ "chequeos": v, "problemas": fallas, "avisos": avisos })).unwrap_or_default());
    } else {
        println!("Faro {} · {} · {}", env!("CARGO_PKG_VERSION"), cfg.equipo.as_deref().unwrap_or("sin equipo"), sistema);
        for x in &v {
            println!("{} {}", s.pintar(x.estado), x.texto);
            if let Some(a) = &x.arreglo {
                println!("   {} {a}", s.tenue("→"));
            }
        }
        println!(
            "{}",
            match (fallas, avisos) {
                (0, 0) => "Todo en orden.".to_string(),
                (f, a) => format!("{f} {}, {a} {}.", if f == 1 { "problema" } else { "problemas" }, if a == 1 { "aviso" } else { "avisos" }),
            }
        );
    }
    if fallas > 0 { 1 } else { 0 }
}

#[cfg(target_os = "linux")]
fn arranque_automatico() -> Option<String> {
    let enabled = std::process::Command::new("systemctl")
        .args(["--user", "is-enabled", "ladme-faro.service"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim() == "enabled")
        .unwrap_or(false);
    if enabled {
        return Some("servicio ladme-faro".into());
    }
    let autostart = dirs::config_dir()?.join("autostart");
    std::fs::read_dir(autostart)
        .ok()?
        .flatten()
        .any(|d| d.file_name().to_string_lossy().to_lowercase().contains("faro"))
        .then(|| "al iniciar sesión".into())
}

#[cfg(windows)]
fn arranque_automatico() -> Option<String> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};
    use winreg::RegKey;
    let ruta = r"Software\Microsoft\Windows\CurrentVersion\Run";
    for raiz in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        if let Ok(k) = RegKey::predef(raiz).open_subkey_with_flags(ruta, KEY_READ) {
            if k.enum_values().flatten().any(|(n, _)| n.to_lowercase().contains("faro")) {
                return Some("al iniciar sesión".into());
            }
        }
    }
    None
}

#[cfg(not(any(windows, target_os = "linux")))]
fn arranque_automatico() -> Option<String> {
    None
}

// ------------------------------------------------------------------ logs

fn duracion(t: &str) -> Option<chrono::Duration> {
    let (n, u) = t.split_at(t.find(|c: char| !c.is_ascii_digit())?);
    let n: i64 = n.parse().ok()?;
    match u {
        "s" => Some(chrono::Duration::seconds(n)),
        "m" | "min" => Some(chrono::Duration::minutes(n)),
        "h" => Some(chrono::Duration::hours(n)),
        "d" => Some(chrono::Duration::days(n)),
        _ => None,
    }
}

fn opcion<'a>(resto: &[&'a str], nombre: &str) -> Option<&'a str> {
    resto.iter().position(|a| *a == nombre).and_then(|i| resto.get(i + 1).copied())
}

fn imprimir_linea(s: &Salida, l: &registro::Linea) {
    if s.json {
        println!("{}", json!({ "hora": l.hora.to_rfc3339(), "nivel": l.nivel.texto(), "texto": l.texto }));
        return;
    }
    let hoy = chrono::Local::now().date_naive() == l.hora.with_timezone(&chrono::Local).date_naive();
    let hora = l.hora.with_timezone(&chrono::Local).format(if hoy { "%H:%M:%S" } else { "%d/%m %H:%M:%S" }).to_string();
    let marca = match l.nivel {
        Nivel::Info => " ".to_string(),
        Nivel::Aviso => s.pintar(Marca::Aviso),
        Nivel::Error => s.pintar(Marca::Falla),
    };
    println!("{} {marca} {}", s.tenue(&hora), l.texto);
}

fn logs(s: &Salida, c: &Path, resto: &[&str]) -> i32 {
    let n: usize = opcion(resto, "-n").and_then(|x| x.parse().ok()).unwrap_or(40);
    let minimo = opcion(resto, "--nivel").and_then(Nivel::desde).unwrap_or(Nivel::Info);
    let desde = match opcion(resto, "--desde") {
        Some(t) => match duracion(t) {
            Some(d) => Some((chrono::Local::now() - d).fixed_offset()),
            None => {
                eprintln!("No entiendo «--desde {t}». Use por ejemplo 30m, 2h o 1d.");
                return 2;
            }
        },
        None => None,
    };
    let lineas = registro::leer(c, n, desde, minimo);
    if lineas.is_empty() && !resto.contains(&"-f") {
        println!("{}", s.tenue(&format!("El registro está vacío ({}).", registro::ruta(c).display())));
    }
    for l in &lineas {
        imprimir_linea(s, l);
    }
    if !resto.contains(&"-f") {
        return 0;
    }
    // Seguir el registro: se leen las líneas nuevas cada medio segundo (también si el archivo rota).
    let ruta = registro::ruta(c);
    let mut leido = std::fs::metadata(&ruta).map(|m| m.len()).unwrap_or(0);
    loop {
        std::thread::sleep(Duration::from_millis(500));
        let largo = std::fs::metadata(&ruta).map(|m| m.len()).unwrap_or(0);
        if largo < leido {
            leido = 0;
        }
        if largo > leido {
            if let Ok(t) = std::fs::read(&ruta) {
                let nuevo = String::from_utf8_lossy(&t[leido as usize..]).into_owned();
                for l in nuevo.lines().filter_map(registro::separar).filter(|l| l.nivel >= minimo) {
                    imprimir_linea(s, &l);
                }
                leido = largo;
            }
        }
    }
}

// ------------------------------------------------------------------ inventario y versión

fn inventario(s: &Salida) -> i32 {
    let v = crate::inventario::recolectar();
    if s.json {
        println!("{}", serde_json::to_string_pretty(&v).unwrap_or_default());
        return 0;
    }
    let t = |k: &str| v[k].as_str().map(String::from).or_else(|| v[k].as_f64().map(|x| x.to_string())).unwrap_or_else(|| "—".into());
    println!("Procesador   {}  ({} núcleos, {} hilos)", t("cpu"), t("nucleos"), t("hilos"));
    println!("Memoria RAM  {} GB", t("ram_gb"));
    let gpus: Vec<String> = v["gpus"].as_array().into_iter().flatten()
        .map(|g| format!("{}{}", g["nombre"].as_str().unwrap_or("?"), g["vram_gb"].as_f64().map(|x| format!(" ({x} GB)")).unwrap_or_default()))
        .collect();
    println!("Gráfica      {}", if gpus.is_empty() { "—".into() } else { gpus.join(" · ") });
    let cams: Vec<&str> = v["camaras"].as_array().into_iter().flatten().filter_map(|c| c.as_str()).collect();
    println!("Cámaras      {}", if cams.is_empty() { "ninguna".into() } else { cams.join(" · ") });
    println!("Disco        {} GB ({} GB libres)", t("disco_gb"), t("disco_libre_gb"));
    println!("Sistema      {}", t("so_nombre"));
    println!("Cuenta       {}", t("cuenta"));
    let prog: Vec<&str> = v["software"].as_array().into_iter().flatten().filter_map(|c| c.as_str()).collect();
    println!("Programas    {}", if prog.is_empty() { "ninguno de la lista".into() } else { prog.join(", ") });
    0
}

fn version(s: &Salida, c: &Path) -> i32 {
    let copia: Copia = config::cargar_copia(c);
    let canal = copia.remoto.as_ref().and_then(|r| r.canal.clone()).unwrap_or_else(|| "estable".into());
    let ruta = std::env::var_os("APPIMAGE").map(PathBuf::from).or_else(|| std::env::current_exe().ok()).unwrap_or_default();
    let instalacion = if std::env::var_os("APPIMAGE").is_some() { "AppImage" } else if cfg!(windows) { "Windows" } else { "paquete del sistema" };
    if s.json {
        println!("{}", json!({ "version": env!("CARGO_PKG_VERSION"), "canal": canal, "ruta": ruta, "instalacion": instalacion }));
    } else {
        println!("Faro {} · canal {canal}", env!("CARGO_PKG_VERSION"));
        println!("{}", s.tenue(&format!("{instalacion}: {}", ruta.display())));
    }
    0
}

// ------------------------------------------------------------------ vincular y órdenes con clave

fn vincular(c: &Path, resto: &[&str]) -> i32 {
    let Some(codigo) = resto.iter().find(|a| !a.starts_with("--")) else {
        eprintln!("Falta el código. Uso: faro vincular ABCD-EFGH");
        return 2;
    };
    let limpio: String = codigo.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_uppercase();
    if limpio.len() != 8 {
        eprintln!("El código de vinculación tiene 8 caracteres (por ejemplo ABCD-EFGH).");
        return 2;
    }
    let cfg: Config = config::cargar(c);
    if let Some(e) = cfg.equipo.as_ref().filter(|_| cfg.token.is_some()) {
        eprintln!("Este equipo ya está vinculado como {e}. Para vincularlo de nuevo, primero: faro desvincular");
        return 1;
    }
    if faro_abierto(c) {
        match enviar_orden(c, "vincular", None, Some(limpio), Duration::from_secs(10)) {
            Ok(t) => println!("{t}"),
            Err(e) => {
                eprintln!("{e}");
                return 1;
            }
        }
        // Faro intenta vincularse en su próxima vuelta (como con el código que deja el instalador).
        for _ in 0..90 {
            std::thread::sleep(Duration::from_millis(500));
            let cfg = config::cargar(c);
            if let (Some(_), Some(e)) = (cfg.token, cfg.equipo) {
                println!("Vinculado como {e}.");
                return 0;
            }
        }
        eprintln!("Faro aún no se vinculó. Revise «faro logs» o que el código no haya vencido (dura 30 min).");
        return 1;
    }
    // Faro cerrado: el código queda guardado y se usa al abrirlo.
    let ruta = c.join("faro.json");
    let mut v: Value = std::fs::read_to_string(&ruta).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_else(|| json!({}));
    v["codigo_vinculo"] = json!(limpio);
    match std::fs::create_dir_all(c).and_then(|_| std::fs::write(&ruta, serde_json::to_vec_pretty(&v).unwrap_or_default())) {
        Ok(_) => {
            println!("Código guardado. Faro se vinculará al abrirse.");
            0
        }
        Err(e) => {
            eprintln!("No se pudo guardar el código: {e}");
            1
        }
    }
}

fn con_clave(c: &Path, orden: &str) -> i32 {
    if !faro_abierto(c) {
        eprintln!("Faro no está abierto. Ábralo primero (vea «faro doctor»).");
        return 1;
    }
    let Some(clave) = pedir_clave() else {
        eprintln!("No se escribió ninguna clave.");
        return 2;
    };
    match enviar_orden(c, orden, Some(clave), None, Duration::from_secs(15)) {
        Ok(t) => {
            println!("{t}");
            0
        }
        Err(e) => {
            eprintln!("{e}");
            1
        }
    }
}

/// Pide la clave sin mostrarla en pantalla.
fn pedir_clave() -> Option<String> {
    eprint!("Clave de emergencia del laboratorio: ");
    let _ = std::io::stderr().flush();
    #[cfg(unix)]
    let _ = std::process::Command::new("stty").arg("-echo").stdin(std::process::Stdio::inherit()).status();
    #[cfg(windows)]
    let modo = sin_eco();
    let mut linea = String::new();
    let leido = std::io::stdin().read_line(&mut linea);
    #[cfg(unix)]
    let _ = std::process::Command::new("stty").arg("echo").stdin(std::process::Stdio::inherit()).status();
    #[cfg(windows)]
    con_eco(modo);
    eprintln!();
    leido.ok()?;
    let clave = linea.trim().to_string();
    (!clave.is_empty()).then_some(clave)
}

// ------------------------------------------------------------------ acceso «faro» en la terminal

/// Deja el comando `faro` disponible en la terminal de esta cuenta, sin permisos de administrador.
/// - Linux (AppImage): un enlace `~/.local/bin/faro` al AppImage (Ubuntu pone esa carpeta en el PATH).
/// - Windows: `faro.cmd` en `%LOCALAPPDATA%\Microsoft\WindowsApps` (ya está en el PATH); espera a que Faro
///   termine, así la salida y la clave funcionan en cmd y en PowerShell.
/// Lo llama Faro al arrancar; si algo falla no pasa nada (el programa sigue sirviendo con su ruta completa).
#[cfg_attr(debug_assertions, allow(dead_code))]
pub fn instalar_comando() {
    #[cfg(target_os = "linux")]
    {
        let (Some(appimage), Some(casa)) = (std::env::var_os("APPIMAGE"), dirs::home_dir()) else { return };
        let bin = casa.join(".local/bin");
        let enlace = bin.join("faro");
        if std::fs::read_link(&enlace).map(|d| d == Path::new(&appimage)).unwrap_or(false) {
            return;
        }
        if enlace.exists() && std::fs::read_link(&enlace).is_err() {
            return; // hay otro programa llamado «faro»: no se toca
        }
        let _ = std::fs::create_dir_all(&bin);
        let _ = std::fs::remove_file(&enlace);
        if std::os::unix::fs::symlink(&appimage, &enlace).is_ok() {
            registro::info(format!("Comando «faro» disponible en {}", enlace.display()));
        }
    }
    #[cfg(windows)]
    {
        let (Some(local), Ok(exe)) = (dirs::data_local_dir(), std::env::current_exe()) else { return };
        let carpeta = local.join("Microsoft").join("WindowsApps");
        if !carpeta.is_dir() {
            return;
        }
        let ruta = carpeta.join("faro.cmd");
        // cmd lee los .cmd en la página de códigos antigua: una carpeta de usuario con tildes se dañaría.
        // Por eso la ruta va con %LOCALAPPDATA% cuando Faro está ahí (instalación por cuenta).
        let destino = match exe.strip_prefix(&local) {
            Ok(resto) => format!("%LOCALAPPDATA%\\{}", resto.display()),
            Err(_) => exe.display().to_string(),
        };
        let contenido = format!(
            "@echo off\r\nrem Faro: linea de comandos (faro estado, faro doctor, faro logs). Lo crea Faro al arrancar.\r\nstart \"\" /b /wait \"{destino}\" %*\r\nexit /b %errorlevel%\r\n"
        );
        if std::fs::read_to_string(&ruta).map(|t| t == contenido).unwrap_or(false) {
            return;
        }
        if std::fs::write(&ruta, contenido).is_ok() {
            registro::info(format!("Comando «faro» disponible en {}", ruta.display()));
        }
    }
}

// ------------------------------------------------------------------ Windows: consola

/// Faro es una app de ventanas en Windows: no tiene consola. Al recibir un comando se engancha a la
/// terminal desde la que se llamó (el acceso `faro.cmd` espera a que termine).
#[cfg(windows)]
fn conectar_consola() {
    use std::os::windows::io::IntoRawHandle;
    use windows_sys::Win32::System::Console::{AttachConsole, SetStdHandle, ATTACH_PARENT_PROCESS, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE};
    // SAFETY: llamadas del sistema sin punteros propios; los manejadores abiertos quedan para todo el proceso.
    unsafe {
        if AttachConsole(ATTACH_PARENT_PROCESS) == 0 {
            return;
        }
        if let Ok(f) = std::fs::OpenOptions::new().read(true).write(true).open("CONOUT$") {
            let h = f.into_raw_handle();
            SetStdHandle(STD_OUTPUT_HANDLE, h as _);
            SetStdHandle(STD_ERROR_HANDLE, h as _);
        }
        if let Ok(f) = std::fs::OpenOptions::new().read(true).write(true).open("CONIN$") {
            SetStdHandle(STD_INPUT_HANDLE, f.into_raw_handle() as _);
        }
    }
}

#[cfg(windows)]
fn sin_eco() -> u32 {
    use windows_sys::Win32::System::Console::{GetConsoleMode, GetStdHandle, SetConsoleMode, ENABLE_ECHO_INPUT, STD_INPUT_HANDLE};
    // SAFETY: consulta y cambia el modo de la consola de entrada de este proceso.
    unsafe {
        let h = GetStdHandle(STD_INPUT_HANDLE);
        let mut modo: u32 = 0;
        if GetConsoleMode(h, &mut modo) != 0 {
            SetConsoleMode(h, modo & !ENABLE_ECHO_INPUT);
        }
        modo
    }
}

#[cfg(windows)]
fn con_eco(modo: u32) {
    use windows_sys::Win32::System::Console::{GetStdHandle, SetConsoleMode, STD_INPUT_HANDLE};
    // SAFETY: devuelve la consola de entrada a su modo anterior.
    unsafe {
        if modo != 0 {
            SetConsoleMode(GetStdHandle(STD_INPUT_HANDLE), modo);
        }
    }
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn reconoce_comandos_y_duraciones() {
        assert!(es_comando("doctor") && es_comando("logs") && !es_comando("--vigia"));
        assert_eq!(duracion("30m"), Some(chrono::Duration::minutes(30)));
        assert_eq!(duracion("2h"), Some(chrono::Duration::hours(2)));
        assert_eq!(duracion("1d"), Some(chrono::Duration::days(1)));
        assert_eq!(duracion("ayer"), None);
        assert!(version_mayor("0.6.1", "0.6.0") && version_mayor("0.10.0", "0.9.9") && !version_mayor("0.6.0", "0.6.0"));
    }

    #[test]
    fn orden_y_respuesta_por_archivo() {
        let dir = std::env::temp_dir().join(format!("faro-cli-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // Un Faro «abierto» que contesta la orden en otro hilo.
        let d2 = dir.clone();
        let h = std::thread::spawn(move || {
            for _ in 0..50 {
                std::thread::sleep(Duration::from_millis(100));
                if let Ok(t) = std::fs::read_to_string(archivo_orden(&d2)) {
                    let o: OrdenCli = serde_json::from_str(&t).unwrap();
                    let _ = std::fs::remove_file(archivo_orden(&d2));
                    responder(&d2, &o.id, o.clave.as_deref() == Some("ABCD"), "hecho");
                    return;
                }
            }
        });
        assert_eq!(enviar_orden(&dir, "desbloquear", Some("ABCD".into()), None, Duration::from_secs(5)), Ok("hecho".into()));
        h.join().unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            escribir_privado(&dir.join("x"), b"1").unwrap();
            assert_eq!(std::fs::metadata(dir.join("x")).unwrap().permissions().mode() & 0o777, 0o600);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
