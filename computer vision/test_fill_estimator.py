import os
import tempfile
import unittest

import cv2
import numpy as np

from fill_estimator import estimate_bin_fill


class FillEstimatorTests(unittest.TestCase):

    def test_missing_image_returns_error(self):
        with self.assertRaises(FileNotFoundError):
            estimate_bin_fill("image_that_does_not_exist.jpg")

    def test_uncertain_image_does_not_invent_fill_percentage(self):
        # A plain image with no green bin.
        image = np.zeros((100, 100, 3), dtype=np.uint8)

        with tempfile.NamedTemporaryFile(
            suffix=".jpg", delete=False
        ) as temp:
            image_path = temp.name

        try:
            cv2.imwrite(image_path, image)
            result = estimate_bin_fill(image_path)

            self.assertIsNone(result["fill_level"])
            self.assertEqual(result["confidence"], "low")
        finally:
            os.remove(image_path)


if __name__ == "__main__":
    unittest.main()