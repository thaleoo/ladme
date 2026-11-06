# Auditoría de datos — LADME

**Fuente:** `sheets/Alojamiento de código.xlsx`
**Corte:** 2026-11-06 23:59 (America/Bogota)
**Método:** lectura directa del XLSX (valores reales de celda, no texto formateado), con Python estándar.
**Privacidad:** este documento **no incluye** nombres, cédulas, correos ni mensajes de usuarios. Solo agregados, equipos, fechas, duraciones e IDs de reserva.

> El XLSX original contiene datos personales y está excluido del repositorio por `.gitignore`. No debe subirse a GitHub ni adjuntarse en issues.

---

## 1. Qué se recibió

El archivo tiene 4 pestañas:

| Pestaña | Filas de datos | Estado |
|---|---:|---|
| `Hoja 1` | 0 | Vacía; se puede ignorar |
| `Reservas_HISTORIAL` | 3 | Muy incompleto |
| `Reservas_LADME` | 131 | Fuente principal |
| `Computadores_LADME` | 16 | Catálogo completo |

**Faltan** `Reservas_CONTACTOS` y `Bloqueos_LADME`. Sin ellas no se puede auditar el uso del contacto entre usuarios ni los bloqueos de gestión.

---

## 2. Resumen ejecutivo

1. **131 reservas** en ~7 semanas (2026-09-23 a 2026-11-13), con un fin máximo el 2026-12-12.
2. **La duración típica es de días, no de horas:** mediana 29,5 h y media 55,5 h. El 55 % supera 24 h y el 27 % supera 72 h.
3. **9 reservas superan las 168 h** (7 %). La más larga es de **707 h** (~29,5 días) y todavía no ha empezado.
4. **5 reservas estaban activas** al corte. Cuatro superan 144 h y una llega a 341,9 h. No se pueden recortar sin romper trabajo en curso.
5. **Todos los registros son de estudiantes.** No hay reservas de profesores, laboratoristas ni administrativos en el histórico.
6. **El caso de uso dominante es trabajo de grado** (97 de 131), seguido de PAE (23). Esto explica las duraciones largas y condiciona la política: un tope rígido sin excepción genera fricción.
7. **No hay duplicados de ID de reserva, no hay fechas invertidas y no hay columnas más allá de R.** La base es consistente; el problema es de política, no de corrupción.
8. **El historial es inservible para analítica:** solo 3 filas. Las cancelaciones anteriores no se pueden reconstruir.

---

## 3. Métricas de `Reservas_LADME`

| Métrica | Valor |
|---|---:|
| Filas | 131 |
| Inicio mínimo | 2026-09-23 00:00 |
| Inicio máximo | 2026-11-13 00:00 |
| Fin máximo | 2026-12-12 23:59 |
| Duración mínima | 0,02 h (~1 min) |
| Duración máxima | **706,98 h** |
| Duración mediana | 29,52 h |
| Duración media | 55,51 h |
| Reservas pasadas al corte | 124 |
| Reservas activas al corte | 5 |
| Reservas futuras al corte | 2 |
| IDs de reserva duplicados | 0 |
| Filas con fechas inválidas o invertidas | 0 |
| Columnas más allá de R | 0 |

### Distribución por duración

| Rango | Reservas | % |
|---|---:|---:|
| ≤ 2 h | 19 | 14,5 % |
| 2–8 h | 24 | 18,3 % |
| 8–24 h | 16 | 12,2 % |
| 1–3 días | 37 | 28,2 % |
| 3–7 días | 26 | 19,8 % |
| **> 7 días** | **9** | **6,9 %** |

### Distribución por mes de inicio

| Mes | Reservas |
|---|---:|
| 2026-09 | 35 |
| 2026-10 | 81 |
| 2026-11 | 15 |

---

## 4. Reservas de más de 168 h

