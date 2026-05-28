from __future__ import annotations

import subprocess
import sys


def notify_ingest_stopped(status: str, message: str) -> None:
    banner = (
        f"\n{'=' * 60}\n"
        f"TBPN INGEST STOPPED: {status}\n"
        f"{message}\n"
        f"{'=' * 60}\n"
    )
    print(banner, flush=True, file=sys.stderr)
    sys.stderr.write("\a")
    sys.stderr.flush()

    if sys.platform == "darwin":
        safe_message = message.replace('"', "'")[:200]
        safe_status = status.replace('"', "'")
        subprocess.run(
            [
                "osascript",
                "-e",
                (
                    f'display notification "{safe_message}" '
                    f'with title "TBPN Ingest" subtitle "{safe_status}" sound name "Glass"'
                ),
            ],
            check=False,
            capture_output=True,
        )
