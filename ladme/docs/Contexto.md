Vamos a cambiar el enfoque: ya no vamos a construir un sistema de pases para Google Wallet, sino una plataforma web progresiva (PWA) integral para la gestión del Laboratorio de Datos de la UNAL Sede de La Paz.

Te preparé un documento para Claude. Está redactado como un encargo técnico y de arquitectura, no simplemente como una descripción de ideas. La intención es que Claude entienda el proyecto, audite lo que ya existe y nos ayude a evolucionarlo sin destruir el trabajo realizado.

# Proyecto: Plataforma PWA de gestión del Laboratorio de Datos — UNAL Sede de La Paz

## 1. Contexto y cambio de objetivo

Vamos a reorientar el proyecto del Laboratorio de Datos de la Universidad Nacional de Colombia, Sede de La Paz.

Inicialmente, el objetivo era mejorar el sistema de reservas de computadores y explorar la generación de pases digitales mediante Google Wallet, tomando como referencia la experiencia visual de Luma.

Después de evaluar las posibilidades, hemos decidido cambiar el objetivo principal: **desarrollar una Progressive Web App (PWA) propia que centralice la gestión de reservas, equipos, usuarios, credenciales digitales y mantenimiento del laboratorio.**

Google Wallet deja de ser el centro del proyecto. Podrá considerarse una integración complementaria en el futuro, pero no debe condicionar la arquitectura.

Queremos construir un sistema propio, escalable, visualmente cuidado y que aproveche las herramientas y desarrollos que ya existen.

## 2. Situación actual del laboratorio

Actualmente contamos con los siguientes elementos:

- Google Sites del Laboratorio de Datos.
- Una hoja de cálculo de Google Sheets utilizada para el control de equipos y reservas.
- Código de Google Apps Script que gestiona parte del flujo de reservas.
- Etiquetas QR instaladas en los equipos, aunque actualmente todas conducen a la misma página del laboratorio.
- Pruebas con etiquetas NFC que redirigen a una aplicación web de Apps Script.
- Un formulario institucional para consultar disponibilidad y reservar equipos.

El funcionamiento actual del NFC es el siguiente:

1. El usuario acerca su teléfono al NFC del computador.
2. Se abre una aplicación web de Google Apps Script.
3. El sistema consulta la disponibilidad de los equipos en Google Sheets.
4. El usuario establece un intervalo de tiempo, incluyendo fecha y hora de inicio y finalización.
5. El sistema consulta la agenda y muestra los equipos disponibles.

Existen algunas limitaciones que queremos resolver:

- La gestión de reservas todavía depende demasiado de formularios y hojas de cálculo.
- Queremos evitar las reservas simultáneas de un mismo equipo.
- Necesitamos gestionar extensiones de horario y cancelaciones.
- No tenemos un sistema centralizado de credenciales digitales.
- Queremos mejorar la identificación de los usuarios.
- Necesitamos un panel administrativo para gestionar equipos, usuarios y mantenimiento.
- Queremos automatizar notificaciones y alertas.

**IMPORTANTE:** Ya contamos con el código de Apps Script, las hojas de cálculo y el sitio de Google Sites. Antes de proponer reemplazos, debes inspeccionar lo que existe. No queremos perder funcionalidades ni información.

## 3. Objetivo general

Desarrollar una PWA para que los estudiantes y demás usuarios autorizados puedan:

- Consultar los equipos disponibles.
- Reservar un computador o equipo.
- Consultar sus reservas activas y anteriores.
- Extender el tiempo de una reserva, cuando esté permitido.
- Cancelar una reserva.
- Recibir una credencial digital individual por cada reserva.
- Consultar el estado actualizado de esa credencial.
- Identificarse mediante un QR dinámico o identificador seguro.
- Acceder a la aplicación desde Android, iOS y computadores.

Los laboratoristas y administradores deberán disponer de un panel para gestionar todo el sistema.

La PWA debe poder instalarse desde el navegador sin necesidad de publicarse en Google Play Store o App Store.

## 4. Arquitectura tecnológica propuesta

Queremos evaluar y, si resulta conveniente, utilizar la siguiente arquitectura:

