# Hermes CLI Reference

Use this file for install, launch, common subcommands, profiles, auth, and the
top-level Hermes CLI surface.

## Quick Start

```bash
# Install (shell installer -- sets up uv, Python, the venv, and the launcher)
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash

# Or via PyPI (ships the TUI bundle + shell launcher)
pip install hermes-agent       # or: uv pip install hermes-agent

# Interactive chat (default surface; set display.interface: tui to launch the Ink TUI instead)
hermes

# Single query
hermes chat -q "What is the capital of France?"

# Setup wizard / pick model+provider / health check
hermes setup
hermes model
hermes doctor

# Other surfaces
hermes desktop                 # native desktop app (alias: hermes gui)
hermes dashboard               # web admin panel + embedded chat
hermes proxy                   # OpenAI-compatible local proxy backed by your OAuth provider
```

## Global Flags

```text
hermes [flags] [command]

  --version, -V             Show version
  --resume, -r SESSION      Resume session by ID or title
  --continue, -c [NAME]     Resume by name, or most recent session
  --worktree, -w            Isolated git worktree mode (parallel agents)
  --skills, -s SKILL        Preload skills (comma-separate or repeat)
  --profile, -p NAME        Use a named profile
  --yolo                    Skip dangerous command approval
  --pass-session-id         Include session ID in system prompt
```

No subcommand defaults to `chat`.

## Chat

```text
hermes chat [flags]
  -q, --query TEXT          Single query, non-interactive
  -m, --model MODEL         Model (e.g. anthropic/claude-sonnet-4)
  -t, --toolsets LIST       Comma-separated toolsets
  --provider PROVIDER       Force provider (openrouter, anthropic, nous, etc.)
  -v, --verbose             Verbose output
  -Q, --quiet               Suppress banner, spinner, tool previews
  --checkpoints             Enable filesystem checkpoints (/rollback)
  --source TAG              Session source tag (default: cli)
```

## Configuration

```text
hermes setup [section]      Interactive wizard (model|terminal|gateway|tools|agent)
hermes model                Interactive model/provider picker
hermes config               View current config
hermes config edit          Open config.yaml in $EDITOR
hermes config set KEY VAL   Set a config value
hermes config path          Print config.yaml path
hermes config env-path      Print .env path
hermes config check         Check for missing/outdated config
hermes config migrate       Update config with new options
hermes doctor [--fix]       Check dependencies and config
hermes status [--all]       Show component status
```

Credentials (OAuth + API keys, with pooling) are managed under `hermes auth`.

## Tools and Skills

```text
hermes tools                Interactive tool enable/disable (curses UI)
hermes tools list           Show all tools and status
hermes tools enable NAME    Enable a toolset
hermes tools disable NAME   Disable a toolset

hermes skills list          List installed skills
hermes skills search QUERY  Search the skills hub
hermes skills install ID    Install a skill (hub ID or direct https://.../SKILL.md URL)
hermes skills inspect ID    Preview without installing
hermes skills config        Enable/disable skills per platform
hermes skills check         Check for updates
hermes skills update        Update outdated skills
hermes skills uninstall N   Remove a hub skill
hermes skills publish PATH  Publish to registry
hermes skills browse        Browse all available skills
hermes skills tap add REPO  Add a GitHub repo as skill source
```

## MCP Servers

```text
hermes mcp serve            Run Hermes as an MCP server
hermes mcp add NAME         Add an MCP server (--url or --command)
hermes mcp remove NAME      Remove an MCP server
hermes mcp list             List configured servers
hermes mcp test NAME        Test connection
hermes mcp configure NAME   Toggle tool selection
hermes mcp catalog          List catalog MCP servers
hermes mcp install NAME     Install a catalog MCP server
```

For the built-in MCP client, transport options, discovery model, and catalog
installs, load `skill_view(name="hermes-agent", file_path="references/native-mcp.md")`.

## Sessions

```text
hermes sessions list        List recent sessions
hermes sessions browse      Interactive picker
hermes sessions export OUT  Export to JSONL
hermes sessions rename ID T Rename a session
hermes sessions delete ID   Delete a session
hermes sessions prune       Clean up old sessions (--older-than N days)
hermes sessions stats       Session store statistics
```

## Profiles

```text
hermes profile list         List all profiles
hermes profile create NAME  Create (--clone, --clone-all, --clone-from)
hermes profile use NAME     Set sticky default
hermes profile delete NAME  Delete a profile
hermes profile show NAME    Show details
hermes profile alias NAME   Manage wrapper scripts
hermes profile rename A B   Rename a profile
hermes profile export NAME  Export to tar.gz
hermes profile import FILE  Import from archive
```

## Credentials and Pools

```text
hermes auth                 Interactive credential manager
hermes auth add [PROVIDER]  Add OAuth or API-key credential
                            (e.g. nous, openai-codex, qwen-oauth, anthropic)
hermes auth list [PROVIDER] List pooled credentials
hermes auth remove P INDEX  Remove by provider + index
hermes auth reset PROVIDER  Clear exhaustion status
```

Multiple credentials per provider form a pool that rotates automatically and
skips exhausted keys.

## Other Commands

```text
hermes gateway run/install/start/stop/restart/status/setup
hermes cron list/create/edit/pause/resume/run/remove/status
hermes webhook subscribe/list/remove/test
hermes insights [--days N]
hermes update
hermes desktop / gui
hermes dashboard
hermes proxy
hermes portal
hermes kanban <verb>
hermes pairing list/approve/revoke
hermes plugins list/install/remove
hermes secrets bitwarden ...
hermes memory setup/status/off
hermes send
hermes completion bash|zsh
hermes acp
hermes claw migrate
hermes uninstall
```

Plugin- and provider-supplied subcommands only appear once their plugin is
installed or active.

## Verification

- Run `hermes --help` for the authoritative top-level list.
- Run `hermes <command> --help` for subcommand truth.
- Gateway details: `references/gateway.md`
- Cron details: `references/cron.md`
- Config and provider detail: `references/config.md`
