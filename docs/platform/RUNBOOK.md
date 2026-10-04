# Runbook · plataforma de soporte

Cómo instalar, correr, reiniciar y verificar la plataforma en una máquina de desarrollo. Todos
los comandos de este archivo se probaron en macOS con las versiones de la tabla de requisitos.
Para la demo con jurados, ver [DEMO.md](./DEMO.md).

La plataforma tiene dos aplicaciones:

- `backend/`: API en FastAPI (Python 3.12, uv). Guarda todo en SQLite y siembra los datos de
  ejemplo al arrancar.
- `frontend/`: SPA en React (Vite, pnpm). Incluye el Workspace del equipo (`/analista`,
  `/supervision`, `/administracion`) y el simulador de cliente (`/cliente`). Una analista entra
  a **Inicio** (`/analista/inicio`): su disponibilidad ("Empezar a atender"), los contadores por
  estado (llevan a Casos con el filtro), "Lo primero", "Mientras no estabas" y "Tu equipo ahora".
  "Casos" (`/analista`) es la lista por urgencia y la conversación, con la "Ficha del cliente" a
  la derecha al pulsar el nombre.

Todas las personas, clientes y casos son inventados ("Datos de ejemplo").

## 1. Requisitos

| Herramienta | Versión probada | Para qué |
|---|---|---|
| [uv](https://docs.astral.sh/uv/) | 0.9 | Instala Python 3.12 (fijado en `backend/.python-version`) y las dependencias del backend |
| Node.js | 22 | Frontend |
| pnpm | 10 | Frontend |
| Chromium de Playwright | lo instala `pnpm e2e:install` | Solo para la suite e2e |

No hace falta Docker ni una base de datos externa.

## 2. Instalar

```bash
cd backend
uv sync                         # crea backend/.venv con las dependencias de ejecución y desarrollo

cd ../frontend
pnpm install                    # usa pnpm-lock.yaml
```

Ningún archivo `.env` es obligatorio: todas las variables tienen un valor seguro para desarrollo.

## 3. Correr backend y frontend juntos

Dos terminales, desde la raíz del repositorio:

```bash
# terminal 1 · API en http://127.0.0.1:8000
cd backend
uv run cc-api

# terminal 2 · SPA en http://localhost:5173
cd frontend
pnpm dev
```

- La primera vez, el backend crea `backend/cc_platform.db` y siembra los datos de ejemplo. Los
  tiempos de la historia sembrada (esperas, SLA, bloqueos) se calculan desde ese primer arranque.
- Con `CC_ENV=dev` (el valor por defecto) el backend se recarga solo al cambiar el código.
- Comprobar que todo responde:
  - `curl -s http://127.0.0.1:8000/api/v1/health` → `{"status":"ok","checks":{"database":"ok"}}`
  - Swagger: http://127.0.0.1:8000/api/v1/docs
  - Ingreso del equipo: http://localhost:5173/login
  - Simulador de cliente: http://localhost:5173/cliente

Para entrar: cualquier cuenta de la [sección 5](#5-cuentas-sembradas), contraseña `demo1234`,
código de verificación `000000`.

**Varias personas a la vez.** La sesión vive en el `sessionStorage` de cada pestaña, así que
cada pestaña o ventana nueva (abierta escribiendo la URL) puede tener a otra persona del equipo
o a otro cliente del simulador. No uses "Duplicar pestaña": copia la sesión de la original.

### Otros puertos

```bash
# API en 8100 y SPA en 5180 (el origen de la SPA tiene que estar en CC_CORS_ORIGINS)
cd backend  && CC_PORT=8100 CC_CORS_ORIGINS='["http://localhost:5180"]' uv run cc-api
cd frontend && VITE_API_URL=http://localhost:8100 pnpm dev --port 5180 --strictPort
```

## 4. Variables de entorno

El backend lee variables con prefijo `CC_`, o un archivo `.env` en el directorio desde donde se
arranca (corre `uv run cc-api` dentro de `backend/`). Plantilla: `backend/.env.example`. Fuente
de verdad: `backend/src/cc_platform/bootstrap/settings.py`.

| Variable | Por defecto | Qué hace |
|---|---|---|
| `CC_ENV` | `dev` | `dev` recarga el código; `test` no recarga; `prod` se niega a arrancar (falta un proveedor real de MFA, exige `CC_SESSION_SECRET` propio y `CC_SEED_DEMO_DATA=false`) |
| `CC_BUILD` | `dev` | Identificador de la build que muestra `GET /api/v1/meta` |
| `CC_PERSISTENCE` | `sqlalchemy` | `memory` corre sin base de datos (todo se pierde al parar) |
| `CC_DATABASE_URL` | `sqlite+aiosqlite:///<repo>/backend/cc_platform.db` | Otra base SQLite (ruta absoluta: `sqlite+aiosqlite:////tmp/demo.db`) |
| `CC_DATABASE_ECHO` | `false` | Imprime el SQL |
| `CC_SEED_DEMO_DATA` | `true` | Siembra personas, clientes y casos de ejemplo si faltan |
| `CC_SESSION_SECRET` | secreto de desarrollo | Firma HMAC de los tokens de sesión |
| `CC_SESSION_TTL_MINUTES` | `480` | Duración de una sesión del equipo |
| `CC_CUSTOMER_SESSION_TTL_MINUTES` | `480` | Duración de una sesión del simulador |
| `CC_LOCKOUT_MAX_ATTEMPTS` | `5` | Intentos fallidos antes de bloquear la cuenta |
| `CC_LOCKOUT_MINUTES` | `15` | Duración del bloqueo |
| `CC_MFA_TTL_SECONDS` | `300` | Vigencia del paso de verificación |
| `CC_MFA_MAX_ATTEMPTS` | `3` | Códigos erróneos por verificación |
| `CC_DEV_MFA_CODE` | `000000` | Código de verificación de desarrollo |
| `CC_ARGON2_TIME_COST`, `CC_ARGON2_MEMORY_COST`, `CC_ARGON2_PARALLELISM` | `3`, `65536`, `4` | Costo del hash de contraseñas |
| `CC_CORS_ORIGINS` | `["http://localhost:5173","http://127.0.0.1:5173"]` | Orígenes de la SPA permitidos (lista JSON) |
| `CC_HOST`, `CC_PORT` | `127.0.0.1`, `8000` | Dirección de `uv run cc-api` |
| `CC_REALTIME_QUEUE_SIZE` | `256` | Mensajes en cola por conexión WebSocket |
| `CC_REALTIME_EXPIRY_CHECK_SECONDS` | `30` | Cada cuánto un socket inactivo revisa si su sesión venció |
| `CC_LOG_LEVEL` | `INFO` | Nivel de log |
| `CC_LOG_FORMAT` | `json` | `console` para leer los logs en la terminal |

Frontend (`frontend/.env.local`, plantilla en `frontend/.env.example`):

| Variable | Por defecto | Qué hace |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8000` | URL de la API. El WebSocket usa el mismo origen (`ws://…/api/v1/ws`) |

## 5. Cuentas sembradas

Al entrar, una analista llega a **Inicio** (`/analista/inicio`); "/" también la lleva ahí. "Mientras
no estabas" cuenta desde el fin de su sesión anterior; en su primera sesión, desde 8 horas atrás
(por eso la semilla ya muestra sus casos recientes). Los equipos se llaman "Equipo Andes", "Equipo
Pacífico" y "Equipo Caribe" desde el slice 6: una base creada antes conserva los nombres viejos
("Disputas · …"); reiníciala (sección 6) para verlos como en la demo.

Todas usan la contraseña **`demo1234`** y el código de verificación **`000000`**. Correo:
`nombre.apellido@latambank.example` (sin tildes).

| Persona | Correo | Roles | Idiomas | Equipo | Estado al arrancar |
|---|---|---|---|---|---|
| Daniela Ríos | `daniela.rios@` | Analista | español, portugués | Equipo Andes | En pausa, sin sesión. 5 casos abiertos y 3 cerrados (ver abajo) |
| Julián Ortega | `julian.ortega@` | Analista | español | Equipo Andes | En pausa **con una sesión sembrada** (aparece "En pausa" en Equipo y colas). 2 casos abiertos |
| Paula Medina | `paula.medina@` | Analista | español | Equipo Pacífico | En pausa, sin casos |
| Sebastián Cárdenas | `sebastian.cardenas@` | Analista | español, portugués | Equipo Pacífico | En pausa, sin casos |
| Tomás Arango | `tomas.arango@` | Analista | español, portugués | Equipo Pacífico | En pausa, sin casos |
| Felipe Echeverri | `felipe.echeverri@` | Analista + Supervisora | español | Equipo Andes | En pausa, sin casos. Usa el selector de rol (Casos ↔ Equipo y colas) |
| Lucía Herrera | `lucia.herrera@` | Supervisora | español, portugués | Equipo Andes | Activa |
| Martín Salazar | `martin.salazar@` | Supervisora | español | Equipo Pacífico | Activa |
| Renata Villalba | `renata.villalba@` | Supervisora | español, portugués | Equipo Pacífico | Activa |
| Mariana Duque | `mariana.duque@` | Supervisora | español | Equipo Pacífico | **Bloqueada** por 5 contraseñas erradas, hasta 13 min después del primer arranque. Una administradora la desbloquea |
| Valeria Quintero | `valeria.quintero@` | Administración | español | Administración de la plataforma | Activa |
| Carolina Peña | `carolina.pena@` | Administración | español | Administración de la plataforma | Activa |
| Andrés Villamil | `andres.villamil@` | Analista | español | Equipo Andes | **Desactivada** (Carolina la desactivó). No puede entrar |

Además existe el equipo inactivo "Equipo Caribe", sin miembros.

**Nadie empieza disponible.** Las colas sembradas tienen casos que nadie disponible podía tomar
(regla 3), así que una analista disponible las contradiría. Cuando alguien pasa a "Disponible",
las colas de sus idiomas se vacían hacia ella (el caso más antiguo primero) y los chats nuevos le
llegan.

### Casos sembrados

| Caso | Cliente | Dónde está |
|---|---|---|
| 101 | Marcela Quintana Pardo (es-CO) | Daniela · Por responder |
| 102 | Beatriz Salcedo Prieto (es-CO) | Daniela · Por responder, SLA en riesgo |
| 103 | Larissa Monteiro Alves (pt-BR) | Daniela · Nuevo, en portugués |
| 108 | Patricia Lozano Vega (es-MX) | Daniela · Nuevo, "Volvió a escribir" (casos anteriores 104 y 110) |
| 107 | Joaquín Ferreyra Paz (es-AR) | Daniela · Esperando al cliente |
| 104, 105, 106 | Patricia, Claudia, Héctor | Daniela · Cerrados en los últimos 7 días |
| 110 | Patricia | Cerrado por Julián hace 20 días (fuera de la ventana de 7 días) |
| 113 | Camila Torres Benavides (es-CO) | Julián · Por responder, SLA vencido |
| 114 | Esteban Morales Quiroga (es-CO) | Julián · Esperando al cliente (Lucía se lo reasignó desde Paula) |
| 111 | Rosa Elena Ibarra Méndez (es-MX) | Cola en español, SLA en riesgo |
| 112 | Mauricio Achával Ríos (es-AR) | Cola en español, prioridad alta, SLA vencido |
| 109 | Gabriela Duarte Melo (pt-BR) | Cola en portugués |

Los ids completos son `CASE-` seguido del número relleno con ceros hasta 26 dígitos (por ejemplo
`CASE-00000000000000000000000109`). Valores generados por el equipo (no vienen del dataset): SLA de
primera respuesta (alta 5 min · media 15 min · baja 60 min), la ventana de 7 días de Cerrados, los
nombres de las colas y los motivos de cierre.

### Clientes del simulador

En `/cliente` se elige un cliente y se escribe como él, sin contraseña. Los clientes nuevos
abren un caso con su primer mensaje:

| Cliente | Idioma del simulador | Ciudad |
|---|---|---|
| Natalia Guzmán Rincón | español de Colombia | Bogotá |
| Ximena Robles Treviño | español de México | Ciudad de México |
| Lucas Benítez Sosa | español de Argentina | Córdoba |
| Rafael Nogueira Costa | portugués de Brasil | Buenos Aires |
| Andrés Felipe Cardona | español de Colombia | Medellín |

También aparecen los clientes de los casos sembrados: con "Conversación abierta" se continúa su
caso; Claudia y Héctor tienen una conversación cerrada, y si escriben se abre un caso nuevo
vinculado al anterior. Calificaciones sembradas (slice 7): Héctor ya calificó su caso
("¡Gracias! Calificaste: Bien"); a Claudia el simulador le muestra la encuesta (o "Ahora no").
Patricia calificó sus casos anteriores 104 (Excelente, con comentario) y 110 (Bien).

## 6. Reiniciar la base de datos

No hay migraciones: el esquema se crea al arrancar. Para volver al estado inicial (y re-anclar
los tiempos de la historia sembrada):

```bash
# detén el backend (Ctrl+C) y luego
rm backend/cc_platform.db
cd backend && uv run cc-api      # crea la base y siembra de nuevo
```

- Alternativa sin archivo: `CC_PERSISTENCE=memory uv run cc-api` (cada arranque empieza de cero).
- El sembrado nunca reescribe filas existentes: reiniciar el backend sin borrar la base conserva
  todo lo que se hizo.
- Después de traer cambios que tocan el esquema hay que borrar la base (ver
  [OutdatedSchemaError](#la-api-no-arranca-outdatedschemaerror)).
- Las pestañas del equipo abiertas antes del reinicio tienen sesiones que ya no existen: vuelven al
  ingreso y hay que entrar de nuevo.

## 7. Regenerar los tipos de la API

OpenAPI es el contrato entre las dos aplicaciones. Después de cualquier cambio en la API:

```bash
cd backend  && uv run python -m cc_platform.scripts.export_openapi   # escribe backend/openapi.json
cd frontend && pnpm gen:api                                          # escribe src/lib/api/schema.gen.ts
```

Comprobación sin escribir: `uv run python -m cc_platform.scripts.export_openapi --check` y
`pnpm check:api`. Las dos fallan si el archivo está desactualizado; la del backend también corre
dentro de `pytest`.

## 8. Verificaciones (quality gates)

Todas deben pasar antes de dar un cambio por terminado (brief §6):

```bash
cd backend
uv run ruff check .
uv run ruff format --check .
uv run mypy src
uv run pytest -q

cd ../frontend
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm format:check
pnpm check:api
```

`pytest` tarda alrededor de un minuto y medio; `pnpm test`, unos diez segundos.

## 9. Suite e2e (Playwright)

```bash
cd frontend
pnpm e2e:install     # una vez: descarga Chromium para Playwright
pnpm e2e             # corre los escenarios en el navegador
```

La suite levanta su propio backend sobre una base SQLite temporal y nueva, y su propio Vite, en
puertos libres. No usa ni modifica `backend/cc_platform.db` y no necesita que la app esté
corriendo. Los escenarios están en `frontend/e2e/` y la configuración en
`frontend/playwright.config.ts`.

Para correr una parte: `pnpm e2e e2e/auth.spec.ts` (un archivo) o `pnpm e2e -g "Casos anteriores"`
(por título). Qué cubre cada escenario, las reglas de aislamiento y los huecos conocidos están en
[api/slice-5-e2e.md](./api/slice-5-e2e.md).

## 10. Problemas frecuentes

### Puerto en uso

Síntomas: el backend termina con `[Errno 48] error while attempting to bind on address
('127.0.0.1', 8000): address already in use`; Vite con `--strictPort` dice `Port 5173 is already
in use`. Sin `--strictPort`, Vite toma otro puerto (5174…) y la SPA no puede hablar con la API
porque ese origen no está en `CC_CORS_ORIGINS`.

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN     # quién usa el puerto (igual con 5173)
kill <PID>
```

O usa otros puertos (sección 3, "Otros puertos").

### La API no arranca: `OutdatedSchemaError`

```
OutdatedSchemaError: The database schema is older than the code (missing tables: admin_roster).
Delete the local database (e.g. backend/cc_platform.db) and restart; there are no migrations yet.
```

La base fue creada por una versión anterior. Borra `backend/cc_platform.db` y arranca de nuevo
(sección 6). Se pierden los datos locales; el sembrado los recrea.

### "No hay conexión con el servidor" al entrar

La SPA no alcanza la API. Revisa que el backend esté corriendo (`/api/v1/health`), que
`VITE_API_URL` apunte a él (reinicia `pnpm dev` después de cambiarla) y que el origen exacto de
la SPA (`http://localhost:5173` no es lo mismo que `http://127.0.0.1:5173` ni que otro puerto)
esté en `CC_CORS_ORIGINS`.

### Cuenta bloqueada

Cinco intentos fallidos (contraseñas o códigos de verificación) bloquean la cuenta 15 minutos y la
pantalla muestra "Tu cuenta está bloqueada por 15 minutos". Opciones:

- Una administradora (Valeria o Carolina) abre **Usuarios y roles**, elige a la persona y pulsa
  **Desbloquear**. Por API:
  `curl -s -X POST localhost:8000/api/v1/admin/users/<STF-…>/unlock -H 'Authorization: Bearer <token de administración>'`.
- Esperar los 15 minutos.
- Reiniciar la base (sección 6). Mariana Duque empieza bloqueada a propósito.

### El chat no se actualiza en vivo (WebSocket)

Los cambios llegan por un único WebSocket por pestaña, `ws://<API>/api/v1/ws?token=…`. Si los
mensajes solo aparecen al recargar:

1. En las herramientas del navegador, pestaña Red, filtra por `ws` y mira el estado y el código
   de cierre de la conexión.
2. `4401`: el token ya no vale (cerraste sesión, venció, la cuenta se desactivó, se restableció
   la contraseña o se reinició la base). La SPA vuelve al ingreso; entra de nuevo.
3. `4409`: una administradora cambió los roles de esa persona. El cliente se reconecta solo y
   recarga el menú; no hace falta nada.
4. Sin conexión o reintentos continuos: el backend no está corriendo, `VITE_API_URL` apunta a
   otro lado o hay un proxy que no deja pasar WebSockets. El cliente reintenta con espera
   creciente y vuelve a pedir los datos al reconectarse.
5. Pestaña duplicada o dos personas en la misma pestaña: abre una pestaña nueva por persona.

Notas: el hub de tiempo real vive en el proceso del backend (un solo worker). Si corres la API
con varios workers, los mensajes en vivo no cruzan entre ellos.
