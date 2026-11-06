# thaleo — repositorio de trabajo

Este repositorio contiene el proyecto **LADME** (Laboratorio de Datos, UNAL Sede La Paz).

- [`ladme/`](ladme/) — código, documentación, base de datos y scripts del sistema de reservas.
- [`ladme/README.md`](ladme/README.md) — puerta de entrada: estado, estructura y cómo desplegar.
- [`ladme/docs/ROADMAP.md`](ladme/docs/ROADMAP.md) — hoja de ruta: retirar Google Wallet y construir la PWA con Supabase.

## Reglas rápidas

1. El código real vive en **Google Apps Script**; `ladme/appsscript/` es su copia exacta.
2. Las hojas exportadas contienen datos personales y **no se versionan** (ver `.gitignore`).
3. No se usa Google Cloud: la arquitectura objetivo es **solo Supabase**.
4. Antes de tocar producción, lee las advertencias de `ladme/README.md`.

## Estructura

```text
.
├── .gitignore
├── README.md
└── ladme/
    ├── appsscript/   # Código de Apps Script (copia de lo desplegado)
    ├── db/           # Esquema Supabase y migraciones
    ├── docs/         # Hoja de ruta, contexto y auditoría
    ├── legacy/       # Artefactos obsoletos (Wallet)
    ├── pwa/          # Frontend de la PWA
    ├── scripts/      # Utilidades locales
    └── sheets/       # Exportaciones de hojas (no versionadas)
```
