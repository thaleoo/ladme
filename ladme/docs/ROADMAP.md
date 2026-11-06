# Hoja de ruta — LADME: retirar Google Wallet, ordenar Apps Script y construir la PWA

**Versión:** 0.2 · **Fecha:** 2026-11-06 · **Estado:** decisiones de arquitectura confirmadas; repo reorganizado. No se ha modificado el código de la aplicación.

> **Cambio de esta versión:** se confirma **solo Supabase, sin Google Cloud**; se documenta la configuración real del deployment; se incorpora la auditoría de las hojas reales (131 reservas, 16 equipos, 9 reservas de más de 168 h); y se fija el repo en `appsscript/`, `db/`, `docs/`, `legacy/`, `pwa/`, `scripts/` y `sheets/`.

**Base auditada:** `appsscript/Código.gs` (2.183 líneas), `appsscript/Index.html` (1.440), `db/schema_ladme.sql` (398), `docs/Contexto.md`, `legacy/wallet/Wallet.md`, `legacy/wallet/generar_imagenes_wallet.py` y las hojas reales en `sheets/`.

---

## 0. Resumen ejecutivo

1. El sistema actual funciona y tiene bases de seguridad serias (bloqueo de escritura, idempotencia, historial antes de borrar, escape de HTML, validación de sesión, privacidad en la ficha). No hay que reescribirlo de golpe.
2. Lo que falta no es "más formulario": falta **modelo de ciclo de vida** (estados, no-show, extensiones contadas), **roles reales** (laboratorista y responsable técnico), **mantenimiento** y **alertas idempotentes**.
3. Google Wallet es hoy un injerto de ~265 líneas (`Código.gs:1801-2066`) con **9 puntos de acoplamiento** y una configuración externa (consola de Wallet, cuenta de servicio, clave, propiedades). Se puede retirar sin tocar la lógica de reservas.
4. Hay una restricción técnica que condiciona todo: **una PWA real (service worker, offline, push, instalación) no se puede ejecutar dentro de `HtmlService` de Apps Script**. Apps Script sirve el HTML en un iframe de `googleusercontent.com`; ahí no se puede registrar un service worker ni cumplir los criterios de instalación. Un manifest externo no cambia el origen.
5. Por eso propongo dos carriles:
   - **Carril A (ahora):** retirar Wallet, modularizar, endurecer políticas, agregar mantenimiento y alertas en el sistema actual. Valor inmediato y sin apostar todo a una migración.
   - **Carril B (en paralelo):** construir la PWA real con Supabase (el `schema_ladme.sql` ya está muy avanzado), manteniendo Apps Script como **worker de correo** y puente de exportación durante la transición.
6. No recomiendo "hacer la PWA dentro de Apps Script". Sí recomiendo un **acceso directo instalable** (Agregar a pantalla de inicio) como puente, si se necesita algo ya.

---

## 1. Auditoría express: cómo está el sistema hoy

### 1.1 Archivos y responsabilidades

Todas las rutas de esta hoja de ruta son relativas a `ladme/` después de la reorganización.

| Archivo | Qué contiene | Observación |
|---|---|---|
| `appsscript/Código.gs` | Web app completa: `doGet`, reservas, disponibilidad, ficha por NFC/QR, contacto, bloqueos, panel admin, historial, correos, Wallet y pruebas | Monolito de 2.183 líneas; funcional pero difícil de mantener. **Copia exacta de lo desplegado.** |
| `appsscript/Index.html` | UI completa: formulario, calendario, ficha, panel admin, gráficas y todo el JavaScript inline | 1.440 líneas; mucho JS y HTML mezclados. **Copia exacta de lo desplegado.** |
| `appsscript/appsscript.json` | Configuración real del proyecto: zona horaria, V8, webapp `USER_DEPLOYING` + `DOMAIN` | Recién incorporado; es la configuración confirmada del deployment |
| `db/schema_ladme.sql` | Esquema PostgreSQL/Supabase propuesto: RLS, RPC, exclusión de solapamientos, historial, cola de notificaciones, mantenimiento | Muy buen punto de partida; requiere ajustes de política y alertas |
| `docs/Contexto.md` | Encargo de arquitectura y visión de la PWA | Ya define la dirección correcta |
| `docs/AUDITORIA_DATOS.md` | Radiografía anonimizada de las hojas reales | Nuevo; sustenta las decisiones de transición |
| `legacy/wallet/Wallet.md` | Guía operativa de Wallet | Obsoleta al retirar Wallet; se conserva solo como registro histórico |
| `legacy/wallet/generar_imagenes_wallet.py` | Genera logo/banner de los pases | Obsoleto; los recursos gráficos pueden reutilizarse para la PWA |
| `scripts/generar_qr_ladme.py` | Genera las placas QR de los equipos con `?asset=UNAL-XX` | Se conserva; la URL estable permite no reimprimir |
| `sheets/` | Exportaciones de las hojas (XLSX/CSV) | **Datos personales: no se versiona** (`.gitignore`) |

### 1.2 Hojas de cálculo que usa el código

| Hoja | Columnas actuales | Uso |
|---|---|---|
| `Reservas_LADME` | A Marca Temporal, B Tipo de Usuario, C Nombre, D Cédula, E Correo, F Programa, G Matrícula, H Fecha Inicio, I Hora Inicio, J Fecha Fin, K Hora Fin, L Equipos, M Tipo Actividad, N Detalles, O ID Reserva, P ID Solicitud, Q Proceso Desatendido, R Mensaje | Fuente de verdad de reservas |
| `Computadores_LADME` | A ID/Placa, B Nombre/Modelo, C Marca, D Ubicación, E Estado | Catálogo; se edita a mano |
| `Reservas_HISTORIAL` | 19 columnas: 4 de auditoría + las 15 originales | Append-only; se escribe antes de borrar/modificar |
| `Reservas_CONTACTOS` | Fecha, Solicitante, Equipo, ID Reserva, Titular, Mensaje | Registro de mensajes entre usuarios. **No vino en el XLSX entregado.** |
| `Bloqueos_LADME` | ID, Equipo, Desde, Hasta, Motivo, Creado por, Fecha creación, Estado, Cancelado por, Fecha cancelación | Bloqueos de gestión (revisión, mantenimiento, verificación). **No vino en el XLSX entregado.** |

> El XLSX `sheets/Alojamiento de código.xlsx` contiene 4 pestañas: `Hoja 1` (vacía), `Reservas_HISTORIAL`, `Reservas_LADME` y `Computadores_LADME`. Faltan `Reservas_CONTACTOS` y `Bloqueos_LADME`; hay que exportarlas antes de la migración.

### 1.3 Lo que ya está bien y no hay que romper

- **Serialización de la sección crítica** con `LockService` en creación, cancelación, liberación, extensión y bloqueos.
- **Idempotencia** por `idSolicitud` (columna P) y verificación de la escritura antes de confirmar.
- **Historial antes de borrar/modificar** (`archivarReserva_`), y no se continúa si el historial falla.
- **Escape de HTML** en servidor (`escHtml_`, `escaparCamposHtml_`) y cliente (`esc`).
- **Validación de sesión**: el correo lo impone `Session.getActiveUser()`, no el formulario.
- **Privacidad en la ficha**: un usuario no ve nombre ni correo de otro; el contacto se hace por el sistema.
- **Protección contra fórmulas** en celdas de texto libre (`setNumberFormat("@")`).
- **Bloqueos de gestión** y **vista de ronda** ya resuelven parte del mantenimiento operativo.
- **Pruebas puras** (`pruebasP0`, `pruebasP1B1`, `pruebasP1B2`, `pruebasN1`, `pruebasN3`) que no escriben datos.

### 1.4 Hallazgos priorizados

Severidad: **P0** = bloquea la política o la PWA; **P1** = deuda funcional/seguridad importante; **P2** = mejora.

