# Guion de demo · plataforma de soporte

Demo de 7 a 10 minutos para jurados (12 con las llamadas y el correo). Muestra la plataforma de
punta a punta con personas reales detrás de cada ventana: una clienta escribe, un analista la
atiende en vivo, cierra el caso, la clienta vuelve, otro cliente llama y otra escribe un correo,
supervisión reparte el trabajo respetando el idioma, todo queda en auditoría, y
administración invita por correo a una persona nueva, que crea su propia contraseña, configura la
verificación en dos pasos y recibe su primer caso. Nadie del equipo ve ni entrega contraseñas.

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
   | **C · Supervisión y administración** | http://localhost:5173/login | Lucía Herrera, `lucia.herrera@latambank.example` | Entra. Queda en **"Colas"** |

   Durante la demo abrirás una cuarta pestaña para la persona nueva que invita administración.
   Ten a mano **un teléfono con una app de autenticación** (Google Authenticator, Microsoft
   Authenticator…) para escanear el QR del paso 8, o una terminal lista para calcular el código:
   `cd backend && uv run python -c "import pyotp; print(pyotp.TOTP('<clave>').now())"`.
3. Comprueba en C que en **"Colas"**, Portugués, Gabriela Duarte Melo está **"Sin asignar"**, que
   en Español Rosa y Mauricio están "Sin asignar" y que el menú muestra **"Escalados"** con 2
   abiertos (Daniela con Marcela, Julián con Camila). Si no, reinicia la base (paso 1).

Por qué Felipe: habla solo español y tiene los roles Analista y Supervisión. Eso hace visible la
regla del idioma (regla 3) y que los roles se combinan.

## Guion

### 1. Qué es (0:00 – 0:45)

**Decir:** "Es la plataforma de soporte de LATAM Bank. Clientes y equipo conversan por chat, de
principio a fin, entre personas. Hay tres roles que se combinan: Analista atiende casos,
Supervisión mira las colas y el equipo, atiende los escalamientos, reasigna cuando hace falta y
revisa la auditoría, Administración gestiona cuentas, roles,
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

**A (cliente):** elige **Natalia Guzmán Rincón** (Español de Colombia). En "¿Cómo se comunica
Natalia con el banco?" pulsa **"Chat"** (las otras tarjetas son "Llamar" y "Escribir un correo",
pasos 5b y 5c). Escribe `Hola, no reconozco un cargo de $250.000 en mi tarjeta` y pulsa
**Enviar**.

**Se ve en A:** "Te atiende Felipe, de LATAM Bank" y el aviso "Recibimos tu mensaje. En unos minutos
te responde una persona del equipo."

**Se ve en B, sin recargar:** el aviso "Te llegó un caso nuevo" y la tarjeta de Natalia con la
etiqueta "Nuevo" y el tiempo de su primera respuesta (reloj; llama naranja cuando faltan 5 minutos
o menos, llama roja "Vencido" si ya pasó).

**B:** abre la tarjeta de Natalia.

**Señalar:** el ícono del canal en la tarjeta (burbuja de chat; pasa el mouse: "Chat en la app"),
el encabezado (solo el nombre y el número de caso copiable) y la fila **"Cómo llegó
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
necesitas algo más, escríbenos y te atendemos en una nueva conversación."; abajo, en lugar del
campo de texto, la encuesta **"¿Cómo te atendió Felipe?"**.

### 4b. La clienta califica la atención (slice 7)

**A:** pulsa la carita **"Excelente"**. Aparece "¿Quieres contarnos algo más? (opcional)":
escribe `Muy clara la explicación` y pulsa **"Enviar"**.

**Se ve en A:** la píldora **"¡Gracias! Calificaste: Excelente"** con la carita, y vuelve el
campo de texto. ("Ahora no" habría cerrado la encuesta sin calificar, solo para esa
conversación.)

**Se ve en B, sin recargar:** en Inicio pulsa el contador **"Cerrados"** y abre el caso de
Natalia. Al pie: **"El cliente calificó: Excelente"** con la carita y el comentario entre
comillas. La tarjeta muestra la carita (pasa el mouse: "Excelente"), y en la ficha, "Este caso"
tiene la fila **"Calificación"**.

**Decir:** "La calificación es de 1 a 4, como la encuesta del banco; solo se califica una
conversación cerrada, una vez, y cuenta para quien la cerró. El analista no ve promedios: la
supervisión ve en Equipo la columna 'Calificación 7 días'."

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

