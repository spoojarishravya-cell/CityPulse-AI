"""CityPulse AI computer-vision module.

A general pretrained YOLO model detects only classes it was trained on; it does
not automatically estimate bin fullness. For fill estimates, use a custom model
whose class labels include categories such as empty, low, medium, high, or full.
If no recognized fill category is detected, fill_level_percent is None.
"""
from __future__ import annotations

import os  #os accesses environment variables and other operating-system functionality.
from pathlib import Path  #Path helps Python work with file paths.
from typing import Any  #Any allows dictionary values to have different data types.

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
DEFAULT_MODEL = os.getenv("CITYPULSE_YOLO_MODEL", "yolo26n.pt")

# Approximate category-to-percentage mapping. Customize for your trained model.
FILL_LABELS = {
    "empty": 0.0,
    "low": 25.0,
    "quarter": 25.0,
    "medium": 50.0,
    "half": 50.0,
    "half_full": 50.0,
    "partially_full": 50.0,
    "high": 75.0,
    "three_quarters": 75.0,
    "full": 100.0,
    "overflow": 100.0,
    "overflowing": 100.0,
}


def validate_image(image_path: str | Path) -> Path:
    """Check that the image exists and uses a supported extension."""
    path = Path(image_path)
    if not path.is_file():
        raise FileNotFoundError(f"Image file not found: {path}")
    if path.suffix.lower() not in ALLOWED_EXTENSIONS:
        raise ValueError("Use a JPG, JPEG, PNG, or WEBP image.")
    return path


def manual_observation(fill_level: float) -> dict[str, Any]:
    """Fallback for testing the Digital Twin without a vision model."""
    if not 0 <= fill_level <= 100:
        raise ValueError("Fill level must be between 0 and 100.")
    return {
        "fill_level": float(fill_level),
        "source": "manual_test",
        "confidence": None,
    }


def analyze_bin_image(
    image_path: str | Path,
    model_path: str | Path | None = None,
    confidence_threshold: float = 0.25,
) -> dict[str, Any]:
    """Run YOLO on an image and return JSON-friendly detection information.

    `fill_level_percent` is set only when the model emits a recognized fill
    category. Otherwise it is None and the Digital Twin should not be updated
    from this image alone.
    """
    if not 0 <= confidence_threshold <= 1:
        raise ValueError("confidence_threshold must be between 0 and 1.")

    path = validate_image(image_path)
    # Lazy import means the rest of CityPulse and its tests can run even before
    # the YOLO dependency has been installed.
    try:
        from ultralytics import YOLO
    except ImportError as exc:
        raise ImportError(
            "YOLO dependency is missing. Run: python -m pip install -r requirements.txt"
        ) from exc

    chosen_model = str(model_path or DEFAULT_MODEL)
    if chosen_model not in {"yolo26n.pt", "yolo11n.pt", "yolov8n.pt"} and not Path(chosen_model).is_file():
        raise FileNotFoundError(
            f"Model file not found: {chosen_model}. Provide a valid .pt file or use a default model name."
        )



    model = YOLO(chosen_model)

    results = model.predict(source=str(path), conf=confidence_threshold, verbose=False)
    detections: list[dict[str, Any]] = []
    fill_candidates: list[dict[str, Any]] = []



    for result in results:
        if result.boxes is None:
            continue
        for box in result.boxes:
            class_id = int(box.cls.item())
            label = str(result.names.get(class_id, class_id))
            score = float(box.conf.item())
            coords = [float(value) for value in box.xyxy[0].tolist()]
            detections.append({
                "label": label,
                "confidence": round(score, 4),
                "bbox_xyxy": [round(value, 2) for value in coords],
            })
            normalized = label.strip().lower().replace("-", "_").replace(" ", "_")
            if normalized in FILL_LABELS:
                fill_candidates.append({
                    "label": normalized,
                    "fill_level_percent": FILL_LABELS[normalized],
                    "confidence": score,
                })

    selected = max(fill_candidates, key=lambda item: item["confidence"], default=None)
    return {
        "source": "computer_vision",
        "image": path.name,
        "model": chosen_model,
        "detections": detections,
        "fill_level_percent": selected["fill_level_percent"] if selected else None,
        "fill_category": selected["label"] if selected else None,
        "confidence": round(selected["confidence"], 4) if selected else None,
        "needs_custom_fill_model": selected is None,
    }



if __name__ == "__main__":
    import argparse
    import json

    parser = argparse.ArgumentParser(
        description="CityPulse AI vision module"
    )
    parser.add_argument(
        "image",
        nargs="?",
        help="Path to a bin image (optional)"
    )
    parser.add_argument("--model", default=None)
    parser.add_argument("--conf", type=float, default=0.25)

    args = parser.parse_args()

    if args.image is None:
        print("CityPulse AI Vision module is ready.")
        print("No image supplied; no analysis was performed.")
        print("YOLO does not need to be installed on this laptop.")
    else:
        try:
            result = analyze_bin_image(
                args.image,
                model_path=args.model,
                confidence_threshold=args.conf,
            )
            print(json.dumps(result, indent=2))
        except Exception as exc:
            parser.exit(1, f"Error: {exc}\n")