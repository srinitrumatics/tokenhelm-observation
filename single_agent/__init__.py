from google.adk.apps.app import App

from cost_tracking import CostTrackingPlugin

from . import agent

root_agent = agent.root_agent

# `adk web` / `adk run` prefer a module-level `app` over a bare `root_agent`, so
# wiring the cost-tracking plugin here means the web UI and CLI track every model
# call. (Cost prints to the terminal running `adk web` and to usage_log.jsonl.)
app = App(
    name="single_agent",
    root_agent=root_agent,
    plugins=[CostTrackingPlugin()],
)
