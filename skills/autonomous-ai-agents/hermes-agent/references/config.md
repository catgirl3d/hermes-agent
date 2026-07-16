# Hermes Config, Paths, Providers, and Toolsets

Use this file when you need to find `config.yaml`, reason about provider setup,
or understand how toolsets are enabled.

## Key Paths

```text
~/.hermes/config.yaml       Main configuration
~/.hermes/.env              API keys and secrets (under $HERMES_HOME if set)
$HERMES_HOME/skills/        Installed skills
~/.hermes/sessions/         Gateway routing index, request dumps, *.jsonl transcripts
~/.hermes/state.db          Canonical session store (SQLite + FTS5)
~/.hermes/logs/             Gateway and error logs
~/.hermes/auth.json         OAuth tokens and credential pools
~/.hermes/hermes-agent/     Source code (if git-installed)
```

Profiles use `~/.hermes/profiles/<name>/` with the same layout.

## Config Sections

Edit with `hermes config edit` or `hermes config set section.key value`.

| Section | Key options |
|---|---|
| `model` | `default`, `provider`, `base_url`, `api_key`, `context_length` |
| `agent` | `max_turns` (90), `tool_use_enforcement` |
| `terminal` | `backend` (local/docker/ssh/modal), `cwd`, `timeout` (180) |
| `compression` | `enabled`, `threshold` (0.50), `target_ratio` (0.20) |
| `display` | `skin`, `interface` (cli/tui), `tool_progress`, `show_reasoning`, `show_cost`, `language` |
| `stt` | `enabled`, `provider` (local/groq/openai/mistral) |
| `tts` | `provider` (edge/elevenlabs/openai/minimax/mistral/neutts) |
| `memory` | `memory_enabled`, `user_profile_enabled`, `provider` |
| `security` | `tirith_enabled`, `website_blocklist` |
| `delegation` | `model`, `provider`, `base_url`, `api_key`, `max_iterations` (50), `reasoning_effort` |
| `checkpoints` | `enabled`, `max_snapshots` (50) |
| `curator` | `enabled`, `consolidate` (false), `interval_hours`, `stale_after_days` |

Full config reference: https://hermes-agent.nousresearch.com/docs/user-guide/configuration

## Providers

Hermes supports many providers. Use `hermes model` or `hermes setup` for the
current authoritative set.

| Provider | Auth | Key env var |
|---|---|---|
| OpenRouter | API key | `OPENROUTER_API_KEY` |
| Anthropic | API key | `ANTHROPIC_API_KEY` |
| Nous Portal | OAuth | `hermes auth` |
| OpenAI Codex | OAuth | `hermes auth` |
| GitHub Copilot | Token | `COPILOT_GITHUB_TOKEN` |
| Google Gemini | API key | `GOOGLE_API_KEY` or `GEMINI_API_KEY` |
| DeepSeek | API key | `DEEPSEEK_API_KEY` |
| xAI / Grok | API key | `XAI_API_KEY` |
| Hugging Face | Token | `HF_TOKEN` |
| Z.AI / GLM | API key | `GLM_API_KEY` |
| MiniMax | API key | `MINIMAX_API_KEY` |
| MiniMax CN | API key | `MINIMAX_CN_API_KEY` |
| Kimi / Moonshot | API key | `KIMI_API_KEY` |
| Alibaba / DashScope | API key | `DASHSCOPE_API_KEY` |
| Xiaomi MiMo | API key | `XIAOMI_API_KEY` |
| Kilo Code | API key | `KILOCODE_API_KEY` |
| OpenCode Zen | API key | `OPENCODE_ZEN_API_KEY` |
| OpenCode Go | API key | `OPENCODE_GO_API_KEY` |
| Qwen OAuth | OAuth | `hermes auth add qwen-oauth` |
| Custom endpoint | Config | `model.base_url` + `model.api_key` |
| GitHub Copilot ACP | External | `COPILOT_CLI_PATH` or Copilot CLI |

Full provider docs: https://hermes-agent.nousresearch.com/docs/integrations/providers

## Toolsets

Enable or disable with `hermes tools`, `hermes tools enable NAME`, or
`hermes tools disable NAME`.

| Toolset | What it provides |
|---|---|
| `web` | Web search and content extraction |
| `search` | Web search only (subset of `web`) |
| `browser` | Browser automation |
| `terminal` | Shell commands and process management |
| `file` | File read/write/search/patch |
| `code_execution` | Sandboxed Python execution |
| `vision` | Image analysis |
| `image_gen` | AI image generation and image-to-image editing |
| `video` | Video analysis and generation |
| `x_search` | First-class X (Twitter) search |
| `tts` | Text-to-speech |
| `skills` | Skill browsing and management |
| `memory` | Persistent cross-session memory |
| `session_search` | Search past conversations |
| `delegation` | Subagent task delegation |
| `cronjob` | Scheduled task management |
| `clarify` | Ask user clarifying questions |
| `messaging` | Cross-platform message sending |
| `todo` | In-session task planning and tracking |
| `kanban` | Multi-agent work-queue tools |
| `debugging` | Extra introspection/debug tools |
| `safe` | Minimal, low-risk toolset |
| `spotify` | Spotify playback and playlist control |
| `homeassistant` | Smart home control |
| `discord` | Discord integration tools |
| `discord_admin` | Discord admin/moderation tools |
| `feishu_doc` | Feishu document tools |
| `feishu_drive` | Feishu drive tools |
| `yuanbao` | Yuanbao integration tools |
| `rl` | Reinforcement learning tools |

The full enumeration lives in `toolsets.py` as `TOOLSETS`; `_HERMES_CORE_TOOLS`
is the default bundle most platforms inherit from.

Tool changes take effect on `/reset` or a new session. They do not apply
mid-conversation because Hermes preserves prompt caching.

## Where to Find Things

| Looking for... | Location |
|---|---|
| Config options | `hermes config edit` or configuration docs |
| Available tools | `hermes tools list` or tools reference |
| Skills catalog | `hermes skills browse` or skills catalog |
| Provider setup | `hermes model` or providers guide |
| Platform setup | `references/gateway.md` or messaging docs |
| MCP servers | `references/native-mcp.md` or MCP docs |
| Profiles | `hermes profile list` or profiles docs |
| Cron jobs | `references/cron.md` or cron docs |
| Memory | `hermes memory status` or memory docs |
| Env variables | `hermes config env-path` or env vars reference |
| Gateway logs | `~/.hermes/logs/gateway.log` |
| Session files | `hermes sessions browse` (reads state.db) |

## Verification

- Run `hermes config path` and `hermes config env-path` on the target machine.
- If provider lists drift, trust `hermes model` and current docs over static memory.
