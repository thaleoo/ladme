/**
 * Reglamento de uso que cada persona acepta una vez, en su primer ingreso.
 * BORRADOR: revíselo con la coordinación del laboratorio y edítelo aquí.
 * Si cambia de fondo, suba VERSION para dejar constancia en el repositorio.
 */
export const VERSION_REGLAMENTO = '2026-11'

export const REGLAMENTO: Array<{ titulo: string; texto: string }> = [
  {
    titulo: 'La reserva es personal',
    texto: 'Reserve solo para su propio trabajo académico y no preste su credencial. Usted responde por el equipo durante su reserva.'
  },
  {
    titulo: 'Registre su llegada y libere al terminar',
    texto: 'Marque su llegada al empezar. Si no va a usar el equipo, cancele; si termina antes, libérelo para que otra persona pueda usarlo.'
  },
  {
    titulo: 'Respete los procesos de otros',
    texto: 'No apague, reinicie ni cierre la sesión de un equipo con un proceso desatendido. Si necesita el equipo, escriba a quien lo tiene desde su ficha.'
  },
  {
    titulo: 'Cuide el equipo y el software',
    texto: 'No instale programas sin autorización, no desconecte periféricos ni mueva los equipos. No consuma alimentos ni bebidas junto a ellos.'
  },
  {
    titulo: 'Sus archivos son su responsabilidad',
    texto: 'Guarde su trabajo en su propio almacenamiento. El laboratorio puede limpiar los discos durante un mantenimiento.'
  },
  {
    titulo: 'Reporte las fallas',
    texto: 'Si algo no funciona, repórtelo desde la ficha del equipo. No intente repararlo por su cuenta.'
  },
  {
    titulo: 'Sus datos',
    texto: 'El laboratorio guarda su nombre, correo institucional, programa y el historial de sus reservas para operar el servicio y elaborar estadísticas de uso.'
  }
]
