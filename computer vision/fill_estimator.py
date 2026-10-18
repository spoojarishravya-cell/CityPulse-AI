import argparse
import cv2
import numpy as np


def estimate_bin_fill(image_path):
    image = cv2.imread(image_path)

    if image is None:
        raise FileNotFoundError(f"Could not load image: {image_path}")

    image = cv2.resize(image, (512, 512))
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)

    lower_green = np.array([30, 35, 25])
    upper_green = np.array([100, 255, 255])
    mask = cv2.inRange(hsv, lower_green, upper_green)

    # Diagnostic: where does the algorithm detect green?
    debug = image.copy()
    debug[mask > 0] = (255, 255, 255)

    if not cv2.imwrite("fill_debug.jpg", debug):
        print("Warning: Could not save diagnostic image.")

    green_pixels = np.count_nonzero(mask)
    green_ratio = green_pixels / mask.size

    # Color detection alone cannot reliably measure fill level.
    return {
        "fill_level": None,
        "overflow_detected": None,
        "green_pixel_ratio": round(float(green_ratio), 3),
        "confidence": "low",
        "message": (
            "Green-bin diagnostic only. "
            "Fill level and overflow require visual verification."
        ),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("image", help="Path to the bin photo")
    args = parser.parse_args()

    try:
        result = estimate_bin_fill(args.image)
        print(result)
        print("Diagnostic image saved as fill_debug.jpg")
    except (FileNotFoundError, cv2.error) as exc:
        print(f"Error: {exc}")