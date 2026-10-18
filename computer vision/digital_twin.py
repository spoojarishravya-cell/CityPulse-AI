from dataclasses import dataclass
from typing import Optional
import math


@dataclass
class Bin:
    bin_id: str
    latitude: float
    longitude: float
    fill_level: float
    fill_rate: float  # percentage points per hour
    overflow_threshold: float = 100.0
    last_observation: str = "Initial simulation"


def time_to_overflow(bin_data: Bin) -> Optional[float]:
    """Estimate hours until the bin reaches its threshold."""
    remaining = bin_data.overflow_threshold - bin_data.fill_level

    if remaining <= 0:
        return 0.0

    if bin_data.fill_rate <= 0:
        return None

    return remaining / bin_data.fill_rate


def priority_score(bin_data: Bin) -> float:
    """Simple, explainable priority score from 0 to 100."""
    fill = min(max(bin_data.fill_level, 0), 100)

    # More urgency for fuller bins.
    score = fill

    # Additional urgency when overflow is estimated soon.
    hours = time_to_overflow(bin_data)
    if hours is not None and hours <= 3:
        score += 20
    elif hours is not None and hours <= 6:
        score += 10

    return min(score, 100)


def update_observation(
    bin_data: Bin,
    observed_fill: float,
    observation_source: str = "computer_vision",
) -> Bin:
    """Update a virtual bin using a new observation."""
    if not 0 <= observed_fill <= 100:
        raise ValueError("Fill level must be between 0 and 100.")

    bin_data.fill_level = observed_fill
    bin_data.last_observation = observation_source
    return bin_data


def recommend_collection(bins: list[Bin]) -> list[dict]:
    """Rank bins by urgency. This is not a road-optimal route."""
    results = []

    for bin_data in bins:
        hours = time_to_overflow(bin_data)

        results.append({
            "bin_id": bin_data.bin_id,
            "fill_level": bin_data.fill_level,
            "hours_to_overflow": hours,
            "priority_score": priority_score(bin_data),
        })

    return sorted(
        results,
        key=lambda item: item["priority_score"],
        reverse=True,
    )

def export_bin_record(bin_data: Bin) -> dict:
    """Return a bin record using the agreed backend data contract."""
    hours = time_to_overflow(bin_data)

    predicted_fill = None
    if hours is not None:
        predicted_fill = min(
            bin_data.overflow_threshold,
            max(0.0, bin_data.fill_level + bin_data.fill_rate * 2)
        )

    return {
        "bin_id": bin_data.bin_id,
        "fill_level": float(bin_data.fill_level),
        "latitude": float(bin_data.latitude),
        "longitude": float(bin_data.longitude),
        "predicted_fill_level": (
            float(predicted_fill) if predicted_fill is not None else None
        ),
        "estimated_time_to_overflow_hours": (
            round(hours, 2) if hours is not None else None
        ),
    }

def export_bin_record(bin_data: Bin) -> dict:
    """Export a bin using the agreed CityPulseAI data contract."""
    hours = time_to_overflow(bin_data)

    predicted_fill = None
    if hours is not None:
        predicted_fill = min(
            bin_data.overflow_threshold,
            max(0.0, bin_data.fill_level + bin_data.fill_rate * 2)
        )

    return {
        "bin_id": bin_data.bin_id,
        "fill_level": float(bin_data.fill_level),
        "latitude": float(bin_data.latitude),
        "longitude": float(bin_data.longitude),
        "predicted_fill_level": (
            float(predicted_fill) if predicted_fill is not None else None
        ),
        "estimated_time_to_overflow_hours": (
            round(hours, 2) if hours is not None else None
        ),
    }