from digital_twin import Bin, priority_score, export_bin_record


def simulate_bins(bins, duration_hours=6, step_hours=1):
    """Simulate bin filling using configured fill rates."""

    if duration_hours < 0 or step_hours <= 0:
        raise ValueError("Duration must be >= 0 and step must be > 0.")

    print("\n=== CITYPULSE AI: DIGITAL TWIN SIMULATION ===")

    for hour in range(0, duration_hours + 1, step_hours):
        print(f"\n--- Hour {hour} ---")

        ranked_bins = sorted(
            bins,
            key=priority_score,
            reverse=True,
        )

        for bin_data in ranked_bins:
            record = export_bin_record(bin_data)
            score = priority_score(bin_data)

            status = (
                "OVERFLOW THRESHOLD REACHED!"
                if bin_data.fill_level >= bin_data.overflow_threshold
                else "OK"
            )

            print(
                f"{record['bin_id']}: "
                f"{record['fill_level']:.1f}% full | "
                f"Priority: {score:.0f}/100 | "
                f"Status: {status}"
            )

        if hour + step_hours <= duration_hours:
            for bin_data in bins:
                bin_data.fill_level = min(
                    bin_data.overflow_threshold,
                    max(
                        0,
                        bin_data.fill_level
                        + bin_data.fill_rate * step_hours,
                    ),
                )


if __name__ == "__main__":
    bins = [
        Bin("BIN-07", 12.93, 77.61, 60, 5),
        Bin("BIN-08", 12.94, 77.62, 70, 4),
        Bin("BIN-09", 12.92, 77.60, 35, 6),
    ]
    initial_states = [
        (b.bin_id, b.fill_level, b.fill_rate, b.overflow_threshold)
        for b in bins
    ]
    
    simulate_bins(bins, duration_hours=10, step_hours=1)

    
    print("\n=== FIRST PREDICTED OVERFLOW ===")

    candidates = [
        (bin_id, (threshold - fill) / rate)
        for bin_id, fill, rate, threshold in initial_states
        if rate > 0 and fill < threshold
    ]

    if candidates:
        first_bin, hours_left = min(candidates, key=lambda item: item[1])
        print(f"Bin: {first_bin}")
        print(f"Estimated time to overflow: {hours_left:.1f} hours")
    else:
        print("No future overflow predicted for the initial bin states.")