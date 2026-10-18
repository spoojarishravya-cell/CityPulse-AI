"""Rule-based operational recommendations for CityPulse AI."""


def generate_recommendations(bins: list[dict]) -> list[dict]:
    """Return explainable collection and segregation recommendations."""
    recommendations = []
    for item in bins:
        bin_id = item.get("bin_id", item.get("id", "Unknown"))
        location = item.get("area", item.get("location", "Unknown location"))
        fill_level = int(item.get("fill_level", 0))
        waste_type = str(item.get("waste_type", "mixed"))

        if fill_level >= 90:
            recommendations.append({
                "bin_id": bin_id, "category": "Collection", "priority": "CRITICAL",
                "title": "Immediate collection recommended",
                "message": f"{bin_id} at {location} is {fill_level}% full. Prioritize collection.",
            })
        elif fill_level >= 75:
            recommendations.append({
                "bin_id": bin_id, "category": "Collection", "priority": "HIGH",
                "title": "Schedule collection soon",
                "message": f"{bin_id} at {location} is {fill_level}% full. Schedule collection soon.",
            })

        normalized_type = waste_type.lower()
        if normalized_type in {"mixed", "general waste"}:
            recommendations.append({
                "bin_id": bin_id, "category": "Segregation", "priority": "MEDIUM",
                "title": "Review waste segregation",
                "message": f"Review segregation practices at {location} where separate streams are available.",
            })
        elif any(kind in normalized_type for kind in ("plastic", "paper", "metal", "glass", "cardboard")):
            recommendations.append({
                "bin_id": bin_id, "category": "Recycling", "priority": "MEDIUM",
                "title": "Assess recycling opportunities",
                "message": f"Check the local recycling stream for {waste_type} collected at {location}.",
            })
    return recommendations
