# ADR 0004 · Tool service: agent-core's tools over the bank data (`gold_restricted`)

- Status: **Proposed** (design; T1, the agent-core side, is built: agent-core ADR 0025). Decided by the user on 2026-10-04: tools go over HTTP from the start, backed by the `data-pipeline` `gold_restricted` dataset, in a separate read-only service.
- Date: 2026-10-04
- Scope: a new small service (`tool-service`), a new adapter in `agent-core` (`HttpToolExecutor`), and the platform's part (identity linkage, grants, a store for filed PQRs).
- Related: ADR 0003 (agent-core integration), `slice-14-assistant.md` §10 (gaps). In `agent-core`: ADR 0007 (writes: confirm → act → verify), ADR 0024 (the LLM gateway as an external service, the model for this one), ADR 0006 (principals and delegation). In `data-pipeline`: `docs/02-gobierno-de-datos.md` (governance matrix), the `gold_restricted` read-models.

## Context

Everything the assistant and the copilot "know" about a customer comes from tools. Today `agentcore serve` runs demo doubles (`testing/e2e_demo.py`: fixed products, movements and cases), which is why the copilot's answers are mechanically right but empty of real content. `ToolExecutor` is an in-process Python port:

```
execute(tool, args, bound_params, ctx, idempotency_key) -> ToolResult
ToolResult{status, result_full, source, call_id, error, required_level}
```

The data exists: `data-pipeline` publishes `gold_restricted.duckdb` (PII in clear, every column classified) with four read-models (`customer_profile`, `customer_products`, `customer_transactions`, `customer_cases`), at `publish/<run_id>/…` and an atomic `publish/latest.json` pointer. Its intended reader is "authenticated agent-core tools". It is read-only, so a write tool (`radicar_pqr`) needs a writable store.

## Decision

1. **A separate service, `tool-service`, owns the data access.** agent-core does not mount DuckDB or hold an S3 credential; it calls the service over HTTP (`HttpToolExecutor`, same shape as `HttpLLMGateway`, ADR 0024). Reasons: the dataset is PII in clear and its blast radius should be one small process; the dataset changes on a pipeline cadence, not on the engine's; the service can be scaled and audited on its own. It lives in its own directory/repo, not inside `agent-core` nor the platform.
2. **Tools are declared in agent-core (the registry yaml); the service implements the data side.** One endpoint, one contract:

   ```
   POST /v1/tools/{tool}/execute
   Authorization: Bearer <service token>                      # env pair, like the gateway
   {
     "args": {...},                 # model-controlled, validated against the tool's args_schema
     "bound_params": {...},         # engine-controlled (subject, case); NEVER taken from args
     "context": {"principal": {type, id, roles, scopes, attrs, auth_level}, "subject": {kind, ref}|null,
                  "on_behalf_of": {subject, grant_ref, grantee, scopes}|null, "run_id", "call_id", "release", "turn_id"},
     "idempotency_key": "<action_id>|null"
   }
   → 200 {"status": "ok|denied|step_up_required|error|uncertain", "result": {...}, "source": "<table>",
          "call_id": "...", "error": {"kind": "...", "message": "..."}|null, "required_level": "..."|null}
   ```

   `HttpToolExecutor` maps transport failures to the typed kinds (`timeout`, `unavailable`, `bad_response`) and never raises into the engine, exactly as the gateway adapter does. A transport failure on a **write** is `uncertain`, never `error` (ADR 0007: the engine then reads back by idempotency key instead of retrying blindly).
3. **The subject is never an argument.** The customer whose data is read comes from the verified principal / `bound_params` (`bank_customer_id`), not from what the model typed. agent-core has already verified the JWS at its edge and does not keep the token, so the service receives the verified **claims** (never a JWS; amended by agent-core ADR 0025) and trusts agent-core through the bearer. It checks that, for an `advisor` principal acting with a delegation, the delegation's `on_behalf_of` is the customer in `bound_params`, and that a `customer` principal's id is the one in `bound_params`. A mismatch is `denied`, not an empty result. Every query is a parameterized `WHERE customer_id = ?`; there is no query-by-text tool.
4. **Mapping to the read-models** (first set; names follow the existing registry yamls):

   | Tool | Kind | Reads | Notes |
   |---|---|---|---|
   | `leer_productos` | read | `customer_products` | `source: productos` |
   | `leer_movimientos` / `buscar_transacciones` | read | `customer_transactions` | most recent first, explicit `ORDER BY`, `limite` capped (the copilot does not sort by itself) |
   | `leer_pqr_cliente` | read | `customer_cases` ∪ PQRs filed through the platform (see 6) | `complaint_description` is `untrusted_text`: returned flagged so agent-core fences it |
   | `leer_perfil` (new) | read | `customer_profile` | only the fields the agent's role may see (governance matrix) |
   | `radicar_pqr` | `write_reversible`, `step_up` | writable store (see 6) | idempotent by `idempotency_key`; `readback_by: idempotency_key` |

   `source` is the table name, which is what agent-core's M7 views use to project and redact by role.