| Fila | Equipo | Inicio | Fin | Horas | ID |
|---:|---|---|---|---:|---|
| 43 | UNAL-15 (Precision 3660) | 2026-10-02 10:36 | 2026-10-09 12:00 | 169,4 | RES-1790955473147 |
| 65 | UNAL-16 (Precision 3660) | 2026-10-09 09:33 | 2026-10-16 16:30 | 174,9 | RES-1791556659626 |
| 77 | UNAL-12 (Precision 3660) | 2026-10-14 11:09 | 2026-10-21 19:00 | 175,8 | RES-1791994222577 |
| 110 | UNAL-06 (Z1 G6) | 2026-10-28 13:47 | 2026-11-06 13:00 | 215,2 | RES-1793213382298 |
| 111 | UNAL-12 (Precision 3660) | 2026-10-28 16:35 | 2026-11-06 19:00 | 218,4 | RES-1793223261305 |
| 115 | UNAL-09 (Precision 3660) | 2026-11-02 12:04 | 2026-11-13 12:04 | 264,0 | RES-1793293848669 |
| 116 | UNAL-07 (Precision 3660) | 2026-10-29 12:45 | 2026-11-12 18:39 | 341,9 | RES-1793295639288 |
| 119 | UNAL-16 (Precision 3660) | 2026-10-31 06:00 | 2026-11-07 20:25 | 182,4 | RES-1793410186674 |
| 124 | UNAL-09 (Precision 3660) | 2026-11-13 13:00 | 2026-12-12 23:59 | **707,0** | RES-1793716933128 |

**Lectura:** la fila 124 es el caso crítico. Es una reserva **futura** de casi un mes que bloquea el equipo UNAL-09 desde el 13 de noviembre hasta el 12 de diciembre. Si se aplica la regla de 168 h sin transición, hay que hablar con el titular antes de tocarla.

### Reservas activas al corte

| Equipo | Inicio | Fin | Horas | ID |
|---|---|---|---:|---|
| UNAL-09 | 2026-11-02 12:04 | 2026-11-13 12:04 | 264,0 | RES-1793293848669 |
| UNAL-07 | 2026-10-29 12:45 | 2026-11-12 18:39 | 341,9 | RES-1793295639288 |
| UNAL-16 | 2026-10-31 06:00 | 2026-11-07 20:25 | 182,4 | RES-1793410186674 |
| UNAL-15 | 2026-11-03 15:41 | 2026-11-09 15:41 | 144,0 | RES-1793738578212 |
| UNAL-14 | 2026-11-06 02:35 | 2026-11-13 02:30 | 167,9 | RES-1793858466505 |

**Decisión recomendada (D-13):** abuelo para estas 5 (se respetan hasta su fin) y renegociación para la futura de 707 h. No cancelar nada sin aviso.

---

## 5. Catálogo de equipos

16 equipos, todos en `Sala LADME` y en estado `Activo`:

| Familia | Equipos | Cantidad |
|---|---|---:|
| Dell Precision 7920 | UNAL-01, UNAL-02 | 2 |
| HP Z1 G6 | UNAL-03, UNAL-04, UNAL-05, UNAL-06 | 4 |
| Dell Precision 3660 | UNAL-07 a UNAL-12 y UNAL-15, UNAL-16 | 8 |
| HP Z1 | UNAL-13, UNAL-14 | 2 |

### Uso por equipo

| Equipo | Reservas |
|---|---:|
| UNAL-03 | 16 |
| UNAL-01, UNAL-11 | 15 |
| UNAL-07, UNAL-14 | 14 |
| UNAL-02 | 11 |
| UNAL-04, UNAL-13 | 10 |
| UNAL-09 | 8 |
| UNAL-16 | 6 |
| UNAL-12, UNAL-15 | 4 |
| UNAL-06 | 2 |
| UNAL-05, UNAL-08 | 1 |

**Observaciones:**

- `UNAL-10` no tiene ninguna reserva en el período. Puede estar fuera de servicio, ser nuevo o simplemente no haberse usado. Confirmar antes de asumir que está disponible.
- `UNAL-13` y `UNAL-14` figuran como `Z1 (HP)` mientras `UNAL-03` a `UNAL-06` figuran como `Z1 G6 (HP)`. Es inconsistencia de nombre, no de equipo. Normalizar en la migración.
- El catálogo solo tiene 5 columnas (ID, modelo, marca, ubicación, estado). No hay serial, NFC UID, fecha de compra, frecuencia de mantenimiento ni próximo mantenimiento. Eso hay que agregarlo para el módulo de mantenimiento.

---

## 6. Perfil de uso

| Dimensión | Distribución |
|---|---|
| Tipo de usuario | Estudiante 131 (100 %) |
| Programa | Mecatrónica 120 · Biológica 10 · Estadística 1 |
| Matrícula | Décima 120 · Séptima 9 · Octava 2 |
| Actividad | Trabajo de grado 97 · PAE 23 · Otro 9 · Semilleros 2 |

**Lectura:** el sistema es, en la práctica, una herramienta de trabajo de grado de Mecatrónica. La PWA debe optimizar ese caso (reservas largas, credencial, recordatorios de fin, extensión) sin perder los casos de PAE y semilleros.

---

## 7. Columnas especiales

