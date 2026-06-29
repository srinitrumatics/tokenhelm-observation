<!--
SYNC IMPACT REPORT
==================
Version change: (unversioned template) → 1.0.0
Rationale: Initial ratification — template placeholders replaced with concrete,
project-specific principles. First versioned constitution, so MAJOR=1.

Modified principles:
  [PRINCIPLE_1_NAME] → I. One Pattern Per Demo
  [PRINCIPLE_2_NAME] → II. Idiomatic ADK First
  [PRINCIPLE_3_NAME] → III. Universal Cost Tracking (NON-NEGOTIABLE)
  [PRINCIPLE_4_NAME] → IV. Offline Verifiability
  [PRINCIPLE_5_NAME] → V. Pricing Transparency

Added sections:
  - Technical Standards (formerly [SECTION_2_NAME])
  - Development Workflow (formerly [SECTION_3_NAME])
  - Governance (filled)

Removed sections: none

Templates requiring updates:
  ✅ .specify/templates/plan-template.md — Constitution Check gate is generic
     ("Gates determined based on constitution file"); no edit required, gates now
     resolve against the five principles below.
  ✅ .specify/templates/spec-template.md — no constitution-coupled placeholders.
  ✅ .specify/templates/tasks-template.md — task categories are generic; principle
     -driven categories (tracking wiring, offline verification) map cleanly.
  ✅ CLAUDE.md — source of derived principles; remains consistent.

Follow-up TODOs: none. Ratification date set to initial fill date.
-->

# ADK Demos Constitution

## Core Principles

### I. One Pattern Per Demo

Each agent package (`single_agent/`, `multi_agent/`, `pipeline_agent/`) MUST illustrate
exactly one ADK orchestration pattern and nothing more. New demos MUST justify their
existence by a distinct pattern, not a variation of an existing one. Code that is not
essential to teaching the package's pattern MUST NOT be added (YAGNI). When a choice
exists between a clever solution and the minimal one that still shows the pattern, the
minimal one wins.

**Rationale:** The repository's value is pedagogical clarity. Mixing patterns or adding
incidental complexity defeats the purpose of a minimal demo and makes each example
harder to read in isolation.

### II. Idiomatic ADK First

Functionality MUST be expressed through ADK-native mechanisms before any custom
plumbing is introduced: function docstrings and type hints define tool schemas;
`tool_context.state` carries tool side effects; `sub_agents=[...]` with descriptive
`description` fields drives LLM delegation; `output_key` plus `{placeholder}` wiring
passes data between `SequentialAgent` stages. Reinventing what ADK already provides is
prohibited unless ADK cannot express the requirement, in which case the deviation MUST
be documented.

**Rationale:** These demos exist to teach ADK idioms. Bypassing them with bespoke code
both misleads readers and increases maintenance surface.

### III. Universal Cost Tracking (NON-NEGOTIABLE)

Every model response from every agent — including extra round-trips from tool calls and
sub-agent delegation — MUST be priced through `CostTrackingPlugin.after_model_callback`.
The plugin MUST remain wired in BOTH run paths and they MUST stay in sync: the `Runner`
in `run_demo.py`, and the module-level `app = App(..., plugins=[CostTrackingPlugin()])`
in each package `__init__.py`. Any change that could drop a tracked call (new run path,
removed plugin registration, altered callback seam) MUST be rejected until tracking
coverage is restored. Thinking tokens MUST be folded into output tokens so that
`input + output == total`.

**Rationale:** "Everything is tracked" is the cross-cutting guarantee of this codebase.
A single unwired path silently breaks cost accounting for an entire agent pattern.

### IV. Offline Verifiability

The cost-tracking layer MUST remain verifiable without live credentials. `verify_tracking.py`,
which feeds fake `LlmResponse`s through the tracker and asserts the log and summary, MUST
pass after any change to the tracking layer, and MUST be run before such a change is
claimed complete. New tracking behavior MUST be accompanied by an assertion in this
offline harness rather than relying on manual inspection of a live run.

**Rationale:** API keys, network, and cost make live testing slow and non-deterministic.
An offline check is the fast, reliable gate that keeps the cross-cutting layer honest.

### V. Pricing Transparency

Pricing MUST be data-driven via `pricing.yaml` layered over tokenhelm's bundled rates;
prices MUST NOT be hardcoded in tracking logic. Rates that are estimates or placeholders
MUST be labeled as such in `pricing.yaml` and surfaced honestly. A model with no known
rate MUST be reported with `priced=false` and zero cost — never with a guessed dollar
figure. Reported dollar amounts MUST be trustworthy or explicitly marked untrustworthy.

**Rationale:** A cost tracker that silently invents prices is worse than one that admits
ignorance. Transparency about estimate vs. official rates protects anyone who acts on the
numbers.

## Technical Standards

- **Runtime:** Python executed via the project virtualenv at `.venv`
  (`.venv/Scripts/python.exe` on Windows). ADK version is pinned at **2.3.0**.
- **Model:** All agents use `gemini-3-flash-preview`. Changing the model is a
  cross-cutting decision (it affects pricing entries and thinking-token handling) and
  MUST be applied consistently across all packages and `pricing.yaml`.
- **Credentials:** Agents require `GOOGLE_API_KEY` in `.env`. Secrets MUST NOT be
  committed. Because `adk web`/`adk run` read a `.env` from each agent folder, the root
  `.env` MUST be copied or symlinked into `single_agent/`, `multi_agent/`, and
  `pipeline_agent/`.
- **Audit trail:** Usage MUST continue to append to `usage_log.jsonl`; this append-only
  log is the durable record and MUST NOT be made lossy.
- **Deprecation awareness:** `SequentialAgent` is deprecated in ADK 2.3.0 but retained
  for pipeline clarity. Migration to the graph-based `Workflow` API is OPTIONAL and only
  warranted when branching or parallelism is required.

## Development Workflow

- **Spec-driven:** Non-trivial changes flow through Spec Kit (`/speckit-*`); the managed
  block in `CLAUDE.md` points to the active plan when one exists.
- **Tracking changes require restart:** After editing tracking wiring, `adk web` MUST be
  restarted because the agent loader caches modules. Verify with `verify_tracking.py`
  before relying on a live run.
- **Sync-both-seams rule:** Any change to plugin registration MUST be applied to both the
  `Runner` path and the per-package `app` path in the same change set.
- **Completion gate:** A change to the tracking or pricing layer is "done" only after
  `verify_tracking.py` passes; a failed model call records nothing, so absence of an
  error is not evidence of correctness.

## Governance

This constitution supersedes ad-hoc practice for the matters it covers. When guidance
here conflicts with convenience, this document wins.

- **Amendments** MUST be made by editing this file, MUST include an updated Sync Impact
  Report, and MUST bump the version per the policy below.
- **Versioning policy (semantic):**
  - **MAJOR** — a principle is removed or redefined in a backward-incompatible way, or
    governance rules change incompatibly.
  - **MINOR** — a new principle or section is added, or existing guidance is materially
    expanded.
  - **PATCH** — clarifications, wording, or typo fixes with no change in meaning.
- **Compliance review:** Every plan's Constitution Check gate MUST verify the five
  principles above before Phase 0 and again after Phase 1 design. Violations MUST be
  recorded in the plan's Complexity Tracking table with justification, or the change MUST
  be simplified to comply.
- **Runtime guidance:** `CLAUDE.md` is the authoritative runtime/development guidance for
  agents working in this repository and MUST be kept consistent with these principles.

**Version**: 1.0.0 | **Ratified**: 2026-06-27 | **Last Amended**: 2026-06-27
