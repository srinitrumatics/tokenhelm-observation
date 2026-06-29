"""Demo 3 — Deterministic workflow with SequentialAgent.

When you want a fixed pipeline (no LLM deciding the control flow), use a
workflow agent. Here three sub-agents run in order; each writes its result
to session state via `output_key`, and the next stage reads it with a
`{placeholder}` in its instruction.

Flow:  raw text -> summary -> key points -> blog-style intro
"""

from google.adk.agents import Agent, SequentialAgent

summarizer = Agent(
    name="summarizer",
    model="gemini-3-flash-preview",
    description="Summarizes the user's input text.",
    instruction="Summarize the user's text in 2-3 sentences.",
    output_key="summary",
)

key_points = Agent(
    name="key_points",
    model="gemini-3-flash-preview",
    description="Extracts key points from a summary.",
    instruction=(
        "Given this summary:\n{summary}\n\n"
        "List the 3 most important takeaways as bullet points."
    ),
    output_key="key_points",
)

intro_writer = Agent(
    name="intro_writer",
    model="gemini-3-flash-preview",
    description="Writes an engaging intro from the key points.",
    instruction=(
        "Using these key points:\n{key_points}\n\n"
        "Write a punchy 2-sentence blog introduction that hooks the reader."
    ),
    output_key="intro",
)

root_agent = SequentialAgent(
    name="content_pipeline",
    description="Turns raw text into a summary, key points, and a blog intro.",
    sub_agents=[summarizer, key_points, intro_writer],
)
