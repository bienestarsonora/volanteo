# Corrección de guardado de rutas

- Ninguna edición local se descarta durante el polling de Supabase.
- Guardar ruta espera confirmación real de Supabase antes de limpiar el trazado.
- Si falla la sincronización, la ruta no se da por guardada y el trazado se conserva para reintentar.
- Las lecturas remotas no pueden sobrescribir una mutación local pendiente.
- No requiere cambios de esquema SQL.
