def explain_recommendations(recommendations: list[dict]) -> str:
    """Explain only values supplied by the decision engine."""
    if not recommendations:
        return "No bins are available for analysis."

    lines = ["CityPulse AI: Collection assessment"]

    for item in recommendations:
        bin_id = item["bin_id"]
        fill = item["fill_level"]
        hours = item["hours_to_overflow"]
        score = item["priority_score"]

        if hours is None:
            timing = "time to overflow cannot be estimated"
        elif hours == 0:
            timing = "at or beyond the overflow threshold"
        else:
            timing = f"estimated overflow in {hours:.1f} hours"

        lines.append(
            f"{bin_id}: {fill:.0f}% full; {timing}; "
            f"priority score {score:.0f}/100."
        )

    top = recommendations[0]
    lines.append(
        f"Current recommendation: assess {top['bin_id']} first "
        "because it has the highest calculated priority score."
    )
    lines.append(
        "These are estimates based on the configured fill rates. "
        "The ranking is not a globally optimized vehicle route."
    )

    return "\n".join(lines)