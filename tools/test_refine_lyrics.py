import unittest
from refine_lyrics import windows, word_phones


class RefinementTests(unittest.TestCase):
    def test_windows_keep_neighbours_as_context_without_unbounded_audio(self):
        lines = [{'line': n, 'start': n * 5, 'end': n * 5 + 4} for n in range(12)]
        chunks = windows(lines, 60)
        self.assertEqual(sorted({l['line'] for c in chunks for l in c['lines']}), list(range(12)))
        self.assertTrue(all(c['end'] - c['start'] <= 30 for c in chunks))
        self.assertTrue(any(chunks[0]['lines'][-1]['line'] == l['line'] for l in chunks[1]['lines']))

    def test_g2p_merging_english_function_words_falls_back_without_losing_words(self):
        def speak(texts):
            return ['aɪ | s ɪ ŋ | ɪ n ð ə | l aɪ t'] if len(texts) == 1 else ['aɪ', 's ɪ ŋ', 'ɪ n', 'ð ə', 'l aɪ t']
        groups = word_phones(['I', 'sing', 'in', 'the', 'light'], speak)
        self.assertEqual(len(groups), 5)
        self.assertEqual(groups[3], ['ð', 'ə'])

    def test_empty_pronunciation_is_rejected(self):
        with self.assertRaises(ValueError):
            word_phones(['♪'], lambda texts: [''])


if __name__ == '__main__':
    unittest.main()
