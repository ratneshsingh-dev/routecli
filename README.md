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

Requires Node.js 20.12+ and the CLI you want to route (`claude`, `codex`, or `gemini`)
already installed and logged in — routecli wraps them, it does not bundle them.

```bash
npm install -g @ratnesh04/routecli
```

Then add a routing key from [TypeSafe](https://typesafe.ai):

```bash
# macOS / Linux
echo "JEV_API_KEY=..." > ~/.routecli.env

# Windows (cmd)
(echo JEV_API_KEY=...)> "%USERPROFILE%\.routecli.env"
```

Now run any supported CLI through the router:

```bash
routecli claude
routecli claude -p "fix the failing test"
routecli codex exec "fix the failing test"
routecli gemini -p "fix the failing test"
```

Every argument is forwarded to the underlying CLI unchanged.

On Windows, if `routecli` is not recognized after installing, npm's global folder is missing
from your `PATH`. Run `npm config get prefix` and add that directory to `PATH`.

## Seeing what it routed to

Claude Code's own UI shows the model it asked for (the routing sentinel), never the one the
proxy substituted, so routecli injects a status line:

```
⚡ claude-haiku-4-5-20251001 · p=0.99 · 8% context
```

An existing `statusLine` in your Claude settings is left untouched; set
`ROUTECLI_NO_STATUSLINE=1` to disable the injected one. For one-shot runs, use
`ROUTECLI_DEBUG=1` to print each decision to stderr instead.

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
| `ROUTECLI_DEBUG` | Logs routing decisions to stderr |
| `ROUTECLI_ALLOW_DEEP` | Opts into the `deep` tier, which costs more on most accounts |
| `ROUTECLI_NO_STATUSLINE` | Disables the injected Claude Code status line |
| `ROUTECLI_<PROVIDER>_<TIER>` | Overrides the model id for a tier, e.g. `ROUTECLI_CLAUDE_STRONG=claude-opus-5` |

Config is loaded from (in precedence order): real environment variables, `./.env`, then
`~/.routecli.env`.

## Development

```bash
npm test
```

## License

MIT
