# LADME — Laboratorio de Datos de la UNAL Sede La Paz

Sistema de reservas de los equipos del Laboratorio de Datos (LADME), Facultad de Ingeniería, Universidad Nacional de Colombia — Sede La Paz.

Hoy funciona como **web app de Google Apps Script + Google Sheets**. La hoja de ruta es retirar Google Wallet y evolucionar a una **PWA instalable con Supabase**, sin perder datos ni funcionalidad.

---

## Estado actual

| Pieza | Estado |
|---|---|
| Web app de reservas | **En producción** (Apps Script) |
| Datos | Google Sheets (`Reservas_LADME`, `Computadores_LADME`, historial, contactos, bloqueos) |
| Google Wallet | **Se retira**; el código aún lo contiene (Fase 1) |
| PWA + Supabase | **En diseño**; esquema SQL listo, sin frontend todavía |
| Repo | Organizado; código de Apps Script como copia exacta de lo desplegado |

Web app:
```
https://script.google.com/a/macros/unal.edu.co/s/AKfycbyPEF9QK4aD8EMmnV7Ro5HXEZenkxpQ3BA1HINFSZgmS4q3M1Ks8FAZ8JqvXeJkmLkm/exec
```

Etiquetas NFC y QR de equipos:
```
<URL>?asset=UNAL-13
```
La URL es estable: se actualiza sobrescribiendo el mismo deployment. **No hay que reimprimir etiquetas** cuando se migre; el `doGet` puede redirigir a la PWA.

---

## Estructura del repo

```text
ladme/
├── appsscript/     Código real de Apps Script (copia exacta de lo desplegado)
│   ├── appsscript.json
│   ├── Código.gs
│   └── Index.html
├── db/             Esquema PostgreSQL/Supabase y migraciones
├── docs/           Hoja de ruta, contexto, auditoría de datos
├── legacy/wallet/  Artefactos obsoletos de Google Wallet
├── pwa/            Frontend de la nueva PWA (aún sin código)
├── scripts/        Utilidades locales (QR, auditoría de hojas)
├── sheets/         Exportaciones de hojas — NO se versiona
└── README.md
```

Detalle de cada carpeta en su propio `README.md`.

---

## Configuración del deployment

`appsscript/appsscript.json`:

```json
{
  "timeZone": "America/Bogota",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "DOMAIN"
  }
}
```

Consecuencias:

- Los correos salen de la cuenta que **despliega**.
- `Session.getActiveUser()` funciona para visitantes del dominio `unal.edu.co`.
- El acceso está restringido al dominio UNAL.
- La zona horaria del script es `America/Bogota`.

**Cuentas iniciales:**

| Rol | Correo |
|---|---|
| Administrador | `josoriodi@unal.edu.co` |
| Laboratorio | `labdatos_paz@unal.edu.co` |

> En la configuración previa aparecía `josoriodi@una.edu.co`. Se asume que es un typo y el correo correcto es `@unal.edu.co`. Confirmar antes de desplegar.

---

## Cómo trabajar con el código

**Regla de oro:** el código real vive en Apps Script. `appsscript/` es una copia exacta, no una versión paralela.

1. Si editas en el editor de Apps Script, **copia el archivo completo** a `appsscript/` en el mismo commit.
2. Si editas localmente, **pega el archivo completo** en Apps Script antes de desplegar.
3. No renombres `Código.gs` sin actualizar el proyecto remoto: el nombre con acento es el actual.
4. No commitees `.clasp.json` ni credenciales.
5. Prueba en un deployment de prueba antes de tocar producción.

Cuando se modularice (Fase 2), `Código.gs` se parte en `Config.gs`, `Seguridad.gs`, `Admin.gs`, `Equipos.gs`, `Reservas.gs`, `Correos.gs`, `Mantenimiento.gs`, `Alertas.gs`, `Pruebas.gs` y `Web.gs`. Apps Script no tiene `import/export`: los nombres deben ser únicos en todo el proyecto.

---

## Datos y privacidad

- `sheets/*.xlsx` y `sheets/*.csv` contienen **nombres, cédulas y correos**. Están en `.gitignore` y **no deben subirse al repositorio**.
- No adjuntes esos archivos en issues, chats públicos ni correos masivos.
- La auditoría agregada y anonimizada está en `docs/AUDITORIA_DATOS.md`.
- Para volver a generarla:

```bash
python scripts/auditoria_xlsx.py "sheets/Alojamiento de código.xlsx"
```

No requiere dependencias externas.

---

## Scripts

| Script | Para qué |
|---|---|
| `scripts/auditoria_xlsx.py` | Radiografía agregada de las hojas, sin imprimir PII |
| `scripts/generar_qr_ladme.py` | Placas QR imprimibles para los equipos (`?asset=UNAL-XX`) |

Instalación del generador de QR:

```bash
pip install "qrcode[pil]" pillow
python scripts/generar_qr_ladme.py --url "<URL-del-deployment>"
```

Salida en `placas_qr/` (excluida del repo).

---

## Hoja de ruta

Lee **`docs/ROADMAP.md`**. Resumen:

| Fase | Qué |
|---|---|
| 0 | Baseline, backup, commit y deployment de prueba |
| 1 | Retirar Google Wallet |
| 2 | Modularizar Apps Script y HTML |
| 3 | Políticas: 168 h, una extensión, soft-cancel, no-show |
| 4 | Roles, equipos y mantenimiento |
| 5 | Alertas y reportes |
| 6 | PWA real con Supabase |
| 7 | Migración y cierre |

Decisiones ya confirmadas: **solo Supabase, sin Google Cloud**; Wallet se retira; URL y etiquetas se conservan.

Decisiones pendientes: tope total (168 o 192 h), roles, soft-cancel, no-show, máximo de reservas activas, auth por magic link, tratamiento de las reservas existentes de más de 168 h. Ver `docs/ROADMAP.md`, sección 2.

---

## Advertencias

1. **No borres filas de `Reservas_LADME`** para "limpiar": el historial es casi vacío y no se puede reconstruir.
2. **No apliques la regla de 168 h** a las reservas activas sin decidir D-13. Hay 5 activas y una futura de 707 h.
3. **No elimines el código de Wallet** hasta completar la Fase 1 con pruebas y backup.
4. **No commitees datos personales** ni claves de la cuenta de servicio.
5. **No cambies la URL del deployment** si quieres conservar las etiquetas NFC/QR impresas.