### Frontend
- HTML, CSS y JavaScript o un framework moderno como React.
- Diseño responsive, especialmente optimizado para teléfonos.
- Progressive Web App (PWA).
- Service Workers y Web App Manifest.
- Posibilidad de instalación en dispositivos móviles.
- Interfaz moderna y coherente con la identidad institucional.

### Backend y base de datos
- Supabase como plataforma principal.
- PostgreSQL para almacenar usuarios, equipos, reservas, credenciales e historial.
- Supabase Auth para autenticación.
- Supabase Realtime para reflejar cambios en tiempo real.
- Supabase Edge Functions para lógica de negocio y operaciones sensibles.

### Integraciones
- Google Sheets para exportación, reportes o compatibilidad temporal con el sistema actual.
- Google Apps Script durante la migración, cuando sea necesario.
- Correo electrónico institucional para notificaciones.
- Web Push para notificaciones del navegador, sujeto a compatibilidad y permisos.
- Google Wallet como integración futura y opcional.

No consideres estas tecnologías decisiones irrevocables. Evalúa su viabilidad, costos, limitaciones y compatibilidad con nuestra infraestructura institucional.

## 5. Módulo de reservas

Este será uno de los componentes centrales.

Cada reserva deberá contener, como mínimo:

- Identificador único.
- Usuario responsable.
- Correo institucional.
- Equipo reservado.
- Fecha de creación.
- Fecha y hora de inicio.
- Fecha y hora de finalización.
- Estado.
- Historial de modificaciones.

Estados iniciales propuestos:

- Pendiente.
- Activa.
- En curso.
- Finalizada.
- Cancelada.
- Vencida.

### Reglas de negocio

1. Un equipo no puede tener dos reservas incompatibles en el mismo intervalo.
2. La comprobación debe realizarse en el backend y en la base de datos, no solamente en el frontend.
3. Las operaciones simultáneas deben estar protegidas contra condiciones de carrera.
4. Un usuario podrá extender una reserva si el intervalo adicional está disponible y cumple las políticas del laboratorio.
5. Al extender una reserva, el sistema debe actualizar la información de la credencial correspondiente.
6. Al cancelar una reserva, la credencial debe quedar invalidada inmediatamente.
7. Las modificaciones deben quedar registradas en un historial.
8. Los administradores deben poder realizar modificaciones autorizadas.
9. Deben definirse políticas configurables de duración máxima, anticipación de reservas, tolerancia de llegada y extensiones.

No se deben permitir modificaciones que generen conflictos con otras reservas.

## 6. Módulo de credenciales digitales

Queremos conservar la experiencia visual de los pases de Luma, pero implementada directamente en nuestra PWA.

Cada reserva tendrá una credencial digital individual.

### Diseño

La referencia visual es el pase de Luma que hemos utilizado como inspiración y los diseños que hemos generado para el Laboratorio de Datos.

Características deseadas:

- Formato vertical, optimizado para móviles.
- Identidad visual de la Universidad Nacional de Colombia.
- Identificación del Laboratorio de Datos.
- Colores institucionales adaptados a una estética moderna.
- Diseño con esquinas redondeadas, jerarquía tipográfica y secciones bien diferenciadas.
- QR individual.
- Estado de la reserva claramente visible.

### Información de la credencial

Debe incluir:

- Nombre del laboratorio.
- Nombre o identificador del equipo.
- Identificador de reserva.
- Nombre del titular.
- Correo institucional.
- Fecha de reserva.
- Hora de inicio.
- Hora de finalización.
- Estado de la reserva.
- QR de validación.
- Instrucciones de uso.

### Actualización dinámica

Este es uno de los requisitos más importantes.

La credencial no debe contener información estática desconectada del sistema.

Ejemplo:

Un estudiante reserva el PC-017 entre las 2:00 p. m. y las 4:00 p. m.

El sistema genera su pase.

Posteriormente, el estudiante extiende su reserva hasta las 5:00 p. m.

La PWA debe reflejar automáticamente el nuevo horario.

Si cancela la reserva, el pase debe mostrar que está cancelado y dejar de ser válido.

Si una reserva finaliza, debe reflejar su estado correspondiente.

La credencial debe consultar o recibir actualizaciones de la fuente de datos central.

