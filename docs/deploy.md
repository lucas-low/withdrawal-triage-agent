# Deploy

Everything below runs without an API key. The demo uses sample data and the scripted mock model.

## Run the container locally (any Compose runtime)

```sh
bun run docker:app            # builds the image and starts it on http://localhost:3000
bun run obs:up                # optional: Jaeger on http://localhost:16686
bun run langfuse:up           # optional: Langfuse on http://localhost:3001 (about 6 services)
```

`deploy/compose.sh` picks whichever runtime is installed (OrbStack, Docker, Podman, `docker-compose`). On a Mac, OrbStack is the lightest.

## Public demo on Fly.io

State lives in SQLite on a volume and the rate limiter is in memory, so run exactly one machine. A stateless host such as Vercel does not fit: each request can land on a different instance with its own empty database.

```sh
brew install flyctl
fly auth login                                  # interactive, done by you
fly launch --copy-config --no-deploy            # keeps fly.toml, pick an app name
fly volumes create triage_data --size 1 --region sin
fly deploy
```

`fly.toml` sets `DEMO_MODE=true` and `MODEL_PROVIDER=mock`. On first start the app seeds sample data. The console at `/` shows a demo banner with the sample keys. `POST /v1/demo/reset` (operator key) restores the sample data.

The sample keys are public by design in demo mode, because the data is fake. Do not put real data behind them.

## Anything that is not a demo

- Set `API_KEYS` to real secrets. With `NODE_ENV=production` the server refuses to start on the built-in `dev-*` keys unless `DEMO_MODE=true` or `ALLOW_DEV_KEYS=true`.
- Put TLS in front of it. The server speaks plain HTTP.
- Set `CHAIN_PROVIDER=onchain` and point `ETH_RPC_URL` at a provider you trust. The default public RPC is rate limited.
- Pick a model: `MODEL_PROVIDER=ollama` with a tool-capable model, or `anthropic` with `ANTHROPIC_API_KEY`.
- Set `OTLP_ENDPOINT` to ship traces to Langfuse or an OpenTelemetry collector.
- Back up the SQLite volume. The audit log's head hash should also be anchored outside the database (docs/roadmap.md).
