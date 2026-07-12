# Hermes Troubleshooting

Use this file for the most common operational failures.

## Voice Not Working

1. Check `stt.enabled: true` in `config.yaml`.
2. Verify the provider dependency or API key.
3. In gateway, run `/restart`. In CLI, exit and relaunch.

## Tool Not Available

1. Use `hermes tools` to verify the toolset is enabled for the current platform.
2. Check required environment variables in `.env`.
3. Start a fresh session after changing toolsets.

## Model or Provider Issues

1. Run `hermes doctor`.
2. Re-authenticate with `hermes auth` when using OAuth providers.
3. Confirm the correct API key is present.
4. For Copilot 403, use the Copilot-specific OAuth flow, not a generic `gh auth login` token.

## Changes Not Taking Effect

- Tools or skills: start a new session.
- Config changes: restart gateway or relaunch CLI.
- Code changes: restart the Hermes process.

## Skills Not Showing

1. `hermes skills list`
2. `hermes skills config`
3. Load explicitly with `/skill name` or `hermes -s name`

## Gateway Issues

Check logs first:

```bash
grep -i "failed to send\|error" ~/.hermes/logs/gateway.log | tail -20
```

Common cases:

- Gateway dies on SSH logout: enable linger.
- Gateway dies on WSL2 close: WSL2 needs `systemd=true` in `/etc/wsl.conf` for systemd services.
- Gateway crash loop: reset failed state with `systemctl --user reset-failed hermes-gateway`.

## Platform-Specific Issues

- Discord bot silent: enable Message Content Intent.
- Slack bot only works in DMs: subscribe to `message.channels`.
- Windows-specific issues: load `references/windows.md`.

## Auxiliary Models Not Working

If auxiliary tasks fail silently, the `auto` provider cannot find a usable
backend. Set `OPENROUTER_API_KEY` or `GOOGLE_API_KEY`, or configure each
auxiliary task explicitly.

```bash
hermes config set auxiliary.vision.provider <your_provider>
hermes config set auxiliary.vision.model <model_name>
```
