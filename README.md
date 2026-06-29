# ADK Agentic Systems — Starter Demos

Three minimal agent systems built with [Google's Agent Development Kit](https://google.github.io/adk-docs/) (ADK 2.3.0), each showing one core pattern.

| Folder | Pattern | What it shows |
|--------|---------|---------------|
| `single_agent/` | **Single LLM + tools** | One agent calling Python functions; writing to session state |
| `multi_agent/` | **Coordinator + delegation** | An LLM routing requests to specialist sub-agents |
| `pipeline_agent/` | **Sequential workflow** | A fixed 3-stage pipeline passing data via `output_key` → `{state}` |

## Setup

ADK is already installed in `.venv`. You only need to add model credentials.

```bash
# 1. Add a key (Google AI Studio is the quickest path)
cp .env.example .env        # then paste your GOOGLE_API_KEY
#   get one free at https://aistudio.google.com/apikey
```

> The `.env` at the project root is picked up by `run_demo.py`. For the web UI,
> ADK reads a `.env` from each agent folder — copy your `.env` into
> `single_agent/`, `multi_agent/`, and `pipeline_agent/` (or symlink it).

## Run

**Interactive web UI** (chat with any agent, inspect state, traces, and events):

```bash
adk web .
# open the printed URL, then pick single_agent / multi_agent / pipeline_agent
```

**CLI chat** with a single agent:

```bash
adk run single_agent
```

**From Python** (no UI):

```bash
python run_demo.py "What's the weather in Tokyo?"
```

## Try these prompts

- `single_agent` — *"What's the weather in London? Also, my favorite city is Tokyo."*
- `multi_agent` — *"What's the status of order A123?"* (routes to support) then *"What products do you sell?"* (routes to sales)
- `pipeline_agent` — paste any paragraph of text; watch it become a summary → key points → blog intro

## Cost & token tracking (tokenhelm)

Every model call is tracked — tokens **and** cost — via [tokenhelm](https://pypi.org/project/tokenhelm/):

- A single `CostTrackingPlugin` (`cost_tracking.py`) is an ADK plugin whose `after_model_callback` fires on every model response from every agent.
- It's wired in two places so **all** run paths are covered:
  - `run_demo.py` registers it on the `Runner` (and prints a summary at the end).
  - each agent package exposes `app = App(root_agent=..., plugins=[CostTrackingPlugin()])`, which `adk web` / `adk run` load automatically.
- Pricing comes from `pricing.yaml` (Gemini 3 rates there are **placeholder estimates** — replace with the official numbers from https://ai.google.dev/gemini-api/docs/pricing).

**Where the numbers appear:**

| Run path | Where cost shows up |
|----------|---------------------|
| `python run_demo.py` | console (`[tokenhelm] …` lines + a summary box) and `usage_log.jsonl` |
| `adk web` / `adk run` | the **terminal running the server** and `usage_log.jsonl` — **not** the browser page |

> The web UI's trace view shows token counts, but tokenhelm's cost line is printed
> to the terminal, not the browser. After editing the tracking wiring, **restart
> `adk web`** — the agent loader caches modules.
>
> A call is only tracked once it **succeeds** — a failed call (e.g. an invalid API
> key) errors before producing token usage, so nothing is recorded until the key works.

Verify the tracking pipeline end-to-end without an API key:

```bash
python verify_tracking.py
```

## Notes

- **Model:** all agents use `gemini-3-flash-preview`. Change the `model=` arg to use another Gemini model or, via `LiteLlm`, OpenAI/Anthropic/Ollama models.
- **`SequentialAgent`** (used in `pipeline_agent`) is marked deprecated in ADK 2.3.0 in favor of the newer graph-based `Workflow` API, but it still works and remains the simplest way to express a linear pipeline. Migrate to `Workflow` only if you need branching/parallel graphs.
- **404 on a model?** It's almost always a location issue, not the model name — set `GOOGLE_CLOUD_LOCATION=global` (Vertex) or use AI Studio.
