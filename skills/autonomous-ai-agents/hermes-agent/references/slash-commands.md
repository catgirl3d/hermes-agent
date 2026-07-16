# Hermes Slash Commands

Type these during an interactive Hermes chat session. This file is a compact
reference, not a guarantee that every alias or new command is listed. For the
authoritative live list, run `/help` in-session. The registry of record is
`hermes_cli/commands.py`.

## Session Control

```text
/new (/reset)        Fresh session
/clear               Clear screen + new session (CLI)
/retry               Resend last message
/undo                Remove last exchange
/title [name]        Name the session
/compress            Manually compress context
/stop                Kill background processes
/rollback [N]        Restore filesystem checkpoint
/snapshot [sub]      Create or restore state snapshots of Hermes config/state (CLI)
/background <prompt> Run prompt in background
/queue <prompt>      Queue for next turn
/steer <prompt>      Inject a message after the next tool call without interrupting
/agents (/tasks)     Show active agents and running tasks
/resume [name]       Resume a named session
/goal [text|sub]     Set a standing goal across turns until achieved
/redraw              Force a full UI repaint (CLI)
```

## Configuration

```text
/config              Show config (CLI)
/model [name]        Show or change model
/personality [name]  Set personality
/reasoning [level]   Set reasoning level
/verbose             Cycle: off -> new -> all -> verbose
/voice [on|off|tts]  Voice mode
/yolo                Toggle approval bypass
/busy [sub]          Control what Enter does while Hermes is working (CLI)
/indicator [style]   Pick the TUI busy-indicator style (CLI)
/footer [on|off]     Toggle gateway runtime-metadata footer on final replies
/skin [name]         Change theme (CLI)
/statusbar           Toggle status bar (CLI)
```

## Tools and Skills

```text
/tools               Manage tools (CLI)
/toolsets            List toolsets (CLI)
/skills              Search/install skills (CLI)
/skill <name>        Load a skill into session
/reload-skills       Re-scan ~/.hermes/skills/ for added/removed skills
/reload              Reload .env variables into the running session (CLI)
/reload-mcp          Reload MCP servers
/cron                Manage cron jobs (CLI)
/curator [sub]       Background skill maintenance
/kanban [sub]        Multi-profile collaboration board
/plugins             List plugins (CLI)
```

## Gateway

```text
/approve             Approve a pending command (gateway)
/deny                Deny a pending command (gateway)
/restart             Restart gateway (gateway)
/sethome             Set current chat as home channel (gateway)
/update              Update Hermes to latest (gateway)
/topic [sub]         Enable or inspect Telegram DM topic sessions (gateway)
/platforms (/gateway) Show platform connection status (gateway)
```

## Utility

```text
/branch (/fork)      Branch the current session
/handoff <platform>  Hand the live session off to a messaging platform (CLI)
/fast                Toggle priority/fast processing
/browser             Open CDP browser connection
/history             Show conversation history (CLI)
/save                Save conversation to file (CLI)
/copy [N]            Copy the last assistant response to clipboard (CLI)
/paste               Attach clipboard image (CLI)
/image               Attach local image file (CLI)
```

## Info

```text
/help                Show commands
/commands [page]     Browse all commands (gateway)
/usage               Token usage
/insights [days]     Usage analytics
/status              Session info (gateway)
/profile             Active profile info
/debug               Upload debug report and get shareable links
```

## Exit

```text
/quit (/exit, /q)    Exit CLI
```

## Verification

- Prefer `/help` over stale memory.
- Check `hermes_cli/commands.py` if you are editing or debugging command registration.
