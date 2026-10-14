---
name: convert-and-flow-operator
platform: vps
---

# Skill 44 — Convert and Flow Operator (VPS overlay)

Venv root: `tools/engine/.venv` (in-tree, inside the skill; per-container on fleet-contabo)
Wrapper: `tools/engine/caf` (in-tree, inside the skill)

## Firebase token on a container install

There is no Chrome profile in the container. When the Firebase refresh token is expired or missing:
1. The agent surfaces a nudge for the owner (delivered through the client's configured channel): "I need you to grab the Convert and Flow token to build workflows directly."
2. The owner copies the token from their browser at https://app.gohighlevel.com
3. The owner pastes it to the agent
4. The agent writes it to that container's own secrets env file (the file $SECRETS_ENV names) and runs tools/engine/wire-ghl-env.sh --write so the session environment carries it

See parent SKILL.md for the full skill description.
