# 0005. Scripted mock model

**Status:** accepted

**Context.** We want the full loop, tests and CI to run without an API key or network.

**Decision.** Provide scripted models built on the AI SDK's mock language model: `competent`, `lenient`, `gullible`, `broken`, `silent`, `slow`. `MODEL_PROVIDER=mock` is the default.

**Consequences.** Tests are fast and deterministic and cover failure paths a real model rarely produces. They say nothing about real-model quality, so evals are labelled offline versus live and docs say so.