| ID | Hallazgo | Evidencia | Impacto | Fase |
|---|---|---|---|---|
| A-01 | **No existe tope de duración ni límite de extensiones**. Se puede reservar un equipo por semanas o meses. | `validarDatosReserva_` y `registrarReserva` no comparan contra 168 h; `extenderDesdeFicha` solo comprueba disponibilidad | Bloqueo indefinido de equipos; incumple la política que quieres | 3 |
| A-02 | **Cancelar borra la fila**. No hay estado "cancelada". | `procesarAccionEmail_` (`sheet.deleteRow`), `cancelarReserva` (`sheet.deleteRow`) | La credencial no puede mostrar "cancelada"; los enlaces posteriores dicen "no encontrada"; se pierde el estado para analítica | 3 |
| A-03 | **No existe rol laboratorista**. Todo el panel exige `requireAdmin_`. | `Código.gs:110`, `ADMIN_EMAILS` en `Código.gs:11` | Los laboratoristas no pueden validar QR, gestionar mantenimiento ni recibir avisos con permisos | 4 |
| A-04 | **No existe módulo de mantenimiento**. Solo hay bloqueos de gestión. | No hay hoja/tabla de intervenciones; `Bloqueos_LADME` no guarda frecuencia, próximo, responsable ni validación | No hay historial de intervenciones ni plazos validados por el responsable técnico | 4 |
| A-05 | **No hay recordatorios ni alertas automáticas**. | No hay triggers instalados; solo correos de creación y cancelación | Sin aviso de fin de reserva ni de mantenimiento próximo/vencido | 4 |
| A-06 | **Wallet está acoplado en 9 puntos** y depende de configuración externa. | `Código.gs:550,584,938-940,713-782,1088-1113,1124-1174,1617,1801-2066`; `Index.html:1035-1037` | Deuda y superficie de riesgo; se puede retirar limpiamente | 1 |
| A-07 | **PWA real imposible dentro de Apps Script**. | `HtmlService` + iframe de `googleusercontent.com`; sin service worker ni manifest instalable | Si la PWA es requisito, hay que sacar el frontend de Apps Script | 0/6 |
| A-08 | **Parseo de fechas frágil**. Se construyen `Date` desde textos y se formatean con la zona del script. | `new Date(fecha + "T" + hora + ":00")`, `Utilities.formatDate` en varias funciones | Riesgo de desfase UTC/local según cómo Sheets interprete las celdas | 3/6 |
| A-09 | **Lecturas completas de la hoja**. El panel, el calendario y la búsqueda leen todas las filas. | `obtenerDatosAdmin`, `obtenerEventosUsuarioAnonimo`, `todasLasReservas_`, `buscarFilaPorId_` | Lentitud creciente y riesgo de límite de ejecución | 3/6 |
| A-10 | **No hay "Mis reservas" ni cancelación desde la UI**. El usuario depende del correo. | `Index.html` solo tiene formulario, calendario y ficha | Si el correo falla o se pierde, el usuario no puede cancelar | 3/5 |
| A-11 | **IDs de reserva predecibles** (`RES-` + timestamp). | `idReserva = "RES-" + fechaRegistro.getTime()` | No sirven como token de credencial; el QR debe llevar un token aleatorio | 5 |
| A-12 | **`XFrameOptionsMode.ALLOWALL`** permite incrustar la app en cualquier sitio. | `Código.gs:219` | Riesgo de clickjacking; solo se justifica si se embebe en Google Sites | 2/6 |
| A-13 | **CDNs sin SRI** y sin CSP. | `Index.html:7-14` | Riesgo de cadena de suministro; en PWA hay que empaquetar localmente | 2/6 |
| A-14 | **Sin monitoreo de cuota de correo**. | `MailApp.sendEmail` sin `getRemainingDailyQuota` | Los avisos pueden dejar de salir sin que nadie se entere | 4 |
| A-15 | **Catálogo de equipos sin CRUD**. | `Computadores_LADME` se edita a mano; no hay validación de IDs/estados | Errores de tipeo, estados inconsistentes, fichas rotas | 4/6 |
| A-16 | **No hay check-in ni medición de no-show**. | No se registra llegada (`llegada_en` existe en el esquema SQL, no en Sheets) | No se puede medir uso real ni reservas no utilizadas | 5/6 |
| A-17 | **El esquema SQL tiene dos choques con la política nueva**. | `extension_max_horas` + `duracion_max_horas` en `extender_reserva`; `cola_notificaciones.reserva_id NOT NULL` | Una reserva de 168 h no se podría extender; las alertas de mantenimiento no caben en la cola | 6 |
| A-18 | **Repo sin commits y posible deriva**. | `git log` sin commits; `ladme/` sin versionar; no hay `appsscript.json` | Riesgo de perder trabajo o de editar una copia distinta a la desplegada | 0 |

**Riesgo transversal:** el código real vive en Apps Script y el repo local puede ser una copia. Antes de refactorizar hay que confirmar que `Código.gs` e `Index.html` locales son la versión desplegada; si no, hacer `clasp pull` o descargar el proyecto completo.

### 1.5 Realidad de los datos (auditoría del XLSX)

Fuente: `sheets/Alojamiento de código.xlsx`, corte **2026-11-06**. Detalle completo en `docs/AUDITORIA_DATOS.md`.

| Métrica | Valor | Lectura |
|---|---|---|
| Reservas en `Reservas_LADME` | 131 | Volumen manejable para Sheets hoy; cómodo para Postgres después |
| Rango de inicio | 2026-09-23 → 2026-11-13 | ~7 semanas de operación registrada |
| Fin más lejano | 2026-12-12 | Hay reservas que cruzan más de un mes |
| Duración máxima | **706,98 h** (~29,5 días) | Confirma A-01: no hay tope real |
| Reservas > 24 h | 72 (55 %) | El uso típico es de varios días, no de horas |
| Reservas > 72 h | 35 (27 %) | |
| Reservas > 168 h | **9 (7 %)** | La nueva política afecta a una minoría, pero son las más visibles |
| Activas al corte | 5 | 4 superan 144 h y una llega a 341,9 h |
| Equipos con reservas | 15 de 16 | `UNAL-10` no aparece en el histórico |
| Programas | Mecatrónica 120, Biológica 10, Estadística 1 | Mecatrónica domina; no asumir que el público es solo de sistemas |
| Actividades | Trabajo de grado 97, PAE 23, Otro 9, Semilleros 2 | El caso principal es trabajo de grado de larga duración |
| `Reservas_HISTORIAL` | 3 filas | No hay historial recuperable de cancelaciones anteriores |
| IDs de solicitud (P) | 17 filas | La idempotencia existe, pero no se usa en todas las reservas |
| Proceso desatendido (Q) | 8 filas | Ya hay una noción incipiente de no-show |
| Mensajes (R) | 5 filas | Uso bajo del contacto entre usuarios |

**Consecuencias directas:**

1. La política de 168 h **no puede aplicarse retroactivamente sin decisión**: hay 9 reservas históricas y 5 activas por encima del nuevo tope. Ver D-13.
2. El caso de uso dominante es **trabajo de grado**, así que la extensión de 24 h y la aprobación de excepciones son importantes; un tope rígido sin excepción va a generar fricción.
3. Las reservas activas largas deben **seguir funcionando tal cual** durante la transición; no se pueden recortar ni borrar.
4. El catálogo tiene inconsistencias menores: `UNAL-13` y `UNAL-14` figuran como `Z1 (HP)` mientras el resto de Z1 usa `Z1 G6 (HP)`. Normalizar en la migración, no antes.
5. Las cédulas vienen como número (riesgo de notación científica al exportar) y las fechas como serial de Excel. La migración debe leer el valor real de la celda, no el texto formateado.

---

## 2. Decisiones confirmadas y decisiones abiertas

### 2.1 Confirmadas (2026-11-06)

