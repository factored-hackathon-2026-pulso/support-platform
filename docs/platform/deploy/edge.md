# Edge requirements: CloudFront and the host reverse proxy

What the support platform needs from the edge in front of it. Infra owns and configures it
(github.com/pulso-factored/infra: `terraform/modules/hackathon_edge`, `deploy/hackathon/platform`);
this document is the platform's side of that contract. The API's own runtime contract
(variables, health, shutdown) is [../deploy-env.md](../deploy-env.md).

Checked against infra `main` as of 2026-10-05 (one CloudFront distribution, a VPC origin to the
platform host on :80, Caddy on the host routing `/api/*` to `support-platform-api:8000` and
everything else to `support-platform-web:80`). Items marked **change** differ from what is
there today.

## 1. Paths

One domain serves the SPA, the REST API and the WebSocket. The SPA must be built with
`VITE_API_URL=/` (**change**: the web image's build argument) so it calls `/api/v1/...` and
`wss://<domain>/api/v1/ws` on its own origin; then `CC_CORS_ORIGINS=[]`.

| Path | Goes to | Notes |
| --- | --- | --- |
| `/api/*` | API (`support-platform-api:8000`) | REST, JSON. Includes the WebSocket below. |
| `/api/v1/ws` | API | WebSocket (`?token=<session token>`). Under `/api/*`: no separate rule needed. |
| `/api/v1/internal/*` | **never from CloudFront** | Service-to-service routes (agent-core `grant_active`, engine announce, evidence). Blocked at the proxy, as today; services reach them inside the network. |
| `/healthz`, `/readyz` | API, inside the host only | For the container health check. Not routed from CloudFront (Caddy answers its own `/healthz`). |
| everything else | SPA (`support-platform-web:80`, nginx) | Static files; unknown paths return `index.html` (client-side routes). |

## 2. WebSocket

- CloudFront supports WebSocket on any behaviour that forwards the viewer headers
  (`Managed-AllViewer`, as today): `Upgrade`, `Connection`, `Sec-WebSocket-Key`,
  `Sec-WebSocket-Version`, `Sec-WebSocket-Extensions`, `Sec-WebSocket-Protocol`. HTTP/1.1 to
  the origin.
- Caddy upgrades WebSockets itself; nothing to add. Do not set a response or idle timeout on
  the `/api/*` proxy shorter than 60 s (Caddy sets none by default).
- **Idle timeouts:** the API sends a `heartbeat` data frame on every socket every 25 s
  (`CC_REALTIME_HEARTBEAT_SECONDS`) plus protocol pings every 20 s, so no hop (CloudFront,
  Caddy, the VPC origin) sees a socket idle for more than 25 s. A hop with a shorter idle
  timeout needs `CC_REALTIME_HEARTBEAT_SECONDS` below it.
- Deploys and restarts close sockets with 1012; the SPA reconnects by itself (backoff 0.5 s to
  15 s, resubscribe, refetch). Nothing at the edge needs to be sticky: there is one API process.

## 3. Timeouts

| Setting | Value | Why |
| --- | --- | --- |
| CloudFront origin response (read) timeout | **60 s** (**change**: default 30 s) | Some requests wait synchronously for the Core (copilot answers, builder evaluation) up to `CC_AGENT_CORE_TIMEOUT_SECONDS` (60 s). Keep that value below the edge timeout: with CloudFront's maximum of 60 s (without a quota increase), set `CC_AGENT_CORE_TIMEOUT_SECONDS=55`. |
| CloudFront origin keep-alive timeout | default (5 s) | Caddy's idle keep-alive is longer, so CloudFront never reuses a connection the proxy just closed. |
| Container stop grace period | **30 s** (**change**: compose `stop_grace_period: 30s` on `support-platform-api`; Docker's default is 10 s) | Graceful shutdown: up to `CC_SHUTDOWN_TIMEOUT_SECONDS` (10 s) for requests, then again for background jobs. |
| Health check | `interval 15s`, `timeout 5s`, `start_period 30s` | `/readyz` answers within `CC_READINESS_TIMEOUT_SECONDS` (2 s) per dependency, checked in parallel. |

## 4. Headers

**From CloudFront to the origin** (`Managed-AllViewer`, as today): all viewer headers,
**`Authorization`** (bearer session tokens) and **query strings** (the WebSocket token). The
platform sets and reads **no cookies**. `X-Origin-Verify` keeps being checked by Caddy first.

**From Caddy to the API:**

| Header | Required value | Today |
| --- | --- | --- |
| `X-Forwarded-Proto` | `https` (the viewer always uses https; CloudFront reaches the origin over http) | **change**: Caddy sends `http`. Add `header_up X-Forwarded-Proto https` to the `/api/*` `reverse_proxy`. |
| `X-Forwarded-For` | `<viewer>, <CloudFront VPC origin address>` | **change**: Caddy replaces it with its peer (the VPC origin address) because it does not trust it. Add the VPC CIDR to Caddy's `servers { trusted_proxies static <VPC CIDR> }` so it keeps CloudFront's value and appends. |
| `X-Forwarded-Host` | the CloudFront domain | Caddy sets it; fine. |

**API settings that go with it** (in `support.env`): `CC_TRUSTED_PROXIES=["<docker network
CIDR of the compose network>","<VPC CIDR>"]`, e.g. `["172.16.0.0/12","10.0.0.0/16"]`. The API
then takes the right-most address that is not a trusted proxy as the client (the viewer), the
scheme (`https`, `wss`) and the host. Without the Caddy changes the API still works; the client
address is CloudFront's and absolute redirects use `http`.

## 5. Caching

| Path | Policy |
| --- | --- |
| `/api/*` (REST and WebSocket) | `Managed-CachingDisabled` (as today). Every API answer also says `Cache-Control: no-store`. |
| `/assets/*` (hashed build files) | Cacheable for a year (`Cache-Control: public, immutable` from the SPA's nginx). Optional: a behaviour with `Managed-CachingOptimized`. |
| `/`, `/index.html` and SPA routes | `Cache-Control: no-cache` from nginx, so a deploy is picked up at once; `CachingDisabled` is fine. |

## 6. Health checks (compose)

**change**: the API health check calls `http://127.0.0.1:8000/`, which is a 404 (the check
fails). Use readiness:

```yaml
healthcheck:
  test: ["CMD", "python", "-c", "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/readyz', timeout=4)"]
```

`/readyz` is 503 while the database is down or not migrated (`urlopen` raises, the check
fails), and 200 when only the Core is down (the platform keeps serving without AI). Use
`/healthz` where only "is the process alive" matters.

## 7. Logs and secrets

The WebSocket token travels in the query string. The API redacts it from its own logs; Caddy
logs nothing by default. If CloudFront standard logs are turned on, exclude the query string
field (`cs-uri-query`) or the logs will hold live session tokens. Same for any access log added
to Caddy (log the path, not the URI).

## 8. Open questions for infra

- The API container publishes no port, but agent-core (`grant_active`) and the engine (announce,
  evidence) call `/api/v1/internal/*` on the API: confirm they share the compose network (or a
  published `:8000` limited by the security group) since the proxy blocks those paths.
- The VPC CIDR and the compose network subnet, to fill `CC_TRUSTED_PROXIES` (a pinned subnet on
  the `internal` network makes it exact).
