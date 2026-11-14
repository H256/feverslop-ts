import unittest
from phoneme_compare import ctc_path, fill_short_gaps


class PhonemeTests(unittest.TestCase):
    def test_repeated_phones_require_blank(self):
        scores = [[0, -9], [-9, 0], [0, -9], [-9, 0], [0, -9]]
        self.assertEqual(ctc_path(scores, [1, 1], 0), [(1, 2), (3, 4)])

    def test_impossible_alignment_fails(self):
        with self.assertRaises(ValueError):
            ctc_path([[0, -1]], [1, 1], 0)

    def test_gap_fill_does_not_bridge_pause(self):
        phones = [{'start': 1., 'end': 1.1}, {'start': 1.2, 'end': 1.3},
                  {'start': 2., 'end': 2.2}]
        fill_short_gaps(phones)
        self.assertAlmostEqual(phones[0]['end'], 1.14)
        self.assertAlmostEqual(phones[1]['start'], 1.14)
        self.assertEqual(phones[1]['end'], 1.3)


if __name__ == '__main__':
    unittest.main()
