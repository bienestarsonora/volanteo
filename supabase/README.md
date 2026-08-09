# Supabase

## Instalación

Ejecuta `schema.sql` completo en el SQL Editor de tu proyecto.

Después crea el primer usuario en **Authentication → Users** y conviértelo en administrador:

```sql
insert into public.profiles(user_id, role)
select id, 'admin'
from auth.users
where email = 'TU_CORREO@dominio.com'
on conflict (user_id) do update set role = 'admin';
```

## Tablas

- `profiles`: roles administrativos.
- `app_state`: planeación completa de la app.
- `brigadista_credentials`: catálogo operativo y PIN cifrado.
- `route_runtime`: avance actual por ruta.
- `route_reports`: reportes individuales de cuadra.
- `route_locations`: puntos GPS del recorrido.

## Realtime

El script agrega a la publicación `supabase_realtime`:

- `app_state`
- `route_runtime`
- `route_reports`

El panel administrativo se suscribe a estas tablas y refresca Seguimiento cuando recibe cambios.