No queremos generar una nueva imagen del pase cada vez que cambie un dato.

## 7. Seguridad y validación del QR

Cada credencial tendrá un QR único asociado a una reserva.

El QR no debe contener información sensible ni conceder acceso por sí solo.

Debe contener un identificador aleatorio seguro o un token de validación que permita consultar el estado real de la reserva.

Al escanearlo:

1. Se consulta el backend.
2. Se identifica la reserva.
3. Se verifica que exista.
4. Se comprueba que no esté cancelada ni vencida.
5. Se comprueba el intervalo de validez.
6. Se muestra el resultado de la validación.

Posibles respuestas:

- Reserva válida.
- Reserva cancelada.
- Reserva vencida.
- Reserva todavía no vigente.
- Reserva no encontrada.

La validación debe poder realizarse desde el teléfono del laboratorista.

También debemos contemplar que una captura de pantalla del QR no debe permitir utilizar una reserva cancelada o modificada.

## 8. Módulo de equipos

Cada computador o equipo tendrá una ficha individual.

Información propuesta:

- Identificador único.
- Nombre del equipo.
- Categoría.
- Marca y modelo.
- Especificaciones.
- Ubicación.
- Estado operativo.
- Disponibilidad.
- Fecha de adquisición, si está registrada.
- Último mantenimiento.
- Próximo mantenimiento.
- Historial de intervenciones.
- Código QR.
- Identificador NFC.

Al acercar el teléfono al NFC o escanear el QR de un equipo, se abrirá directamente su ficha en la PWA.

Ejemplo:

`/equipos/PC-017`

Desde esa ficha se podrá consultar su disponibilidad y solicitar una reserva.

## 9. Módulo administrativo

Debe existir un panel privado para laboratoristas y administradores.

Funciones:

- Consultar todas las reservas.
- Consultar reservas activas y futuras.
- Buscar por usuario, equipo o identificador.
- Modificar o cancelar reservas según permisos.
- Validar credenciales mediante QR.
- Registrar nuevos equipos.
- Modificar información de equipos.
- Marcar equipos como fuera de servicio.
- Gestionar mantenimientos.
- Consultar historial de actividades.
- Gestionar permisos y roles.

Roles iniciales:

- Usuario.
- Laboratorista.
- Administrador.

Los permisos deben implementarse tanto en la interfaz como en el backend.

## 10. Módulo de mantenimiento

Queremos incorporar un sistema que permita:

- Registrar mantenimientos.
- Registrar fecha y responsable.
- Describir intervenciones.
- Definir próximas fechas de mantenimiento.
- Identificar equipos con mantenimiento próximo.
- Identificar mantenimientos vencidos.
- Marcar equipos como fuera de servicio.
- Consultar el historial de mantenimiento.

También queremos explorar notificaciones automáticas gratuitas o de bajo costo para los responsables.

## 11. Notificaciones

El sistema debería poder notificar:

- Confirmación de reserva.
- Modificación del horario.
- Extensión de reserva.
- Cancelación.
- Próxima finalización de una reserva.
- Cambios de disponibilidad.
- Alertas de mantenimiento.

Las notificaciones pueden implementarse inicialmente mediante correo electrónico y posteriormente mediante notificaciones push.

No queremos depender de servicios de pago sin evaluar primero alternativas gratuitas.

## 12. Panel de estadísticas

Queremos que el sistema pueda producir información útil para la administración del laboratorio:

- Cantidad de reservas.
- Horas de utilización por equipo.
- Equipos más utilizados.
- Horarios de mayor demanda.
- Reservas canceladas.
- Reservas no utilizadas.
- Historial de utilización.
- Equipos con mantenimiento pendiente.

Estos datos podrían ayudar a tomar decisiones sobre la distribución y el mantenimiento de los recursos.

## 13. Diseño y experiencia de usuario

La PWA debe sentirse como una aplicación real, no como un formulario institucional.

Buscamos:

- Diseño moderno y minimalista.
- Excelente experiencia móvil.
- Navegación sencilla.
- Animaciones sutiles.
- Estados visuales claros.
- Componentes reutilizables.
- Diseño coherente entre las vistas de usuario y administración.

