# Volanteo · Bienestar Sonora

Aplicación web para planeación y seguimiento territorial de difusión previa a Jornadas del Bienestar.

## Gestión operativa

- Jornadas: crear, editar, archivar y eliminar.
- Difusiones: crear, editar y eliminar individualmente.
- Al crear una Jornada, el calendario sugerido es opcional. Por defecto no se crean difusiones automáticas.
- Editar una difusión conserva sus rutas, equipos y avances.
- Eliminar una difusión también elimina sus rutas y limpia sus datos operativos asociados en Supabase.
- Rutas de volanteo y perifoneo, asignación flexible de brigadistas y seguimiento de campo.

## Publicación

Sube el contenido completo de esta carpeta al repositorio de GitHub Pages. La configuración actual de Supabase se mantiene en `assets/config.js`.

Esta actualización de gestión de difusiones no requiere ejecutar SQL adicional si el proyecto ya estaba funcionando con el esquema incluido.

## Ajustes operativos recientes
- La selección de brigadistas durante la creación de una ruta se conserva en memoria aunque el panel reciba refrescos desde Supabase. Solo se limpia al cambiar de ejercicio o al guardar la ruta.
- El mapa administrativo incluye búsqueda manual de colonia, lugar o dirección. Al elegir un resultado, la ubicación queda guardada como referencia de la Jornada en `app_state` y se muestra en el mapa.
- El buscador no usa autocompletado ni consultas automáticas; solo consulta cuando la persona pulsa **Buscar** o Enter. El endpoint puede cambiarse desde `assets/config.js` mediante `GEOCODER_ENDPOINT`.


## Ajuste del buscador del mapa
El buscador administrativo funciona únicamente como referencia temporal: seleccionar un resultado centra el mapa una sola vez, no guarda la sede ni bloquea el paneo/zoom. Al limpiar la búsqueda se elimina el marcador temporal.


## Ajuste de trazado lineal/perifoneo
- Durante el dibujo, el botón principal cambia a **Finalizar trazado** al existir al menos un tramo.
- Finalizar bloquea la captura accidental de nuevos puntos y conserva la distancia/meta calculada.
- El trazado puede reabrirse con **Continuar editando trazado** antes de guardar.


## Ajuste de análisis vial
El cierre de una zona ya no usa la descarga masiva de OSM como respaldo automático. El análisis vial tiene un límite de espera aproximado de 11 segundos; si las fuentes no responden, el polígono se conserva y se habilitan reintento y meta provisional.
