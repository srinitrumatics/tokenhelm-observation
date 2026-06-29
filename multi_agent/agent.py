"""Demo 2 — Multi-agent system with LLM-driven delegation.

A coordinator agent routes each request to the right specialist. The model
reads each sub-agent's `description` to decide who should handle the turn,
then transfers control. This is the core pattern for building assistants
that span multiple domains.
"""

from google.adk.agents import Agent


def lookup_order(order_id: str) -> dict:
    """Looks up the status of a customer order.

    Args:
        order_id: The order identifier, e.g. "A123".

    Returns:
        dict with 'status' and order details.
    """
    orders = {
        "A123": "Shipped — arriving Friday.",
        "B456": "Processing — ships tomorrow.",
    }
    detail = orders.get(order_id.upper())
    if detail is None:
        return {"status": "error", "detail": f"Order {order_id} not found."}
    return {"status": "success", "detail": detail}


support_agent = Agent(
    name="support_agent",
    model="gemini-3-flash-preview",
    description="Handles customer support: order status, returns, and complaints.",
    instruction=(
        "You are a customer support specialist. "
        "Use lookup_order to check order status. Be empathetic and concise."
    ),
    tools=[lookup_order],
)

sales_agent = Agent(
    name="sales_agent",
    model="gemini-3-flash-preview",
    description="Handles sales questions: product features, pricing, and recommendations.",
    instruction=(
        "You are an enthusiastic sales specialist. "
        "Help users pick the right product and explain pricing clearly."
    ),
)

root_agent = Agent(
    name="coordinator",
    model="gemini-3-flash-preview",
    description="Front-desk agent that routes users to the right specialist.",
    instruction=(
        "You are the front desk. Greet the user, understand what they need, "
        "and delegate: route order/return/complaint questions to support_agent, "
        "and product/pricing questions to sales_agent. "
        "Do not try to answer specialist questions yourself."
    ),
    sub_agents=[support_agent, sales_agent],
)
