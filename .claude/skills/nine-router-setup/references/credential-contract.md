# Credential contract

## File identity

Exactly one credential file on both platforms:

```text
Windows: <resolved Documents>\API docs.md
macOS:   <resolved Documents>/API docs.md
```

`<resolved Documents>` is the platform-resolved real Documents folder (OneDrive-safe on
Windows; `osascript`-resolved on macOS), never a hardcoded `C:\Users\<name>\Documents` or
`/Users/<name>/Documents`.

## Required contents

```text
OLLAMA_API_KEY=replace_with_real_key
DEEPSEEK_API_KEY=replace_with_real_key
AGNES_API_KEY=replace_with_real_key
OPENROUTER_API_KEY=replace_with_real_key
OLLAMA_PLAN=pro
AGNES_PLAN=starter
```

| Field | Required | Allowed values |
|---|---|---|
| `OLLAMA_API_KEY` | yes | any non-empty, non-placeholder string |
| `DEEPSEEK_API_KEY` | yes | any non-empty, non-placeholder string |
| `AGNES_API_KEY` | yes | any non-empty, non-placeholder string |
| `OPENROUTER_API_KEY` | **optional** | real key, or placeholder/absent = skip OpenRouter |
| `OLLAMA_PLAN` | yes | `free`, `pro`, `max` |
| `AGNES_PLAN` | yes | `starter`, `plus`, `pro` |

`OLLAMA_PLAN` is the deterministic source of truth for concurrency. Do **not** attempt to
discover the plan by saturating Ollama Cloud with concurrent requests.

## Parser rules

- Trim whitespace.
- Ignore blank lines.
- Ignore Markdown headings and comment lines.
- Accept `KEY=value` lines (optionally `KEY = value`).
- Reject empty values and placeholder text (`replace_with_real_key`, `changeme`,
  `your-key-here`, etc.).
- Do not echo values.
- Keep values in memory only during setup.

## Validation

- Missing file → report the exact OS-resolved path and the template.
- Malformed (no valid lines, or a missing required key) → report which key is missing by
  name; never print a value.
- Invalid plan value → report the allowed set.
- A missing/placeholder OPTIONAL key is not malformed — it means "not provided."

## Platform protection

- **Windows:** tighten ACLs so only the current user and required system principals can
  read the file.
- **macOS:** if the file is owned by the current user but group/other permissions are
  broader than necessary, tighten to `chmod 600`. If macOS privacy (TCC) blocks access,
  ask the user to grant Documents access rather than bypassing privacy controls.

## Repository protections

The repo `.gitignore` must include:

```text
API docs.md
.env
.env.*
*.secret
*.secrets
credentials*
secrets*
```

The template file (`templates/API docs.md`) contains placeholders only. Never create a
`.env` inside the repo containing real values. Never commit the credential file.

## Diagnostic masking

If a diagnostic must reference a value at all, mask to at most the **first 3 and last 3**
characters. Prefer naming only the provider and the HTTP status.
