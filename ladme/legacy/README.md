# `legacy/` — artefactos obsoletos

Se conserva como registro histórico. **Nada de esta carpeta se importa desde el código actual.**

## `wallet/`

| Archivo | Qué era |
|---|---|
| `Wallet.md` | Guía operativa del pase de Google Wallet |
| `generar_imagenes_wallet.py` | Generador del logo/banner de los pases |

Google Wallet se retira por decisión **C-02**. El código todavía lo contiene; se eliminará en la Fase 1 siguiendo el checklist de `docs/ROADMAP.md`, sección 9.

### Antes de borrar la infraestructura

1. Guardar copia del proyecto y de las propiedades (nombres, no valores).
2. Opcional: borrar la clase y los objetos de Wallet por API.
3. Eliminar código y UI.
4. Borrar las propiedades `WALLET_*`.
5. Revocar la clave de la cuenta de servicio.
6. Probar todos los flujos.

Los recursos gráficos (logo, banner) pueden reutilizarse en la PWA, pero se copian con revisión; no se enlazan desde `legacy/`.