### 5b. Un cliente llama por teléfono (simulado)

**A:** pulsa **"Cambiar de cliente"**, elige **Lucas Benítez Sosa** y pulsa **"Llamar"**. El
simulador marca de una vez: **"Llamando…"**, "Línea de atención LATAM Bank" y "Colgar".

**Se ve en B, sin recargar:** una tarjeta nueva de Lucas con el ícono de **teléfono con flecha
entrante** ("Llamada entrante") y el teléfono verde ("Llamada en curso"). Ábrela: bajo el
encabezado, la barra de la llamada: **"Sonando"**, el contador, "Entrante" y **"Contestar"**. No
hay "Cerrar caso": un caso no se cierra con una llamada en la línea.

**B:** pulsa **"Contestar"**. La barra pasa a **"En llamada"** y el contador corre desde que
contestó; aparecen "Poner en espera", "Silenciar" y "Colgar". **En A:** "Te atiende Felipe".

**B:** en **"Lo que dices"** escribe `Buenas tardes, le habla Felipe de LATAM Bank. ¿En qué le
ayudo?` y pulsa **"Decir"**. **A:** la línea aparece en "Lo que se dice en la llamada". En **"Lo
que dices"** del simulador escribe `Hola, perdí mi tarjeta y veo una compra que no hice` y pulsa
Enter: en B aparece en la **"Transcripción en vivo"** (hora de la llamada en mono, avatar,
"Cliente").

**B:** pulsa **"Poner en espera"**: la barra dice "En espera" y la transcripción "Llamada en
espera."; en A, "Felipe te puso en espera" y el campo se desactiva. Pulsa **"Retomar"** ("La
llamada continúa."). En **"Nota interna"** escribe `Pedir bloqueo de la tarjeta` y pulsa
**"Guardar nota"**: solo la ve el equipo. Pulsa **"Colgar"**: "Llamada terminada, …" en ambas
ventanas, y vuelve "Cerrar caso" (su diálogo no muestra "El cliente verá": en una llamada no hay
pantalla). En A queda "Volver a llamar".

**Llamar de vuelta (opcional):** con el caso de Lucas abierto en B pulsa **"Llamar al cliente"**,
escribe el motivo `Confirmar el bloqueo de la tarjeta` y pulsa **"Llamar"**. La barra dice
"Sonando", "Saliente", y arriba de la transcripción aparece **"Por qué llamas"**. En A, pulsa
**"Cambiar de canal"** → **"Chat"**: arriba aparece **"LATAM Bank te está llamando"** con
"Contestar" y "Rechazar". Pulsa **"Contestar"** y cuelga desde cualquiera de las dos ventanas.

**Decir:** "No hay telefonía: es una llamada simulada. La plataforma guarda el estado, los tiempos
y lo que dicen las personas, y contestar cuenta como primera respuesta para el SLA."

### 5c. Una clienta escribe un correo (simulado)

**A:** **"Cambiar de cliente"** → **Ximena Robles Treviño** → **"Escribir un correo"**. Asunto
`Cobro duplicado en mi tarjeta`, mensaje `Hola, aparece dos veces el mismo cobro de $54.990 en mi
resumen.` y **"Enviar"**. El correo queda en el hilo con el aviso "Recibimos tu correo…".

**Se ve en B:** la tarjeta de Ximena con el ícono de **sobre** ("Correo"). Ábrela: el asunto como
título, el correo marcado **"Nuevo"** (los anteriores se pliegan a una línea) y abajo la respuesta:
"Para" (la dirección está oculta), "Asunto: Re: Cobro duplicado en mi tarjeta", **"El saludo y la
firma se agregan solos"** y el clip de adjuntar deshabilitado ("Pronto").

**B:** escribe `Ya pedimos el reverso del segundo cobro; lo verás en tu próximo resumen.` y pulsa
**"Enviar correo"**. El correo aparece con "Hola, Ximena:" al principio y la firma de Felipe al
final.

**Se ve en A:** la respuesta de "Felipe, LATAM Bank" en el mismo hilo, marcada **"Nuevo"**.
Ximena contesta abajo en **"Responder"** (`Gracias, quedo atenta`) y llega a B en vivo. Si Felipe
cierra el caso, el diálogo dice **"El cliente lo recibe por correo"**, y en A aparece la encuesta.

