# OpenClaw Gateway

## Workspace ↔ Deployed App Mapping

- **Source code (edit here):** `/worksp/openclaw/ocgate/`
- **Deployed app (Coolify):** Coolify pulls from GitHub and runs docker-compose from the workspace directly — source and deployed are the same directory.
  - Coolify App UUID: `yxz0hmaien0bgn0sv64g8q3p`
  - Coolify app data dir: `/data/coolify/applications/yxz0hmaien0bgn0sv64g8q3p/` (mostly empty — runtime state is in Docker volumes)
  - Live config: `sudo docker exec ocgate-openclaw-1 cat /data/.openclaw/openclaw.json`
  - docker-compose: `/worksp/openclaw/ocgate/docker-compose.yml`
  - Logs: `sudo docker logs ocgate-openclaw-1` or via Coolify UI at `https://coolify.designflow.app`
- **Public URL:** `https://claw.designflow.app`

When debugging or checking running config, use `sudo docker exec/logs ocgate-openclaw-1`. When editing code, work in `/worksp/openclaw/ocgate/` and push to GitHub (`u2giants/openclaw`, branch `main`).
Claude handles all git: direct commits to main, no PRs, no branches.

---


## Gateway env vars

### `OPENCLAW_PRIMARY_MODEL` (optional string)

Sets the default model shown in the UI and used for new agents. **This is the only way to make the default model stick** — editing `openclaw.json` directly is overwritten by `configure.js` on every container start.

Example: `OPENCLAW_PRIMARY_MODEL=openrouter/google/gemini-3-flash-preview`

Default in `docker-compose.yml`: `openrouter/google/gemini-3-flash-preview`

Maps to `agents.defaults.model.primary` in `openclaw.json`.

---

### `GATEWAY_ALLOWED_ORIGINS` (CSV → array)

Maps to `gateway.controlUi.allowedOrigins`. Allows the Control UI to be accessed from the listed origins (e.g. when behind a reverse proxy or Cloudflare Tunnel).

Example: `GATEWAY_ALLOWED_ORIGINS=https://claw.designflow.app`

Multiple origins: `GATEWAY_ALLOWED_ORIGINS=https://claw.designflow.app,https://other.domain.com`

---

## Docker API access env var

### `DOCKER_HOST` (optional string)

When set (or when `/var/run/docker.sock` is bind-mounted), `entrypoint.sh` auto-installs the Docker CLI (`docker.io` via apt) on first start and sets socket permissions to `chmod 666`. Default: `unix:///var/run/docker.sock`.

