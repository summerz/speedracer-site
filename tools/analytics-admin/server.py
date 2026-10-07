"""Local stdio MCP: account inventory, bounded Speedracer setup, live verification."""
from mcp.server.fastmcp import FastMCP
from ga_admin import AdminClient, CREDENTIALS_PATH

mcp = FastMCP("speedracer-analytics-admin")
client = AdminClient()


@mcp.tool()
def connection_status() -> dict:
    """Check local authorization presence without exposing credentials."""
    return {"credentials_present": CREDENTIALS_PATH.is_file(), "authentication": "user OAuth", "site": "https://speedracer.summerz.net"}


@mcp.tool()
def list_analytics_accounts() -> list:
    """List accessible Analytics accounts and properties; does not change anything."""
    return client.accounts()


@mcp.tool()
def inspect_analytics_property(property_id: str) -> dict:
    """Read the chosen property's streams and custom definitions."""
    return client.inspect(property_id)


@mcp.tool()
def ensure_speedracer_analytics(account_id: str, property_id: str = "") -> dict:
    """Create/reuse Speedracer GA4 property and web stream; add game definitions.

    Requires an explicitly selected account. Optionally select an existing property.
    Disables enhanced measurement on the matching website stream and Google Signals
    on that property. Preserves unrelated streams/definitions. Stops on conflicts.
    No deletion, access grants, advertising links or terms acceptance.
    """
    return client.ensure_speedracer(account_id, property_id)


@mcp.tool()
def realtime_analytics_events(property_id: str) -> dict:
    """Verify received event counts and active users with the Analytics Data API."""
    return client.realtime(property_id)


if __name__ == "__main__":
    mcp.run(transport="stdio")