**Decir:** "Los tres canales son la misma pantalla: solo cambia el centro. Un cliente tiene un
solo caso abierto: si llama o escribe un correo con un caso abierto, se suma a ese caso."

### 6. Supervisión: colas, un escalamiento y una reasignación (5:00 – 6:30)

**C (Lucía, "Colas"):** a la izquierda, Español y Portugués con sus cifras (abiertos, sin asignar,
en riesgo). Elige **Portugués**: Gabriela Duarte Melo está **"Sin asignar"**. Señala la línea de
arriba: "La asignación es automática…". No hay botón "Asignar": le llega sola a la primera persona
disponible que hable portugués (regla 3). En Español se ven **todos** los casos abiertos, quién
los tiene, cuánto llevan abiertos y la primera respuesta (reloj, llama naranja, llama roja
"Vencida"). Abre **"Filtros"**, marca **Estado → Por responder**: aparece el chip; quítalo.

**Escalar (B, Felipe):** abre el caso de **Mauricio Achával Ríos** y pulsa **"Escalar a
supervisión"** (al lado de "Cerrar caso"). Motivo: "Le cobraron dos veces la misma compra y está
muy molesto; quiere que alguien con más autoridad le responda." → **"Escalar"**. Aparece la tarjeta
"Escalado a supervisión" (solo el equipo la ve) con "Retirar escalamiento"; la tarjeta de la lista
dice "Escalado". El caso sigue con Felipe: puede seguir escribiendo.

**Responder (C):** la campana del riel (abajo, sobre el avatar) sube su número y llega el aviso
"Felipe Echeverri escaló un caso" con **"Revisar"** y **"Más tarde"**. Pulsa **"Más tarde"**: el
aviso se va pero la notificación sigue sin leer. Abre la **campana** ("Notificaciones, N sin
leer"): arriba "Nuevas" (el escalamiento de Felipe, "Caso por vencer sin respuesta", "Un caso
espera en la cola…"), abajo "Anteriores". Pulsa **"Revisar"** en la fila de Felipe. En
**"Escalados"** (badge 3 abiertos) se ve la fila de Mauricio: el motivo, cuánto espera (reloj; llama
naranja después de 15 min, roja después de 30: solo énfasis, no hay plazos). El panel muestra el
motivo, el caso y los últimos mensajes ("Ver caso completo"). Pulsa **"Responder"**, escribe "Ya lo
revisé: el segundo cobro se reversa. Sigue tú con él." → **"Enviar respuesta"**.

**Se ve en B:** en el caso abierto, la tarjeta con su respuesta (sin aviso encima: el caso ya lo
muestra) y, en la campana, "Supervisión respondió tu escalamiento · Lucía Herrera sobre Mauricio…".
Felipe pulsa **"Entendido"**.

**Decir:** "El escalamiento existe en el dataset como sí o no: aquí es una persona pidiendo ayuda
con un motivo, y supervisión responde, toma el caso o lo reasigna. Lucía no puede tomarlo porque no
tiene el rol de Analista."

**Reasignar (la excepción):**

1. En **"Equipo"** (una sola tabla, sin pestañas de equipo), abre **"Filtros"** → **Estado → En
   pausa** y pulsa **Julián Ortega**.
2. En su ficha, Camila Torres Benavides tiene la marca **"Escalado"** y la primera respuesta
   vencida. Pulsa **"Reasignar"**.
3. El diálogo sugiere tres personas que hablan español (las disponibles y con menos carga
   primero); el buscador llega al resto y "Incluir a quienes están en pausa o desconectados" las
   suma. Elige **Felipe Echeverri**. Señala "El cliente verá: Ahora te atiende Felipe, de nuestro
   equipo." Pulsa **"Reasignar a Felipe"**.

**Se ve en B:** el aviso "Supervisión te asignó un caso" (Camila Torres Benavides) con **"Abrir
caso"** y **"Más tarde"**, también si Felipe está en Inicio. En
"Escalados", el escalamiento de Camila pasa a "Atendidos hoy" como **"Reasignado"**.

### 7. Auditoría (6:30 – 7:15)

**C:** en el menú de la izquierda, **"Auditoría"**. En **"Tipo"** elige **"Asignación"**.

**Se ve:** "Reasignó el caso de Julián Ortega a Felipe Echeverri", "Asignó el caso a Felipe
Echeverri: estaba disponible y habla español" y "… desde la cola en español después de N min".
Cambia **"Tipo"** a **"Escalamientos"**: "Escaló el caso a supervisión" (Felipe), "Respondió el
escalamiento" (Lucía) y "Reasignó el caso escalado de Julián Ortega a Felipe Echeverri". El motivo y
la respuesta no aparecen en la auditoría (solo su largo), como el texto de los mensajes.

**Decir:** "Cada cambio de estado es un evento que se guarda en la misma transacción, y nunca se
edita ni se borra. Aquí se ve quién hizo qué, en qué caso y cuándo. Hay filtros por persona,
tipo y fechas, y el texto de los mensajes no aparece en la auditoría."

### 8. Administración: una persona nueva, invitada por correo, recibe su primer caso (7:15 – 9:00)

**C:** pulsa el avatar **"Lucía Herrera, cambiar de rol"** → **"Cerrar sesión"**. Entra como
**Valeria Quintero** (`valeria.quintero@latambank.example`). Llega a "Usuarios y roles". Si el
menú indica "1 pendiente", es Mariana Duque: la semilla la deja bloqueada solo durante los primeros
13 minutos después del reinicio. No hace falta tocarla. En la tabla, **Bruna Esteves** aparece con
**"Invitación pendiente"** (la semilla la invitó hace 3 horas).

1. Pulsa **"Nuevo usuario"**: nombre `Ana Gil`, correo `ana.gil@latambank.example`, rol
   **Analista**, idioma **Portugués**, equipo **"Equipo Andes"**. Pulsa **"Enviar invitación"**.
2. Aparece **"Invitación enviada"**: "Invitación enviada a ana.gil@latambank.example. El enlace
   vence en 48 horas." Pulsa **"Listo"**. Su ficha dice "Invitación pendiente", cuándo se envió y
   cuándo vence, con **"Reenviar invitación"** y **"Cancelar invitación"**. No hay ninguna
   contraseña a la vista.
3. Abre una **pestaña nueva** en http://localhost:5173/dev/correos ("Correos de desarrollo", la
   herramienta que reemplaza al servidor de correo en desarrollo). El correo más nuevo es "Te
   invitaron a la Plataforma CC de LATAM Bank" para Ana: pulsa **"Abrir enlace"**.
