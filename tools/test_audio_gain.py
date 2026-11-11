import unittest

import numpy as np

from audio_gain import boost_audio


class AudioGainTest(unittest.TestCase):
    def test_quiet_stereo_gets_six_db_without_changing_source_or_shape(self):
        audio = np.array([[0.1, -0.2], [0.05, 0.15]], dtype=np.float32)
        before = audio.copy()
        boosted, gain = boost_audio(audio)
        np.testing.assert_allclose(boosted, audio * 10 ** (6 / 20), rtol=1e-6)
        np.testing.assert_array_equal(audio, before)
        self.assertAlmostEqual(gain, 6)
        self.assertEqual(boosted.shape, audio.shape)
        self.assertEqual(boosted.dtype, audio.dtype)

    def test_gain_stops_at_peak_headroom(self):
        boosted, gain = boost_audio(np.array([0.8, -0.4], dtype=np.float32))
        np.testing.assert_allclose(boosted, [0.95, -0.475], rtol=1e-6)
        self.assertGreater(gain, 0)
        self.assertLess(gain, 6)

    def test_silence_loud_audio_and_disabled_gain_are_unchanged(self):
        for audio, requested in [(np.zeros(4, dtype=np.float32), 6), (np.array([0.99]), 6), (np.array([0.2]), 0), (np.array([]), 6)]:
            boosted, gain = boost_audio(audio, requested)
            np.testing.assert_array_equal(boosted, audio)
            self.assertEqual(gain, 0)


if __name__ == '__main__':
    unittest.main()
