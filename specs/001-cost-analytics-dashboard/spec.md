# Feature Specification: Cost Analytics Dashboard

**Feature Branch**: `001-cost-analytics-dashboard`

**Created**: 2026-06-27

**Input**: User description: "build analytics for cost tracking usage_log.jsonl use nextjs and build frontend app in fronetend folder"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See total spend and usage at a glance (Priority: P1)

A developer running the ADK demos has accumulated model calls in the usage audit log.
They open the analytics app and immediately see headline numbers: how much money has
been spent, how many model calls were made, and how many tokens were consumed (input,
output, and total). This answers "what have these demos cost me so far?" in one glance.

**Why this priority**: This is the core reason the analytics exist. Even with nothing
else, a single summary view of total cost and tokens delivers the primary value and is a
viable MVP on its own.

**Independent Test**: Point the app at a log containing several records and confirm the
displayed totals (cost, call count, input/output/total tokens) match a hand calculation
of those records.

**Acceptance Scenarios**:

1. **Given** a usage log with multiple recorded calls, **When** the user opens the
   dashboard, **Then** the total cost, total call count, and total input/output/total
   token counts are displayed and equal the sum of the underlying records.
2. **Given** a usage log where some records are unpriced (priced = false), **When**
   totals are shown, **Then** unpriced calls contribute their tokens to token totals but
   contribute zero to the cost total, and the count of unpriced calls is visible.
3. **Given** an empty or missing usage log, **When** the user opens the dashboard,
   **Then** an empty-state message is shown instead of an error, with all totals at zero.

---

### User Story 2 - Understand spending and usage over time (Priority: P2)

The developer wants to see how cost and token consumption have trended across the period
covered by the log — for example, spotting that a particular afternoon's experimentation
was unusually expensive. They view a time-based chart of cost and/or tokens and can narrow
to a date/time range.

**Why this priority**: Trend visibility turns raw totals into insight (when spend
happened, whether it is growing), but the dashboard is already useful without it.

**Independent Test**: Load a log whose records span at least two distinct days and confirm
the time series groups and plots the records correctly, and that changing the date range
filter updates both the chart and the headline totals.

**Acceptance Scenarios**:

1. **Given** records spanning multiple time periods, **When** the user views the trend
   chart, **Then** cost and token usage are plotted in chronological order by their
   timestamps.
2. **Given** a selected date/time range, **When** the user applies it, **Then** only
   records within that range are reflected in the chart and the summary totals.
3. **Given** records that all fall on a single timestamp/day, **When** plotted, **Then**
   the chart still renders without error.

---

### User Story 3 - Break down and inspect usage by attribute (Priority: P3)

The developer wants to attribute cost and tokens to dimensions in the data — primarily by
model and by provider — and to browse the individual call records (sortable/searchable) to
investigate a specific expensive call.

**Why this priority**: Attribution and drill-down are valuable for optimization but are a
refinement on top of the summary and trend views.

**Independent Test**: Load a log with more than one model or provider value and confirm the
breakdown groups totals correctly per dimension, and that the detail table lists every
record with its fields.

**Acceptance Scenarios**:

1. **Given** records with differing model values, **When** the user views the breakdown,
   **Then** cost and token totals are grouped per model with a per-group share of the
   whole.
2. **Given** the detail view, **When** the user sorts by cost or by timestamp, **Then**
   records reorder accordingly and each record shows its provider, model, tokens, cost,
   and timestamp.
3. **Given** a record whose reported total tokens exceed input plus output tokens (e.g.,
   reasoning/thinking tokens), **When** it is displayed, **Then** the stored total is shown
   as-is and not silently recomputed.

---

### Edge Cases

- **Empty or absent log**: dashboard shows a zeroed empty state, not an error.
- **Malformed lines**: a corrupt or non-parseable line in the log is skipped and counted as
  skipped rather than crashing the whole view.
- **Unpriced records**: records with `priced = false` are included in token totals but
  excluded from cost totals and clearly distinguishable.
- **Cost precision varies**: cost values are recorded as strings with differing decimal
  precision; totals must aggregate them accurately without precision drift.
- **Total ≠ input + output**: some records report a total token count larger than
  input + output (reasoning tokens folded in); the stored total is authoritative for
  display.