4. **"Activa tu cuenta"**: escribe una contraseña (por ejemplo `Lago-Verde-2027!`); los requisitos
   se marcan en vivo ("Al menos 12 caracteres", "No incluye tu nombre ni tu correo", "No es una
   contraseña común", "Las dos contraseñas coinciden"). Pulsa **"Continuar"**.
5. **"Configura la verificación en dos pasos"**: escanea el QR con la app del teléfono (o copia la
   clave y calcula el código en la terminal). Escribe el código de 6 dígitos y pulsa **"Activar
   cuenta"** → **"Tu cuenta está lista"** → **"Entrar"**.
6. Entra como Ana con su contraseña y el **código de la app** (el `000000` de desarrollo no le
   sirve). Llega a **"Inicio"**, en pausa. Pulsa **"Empezar a atender"**.
7. **A (cliente):** pulsa **"Cambiar de cliente"**, elige **Rafael Nogueira Costa** (Portugués de
   Brasil) y **"Chat"**. El simulador habla en portugués. Pulsa la sugerencia
   **"Olá, não reconheço uma compra no meu cartão"** y **Enviar**.

**Se ve:** en C, la ficha de Ana pasa a "Activa" y la campana de Valeria trae "Invitación
aceptada: Ana Gil". En A, "Você está falando com Ana, do LATAM Bank". En la pestaña de Ana, "Te
llegó un caso nuevo"; al abrirlo, "Te llegó porque estás disponible y hablas portugués (regla 3)".

**Decir:** "Administración nunca ve ni entrega una contraseña: invita por correo con un enlace de
un solo uso, y la persona crea la suya y configura la verificación en dos pasos. Felipe está
disponible, pero no habla portugués: el caso fue a la única persona disponible que sí lo habla, la
que acabamos de invitar."

### 9. Barandas de seguridad (9:00 – 9:45)

En **C** (Valeria, "Usuarios y roles"):

1. Pulsa **Valeria Quintero** en la tabla. Señala que "Administración" está bloqueado con **"No
   puedes quitarte tu propio rol de Administración."** y que "Desactivar cuenta" está deshabilitado
   con **"No puedes desactivar tu propia cuenta."** Además la plataforma nunca se queda sin una
   administradora activa.
2. Pulsa **Felipe Echeverri** → **"Desactivar cuenta"**. El diálogo dice **"Tiene 6 casos
   abiertos. Supervisión tiene que reasignarlos antes de desactivar la cuenta."** (4 si saltaste los
   pasos 5b y 5c) y el botón no se habilita. Pulsa **"Cancelar"**. "Administración nunca mueve casos: eso es de supervisión."
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

