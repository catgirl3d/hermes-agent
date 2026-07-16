# Hermes Surfaces and Other Capabilities

Use this file for non-CLI surfaces and a few capabilities that are easy to
forget because they live outside the usual chat loop.

## Desktop App

`hermes desktop` or `hermes gui` launches the native Electron app for
macOS, Linux, and Windows. It supports streaming chat, session list, drag and
drop and clipboard-paste files, a command palette, status-bar model picker,
native notifications, and per-profile remote-gateway login.

## Web Dashboard

`hermes dashboard` launches the web admin panel. It can configure messaging
channels, MCP catalog entries, webhooks, memory, and complete profile setups,
and includes an embedded `hermes --tui` chat.

## OpenAI-Compatible Proxy

`hermes proxy` exposes a local OpenAI-style API backed by whichever OAuth
provider you are signed into. That lets external tools point at Hermes without
their own provider API key.

## Other Notable Capabilities

- Automation Blueprints for named workflows.
- `memory` batch operations applied atomically.
- `session_search` backed by SQLite FTS5 with low cost.
- xAI Grok support via SuperGrok OAuth.

## Verification

- Dashboard and desktop are separate surfaces with shared agent core.
- For TUI/dashboard architecture details, verify against `ui-tui/`, `tui_gateway/`, and `hermes_cli/web_server.py`.