| Columna | Nombre | Filas con dato | Lectura |
|---|---|---:|---|
| P | ID Solicitud | 17 | Hay idempotencia, pero solo en el 13 % de las reservas. El resto son anteriores a la función o se crearon por otra vía. |
| Q | Proceso Desatendido | 8 | Todas dicen `Sí`. Ya existe una noción manual de no-show, pero no se mide con timestamps. |
| R | Mensaje para quien llegue | 5 | Uso bajo. Los mensajes son operativos ("no cerrar Chrome", "corridas de ensayo"). |

No hay columnas más allá de R.

---

## 8. Problemas de calidad de datos

| ID | Problema | Evidencia | Impacto | Acción |
|---|---|---|---|---|
| Q-01 | Cédulas exportadas como número científico | `1.066348531E9` en el XLSX | Pérdida de dígitos si se reimporta mal | Leer como texto; no usar el valor formateado |
| Q-02 | Fechas y horas como serial de Excel | `46288.0`, `0.357638...` | Riesgo de desfase si se interpreta como texto | Convertir con base 1899-12-30 y zona America/Bogota |
| Q-03 | Historial casi vacío | 3 filas | No se puede auditar el pasado | Aceptar la pérdida; empezar historial nuevo en la PWA |
| Q-04 | Nombres de modelo inconsistentes | `Z1` vs `Z1 G6` | Fichas y reportes inconsistentes | Normalizar en la migración |
| Q-05 | `UNAL-10` sin reservas | 0 filas | Estado real desconocido | Confirmar con el laboratorio |
| Q-06 | Faltan hojas | `Reservas_CONTACTOS`, `Bloqueos_LADME` | No se puede auditar contacto ni bloqueos | Exportarlas antes de migrar |
| Q-07 | Todo estudiante | 131/131 | No se sabe si el campo se usa mal o si nadie más reserva | Confirmar con el laboratorio |
| Q-08 | Sin estado de reserva | No hay columna Estado | Canceladas y finalizadas solo se infieren por fechas | Agregar `Estado` en Sheets y en Postgres |
| Q-09 | Sin token de credencial | No hay columna | El QR actual no puede validar estado | Generar token al migrar |
| Q-10 | Duraciones extremas | 707 h | Bloqueo de equipos por semanas | Aplicar D-02 y D-13 |

---

## 9. Implicaciones para la migración

1. **Importar tal cual** las 131 reservas, incluidas las 9 de más de 168 h. La regla nueva aplica a reservas nuevas; las existentes se marcan como `abuelo` (D-13).
2. **No borrar ni recortar** las 5 activas. Su estado se calcula por fechas al importar.
3. **Generar `token_credencial`** para las 5 activas y las 2 futuras; para el histórico no es necesario.
4. **Conservar el ID de reserva** (`RES-...`) como clave de negocio, aunque el token sea distinto. Los enlaces viejos y el historial lo usan.
5. **Normalizar el catálogo** antes de cargarlo: `Z1 G6` para UNAL-13/14, y agregar los campos de mantenimiento.
6. **Cargar el histórico** en una tabla de solo lectura o con `archivada = true`, para que no aparezca en disponibilidad.
7. **Verificar conteos** después de importar: 131 reservas, 16 equipos, 9 > 168 h, 5 activas, 0 duplicados.
8. **No migrar cédulas** a la PWA si se aprueba D-10; dejarlas solo en el archivo histórico de Sheets.

---

## 10. Datos que faltan

- [ ] `Reservas_CONTACTOS` (mensajes entre usuarios).
- [ ] `Bloqueos_LADME` (bloqueos de gestión y mantenimiento).
- [ ] Estado real de `UNAL-10`.
- [ ] Seriales, NFC UID y fechas de compra de los 16 equipos.
- [ ] Frecuencias de mantenimiento por familia de equipo.
- [ ] Correo del responsable técnico que valida mantenimiento.
- [ ] Confirmación de si hay una hoja de producción distinta de esta.

---

## 11. Reproducir la auditoría

El análisis se hizo con un script de solo lectura que:

- abre el XLSX como ZIP y lee `xl/worksheets/*.xml` y `xl/sharedStrings.xml`;
- convierte seriales de Excel a fechas;
- calcula duraciones y agregados;
- **no imprime nombres, cédulas, correos ni mensajes**.

El script de referencia vive en `scripts/auditoria_xlsx.py`. Se puede correr así:

```bash
python scripts/auditoria_xlsx.py "sheets/Alojamiento de código.xlsx"
```

No requiere dependencias externas (solo biblioteca estándar de Python 3.9+).
