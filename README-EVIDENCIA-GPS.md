# Evidencia GPS de recorridos · actualización

Esta actualización agrega una capa de monitoreo y evaluación sobre el seguimiento operativo existente.

## Qué cambia

- La ubicación se registra únicamente desde **Iniciar recorrido** hasta **Finalizar**.
- Supabase conserva la huella GPS en `route_locations` aproximadamente cada 10 segundos mientras la ruta está activa.
- Administración reconstruye el recorrido real y lo compara visualmente con la ruta/zona programada.
- Cada reporte de cuadra queda como:
  - **Validada por GPS**: evidencia suficiente de ubicación reciente, precisión, tiempo y desplazamiento dentro de la zona.
  - **Requiere revisión**: el reporte se conserva, pero alguna regla de evidencia no se cumplió.
- En **Seguimiento** aparece `Ver recorrido GPS`, con distancia observada, duración, puntos GPS y detalle de cada cuadra.

## Reglas de validación actuales

Una cuadra queda validada cuando, desde el último reporte de esa misma persona (o desde el inicio de la ruta), existe:

- ubicación GPS reciente (máximo 45 s);
- precisión de hasta 100 m;
- al menos 3 puntos GPS;
- al menos 30 m de desplazamiento observado;
- al menos 30 s transcurridos;
- ubicación dentro de la zona delimitada.

Si una condición no se cumple, la cuadra se registra de todas formas pero aparece en amarillo como **Requiere revisión**. Esto evita perder información cuando hay mala señal GPS.

## Instalación

1. Ejecutar en Supabase SQL Editor:
   `supabase-fix-evidencia-gps-recorrido.sql`
2. Sustituir el contenido del repositorio GitHub Pages por este paquete completo.
3. Esperar a que termine GitHub Actions y recargar la web.

No se eliminan jornadas, rutas, brigadistas ni registros existentes.

## Nota operativa

La evidencia GPS permite detectar reportes hechos sin desplazamiento, demasiado rápido, sin señal suficiente o fuera de la zona. No constituye un mecanismo antifraude absoluto ni certifica por sí misma que se haya entregado un volante en cada domicilio; es evidencia administrativa para monitoreo y revisión.
