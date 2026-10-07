import unittest
from unittest.mock import patch
from pathlib import Path
import tempfile

from ga_admin import AdminClient, DIMENSIONS, METRICS, SITE, resource_id, save_credentials


class FakeClient(AdminClient):
    def __init__(self, *, properties=None, streams=None, dimensions=None, metrics=None):
        super().__init__()
        self.properties = properties or []
        self.streams = streams or []
        self.dimensions = dimensions or []
        self.metrics = metrics or []
        self.writes = []

    def listing(self, path, key, **params):
        return getattr(self, {"properties": "properties", "dataStreams": "streams", "customDimensions": "dimensions", "customMetrics": "metrics"}[key])

    def request(self, method, path, *, body=None, **kwargs):
        if method == "GET":
            return self.properties[0]
        self.writes.append((method, path, body, kwargs))
        if path == "v1beta/properties":
            value = {**body, "name": "properties/20"}
            self.properties.append(value)
            return value
        if path.endswith("/dataStreams"):
            value = {**body, "name": "properties/20/dataStreams/30", "webStreamData": {"defaultUri": SITE, "measurementId": "G-TEST123"}}
            self.streams.append(value)
            return value
        if path.endswith("/customDimensions"):
            self.dimensions.append(body)
        if path.endswith("/customMetrics"):
            self.metrics.append(body)
        return body


class AdminTests(unittest.TestCase):
    def test_setup_is_idempotent_and_disables_only_target_settings(self):
        client = FakeClient()
        first = client.ensure_speedracer("10")
        self.assertEqual(first["measurement_id"], "G-TEST123")
        self.assertEqual(len(client.dimensions), len(DIMENSIONS))
        self.assertEqual(len(client.metrics), len(METRICS))
        count = len(client.writes)
        second = client.ensure_speedracer("10")
        self.assertEqual(second["created"], [])
        self.assertEqual(len(client.writes) - count, 2)
        for _, path, body, kwargs in client.writes[-2:]:
            self.assertTrue(path.endswith(("enhancedMeasurementSettings", "googleSignalsSettings")))
            self.assertNotIn("consent", body)
            self.assertIn("updateMask", kwargs["params"])

    def test_ambiguous_properties_make_no_writes(self):
        client = FakeClient(properties=[{"displayName": "Speedracer", "name": "properties/1"}, {"displayName": "Speedracer", "name": "properties/2"}])
        self.assertIn("conflict", client.ensure_speedracer("10"))
        self.assertEqual(client.writes, [])

    def test_existing_other_website_is_preserved(self):
        client = FakeClient(properties=[{"displayName": "Speedracer", "name": "properties/20"}], streams=[{"webStreamData": {"defaultUri": "https://example.com"}}])
        self.assertIn("conflict", client.ensure_speedracer("10"))
        self.assertEqual(client.writes, [])

    def test_incompatible_metrics_stop_before_settings_changes(self):
        client = FakeClient(properties=[{"displayName": "Speedracer", "name": "properties/20"}], streams=[{"name": "properties/20/dataStreams/30", "webStreamData": {"defaultUri": SITE}}], metrics=[{"parameterName": "elapsed_seconds", "scope": "EVENT", "measurementUnit": "STANDARD"}])
        self.assertIn("conflicts", client.ensure_speedracer("10"))
        self.assertEqual(client.writes, [])

    def test_wrong_account_selection_is_rejected(self):
        client = FakeClient(properties=[{"name": "properties/20", "parent": "accounts/99"}])
        with self.assertRaises(ValueError):
            client.ensure_speedracer("10", "20")
        self.assertEqual(client.writes, [])

    def test_identifiers_cannot_change_api_paths(self):
        for value in ["../10", "10?x=1", "properties/10", ""]:
            with self.assertRaises(ValueError):
                resource_id(value)

    def test_all_pages_are_read(self):
        client = AdminClient()
        with patch.object(client, "request", side_effect=[{"accountSummaries": [{"account": "accounts/1"}], "nextPageToken": "next"}, {"accountSummaries": [{"account": "accounts/2"}]}]) as request:
            self.assertEqual(len(client.accounts()), 2)
            self.assertEqual(request.call_args.kwargs["params"]["pageToken"], "next")

    def test_credentials_are_saved_privately(self):
        class CredentialFixture:
            def to_json(self):
                return '{"test_fixture":true}'
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "private" / "credentials.json"
            with patch("ga_admin.CREDENTIALS_PATH", target):
                save_credentials(CredentialFixture())
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            self.assertEqual(target.parent.stat().st_mode & 0o777, 0o700)
            self.assertFalse(target.with_suffix(".tmp").exists())

    def test_realtime_separates_event_counts_and_active_users(self):
        client = AdminClient()
        with patch.object(client, "request", side_effect=[{"rowCount": 0}, {"rowCount": 0}]) as request:
            self.assertEqual(client.realtime("20"), {"events": {"rowCount": 0}, "users": {"rowCount": 0}})
            self.assertEqual(request.call_count, 2)
            for call in request.call_args_list:
                self.assertEqual(call.args, ("POST", "v1beta/properties/20:runRealtimeReport"))
                self.assertTrue(call.kwargs["data_api"])
            events, users = [call.kwargs["body"] for call in request.call_args_list]
            self.assertEqual(events["dimensions"], [{"name": "eventName"}])
            self.assertEqual(events["metrics"], [{"name": "eventCount"}])
            self.assertNotIn("dimensions", users)
            self.assertEqual(users["metrics"], [{"name": "activeUsers"}])


if __name__ == "__main__":
    unittest.main()
