# OpenClaw Gateway

## What this is

OpenClaw is an upstream open-source AI agent gateway (not our code). It exposes a web UI and API for creating and running AI agents, handling conversations across Telegram/WhatsApp/Discord/Slack, and routing model requests to providers. We run a self-hosted instance of it.

- **Upstream repo**: `coollabsio/openclaw` (builds from `ghcr.io/coollabsio/openclaw-base`)
- **Our fork/config repo**: `u2giants/openclaw` (branch `main`) — we only maintain config and scripts, not the gateway itself
- **Source directory**: `/worksp/openclaw/ocgate/`
- **Public URL**: `https://claw.designflow.app`
- **Direct access**: `http://178.156.180.212:8081` (bypasses Cloudflare)

---

## Deployment

### How it works (GitHub Actions → GHCR → Coolify)

```
push to main
  → GitHub Actions: .github/workflows/publish-image.yml
    → docker buildx build → ghcr.io/u2giants/openclaw:main (+ :sha-<commit>)
    → POST Coolify API /api/v1/applications/yxz0hmaien0bgn0sv64g8q3p/start
      → Coolify pulls ghcr.io/u2giants/openclaw:main
      → docker compose up (from Coolify's /artifacts/ clone of the repo)
```

**Code changes → push to main → done.** Coolify pulls the image built by GitHub Actions; it does not build from source itself.

This is the same pattern as `ocmc` (`u2giants/mission-control`).

### Docker Compose services

| Service | Image | Purpose |
|---------|-------|---------|
| `openclaw` | `ghcr.io/u2giants/openclaw:main` (built by GitHub Actions) | Gateway: nginx + openclaw binary + configure.js |
| `browser` | `coollabsio/openclaw-browser:latest` | Chromium sidecar with CDP + noVNC for agent browser tool |
| `cloudflared` | `cloudflare/cloudflared:latest` | Cloudflare Tunnel → `https://claw.designflow.app` |

### GitHub Actions workflow

File: `.github/workflows/publish-image.yml`

Triggers on every push to `main` and on manual `workflow_dispatch`.

Required GitHub secrets (repo Settings → Secrets → Actions):

| Secret | Value |
|--------|-------|
| `COOLIFY_BASE_URL` | `https://coolify.designflow.app` |
| `COOLIFY_API_TOKEN` | Coolify API token (same as `COOLIFY_TOKEN` in `ocmc/.env`) |

`GITHUB_TOKEN` (automatic) is used to push to GHCR — no manual setup needed.

### Coolify configuration

Coolify UUID: `yxz0hmaien0bgn0sv64g8q3p`

Coolify is configured as a **Docker Compose** deployment pointing at `u2giants/openclaw` branch `main`. It uses the `docker-compose.yml` from the repo, which pulls `image: ghcr.io/u2giants/openclaw:main` — Coolify does **not** build from source.

Coolify has its **own env var store** (set in the UI). The `.env` file in this repo is a local mirror for manual `docker compose` runs only — keep them in sync when adding new vars.

### Container lifecycle

```bash
# View logs
sudo docker logs yxz0hmaien0bgn0sv64g8q3p-openclaw-1

# Live config (inside container)
sudo docker exec yxz0hmaien0bgn0sv64g8q3p-openclaw-1 cat /data/.openclaw/openclaw.json

# Manual run (uses .env, matches Coolify's project name — safe to run alongside Coolify)
cd /worksp/openclaw/ocgate && sudo docker compose up -d

# Stop everything (also stops cloudflared — takes down claw.designflow.app)
cd /worksp/openclaw/ocgate && sudo docker compose down
# Always restart immediately: sudo docker compose up -d
```

> **Note**: `COMPOSE_PROJECT_NAME=yxz0hmaien0bgn0sv64g8q3p` in `.env` ensures manual `docker compose` reuses Coolify's project name and containers, preventing port conflicts.

### Startup sequence

On every container start, `entrypoint.sh` runs:
1. Installs Docker CLI if socket is mounted
2. Runs `configure.js` — reads env vars, writes/patches `/data/.openclaw/openclaw.json`
3. Generates nginx config (with HTTP Basic Auth, hooks bypass, etc.)
4. Starts nginx and the openclaw gateway binary

