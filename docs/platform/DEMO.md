# Guion de demo · plataforma de soporte

Demo de 7 a 10 minutos para jurados. Muestra la plataforma de punta a punta con personas reales
detrás de cada ventana: una clienta escribe, un analista la atiende en vivo, cierra el caso, la
clienta vuelve, supervisión reparte el trabajo respetando el idioma, todo queda en auditoría, y
administración da de alta a una persona nueva que recibe su primer caso.

Todo lo que se ve es "Datos de ejemplo": personas, clientes y casos inventados. Este guion se
ensayó completo sobre una base recién creada; los textos entre comillas son los que muestra la
pantalla.

## Antes de empezar (3 minutos antes)

1. Reinicia la base **justo antes** de empezar: los tiempos de la historia sembrada (esperas en
   cola, SLA) se cuentan desde el primer arranque. El paso 9 no depende de ese reloj: bloquea una
   cuenta en vivo.

   ```bash
   # con el backend detenido
   rm -f backend/cc_platform.db
   cd backend && uv run cc-api          # terminal 1
   cd frontend && pnpm dev              # terminal 2
   ```

   Detalles en [RUNBOOK.md](./RUNBOOK.md) (secciones 3 y 6).
2. Abre **tres ventanas** del navegador, una al lado de la otra, y escribe la URL en cada una
   (no dupliques pestañas: cada pestaña guarda su propia sesión):

   | Ventana | URL | Quién | Preparación |
   |---|---|---|---|
   | **A · Cliente** | http://localhost:5173/cliente | el simulador de cliente | Deja visible "Elige un cliente de ejemplo" |
   | **B · Analista** | http://localhost:5173/login | Felipe Echeverri, `felipe.echeverri@latambank.example` | Entra (contraseña `demo1234`, código `000000`). Llega a **"Inicio"** ("Estás en pausa"). No lo pongas disponible todavía |
   | **C · Supervisión y administración** | http://localhost:5173/login | Lucía Herrera, `lucia.herrera@latambank.example` | Entra. Queda en "Equipo y colas" |

   Durante la demo abrirás una cuarta pestaña para la persona nueva que crea administración.
3. Comprueba en C que la "Cola en portugués" tiene a Gabriela Duarte Melo y que la "Cola en
   español" tiene a Rosa y a Mauricio. Si no, reinicia la base (paso 1).

Por qué Felipe: habla solo español y tiene los roles Analista y Supervisora. Eso hace visible la
regla del idioma (regla 3) y que los roles se combinan.

## Guion

### 1. Qué es (0:00 – 0:45)

**Decir:** "Es la plataforma de soporte de LATAM Bank. Clientes y equipo conversan por chat, de
principio a fin, entre personas. Hay tres roles que se combinan: Analista atiende casos,
Supervisora reparte el trabajo y revisa la auditoría, Administración gestiona cuentas, roles,
idiomas y equipos. A la izquierda está el simulador que reemplaza la app del cliente; al centro,
un analista; a la derecha, supervisión."

### 2. El analista empieza en "Inicio" y se pone disponible (0:45 – 1:30)

**Señalar en B (Inicio):** el saludo, el bloque "Estás en pausa" con "Sin casos nuevos", los
cuatro contadores (Por responder, Nuevos, Esperando al cliente, Cerrados), "Lo primero" (sus casos
abiertos por lo que vence antes), "Mientras no estabas" (lo que pasó en sus casos desde su
sesión anterior: plantillas fijas, nada generado) y "Tu equipo ahora" (cuántos están disponibles y
cuántos casos esperan en la cola de sus idiomas, sin nombres).

**B (Felipe):** pulsa **"Empezar a atender"**.

**Se ve:** "Estás disponible"; llegan Rosa Elena Ibarra Méndez y Mauricio Achával Ríos: aparecen
en "Lo primero" y en "Mientras no estabas" como "Te llegó desde la cola" con "Esperó n min". El
contador "Nuevos" pasa a 2 y el menú "Casos" muestra la insignia de "Por responder" cuando la
haya. En **C**, la "Cola en español" queda en 0; la "Cola en portugués" sigue con Gabriela.

**B:** en "Lo primero", pulsa **"Abrir"** en Rosa: se abre "Casos" con su caso y el filtro
"Nuevos" (el chip "Nuevos ✕" lo quita y vuelve a todos los casos abiertos).