| ID | Decisión | Valor confirmado | Consecuencia |
|---|---|---|---|
| **C-01** | Arquitectura de la PWA | **Solo Supabase. Sin Google Cloud.** | El backend es Postgres + RLS + RPC de Supabase; el frontend es estático. Apps Script sigue siendo de Google Workspace y queda como worker de correo/puente durante la transición; lo que se elimina es la dependencia de un proyecto de Google Cloud (Wallet, OAuth, APIs). |
| **C-02** | Google Wallet | **Se retira por completo.** | No se emiten ni actualizan pases. `legacy/wallet/` conserva solo el registro histórico. |
| **C-03** | Deployment actual | `executeAs: USER_DEPLOYING`, `access: DOMAIN`, `America/Bogota`, V8. | Los correos salen de la cuenta que despliega y `Session.getActiveUser()` funciona para el dominio UNAL. Se mantiene hasta la migración. |
| **C-04** | Cuentas iniciales | `josoriodi@unal.edu.co` (admin) y `labdatos_paz@unal.edu.co` (laboratorio). | Configurables; no se hardcodean en la PWA. |
| **C-05** | URL y etiquetas | URL estable del deployment; NFC/QR usan `?asset=UNAL-XX`. | No hay que reimprimir etiquetas: `doGet` puede redirigir `?asset=` a la PWA cuando exista. |
| **C-06** | Repo | El código real vive en Apps Script; `appsscript/` es copia exacta. | No se edita a mano una versión distinta a la desplegada. El repo ordena y documenta; no reemplaza el editor. |
| **C-07** | Datos | No se pierde nada: se migran equipos, reservas, historial y catálogo. | La PWA arranca con los datos reales; Sheets queda como exportación. |

### 2.2 Abiertas

Estas son las que cambian el diseño. Las demás las puedo dejar con un valor por defecto configurable.

| ID | Decisión | Opciones | Mi recomendación |
|---|---|---|---|
| **D-02** | **Tope y extensión** | (A) Base 168 h + una extensión de hasta 24 h → total 192 h. (B) Base 168 h y la extensión también cabe dentro de 168 h (total nunca > 168). (C) Otro tope. | **A**, con `extensiones_max = 1`: una sola extensión, +24 h, solo si el tramo está libre y la reserva no ha terminado. El responsable/admin puede saltarse la regla con registro. |
| **D-03** | **Roles** | (A) 3 roles actuales: usuario, laboratorista, administrador. (B) 4 roles: usuario, laboratorista, responsable técnico, administrador. (C) 3 roles + permiso `validar_mantenimiento`. | **B o C.** Si el responsable técnico es una persona concreta y no un rol general, C es más simple. Si va a rotar, B. |
| **D-04** | **Cancelación** | (A) Soft-cancel: la fila queda con `Estado = Cancelada` y se excluye de disponibilidad. (B) Seguir borrando la fila después de archivar. | **A.** Es lo que ya hace el esquema SQL y lo que necesita la credencial dinámica. |
| **D-05** | **No-show** | (A) Avisar al staff a los 30 min, sin liberar automáticamente. (B) Liberar automáticamente a los 60 min. (C) No medir. | **A** al principio; B solo si el laboratorio lo decide. |
| **D-06** | **Máximo de reservas activas por usuario** | 1, 2 o sin límite | **2**, configurable; evita acaparar equipos sin bloquear casos legítimos. |
| **D-07** | **Cadencia de avisos de mantenimiento** | (A) 7 días, 1 día, día 0 y vencido semanal. (B) Solo el día 0. (C) Otra. | **A.** "Sin repetirse" = una vez por hito y equipo; el vencido se recuerda semanalmente hasta cerrarlo. |
| **D-08** | **Autenticación de la PWA** | (A) Magic link / OTP al correo institucional con lista de dominios. (B) Google OAuth. (C) Otro SSO. | **A**, porque no depende de Google Cloud y cumple "solo Supabase". Google OAuth exigiría un cliente OAuth en Google Cloud; si algún día se quiere, se evalúa aparte. |
| **D-09** | **Horario del laboratorio** | (A) 24/7 con horario visible. (B) Solo horario de atención. | **A** al principio: los procesos largos suelen cruzar noches y fines de semana. Se puede endurecer después. |
| **D-10** | **Cédula** | (A) Mantenerla. (B) Eliminarla de la PWA y dejar solo el dato histórico en Sheets. (C) Reemplazarla por código institucional. | **B**, salvo que sea imprescindible para control de acceso. El esquema SQL ya la excluye por minimización (Ley 1581). |
| **D-11** | **Validación del responsable técnico** | (A) Obligatoria antes de armar alertas. (B) Solo informativa. | **A.** Es lo que pediste: plazos validados por el responsable técnico. |
| **D-12** | **Credencial interina** | (A) Esperar a la PWA y usar correo + ficha mientras tanto. (B) Hacer un pase web simple en Apps Script ahora y luego portarlo. | **A**, salvo que necesites el pase ya. Hacerlo dos veces es desperdicio. |
| **D-13** | **Reservas existentes de más de 168 h** | (A) Abuelo: se respetan hasta su fin y la regla aplica solo a reservas nuevas. (B) Renegociar caso a caso con el titular. (C) Cancelar las que excedan. | **A** para las 5 activas (no romper trabajo en curso) y **B** para las futuras que superen el tope. Nunca C sin aviso. |
| **D-14** | **Alcance de la primera PWA** | (A) Solo lectura: disponibilidad, ficha y credencial. (B) Lectura + reservar/cancelar. (C) Todo, incluido admin y mantenimiento. | **B** en el primer release; admin y mantenimiento en el segundo. Reduce riesgo y permite validar auth y datos. |

---

## 3. Principios de trabajo

1. **No mezclar refactor con cambio de comportamiento** en el mismo despliegue. Primero se mueve el código; después se cambia la lógica.
2. **Una sola fuente de verdad.** Si el repo y Apps Script van a convivir, usar `clasp` (o un ritual de copia documentado) y un commit base. El commit base y el tag `pre-refactor` se crean con esta reorganización.
3. **Desplegar con la cuenta del laboratorio.** Los correos salen de la cuenta que ejecuta/despliega y los triggers corren como quien los crea. El panel ya alerta si el remitente no es `labdatos_paz@unal.edu.co`.
4. **Probar en un deployment de prueba** antes de producción. No editar y desplegar en caliente.
5. **Las políticas van en configuración**, no hardcodeadas. Hoy `ADMIN_EMAILS` y `CUENTA_REMITENTE` están en código.
6. **Las alertas son idempotentes y observables.** Cada aviso lleva una clave de deduplicación; cada envío se registra; si falla, se reintenta sin spamear.
7. **Minimización de datos.** La PWA no necesita cédula, y el QR no debe llevar datos personales.
8. **Compatibilidad hacia atrás.** Los enlaces de correo viejos y las etiquetas NFC/QR actuales deben seguir funcionando durante la transición.

---

## 4. Hoja de ruta por fases

| Fase | Nombre | Esfuerzo | Resultado |
|---|---|---|---|
| 0 | Baseline y decisiones | S (0,5–1 día) | Repo versionado, copias de seguridad, configuración documentada |
| 1 | Retirar Google Wallet | S (0,5 día) | Sin Wallet, sin regresiones |
| 2 | Modularizar Apps Script y HTML | M (1–2 días) | 13 módulos, tests y despliegue equivalentes |
| 3 | Políticas y ciclo de vida de reservas | M (2–3 días) | 168 h, una extensión, soft-cancel, "Mis reservas" |
| 4 | Roles, equipos y mantenimiento | L (1–2 semanas) | Laboratoristas, historial de intervenciones, plazos validados |
| 5 | Alertas y reportes | M (3–5 días) | Recordatorios de fin, avisos de mantenimiento, digest semanal |
| 6 | PWA real (Supabase) | L (3–6 semanas) | App instalable, offline, push, credencial y QR |
| 7 | Migración y cierre | M (1 semana) | Sheets como exportación, monitoreo, runbook |

> Las fases 5 y 6 pueden solaparse. La 5 se puede implementar primero en Apps Script y luego portar la cola a Supabase.

### Fase 0 — Baseline y decisiones

**Objetivo:** poder deshacer cualquier cambio y saber exactamente qué está desplegado.

**Hecho en esta organización del repo:**

- [x] Estructura `appsscript/`, `db/`, `docs/`, `legacy/`, `pwa/`, `scripts/`, `sheets/`.
- [x] `appsscript/appsscript.json` con la configuración real (`USER_DEPLOYING` + `DOMAIN`, `America/Bogota`, V8).
- [x] `docs/AUDITORIA_DATOS.md` con la radiografía de las 131 reservas y los 16 equipos.
- [x] `.gitignore` que excluye hojas con datos personales y credenciales de clasp.

**Pendiente:**

