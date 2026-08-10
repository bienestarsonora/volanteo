# Corrección: recorte estricto de calles

- Toda geometría vial se recorta nuevamente contra el polígono antes de dibujarse.
- El recorte también se aplica a datos antiguos y caché.
- Se cambió la clave de caché para no reutilizar análisis previos defectuosos.
- Mientras se dibuja una nueva zona, las rutas anteriores muestran solo su contorno para evitar confusión visual.
- Al guardar, `streetSegments` se persiste ya recortado al polígono de la ruta.