`configure.js` is the only place that should modify `openclaw.json`. Don't edit it directly — it gets overwritten on every restart.

---

## Models

### How models work

All AI model requests route through **OpenRouter** (`OPENROUTER_API_KEY`). OpenRouter is a built-in provider in openclaw — just setting the env var activates it.

### `config/models.json`

Our model registry — source of truth for model IDs, display names, and pricing shown in Mission Control. Models use OpenRouter model IDs (e.g. `openai/gpt-5.4`, `anthropic/claude-sonnet-4.6`).

`configure.js` reads this file on startup and configures openclaw's model list. The `defaultModel` field sets which model is used when no model is specified.

Current models: GPT-5.4/mini/nano, Gemini 3/3.1 Flash/Pro, Claude Sonnet 4.6, Claude Haiku 4.5, DeepSeek V3.1/V3.2.

### `OPENCLAW_PRIMARY_MODEL`

Sets the default model for new agents and the UI default. **Must use the format `provider/model-id`** — e.g. `openrouter/google/gemini-3-flash-preview`.

Current default: `openrouter/google/gemini-3-flash-preview`

This is the only reliable way to set the default — editing `openclaw.json` directly is overwritten by `configure.js` on every restart.

### Adding a new model

Edit `config/models.json`, set `"provider": "openrouter"` and `"apiModel": "<openrouter-model-id>"`. Push and redeploy.

---

## Environment Variables

All env vars are set in **Coolify UI** (the `.env` file is a local mirror for manual runs only — keep them in sync when adding new vars).

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `OPENROUTER_API_KEY` | Primary AI provider (all models route here) | `sk-or-v1-...` |
| `AUTH_USERNAME` | HTTP Basic Auth username for gateway UI | `ahazan` |
| `AUTH_PASSWORD` | HTTP Basic Auth password | `...` |
| `OPENCLAW_GATEWAY_TOKEN` | Bearer token for MC→gateway API calls | `Albert2026Token` |
| `CLOUDFLARE_TUNNEL_TOKEN` | Cloudflare Tunnel credential | `eyJ...` |

### AI Providers (legacy — can be left set for fallback)

| Variable | Provider |
|----------|----------|
| `ANTHROPIC_API_KEY` | Anthropic direct |
| `OPENAI_API_KEY` | OpenAI direct |
| `GEMINI_API_KEY` | Google Gemini direct |

### Gateway config

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCLAW_PRIMARY_MODEL` | `openrouter/google/gemini-3-flash-preview` | Default model for new agents |
| `GATEWAY_AUTH_MODE` | `token` | Set to `none` (required in v2026.3.22+) to fix Control UI `operator.read` scope error |
| `GATEWAY_ALLOWED_ORIGINS` | — | CSV of allowed Control UI origins, e.g. `https://claw.designflow.app` |
| `OPENCLAW_PAIR_APPROVE` | — | Auto-approve pairing from a channel, e.g. `telegram:CRSJTY6S` |
| `OPENCLAW_DOCKER_INIT_SCRIPT` | — | Path to init script run on startup, e.g. `/data/.openclaw/patch.sh` |

### Channels

| Variable | Channel | Notes |
|----------|---------|-------|
| `TELEGRAM_BOT_TOKEN` | Telegram | Gate — required to activate |
| `WHATSAPP_ENABLED=true` | WhatsApp | Gate — required to activate |
| `DISCORD_BOT_TOKEN` | Discord | Gate — required to activate |
| `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` | Slack | Both required |

