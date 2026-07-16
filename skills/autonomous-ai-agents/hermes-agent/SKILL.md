---
name: hermes-agent
description: "Configure, extend, or contribute to Hermes Agent."
version: 2.4.0
author: Hermes Agent + Teknium
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [hermes, setup, configuration, multi-agent, spawning, cli, gateway, development]
    homepage: https://github.com/NousResearch/hermes-agent
    related_skills: [claude-code, codex, opencode]
---

# Hermes Agent

Hermes Agent is an open-source autonomous AI agent framework by Nous Research. It runs in the terminal, desktop app, web dashboard, messaging platforms, and IDE integrations, using tools to carry out coding and task-execution work. It accumulates reusable skills and persistent memory across sessions, and works with many model providers across Linux, macOS, Windows, and WSL.

What makes Hermes different:

- **Skills** — save reusable procedures for future sessions.
- **Memory** — retain preferences, environment context, and lessons across sessions.
- **Gateway** — run the same agent on 20+ messaging platforms with full tool access.
- **Surfaces** — use CLI, TUI, desktop, dashboard, or IDE integrations.
- **Providers** — switch models and rotate pooled credentials.
- **Profiles** — isolate configs, sessions, skills, and memory.
- **Extensions** — add plugins, MCP servers, custom tools, webhooks, and cron jobs.

**This skill helps you work with Hermes Agent effectively** — setting it up, configuring features, spawning additional agent instances, troubleshooting issues, finding the right commands and settings, and understanding how the system works when you need to extend or contribute to it.

**Docs:** https://hermes-agent.nousresearch.com/docs/

This root file is intentionally short. Do not load the old all-in-one manual by default. Read this index, then load only the topic you need with
`skill_view(name="hermes-agent", file_path="references/<topic>.md")`.

## When to Use

- Install or configure Hermes Agent.
- Find Hermes CLI or slash commands.
- Set up gateway, webhooks, cron, curator, kanban, profiles, or MCP.
- Understand Hermes-specific context files and security toggles.
- Troubleshoot Hermes behavior on Linux, macOS, Windows, or WSL.
- Contribute code or docs to the Hermes repository.

## Quick Start

```bash
# Install (shell installer — sets up uv, Python, the venv, and the launcher)
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash

pip install hermes-agent       # or: uv pip install hermes-agent

# Interactive chat 
hermes

# Single query
hermes chat -q "What is the capital of France?"

# Setup wizard 
hermes setup
hermes model
hermes doctor

# Other surfaces
hermes desktop                 # launch the native desktop app (alias: hermes gui)
hermes dashboard               # web admin panel + embedded chat
hermes proxy                   # OpenAI-compatible local proxy backed by your OAuth provider
```

## Topic Index

| Need | Load |
|---|---|
| Install, chat, global flags, skills, profiles, auth, plugins, memory, ACP, and misc CLI commands | `skill_view(name="hermes-agent", file_path="references/cli.md")` |
| In-session slash commands | `skill_view(name="hermes-agent", file_path="references/slash-commands.md")` |
| Gateway platforms and service control | `skill_view(name="hermes-agent", file_path="references/gateway.md")` |
| Webhook subscriptions | `skill_view(name="hermes-agent", file_path="references/webhooks.md")` |
| Native MCP client | `skill_view(name="hermes-agent", file_path="references/native-mcp.md")` |
| Cron jobs | `skill_view(name="hermes-agent", file_path="references/cron.md")` |
| Curator skill lifecycle | `skill_view(name="hermes-agent", file_path="references/curator.md")` |
| Kanban multi-agent board | `skill_view(name="hermes-agent", file_path="references/kanban.md")` |
| Config file, paths, providers, toolsets | `skill_view(name="hermes-agent", file_path="references/config.md")` |
| Project context files | `skill_view(name="hermes-agent", file_path="references/context-files.md")` |
| Security and privacy toggles | `skill_view(name="hermes-agent", file_path="references/security-privacy.md")` |
| Voice and transcription | `skill_view(name="hermes-agent", file_path="references/voice.md")` |
| Delegating subtasks, background work, and separate Hermes processes | `skill_view(name="hermes-agent", file_path="references/spawning.md")` |
| Desktop, dashboard, proxy, and other surfaces | `skill_view(name="hermes-agent", file_path="references/surfaces.md")` |
| Windows-specific quirks | `skill_view(name="hermes-agent", file_path="references/windows.md")` |
| Troubleshooting | `skill_view(name="hermes-agent", file_path="references/troubleshooting.md")` |
| Contributor guide | `skill_view(name="hermes-agent", file_path="references/contributor.md")` |

## Loading Rules

- Start with one reference file, not many.
- For gateway work, load `references/gateway.md` first and `references/webhooks.md` only if you need route and payload details.
- For MCP, load `references/native-mcp.md`; it is already split out because it is operationally dense.
- Load `references/contributor.md` only when editing Hermes itself.
- If a topic is missing here, verify with `hermes --help`, the official docs, or the repository source instead of assuming the feature does not exist.

## Verification

- CLI commands: `hermes --help` and `hermes <command> --help`
- Slash commands: `/help` in a live session and `hermes_cli/commands.py`
- User docs: https://hermes-agent.nousresearch.com/docs/
- Source tree: https://github.com/NousResearch/hermes-agent

## Pitfalls

- Root `SKILL.md` is only an index. Heavy operational detail now lives under `references/`.
- Do not answer from memory if you have not loaded the relevant reference file.
- Absence from this index is not evidence that Hermes lacks the feature.
