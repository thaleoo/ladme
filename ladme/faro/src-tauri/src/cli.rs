//! Command line: `faro status`, `faro doctor`, `faro logs`, `faro inventory`, `faro version`, `faro link`,
//! and with a staff key `faro update`, `faro unlock`, `faro unlink`. Parsed with clap; the Spanish names
//! from Faro 0.6 (`estado`, `vincular`, `desbloquear`…) still work as hidden aliases.
//!
//! It is the same Faro program: `main` calls in here when the first argument is a command, before any
//! window opens. Read-only commands work even if Faro is closed. Commands that change something ask the
//! running Faro through a file in its folder (`orden-cli.json`); Faro checks the key as on the lock screen
//! (five attempts, then a pause) and answers in `respuesta-cli.json`.

use crate::api::{Api, Fallo};
use crate::config::{self, Config, Copia};
use crate::registro::{self, Nivel};
use clap::{Parser, Subcommand, ValueEnum};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{IsTerminal, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Where the system service keeps its state and log (Linux, readable only by root).
const SERVICIO_CARPETA: &str = "/var/lib/ladme-faro";

/// First arguments that mean «run the command line» instead of opening Faro.
pub const COMANDOS: &[&str] = &[
    "status", "doctor", "logs", "inventory", "version", "link", "update", "unlock", "unlink", "start", "stop", "restart", "help",
    // Faro 0.6 names
    "estado", "inventario", "vincular", "actualizar", "desbloquear", "desvincular", "ayuda",
    "--help", "-h", "--version", "-V", "--json", "--no-color",
];

/// Faro itself never starts with a word as its first argument (autostart and the updater pass none), so
/// any word goes to the command line: a typo like `faro stauts` gets clap's «did you mean» instead of
/// opening Faro.
pub fn es_comando(a: &str) -> bool {
    COMANDOS.contains(&a) || (!a.is_empty() && !a.starts_with('-'))
}

/// The Faro folder for this account (the same one the app uses: system config dir + identifier).
pub fn carpeta() -> PathBuf {
    dirs::config_dir().unwrap_or_else(std::env::temp_dir).join("co.edu.unal.ladme.faro")
}

// ------------------------------------------------------------------ arguments

#[derive(Parser, Debug)]
#[command(name = "faro", version, about = "Faro, the LADME lab agent", propagate_version = true,
          after_help = "Docs: LADME → Admin → Faro. Exit codes: 0 ok, 1 problem found, 2 usage error.")]
struct Cli {
    /// Print JSON instead of text
    #[arg(long, global = true)]
    json: bool,
    /// Disable colored output
    #[arg(long, global = true, alias = "sin-color")]
    no_color: bool,
    #[command(subcommand)]
    command: Comando,
}

