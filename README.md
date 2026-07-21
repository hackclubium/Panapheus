# Panapheus
A cool bot who loves pangrams.

Slack bot that watches opted-in channels for opted-in users. When a message uses every English letter A-Z at least once, it reposts the text in-thread:

```text
original pangram
---
uses every letter
by <@USERID>
```

Then it reacts with `:abc:`.

## Shape

- GitHub Actions runs local checks on every push.
- GitHub Actions runs `scripts/run-panapheus.mjs` every 6 hours and on manual dispatch as a backstop.
- Cloudflare Worker receives Slack slash commands.
- Cloudflare Worker receives Slack message events and posts matching pangrams immediately.
- Cloudflare D1 stores opted-in Slack channel IDs, user IDs, diagnostics, and short-lived duplicate guards.

## Slack App

Create a Slack app with these bot scopes:

- `channels:history`
- `channels:join`
- `channels:read`
- `chat:write`
- `reactions:write`

For private channels, also add:

- `groups:history`
- `groups:read`

Add these slash commands, all pointing at Worker URL:

- `/pan-in`
- `/pan-out`
- `/pan-chan-in`
- `/pan-chan-out`
- `/pan-test` to show detector output for text
- `/pan-debug` to show current Slack user/channel IDs, opt-in state, and latest received message event

`/pan-chan-in` tries to join public channels automatically. Private channels still need:

```text
/invite @Panapheus
```

Enable Events API:

- Request URL: Worker URL, for example `https://panapheus.example.workers.dev`
- Subscribe to bot event: `message.channels`
- For private channels, also subscribe to: `message.groups`

## Secrets

Set GitHub repository secrets:

- `SLACK_BOT_TOKEN`: Slack bot token, starts with `xoxb-`.
- `PANAPHEUS_STATE_URL`: Worker URL, for example `https://panapheus.example.workers.dev`. `/state` is added automatically when omitted.
- `PANAPHEUS_STATE_TOKEN`: shared secret used by GitHub Actions to read Worker state.

Set Worker secrets/vars:

- `SLACK_SIGNING_SECRET`: Slack app signing secret.
- `SLACK_BOT_TOKEN`: Slack bot token, starts with `xoxb-`.
- `PANAPHEUS_STATE_TOKEN`: same value as GitHub secret.

Bind a D1 database named `PANAPHEUS_DB`. Update `wrangler.toml` with its database ID.

## Local Checks

```sh
npm run check
```

## Limits

Detection is exact A-Z only. Unicode letters are ignored.
