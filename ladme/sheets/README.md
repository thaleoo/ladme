# `sheets/` — exportaciones de las hojas

**Esta carpeta contiene datos personales. No se versiona.**

El `.gitignore` de la raíz excluye `*.xlsx`, `*.xls`, `*.csv` y `*.ods`. Nunca hagas `git add -f` de estos archivos.

## Contenido esperado

| Hoja | Columnas | Estado |
|---|---|---|
| `Reservas_LADME` | 18: marca temporal, tipo de usuario, nombre, cédula, correo, programa, matrícula, fecha/hora inicio, fecha/hora fin, equipos, actividad, detalles, ID reserva, ID solicitud, desatendido, mensaje | Recibida |
| `Computadores_LADME` | 5: ID/placa, modelo, marca, ubicación, estado | Recibida |
| `Reservas_HISTORIAL` | 19: 4 de auditoría + 15 originales | Recibida (solo 3 filas) |
| `Reservas_CONTACTOS` | fecha, solicitante, equipo, ID reserva, titular, mensaje | **Falta** |
| `Bloqueos_LADME` | ID, equipo, desde, hasta, motivo, creado por, fecha creación, estado, cancelado por, fecha cancelación | **Falta** |

## Cómo exportar

1. En Google Sheets: **Archivo → Descargar → Microsoft Excel (.xlsx)**.
2. Guarda el archivo en esta carpeta.
3. No lo subas al repositorio.
4. Si necesitas compartirlo para análisis, anonimiza nombres, cédulas, correos y mensajes.

## Qué hacer antes de migrar

- Exportar las 5 hojas.
- Verificar que `Reservas_LADME` no tenga columnas más allá de R.
- Confirmar que los IDs de reserva no estén duplicados.
- Revisar las reservas de más de 168 h (`docs/AUDITORIA_DATOS.md`).
- Guardar una copia fuera de Drive.

## Privacidad

Los datos incluyen menores de edad y datos personales protegidos por la Ley 1581 de 2012. El acceso debe limitarse al personal del laboratorio. No los envíes por canales informales.