**Decir:** "Mientras nadie estaba disponible, los casos esperaron en la cola de su idioma. Felipe
se puso disponible y le llegaron los de español, el más antiguo primero. El de Gabriela es en
portugués y Felipe no habla portugués: sigue esperando. Esa es la regla 3: un caso en portugués
solo lo atiende alguien que habla portugués."

### 3. Una clienta escribe y el analista la atiende en vivo (1:30 – 3:00)

**A (cliente):** elige **Natalia Guzmán Rincón** (Español de Colombia). Escribe
`Hola, no reconozco un cargo de $250.000 en mi tarjeta` y pulsa **Enviar**.

**Se ve en A:** "Te atiende Felipe · LATAM Bank" y el aviso "Recibimos tu mensaje. En unos minutos
te responde una persona del equipo."

**Se ve en B, sin recargar:** el aviso "Te llegó un caso nuevo" y la tarjeta de Natalia con la
etiqueta "Nuevo" y el tiempo de su primera respuesta (reloj; llama naranja cuando faltan 5 minutos
o menos, llama roja "Vencido" si ya pasó).

**B:** abre la tarjeta de Natalia.

**Señalar:** el encabezado (solo el nombre y el número de caso copiable) y la fila **"Cómo llegó
a ti"** (Estabas disponible, Hablas español). Pulsa el **nombre de Natalia**: se abre a la derecha
la **"Ficha del cliente"** (Cliente, Este caso, Cómo llegó a ti, Casos anteriores). Ciérrala con
Escape o con el botón. La nota interna de asignación solo la ve el equipo.

**B:** escribe `Hola Natalia, soy Felipe. ¿Me confirmas la fecha del cargo?` y pulsa Enter.
**A:** la respuesta aparece al instante. Contesta `Fue ayer en la noche`.
**B:** el mensaje aparece y la tarjeta pasa a "Por responder".

**Decir:** "Son dos navegadores conectados por un WebSocket. Cada caso tiene una sola persona
asignada y solo ella escribe. La lista de Casos va por urgencia; los filtros por estado se eligen
desde Inicio."

### 4. Cerrar con motivo (3:00 – 4:00)

**B:** pulsa **"Cerrar caso"**. En el diálogo:

- elige el motivo **"Resuelto"** (obligatorio; son tarjetas con ícono y significado: Resuelto,
  El cliente no respondió, Duplicado, Fuera de alcance y Otro);
- en **"Nota interna (opcional)"** escribe `Cargo identificado; se explicó a la clienta.`;
- señala **"El cliente verá"**: el aviso de cierre, sin el motivo ni la nota.

Pulsa **"Cerrar caso"**.

**Se ve:** en B la lista pasa al siguiente caso; en Inicio el contador "Cerrados" (últimos 7
días, solo lectura) sube a 1. En A: "Conversación terminada" y "La conversación terminó. Si
necesitas algo más, escríbenos y te atendemos en una nueva conversación."

### 5. La clienta vuelve: caso nuevo vinculado (4:00 – 5:00)

**A:** escribe `Hola de nuevo, ahora me llegó otro cargo` y envía.

**Se ve en A:** la conversación anterior queda arriba, en "Conversaciones anteriores", y empieza
una nueva con Felipe.

**Se ve en B:** una tarjeta nueva de Natalia con la etiqueta **"Volvió a escribir"**. Ábrela: la
nota interna "Natalia volvió a escribir. Su caso anterior se cerró … (resuelto)." Pulsa su
**nombre** y, en la ficha, la sección **"Casos anteriores (1)"**: la conversación anterior, solo
lectura, con su motivo de cierre. Cierra la ficha.

**Decir:** "Un cliente tiene como máximo un caso abierto. Si escribe después de un cierre se
abre un caso nuevo, enlazado al anterior, y se asigna con las mismas reglas. El historial es de
conversaciones, no de datos bancarios."

### 6. Supervisión: asignar respetando el idioma y reasignar (5:00 – 6:30)

**C (Lucía, "Equipo y colas"):** señala las dos colas (en espera, el más antiguo, cuántas
personas disponibles hablan ese idioma) y la tabla de analistas (estado ahora, idiomas, abiertos,
por responder, espera más larga, SLA en riesgo). En el menú, "Equipo y colas" marca 1 pendiente:
el caso en cola.

