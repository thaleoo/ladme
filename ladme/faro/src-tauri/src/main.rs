// Sin consola en Windows al compilar para distribuir.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    faro_lib::run()
}
