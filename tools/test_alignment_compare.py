import unittest
from alignment_compare import map_words, compare


class AlignmentTest(unittest.TestCase):
    def test_offset_and_missing_word_are_not_interpolated(self):
        lines = [{"line": 3, "text": "Ich singe jetzt"}]
        found = map_words(lines, [{"text": "Ich", "start": 1, "end": 1.2},
                                  {"text": "jetzt", "start": 2, "end": 3}], 40)
        self.assertEqual(found[0]["start"], 41)
        self.assertEqual(found[0]["end"], 43)
        self.assertIsNone(found[0]["words"][1]["start"])
        self.assertFalse(found[0]["complete"])

    def test_repeated_words_keep_order(self):
        result = map_words([{"line": 0, "text": "Lyra Lyra"}],
                           [{"text": "Lyra", "start": 0, "end": 1},
                            {"text": "Lyra", "start": 1, "end": 2}], 0)
        self.assertEqual([w["start"] for w in result[0]["words"]], [0, 1])

    def test_missing_edge_is_not_replaced_by_inner_word(self):
        result = map_words([{"line": 0, "text": "Ich singe jetzt"}],
                           [{"text": "singe", "start": 1, "end": 2}], 0)
        self.assertIsNone(result[0]["start"])
        self.assertIsNone(result[0]["end"])

    def test_missing_prediction_counts_against_accuracy(self):
        result = compare([], [{"line": 0, "start": 1, "end": None}],
                         [{"line": 0, "start": 1, "end": 2}])
        self.assertEqual(result["accuracy"]["within"]["0.05"], .5)

    def test_unconfirmed_baseline_is_not_ground_truth(self):
        baseline = [{"line": 0, "start": 1, "end": 2}]
        candidate = [{"line": 0, "start": 1.2, "end": 2.4}]
        report = compare(baseline, candidate, [])
        self.assertIsNone(report["accuracy"])
        self.assertAlmostEqual(report["changes"][0]["start_delta"], .2)


if __name__ == "__main__":
    unittest.main()