**Asignar el caso en portugués (regla 3):**

1. En "Cola en portugués", pulsa **"Asignar"** en el caso de Gabriela Duarte Melo.
2. Señala que Felipe, Julián y Paula aparecen deshabilitados con **"No habla portugués
   (regla 3)"**, aunque Felipe esté disponible.
3. Elige **Daniela Ríos** (español, portugués). Aparece "Daniela está en pausa: no recibe casos
   nuevos. Si lo asignas igual, le llega a su lista."
4. Marca **"Asignar aunque esté en pausa"** y pulsa **"Asignar a Daniela"**.

**Decir:** "La misma regla del idioma aplica cuando una supervisora asigna a mano. Y asignarle a
alguien en pausa exige confirmarlo explícitamente."

**Reasignar un caso abierto:**

1. En "Analistas", cambia el filtro a **"En pausa"** y pulsa **Julián Ortega**.
2. En su ficha, el caso de Camila Torres Benavides tiene el SLA vencido. Pulsa **"Reasignar"**.
3. Elige **Felipe Echeverri** (Atendiendo). Señala "El cliente verá: Ahora te atiende Felipe, de
   nuestro equipo." Pulsa **"Reasignar a Felipe"**.

**Se ve en B:** el aviso "Te asignaron un caso · Camila Torres Benavides · desde supervisión" y
la tarjeta de Camila en la lista.

### 7. Auditoría (6:30 – 7:15)

**C:** en el menú de la izquierda, **"Auditoría"**. En **"Tipo"** elige **"Asignación"**.

**Se ve:** "Reasignó el caso de Julián Ortega a Felipe Echeverri", "Asignó el caso a Daniela Ríos
desde la cola en portugués (Daniela Ríos estaba en pausa)", "Asignó el caso a Felipe Echeverri:
estaba disponible y habla español" y "… desde la cola en español después de N min".

**Decir:** "Cada cambio de estado es un evento que se guarda en la misma transacción, y nunca se
edita ni se borra. Aquí se ve quién hizo qué, en qué caso y cuándo. Hay filtros por persona,
tipo y fechas, y el texto de los mensajes no aparece en la auditoría."

### 8. Administración: una persona nueva recibe su primer caso (7:15 – 8:45)

**C:** pulsa el avatar **"Lucía Herrera, cambiar de rol"** → **"Cerrar sesión"**. Entra como
**Valeria Quintero** (`valeria.quintero@latambank.example`). Llega a "Usuarios y roles". Si el
menú indica "1 pendiente", es Mariana Duque: la semilla la deja bloqueada solo durante los primeros
13 minutos después del reinicio. No hace falta tocarla.

1. Pulsa **"Nueva persona"**: nombre `Bruna Esteves`, correo `bruna.esteves@latambank.example`,
   rol **Analista**, idioma **Portugués**, equipo **"Equipo Andes"**. Pulsa
   **"Crear cuenta"**.
2. Aparece "Cuenta creada" con la **contraseña temporal** (se muestra una sola vez). Pulsa
   **"Copiar"** y luego **"Listo"**.
3. Abre una **pestaña nueva** en http://localhost:5173/login y entra como Bruna con esa contraseña
   y el código `000000`. Llega a **"Inicio"**, en pausa. Pulsa **"Empezar a atender"**.
4. **A (cliente):** pulsa **"Cambiar de cliente"** y elige **Rafael Nogueira Costa** (Portugués de
   Brasil). El simulador habla en portugués. Pulsa la sugerencia
   **"Olá, não reconheço uma compra no meu cartão"** y **Enviar**.

**Se ve:** en A, "Você está falando com Bruna · LATAM Bank". En la pestaña de Bruna, "Te llegó
un caso nuevo"; al abrirlo, "Te llegó porque estás disponible y hablas portugués (regla 3)".

**Decir:** "Felipe está disponible, pero no habla portugués. El caso fue a la única persona
disponible que sí lo habla: la que acabamos de crear, sin tocar ninguna configuración más. Entre
varias personas elegibles, gana la menos cargada."

### 9. Barandas de seguridad (8:45 – 9:45)

En **C** (Valeria, "Usuarios y roles"):

