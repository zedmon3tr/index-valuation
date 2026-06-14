import unittest

from scripts.data_utils import merge_series


class MergeSeriesTests(unittest.TestCase):
    def test_merges_independent_metric_dates_into_sorted_aligned_arrays(self):
        result = merge_series(
            {
                "pe": (["2026-01-01", "2026-01-03"], [10.0, 12.0]),
                "pb": (["2026-01-02"], [1.5]),
                "dy": (["2026-01-03"], [2.8]),
            }
        )

        self.assertEqual(result["dates"], ["2026-01-01", "2026-01-02", "2026-01-03"])
        self.assertEqual(result["pe"], [10.0, None, 12.0])
        self.assertEqual(result["pb"], [None, 1.5, None])
        self.assertEqual(result["dy"], [None, None, 2.8])

    def test_ignores_invalid_dates_and_keeps_last_duplicate_value(self):
        result = merge_series(
            {"dy": (["", "2026-01-01", "2026-01-01"], [9, 2.0, 2.1])}
        )

        self.assertEqual(result, {"dates": ["2026-01-01"], "dy": [2.1]})


if __name__ == "__main__":
    unittest.main()