- [ ] Confirmar que `appsscript/Código.gs` y `appsscript/Index.html` son exactamente lo desplegado (hacer `clasp pull` o comparar versión).
- [ ] Exportar `Reservas_CONTACTOS` y `Bloqueos_LADME` (no vinieron en el XLSX).
- [ ] `git init` ya existe: hacer el **commit base** y el tag `pre-refactor`.
- [ ] Inventariar: deployment URL, versión desplegada, triggers, propiedades del script (solo nombres), scopes OAuth.
- [ ] Crear un deployment de prueba separado.
- [ ] Correr las pruebas actuales y guardar la salida como línea base.
- [ ] Escribir un runbook mínimo: qué hacer si falla el correo, si se corrompe una hoja, si el deployment queda mal.

**Criterio de aceptación:** existe un commit/tag con el estado actual, una copia de las hojas y un deployment de prueba que funciona.

### Fase 1 — Retirar Google Wallet

**Objetivo:** que Wallet desaparezca del código, la UI y la configuración sin tocar reservas.

Checklist detallada en la sección 9. En resumen:

1. Buscar todas las referencias (`wallet`, `Wallet`, `WALLET`) en el repo y en Apps Script.
2. Eliminar la sección `Código.gs:1801-2066`.
3. Eliminar los 9 puntos de acoplamiento (correo, ficha, cancelar, liberar, extender).
4. Eliminar el botón de `Index.html:1035-1037`.
5. Eliminar `Wallet.md` y `generar_imagenes_wallet.py` (mover a `legacy/` o borrar; el historial de Git los conserva).
6. Borrar las propiedades `WALLET_*` **después** de revocar la clave de la cuenta de servicio en Google Cloud. Opcional: borrar la clase/objetos de Wallet por API antes de perder las credenciales.
7. Probar: reservar, correo, ficha, extender, liberar, cancelar, reserva rápida, bloqueo, panel admin y las pruebas existentes.
8. Desplegar con la cuenta del laboratorio y verificar el remitente.

**Criterio de aceptación:** `grep -ri wallet` no devuelve referencias en código/UI; todos los flujos funcionan; no hay errores en el registro de ejecución.

### Fase 2 — Modularizar Apps Script y HTML

**Objetivo:** que el siguiente cambio no duela. **Sin cambiar comportamiento.**

Mapa propuesto en la sección 10. Reglas:

- Un archivo por responsabilidad; nombres ASCII (`Codigo.gs`, no `Código.gs`, para evitar problemas de clasp/Git en Windows).
- Mantener los nombres de funciones globales para no romper `google.script.run` ni los triggers.
- Mover constantes a `Config.gs`; no dejar literales de hojas, correos ni políticas repartidos.
- Partir `Index.html` con `include()`: `Estilos.html`, `UiUsuario.html`, `UiAdmin.html`, `Modales.html`, `Scripts.html`.
- Añadir `appsscript.json` al repo (zona horaria, webapp, scopes, dependencias).
- Mover las pruebas a `Pruebas.gs` y añadir una prueba de humo documentada.
- Desplegar en el deployment de prueba y comparar pantallas y flujos contra la línea base.

**Criterio de aceptación:** mismos flujos, mismos textos, mismos correos, mismas pruebas en verde; solo cambió la organización.

### Fase 3 — Políticas y ciclo de vida de reservas

**Objetivo:** que las reglas que pediste se cumplan en el servidor, no solo en la UI.

Cambios:

- `duracion_max_horas = 168` y `anticipacion_max_dias = 30` en `validarDatosReserva_`/`registrarReserva`.
- `extensiones_max = 1`; contar extensiones en una columna nueva o derivarlas del historial. Rechazar la segunda.
- `extension_max_horas = 24` y `duracion_max_total_horas = 192` (si D-02 = A).
- Extensión solo si la reserva no terminó, el tramo está libre y no choca con bloqueo/mantenimiento. Registrar en historial y enviar correo.
- **Soft-cancel:** agregar `Estado` (Activa/Cancelada/Finalizada), `Token credencial`, `Extensiones`, `Llegada`, `Liberada en` y `Motivo cancelación` a `Reservas_LADME`. No borrar filas.
- Centralizar la lectura de reservas en `leerReservas_({estado, desde, hasta, equipo})` y filtrar `Estado = Activa` en disponibilidad, calendario, ficha, panel y ronda.
- Añadir "Mis reservas" y cancelar/extender desde la UI.
- Correos de extensión y cancelación por el usuario (hoy no existen).
- Normalizar fechas: guardar y leer con un formato explícito; no confiar en la interpretación de Sheets.
- Añadir límite de reservas activas por usuario (D-06).
- Pruebas de borde: 168 h pasa, 168 h + 1 min falla; primera extensión pasa, segunda falla; cancelada no ocupa; extensión que choca falla.

**Criterio de aceptación:** no se puede crear una reserva > 168 h ni extender dos veces; cancelar deja rastro visible; la disponibilidad ignora canceladas; los correos de extensión/cancelación salen.

### Fase 4 — Roles, equipos y mantenimiento

**Objetivo:** que los laboratoristas trabajen sin ser administradores y que el mantenimiento tenga historial y validación.

Subfase 4A — Roles y equipos:

- Fuente de roles: hoja `Usuarios_LADME` (correo, nombre, rol, activo) o constantes `ADMIN_EMAILS` + `LAB_EMAILS` como paso intermedio. Mejor hoja.
- `esStaff_()` y `requireStaff_()`; `esAdmin_()` sigue para roles/config.
- Permisos: laboratorista ve reservas, valida QR, registra mantenimiento, crea bloqueos; no cambia roles ni políticas. Administrador: todo.
- CRUD de equipos desde el panel: alta/edición/archivo, estado, ubicación, marca/modelo, placa, serial, NFC, fecha de adquisición, notas.
- Validar IDs (`^[A-Z0-9-]{3,20}$`) y evitar etiquetas duplicadas.

Subfase 4B — Mantenimiento:

- Nueva hoja `Mantenimientos_LADME` (modelo en la sección 7).
- Pestaña "Mantenimiento" en el panel: por equipo, historial, próximo, estado, validación, evidencia.
- Flujo: registrar intervención → proponer próximo (fecha + frecuencia) → responsable técnico valida → se arman alertas → si hay downtime, se crea bloqueo vinculado.
- Historial append-only de cambios de mantenimiento (o auditoría genérica).
- Vista de "próximos" y "vencidos" para el staff.
- Al cerrar una intervención, actualizar estado del equipo y próximo mantenimiento.

**Criterio de aceptación:** un laboratorista puede registrar una intervención y ver el historial; solo el responsable técnico valida el plazo; el equipo aparece como "En mantenimiento" y no se puede reservar en el intervalo; el historial sobrevive a ediciones.

### Fase 5 — Alertas y reportes

**Objetivo:** avisos útiles, una sola vez, al canal correcto.

- Cola/registro `Alertas_LADME` con clave de deduplicación, estado, destinatario, canal, intentos y error.
- Trigger de fin de reserva cada 5–10 min: aviso 30 min antes (correo + in-app; push cuando exista PWA) y 10 min antes (push/in-app).
- Trigger diario de mantenimiento (07:00): 7 días, 1 día, día 0 y vencido semanal.
- Trigger de no-show a los 30 min (solo staff, salvo D-05 = B).
- Digest semanal para staff: próximos/vencidos, intervenciones, reservas no utilizadas, uso por equipo.
- Aviso de cuota de correo baja al admin.
- Centro de notificaciones in-app para staff y usuarios (aunque sea una lista en la app actual).
- Los triggers no tienen sesión: no deben llamar `requireAdmin_`; deben leer la lista de staff desde configuración/hoja.

**Criterio de aceptación:** cada aviso se envía una vez por hito; si se extiende la reserva, se genera un nuevo aviso con el nuevo fin; si falla el correo, queda registrado y se reintenta; no hay duplicados al correr el trigger dos veces.

### Fase 6 — PWA real

**Objetivo:** la app instalable, offline (shell), con push, credencial y QR.

Subfases:

