import unittest

from digital_twin import (
    Bin,
    update_observation,
    time_to_overflow,
    recommend_collection,
)
from vision import manual_observation
from ai_explainer import explain_recommendations


class CityPulseTests(unittest.TestCase):

    def setUp(self):
        self.bin_data = Bin(
            "BIN-07", 12.97, 77.59, 60, 5
        )

    def test_overflow_estimate(self):
        self.assertEqual(
            time_to_overflow(self.bin_data), 8
        )

    def test_new_observation_updates_twin(self):
        observation = manual_observation(95)

        update_observation(
            self.bin_data,
            observation["fill_level"],
            observation["source"],
        )

        self.assertEqual(self.bin_data.fill_level, 95)
        self.assertEqual(time_to_overflow(self.bin_data), 1)

    def test_invalid_observation_is_rejected(self):
        with self.assertRaises(ValueError):
            update_observation(self.bin_data, 120)

    def test_highest_priority_comes_first(self):
        low = Bin("LOW", 12.97, 77.59, 20, 2)
        high = Bin("HIGH", 12.98, 77.60, 95, 5)

        results = recommend_collection([low, high])
        self.assertEqual(results[0]["bin_id"], "HIGH")

    def test_explanation_uses_calculated_values(self):
        results = recommend_collection([self.bin_data])
        explanation = explain_recommendations(results)

        self.assertIn("BIN-07", explanation)
        self.assertIn("60%", explanation)
        self.assertIn("8.0 hours", explanation)

    def test_empty_recommendations(self):
        self.assertIn(
            "No bins",
            explain_recommendations([])
        )


if __name__ == "__main__":
    unittest.main()