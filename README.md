# routecli

Launches Claude Code, OpenAI Codex, or Gemini CLI and routes each turn to the cheapest model
tier that can handle it, while leaving the CLI's own interface, tools, and auth untouched.

## How it works

`routecli <provider>` starts a local loopback proxy, launches the real CLI pointed at
that proxy, and forwards every request through unchanged except the model id. A classifier
call (via [TypeSafe](https://typesafe.ai)) scores each fresh user turn into one of four
tiers — `fast`, `balanced`, `strong`, `deep` — and the proxy rewrites the request to the
model configured for that tier before forwarding it on with the CLI's own auth headers
intact.

```
you -> claude/codex/gemini -> routecli proxy -> real API
                                    |
                                    +-> brain: pick a tier
```

## Setup

```bash
npm install
echo "JEV_API_KEY=..." > ~/.routecli.env
```

Get a routing key from [TypeSafe](https://typesafe.ai). Then run any supported CLI through
the router:

```bash
node bin/routecli.js claude -p "fix the failing test"
node bin/routecli.js codex exec "fix the failing test"
node bin/routecli.js gemini -p "fix the failing test"
```

`npm link` installs `routecli` globally, after which the above becomes
`routecli claude ...`, etc.

## Providers

| Provider | CLI | Auth | Notes |
| --- | --- | --- | --- |
| `claude` | Claude Code | Existing `claude login` | Full routing, any auth method |
| `codex` | OpenAI Codex | Existing `codex login` | Full routing, any auth method |
| `gemini` | Gemini CLI | `GEMINI_API_KEY` only | Google-account/subscription login bypasses the proxy entirely — see below |

### Why Gemini is API-key only

Gemini CLI's Google-account login talks to an internal, undocumented endpoint
(`cloudcode-pa.googleapis.com`) and ignores the CLI's base-URL override once that login is
active, so there is no supported way to route those sessions through a local proxy. Routing
works normally with `GEMINI_API_KEY` set, which uses the public, documented API.

## Configuration

| Variable | Effect |
| --- | --- |
| `JEV_API_KEY` / `TYPESAFE_API_KEY` | Enables routing; without it the CLI runs unmodified |
| `MODEL_ROUTER_DEBUG` | Logs routing decisions to stderr |
| `MODEL_ROUTER_ALLOW_DEEP` | Opts into the `deep` tier, which costs more on most accounts |
| `MODEL_ROUTER_<PROVIDER>_<TIER>` | Overrides the model id for a tier, e.g. `MODEL_ROUTER_CLAUDE_STRONG=claude-opus-5` |

Config is loaded from (in precedence order): real environment variables, `./.env`, then
`~/.routecli.env`.

## Development

```bash
npm test
```

## License

MIT