1. **Fundaciones:** repo `pwa/`, Vite + React + TypeScript, Tailwind, Supabase, esquema corregido, RLS, auth por **magic link** `@unal.edu.co`, hosting, CI, backups.
2. **MVP de reservas:** disponibilidad, crear/cancelar/extender, "Mis reservas", ficha de equipo, calendario, admin de reservas.
3. **Credencial y QR:** pase Luma, token aleatorio, QR, validación por staff, estados dinámicos, anti-captura (ver sección 8).
4. **Mantenimiento y alertas:** módulo, roles, cola, correo, push, reportes.
5. **Migración:** importar datos, doble corrida, redirecciones, cutover.

**Criterio de aceptación:** un usuario puede instalarla, reservar y ver su credencial; un laboratorista puede validar el QR; el estado cambia al extender/cancelar; las notificaciones push llegan en Android y en iOS instalado (con sus limitaciones); los datos viven en PostgreSQL y las hojas son solo exportación.

### Fase 7 — Migración y cierre

- Congelar escritura en Sheets; dejar el Apps Script actual en solo lectura/redirección.
- Importar y verificar conteos (reservas, usuarios, equipos, mantenimientos, historial).
- Redirigir `?asset=UNAL-xxxx` y los enlaces de correo viejos a las rutas nuevas.
- Reescribir NFC/QR al nuevo esquema `/e/{codigo}` (o mantener un redirect estable).
- Monitoreo: uptime, errores, cola de correo, backups.
- Documentación: arquitectura, políticas, operación,runbook, changelog.
- Hypercare 2–4 semanas con el sistema viejo disponible como respaldo.

---

## 5. Especificación de políticas (propuesta)

| Clave | Valor propuesto | Nota |
|---|---|---|
| `duracion_max_horas` | **168** | 7 días corridos. **Confirmado como tope base.** Validar si cuenta solo horario del laboratorio. |
| `duracion_max_total_horas` | 192 | Solo si D-02 = A (168 + 24). Si D-02 = B, queda en 168. |
| `extensiones_max` | 1 | Por reserva |
| `extension_max_horas` | 24 | Una sola extensión |
| `aplicar_a_reservas_existentes` | false | D-13: las reservas activas > 168 h se respetan hasta su fin (abuelo). |
| `reservas_existentes_renegociar` | true | Las futuras > 168 h se contactan antes de aplicar la regla. |
| `anticipacion_max_dias` | 30 | Ya está en el esquema SQL |
| `tolerancia_llegada_min` | 30 | Para medir no-show |
| `max_reservas_activas_usuario` | 2 | Configurable; 1 si se quiere estricto |
| `recordatorio_fin_min` | 30 (correo) y 10 (push/in-app) | Evitar dos correos |
| `mantenimiento_aviso_dias` | 7, 1, 0 | Hitos |
| `mantenimiento_vencido_repetir_dias` | 7 | Recordatorio semanal hasta cerrar |
| `mantenimiento_validacion_obligatoria` | true | Sin validación no se arman alertas |
| `horario_laboratorio` | 24/7 visible | Decidir D-09 |
| `cancelacion_min_horas` | 0 | Sin penalización inicial |
| `aprobacion_reservas_largas` | false | Evaluar luego; con 7 días de tope puede ser necesario |

Regla de oro: **toda política se lee de configuración** y se valida en el servidor. El frontend solo muestra el error.

---

## 6. Sistema de alertas

### 6.1 Canales

1. **Correo** (confiable, institucional): `MailApp` desde la cuenta del laboratorio.
2. **In-app** (siempre disponible): lista de avisos en la app; no requiere permiso.
3. **Push** (PWA real): Web Push con VAPID; Android bien, iOS solo instalada (16.4+) y con permiso explícito.
4. **Registro** (`Alertas_LADME`): para deduplicar, auditar y reintentar.

### 6.2 Eventos y disparadores

| Evento | Cuándo | Destinatario | Canal | Clave de deduplicación |
|---|---|---|---|---|
| Reserva creada | Al crear | Titular | Correo | `creada:{id}` |
| Reserva extendida | Al extender | Titular | Correo + in-app | `extendida:{id}:{fin_epoch}` |
| Reserva cancelada por usuario | Al cancelar | Titular | Correo + in-app | `cancelada:{id}` |
| Reserva cancelada por admin | Al cancelar | Titular | Correo | `cancelada_admin:{id}` |
| Fin próximo 30 min | Cron cada 5–10 min | Titular | Correo + in-app | `fin:{id}:{fin_epoch}:30` |
| Fin próximo 10 min | Cron cada 5–10 min | Titular | Push/in-app | `fin:{id}:{fin_epoch}:10` |
| No-show | Inicio + 30 min sin llegada | Staff | Correo + in-app | `noshow:{id}` |
| Mantenimiento 7 días | Cron diario 07:00 | Staff + responsable | Correo + in-app | `mant:{id}:{proximo}:7` |
| Mantenimiento 1 día | Cron diario 07:00 | Staff + responsable | Correo + in-app | `mant:{id}:{proximo}:1` |
| Mantenimiento hoy | Cron diario 07:00 | Staff + responsable | Correo + in-app | `mant:{id}:{proximo}:0` |
| Mantenimiento vencido | Cron diario 07:00 | Staff + responsable | Correo + in-app | `mant:{id}:{proximo}:vencido:{semana}` |
| Validación pendiente | Cron semanal | Responsable técnico | Correo | `mant_validar:{id}:{semana}` |
| Reporte semanal | Lunes 07:00 | Staff | Correo | `reporte:{yyyy-Www}` |
| Cuota de correo baja | Diario | Admin | Correo | `cuota:{fecha}` |

### 6.3 Reglas de implementación

- **Deduplicar antes de enviar**; si el envío falla, marcar `error` y reintentar con backoff, sin crear otra fila.
- **No enviar avisos de reservas canceladas/finalizadas**: el worker vuelve a leer el estado antes de enviar.
- **Si se extiende**, el aviso del fin anterior queda obsoleto; el worker debe omitirlo (`fin_epoch` cambió).
- **Triggers idempotentes**: una función `instalarTriggers()` que borra los triggers existentes por handler y los recrea. Ejecutar una vez con la cuenta del laboratorio.
- **Sin sesión**: los triggers no tienen `Session.getActiveUser()`; usan listas de configuración/hoja.
- **LockService** en el despacho para evitar dos ejecuciones simultáneas.
- **Observabilidad**: registrar cuántos avisos se enviaron/omitieron/fallaron; alertar si el trigger no corre en 24 h (heartbeat).

---

## 7. Módulo de mantenimiento

### 7.1 Modelo propuesto (Sheets ahora / PostgreSQL después)

`Mantenimientos_LADME` / tabla `mantenimientos`:

| Campo | Tipo | Nota |
|---|---|---|
| `id` | texto/UUID | `MANT-...` |
| `equipo_id` / `equipo` | texto | Código estable del equipo |
| `tipo` | enum | preventivo, correctivo, calibración, inspección, otro |
| `descripcion` | texto | Qué se hizo o se va a hacer |
| `fecha` | fecha | Fecha de la intervención |
| `desde` / `hasta` | datetime | Ventana de indisponibilidad (opcional; genera bloqueo) |
| `responsable` | texto | Quién ejecuta |
| `frecuencia_dias` | entero | Solo si la define el fabricante o el responsable técnico |
| `proximo` | fecha | Próxima fecha propuesta |
| `estado` | enum | programado, en_curso, realizado, cancelado |
| `validacion` | enum | pendiente, validado, rechazado |
| `validado_por` | usuario | Responsable técnico |
| `validado_en` | datetime | Fecha de validación |
| `observaciones_validacion` | texto | Motivo de rechazo/cambio |
| `costo` | numérico | Opcional |
| `evidencia` | URL | Foto/PDF en Drive; restringido a staff |
| `creado_por` | usuario | Auditoría |
| `creado_en` | datetime | Auditoría |
| `bloqueo_id` | texto | Si generó un bloqueo de gestión |

### 7.2 Flujo