- **Mixed currencies**: if records carry differing currency codes, cost totals must not be
  summed blindly across currencies; the view must keep them distinct or flag the mismatch.
- **Large log growth**: the view remains usable as the log grows over many sessions.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST read model-usage records from the project's append-only usage
  audit log (`usage_log.jsonl`), one JSON record per line.
- **FR-002**: System MUST present headline totals across the loaded records: total cost,
  total number of calls, and total input, output, and combined token counts.
- **FR-003**: System MUST aggregate cost accurately from per-record cost values that are
  stored as strings with varying decimal precision, without introducing rounding errors in
  the displayed total.
- **FR-004**: System MUST exclude records marked unpriced from the cost total while still
  counting their tokens and calls, and MUST surface how many records are unpriced.
- **FR-005**: System MUST present a time-based view of cost and token usage ordered by
  record timestamp, and MUST allow the user to restrict all views to a chosen date/time
  range.
- **FR-006**: System MUST present usage broken down by model and by provider, showing each
  group's cost and token totals and its share of the overall total.
- **FR-007**: Users MUST be able to browse the individual call records in a list that can
  be sorted (at minimum by timestamp and by cost) and that shows each record's provider,
  model, input/output/total tokens, cost, priced flag, and timestamp.
- **FR-008**: System MUST handle an empty or missing log by showing a zeroed empty state
  rather than failing.
- **FR-009**: System MUST skip individual malformed/non-parseable log lines without
  aborting the rest of the view, and MUST indicate that some lines were skipped.
- **FR-010**: System MUST display each record's stored total token count as recorded, even
  when it exceeds input plus output tokens.
- **FR-011**: System MUST keep cost totals separated by currency (or flag the mismatch)
  when records contain more than one currency code.
- **FR-012**: System MUST reflect the current contents of the log when the user loads or
  refreshes the analytics view, so newly appended calls become visible.

### Key Entities *(include if feature involves data)*

- **Usage Record**: One model call as logged. Attributes: provider, model, input tokens,
  output tokens, total tokens, latency, cost (monetary, with currency), timestamp, whether
  usage was complete, whether it was priced. Source of every metric in the dashboard.
- **Usage Summary**: A derived aggregate over a set of usage records — total cost, total
  calls, token totals, and counts of priced/unpriced/skipped records — optionally scoped to
  a time range.
- **Dimension Breakdown**: A grouping of usage records by an attribute (model, provider)
  with per-group cost and token totals and share of the whole.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can determine total cost and total tokens consumed across all logged
  calls within 5 seconds of opening the analytics view, without any manual calculation.
- **SC-002**: Displayed cost and token totals match an independent manual sum of the source
  records exactly (zero discrepancy) for any sample log.
- **SC-003**: A user can identify the most expensive model and the time period of highest
  spend without inspecting raw log files.
- **SC-004**: The analytics view loads and renders a log of at least 10,000 records in
  under 3 seconds on a typical developer laptop.
- **SC-005**: 100% of malformed log lines are skipped without preventing the remaining
  records from being analyzed, and the user is told how many were skipped.
- **SC-006**: A newly appended call appears in the analytics within one refresh of the
  view.

## Assumptions

- The analytics app is a developer-facing tool for inspecting local demo usage; it is read
  -only over `usage_log.jsonl` and never modifies the log.
- The app is delivered as a Next.js application housed in a `frontend/` folder at the
  project root (per the request), reading the existing root-level `usage_log.jsonl`.
- "Analytics" covers summary totals, time trends, and per-model/per-provider breakdown with
  a record-level detail view; predictive forecasting and budget alerting are out of scope
  for v1.
- The current log schema is stable: each line contains `provider`, `model`,
  `input_tokens`, `output_tokens`, `total_tokens`, `latency`, `cost`, `timestamp`,
  `usage_complete`, `priced`, and `currency`.
- Data refresh is on-demand (page load / manual refresh); live streaming/auto-push of new
  records is out of scope for v1.
- Authentication is out of scope — the tool runs locally for a single developer.
- All current records share one currency (USD); multi-currency handling is a defensive
  requirement, not an expected everyday case.