1. Pulsa **Valeria Quintero** en la tabla. Señala que "Administración" está bloqueado con **"No
   puedes quitarte tu propio rol de Administración."** y que "Desactivar cuenta" está deshabilitado
   con **"No puedes desactivar tu propia cuenta."** Además la plataforma nunca se queda sin una
   administradora activa.
2. Pulsa **Felipe Echeverri** → **"Desactivar cuenta"**. El diálogo dice **"Tiene 4 casos
   abiertos. Supervisión tiene que reasignarlos antes de desactivar la cuenta."** y el botón no se
   habilita. Pulsa **"Cancelar"**. "Administración nunca mueve casos: eso es de supervisión."
3. Bloqueo y desbloqueo, en vivo. Abre una **pestaña nueva** en http://localhost:5173/login e
   intenta entrar 5 veces como `martin.salazar@latambank.example` con una contraseña errada (por
   ejemplo `clave-errada`). Cada intento avisa cuántos quedan ("Te quedan 4 intentos" … "Te queda
   1 intento"). Al quinto aparece **"Tu cuenta está bloqueada por 15 minutos"** con la cuenta
   regresiva.

   En **C**, sin recargar, "Usuarios y roles" suma un pendiente en el menú. Pulsa **Martín
   Salazar** (cuenta "Bloqueada": "Cuenta bloqueada hasta las … tras 5 intentos fallidos.") →
   **"Desbloquear"**. Aparece el aviso "Cuenta desbloqueada" y su fila vuelve a "Activa".

   En la pestaña de Martín pulsa **"Volver al ingreso"** y entra con `demo1234` y `000000`.

   **Decir:** "Cinco intentos fallidos bloquean la cuenta 15 minutos. Administración ve el bloqueo
   al momento, lo levanta, y queda en auditoría."

**Si sobra tiempo:** en la ficha de **Bruna Esteves**, marca también **Supervisora** y pulsa
**"Guardar cambios"**. En la pestaña de Bruna aparece el aviso "Cambiaron tus roles" ("Ahora
tienes: Analista y Supervisora.") y su selector de rol ya ofrece "Supervisora", sin volver a
entrar.

### 10. Cierre (9:45 – 10:00)

**Decir:** "Chat en vivo entre personas, ciclo de vida completo del caso, la regla del idioma
aplicada por el sistema y por supervisión, auditoría de todo y administración con barandas.
Todo pensado para el trabajo diario del equipo de soporte."

## Si algo sale mal

| Pasa esto | Haz esto |
|---|---|
| Un mensaje no aparece en la otra ventana | Recarga esa ventana (Cmd+R). La sesión sobrevive a la recarga y los datos vienen del servidor. Ver "El chat no se actualiza en vivo" en el [RUNBOOK](./RUNBOOK.md#el-chat-no-se-actualiza-en-vivo-websocket) |
| "No hay conexión con el servidor" al entrar | El backend no está corriendo o cambió de puerto. Revisa la terminal 1 y `curl -s http://127.0.0.1:8000/api/v1/health` |
| A Felipe no le llegaron Rosa y Mauricio | No está "Disponible": pulsa "Empezar a atender" en Inicio (o el control naranja "En pausa" arriba de la lista de Casos) |
| La cola en portugués ya estaba vacía | Alguien que habla portugués estaba disponible (por ejemplo, Daniela entró y se puso disponible). Reinicia la base, o muestra la regla 3 con Rafael: con las personas que hablan portugués en pausa, su caso queda en "Cola en portugués" y lo asignas a mano |
| Martín ya estaba bloqueado antes del paso 9.3 (quedó de un ensayo) | Desbloquéalo igual desde su ficha y repite los 5 intentos, o reinicia la base |
| Martín no queda bloqueado al quinto intento | Revisa que el correo sea exactamente `martin.salazar@latambank.example`: los intentos se cuentan por cuenta |
| Se perdió la contraseña temporal de Bruna | Ficha de Bruna → "Restablecer contraseña": da una nueva, también una sola vez |
| Una ventana muestra a otra persona | Se duplicó una pestaña. Abre una ventana nueva y escribe la URL |
| La pantalla se queda sin sesión de golpe | La sesión se cerró (cierre de sesión, desactivación, contraseña restablecida o base reiniciada). Vuelve a entrar |
| Algo quedó en un estado raro | Reinicio completo en un minuto: detén el backend, `rm -f backend/cc_platform.db`, arráncalo, recarga las tres ventanas y vuelve a entrar |
