# `appsscript/` — código de Google Apps Script

Esta carpeta es la **raíz de clasp** y contiene una **copia exacta** de lo que está desplegado en el proyecto de Apps Script.

## Archivos

| Archivo | Rol |
|---|---|
| `appsscript.json` | Manifiesto: zona horaria `America/Bogota`, V8, webapp `USER_DEPLOYING` + `DOMAIN` |
| `Código.gs` | Monolito actual: `doGet`, reservas, disponibilidad, ficha, contacto, bloqueos, admin, historial, correos, Wallet y pruebas |
| `Index.html` | UI completa con CSS y JavaScript inline |

> `Código.gs` conserva el acento porque así se llama en el proyecto remoto. No lo renombres sin coordinar el cambio en Apps Script.

## Reglas

1. **No hay build.** Apps Script ejecuta los archivos tal cual.
2. **No hay `import/export`.** Todos los nombres de funciones y constantes deben ser únicos en el proyecto.
3. **Sincronización manual o con clasp.** Si usas clasp, `.clasp.json` y `.clasprc.json` van en `.gitignore`.
4. **Copia completa, no fragmentos.** Si editas en un lado, replica el archivo entero en el otro.
5. **Deployment de prueba primero.** No edites y despliegues en caliente sobre producción.

## Configuración del deployment

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

- `USER_DEPLOYING`: los correos salen de la cuenta que despliega (`labdatos_paz@unal.edu.co`).
- `DOMAIN`: solo usuarios del dominio `unal.edu.co`.
- La URL del deployment se mantiene estable sobrescribiendo la misma implementación.

## Fase 2 — módulos previstos

| Nuevo archivo | Contenido |
|---|---|
| `Config.gs` | Constantes, hojas, encabezados, correos, políticas |
| `Utilidades.gs` | Escape HTML, IDs, fechas, formato |
| `Seguridad.gs` | Sesión, roles, `require*`, identidad en enlaces |
| `Hojas.gs` | Inicialización, columnas, bloqueos, idempotencia |
| `Equipos.gs` | Catálogo, disponibilidad, ficha, contacto |
| `Reservas.gs` | Crear, cancelar, extender, liberar, rápida, perfil |
| `Bloqueos.gs` | Validar, crear y cancelar bloqueos |
| `Mantenimiento.gs` | Intervenciones, plazos, validación, historial |
| `Alertas.gs` | Cola, deduplicación, recordatorios, triggers |
| `Correos.gs` | Plantillas y envíos |
| `Admin.gs` | Dashboard, ronda, cancelación admin |
| `Web.gs` | `doGet`, páginas, `include()` |
| `Pruebas.gs` | Pruebas existentes y nuevas |

`Index.html` se parte con `include()` en `Estilos.html`, `UiUsuario.html`, `UiAdmin.html`, `Modales.html` y `Scripts.html`.

No ejecutes la Fase 2 antes de tener el commit base y un deployment de prueba (ver `docs/ROADMAP.md`, Fase 0).
