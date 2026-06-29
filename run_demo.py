"""Run an ADK agent from plain Python (no web UI).

Usage:
    python run_demo.py "What's the weather in Tokyo?"

Loads GOOGLE_API_KEY from a .env file in the project root (or single_agent/).
This drives Demo 1 (single_agent); swap the import to try the others.
"""

import asyncio
import os
import sys

from dotenv import load_dotenv
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from cost_tracking import CostTrackingPlugin, print_prompt_summary, print_summary
from single_agent.agent import root_agent

load_dotenv()  # picks up .env in the current directory

# Windows consoles default to cp1252; model output (and tokenhelm's box-drawing
# summary) can contain characters it can't encode (°, emoji, —), which crashes
# print(). Force UTF-8 so printing the response is safe everywhere.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

APP_NAME = "demo"
USER_ID = "local_user"
SESSION_ID = "s1"


async def main(prompt: str) -> None:
    if not os.getenv("GOOGLE_API_KEY") and os.getenv("GOOGLE_GENAI_USE_VERTEXAI") != "True":
        print(
            "No credentials found. Copy .env.example to .env and add your "
            "GOOGLE_API_KEY (https://aistudio.google.com/apikey)."
        )
        return

    session_service = InMemorySessionService()
    await session_service.create_session(
        app_name=APP_NAME, user_id=USER_ID, session_id=SESSION_ID
    )
    runner = Runner(
        agent=root_agent,
        app_name=APP_NAME,
        session_service=session_service,
        plugins=[CostTrackingPlugin()],  # tracks token usage + cost on every call
    )

    message = types.Content(role="user", parts=[types.Part.from_text(text=prompt)])
    async for event in runner.run_async(
        user_id=USER_ID, session_id=SESSION_ID, new_message=message
    ):
        if event.is_final_response() and event.content:
            print(event.content.parts[0].text)

    print_summary()
    print_prompt_summary()  # per-prompt (per-agent) breakdown of the same spend


if __name__ == "__main__":
    user_prompt = sys.argv[1] if len(sys.argv) > 1 else "What's the weather in Tokyo?"
    asyncio.run(main(user_prompt))
