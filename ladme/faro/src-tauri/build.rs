fn main() {
    // Las direcciones del servidor se fijan al compilar (ver config.rs).
    for v in ["FARO_SUPABASE_URL", "FARO_SUPABASE_KEY", "FARO_PWA_URL"] {
        println!("cargo:rerun-if-env-changed={v}");
    }
    tauri_build::build()
}
