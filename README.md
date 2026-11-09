# LADME — repositorio de trabajo

Sistema de reservas de los equipos del **Laboratorio de Aprendizaje de Datos y Modelado Estadístico (LADME)**, Facultad de Ingeniería, Universidad Nacional de Colombia — Sede La Paz.

Este repositorio contiene:

- [`ladme/appsscript/`](ladme/appsscript/) — copia exacta del código que hoy corre en Google Apps Script.
- [`ladme/db/`](ladme/db/) — esquema PostgreSQL/Supabase (tablas, RLS, RPC, mantenimiento, notificaciones).
- [`ladme/pwa/`](ladme/pwa/) — PWA instalable en React + Vite + TypeScript, respaldada por Supabase.
- [`ladme/docs/`](ladme/docs/) — hoja de ruta, auditoría de datos y guía de despliegue.
- [`ladme/legacy/wallet/`](ladme/legacy/wallet/) — registro histórico de Google Wallet (retirado).
- [`ladme/scripts/`](ladme/scripts/) — utilidades locales (auditoría, QR, iconos).

## Estado

| Pieza | Estado |
|---|---|
| Apps Script + Google Sheets | En producción; se mantiene como respaldo y worker de correo durante la transición |
| Política de reservas | 168 h + una extensión de 24 h, máximo absoluto 192 h |
| Cancelaciones | Soft-cancel: la fila se conserva con `Estado = Cancelada` |
| Roles | usuario, laboratorista, administrador + permiso `validar_mantenimiento` |
| Mantenimiento | Registro, bloqueo del equipo, historial, validación técnica y avisos |
| PWA | Código completo; pendiente de conectar al proyecto Supabase real y publicar |
| Google Wallet | Retirado; solo queda como registro histórico |

## Inicio rápido

```bash
# PWA
cd ladme/pwa
cp .env.example .env.local   # complete las claves de Supabase
npm install
npm run dev

# Verificación de tipos y build de producción
npm run build
```

Guía completa, plataforma por plataforma: **[`ladme/docs/DESPLIEGUE.md`](ladme/docs/DESPLIEGUE.md)**.

## Reglas del repositorio

1. El código real de Apps Script vive en Google Apps Script; `ladme/appsscript/` es su copia exacta.
2. Las hojas exportadas contienen datos personales y **no se versionan** (ver `.gitignore`).
3. No se usa Google Cloud: la arquitectura objetivo es **solo Supabase**.
4. Nunca suba `.env.local`, claves de servicio, `service_role` ni credenciales SMTP.
5. Antes de tocar producción, lea las advertencias de [`ladme/README.md`](ladme/README.md).

## Estructura

```text
.
├── .gitignore
├── README.md
└── ladme/
    ├── appsscript/   # Código de Apps Script (copia de lo desplegado)
    ├── db/           # Esquema Supabase y migraciones
    ├── docs/         # Hoja de ruta, contexto, auditoría y despliegue
    ├── legacy/       # Artefactos obsoletos (Wallet)
    ├── pwa/          # Frontend React + Vite + TypeScript
    ├── scripts/      # Utilidades locales
    ├── sheets/       # Exportaciones de hojas (no versionadas)
    └── supabase/     # Edge Functions
```
