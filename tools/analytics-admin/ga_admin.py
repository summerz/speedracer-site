"""Bounded Analytics Admin client. Credentials live outside the repository."""
import json
import os
from pathlib import Path
import re

from google.auth.transport.requests import AuthorizedSession
from google.oauth2.credentials import Credentials

SCOPES = [
    "https://www.googleapis.com/auth/analytics.readonly",
    "https://www.googleapis.com/auth/analytics.edit",
]
CREDENTIALS_PATH = Path.home() / ".config/speedracer-analytics/credentials.json"
SITE = "https://speedracer.summerz.net"
DIMENSIONS = {
    "screen_name": "Screen", "track_id": "Track", "race_mode": "Race mode",
    "difficulty": "Difficulty", "ship_id": "Ship", "control_type": "Controls",
    "app_version": "App version", "app_mode": "App mode", "result": "Result",
    "quit_reason": "Quit reason",
}
METRICS = {
    "collisions": ("Collisions", "STANDARD"),
    "off_track_exits": ("Off track exits", "STANDARD"),
    "obstacles_passed": ("Obstacles passed", "STANDARD"),
    "elapsed_seconds": ("Elapsed seconds", "SECONDS"),
    "stars": ("Stars", "STANDARD"),
}


def resource_id(value: str) -> str:
    if not re.fullmatch(r"[0-9]+", value):
        raise ValueError("Provide a numeric Google Analytics resource ID.")
    return value


