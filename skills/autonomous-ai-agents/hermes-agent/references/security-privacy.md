# Hermes Security and Privacy Toggles

Use this file when you need to explain why Hermes is redacting output, asking
for approval, or refusing certain network and browser behavior.

## Secret Redaction in Tool Output

Secret redaction is on by default. Tool output such as terminal stdout,
`read_file`, web content, and subagent summaries is scanned for strings that
look like API keys, tokens, and secrets before they enter conversation context
and logs.

```bash
hermes config set security.redact_secrets true
```

Restart required. `security.redact_secrets` is snapshotted at import time, so a
running Hermes process will not pick up a mid-session toggle.

Disable only when you deliberately need raw credential-like strings for
debugging or redactor development:

```bash
hermes config set security.redact_secrets false
```

## PII Redaction in Gateway Messages

Separate from secret redaction. When enabled, the gateway hashes user IDs and
strips phone numbers from session context before it reaches the model.

```bash
hermes config set privacy.redact_pii true
hermes config set privacy.redact_pii false
```

## Command Approval Prompts

By default (`approvals.mode: smart`), Hermes asks an auxiliary LLM to assess
commands flagged as destructive.

- `smart` -- auto-approve a low-risk command once, deny high-risk commands, and prompt when uncertain.
- `manual` -- always prompt.
- `off` -- skip all approval prompts. Equivalent to `--yolo`.

```bash
hermes config set approvals.mode smart
hermes config set approvals.mode off
```

Per-invocation bypass without changing config:

- `hermes --yolo ...`
- `export HERMES_YOLO_MODE=1`

YOLO does not disable secret redaction. They are independent controls.

## Shell Hooks Allowlist

Some shell-hook integrations require explicit allowlisting before they run.
They are managed via `~/.hermes/shell-hooks-allowlist.json` and are approved
interactively the first time a hook requests access.

## Disabling Web, Browser, or Image Generation Tools

If you need to keep the model away from network or media tools entirely, use
`hermes tools` and toggle the relevant toolsets per platform. Changes take
effect on the next session.
