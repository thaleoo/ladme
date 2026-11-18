//! Verificación de la clave de emergencia sin conexión. Debe dar exactamente lo
//! mismo que `_faro_hash_clave` en la base de datos.

use sha2::{Digest, Sha256};

pub fn normalizar(clave: &str) -> String {
    clave.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_ascii_uppercase()
}

pub fn huella(sal: &str, clave: &str, iteraciones: u32) -> String {
    let mut v = Sha256::digest(format!("{sal}:{}", normalizar(clave)).as_bytes());
    for _ in 1..iteraciones.max(1) {
        v = Sha256::digest(v);
    }
    hex::encode(v)
}

#[cfg(test)]
mod pruebas {
    #[test]
    fn coincide_con_la_base_de_datos() {
        // Valores calculados con _faro_hash_clave en PostgreSQL.
        assert_eq!(super::huella("SAL123", "abcd-efgh-jkmn", 20000),
                   "71453a7aa5a5a730cd5f755bd893cb37e549c0cea69dd1fe16a07d4aee44f635");
        assert_eq!(super::huella("SAL123", "ABCDEFGHJKMN", 1),
                   "79505025fb2125345a0347f32196ec6bd2639c41072437d1dc8b7890589c11c5");
    }
}