def save_credentials(credentials: Credentials) -> None:
    """Create private files without ever printing tokens."""
    CREDENTIALS_PATH.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    CREDENTIALS_PATH.parent.chmod(0o700)
    temporary = CREDENTIALS_PATH.with_suffix(".tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "w") as stream:
            stream.write(credentials.to_json())
        temporary.chmod(0o600)
        temporary.replace(CREDENTIALS_PATH)
    finally:
        temporary.unlink(missing_ok=True)


class AdminClient:
    def __init__(self, session=None):
        self.session = session

    def request(self, method, path, *, body=None, params=None, data_api=False):
        if self.session is None:
            if not CREDENTIALS_PATH.is_file():
                raise RuntimeError("Google authorization is missing. Run the documented auth.py command first.")
            credentials = Credentials.from_authorized_user_file(str(CREDENTIALS_PATH))
            if not credentials.has_scopes(SCOPES):
                raise RuntimeError("Authorization needs analytics.readonly and analytics.edit. Run auth.py again.")
            self.session = AuthorizedSession(credentials)
        host = "analyticsdata" if data_api else "analyticsadmin"
        response = self.session.request(
            method, f"https://{host}.googleapis.com/{path}",
            json=body, params=params, timeout=20,
        )
        if not response.ok:
            # Do not expose request headers or credential contents in MCP errors.
            raise RuntimeError(f"Google Analytics API returned HTTP {response.status_code}. Check API enablement, account role and OAuth authorization.")
        return response.json()

    def listing(self, path, key, **params):
        values = []
        while True:
            response = self.request("GET", path, params={"pageSize": 200, **params})
            values.extend(response.get(key, []))
            token = response.get("nextPageToken")
            if not token:
                return values
            params["pageToken"] = token

    def accounts(self):
        return self.listing("v1beta/accountSummaries", "accountSummaries")

    def inspect(self, property_id):
        parent = f"properties/{resource_id(property_id)}"
        return {
            "property": self.request("GET", f"v1beta/{parent}"),
            "streams": self.listing(f"v1beta/{parent}/dataStreams", "dataStreams"),
            "dimensions": self.listing(f"v1beta/{parent}/customDimensions", "customDimensions"),
            "metrics": self.listing(f"v1beta/{parent}/customMetrics", "customMetrics"),
        }

    def ensure_speedracer(self, account_id, property_id=""):
        """Reuse matching resources; stop on ambiguous selection or schema conflicts."""
        account = f"accounts/{resource_id(account_id)}"
        if property_id:
            prop = self.request("GET", f"v1beta/properties/{resource_id(property_id)}")
            if prop.get("parent") != account:
                raise ValueError("The chosen property belongs to another account.")
        else:
            matches = [p for p in self.listing("v1beta/properties", "properties", filter=f"parent:{account}") if p.get("displayName") == "Speedracer"]
            if len(matches) > 1:
                return {"conflict": "Multiple Speedracer properties exist. Choose a property ID.", "properties": matches}
            prop = matches[0] if matches else None
        created = []
        if prop is None:
            prop = self.request("POST", "v1beta/properties", body={
                "parent": account, "displayName": "Speedracer",
                "timeZone": "Asia/Seoul", "currencyCode": "KRW",
            })
            created.append("property")
        parent = prop["name"]
        streams = self.listing(f"v1beta/{parent}/dataStreams", "dataStreams")
        matches = [s for s in streams if s.get("webStreamData", {}).get("defaultUri", "").rstrip("/") == SITE]
        if len(matches) > 1 or (streams and not matches and not property_id):
            return {"conflict": "Choose an explicit property/stream; existing streams were preserved.", "property": prop, "streams": streams}
        if matches:
            stream = matches[0]
        else:
            stream = self.request("POST", f"v1beta/{parent}/dataStreams", body={
                "type": "WEB_DATA_STREAM", "displayName": "Speedracer web",
                "webStreamData": {"defaultUri": SITE},
            })
            created.append("web_stream")
        dimensions = self.listing(f"v1beta/{parent}/customDimensions", "customDimensions")
        metrics = self.listing(f"v1beta/{parent}/customMetrics", "customMetrics")
        conflicts = []
        for key in DIMENSIONS:
            for item in dimensions:
                if item.get("parameterName") == key and item.get("scope") != "EVENT":
                    conflicts.append(f"Dimension {key} has incompatible scope.")
        for key, (_, unit) in METRICS.items():
            for item in metrics:
                if item.get("parameterName") == key and (item.get("scope") != "EVENT" or item.get("measurementUnit") != unit):
                    conflicts.append(f"Metric {key} has incompatible scope/unit.")
        if conflicts:
            return {"conflicts": conflicts, "created": created, "property": prop, "stream": stream}
        # Only this website's enhanced measurement and this property's Signals state.
        enhanced = f"{stream['name']}/enhancedMeasurementSettings"
        self.request("PATCH", f"v1alpha/{enhanced}", params={"updateMask": "stream_enabled"}, body={"name": enhanced, "streamEnabled": False})
        signals = f"{parent}/googleSignalsSettings"
        self.request("PATCH", f"v1alpha/{signals}", params={"updateMask": "state"}, body={"name": signals, "state": "GOOGLE_SIGNALS_DISABLED"})
        for key, label in DIMENSIONS.items():
            if not any(d.get("parameterName") == key for d in dimensions):
                self.request("POST", f"v1beta/{parent}/customDimensions", body={"parameterName": key, "displayName": label, "scope": "EVENT"})
                created.append(f"dimension:{key}")
        for key, (label, unit) in METRICS.items():
            if not any(m.get("parameterName") == key for m in metrics):
                self.request("POST", f"v1beta/{parent}/customMetrics", body={"parameterName": key, "displayName": label, "scope": "EVENT", "measurementUnit": unit})
                created.append(f"metric:{key}")
        return {
            "property": prop, "stream": stream,
            "measurement_id": stream.get("webStreamData", {}).get("measurementId"),
            "created": created, "enhanced_measurement": "disabled", "google_signals": "disabled",
        }

    def realtime(self, property_id):
        path = f"v1beta/properties/{resource_id(property_id)}:runRealtimeReport"
        # eventName and activeUsers are incompatible in the Realtime API.
        events = self.request("POST", path, data_api=True, body={
            "dimensions": [{"name": "eventName"}],
            "metrics": [{"name": "eventCount"}], "limit": "100",
        })
        users = self.request("POST", path, data_api=True, body={
            "metrics": [{"name": "activeUsers"}],
        })
        return {"events": events, "users": users}
