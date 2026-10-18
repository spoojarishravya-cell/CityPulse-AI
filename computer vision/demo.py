"""Run a console demo against the live CityPulseAI FastAPI backend."""

import json
import sys

from citypulse import CityPulseError, analyze_image, get_json


def show(title, value):
    print(f"\n--- {title} ---")
    print(json.dumps(value, indent=2, ensure_ascii=False))


def main():
    if len(sys.argv) not in (1, 3):
        print('Usage: python demo.py ["path/to/image.jpg" BIN-01]')
        return 2

    try:
        show("CITYPULSE AI", get_json("/"))
        show("BINS", get_json("/bins"))
        show("COLLECTION PRIORITIES", get_json("/priorities"))
        show("THREE-HOUR SIMULATION", get_json("/simulation"))

        if len(sys.argv) == 3:
            result = analyze_image(sys.argv[1], sys.argv[2])
            show("IMAGE ANALYSIS", result)
            try:
                show("UPDATED RECOMMENDATIONS", get_json("/recommendations"))
            except CityPulseError as exc:
                if "HTTP 404" in str(exc):
                    print("\nThis backend does not have GET /recommendations yet.")
                    print("The image-analysis result above is still available.")
                else:
                    raise
        else:
            print("\nTo include an image, run:")
            print('  python demo.py "open_bin.jpeg" BIN-01')
            print("Edit the image path if your photo is in another folder.")

    except CityPulseError as exc:
        print(f"\nDemo could not finish: {exc}")
        return 1

    print("\nDemo complete. Forecast values are simulated; image detections are model suggestions.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
