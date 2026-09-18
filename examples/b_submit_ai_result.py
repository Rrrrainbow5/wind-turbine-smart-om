from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_SAMPLE = Path(__file__).with_name("ai-result.simulated.json")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Submit one AI result to the WindCare backend.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--input", type=Path, default=DEFAULT_SAMPLE)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    request = Request(
        f"{args.base_url.rstrip('/')}/api/ai-results",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urlopen(request, timeout=10) as response:
            result = json.load(response)
    except HTTPError as error:
        message = error.read().decode("utf-8", errors="replace")
        raise SystemExit(f"Backend returned HTTP {error.code}: {message}") from error
    except URLError as error:
        raise SystemExit(f"Cannot reach backend: {error.reason}") from error

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
