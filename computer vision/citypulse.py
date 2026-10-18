"""Small standard-library client for the CityPulseAI FastAPI backend."""

import json
import os
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


API_URL = os.getenv("CITYPULSE_API_URL", "http://127.0.0.1:8000").rstrip("/")


class CityPulseError(RuntimeError):
    """Raised when the CityPulse API cannot complete a request."""


def get_json(path: str):
    """Call a GET endpoint and decode its JSON response."""
    request = Request(f"{API_URL}{path}", headers={"Accept": "application/json"})
    try:
        with urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise CityPulseError(f"GET {path} returned HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise CityPulseError(
            f"Cannot reach {API_URL}. Start the backend first with: "
            "python -m uvicorn main:app --reload"
        ) from exc


def analyze_image(image_path: str | Path, bin_id: str | None = None):
    """Upload one image to POST /analyze-image."""
    path = Path(image_path)
    if not path.is_file():
        raise CityPulseError(f"Image file not found: {path}")

    boundary = f"----CityPulse{uuid.uuid4().hex}"
    chunks = []
    if bin_id:
        chunks.extend(
            [
                f"--{boundary}\r\n".encode(),
                b'Content-Disposition: form-data; name="bin_id"\r\n\r\n',
                bin_id.encode("utf-8"),
                b"\r\n",
            ]
        )

    content_type = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
    }.get(path.suffix.lower())
    if content_type is None:
        raise CityPulseError("Choose a JPG, JPEG, PNG, or WEBP image.")

    chunks.extend(
        [
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="file"; filename="{path.name}"\r\n'.encode(),
            f"Content-Type: {content_type}\r\n\r\n".encode(),
            path.read_bytes(),
            b"\r\n",
            f"--{boundary}--\r\n".encode(),
        ]
    )
    request = Request(
        f"{API_URL}/analyze-image",
        data=b"".join(chunks),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=180) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise CityPulseError(f"Image analysis returned HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise CityPulseError(f"Cannot reach the CityPulse API at {API_URL}.") from exc