1. El laboratorista abre **Mantenimiento** y elige el equipo.
2. Ve el historial (intervenciones, fechas, responsables, próximo, estado, evidencias).
3. Registra una intervención o programa la próxima.
4. El sistema propone `proximo = fecha + frecuencia_dias` (editable).
5. El **responsable técnico** valida el plazo (o lo rechaza con motivo). Mientras no esté validado, el aviso es "pendiente de validación", no "mantenimiento próximo".
6. Al validar, se arman los hitos de alerta y, si hay `desde/hasta`, se crea un bloqueo vinculado.
7. Durante la ventana, el equipo queda "En mantenimiento" y no se puede reservar.
8. Al cerrar, se actualiza el estado del equipo, se registra el próximo y se repite el ciclo.
9. Toda edición queda en un historial append-only (o auditoría genérica).

### 7.3 Criterios de aceptación

- Historial por equipo, ordenado, con filtros por tipo/fecha/estado.
- Solo el responsable técnico (o admin) puede validar plazos; queda registrado quién y cuándo.
- Un equipo en mantenimiento no aparece como disponible; las reservas afectadas se listan para decidir.
- Los avisos no se repiten y llegan a laboratoristas + responsable.
- El reporte semanal muestra próximos, vencidos y pendientes de validación.

---

## 8. Credencial digital y QR

### 8.1 Pase

- Formato vertical, móvil, identidad UNAL/LADME, esquinas redondeadas, jerarquía tipográfica.
- Datos: laboratorio, equipo, código, titular, correo institucional (o enmascarado), fecha, inicio, fin, estado, QR, instrucciones.
- Estado dinámico: `activa`, `en_curso`, `finalizada`, `cancelada`, `vencida`, `sin_llegada`, `aun_no_vigente`.
- Se actualiza al extender/cancelar/liberar; no se regenera la imagen.
- "Agregar a calendario" se conserva; "Agregar a Google Wallet" desaparece.

### 8.2 QR

- El QR **no** lleva nombre, cédula ni correo. Lleva un **token aleatorio de 256 bits** (o una URL `https://app.../validar/<token>`).
- No usar `RES-<timestamp>`: es predecible.
- Validación: el staff escanea con la cámara (abre la URL) o con un lector; la página consulta el estado real.
- Resultados: válida, cancelada, vencida, aún no vigente, no encontrada.
- Un pantallazo de una reserva cancelada debe fallar porque el estado se consulta en línea.
- **Anti-suplantación:** para el MVP, el staff ve el nombre del titular en la validación. Mejora posterior: token rotativo de 60 s (TOTP) para que un pantallazo caduque.
- La página de validación no debe cargar recursos externos y debe usar `Referrer-Policy: no-referrer`.
- El QR del equipo (NFC/QR físico) apunta a `/e/{codigo}`, no a la validación.

### 8.3 Offline

- Cachear solo el shell y los assets; **no** cachear disponibilidad, credenciales ni datos personales.
- La validación del QR es siempre en línea; si no hay red, mostrar "sin conexión" y no dar por válida una credencial.
- Mostrar "última actualización" en la credencial.

---

## 9. Checklist de retiro de Google Wallet

### 9.1 Inventario exacto

| Ubicación | Qué hay |
|---|---|
| `Código.gs:550` | `urlWallet = walletEnlaceDesdeDatos_(...)` |
| `Código.gs:584` | Botón "Agregar a Google Wallet" en el correo |
| `Código.gs:938-940` | `walletUrl` en la ficha del titular |
| `Código.gs:713,744,763,782` | `walletPend` en acciones de correo (cancelar/liberar) |
| `Código.gs:1088,1102,1113` | `walletPend` en `liberarDesdeFicha` |
| `Código.gs:1124,1167,1174` | `walletPend` en `extenderDesdeFicha` |
| `Código.gs:1617` | `walletActualizar_` en cancelación admin |
| `Código.gs:1801-2066` | Sección completa de Wallet (constantes, JWT, API, clase, objeto, enlaces, pruebas) |
| `Código.gs:2053-2066` | `pruebasWallet` |
| `Index.html:1035-1037` | Botón en la ficha |
| `Wallet.md` | Guía completa |
| `generar_imagenes_wallet.py` | Generador de imágenes |
| Propiedades | `WALLET_ISSUER_ID`, `WALLET_SA_EMAIL`, `WALLET_SA_KEY`, `WALLET_LOGO_URL`, `WALLET_WIDE_LOGO_URL`, `WALLET_HERO_URL`, `WALLET_CLASE_SUFIJO`, `WALLET_DESACTIVADO` |
| Externo | Cuenta de emisor, clase `issuerId.ladme_reserva_v1`, objetos `issuerId.RES-...`, cuenta de servicio, clave JSON, API habilitada, imágenes públicas |

### 9.2 Orden seguro

1. Guardar una copia del proyecto y de las propiedades (nombres; los valores secretos no se imprimen).
2. Opcional: borrar la clase/objetos de Wallet por API **antes** de borrar la clave (si se quiere limpiar la consola).
3. Eliminar código/UI.
4. Eliminar las propiedades.
5. Revocar la clave de la cuenta de servicio en Google Cloud; deshabilitar la API si no se usará.
6. Probar todos los flujos.
7. Desplegar con la cuenta del laboratorio.
8. Actualizar documentación y changelog.

### 9.3 Criterio de aceptación

- `grep -ri wallet` no encuentra referencias en código/UI.
- El correo de confirmación no muestra el botón.
- La ficha no muestra el botón.
- Reservar, cancelar, liberar, extender, reserva rápida y bloqueos funcionan.
- Las pruebas existentes pasan.
- No hay errores de Wallet en los registros.

---

## 10. Refactor: mapa de módulos

### 10.1 `Código.gs` → 13 archivos

| Nuevo archivo | Origen aproximado | Contenido |
|---|---|---|
| `Config.gs` | 1–65 | Constantes, hojas, encabezados, correos admin/lab, políticas, flags |
| `Utilidades.gs` | 71–91, 114–119, 408–413 | Escape HTML, IDs, fechas, formato de hora |
| `Seguridad.gs` | 93–112, 1667–1687 | Sesión, admin/staff, `require*`, identidad en enlaces |
| `Hojas.gs` | 222–255, 1237–1248, 1758–1799 | Inicialización, columnas extra, bloqueos, idempotencia |
| `Equipos.gs` | 278–369, 834–958 | Catálogo, disponibilidad, ficha, contacto |
| `Reservas.gs` | 419–526, 602–622, 1024–1176, 1380–1409, 1689–1714 | Crear, cancelar, extender, liberar, rápida, perfil, historial de fila |
| `Bloqueos.gs` | 1202–1342 | Validar/crear/cancelar bloqueos |
| `Mantenimiento.gs` | nuevo | Intervenciones, plazos, validación, historial, integración con bloqueos |
| `Alertas.gs` | nuevo | Cola, deduplicación, recordatorios, digest, triggers |
| `Correos.gs` | 528–600, 1622–1663 | Plantillas y envíos |
| `Admin.gs` | 1344–1378, 1435–1660 | Dashboard, ronda, alertas de estado, cancelación admin |
| `Web.gs` | 189–220, 628–826 | `doGet`, páginas de confirmación/respuesta, `include()` |
| `Pruebas.gs` | 1411–1429, 2068–2183 | Todas las pruebas |

> Apps Script tiene ámbito global: no hay `import/export`. Los nombres deben ser únicos entre archivos; mantener el prefijo `_` para funciones privadas.

### 10.2 `Index.html` → include

| Nuevo archivo | Origen | Contenido |
|---|---|---|
| `Index.html` | cabecera + includes | Shell mínimo |
| `Estilos.html` | 16–76 | CSS |
| `UiUsuario.html` | 106–307 | Política, formulario, calendario |
| `UiAdmin.html` | 311–407 | Filtros, alertas, bloqueos, ronda, gráficas, calendario |
| `Modales.html` | 412–426 | Modal de detalle |
| `Scripts.html` | 430–1437 | JS (se puede partir en `ScriptsUsuario`, `ScriptsFicha`, `ScriptsAdmin`) |

Helper en `Web.gs`:

```js
function include(nombre) {
  return HtmlService.createHtmlOutputFromFile(nombre).getContent();
}
```

Uso: `<?!= include('Estilos') ?>`.

### 10.3 Estructura del repo (ya aplicada)

