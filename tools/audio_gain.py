import math

import numpy as np


def boost_audio(audio: np.ndarray, gain_db: float = 6.0) -> tuple[np.ndarray, float]:
    """Raise quiet audio by up to gain_db, preserving channels and leaving peak headroom."""
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if not peak or peak >= 0.95 or gain_db == 0:
        return audio, 0.0
    factor = min(10 ** (gain_db / 20), 0.95 / peak)
    return audio * factor, 20 * math.log10(factor)