**Si sobra tiempo:**

- En la ficha de **Ana Gil**, marca también **Supervisión** y pulsa **"Guardar cambios"**. En la
  pestaña de Ana aparece el aviso "Cambiaron tus roles" ("Ahora tienes: Analista y Supervisión.")
  y su selector de rol ya ofrece "Supervisión", sin volver a entrar.
- En la ficha de **Martín Salazar**, pulsa **"Enviar enlace para restablecer"**: el diálogo explica
  que le llega un correo con un enlace que vence en 1 hora y que sus sesiones se cierran ya. En
  `/dev/correos` aparece "Crea una contraseña nueva para la Plataforma CC".

### 10. Cierre (9:45 – 10:00)

**Decir:** "Chat, llamadas y correo entre personas, ciclo de vida completo del caso, la regla del idioma
aplicada por el sistema, escalamientos a supervisión, auditoría de todo y administración con barandas.
Todo pensado para el trabajo diario del equipo de soporte."

## Si algo sale mal

| Pasa esto | Haz esto |
|---|---|
| Un mensaje no aparece en la otra ventana | Recarga esa ventana (Cmd+R). La sesión sobrevive a la recarga y los datos vienen del servidor. Ver "El chat no se actualiza en vivo" en el [RUNBOOK](./RUNBOOK.md#el-chat-no-se-actualiza-en-vivo-websocket) |
| "No hay conexión con el servidor" al entrar | El backend no está corriendo o cambió de puerto. Revisa la terminal 1 y `curl -s http://127.0.0.1:8000/api/v1/health` |
| A Felipe no le llegaron Rosa y Mauricio | No está "Disponible": pulsa "Empezar a atender" en Inicio (o el control naranja "En pausa" arriba de la lista de Casos) |
| Gabriela ya no estaba "Sin asignar" en Portugués | Alguien que habla portugués estaba disponible (por ejemplo, Daniela entró y se puso disponible). Reinicia la base, o muestra la regla 3 con Rafael: con las personas que hablan portugués en pausa, su caso queda "Sin asignar" en Colas → Portugués hasta que una se pone disponible |
| No aparece "Escalar a supervisión" | El caso no es de quien mira, está cerrado o ya está escalado (la tarjeta "Escalado a supervisión" está arriba). Retíralo con "Retirar escalamiento" para volver a escalarlo |
| Martín ya estaba bloqueado antes del paso 9.3 (quedó de un ensayo) | Desbloquéalo igual desde su ficha y repite los 5 intentos, o reinicia la base |
| Martín no queda bloqueado al quinto intento | Revisa que el correo sea exactamente `martin.salazar@latambank.example`: los intentos se cuentan por cuenta |
| El enlace de Ana dice "El enlace venció o ya se usó" | Ya se usó o se reenvió. En su ficha pulsa "Reenviar invitación" y abre el correo más nuevo en `/dev/correos` |
| El código de la app no sirve | Revisa la hora del teléfono; o calcula el código con la clave del paso 5 en la terminal (`pyotp`). Cinco códigos erróneos bloquean la activación 15 minutos: reenvía la invitación |
| `/dev/correos` dice "No disponible" | El backend no corre con `CC_ENV=dev` (o `CC_DEV_MAILBOX=false`). Arráncalo con `uv run cc-api` sin cambiar `CC_ENV` |
| Una ventana muestra a otra persona | Se duplicó una pestaña. Abre una ventana nueva y escribe la URL |
| La pantalla se queda sin sesión de golpe | La sesión se cerró (cierre de sesión, desactivación, enlace para restablecer enviado o base reiniciada). Vuelve a entrar |
| La llamada sigue "Sonando" | No hay tiempo límite de timbre: contesta en B o pulsa "Colgar" en cualquiera de las dos ventanas |
| "Cerrar caso" no aparece en un caso con llamada | Hay una llamada en la línea: cuelga primero |
| Algo quedó en un estado raro | Reinicio completo en un minuto: detén el backend, `rm -f backend/cc_platform.db`, arráncalo, recarga las tres ventanas y vuelve a entrar |