```text
ladme/
  README.md                 # puerta de entrada: qué es, cómo se despliega, advertencias
  appsscript/               # raíz de clasp (archivos planos, copia exacta de lo desplegado)
    appsscript.json
    Código.gs               # monolito actual (se parte en la Fase 2)
    Index.html
    # Fase 2: Config.gs, Seguridad.gs, Admin.gs, Equipos.gs, Reservas.gs,
    #         Correos.gs, Mantenimiento.gs, Alertas.gs, Pruebas.gs, Web.gs,
    #         Estilos.html, UiUsuario.html, UiAdmin.html, Scripts.html
  pwa/                      # frontend de la PWA (Vite + React + TS)
    README.md
  db/
    schema_ladme.sql
    migrations/             # vacío por ahora; aquí van los parches incrementales
  docs/
    ROADMAP.md
    Contexto.md
    AUDITORIA_DATOS.md
    # siguientes: ARQUITECTURA.md, POLITICAS.md, OPERACION.md
  scripts/
    auditoria_xlsx.py
    generar_qr_ladme.py
  legacy/
    wallet/
      Wallet.md
      generar_imagenes_wallet.py
  sheets/                   # exportaciones reales; NO se versiona
    README.md
```

**Reglas de la estructura:**

1. `appsscript/` es la raíz de clasp. No se anidan carpetas dentro: Apps Script no las soporta.
2. `docs/` es la fuente de verdad de las decisiones; el código no se documenta solo con comentarios.
3. `db/migrations/` solo crece; cada cambio de esquema es un archivo nuevo, nunca se edita el anterior.
4. `sheets/` es una carpeta de trabajo local. El `.gitignore` impide subir PII.
5. `legacy/` no se importa desde código; si algo de ahí se reutiliza, se copia con revisión.

> La estructura ya está creada y los archivos movidos. Falta el commit base; ver Fase 0.

---

## 11. Arquitectura de la PWA

### 11.1 La restricción de Apps Script

`HtmlService` sirve el contenido en un iframe sandbox desde `googleusercontent.com`. Ahí:

- No se puede registrar un service worker (origen no apto / sandbox).
- No se puede cumplir el criterio de instalación de Chrome (manifest + SW + HTTPS + start_url).
- No hay Web Push.
- El "Agregar a pantalla de inicio" funciona como **acceso directo**, no como PWA instalable.

Conclusión: si la PWA debe ser instalable, offline y con push, **el frontend tiene que vivir en un dominio propio**. Un proxy CORS sobre Apps Script no resuelve el service worker ni el push, y añade fragilidad.

> Antes de invertir en la Fase 6, hacemos un **spike de 1 hora**: publicar un `manifest.json` y un service worker de prueba en el deployment de Apps Script. Si no se registra (lo esperado), la decisión queda cerrada con evidencia y no con una suposición.

### 11.2 Opciones

| Opción | Frontend | Backend | Push | Offline | Esfuerzo | Veredicto |
|---|---|---|---|---|---|---|
| A. PWA-lite en Apps Script | `Index.html` actual | Sheets + Apps Script | No | No | Bajo | Solo si "PWA" = acceso directo |
| **B. PWA real + Supabase** | React/Vite estático | PostgreSQL + RLS + RPC | Sí | Sí | Alto | **Confirmada (C-01). Sin Google Cloud.** |
| C. PWA real + Firebase | React/Vite | Firestore + Functions | Sí (FCM) | Sí | Alto | Descartada: reescribe el esquema y añade dependencia de Google Cloud |
| D. PWA real + Apps Script + proxy | React/Vite | Apps Script detrás de proxy | No real | Parcial | Medio | Descartada: frágil |
| E. PWA real + Node/Postgres propio | React/Vite | Node + PostgreSQL | Sí | Sí | Muy alto | Descartada: demasiada operación para un solo laboratorio |

### 11.3 Stack recomendado (B)

- **Frontend:** React + Vite + TypeScript; Tailwind + shadcn/ui (o Bootstrap si se quiere continuidad visual); FullCalendar React; TanStack Query.
- **Backend:** Supabase Postgres, RLS, RPC `security definer`; Edge Functions solo para operaciones privilegiadas/cron/push.
- **Auth:** Supabase Auth con **magic link / OTP al correo institucional** y lista de dominios permitidos (`@unal.edu.co`). No requiere Google Cloud. Google OAuth queda descartado por la restricción C-01; si se quisiera, habría que crear un cliente OAuth y eso reabre la dependencia.
- **Hosting:** Cloudflare Pages o Netlify (gratuitos, HTTPS, headers, preview deploys). GitHub Pages como respaldo (sin headers personalizados).
- **Email:** cola en Supabase + **worker de Apps Script** que lee la cola por REST y envía con `MailApp` desde la cuenta del laboratorio (cero costo, remitente conocido). Más adelante, Resend/Brevo si se quiere independencia. Para los correos de auth, configurar SMTP propio en Supabase (el servicio integrado tiene límites muy bajos).
- **Push:** Web Push con VAPID desde Edge Function; tabla `push_suscripciones`; limpiar suscripciones inválidas.
- **QR:** URL `https://app.../validar/<token>`; librería local (sin API externa de QR).
- **Realtime:** polling cada 30 s es suficiente; Realtime opcional.
- **Analytics:** vistas SQL + gráficas; exportación CSV.
- **Backups:** export nocturno a Storage/Drive o `pg_dump` programado; probar restauración.
- **CI:** lint, typecheck, unitarias, Playwright; deploy de preview.

> **Nota de honestidad técnica:** "solo Supabase" no significa "sin servicios externos". Significa que la lógica y los datos viven en Supabase y que no se usa Google Cloud. El hosting del frontend, el SMTP y el push son piezas de infraestructura; se eligen gratuitas y reemplazables.

### 11.4 Autenticación y roles

- `perfiles` con `rol` (`usuario`, `laboratorista`, `responsable_tecnico`, `administrador` o 3 + flag).
- Alta: magic link al correo; trigger que rechaza correos que no sean `@unal.edu.co`.
- RLS: usuario ve lo suyo; staff ve todo; solo admin cambia roles/políticas; nadie se auto-asciende.
- QR de validación: solo staff; el usuario común recibe un veredicto sin datos de terceros.
- Cuentas iniciales: `josoriodi@unal.edu.co` (admin) y `labdatos_paz@unal.edu.co` (laboratorio). Se cargan por seed, no por código.

### 11.5 Migración

1. Importar equipos, reservas activas/futuras, historial y mantenimientos.
2. Respetar las reservas existentes > 168 h según D-13 (abuelo para las activas).
3. Generar tokens de credencial para reservas activas/futuras.
4. Doble corrida: el sistema viejo sigue leyendo Sheets; el nuevo lee Postgres; comparar.
5. Redirigir enlaces viejos (`?asset=`) y correos al nuevo dominio.
6. Congelar Sheets como fuente; dejarlo como exportación.
7. Reescribir NFC/QR a `/e/{codigo}` **solo si** se cambia de dominio; si no, mantener `?asset=` y redirigir desde Apps Script.
8. Hypercare y rollback documentado.

---

## 12. Cambios de datos

### 12.1 Sheets (corto plazo)

`Reservas_LADME` — agregar:

- `Estado` (Activa/Cancelada/Finalizada)
- `Token credencial`
- `Extensiones` (contador)
- `Llegada` (timestamp)
- `Liberada en` (timestamp)
- `Motivo cancelación`

`Computadores_LADME` — ampliar:

- Marca, modelo, especificaciones, ubicación, placa oficial, serial, NFC UID, fecha de adquisición, estado, próximo mantenimiento, frecuencia, notas, archivado.

Nuevas hojas:

- `Mantenimientos_LADME`
- `Alertas_LADME` (dedupe/registro)
- `Usuarios_LADME` (correo, nombre, rol, activo) — o constantes como paso intermedio

Actualizar `Reservas_HISTORIAL` si se agregan columnas a Reservas (hoy son 19 y dependen de las 15 originales).

### 12.2 Supabase (largo plazo) — parches al esquema

