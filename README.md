
## Configuración incluida en este paquete

Este ZIP ya está configurado para el proyecto Supabase `volanteo-bienestar-sonora`.
La URL del proyecto y la **Publishable key** pública ya están en `assets/config.js`.
No contiene `service_role`, secret key ni contraseña de base de datos.

# Volanteo · Centro de Operación Territorial

Versión **v33 · GitHub Pages + Supabase** preparada para publicarse como:

`https://bienestarsonora.github.io/volanteo/`

## Qué cambia respecto a la demo local

- GitHub Pages sirve toda la interfaz estática.
- Supabase conserva Jornadas, ejercicios, rutas, brigadistas y estados operativos.
- El administrador inicia sesión con **Supabase Auth**.
- Los brigadistas entran con **nombre + PIN**.
- Las ubicaciones, reportes de cuadras y estados se escriben en Supabase.
- El panel administrativo recibe cambios mediante **Supabase Realtime**.
- La vista de brigadista refresca su asignación/avance automáticamente mientras está abierta.
- El navegador ya no depende de `localhost`, PowerShell ni archivos `.bat`.

---


## v33 · Autenticación obligatoria y carga robusta del mapa

- `/admin/` ahora trabaja en modo **fail-closed**: el panel permanece oculto hasta confirmar una sesión válida de Supabase Auth y el rol `admin`.
- Si no existe sesión, se muestra únicamente la pantalla de acceso administrativo.
- Si Supabase no puede validar la sesión, el panel no se expone y aparece una opción de reintento.
- El mapa administrativo se inicializa solamente después de revelar el panel autenticado, evitando cálculos de tamaño sobre un contenedor oculto.
- Leaflet mantiene fallback entre varios CDN y el mapa incluye un botón de reintento sin perder la planeación.
- La carga de Supabase JS también tiene una fuente de respaldo.

> Esta actualización es solo de frontend: si ya ejecutaste `supabase/schema.sql`, **no necesitas volver a ejecutar el SQL**.

---

## 1. Crear el proyecto en Supabase

1. Crea un proyecto nuevo en Supabase.
2. En **SQL Editor**, abre y ejecuta completo:
   - `supabase/schema.sql`
3. En **Authentication → Users**, crea tu usuario administrador con correo y contraseña.
4. Regresa a **SQL Editor** y ejecuta, sustituyendo el correo:

```sql
insert into public.profiles(user_id, role)
select id, 'admin'
from auth.users
where email = 'TU_CORREO@dominio.com'
on conflict (user_id) do update set role = 'admin';
```

La aplicación usa RLS. No coloques nunca una `service_role` o secret key en GitHub.

---

## 2. Configurar la web app

Abre `assets/config.js` y pega únicamente:

```js
SUPABASE_URL: 'https://TU-PROYECTO.supabase.co',
SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_...'
```

Puedes obtener ambos valores desde **Supabase → Connect / Project Settings → API**.

> La publishable key está diseñada para usarse en aplicaciones cliente. La protección de los datos de esta app depende de las políticas RLS y RPC incluidas en `supabase/schema.sql`.

---

## 3. Publicar en GitHub

Crea un repositorio llamado exactamente:

`volanteo`

Dentro de la cuenta u organización:

`bienestarsonora`

Sube **el contenido de esta carpeta directamente a la raíz del repositorio**. No subas una carpeta `volanteo` dentro de otra.

La estructura raíz debe verse así:

```text
index.html
admin/
assets/
supabase/
.github/
.nojekyll
manifest.webmanifest
README.md
```

Haz push a `main`.

### GitHub Pages

En el repositorio:

**Settings → Pages → Build and deployment → Source → GitHub Actions**

El workflow `.github/workflows/pages.yml` publicará automáticamente cada push a `main`.

La URL esperada será:

`https://bienestarsonora.github.io/volanteo/`

Panel administrativo:

`https://bienestarsonora.github.io/volanteo/admin/`

---

## 4. Primer ingreso

### Administración

Entra a `/volanteo/admin/` e inicia sesión con el usuario que creaste en Supabase Auth.

La primera vez, si `app_state` está vacío, la app crea una estructura inicial. Después puedes eliminar los datos demo y crear tus Jornadas reales.

### Brigadistas

En **Equipo → Gestionar brigadistas**:

- crea o modifica el nombre;
- asigna un PIN de 4 a 6 dígitos;
- activa/desactiva a la persona.

El brigadista entra a `/volanteo/`, selecciona su nombre, introduce su PIN y solo recibe la asignación vigente que le corresponde.

**Importante:** los brigadistas precargados de la primera inicialización usan `1234`. Cámbialos antes de uso real.

---

## 5. Tiempo real

El backend separa la planeación del operativo de campo:

- `app_state`: Jornadas, ejercicios, rutas y asignaciones.
- `route_runtime`: estado actual de cada ruta.
- `route_reports`: cada cuadra reportada, con hora y ubicación cuando existe.
- `route_locations`: historial GPS.
- `brigadista_credentials`: PIN cifrado de cada brigadista.

`app_state`, `route_runtime` y `route_reports` quedan incorporadas a `supabase_realtime` desde el SQL de instalación.

---

## 6. Seguridad

- El administrador usa Supabase Auth.
- Las tablas internas tienen RLS habilitado.
- El visitante anónimo no recibe acceso directo a las tablas.
- La vista de brigadista opera mediante funciones RPC que validan su PIN y que la ruta realmente esté asignada a esa persona.
- El PIN se almacena cifrado mediante `pgcrypto`.
- **Nunca** publiques una clave `service_role`, secret key ni contraseña de base de datos en `config.js`.

Como GitHub Pages es público, evita colocar datos personales, credenciales o secretos directamente en HTML/JavaScript.

---

## 7. Recomendación antes de salir a campo

Haz esta prueba completa con dos dispositivos:

1. Admin crea una Jornada.
2. Admin selecciona el ejercicio.
3. Admin delimita zona y guarda una ruta.
4. Admin asigna uno o más brigadistas.
5. Brigadista entra con nombre + PIN.
6. Brigadista inicia recorrido.
7. Brigadista reporta una cuadra.
8. Admin confirma que Seguimiento cambia sin recargar.
9. Brigadista finaliza.
10. Admin confirma que la ruta aparece como finalizada y no puede reiniciarse desde campo.

Después de esa prueba, ya puedes usar la plataforma como piloto real.


## v33 — autenticación Supabase robusta
- Actualiza el cliente web de Supabase a 2.112.x, compatible con publishable keys actuales.
- Carga ESM con fallback UMD.
- Ninguna verificación puede quedar indefinidamente en estado “Verificando…”.
- Timeouts explícitos muestran un error recuperable si CDN, Auth o Data API no responden.


## Producción: autenticación administrativa
El login usa un formulario nativo, mensajes de estado visibles y archivos JS con nombres nuevos para evitar caché de builds anteriores en GitHub Pages.
