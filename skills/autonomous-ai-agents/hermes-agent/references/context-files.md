# Hermes Project Context Files

Hermes injects project-level instructions into the system prompt by reading
context files from the working directory. The discovery order is first match
wins: only one project context source is loaded per session.

## Discovery Order

| File | Discovery | Use when |
|---|---|---|
| `.hermes.md` / `HERMES.md` | Walks parents up to the git root | You want Hermes-specific hierarchical project rules |
| `AGENTS.md` / `agents.md` | Cwd only | You want portable instructions shared with Claude Code, Codex, OpenCode, and others |
| `CLAUDE.md` / `claude.md` | Cwd only | Same pattern, Claude-flavored |
| `.cursorrules` / `.cursor/rules/*.mdc` | Cwd only | Migrating from Cursor |

`SOUL.md` in `$HERMES_HOME` is independent and always loaded when present. It
sets the agent's identity, not project rules.

## Pick the Right One

- Use `.hermes.md` when you want Hermes-specific behavior that lives above the current directory or inherits from parent directories.
- Use `AGENTS.md` when the same project is worked on by multiple coding agents and you want the file to stay portable.
- Do not put project rules in `~/.hermes/AGENTS.md`; for cross-project identity use `SOUL.md`, and for reusable workflows use skills.

## Size and Truncation

Each context file is capped at 20,000 characters. Files longer than that are
head+tail truncated with a `[...truncated...]` marker. If the instructions are
large, split them into multiple skills instead of one giant context file.

## Security

All context files pass through Hermes threat-pattern scanning before reaching
the system prompt. Prompt-injection-like patterns are replaced with
`[BLOCKED: ...]` placeholders. Hermes blocks the bad content, not the whole
file.

## Disable for One Session

`hermes --ignore-rules` skips auto-injection of `.hermes.md`, `AGENTS.md`,
`CLAUDE.md`, `.cursorrules`, `SOUL.md`, user config, plugins, and MCP servers.
Use it to isolate whether a problem is in your setup or Hermes itself.

## Example

```markdown
# My Project

Hermes: when working in this repo, follow these rules.

## Build
- Always run `make test` before declaring a change done.
- Use `uv run` for Python, not `pip install`.

## Style
- Prefer `pathlib.Path` over `os.path`.
- No `print()` in production code; use the logger.
```

That file at `/home/me/projects/myrepo/.hermes.md` auto-loads when Hermes runs
in that repo or its subdirectories, but not in unrelated repos.
