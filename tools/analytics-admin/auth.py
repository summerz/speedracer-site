"""User-run OAuth consent; tokens never enter the repository or stdout."""
import argparse
from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow
from ga_admin import SCOPES, save_credentials, CREDENTIALS_PATH

parser = argparse.ArgumentParser(description="Authorize the local Speedracer Analytics MCP")
parser.add_argument("--client-file", type=Path, required=True, help="Downloaded Desktop OAuth client JSON, outside Git")
args = parser.parse_args()
flow = InstalledAppFlow.from_client_secrets_file(str(args.client_file.expanduser()), scopes=SCOPES)
if flow.client_type != "installed":
    raise SystemExit("Create a Desktop app OAuth client rather than a Web application client.")
credentials = flow.run_local_server(
    host="127.0.0.1", port=0, open_browser=True, timeout_seconds=300,
    authorization_prompt_message="Google authorization is opening in your browser.",
    success_message="Speedracer Analytics authorization complete. You can close this tab.",
    access_type="offline", prompt="consent",
)
if not credentials.refresh_token:
    raise SystemExit("Google did not provide offline authorization. Retry consent before registering credentials.")
save_credentials(credentials)
print(f"Authorization saved privately to {CREDENTIALS_PATH}. No tokens were printed.")
