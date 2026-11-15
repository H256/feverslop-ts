import unittest
from refine_lyrics import windows, word_phones, phone_tokens


class RefinementTests(unittest.TestCase):
    def test_composite_uses_exact_existing_tokens(self):
        self.assertEqual(phone_tokens('ʊɐ', {'ʊ': 7, 'ɐ': 9}), [7, 9])

    def test_native_token_takes_precedence_over_decomposition(self):
        self.assertEqual(phone_tokens('ʊɐ', {'ʊɐ': 3, 'ʊ': 7, 'ɐ': 9}), [3])
        self.assertEqual(phone_tokens('aɪ', {'aɪ': 11}), [11])

    def test_absent_phone_is_not_approximated_or_silently_split(self):
        for phone, vocab in [('ʏ', {'y': 1, 'ɪ': 2}), ('ʊɐ', {'ʊ': 7}), ('ab', {'a': 1, 'b': 2})]:
            with self.subTest(phone=phone), self.assertRaisesRegex(ValueError, 'Unsupported IPA'):
                phone_tokens(phone, vocab)

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
