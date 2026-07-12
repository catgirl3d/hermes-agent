# Hermes Gateway

Use this file for messaging-platform setup, gateway service control, and the
multi-platform runtime that lets Hermes operate outside the CLI.

## Commands

```text
hermes gateway run          Start gateway foreground
hermes gateway install      Install as background service
hermes gateway start        Start the service
hermes gateway stop         Stop the service
hermes gateway restart      Restart the service
hermes gateway status       Check status
hermes gateway setup        Configure platforms
```

## What the Gateway Is

The same agent core runs on Telegram, Discord, Slack, WhatsApp, iMessage,
Signal, Matrix, Teams, Email, and many other platforms with the same tool
model, not a chat-only wrapper.

Supported platforms include Telegram, Discord, Slack, WhatsApp, iMessage,
Signal, Email, SMS, Matrix, Mattermost, Microsoft Teams, LINE, SimpleX, ntfy,
Google Chat, Home Assistant, DingTalk, Feishu, WeCom, Weixin, Raft, API
Server, and Webhooks.

Most adapters ship under `plugins/platforms/`, so new ones can drop in without
touching the core.

## Operational Notes

- Use `hermes gateway setup` for initial platform config.
- Use `hermes gateway install` when you want the gateway to survive terminal closure.
- After config changes, restart the gateway.
- Gateway logs usually live at `~/.hermes/logs/gateway.log`.

## Related Files

- Webhook routes and payload templating: `skill_view(name="hermes-agent", file_path="references/webhooks.md")`
- Slash commands available from gateway sessions: `references/slash-commands.md`
- Config and provider paths: `references/config.md`

## Verification

- User docs: https://hermes-agent.nousresearch.com/docs/user-guide/messaging/
- Live state: `hermes gateway status`
- Logs: `~/.hermes/logs/gateway.log`
