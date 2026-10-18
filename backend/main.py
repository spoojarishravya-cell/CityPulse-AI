from __future__ import annotations

import json
import logging
import os
import sys
import tempfile
from copy import deepcopy
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from recommendations import generate_recommendations

MAX_IMAGE_BYTES = 10 * 1024 * 1024
logger = logging.getLogger("citypulse.vision")

ROOT = Path(__file__).resolve().parent.parent
LOCAL_PYTHON_PACKAGES = Path(__file__).resolve().parent / "_vendor"
if LOCAL_PYTHON_PACKAGES.is_dir():
    sys.path.insert(0, str(LOCAL_PYTHON_PACKAGES))
VISION_DIR = ROOT / "computer vision"
sys.path.insert(0, str(VISION_DIR))
from vision import ALLOWED_EXTENSIONS, analyze_bin_image  # noqa: E402
from waste_vision import analyze_waste_image  # noqa: E402

SEED = json.loads((Path(__file__).parent / "seed_data.json").read_text(encoding="utf-8"))

app = FastAPI(title="CityPulse AI API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://city-pulse-ai-frontend.vercel.app",
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:3000", "http://127.0.0.1:3000",
        "http://localhost:5500", "http://127.0.0.1:5500",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

bins: list[dict[str, Any]] = deepcopy(SEED["bins"])
fleet: list[dict[str, Any]] = deepcopy(SEED["fleet"])
collections: list[dict[str, Any]] = []
activities: list[dict[str, Any]] = []
reviewed_recommendations: set[str] = set()
simulation_tick_cursor = 0


class BinInput(BaseModel):
    bin_id: str
    fill_level: int = Field(ge=0, le=100)
    latitude: float
    longitude: float


class DispatchInput(BaseModel):
    truck_id: str
    bin_ids: list[str] = Field(default_factory=list)


class FillInput(BaseModel):
    fill_level: int = Field(ge=0, le=100)


def _priority(fill: float) -> str:
    return "HIGH" if fill >= 75 else "MEDIUM" if fill >= 45 else "LOW"


def _log(message: str, bin_id: str | None = None) -> None:
    activities.insert(0, {"id": f"ACT-{len(activities) + 1}", "message": message, "bin_id": bin_id})
    del activities[100:]


def _recommendations() -> list[dict[str, Any]]:
    rows = generate_recommendations(bins)
    rows.sort(key=lambda row: (row["priority"] != "CRITICAL", row["priority"] != "HIGH",
                               -next((b["fill_level"] for b in bins if b["bin_id"] == row["bin_id"]), 0)))
    output = []
    for row in rows:
        rec_id = f"{row['category'].upper()}-{row['bin_id']}"
        output.append({**row, "id": rec_id, "target_bin_id": row["bin_id"],
                       "reviewed": rec_id in reviewed_recommendations})
    return output


@app.get("/")
def home():
    return {"message": "CityPulse AI backend is running!"}


@app.get("/api/health")
def health():
    return {"status": "healthy", "service": "CityPulse AI backend"}


@app.get("/api/vision/status")
def vision_status():
    try:
        import ultralytics
        import clip  # noqa: F401
        from ultralytics import YOLOWorld  # noqa: F401
        vision_available = True
        vision_version = ultralytics.__version__
        dependency_error = None
    except Exception as exc:
        vision_available = False
        vision_version = None
        dependency_error = str(exc)
    return {
        "available": vision_available,
        "ultralytics_version": vision_version,
        "waste_model": os.getenv("CITYPULSE_WASTE_MODEL", "yolov8s-world.pt"),
        "fill_model_configured": bool(os.getenv("CITYPULSE_YOLO_MODEL")),
        "fill_model": os.getenv("CITYPULSE_YOLO_MODEL"),
        "dependency_error": dependency_error,
        "setup_command": "python -m pip install -r requirements.txt",
        "api_key_required": False,
        "first_scan_may_download_weights": True,
    }


@app.get("/api/bins")
def get_bins():
    return bins


@app.get("/api/bins/{bin_id}")
def get_bin(bin_id: str):
    item = next((row for row in bins if row["bin_id"] == bin_id), None)
    if item is None:
        raise HTTPException(status_code=404, detail=f"Bin not found: {bin_id}")
    return item


@app.post("/api/bins")
def add_bin(data: BinInput):
    if any(row["bin_id"] == data.bin_id for row in bins):
        raise HTTPException(status_code=409, detail=f"Bin already exists: {data.bin_id}")
    item = {"bin_id": data.bin_id, "fill_level": data.fill_level,
            "latitude": data.latitude, "longitude": data.longitude,
            "area": data.bin_id, "waste_type": "General Waste", "capacity_liters": 240,
            "status": "healthy", "battery": 100, "temperature": 22,
            "methane_level": "Normal", "data_type": "MANUAL", "history": [data.fill_level],
            "assigned_truck_id": None}
    bins.append(item)
    _log(f"{data.bin_id} added", data.bin_id)
    return {"message": "Bin added successfully", "bin": item}


@app.post("/api/bins/{bin_id}/collect")
def collect_bin(bin_id: str, vehicle_id: str = "TRK-01"):
    item = next((row for row in bins if row["bin_id"] == bin_id), None)
    if item is None:
        raise HTTPException(status_code=404, detail=f"Bin not found: {bin_id}")
    previous = item["fill_level"]
    item.update(fill_level=0, priority="LOW", priority_score=0, collection_needed=False, status="collected")
    item["history"] = [*item.get("history", [])[-5:], 0]
    assigned_truck_id = item.get("assigned_truck_id")
    if assigned_truck_id:
        truck = next((row for row in fleet if row["id"] == assigned_truck_id), None)
        if truck:
            truck["assigned_bins"] = [value for value in truck.get("assigned_bins", []) if value != bin_id]
            truck["assigned_bins_count"] = len(truck["assigned_bins"])
            if not truck["assigned_bins"]:
                truck["status"] = "Available"
        item["assigned_truck_id"] = None
    event = {"id": f"COL-{len(collections) + 1:04d}", "bin_id": bin_id,
             "vehicle_id": vehicle_id, "timestamp": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
             "fill_level_before": previous, "fill_level_after": 0,
             "waste_category": item.get("waste_type", "General Waste"), "result": "SUCCESS",
             "notes": f"Collection recorded for {bin_id}."}
    collections.insert(0, event)
    _log(f"{bin_id} collected by {vehicle_id}", bin_id)
    return event


@app.put("/api/bins/{bin_id}/fill")
def update_bin_fill(bin_id: str, data: FillInput):
    item = next((row for row in bins if row["bin_id"] == bin_id), None)
    if item is None:
        raise HTTPException(status_code=404, detail=f"Bin not found: {bin_id}")
    item.update(fill_level=data.fill_level, priority=_priority(data.fill_level),
                priority_score=data.fill_level, collection_needed=data.fill_level >= 65,
                status="critical" if data.fill_level >= 80 else "warning" if data.fill_level >= 50 else "healthy",
                data_type="MANUAL", history=[*item.get("history", [])[-5:], data.fill_level])
    _log(f"{bin_id} fill updated to {data.fill_level}%", bin_id)
    return item


@app.post("/api/simulation/tick")
def advance_simulation():
    global simulation_tick_cursor
    if bins:
        item = bins[simulation_tick_cursor % len(bins)]
        previous = item["fill_level"]
        item["fill_level"] = min(100, previous + 1)
        item["priority"] = _priority(item["fill_level"])
        item["priority_score"] = item["fill_level"]
        item["collection_needed"] = item["fill_level"] >= 65
        item["status"] = "critical" if item["fill_level"] >= 80 else "warning" if item["fill_level"] >= 50 else "healthy"
        item["history"] = [*item.get("history", [])[-5:], item["fill_level"]]
        simulation_tick_cursor = (simulation_tick_cursor + 1) % len(bins)
        _log(f"Backend digital-twin simulation advanced {item['bin_id']} to {item['fill_level']}%", item["bin_id"])
    return bins


@app.get("/api/priorities")
def get_priorities():
    return [{**item, "priority": _priority(item["fill_level"]), "priority_score": item["fill_level"]}
            for item in sorted(bins, key=lambda row: row["fill_level"], reverse=True)]


@app.get("/api/simulation")
def simulate_bins():
    return [{"bin_id": item["bin_id"], "current_fill_level": item["fill_level"],
             "after_1_hour": min(item["fill_level"] + 5, 100),
             "after_2_hours": min(item["fill_level"] + 10, 100),
             "after_3_hours": min(item["fill_level"] + 15, 100),
             "overflow_risk": "HIGH" if item["fill_level"] + 15 >= 90 else "MEDIUM" if item["fill_level"] + 15 >= 70 else "LOW"}
            for item in bins]


@app.post("/api/simulation/reset")
def reset_simulation():
    global simulation_tick_cursor
    simulation_tick_cursor = 0
    bins[:] = deepcopy(SEED["bins"])
    fleet[:] = deepcopy(SEED["fleet"])
    collections.clear()
    activities.clear()
    reviewed_recommendations.clear()
    return {"message": "Simulation reset", "bins": bins}


@app.get("/api/fleet")
def get_fleet():
    return fleet


@app.post("/api/fleet/dispatch")
def dispatch_fleet(data: DispatchInput):
    truck = next((row for row in fleet if row["id"] == data.truck_id), None)
    if truck is None:
        raise HTTPException(status_code=404, detail=f"Truck not found: {data.truck_id}")
    missing = [bin_id for bin_id in data.bin_ids if not any(row["bin_id"] == bin_id for row in bins)]
    if missing:
        raise HTTPException(status_code=404, detail=f"Bin(s) not found: {', '.join(missing)}")
    for existing_truck in fleet:
        if existing_truck["id"] != data.truck_id:
            existing_truck["assigned_bins"] = [value for value in existing_truck.get("assigned_bins", []) if value not in data.bin_ids]
            existing_truck["assigned_bins_count"] = len(existing_truck["assigned_bins"])
            if not existing_truck["assigned_bins"]:
                existing_truck["status"] = "Available"
    for item in bins:
        if item.get("assigned_truck_id") == data.truck_id:
            item["assigned_truck_id"] = None
    truck.update(assigned_bins=data.bin_ids, assigned_bins_count=len(data.bin_ids),
                 status="On collection" if data.bin_ids else "Available")
    for item in bins:
        if item["bin_id"] in data.bin_ids:
            item["assigned_truck_id"] = data.truck_id
    _log(f"{data.truck_id} dispatched to {len(data.bin_ids)} bin(s)")
    return truck


@app.get("/api/analytics")
def get_analytics():
    avg = round(sum(item["fill_level"] for item in bins) / len(bins), 1) if bins else 0
    return {
        "estimated_waste_collected_kg": len(collections) * 18.5,
        "recycling_segregation_performance_pct": 82.5,
        "environmental_impact_kpis": {
            "total_co2_avoided_kg": round(len(collections) * 2.4, 1),
            "landfill_diversion_rate_pct": 74.2,
            "recycled_material_recovered_kg": round(len(collections) * 9.5, 1),
        },
        "average_fill_level_pct": avg,
        "bins_monitored": len(bins),
        "collections_completed": len(collections),
    }


@app.get("/api/recommendations")
def get_recommendations():
    return {"recommendations": _recommendations()}


@app.post("/api/recommendations/review/{rec_id}")
def review_recommendation(rec_id: str):
    ids = {row["id"] for row in _recommendations()}
    if rec_id not in ids:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    if rec_id in reviewed_recommendations:
        reviewed_recommendations.remove(rec_id)
    else:
        reviewed_recommendations.add(rec_id)
    return {"id": rec_id, "reviewed": rec_id in reviewed_recommendations}


@app.get("/api/collections")
def get_collections():
    return collections


@app.get("/api/activities")
def get_activities():
    return activities


@app.delete("/api/activities")
def clear_activities():
    activities.clear()
    return {"message": "Activity log cleared"}


@app.post("/api/vision/analyze")
def analyze_vision(file: UploadFile = File(...), bin_id: str | None = Form(None)):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Use a JPG, JPEG, PNG, or WEBP image.")
    selected_bin = next((row for row in bins if row["bin_id"] == bin_id), None) if bin_id else None
    if bin_id and selected_bin is None:
        raise HTTPException(status_code=404, detail=f"Bin not found: {bin_id}")
    temp_path: Path | None = None
    width = height = 1
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp:
            temp_path = Path(temp.name)
            total_bytes = 0
            while chunk := file.file.read(1024 * 1024):
                total_bytes += len(chunk)
                if total_bytes > MAX_IMAGE_BYTES:
                    raise HTTPException(status_code=413, detail="Image must be 10 MB or smaller.")
                temp.write(chunk)
        if total_bytes == 0:
            raise HTTPException(status_code=422, detail="The uploaded image is empty.")
        try:
            from PIL import Image
            with Image.open(temp_path) as img:
                width, height = img.size
                img.verify()
        except ImportError:
            raise
        except Exception as exc:
            raise HTTPException(status_code=422, detail="The uploaded file is not a readable image.") from exc
        if os.getenv("CITYPULSE_YOLO_MODEL"):
            try:
                fill_result = analyze_bin_image(temp_path, model_path=os.environ["CITYPULSE_YOLO_MODEL"])
            except Exception as exc:
                logger.warning("Optional bin-fill model failed: %s", exc)
                fill_result = {
                    "source": "computer_vision", "image": Path(file.filename or "upload").name,
                    "model": os.environ["CITYPULSE_YOLO_MODEL"], "detections": [],
                    "fill_level_percent": None, "fill_category": None, "confidence": None,
                    "needs_custom_fill_model": True, "error": str(exc),
                }
        else:
            fill_result = {
                "source": "computer_vision", "image": Path(file.filename or "upload").name,
                "model": None, "detections": [], "fill_level_percent": None,
                "fill_category": None, "confidence": None, "needs_custom_fill_model": True,
                "message": "Waste detection can run without a separate bin-fill model. Configure CITYPULSE_YOLO_MODEL to estimate fill.",
            }
        try:
            waste_result = analyze_waste_image(temp_path)
        except ImportError as exc:
            raise HTTPException(
                status_code=503,
                detail=f"Computer-vision dependencies are missing. In the backend folder run: python -m pip install -r requirements.txt. Details: {exc}",
            ) from exc
        except Exception as exc:
            logger.exception("Waste detection model failed to load or run")
            raise HTTPException(
                status_code=503,
                detail=f"Waste-detection model could not start: {exc}. Check internet access for its first weight download, or set CITYPULSE_WASTE_MODEL to a local .pt model file.",
            ) from exc
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ImportError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Computer-vision inference failed: {exc}") from exc
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)
        await_close = getattr(file, "file", None)
        if await_close:
            await_close.close()

    items = waste_result["items"]
    dominant = waste_result["dominant_waste_type"]
    labels = {"plastic": "Plastic", "metal": "Metal", "glass": "Glass", "cardboard": "Cardboard",
              "paper": "Paper", "organic": "Organic waste", "hazardous": "Hazardous waste",
              "general_waste": "General waste"}
    destinations = {"plastic": ("Blue Bin — Dry Recyclables", "#38bdf8"), "metal": ("Blue Bin — Metal Streams", "#3b82f6"),
                    "glass": ("Amber Bin — Glass Recycling", "#f59e0b"), "cardboard": ("Cyan Bin — Paper & Fibers", "#06b6d4"),
                    "paper": ("Cyan Bin — Paper & Fibers", "#06b6d4"), "organic": ("Green Bin — Organic Compost", "#10b981"),
                    "hazardous": ("Approved hazardous-waste collection point", "#f97316"),
                    "general_waste": ("Residual Waste Bin", "#94a3b8")}
    destination, color = destinations.get(dominant, ("Manual review required", "#94a3b8"))
    detections = []
    for index, item in enumerate(items):
        x1, y1, x2, y2 = item["bbox_xyxy"]
        kind = item["waste_type"]
        detections.append({"id": f"det-{index + 1}", "label": item["label"], "category": kind,
                           "confidence": item["confidence"], "bbox": [y1 / height, x1 / width, y2 / height, x2 / width]})
    fill = fill_result["fill_level_percent"]
    updated = bool(fill is not None and selected_bin)
    if updated:
        selected_bin.update(fill_level=round(fill), priority=_priority(fill), priority_score=round(fill),
                            collection_needed=fill >= 65, status="critical" if fill >= 80 else "warning" if fill >= 50 else "healthy",
                            data_type="COMPUTER_VISION", history=[*selected_bin.get("history", [])[-5:], round(fill)])
        _log(f"Vision observation updated {selected_bin['bin_id']} to {round(fill)}%", selected_bin["bin_id"])
    _log(f"Waste image analyzed: {dominant or 'no confident class'}")
    return {
        "success": True, "filename": Path(file.filename or "upload").name,
        "primary_category": dominant or "uncertain", "primary_label": labels.get(dominant, "No confident waste type identified"),
        "destination_bin": destination, "bin_color": color,
        "segregation_advice": " ".join(waste_result["recommendations"]),
        "decomposition_time": "Not estimated", "total_items": len(detections),
        "detections": detections, "detected_categories": sorted(waste_result["counts_by_type"]),
        "environmental_impact": {"co2_saved_kg": 0, "eco_points_earned": 0, "is_recyclable": dominant in {"plastic", "metal", "glass", "paper", "cardboard"}},
        "processing_time_ms": None, "inference_mode": "Ultralytics YOLO + YOLO-World",
        "is_simulated_fallback": False, "waste_analysis": waste_result,
        "fill_analysis": fill_result, "bin_id": bin_id, "fill_level_percent": fill,
        "bin_updated": updated,
        "message": f"{bin_id} updated to {round(fill)}%." if updated else "Waste objects analyzed. Fill was not updated because the configured model did not return a recognized fill label or no bin was selected.",
    }


@app.post("/analyze-image")
def analyze_image_legacy(file: UploadFile = File(...), bin_id: str | None = Form(None)):
    """Compatibility route for the original backend endpoint."""
    return analyze_vision(file, bin_id)
