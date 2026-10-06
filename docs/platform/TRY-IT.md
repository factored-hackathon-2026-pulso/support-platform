# Try the deployed platform

How to use the **deployed** platform (the hackathon environment on AWS) as a bank customer and as the support team. Nothing to install: everything happens in the browser. For running it on your own machine, see [RUNBOOK.md](./RUNBOOK.md).

All data is **synthetic**: invented customers, staff, cases and transactions. The UI is in Spanish; the account menu switches it to Portuguese.

## Where

| What | URL |
|---|---|
| The platform (staff sign-in) | `https://<platform URL>/login` |
| The customer simulator | `https://<platform URL>/customer` |

`<platform URL>` is the CloudFront address of the deployment (ask the team, or see the infra repository's hackathon deploy). The environment runs as `staging` with the demo seed on (`CC_SEED_DEMO_DATA`, `CC_SEED_DEMO_BANK_LINKS`, `CC_DEV_MAILBOX`; [deploy-env.md](./deploy-env.md)), which is what makes the accounts and the simulator below available.

## 1. Be a customer

1. Open `https://<platform URL>/customer`.
2. Pick a customer, then a channel: **Chat**, **Llamada** (a simulated call with a live transcript) or **Correo** (email).
3. Write. Each customer card offers a few opening messages you can click.

| Customer | Language | What happens with a new chat |
|---|---|---|
| Natalia Guzmán Rincón | Spanish | The **Asistente virtual** (AI) answers first |
| Ximena Robles Treviño | Spanish | The Asistente virtual answers first |
| Rafael Nogueira Costa | Portuguese | The Asistente virtual answers first, in Portuguese |
| Lucas Benítez Sosa | Spanish | Goes straight to a person (an analyst) |
| Andrés Felipe Cardona | Spanish | Goes straight to a person |

What to try:
- **Talk to the assistant:** "No reconozco un cargo en mi tarjeta" (Natalia). The assistant asks for the details, may ask you to **confirm** an action (Sí / No) and for a **verification code**: it is simulated, use `000000`. When it solves the case it closes the conversation and asks you to rate it.
- **Ask for a person at any time:** "Hablar con una persona". The case goes to an analyst, together with what the assistant already verified.
- **Be served by a person:** write as Lucas or Andrés, and answer from an analyst account (below) in another window.
- A customer has one open conversation at a time; writing after it closes opens a new one, linked to the previous ("Ver conversaciones anteriores").

The AI parts (assistant, copilot, agents) need the AI engine (agent-core) to be connected in the deployment. If it is not, every conversation goes to people and the AI screens say so; the rest of the platform works the same.

## 2. Be the support team

Every account uses the password **`demo1234`** and the verification code **`000000`**. Emails are `nombre.apellido@latambank.example` (no accents).

| Person | Email | Role | Look at |
|---|---|---|---|
| Tomás Arango | `tomas.arango@latambank.example` | Analyst (Spanish, Portuguese) | **Casos** and **Inicio**. Set yourself to **Disponible** to receive new cases |
| Daniela Ríos | `daniela.rios@latambank.example` | Analyst (Spanish, Portuguese) | Has open and closed cases already |
| Lucía Herrera | `lucia.herrera@latambank.example` | Supervisión | **Colas**, **Equipo**, **Escalados**, **Auditoría**, **Automatización** |
| Valeria Quintero | `valeria.quintero@latambank.example` | Administración | **Usuarios y roles**, **Equipos**, **Plataforma** (the AI switch) |

The full list of seeded accounts and cases is in [RUNBOOK.md §5](./RUNBOOK.md).

What to try:
- **An analyst's case:** the **stage strip** under the case header shows how far that type of case has matured (Etapa 0 to 3). From stage 1 the **Copiloto** answers questions about the customer; from stage 2 **Herramientas** suggests what to look up; at stage 3 a **draft reply** appears above the composer (Usar / Editar / Descartar). Nothing is sent for the analyst.
- **A case handed over by the assistant:** the card "El asistente te pasó este caso" and the **Traspaso** tab (what the customer asked, what was verified, what is missing). When closing, "¿Te sirvió el traspaso?".
- **Supervisión › Colas:** every open case by language, who handles it (people or the assistant), and "Tomar el caso" to move a conversation from the assistant to people.
- **Supervisión › Automatización:** each type of case with its stage and signals; when a type is ready, "El sistema propone un agente" → **Revisar el agente** (pick its photo) → **Probar** → **Aprobar** → **Activar** (each decision asks for the code `000000`).
- **Administración › Plataforma:** turn the AI off and on. With it off the platform works with people only.
- **Invitations:** "Nuevo usuario" sends an invitation email; in this environment the emails land in the development mailbox at `https://<platform URL>/dev/mailbox`.
- **Language:** the account menu › "Idioma de la plataforma" › Português.

## 3. See both sides at once

Open the simulator and a staff account in **two browser windows** (or a normal and a private window). Each browser tab keeps its own sign-in, so you can also have an analyst and a supervisor open side by side. Messages, assignments and status changes appear live everywhere.

## Notes

- The environment is shared: other people may be using the same accounts and customers at the same time.
- Data is synthetic and may be reset when the environment is redeployed.
- Please don't enter real personal or banking data anywhere.
