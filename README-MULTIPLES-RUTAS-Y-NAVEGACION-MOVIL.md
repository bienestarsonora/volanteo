# Ajuste operativo: múltiples rutas + navegación móvil

- El panel de brigadista puede cargar todas las rutas asignadas a la misma persona dentro del turno operativo vigente.
- Si hay más de una, aparece un selector de rutas con estado (Pendiente / En recorrido / Finalizada).
- El refresco de Supabase conserva la ruta que la persona está viendo.
- En Administración móvil aparece siempre “← Brigadas” y también existe la opción “Acceso brigadas” dentro del menú lateral.
- La sesión administrativa se conserva al regresar a brigadas.

## Paso requerido en Supabase
Ejecuta una sola vez `supabase-fix-multiples-rutas-brigadista.sql` en SQL Editor.