Handled entirely in `entrypoint.sh` (lines 65-84) — no `configure.js` mapping needed (Docker API access is not an openclaw gateway config option; it's a host-level capability for agent tools).

To enable: uncomment the socket mount in `docker-compose.yml`:
```yaml
- /var/run/docker.sock:/var/run/docker.sock
```

**Security model:** Disabled by default. When enabled, agents get full `docker` CLI access (root-equivalent on host). No capability restrictions, no seccomp/AppArmor profiles, no user namespace isolation, no per-agent sandboxing. See README.md § "Docker API access" for full security analysis and mitigation recommendations.

---

## Control UI `operator.read` scope fix

### `GATEWAY_AUTH_MODE` (optional string, default: `token`)

Set to `none` to run the gateway without token auth (nginx handles HTTP basic auth instead). **Required in openclaw v2026.3.22+** to fix `GatewayRequestError: missing scope: operator.read` in the Control UI.

**Why**: v2026.3.22 clears self-declared scopes for trusted-proxy sessions (nginx → gateway) when `auth.mode=token`. With `mode=none` the gateway honours the Control UI's declared scopes (including `operator.read`) because no proxy-authentication security restriction applies.

**Security**: safe when `gateway.bind=loopback` (default) — only nginx, which enforces HTTP basic auth, can reach the gateway port.

Maps to `gateway.auth.mode` in `openclaw.json`. When set to `none`, the `OPENCLAW_GATEWAY_TOKEN` value is still used by nginx but not written to the gateway config.

`entrypoint.sh` also includes a `_patch_scopes()` call as a belt-and-suspenders fix for older images where the Control UI JS itself was missing `"operator.read"` (openclaw PRs #46711/#47828). Safe to leave in place.

---

---

## Channel vs Provider configuration model

**Providers** (`models.providers`) are AI model backends. Built-in providers (Anthropic, OpenAI, etc.) need no JSON — openclaw knows them natively. `configure.js` only checks the env var exists. If removed, stale provider entries are **deleted** from persisted config. Custom providers (Venice, Moonshot, etc.) are fully written when env var is present, fully removed when absent.

**Channels** (`channels.<name>`) are user messaging platforms. They carry complex nested state (group allowlists, guild policies) that can't be expressed as flat env vars, so they live in custom JSON.

**Why different merge strategies:** Providers are stateless config (just an API key and optional base URL), so clean delete/recreate is safe. Channels accumulate runtime state and complex nested config, so merge-and-preserve is safer.

### Merge rules in `configure.js`

- **Telegram/Discord/Slack**: merge — `config.channels.X = config.channels.X || {}` (env vars override individual keys, custom JSON keys preserved)
- **WhatsApp**: full overwrite — `config.channels.whatsapp = {}` (env vars are authoritative, custom JSON whatsapp block is discarded when WHATSAPP_ENABLED=true). WhatsApp uses overwrite because it was added later with a simpler, fully env-var-driven model and runtime QR/pairing auth.
- **Providers**: delete when env var removed, never merge from JSON for built-in providers

See README.md § "Channels vs Providers: configuration model" for the full explanation.

### Telegram env vars (20 total)

Gate: `TELEGRAM_BOT_TOKEN` (required to activate).

Strings: `TELEGRAM_DM_POLICY`, `TELEGRAM_GROUP_POLICY`, `TELEGRAM_REPLY_TO_MODE`, `TELEGRAM_CHUNK_MODE`, `TELEGRAM_STREAM_MODE`, `TELEGRAM_REACTION_NOTIFICATIONS`, `TELEGRAM_REACTION_LEVEL`, `TELEGRAM_PROXY`, `TELEGRAM_WEBHOOK_URL`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_WEBHOOK_PATH`, `TELEGRAM_MESSAGE_PREFIX`
Booleans: `TELEGRAM_LINK_PREVIEW`, `TELEGRAM_ACTIONS_REACTIONS`, `TELEGRAM_ACTIONS_STICKER`
Numbers: `TELEGRAM_TEXT_CHUNK_LIMIT`, `TELEGRAM_MEDIA_MAX_MB`
CSV→Array: `TELEGRAM_ALLOW_FROM`, `TELEGRAM_GROUP_ALLOW_FROM` (user IDs as integers, usernames as strings)
Nested: `TELEGRAM_INLINE_BUTTONS` → `capabilities.inlineButtons`

Docs: https://docs.openclaw.ai/channels/telegram

### WhatsApp env vars (15 total)

Gate: `WHATSAPP_ENABLED=true` (required to activate).

Strings: `WHATSAPP_DM_POLICY`, `WHATSAPP_GROUP_POLICY`, `WHATSAPP_MESSAGE_PREFIX`
Booleans: `WHATSAPP_SELF_CHAT_MODE`, `WHATSAPP_SEND_READ_RECEIPTS`, `WHATSAPP_ACTIONS_REACTIONS`
Numbers: `WHATSAPP_MEDIA_MAX_MB`, `WHATSAPP_HISTORY_LIMIT`, `WHATSAPP_DM_HISTORY_LIMIT`
CSV→Array: `WHATSAPP_ALLOW_FROM`, `WHATSAPP_GROUP_ALLOW_FROM` (E.164 phone numbers)
Nested object: `WHATSAPP_ACK_REACTION_EMOJI`, `WHATSAPP_ACK_REACTION_DIRECT`, `WHATSAPP_ACK_REACTION_GROUP`

### Discord env vars (32 total)

Gate: `DISCORD_BOT_TOKEN` (required to activate).

Strings: `DISCORD_DM_POLICY`, `DISCORD_GROUP_POLICY`, `DISCORD_REPLY_TO_MODE`, `DISCORD_CHUNK_MODE`, `DISCORD_REACTION_NOTIFICATIONS`, `DISCORD_MESSAGE_PREFIX`
Booleans: `DISCORD_ALLOW_BOTS`, `DISCORD_ACTIONS_REACTIONS`, `DISCORD_ACTIONS_STICKERS`, `DISCORD_ACTIONS_EMOJI_UPLOADS`, `DISCORD_ACTIONS_STICKER_UPLOADS`, `DISCORD_ACTIONS_POLLS`, `DISCORD_ACTIONS_PERMISSIONS`, `DISCORD_ACTIONS_MESSAGES`, `DISCORD_ACTIONS_THREADS`, `DISCORD_ACTIONS_PINS`, `DISCORD_ACTIONS_SEARCH`, `DISCORD_ACTIONS_MEMBER_INFO`, `DISCORD_ACTIONS_ROLE_INFO`, `DISCORD_ACTIONS_CHANNEL_INFO`, `DISCORD_ACTIONS_CHANNELS`, `DISCORD_ACTIONS_VOICE_STATUS`, `DISCORD_ACTIONS_EVENTS`, `DISCORD_ACTIONS_ROLES`, `DISCORD_ACTIONS_MODERATION`
Numbers: `DISCORD_TEXT_CHUNK_LIMIT`, `DISCORD_MAX_LINES_PER_MESSAGE`, `DISCORD_MEDIA_MAX_MB`, `DISCORD_HISTORY_LIMIT`, `DISCORD_DM_HISTORY_LIMIT`
CSV→Array: `DISCORD_DM_ALLOW_FROM` (user IDs/names, always strings)

Docs: https://docs.openclaw.ai/channels/discord

### Slack env vars (21 total)

Gate: `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` (both required to activate).

Strings: `SLACK_USER_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_MODE`, `SLACK_WEBHOOK_PATH`, `SLACK_DM_POLICY`, `SLACK_GROUP_POLICY`, `SLACK_REPLY_TO_MODE`, `SLACK_REACTION_NOTIFICATIONS`, `SLACK_CHUNK_MODE`, `SLACK_MESSAGE_PREFIX`
Booleans: `SLACK_ALLOW_BOTS`, `SLACK_ACTIONS_REACTIONS`, `SLACK_ACTIONS_MESSAGES`, `SLACK_ACTIONS_PINS`, `SLACK_ACTIONS_MEMBER_INFO`, `SLACK_ACTIONS_EMOJI_LIST`
Numbers: `SLACK_HISTORY_LIMIT`, `SLACK_TEXT_CHUNK_LIMIT`, `SLACK_MEDIA_MAX_MB`
CSV→Array: `SLACK_DM_ALLOW_FROM` (user IDs/handles, always strings)

Docs: https://docs.openclaw.ai/channels/slack

### Hooks env vars (3 total)

Gate: `HOOKS_ENABLED=true` (required to activate).

Strings: `HOOKS_TOKEN`, `HOOKS_PATH`

Merge behavior: same as Telegram/Discord/Slack (merge, custom JSON keys preserved).

`entrypoint.sh` reads the resolved `hooks.path` from `openclaw.json` after `configure.js` runs and generates an nginx `location` block that **bypasses HTTP basic auth** for that path. Openclaw validates hook requests via its own token auth (`Authorization: Bearer <hooks.token>`).

Complex keys (`presets`, `mappings`, `transformsDir`) are JSON-only — not exposed as env vars.

Docs: https://docs.openclaw.ai/automation/webhook

### Browser env vars (6 total)

Gate: `BROWSER_CDP_URL` (required to activate).

Strings: `BROWSER_CDP_URL`, `BROWSER_SNAPSHOT_MODE`, `BROWSER_DEFAULT_PROFILE`
Booleans: `BROWSER_EVALUATE_ENABLED`
Numbers: `BROWSER_REMOTE_TIMEOUT_MS`, `BROWSER_REMOTE_HANDSHAKE_TIMEOUT_MS`

Merge behavior: same as Telegram/Discord/Slack (merge, custom JSON keys preserved).

**What the CDP proxy does:** The browser sidecar (`coollabsio/openclaw-browser`, built from `Dockerfile.browser`) runs Chromium with CDP exposed on port 9222. An nginx proxy on port 9223 rewrites the `Host` header to `localhost` (Chrome rejects CDP WebSocket connections from non-localhost hosts). Agents connect via `http://browser:9223` to navigate pages, take screenshots, fill forms, and reuse sessions that a human logged into via the noVNC web UI at `/browser/`. See README.md § "Browser tool" for full architecture.

Docs: https://docs.openclaw.ai/tools/browser

### Groups/Guilds — JSON config only (all channels)

`channels.<name>.groups` (or `guilds` for Discord) is **never** exposed as an env var, for any channel. Group/guild allowlists with per-group mention gating are too complex for flat env vars. When adding a new channel, keep `groups`/`guilds` in `my-openclaw.json` only.

WhatsApp example:

```json
{
  "channels": {
    "whatsapp": {
      "groups": { "*": {} }
    }
  }
}
```

Use `"*"` key to allow all groups, or specific group JIDs for fine-grained control.

Docs: https://docs.openclaw.ai/channels/whatsapp

## Keeping docs in sync

When changing env vars, configure.js, or project structure, also update `README.md` (architecture overview + full env var reference table).

---

## Mission Control Integration

Mission Control (`u2giants/mission-control`) is a **separate Coolify app**. It calls the gateway via the public URL to avoid Docker network complexity.

**Gateway URL** (from Mission Control): `https://claw.designflow.app` (public URL, HTTP Basic Auth)
**Mission Control public URL**: `https://mc.designflow.app`
**Mission Control source**: `/worksp/openclaw/ocmc/`
**Mission Control symlink**: `/coolapps/ocmc/`

### Architecture decisions

- **Separate containers, separate deploy cycles**: gateway is upstream code we rarely touch; MC is our app
- **No custom Docker networks**: MC calls gateway via public URL — zero networking config, survives redeploys
- **Shared models.json**: both apps use `config/models.json` as single source of truth for model IDs/pricing
- **Default model everywhere**: `gemini-3-flash-preview` (from registry defaultModel)
- **Auth username everywhere**: `ahazan` (never `admin`)

### Agent lifecycle (owned by Mission Control)

- New agents are **created, configured, and managed entirely from the Mission Control UI**
- Each agent's "soul" (system prompt, personality, tool access, model) is a `.md` file stored in `/data/mc-agents/<agent-id>.md` and edited through the Mission Control UI — never manually on the server
- Mission Control pushes agent configs to the openclaw gateway via the internal API at `http://openclaw:8080`