1. **Extensiones:** agregar `extensiones int not null default 0`; en `extender_reserva`, rechazar si `extensiones >= 1`; incrementar; permitir total hasta `duracion_max_total_horas` (192) o mantener 168 según D-02.
2. **Cola de notificaciones:** `reserva_id` debe ser nullable; agregar `equipo_id`, `mantenimiento_id`, `canal`, `estado`, `intentos`, `ultimo_error`, `leido_en`. Un `check` que exija exactamente uno de reserva/equipo/mantenimiento.
3. **Mantenimiento:** agregar `desde`, `hasta`, `validacion`, `validado_por`, `validado_en`, `observaciones_validacion`, `bloqueo_id`; funciones `crear_mantenimiento`, `validar_mantenimiento`, `cerrar_mantenimiento`, `encolar_alertas_mantenimiento`.
4. **Roles:** agregar `responsable_tecnico` al enum o un permiso `puede_validar_mantenimiento`.
5. **Push:** tabla `push_suscripciones` (usuario, endpoint, keys, creado, ultimo_uso).
6. **Auditoría:** tabla genérica o historial de mantenimiento; hoy solo hay historial de reservas.
7. **No-show:** ya existe `llegada_en`; agregar función de check-in y, si D-05 = B, liberación automática.
8. **Políticas:** agregar claves de recordatorios, mantenimiento y límites de reservas activas.
9. **Worker:** `encolar_recordatorios_fin` ya es idempotente; falta el cron y el consumidor. `encolar_alertas_mantenimiento` no existe.
10. **Credencial:** `token_credencial` ya es aleatorio; valorar token rotativo para anti-captura.

---

## 13. Seguridad y privacidad

- **Servidor manda:** ninguna regla de negocio se valida solo en el frontend. Hoy se hace bien; mantenerlo.
- **Autorización por rol** en cada RPC y en cada acción de UI; no confiar en el correo del formulario.
- **RLS** en todas las tablas; sin escrituras directas de clientes a reservas; RPC con `security definer` y `search_path`.
- **Tokens de QR aleatorios**; no usar IDs predecibles; no incluir PII en el QR.
- **Anti-captura:** estado en línea + nombre del titular para staff; evaluar token rotativo.
- **Rate limiting:** reservas por usuario/hora, mensajes de contacto (ya existe), validaciones QR.
- **XSS:** mantener `escHtml_`/`esc`; no introducir `innerHTML` con datos sin escapar.
- **CSRF/clickjacking:** quitar `ALLOWALL` si no se embebe en Sites; `SameSite`/CSP en la PWA.
- **Supply chain:** SRI en CDNs mientras se use Apps Script; en PWA, empaquetar dependencias y CSP estricta.
- **Secretos:** solo en propiedades/entorno; rotar la clave de Wallet al retirarla; nunca en el repo.
- **Correo:** evitar PHI/PII innecesaria; no poner cédula en correos; verificar remitente.
- **Datos personales:** minimización (Ley 1581); decidir cédula (D-10); retención y borrado; acceso restringido a evidencia de mantenimiento.
- **Backups y restauración:** probar que se puede recuperar; no solo confiar en Drive.
- **Auditoría:** quién cambió qué y cuándo; historial append-only.

---

## 14. Lo que necesito de ti

### 14.1 Copia del estado actual

- [x] Exportación de `Reservas_LADME`, `Reservas_HISTORIAL` y `Computadores_LADME` (recibida en `sheets/Alojamiento de código.xlsx`).
- [ ] Exportar `Reservas_CONTACTOS` y `Bloqueos_LADME` (faltan en el XLSX).
- [ ] Confirmar si hay columnas más allá de R en `Reservas_LADME` y si P/Q/R existen en todas las filas.
- [ ] Confirmar si hay una hoja de prueba y una de producción, y cuál es cuál.
- [x] Conteos y duraciones: ver `docs/AUDITORIA_DATOS.md`.

### 14.2 Proyecto de Apps Script

- [x] `appsscript.json` (zona horaria, webapp, V8).
- [ ] Lista de archivos reales (puede haber más que `Código.gs` e `Index.html`).
- [ ] Versión desplegada y confirmación de que los archivos locales son esa versión.
- [ ] Triggers instalados (nombre, tipo, horario, última ejecución). Se sabe que hoy no hay triggers de alertas.
- [ ] Nombres de las propiedades del script (no los valores secretos).
- [ ] Edición de Google Workspace (para cuota de correo) y si la app está embebida en Google Sites.

### 14.3 Personas y permisos

- [x] Cuentas iniciales: `josoriodi@unal.edu.co` y `labdatos_paz@unal.edu.co`.
- [ ] Correo(s) del responsable técnico que valida mantenimiento.
- [ ] Quién más debe recibir avisos de mantenimiento, reportes y mensajes de contacto.
- [ ] Si los laboratoristas pueden cancelar reservas o solo el admin.

### 14.4 Políticas y operación

- [ ] Confirmar D-02 a D-14 (sobre todo D-02, D-03, D-04 y D-13).
- [ ] Horario del laboratorio y si las reservas pueden cruzar noches/fines de semana.
- [ ] Si una reserva de más de 24 h requiere justificación/aprobación.
- [ ] Reglas de cancelación, no-show y penalizaciones.
- [ ] Frecuencias de mantenimiento por tipo de equipo y quién las define.

### 14.5 NFC/QR y diseño

- [x] Las etiquetas NFC/QR usan la URL estable + `?asset=UNAL-XX`.
- [x] El script `scripts/generar_qr_ladme.py` ya genera las placas.
- [ ] Inventario de etiquetas: equipo, si son reescribibles, si hay impresora de etiquetas.
- [ ] Imágenes de referencia del pase Luma, logo, colores institucionales y tipografías.

### 14.6 Supabase / TI

- [x] Decisión: **solo Supabase, sin Google Cloud**.
- [ ] ¿Puedes crear el proyecto de Supabase? ¿Con qué cuenta/organización?
- [ ] ¿Hay dominio o subdominio para la PWA? ¿HTTPS?
- [ ] ¿Hay restricciones de residencia de datos o de servicios externos?
- [ ] SMTP para los correos de autenticación (Supabase integrado tiene límite bajo).

---

## 15. Primer sprint concreto

1. Confirmar D-02, D-03, D-04, D-13 y D-14 (las que bloquean el diseño).
2. `clasp pull` o comparación con la versión desplegada; commit base y tag `pre-refactor`.
3. Exportar `Reservas_CONTACTOS` y `Bloqueos_LADME`; completar la copia de seguridad.
4. Crear deployment de prueba; correr las pruebas actuales; guardar línea base.
5. Retirar Wallet en una rama; probar; desplegar a prueba.
6. Modularizar en otra rama; probar; desplegar a prueba.
7. Implementar 168 h + una extensión + soft-cancel + abuelo D-13; pruebas de borde.
8. En paralelo, spike de Supabase: aplicar esquema, auth magic link, una RPC y una pantalla de disponibilidad.

**Definición de "hecho" del sprint:** Wallet fuera, módulos separados, política de 168 h/una extensión aplicada en servidor sin romper las reservas activas, y una PWA de prueba con login y disponibilidad.

---

## 16. Anexo: referencias rápidas

Todas las referencias de código son a `appsscript/Código.gs` y `appsscript/Index.html`.

- `Código.gs:11` — `ADMIN_EMAILS`.
- `Código.gs:17` — `CUENTA_REMITENTE`.
- `Código.gs:110` — `requireAdmin_`.
- `Código.gs:189` — `doGet` (aquí va el redirect de `?asset=` a la PWA).
- `Código.gs:419` — `registrarReserva`.
- `Código.gs:876` — `obtenerFichaEquipo`.
- `Código.gs:1121` — `extenderDesdeFicha`.
- `Código.gs:1435` — `obtenerDatosAdmin`.
- `Código.gs:1558` — `cancelarReserva`.
- `Código.gs:1722` — `archivarReserva_`.
- `Código.gs:1801-2066` — Wallet (a eliminar).
- `Index.html:1035-1037` — botón de Wallet (a eliminar).
- `db/schema_ladme.sql:66-70` — políticas.
- `db/schema_ladme.sql:76-102` — reservas y exclusión.
- `db/schema_ladme.sql:124-132` — cola de notificaciones.
- `db/schema_ladme.sql:158-183` — mantenimiento.
- `db/schema_ladme.sql:290-308` — `extender_reserva` (choque con 168 h).
