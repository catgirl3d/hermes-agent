# Hermes Contributor Quick Reference

Use this file when editing the Hermes repository itself. Full developer docs:
https://hermes-agent.nousresearch.com/docs/developer-guide/

## Project Layout

```text
hermes-agent/
├── run_agent.py          # AIAgent -- core conversation loop
├── model_tools.py        # Tool discovery and dispatch
├── toolsets.py           # Toolset definitions
├── cli.py                # Interactive CLI (HermesCLI)
├── hermes_state.py       # SQLite session store
├── agent/                # Prompt builder, compression, memory, routing, pooling
├── hermes_cli/           # CLI subcommands, config, setup, commands
├── tools/                # One file per tool
├── gateway/              # Messaging gateway
├── cron/                 # Job scheduler
├── tests/                # Pytest suite
└── website/              # Docusaurus docs site
```

Config lives in `~/.hermes/config.yaml`; secrets live in `~/.hermes/.env`.

## Adding a Tool

Auto-discovery imports any `tools/*.py` file with a top-level
`registry.register()` call, but the tool is only exposed once its name appears
in a toolset.

### 1. Create `tools/your_tool.py`

```python
import json
import os
from tools.registry import registry

def check_requirements() -> bool:
    return bool(os.getenv("EXAMPLE_API_KEY"))

def example_tool(param: str, task_id: str = None) -> str:
    return json.dumps({"success": True, "data": "..."})

registry.register(
    name="example_tool",
    toolset="example",
    schema={"name": "example_tool", "description": "...", "parameters": {...}},
    handler=lambda args, **kw: example_tool(
        param=args.get("param", ""), task_id=kw.get("task_id")
    ),
    check_fn=check_requirements,
    requires_env=["EXAMPLE_API_KEY"],
)
```

### 2. Wire It into `toolsets.py`

Add the tool name to `_HERMES_CORE_TOOLS` or a specific toolset.

Rules:

- All handlers return JSON strings.
- Use `get_hermes_home()` for paths.
- For custom or local-only tools, prefer a plugin under `~/.hermes/plugins/` instead of editing core.

## Adding a Slash Command

1. Add `CommandDef` to `COMMAND_REGISTRY` in `hermes_cli/commands.py`.
2. Add the handler in `cli.py` via `process_command()`.
3. If needed in gateway, add the gateway handler too.

Downstream help, autocomplete, Telegram menus, and Slack mapping derive from
the central registry automatically.

## Agent Loop

```text
run_conversation():
  1. Build system prompt
  2. Loop while iterations < max
     a. Call LLM (OpenAI-format messages + tool schemas)
     b. If tool_calls -> dispatch via handle_function_call() -> append results
     c. If text response -> return
  3. Context compression triggers near token limit
```

## Testing

Use the canonical runner:

```bash
scripts/run_tests.sh
scripts/run_tests.sh tests/tools/
scripts/run_tests.sh tests/tools/test_x.py
scripts/run_tests.sh -v --tb=long
```

Notes:

- Tests redirect `HERMES_HOME` to temp dirs.
- The wrapper probes `.venv`, then `venv`, then the shared worktree venv.
- On Windows, the wrapper is POSIX-oriented; see `references/windows.md` for the direct-pytest workaround.

Common cross-platform guards:

- Symlink creation: `@pytest.mark.skipif(sys.platform == "win32", reason="Symlinks require elevated privileges on Windows")`.
- POSIX mode bits: `@pytest.mark.skipif(sys.platform.startswith("win"), reason="POSIX mode bits not enforced on Windows")`.
- `signal.SIGALRM` is Unix-only.
- Windows-specific regressions: `@pytest.mark.skipif(sys.platform != "win32", reason="Windows-specific regression")`.

If you patch `sys.platform`, also patch `platform.system()`,
`platform.release()`, and `platform.mac_ver()` when the code under test reads
both. Those functions otherwise detect the real host OS independently.

## System Prompt Environment Block

Host and backend guidance is emitted by
`agent/prompt_builder.py::build_environment_hints()`. With remote terminal
backends such as docker, singularity, modal, daytona, ssh, or managed modal,
Hermes suppresses host details and file tools operate inside the backend.

## Commit Conventions

```text
type: concise subject line

Optional body.
```

Common types: `fix:`, `feat:`, `refactor:`, `docs:`, `chore:`.

## Key Rules

- Never break prompt caching by changing context, tools, or system prompt mid-conversation.
- Preserve message role alternation.
- Use `get_hermes_home()` for all profile-scoped paths.
- Put config in `config.yaml` and secrets in `.env`.
- New tools need a `check_fn` so they only appear when requirements are met.
