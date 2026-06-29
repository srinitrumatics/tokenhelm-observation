"""Demo 1 — Single LLM agent with function tools.

The simplest useful agentic system: one LLM that decides when to call
plain Python functions. Shows the FunctionTool basics (docstring + type
hints become the tool schema the model sees) and writing to session state.
"""

from google.adk.agents import Agent
from google.adk.tools import ToolContext


def get_weather(city: str) -> dict:
    """Returns the current weather for a city.

    Args:
        city: Name of the city to look up, e.g. "London".

    Returns:
        dict with 'status' and a human-readable 'report'.
    """
    # Stubbed data — swap for a real weather API call in production.
    fake = {
        "london": "16°C, light rain",
        "tokyo": "24°C, clear skies",
        "new york": "21°C, partly cloudy",
    }
    report = fake.get(city.lower())
    if report is None:
        return {"status": "error", "report": f"No weather data for {city}."}
    return {"status": "success", "report": f"Weather in {city}: {report}."}


def remember_favorite_city(city: str, tool_context: ToolContext) -> dict:
    """Saves the user's favorite city so later turns can recall it.

    Args:
        city: The city the user wants remembered.

    Returns:
        dict confirming what was stored.
    """
    tool_context.state["user:favorite_city"] = city
    return {"status": "success", "saved": city}


root_agent = Agent(
    name="weather_assistant",
    model="gemini-3-flash-preview",
    description="Answers weather questions and remembers user preferences.",
    instruction=(
        "You are a friendly weather assistant. "
        "Use get_weather to answer weather questions. "
        "If the user mentions a city they like, call remember_favorite_city. "
        "Never invent weather data — only report what the tool returns."
    ),
    tools=[get_weather, remember_favorite_city],
)