5. **Classification travels with the data, not with the service's opinion.** The service returns the raw read-model row; agent-core's `FieldClassifier` decides what the model sees. The catalog is the one `data-pipeline` already exports in agent-core's format (545 entries, `export_catalog`); agent-core loads it as its `FieldClassifier` catalog instead of the demo one. A field with no entry falls to `pii_direct` (the safe side). The tool-service's responsibility ends at "right customer, right columns exist"; the redaction layer is agent-core's, so there is one place where it is tested.
6. **Writes need a writable store; `gold_restricted` stays read-only.** `radicar_pqr` writes to a small table owned by the tool-service (`filed_pqrs`: `idempotency_key` unique, customer, product ref, text, status, `filed_at`), SQLite at first and Postgres with the platform's S17 move. The idempotent replay returns the first result; the read-back returns the stored row. `leer_pqr_cliente` unions the dataset's cases with `filed_pqrs`, so a PQR filed today is visible tomorrow even before the pipeline reruns. The next pipeline run does not know about `filed_pqrs`: reconciliation (the bank's real case system) is out of scope and is named here as the production gap.
7. **Which dataset version.** The service reads `publish/latest.json` per request batch (cached for a short TTL, 60 s default), opens the pointed DuckDB file read-only, and keeps the previous handle until in-flight calls finish. Every result carries `dataset_run_id` in its `source` metadata so an audit line says which data the answer came from. If the pointer or file is unreadable the service answers `error: data_unavailable`; it never falls back to stale data silently. Local development points `TOOL_DATA_DIR` at a `data/publish` folder; production reads S3 (`TOOL_DATA_URI=s3://…`) with a role scoped to `publish/*` read.
8. **Linkage to the platform's customers.** The platform's customer id is not the bank's. `CC_BANK_CUSTOMER_LINKS_FILE` (already used by S14) maps platform customer → `bank_customer_id`, and the platform puts that id in the customer principal (`bound_params`). The service only ever sees `bank_customer_id`, which equals `customer_id` in the read-models. A customer with no link starts no assistant conversation that needs tools (already so in S14). A real link table comes with S17's real customer authentication.
9. **Service-to-service security.** A static bearer token per direction in this first version (`TOOL_SERVICE_TOKEN` for agent-core → service; `CC_INTERNAL_SERVICE_TOKEN` already exists for the other direction), constant-time compare, TLS terminated in front, the service not reachable from the public internet. The bearer says "this is agent-core", which is what lets the service trust the claims; so it is a deployment secret and the service must not be reachable outside the private network. No PII in logs: the service logs tool name, status, latency, `call_id`, `run_id`, `dataset_run_id`, never args or results. mTLS or workload identity replaces the static token with the AWS move (ADR 0023 in agent-core).
10. **What else agent-core needs to leave the demo doubles** (tracked here because they gate production, not because the tool-service owns them): a `grant_active` adapter calling the platform's `GET /api/v1/internal/grants/{grantRef}` (built in S17), a real `AuthzPort`, a transcript store, calibration data and the field classifier above. Each is its own small adapter in agent-core, selected by env like the gateway.

## Phasing (when implementation starts)

- **T1** `HttpToolExecutor` in agent-core + a **fake tool-service** in its tests (contract test against the endpoint above, error mapping, uncertain-on-write). No data yet.
- **T2** `tool-service` with the three read tools over a local `publish/` folder; claims/`bound_params` coherence checks; contract test shared by both sides (the request/response JSON lives in one schema file copied to both repos, as `agent-core-openapi.json` is today).
- **T3** `radicar_pqr` + `filed_pqrs` + `leer_pqr_cliente` union; idempotency and read-back tests.
- **T4** Wire `serve` to the HTTP executor and the exported catalog; re-run the end-to-end scripts (customer chat, handoff, copilot) and compare the copilot's answers with the demo-double baseline.
- **T5** S3 source, caching, deployment, tokens in the secret manager.

## Consequences

- The copilot and the assistant finally answer from real rows; the quality of the copilot's content depends on T4, not on prompt work alone.
- One more deployable. In exchange the PII dataset has a single reader with a narrow, testable surface, and agent-core stays free of data credentials.
- Staleness is bounded by the pipeline cadence plus the TTL, and is visible in every audit line (`dataset_run_id`).
- A filed PQR lives in `filed_pqrs` until the bank's case system exists; that is a known, named gap rather than a hidden one.
- Rejected: DuckDB inside agent-core (couples the engine to PII and to the data layout); the platform proxying the tools (puts the bank data in a product that should only hold conversations); a generic SQL tool (the model would choose the query).

## Open points

1. Which of `leer_perfil`'s fields each role may see (needs the governance matrix applied per role, owner: data governance).
2. Whether `radicar_pqr` should instead call the bank's real PQR API once there is one (then `filed_pqrs` becomes a cache).
3. Cache TTL and whether the pipeline should push a "new run" notification instead of the service polling the pointer.

## Appendix · Draft of the agent-core ADR (proposed number 0025)

> **ADR 0025 · Tool executor as an external service.** Status: proposed. Context: `ToolExecutor` is an in-process port whose only implementations are test doubles; production needs data access that must not live in the engine process (PII, credentials, cadence). Decision: add `HttpToolExecutor`, selected by `AGENTCORE_TOOL_SERVICE_URL` + `AGENTCORE_TOOL_SERVICE_TOKEN` (both or neither, like ADR 0024). It posts `{args, bound_params, context, idempotency_key}` to `/v1/tools/{tool}/execute` and returns the service's `ToolResult`. Transport errors map to typed kinds; a transport error on a write is `uncertain` (ADR 0007), on a read `error`. `bound_params` and the signed principal/delegation are sent unchanged; the model's `args` never carry the subject. The tool definitions (yaml) stay in the registry; the service implements them by name and the engine checks at publish time that every tool of a version is known to the service through `GET /v1/tools` (name, version of args schema). Consequences: the engine holds no data credentials; a contract file shared with the service is checked for drift in CI; the demo doubles remain behind `AGENTCORE_ALLOW_DEMO=1`. Open: whether `GET /v1/tools` should also publish `source`/classification hints.