Full channel env var lists: [Telegram](https://docs.openclaw.ai/channels/telegram) · [WhatsApp](https://docs.openclaw.ai/channels/whatsapp) · [Discord](https://docs.openclaw.ai/channels/discord) · [Slack](https://docs.openclaw.ai/channels/slack)

### Browser / Tools

| Variable | Default | Description |
|----------|---------|-------------|
| `BROWSER_CDP_URL` | `http://browser:9223` | CDP endpoint for browser sidecar |
| `BROWSER_DEFAULT_PROFILE` | `openclaw` | Chrome profile to use |
| `BROWSER_EVALUATE_ENABLED` | `false` | Allow JS evaluation in browser |
| `DOCKER_HOST` | — | Set to `unix:///var/run/docker.sock` to give agents Docker access (also uncomment socket mount in docker-compose.yml) |
| `CLAWDTALK_API_KEY` | — | ClawdTalk integration key |

---

## Architecture notes

### Auth layers

```
Internet → Cloudflare Tunnel → nginx (HTTP Basic Auth) → openclaw gateway (auth.mode=none)
```

`GATEWAY_AUTH_MODE=none` is required in v2026.3.22+ because when mode=`token`, the gateway strips scopes from trusted-proxy (nginx) sessions, breaking the Control UI's `operator.read` scope. With mode=`none`, nginx handles all auth and the gateway trusts the proxy unconditionally.

### Provider configuration model

Built-in providers (OpenRouter, Anthropic, OpenAI, Gemini, xAI, Groq, Mistral, Cerebras, etc.) are activated by setting their env var — openclaw detects them automatically. Do **not** add entries to `models.providers` for built-in providers; openclaw will reject them for missing fields.

Custom/proxy providers (Venice, Moonshot, Kimi, etc.) need a full `models.providers` entry in `configure.js` with `api`, `apiKey`, `baseUrl`, and `models[]`.

### Channel vs Provider config strategy

- **Providers**: stateless — `configure.js` deletes and recreates on every start. Safe because it's just API keys.
- **Channels**: stateful — `configure.js` merges, preserving runtime state (group allowlists, guild IDs, pairing tokens). Never overwrite channel config from env vars.
- **Exception**: WhatsApp uses full overwrite (added later with simpler model; runtime auth is via QR/pairing stored separately).

### Browser sidecar

The `browser` container runs Chromium with CDP on port 9222. An nginx proxy on port 9223 rewrites the `Host` header to `localhost` (Chrome rejects CDP WebSocket connections from non-localhost origins). Agents connect via `http://browser:9223`. A human can log into sites using the noVNC UI at `https://claw.designflow.app/browser/` and agents reuse those sessions.

---

## Mission Control integration

Mission Control (`u2giants/mission-control`, at `https://mc.designflow.app`) is a separate app that manages agents on this gateway.

- MC calls the gateway via the **public URL** `https://claw.designflow.app` (HTTP Basic Auth with `OPENCLAW_GATEWAY_TOKEN`)
- MC pushes agent configs (system prompt, model, tools) to the gateway on every agent save
- Agent soul files live in `/data/mc-agents/<agent-id>.md` inside the gateway container
- Both apps share `config/models.json` as the canonical model list

---

## Coolify deploy troubleshooting

### Workflow ran but Coolify deploy step failed

Check that both GitHub secrets are set in `u2giants/openclaw` → Settings → Secrets → Actions:
- `COOLIFY_BASE_URL` = `https://coolify.designflow.app`
- `COOLIFY_API_TOKEN` = Coolify API token

### Deploy fails: git URL malformed

If Coolify's repository field contains a full URL like `https://github.com/u2giants/openclaw`, Coolify prepends `https://github.com/` and doubles it. The field should contain only: `u2giants/openclaw`

### cloudflared crash-loops after Coolify deploy

Coolify may not pass `CLOUDFLARE_TUNNEL_TOKEN` from its env var store to the compose environment. Fix: ensure all required vars are set in **Coolify UI → ocgate → Environment Variables** (not just in `.env`).

### Manual run alongside Coolify (safe)

Because `.env` sets `COMPOSE_PROJECT_NAME=yxz0hmaien0bgn0sv64g8q3p`, manual `docker compose up` reuses Coolify's containers and project — no port conflict:

```bash
cd /worksp/openclaw/ocgate && sudo docker compose up -d
```

### History: why we switched from `build: .` to pre-built image

Previously `docker-compose.yml` had `build: .`. Coolify clones the repo to `/artifacts/<uuid>/` and builds from there. Manual runs in the workspace built under project name `ocgate`. Both tried to bind port 8081 → "port already allocated" errors and split-brain state. The fix: build once in GitHub Actions, publish to GHCR, have both Coolify and manual runs pull the same pre-built image. `COMPOSE_PROJECT_NAME` ensures they share the same Docker project.
