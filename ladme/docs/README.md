# `docs/` — documentación del proyecto

| Documento | Qué contiene |
|---|---|
| `ROADMAP.md` | Hoja de ruta completa: auditoría, decisiones, fases, políticas, alertas, mantenimiento, PWA y migración |
| `Contexto.md` | Encargo original y visión de la PWA |
| `AUDITORIA_DATOS.md` | Radiografía anonimizada de las hojas reales (131 reservas, 16 equipos, duraciones, problemas de calidad) |

## Documentos previstos

| Documento | Cuándo |
|---|---|
| `ARQUITECTURA.md` | Al iniciar la Fase 6; diagrama de componentes y flujos |
| `POLITICAS.md` | Al cerrar D-02 a D-14; reglas exactas y valores por defecto |
| `OPERACION.md` | Al cerrar la Fase 0; runbook de correo, backups, deployment y rollback |
| `MIGRACION.md` | Antes del cutover; mapeo Sheets → Postgres y verificación de conteos |

## Reglas

1. Las decisiones se documentan aquí, no solo en comentarios de código.
2. Todo dato personal se anonimiza en la documentación.
3. Si un documento queda obsoleto, se marca como histórico o se mueve a `legacy/`; no se deja ambiguo.
