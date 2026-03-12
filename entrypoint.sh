#!/bin/bash
set -e

# Ensure /data and OpenClaw state paths are writable by openclaw
mkdir -p /data/.openclaw/identity /data/workspace /data/workspace/screenshots /data/workspace/skills
chown -R openclaw:openclaw /data 2>/dev/null || true
chmod 700 /data 2>/dev/null || true
chmod 700 /data/.openclaw 2>/dev/null || true
chmod 700 /data/.openclaw/identity 2>/dev/null || true

# Sync custom skills to workspace (only outlook-email — skip browser-automation to save prompt tokens)
if [ -d /app/skills/outlook-email ]; then
  mkdir -p /data/workspace/skills/outlook-email
  cp -r /app/skills/outlook-email/* /data/workspace/skills/outlook-email/ 2>/dev/null || true
  chown -R openclaw:openclaw /data/workspace/skills/outlook-email 2>/dev/null || true
  echo "[entrypoint] Synced outlook-email skill to workspace"
fi
# Remove browser-automation skill if previously synced (saves ~1K tokens per API call)
rm -rf /data/workspace/skills/browser-automation 2>/dev/null || true

# Sync BOOT.md (agent personality) to workspace
if [ -f /app/BOOT.md ]; then
  cp /app/BOOT.md /data/workspace/BOOT.md 2>/dev/null || true
  chown openclaw:openclaw /data/workspace/BOOT.md 2>/dev/null || true
  echo "[entrypoint] Synced BOOT.md to workspace"
fi

# Sync HEARTBEAT.md (EA heartbeat routine) to workspace
if [ -f /app/HEARTBEAT.md ]; then
  cp /app/HEARTBEAT.md /data/workspace/HEARTBEAT.md 2>/dev/null || true
  chown openclaw:openclaw /data/workspace/HEARTBEAT.md 2>/dev/null || true
  echo "[entrypoint] Synced HEARTBEAT.md to workspace"
fi

# ── Cost-efficiency configuration ─────────────────────────────────────
# Applied on every boot to ensure correct values even after volume reset.
# All commands suppress errors so a single bad key never blocks startup.

# 1. Concurrency limits — avoid Anthropic API rate limits
gosu openclaw openclaw config set agents.defaults.maxConcurrent 1 2>/dev/null || true
gosu openclaw openclaw config set agents.defaults.subagents.maxConcurrent 2 2>/dev/null || true

# 2. Context pruning — drop stale tokens early
gosu openclaw openclaw config set agents.defaults.contextPruning.keepLastAssistants 1 2>/dev/null || true
gosu openclaw openclaw config set agents.defaults.contextPruning.softTrimRatio 0.8 2>/dev/null || true
gosu openclaw openclaw config set agents.defaults.contextPruning.hardClearRatio 0.95 2>/dev/null || true
gosu openclaw openclaw config set agents.defaults.compaction.mode safeguard 2>/dev/null || true

# 3. Model — Gemini 2.5 Flash primary, Gemini 2.0 Flash for heartbeat/subagents
gosu openclaw openclaw config set agents.defaults.model.primary google/gemini-2.5-flash 2>/dev/null || true
gosu openclaw openclaw config set agents.defaults.subagents.model google/gemini-2.0-flash 2>/dev/null || true
gosu openclaw openclaw config set agents.defaults.model.fallbacks google/gemini-2.0-flash 2>/dev/null || true

# 4. Tool output caps — reduce tokens consumed by tool results in context
gosu openclaw openclaw config set tools.web.fetch.maxCharsCap 20000 2>/dev/null || true
gosu openclaw openclaw config set agents.defaults.bootstrapMaxChars 10000 2>/dev/null || true

# 5. Heartbeat — EA checks for unread scheduling emails every 30 min
#    Combined with active hours gate (8AM-9PM PT), this means ~26 heartbeats/day max
gosu openclaw openclaw config set agents.defaults.heartbeat.every 30m 2>/dev/null || true
gosu openclaw openclaw config set agents.defaults.heartbeat.model google/gemini-2.0-flash 2>/dev/null || true

# 7. Disable all bundled skills to reduce system prompt size
gosu openclaw openclaw config set --json skills.allowBundled '[]' 2>/dev/null || true

echo "[entrypoint] Applied cost-efficiency config"

# ── Composio Outlook credentials (james@elevatecappartners.com) ───────
# COMPOSIO_API_KEY and COMPOSIO_OUTLOOK_ACCOUNT_ID are set via Railway
# environment variables — never hardcode secrets in source code.

# Persist Homebrew to Railway volume so it survives container rebuilds
BREW_VOLUME="/data/.linuxbrew"
BREW_SYSTEM="/home/openclaw/.linuxbrew"

if [ -d "$BREW_VOLUME" ]; then
  # Volume already has Homebrew — symlink back to expected location
  if [ ! -L "$BREW_SYSTEM" ]; then
    rm -rf "$BREW_SYSTEM"
    ln -sf "$BREW_VOLUME" "$BREW_SYSTEM"
    echo "[entrypoint] Restored Homebrew from volume symlink"
  fi
else
  # First boot — move Homebrew install to volume for persistence
  if [ -d "$BREW_SYSTEM" ] && [ ! -L "$BREW_SYSTEM" ]; then
    mv "$BREW_SYSTEM" "$BREW_VOLUME"
    ln -sf "$BREW_VOLUME" "$BREW_SYSTEM"
    echo "[entrypoint] Persisted Homebrew to volume on first boot"
  fi
fi

# Export tool output token cap for gateway subprocess
# Lowered from 3000 — trimmed responses from outlook-skill.js are now ~200-500 bytes
export SKILL_MAX_OUTPUT_TOKENS=1500

exec gosu openclaw node src/server.js
