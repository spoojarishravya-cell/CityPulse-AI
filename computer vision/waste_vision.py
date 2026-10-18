"""Open-vocabulary waste-item detection for CityPulseAI.

Uses Ultralytics YOLO-World prompts, so it can be demonstrated before the
project has enough labeled images to train a custom classifier. Detector scores
are not calibrated material probabilities; ambiguous detections are returned
as ``uncertain`` and should not drive automatic collection or sorting.
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
DEFAULT_WASTE_MODEL = os.getenv("CITYPULSE_WASTE_MODEL", "yolov8s-world.pt")

# Prompts describe visible objects, then map them to useful recommendation
# groups. Keeping object prompts specific avoids pretending the model can see
# the chemical composition of an ambiguous item.
PROMPT_TO_TYPE = {
    "plastic bottle": "plastic",
    "plastic bag": "plastic",
    "plastic container": "plastic",
    "plastic wrapper": "plastic",
    "metal can": "metal",
    "aluminum can": "metal",
    "metal food tin": "metal",
    "glass bottle": "glass",
    "glass jar": "glass",
    "cardboard box": "cardboard",
    "cardboard packaging": "cardboard",
    "paper sheet": "paper",
    "newspaper": "paper",
    "food scraps": "organic",
    "fruit peel": "organic",
    "vegetable scraps": "organic",
    "food waste": "organic",
    "battery": "hazardous",
    "electronic waste": "hazardous",
    "mixed non-recyclable trash": "general_waste",
}

RECOMMENDATIONS = {
    "plastic": "Separate plastic items for the local plastics recycling stream; check local rules for bags and wrappers.",
    "metal": "Separate metal cans and tins for the local metal recycling stream.",
    "glass": "Keep glass separate and send it to the local glass recycling stream.",
    "cardboard": "Keep cardboard clean and dry for recycling.",
    "paper": "Keep paper clean and dry for paper recycling.",
    "organic": "Send food scraps to the organic-waste or compost stream where available.",
    "hazardous": "Keep batteries and electronic waste out of regular bins; use an approved collection point.",
    "general_waste": "Review this item for the local residual-waste stream.",
}


def validate_image(image_path: str | Path) -> Path:
    path = Path(image_path)
    if not path.is_file():
        raise FileNotFoundError(f"Image file not found: {path}")
    if path.suffix.lower() not in ALLOWED_EXTENSIONS:
        raise ValueError("Use a JPG, JPEG, PNG, or WEBP image.")
    return path


@lru_cache(maxsize=1)
def _get_model(model_path: str):
    try:
        import clip  # noqa: F401
        from ultralytics import YOLOWorld
    except ImportError as exc:
        raise ImportError(
            "YOLO-World requires Ultralytics and the CLIP text encoder. From the backend folder run: "
            "python -m pip install -r requirements.txt. If installing the project requirements is not possible, run: "
            "python -m pip install git+https://github.com/ultralytics/CLIP.git"
        ) from exc

    model = YOLOWorld(model_path)
    model.set_classes(list(PROMPT_TO_TYPE))
    return model


def _iou(left: list[float], right: list[float]) -> float:
    x1, y1 = max(left[0], right[0]), max(left[1], right[1])
    x2, y2 = min(left[2], right[2]), min(left[3], right[3])
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    left_area = max(0.0, left[2] - left[0]) * max(0.0, left[3] - left[1])
    right_area = max(0.0, right[2] - right[0]) * max(0.0, right[3] - right[1])
    union = left_area + right_area - intersection
    return intersection / union if union else 0.0


def _box_clusters(candidates: list[dict[str, Any]], overlap_threshold: float = 0.55):
    clusters: list[list[dict[str, Any]]] = []
    for candidate in sorted(candidates, key=lambda item: item["confidence"], reverse=True):
        match = next(
            (cluster for cluster in clusters
             if max(_iou(candidate["bbox_xyxy"], item["bbox_xyxy"]) for item in cluster) >= overlap_threshold),
            None,
        )
        if match is None:
            clusters.append([candidate])
        else:
            match.append(candidate)
    return clusters


def analyze_waste_image(
    image_path: str | Path,
    model_path: str | Path | None = None,
    confidence_threshold: float = 0.25,
    ambiguity_margin: float = 0.08,
) -> dict[str, Any]:
    """Detect waste-like objects and return grouped recommendations.

    Overlapping prompts that disagree on material become ``uncertain`` when
    their detector scores are close. No bin fill level is inferred here.
    """
    if not 0 <= confidence_threshold <= 1:
        raise ValueError("confidence_threshold must be between 0 and 1.")
    if not 0 <= ambiguity_margin <= 1:
        raise ValueError("ambiguity_margin must be between 0 and 1.")

    path = validate_image(image_path)
    chosen_model = str(model_path or DEFAULT_WASTE_MODEL)
    model = _get_model(chosen_model)
    results = model.predict(source=str(path), conf=confidence_threshold, verbose=False)

    candidates: list[dict[str, Any]] = []
    for result in results:
        if result.boxes is None:
            continue
        for box in result.boxes:
            class_id = int(box.cls.item())
            label = str(result.names.get(class_id, class_id)).strip().lower()
            waste_type = PROMPT_TO_TYPE.get(label)
            if waste_type is None:
                continue
            candidates.append({
                "label": label,
                "waste_type": waste_type,
                "confidence": float(box.conf.item()),
                "bbox_xyxy": [round(float(value), 2) for value in box.xyxy[0].tolist()],
            })

    items = []
    for cluster in _box_clusters(candidates):
        best_by_type: dict[str, dict[str, Any]] = {}
        for item in cluster:
            previous = best_by_type.get(item["waste_type"])
            if previous is None or item["confidence"] > previous["confidence"]:
                best_by_type[item["waste_type"]] = item
        ranked = sorted(best_by_type.values(), key=lambda item: item["confidence"], reverse=True)
        best = ranked[0]
        ambiguous = len(ranked) > 1 and best["confidence"] - ranked[1]["confidence"] <= ambiguity_margin
        items.append({
            **best,
            "waste_type": "uncertain" if ambiguous else best["waste_type"],
            "alternatives": [item["waste_type"] for item in ranked[1:]] if ambiguous else [],
            "confidence": round(best["confidence"], 4),
        })

    counts: dict[str, int] = {}
    confidence_totals: dict[str, float] = {}
    for item in items:
        counts[item["waste_type"]] = counts.get(item["waste_type"], 0) + 1
        confidence_totals[item["waste_type"]] = (
            confidence_totals.get(item["waste_type"], 0.0) + item["confidence"]
        )
    observed = sorted((kind for kind in counts if kind != "uncertain"))
    recommendations = [RECOMMENDATIONS[kind] for kind in observed]
    if not observed:
        recommendations.append(
            "No waste type was identified confidently. Retake a closer photo or verify the material manually."
        )

    dominant = (
        max(observed, key=lambda kind: (counts[kind], confidence_totals[kind]))
        if observed else None
    )
    return {
        "source": "computer_vision_zero_shot",
        "model": chosen_model,
        "items": items,
        "counts_by_type": counts,
        "dominant_waste_type": dominant,
        "recommendations": recommendations,
        "review_required": any(item["waste_type"] == "uncertain" for item in items) or not items,
        "caveat": "Open-vocabulary detections are estimates, not verified material composition. Check local recycling rules.",
    }