La credencial digital debe ser uno de los elementos visualmente más importantes.

El diseño de referencia es el pase de Luma compartido en esta conversación, adaptado a la identidad del Laboratorio de Datos de la UNAL.

## 14. Estrategia de migración

No queremos reemplazar todo de golpe.

Propón una migración por etapas:

**Fase 1. Auditoría**

Inspeccionar Google Sites, Google Sheets y el código completo de Apps Script.

Documentar:

- Estructura actual de las hojas.
- Columnas y relaciones.
- Funciones existentes.
- Flujo de reservas.
- Integraciones.
- Identificadores de equipos.
- Dependencias y limitaciones.

**Fase 2. Arquitectura y base de datos**

Diseñar el esquema de PostgreSQL y las reglas de negocio.

Definir las relaciones entre usuarios, equipos, reservas y credenciales.

Preparar la estrategia para importar los datos existentes.

**Fase 3. MVP de reservas**

Construir autenticación, consulta de disponibilidad, creación, extensión y cancelación de reservas.

Implementar prevención de conflictos y permisos.

**Fase 4. Credenciales digitales**

Construir el diseño de pases, QR individual y validación en tiempo real.

**Fase 5. Panel administrativo**

Implementar gestión de equipos, usuarios, reservas y mantenimiento.

**Fase 6. Notificaciones y estadísticas**

Incorporar notificaciones, historial y analítica.

**Fase 7. Integración y migración definitiva**

Conectar NFC, QR existentes, Google Sites y Google Sheets según corresponda.

Realizar pruebas y migrar progresivamente a la PWA.

## 15. Requisitos no negociables

1. No destruir ni reemplazar código existente sin haberlo auditado.
2. No perder los datos actuales de equipos y reservas.
3. No utilizar Google Sheets como mecanismo exclusivo de prevención de reservas simultáneas.
4. No confiar en datos enviados por el frontend para validar reservas.
5. No generar credenciales estáticas desconectadas del backend.
6. Mantener un historial de cambios.
7. Implementar controles de acceso y seguridad.
8. Priorizar soluciones gratuitas o con planes gratuitos sostenibles.
9. Mantener la posibilidad de exportar información.
10. Construir una arquitectura que permita ampliar el sistema en el futuro.

## 16. Tu primera tarea

Antes de comenzar a programar, quiero que actúes como arquitecto de software y analices el proyecto existente.

Primero, solicita o inspecciona los archivos que te proporcionaré:

- Código de Google Apps Script.
- Archivo de Google Sheets o una exportación de sus hojas.
- Información del Google Sites.
- Cualquier documentación o material relacionado.

Después:

1. Reconstruye el funcionamiento actual.
2. Identifica qué funcionalidades podemos reutilizar.
3. Detecta problemas y riesgos.
4. Propón el esquema de base de datos.
5. Propón la arquitectura definitiva.
6. Establece un plan de migración.
7. Identifica los costos y las limitaciones de cada servicio.

**No empieces a construir toda la aplicación inmediatamente.** Primero presenta el diagnóstico y la arquitectura propuesta para que podamos aprobarlos.

El objetivo es desarrollar una plataforma institucional de gestión de recursos tecnológicos, no solamente una página que genere pases de reserva.

Queremos que el Laboratorio de Datos tenga un sistema propio, mantenible, escalable y con una experiencia de usuario de calidad.

### Una recomendación antes de enviárselo

A Claude le proporcionaría también estos tres materiales:

* El código completo de Apps Script.

* Una exportación de Google Sheets con todas sus pestañas y encabezados.

* El enlace de Google Sites: [https://sites.google.com/unal.edu.co/labdatospaz/inicio](https://sites.google.com/unal.edu.co/labdatospaz/inicio?utm_source=chatgpt.com)

Y, especialmente, le mostraría los dos diseños de pases que generamos. Así tendrá una referencia visual concreta.

Mi recomendación: no permitamos que Claude empiece a construir la PWA sin auditar primero el sistema actual. Tenemos lógica de reservas, identificadores NFC y QR que sería absurdo perder.

El resultado que buscamos es que el laboratorio termine teniendo su propio pequeño ecosistema digital, con la PWA como centro de operaciones.