#[derive(Subcommand, Debug)]
enum Comando {
    /// Link, current reservation and last contact with the server
    #[command(alias = "estado")]
    Status,
    /// Check this computer and suggest fixes
    Doctor {
        /// Fix what can be fixed without admin rights (start Faro, autostart, restart if stuck)
        #[arg(long, alias = "reparar")]
        fix: bool,
        /// Also show paths and connection details
        #[arg(short, long)]
        verbose: bool,
    },
    /// Show Faro's log
    Logs {
        /// Number of lines to show
        #[arg(short = 'n', long = "lines", default_value_t = 40)]
        lines: usize,
        /// Keep printing new lines
        #[arg(short, long)]
        follow: bool,
        /// Only lines newer than this (30s, 10m, 2h, 1d)
        #[arg(long, alias = "desde", value_parser = parse_duracion)]
        since: Option<chrono::Duration>,
        /// Minimum level
        #[arg(long, alias = "nivel", value_enum, default_value_t = NivelArg::Info)]
        level: NivelArg,
    },
    /// Hardware, GPU, cameras and software that Faro reports
    #[command(alias = "inventario")]
    Inventory,
    /// Version, update channel and install location
    Version,
    /// Link this computer with a code from LADME → Admin → Faro
    #[command(alias = "vincular")]
    Link {
        /// Link code, e.g. ABCD-EFGH
        code: String,
    },
    /// Install the latest version now (asks for the emergency key)
    #[command(alias = "actualizar")]
    Update,
    /// Unlock the screen for staff (emergency or temporary key)
    #[command(alias = "desbloquear")]
    Unlock,
    /// Unlink this computer (asks for the emergency key)
    #[command(alias = "desvincular")]
    Unlink,
    /// Start Faro if it is not running
    #[command(alias = "iniciar")]
    Start,
    /// Stop Faro and its watchdog until «faro start» or the next login (asks for a staff key)
    #[command(alias = "detener")]
    Stop,
    /// Restart Faro
    #[command(alias = "reiniciar")]
    Restart,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum NivelArg {
    Info,
    #[value(alias = "aviso")]
    Warn,
    Error,
}

impl From<NivelArg> for Nivel {
    fn from(n: NivelArg) -> Nivel {
        match n {
            NivelArg::Info => Nivel::Info,
            NivelArg::Warn => Nivel::Aviso,
            NivelArg::Error => Nivel::Error,
        }
    }
}

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

fn parse_duracion(t: &str) -> Result<chrono::Duration, String> {
    duracion(t).ok_or_else(|| format!("«{t}» is not a duration; use e.g. 30s, 10m, 2h or 1d"))
}

// ------------------------------------------------------------------ orders to the running Faro

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

/// Writes a file only this account can read (it holds the key for a few seconds).
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

/// Linux con el servicio del sistema instalado: el estado vive en el servicio y se le pregunta por su
/// socket (sin secretos); las órdenes con clave también van por ahí.
fn modo_servicio() -> bool {
    #[cfg(target_os = "linux")]
    return crate::servicio::instalado();
    #[allow(unreachable_code)]
    false
}

/// Configuración y estado de Faro: del servicio, si está instalado, o de la carpeta de esta cuenta.
fn fuente(c: &Path) -> (Config, Copia) {
    #[cfg(target_os = "linux")]
    if modo_servicio() {
        if let Ok(v) = crate::servicio::preguntar(json!({ "op": "resumen" }), Duration::from_secs(5)) {
            return (serde_json::from_value(v["cfg"].clone()).unwrap_or_default(), serde_json::from_value(v["copia"].clone()).unwrap_or_default());
        }
    }
    (config::cargar(c), config::cargar_copia(c))
}

fn faro_abierto(c: &Path) -> bool {
    #[cfg(target_os = "linux")]
    if modo_servicio() {
        return crate::servicio::vivo();
    }
    std::fs::read_to_string(c.join("faro.pid"))
        .ok()
        .and_then(|t| t.trim().parse::<u32>().ok())
        .map(crate::vigia::vivo)
        .unwrap_or(false)
}

/// The running Faro checks keys with the same messages as the lock screen (in Spanish); the command
/// line shows them in English.
fn en_ingles(t: &str) -> String {
    match t {
        "Demasiados intentos. Espere un minuto." => "Too many attempts. Wait a minute.".into(),
        "Clave incorrecta." | "Ese código no desbloquea este equipo." => "Wrong key.".into(),
        "El laboratorio aún no ha creado una clave de emergencia." => "The lab has not created an emergency key yet.".into(),
        "Faro aún no ha recibido datos del laboratorio." => "Faro has not received data from the lab yet.".into(),
        "Escriba el código." => "No key entered.".into(),
        "Este equipo ya está vinculado." => "This computer is already linked.".into(),
        otro => otro.to_string(),
    }
}

fn enviar_orden(c: &Path, orden: &str, clave: Option<String>, codigo: Option<String>, espera: Duration) -> Result<String, String> {
    let id = format!("{}-{}", std::process::id(), chrono::Utc::now().timestamp_millis());
    let o = OrdenCli { id: id.clone(), orden: orden.into(), clave, codigo };
    #[cfg(target_os = "linux")]
    if modo_servicio() {
        return crate::servicio::preguntar(json!({ "op": "orden", "orden": o }), espera)
            .map(|v| en_ingles(v.as_str().unwrap_or_default()))
            .map_err(|e| en_ingles(&e));
    }
    let _ = std::fs::remove_file(archivo_respuesta(c));
    escribir_privado(&archivo_orden(c), &serde_json::to_vec(&o).unwrap_or_default()).map_err(|e| format!("Could not write the order: {e}"))?;
    let hasta = std::time::Instant::now() + espera;
    while std::time::Instant::now() < hasta {
        std::thread::sleep(Duration::from_millis(300));
        if let Some(r) = std::fs::read_to_string(archivo_respuesta(c)).ok().and_then(|t| serde_json::from_str::<RespuestaCli>(&t).ok()) {
            if r.id == id {
                let _ = std::fs::remove_file(archivo_respuesta(c));
                return if r.ok { Ok(en_ingles(&r.texto)) } else { Err(en_ingles(&r.texto)) };
            }
        }
    }
    let _ = std::fs::remove_file(archivo_orden(c));
    Err("Faro did not answer in time. Is it running? Check «faro status».".into())
}

// ------------------------------------------------------------------ output

struct Salida {
    json: bool,
    color: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Marca {
    Ok,
    #[serde(rename = "warn")]
    Aviso,
    #[serde(rename = "fail")]
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
        0..=59 => format!("{s}s ago"),
        60..=3599 => format!("{} min ago", s / 60),
        3600..=172_799 => format!("{} h ago", s / 3600),
        _ => format!("{} days ago", s / 86_400),
    }
}

fn hora_local(d: chrono::DateTime<chrono::Utc>) -> String {
    let l = d.with_timezone(&chrono::Local);
    if l.date_naive() == chrono::Local::now().date_naive() { l.format("%H:%M").to_string() } else { l.format("%d/%m %H:%M").to_string() }
}

// ------------------------------------------------------------------ entry

/// Runs a command and returns the exit code (0 ok, 1 problem, 2 usage error).
pub fn ejecutar(args: &[String]) -> i32 {
    #[cfg(windows)]
    conectar_consola();
    // «faro ayuda» from 0.6 is «faro help».
    let args: Vec<String> = args.iter().map(|a| if a == "ayuda" { "help".to_string() } else { a.clone() }).collect();
    let cli = match Cli::try_parse_from(std::iter::once("faro".to_string()).chain(args)) {
        Ok(c) => c,
        Err(e) => {
            let _ = e.print();
            return e.exit_code();
        }
    };
    let s = Salida { json: cli.json, color: !cli.json && !cli.no_color && std::env::var_os("NO_COLOR").is_none() && std::io::stdout().is_terminal() };
    let c = if modo_servicio() { PathBuf::from(SERVICIO_CARPETA) } else { carpeta() };
    match cli.command {
        Comando::Status => estado(&s, &c),
        Comando::Doctor { fix, verbose } => {
            if fix {
                arreglar(&c);
            }
            doctor(&s, &c, verbose)
        }
        Comando::Logs { lines, follow, since, level } => logs(&s, &c, lines, follow, since, level.into()),
        Comando::Inventory => inventario(&s),
        Comando::Version => version(&s, &c),
        Comando::Link { code } => vincular(&c, &code),
        Comando::Update => con_clave(&c, "actualizar", "Emergency key"),
        Comando::Unlock => con_clave(&c, "desbloquear", "Emergency or temporary key"),
        Comando::Unlink => con_clave(&c, "desvincular", "Emergency key"),
        Comando::Start => iniciar(&c),
        Comando::Stop => {
            let r = con_clave(&c, "detener", "Emergency or temporary key");
            if r == 0 && !esperar(|| !faro_abierto(&c), 10) {
                eprintln!("Faro is still running. Check «faro logs».");
                return 1;
            }
            r
        }
        Comando::Restart => reiniciar(&c),
    }
}

// ------------------------------------------------------------------ status

fn estado(s: &Salida, c: &Path) -> i32 {
    let (cfg, copia) = fuente(c);
    let abierto = faro_abierto(c);
    let r = copia.remoto.as_ref();
    let equipo = cfg.equipo.clone().or_else(|| r.map(|r| r.equipo.codigo.clone()));
    let ahora_srv = chrono::Utc::now() + chrono::Duration::milliseconds(copia.desfase_ms);
    let ocupacion = r.and_then(|r| r.actual.as_ref()).filter(|o| o.fin > ahora_srv);
    let situacion = match ocupacion {
        Some(o) if o.tipo == "bloqueo" => format!("Blocked by the lab until {}", hora_local(o.fin)),
        Some(o) => format!("Reserved until {}{}", hora_local(o.fin), if o.llegada { "" } else { " (arrival not confirmed)" }),
        None => "Free".to_string(),
    };
    let suspendido = r.and_then(|r| crate::decision::vigente(r, &copia.memoria, ahora_srv)).is_some();
    if s.json {
        let v = json!({
            "version": env!("CARGO_PKG_VERSION"),
            "linked": cfg.token.is_some(),
            "computer": equipo,
            "running": abierto,
            "last_contact": copia.recibido_en,
            "mode": r.map(|r| r.modo),
            "now": situacion,
            "suspended": suspendido,
            "announcement": r.and_then(|r| r.anuncio.as_ref()).map(|a| a.texto.clone()),
            "clock_offset_s": copia.desfase_ms / 1000,
        });
        println!("{}", serde_json::to_string_pretty(&v).unwrap_or_default());
        return if cfg.token.is_some() && abierto { 0 } else { 1 };
    }
    println!("Faro {} · {}", env!("CARGO_PKG_VERSION"), equipo.as_deref().unwrap_or("no computer"));
    let linea = |m: Marca, t: String| println!("{} {t}", s.pintar(m));
    if cfg.token.is_some() {
        linea(Marca::Ok, "Linked".into());
    } else {
        linea(Marca::Falla, "Not linked (run «faro link CODE»)".into());
    }
    if abierto {
        linea(Marca::Ok, "Faro is running".into());
    } else {
        linea(Marca::Falla, "Faro is not running".into());
    }
    match copia.recibido_en {
        Some(d) => {
            let viejo = (chrono::Utc::now() - d).num_seconds() > 120;
            linea(if viejo { Marca::Aviso } else { Marca::Ok }, format!("Last contact with the server: {}", hace(d)));
        }
        None => linea(Marca::Aviso, "Has not talked to the server yet".into()),
    }
    if let Some(r) = r {
        println!("  Room mode: {}", match r.modo {
            crate::decision::Modo::Observar => "observe",
            crate::decision::Modo::Avisar => "warn",
            crate::decision::Modo::Bloquear => "lock",
        });
        println!("  Now: {situacion}{}", if suspendido { " · screen suspended" } else { "" });
        if let Some(a) = &r.anuncio {
            println!("  Announcement: «{}»", a.texto);
        }
    }
    if copia.desfase_ms.abs() > 120_000 {
        linea(Marca::Aviso, format!("The computer clock is off by {} min (Faro uses the server time)", copia.desfase_ms.abs() / 60_000));
    }
    if cfg.token.is_some() && abierto { 0 } else { 1 }
}

// ------------------------------------------------------------------ doctor

#[derive(Serialize)]
struct Chequeo {
    status: Marca,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    fix: Option<String>,
}

fn chequeo(status: Marca, text: impl Into<String>, fix: Option<&str>) -> Chequeo {
    Chequeo { status, text: text.into(), fix: fix.map(String::from) }
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

/// Package manager command for a missing tool, by distribution.
fn instalar_paquete(paquete_apt: &str, paquete_dnf: &str) -> String {
    let os = std::fs::read_to_string("/etc/os-release").unwrap_or_default().to_lowercase();
    if os.contains("fedora") || os.contains("rhel") || os.contains("centos") {
        format!("sudo dnf install {paquete_dnf}")
    } else {
        format!("sudo apt install {paquete_apt}")
    }
}

// ------------------------------------------------------------------ start, stop, restart, fix

fn esperar(mut listo: impl FnMut() -> bool, segundos: u64) -> bool {
    let hasta = std::time::Instant::now() + Duration::from_secs(segundos);
    while std::time::Instant::now() < hasta {
        if listo() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    listo()
}

fn leer_pid(c: &Path) -> Option<u32> {
    std::fs::read_to_string(c.join("faro.pid")).ok()?.trim().parse().ok()
}

/// Linux: ¿Faro está instalado como servicio de usuario (instalar-linux.sh)?
#[cfg(target_os = "linux")]
fn servicio_instalado() -> bool {
    dirs::config_dir().map(|d| d.join("systemd/user/ladme-faro.service").is_file()).unwrap_or(false)
}

/// Linux: ¿el servicio está corriendo? (para detener Faro hay que detener el servicio).
#[cfg(target_os = "linux")]
pub fn servicio_activo() -> bool {
    std::process::Command::new("systemctl")
        .args(["--user", "is-active", "ladme-faro.service"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim() == "active")
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn usuario_activo(unidad: &str) -> bool {
    std::process::Command::new("systemctl")
        .args(["--user", "is-active", unidad])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim() == "active")
        .unwrap_or(false)
}

fn abrir(c: &Path) {
    #[cfg(target_os = "linux")]
    if modo_servicio() {
        // Pide la contraseña de administrador (polkit) si hace falta; luego la interfaz de esta sesión.
        let _ = std::process::Command::new("systemctl").args(["start", "ladme-faro-servicio.service"]).status();
        let _ = std::process::Command::new("systemctl").args(["--user", "start", "ladme-faro.service"]).status();
        return;
    }
    crate::vigia::quitar_pausa(c);
    #[cfg(target_os = "linux")]
    if servicio_instalado() {
        let _ = std::process::Command::new("systemctl").args(["--user", "start", "ladme-faro.service"]).status();
        return;
    }
    crate::vigia::abrir_faro();
}

fn iniciar(c: &Path) -> i32 {
    if faro_abierto(c) {
        println!("Faro is already running.");
        return 0;
    }
    abrir(c);
    if esperar(|| faro_abierto(c), 15) {
        println!("Faro started.");
        0
    } else {
        eprintln!("Faro did not start. Check «faro logs».");
        1
    }
}

fn reiniciar(c: &Path) -> i32 {
    if !faro_abierto(c) {
        return iniciar(c);
    }
    let antes = leer_pid(c);
    if let Err(e) = enviar_orden(c, "reiniciar", None, None, Duration::from_secs(10)) {
        eprintln!("{e}");
        return 1;
    }
    // El servicio no deja leer su pid: se espera a que se vaya y vuelva.
    let servicio = modo_servicio();
    if servicio {
        esperar(|| !faro_abierto(c), 10);
    }
    if esperar(|| faro_abierto(c) && (servicio || leer_pid(c) != antes), 20) {
        println!("Faro restarted.");
        0
    } else {
        eprintln!("Faro did not come back. Run «faro start».");
        1
    }
}

#[cfg(target_os = "linux")]
fn activar_arranque() -> Result<String, String> {
    if !servicio_instalado() {
        return Err("no ladme-faro service: run instalar-linux.sh again".into());
    }
    let ok = std::process::Command::new("systemctl").args(["--user", "enable", "ladme-faro.service"]).status().map(|s| s.success()).unwrap_or(false);
    if ok { Ok("enabled the ladme-faro service".into()) } else { Err("systemctl --user enable failed".into()) }
}

#[cfg(windows)]
fn activar_arranque() -> Result<String, String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let (k, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run")
        .map_err(|e| e.to_string())?;
    k.set_value("LADME Faro", &format!("\"{}\"", exe.display())).map_err(|e| e.to_string())?;
    Ok("added Faro to login startup".into())
}

#[cfg(not(any(windows, target_os = "linux")))]
fn activar_arranque() -> Result<String, String> {
    Err("not supported on this system".into())
}

/// `faro doctor --fix`: lo que se arregla sin permisos de administrador.
fn arreglar(c: &Path) {
    let mut hecho = false;
    if arranque_automatico().is_none() {
        hecho = true;
        match activar_arranque() {
            Ok(t) => println!("→ Autostart: {t}"),
            Err(e) => println!("→ Autostart: could not fix ({e})"),
        }
    }
    if !faro_abierto(c) {
        hecho = true;
        abrir(c);
        println!("→ Faro was not running: {}", if esperar(|| faro_abierto(c), 15) { "started" } else { "could not start it" });
    } else if fuente(c).1.recibido_en.is_some_and(|d| (chrono::Utc::now() - d).num_seconds() > 300) {
        hecho = true;
        println!("→ Faro was not talking to the server: {}", if reiniciar(c) == 0 { "restarted" } else { "restart failed" });
    }
    if !hecho {
        println!("→ Nothing to fix automatically.");
    }
    println!();
}

fn doctor(s: &Salida, c: &Path, verbose: bool) -> i32 {
    let (cfg, copia) = fuente(c);
    let mut v: Vec<Chequeo> = Vec::new();
    let sistema = crate::inventario::nombre_sistema().unwrap_or_default();

    if !cfg.completa() {
        v.push(chequeo(Marca::Falla, "The server address is missing from the configuration", Some("Reinstall Faro with the lab installer")));
    }
    match &cfg.equipo {
        Some(e) if cfg.token.is_some() => v.push(chequeo(Marca::Ok, format!("Linked as {e}"), None)),
        _ => v.push(chequeo(Marca::Falla, "This computer is not linked", Some("Create a code in LADME → Admin → Faro → Link, then run: faro link ABCD-EFGH"))),
    }
    if faro_abierto(c) {
        v.push(chequeo(Marca::Ok, "Faro is running", None));
    } else if cfg!(target_os = "linux") {
        v.push(chequeo(Marca::Falla, "Faro is not running", Some("faro start   (or faro doctor --fix)")));
    } else {
        v.push(chequeo(Marca::Falla, "Faro is not running", Some("faro start   (or faro doctor --fix)")));
    }

    // Server and clock (one request that does not count as a heartbeat).
    if cfg.completa() {
        match tauri::async_runtime::block_on(Api::new().ping(&cfg)) {
            Ok((ms, hora)) => {
                if ms > 1500 {
                    v.push(chequeo(Marca::Aviso, format!("The LADME server answers, but slowly ({ms} ms)"), Some("Check the network; if it persists, tell the lab staff")));
                } else {
                    v.push(chequeo(Marca::Ok, format!("The LADME server answers ({ms} ms)"), None));
                }
                if let Some(h) = hora {
                    let dif = (chrono::Utc::now() - h).num_seconds();
                    let texto = format!("The computer clock is {} {} {}", if dif.abs() >= 120 { dif.abs() / 60 } else { dif.abs() },
                                        if dif.abs() >= 120 { "min" } else { "s" }, if dif > 0 { "ahead" } else { "behind" });
                    let arreglo = if cfg!(windows) { "Settings → Time & language → Set time automatically" } else { "sudo timedatectl set-ntp true" };
                    if dif.abs() >= 120 {
                        v.push(chequeo(Marca::Falla, texto, Some(arreglo)));
                    } else if dif.abs() >= 30 {
                        v.push(chequeo(Marca::Aviso, texto, Some(arreglo)));
                    } else {
                        v.push(chequeo(Marca::Ok, "The computer clock is on time", None));
                    }
                }
            }
            Err(Fallo::Red(_)) => v.push(chequeo(Marca::Falla, "Cannot reach the LADME server", Some("Check the network cable or wifi, and that the university network works"))),
            Err(Fallo::Mensaje(m)) => v.push(chequeo(Marca::Falla, m, None)),
            Err(Fallo::NoVinculado) => v.push(chequeo(Marca::Falla, "The server does not recognize this computer", Some("Link it again with a code from the panel"))),
        }
    }
    if let Some(d) = copia.recibido_en {
        if faro_abierto(c) && (chrono::Utc::now() - d).num_seconds() > 300 {
            v.push(chequeo(Marca::Aviso, format!("Faro has not talked to the server since {}", hace(d)), Some("Run «faro doctor --fix» or check «faro logs --level warn»")));
        }
    }

    // Service mode: the service keeps its own folder; what matters is that this session's interface runs.
    #[cfg(target_os = "linux")]
    if modo_servicio() {
        if usuario_activo("ladme-faro.service") {
            v.push(chequeo(Marca::Ok, "The Faro interface is running in this session", None));
        } else {
            v.push(chequeo(Marca::Aviso, "The Faro interface is not running in this session", Some("systemctl --user start ladme-faro.service   (the service also reopens it)")));
        }
    }
    // Faro folder.
    let prueba = c.join(".prueba-doctor");
    match if modo_servicio() { Ok(()) } else { std::fs::create_dir_all(c).and_then(|_| std::fs::write(&prueba, b"ok")) } {
        Ok(_) => {
            let _ = std::fs::remove_file(&prueba);
            v.push(chequeo(Marca::Ok, "Faro can save its configuration", None));
        }
        Err(e) => v.push(chequeo(Marca::Falla, format!("Faro cannot write to {} ({e})", c.display()), Some("Check that folder's permissions"))),
    }

    // Autostart.
    match arranque_automatico() {
        Some(como) => v.push(chequeo(Marca::Ok, format!("Starts automatically ({como})"), None)),
        None => v.push(chequeo(Marca::Aviso, "Does not start automatically at login", Some(if cfg!(windows) { "Open Faro once from the Start menu: it adds itself" } else { "Run instalar-linux.sh again" }))),
    }

    // Linux: graphics session and inventory tools.
    if cfg!(target_os = "linux") {
        match crate::diag::sesion_grafica().as_deref() {
            Some("wayland") => v.push(chequeo(Marca::Ok, "Wayland session (Faro uses XWayland to stay on top)", None)),
            Some(t) => v.push(chequeo(Marca::Ok, format!("{t} session"), None)),
            None => v.push(chequeo(Marca::Aviso, "No graphics session detected", Some("Run doctor from the desktop session, not over SSH"))),
        }
        if !en_path("lspci") {
            v.push(chequeo(Marca::Aviso, "lspci is not installed: Faro cannot read the graphics card", Some(&instalar_paquete("pciutils", "pciutils"))));
        } else if std::process::Command::new("lspci").output().map(|o| String::from_utf8_lossy(&o.stdout).contains("NVIDIA")).unwrap_or(false) && !en_path("nvidia-smi") {
            v.push(chequeo(Marca::Aviso, "There is an NVIDIA card but no nvidia-smi: Faro cannot read its memory", Some("Install the NVIDIA driver")));
        }
    }

    // Disk.
    let d = crate::diag::rapido(false, None, None, 0);
    if let (Some(libre), Some(total)) = (d["disco_libre_gb"].as_f64(), d["disco_total_gb"].as_f64()) {
        let pct = if total > 0.0 { libre * 100.0 / total } else { 100.0 };
        let texto = format!("Disk: {libre:.0} GB free of {total:.0} GB");
        if pct < 10.0 {
            v.push(chequeo(Marca::Falla, texto, Some("Free some space or tell the lab staff")));
        } else if pct < 20.0 {
            v.push(chequeo(Marca::Aviso, texto, Some("Little space left")));
        } else {
            v.push(chequeo(Marca::Ok, texto, None));
        }
    }

    // Published version.
    if let Some(url) = option_env!("FARO_UPDATER_URL").filter(|u| !u.is_empty()) {
        let pruebas = copia.remoto.as_ref().and_then(|r| r.canal.as_deref()) == Some("pruebas");
        let url = if pruebas { url.replace("/releases/latest/download/latest.json", "/releases/download/faro-pruebas/latest.json") } else { url.to_string() };
        let ultima = tauri::async_runtime::block_on(async {
            let r = reqwest::Client::builder().timeout(Duration::from_secs(8)).build().ok()?.get(url).send().await.ok()?;
            r.json::<Value>().await.ok()?["version"].as_str().map(String::from)
        });
        match ultima {
            Some(u) if version_mayor(&u, env!("CARGO_PKG_VERSION")) => v.push(chequeo(Marca::Aviso, format!("A new Faro version is available ({u})"), Some("It installs itself when nobody is using the computer, or run «faro update»"))),
            Some(_) => v.push(chequeo(Marca::Ok, format!("Faro is up to date ({})", env!("CARGO_PKG_VERSION")), None)),
            None => v.push(chequeo(Marca::Aviso, "Could not check the latest published version", None)),
        }
    }

    let fallas = v.iter().filter(|x| x.status == Marca::Falla).count();
    let avisos = v.iter().filter(|x| x.status == Marca::Aviso).count();
    if s.json {
        println!("{}", serde_json::to_string_pretty(&json!({ "checks": v, "problems": fallas, "warnings": avisos })).unwrap_or_default());
    } else {
        println!("Faro {} · {} · {}", env!("CARGO_PKG_VERSION"), cfg.equipo.as_deref().unwrap_or("no computer"), sistema);
        for x in &v {
            println!("{} {}", s.pintar(x.status), x.text);
            if let Some(a) = &x.fix {
                println!("   {} {a}", s.tenue("→"));
            }
        }
        if verbose {
            println!();
            println!("{}", s.tenue("Details"));
            println!("  Folder       {}", c.display());
            println!("  Log          {}", registro::ruta(c).display());
            println!("  Program      {}", std::env::var_os("APPIMAGE").map(PathBuf::from).or_else(|| std::env::current_exe().ok()).unwrap_or_default().display());
            println!("  Session      {}", crate::diag::sesion_grafica().unwrap_or_else(|| "—".into()));
            println!("  Last contact {}", copia.recibido_en.map(|d| format!("{} ({})", hora_local(d), hace(d))).unwrap_or_else(|| "never".into()));
            println!("  Clock offset {} s", copia.desfase_ms / 1000);
            println!("  Channel      {}", if copia.remoto.as_ref().and_then(|r| r.canal.as_deref()) == Some("pruebas") { "testing" } else { "stable" });
        }
        println!(
            "{}",
            match (fallas, avisos) {
                (0, 0) => "All good.".to_string(),
                (f, a) => format!("{f} {}, {a} {}.", if f == 1 { "problem" } else { "problems" }, if a == 1 { "warning" } else { "warnings" }),
            }
        );
    }
    if fallas > 0 { 1 } else { 0 }
}

#[cfg(target_os = "linux")]
fn arranque_automatico() -> Option<String> {
    if modo_servicio() {
        let habilitado = std::process::Command::new("systemctl")
            .args(["is-enabled", "ladme-faro-servicio.service"])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim() == "enabled")
            .unwrap_or(false);
        return habilitado.then(|| "system service".into());
    }
    let enabled = std::process::Command::new("systemctl")
        .args(["--user", "is-enabled", "ladme-faro.service"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim() == "enabled")
        .unwrap_or(false);
    if enabled {
        return Some("ladme-faro service".into());
    }
    let autostart = dirs::config_dir()?.join("autostart");
    std::fs::read_dir(autostart)
        .ok()?
        .flatten()
        .any(|d| d.file_name().to_string_lossy().to_lowercase().contains("faro"))
        .then(|| "at login".into())
}

#[cfg(windows)]
fn arranque_automatico() -> Option<String> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};
    use winreg::RegKey;
    let ruta = r"Software\Microsoft\Windows\CurrentVersion\Run";
    for raiz in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        if let Ok(k) = RegKey::predef(raiz).open_subkey_with_flags(ruta, KEY_READ) {
            if k.enum_values().flatten().any(|(n, _)| n.to_lowercase().contains("faro")) {
                return Some("at login".into());
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

fn nivel_corto(n: Nivel) -> &'static str {
    match n {
        Nivel::Info => "info",
        Nivel::Aviso => "warn",
        Nivel::Error => "error",
    }
}

fn imprimir_linea(s: &Salida, l: &registro::Linea) {
    if s.json {
        println!("{}", json!({ "time": l.hora.to_rfc3339(), "level": nivel_corto(l.nivel), "text": l.texto }));
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

fn logs(s: &Salida, c: &Path, n: usize, seguir: bool, desde: Option<chrono::Duration>, minimo: Nivel) -> i32 {
    let desde = desde.map(|d| (chrono::Local::now() - d).fixed_offset());
    if modo_servicio() && std::fs::File::open(registro::ruta(c)).is_err() {
        eprintln!("The Faro service log needs admin rights: sudo /usr/local/bin/faro logs");
        return 1;
    }
    let lineas = registro::leer(c, n, desde, minimo);
    if lineas.is_empty() && !seguir && !s.json {
        println!("{}", s.tenue(&format!("The log is empty ({}).", registro::ruta(c).display())));
    }
    for l in &lineas {
        imprimir_linea(s, l);
    }
    if !seguir {
        return 0;
    }
    // Follow: read new lines every half second (also when the file rotates).
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

// ------------------------------------------------------------------ inventory and version

fn inventario(s: &Salida) -> i32 {
    let v = crate::inventario::recolectar();
    if s.json {
        println!("{}", serde_json::to_string_pretty(&v).unwrap_or_default());
        return 0;
    }
    let t = |k: &str| v[k].as_str().map(String::from).or_else(|| v[k].as_f64().map(|x| x.to_string())).unwrap_or_else(|| "—".into());
    println!("CPU        {}  ({} cores, {} threads)", t("cpu"), t("nucleos"), t("hilos"));
    println!("Memory     {} GB", t("ram_gb"));
    let gpus: Vec<String> = v["gpus"].as_array().into_iter().flatten()
        .map(|g| format!("{}{}", g["nombre"].as_str().unwrap_or("?"), g["vram_gb"].as_f64().map(|x| format!(" ({x} GB)")).unwrap_or_default()))
        .collect();
    println!("GPU        {}", if gpus.is_empty() { "—".into() } else { gpus.join(" · ") });
    let cams: Vec<&str> = v["camaras"].as_array().into_iter().flatten().filter_map(|c| c.as_str()).collect();
    println!("Cameras    {}", if cams.is_empty() { "none".into() } else { cams.join(" · ") });
    println!("Disk       {} GB ({} GB free)", t("disco_gb"), t("disco_libre_gb"));
    println!("System     {}", t("so_nombre"));
    println!("Account    {}", t("cuenta"));
    let prog: Vec<&str> = v["software"].as_array().into_iter().flatten().filter_map(|c| c.as_str()).collect();
    println!("Software   {}", if prog.is_empty() { "none from the list".into() } else { prog.join(", ") });
    0
}

fn version(s: &Salida, c: &Path) -> i32 {
    let copia: Copia = fuente(c).1;
    let canal = match copia.remoto.as_ref().and_then(|r| r.canal.as_deref()) {
        Some("pruebas") => "testing",
        _ => "stable",
    };
    let ruta = std::env::var_os("APPIMAGE").map(PathBuf::from).or_else(|| std::env::current_exe().ok()).unwrap_or_default();
    let instalacion = if std::env::var_os("APPIMAGE").is_some() { "AppImage" } else if cfg!(windows) { "Windows" } else { "system package" };
    if s.json {
        println!("{}", json!({ "version": env!("CARGO_PKG_VERSION"), "channel": canal, "path": ruta, "install": instalacion }));
    } else {
        println!("Faro {} · {canal} channel", env!("CARGO_PKG_VERSION"));
        println!("{}", s.tenue(&format!("{instalacion}: {}", ruta.display())));
    }
    0
}

// ------------------------------------------------------------------ link and keyed orders

fn vincular(c: &Path, codigo: &str) -> i32 {
    let limpio: String = codigo.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_uppercase();
    if limpio.len() != 8 {
        eprintln!("The link code has 8 characters (for example ABCD-EFGH).");
        return 2;
    }
    let cfg: Config = fuente(c).0;
    if let Some(e) = cfg.equipo.as_ref().filter(|_| cfg.token.is_some()) {
        eprintln!("This computer is already linked as {e}. To link it again, first run: faro unlink");
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
        // Faro tries to link on its next loop (like with the code the installer leaves).
        for _ in 0..90 {
            std::thread::sleep(Duration::from_millis(500));
            let cfg = fuente(c).0;
            if let (Some(_), Some(e)) = (cfg.token, cfg.equipo) {
                println!("Linked as {e}.");
                return 0;
            }
        }
        eprintln!("Faro has not linked yet. Check «faro logs», or whether the code expired (codes last 30 min).");
        return 1;
    }
    if modo_servicio() {
        eprintln!("The Faro service is not running. Start it with: sudo systemctl start ladme-faro-servicio");
        return 1;
    }
    // Faro closed: the code is saved and used when it opens.
    let ruta = c.join("faro.json");
    let mut v: Value = std::fs::read_to_string(&ruta).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_else(|| json!({}));
    v["codigo_vinculo"] = json!(limpio);
    match std::fs::create_dir_all(c).and_then(|_| std::fs::write(&ruta, serde_json::to_vec_pretty(&v).unwrap_or_default())) {
        Ok(_) => {
            println!("Code saved. Faro will link when it starts.");
            0
        }
        Err(e) => {
            eprintln!("Could not save the code: {e}");
            1
        }
    }
}

fn con_clave(c: &Path, orden: &str, pregunta: &str) -> i32 {
    if !faro_abierto(c) {
        eprintln!("Faro is not running. Start it first (see «faro doctor»).");
        return 1;
    }
    let Some(clave) = pedir_clave(pregunta) else {
        eprintln!("No key entered.");
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

/// Asks for the key without echoing it.
fn pedir_clave(pregunta: &str) -> Option<String> {
    eprint!("{pregunta}: ");
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
            "@echo off\r\nrem Faro command line (faro status, faro doctor, faro logs). Created by Faro at startup.\r\nstart \"\" /b /wait \"{destino}\" %*\r\nexit /b %errorlevel%\r\n"
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
    fn parses_english_commands_and_spanish_aliases() {
        let p = |a: &[&str]| Cli::try_parse_from(std::iter::once("faro").chain(a.iter().copied()));
        assert!(matches!(p(&["status"]).unwrap().command, Comando::Status));
        assert!(matches!(p(&["estado"]).unwrap().command, Comando::Status));
        match p(&["logs", "-f", "-n", "5", "--since", "10m", "--level", "warn", "--json"]).unwrap() {
            Cli { json: true, command: Comando::Logs { lines: 5, follow: true, since: Some(d), level: NivelArg::Warn }, .. } => {
                assert_eq!(d, chrono::Duration::minutes(10))
            }
            otro => panic!("{otro:?}"),
        }
        assert!(matches!(p(&["logs", "--desde", "2h", "--nivel", "aviso"]).unwrap().command, Comando::Logs { level: NivelArg::Warn, .. }));
        assert!(matches!(p(&["vincular", "ABCD-EFGH"]).unwrap().command, Comando::Link { .. }));
        assert!(matches!(p(&["doctor", "--fix", "-v"]).unwrap().command, Comando::Doctor { fix: true, verbose: true }));
        assert!(matches!(p(&["stop"]).unwrap().command, Comando::Stop) && matches!(p(&["restart"]).unwrap().command, Comando::Restart));
        assert_eq!(p(&["logs", "--since", "ayer"]).unwrap_err().exit_code(), 2);
        assert_eq!(p(&["--help"]).unwrap_err().exit_code(), 0);
        assert_eq!(p(&["frobnicate"]).unwrap_err().exit_code(), 2);
        assert!(es_comando("unlock") && es_comando("desbloquear") && es_comando("stauts") && !es_comando("--vigia"));
    }

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
