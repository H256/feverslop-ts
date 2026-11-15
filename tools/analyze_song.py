# /// script
# requires-python = ">=3.11,<3.13"
# dependencies = ["librosa>=0.10", "numpy"]
# ///
"""Analyze a song for beat matching.

usage: uv run tools/analyze_song.py <song.wav> '<json list of section labels>'

The section labels come from the lyrics tags ([Intro], [Verse 1], ...) in song order.
The song is split into exactly that many contiguous sections, snapped to downbeats.
Prints a MusicMap JSON to stdout.
"""
import json
import sys

import librosa
import numpy as np

path = sys.argv[1]
labels: list[str] = json.loads(sys.argv[2])

y, sr = librosa.load(path, sr=22050, mono=True)
duration = len(y) / sr

onset_env = librosa.onset.onset_strength(y=y, sr=sr)
tempo, beat_frames = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr)
bpm = float(np.atleast_1d(tempo)[0])
beats = librosa.frames_to_time(beat_frames, sr=sr)

# a song with fewer than two bars of beats (silence, noise, a very short file) has no phase to pick: a mean over nothing is NaN
if len(beats) < 8:
    sys.exit(f"Song analysis: found only {len(beats)} beat(s) in {duration:.1f} s - the song is too short, too quiet or has no steady beat")

# The meter: 4 beats to the bar, or 3 when the accent comes round every third beat clearly more than every fourth (a waltz; #994).
# How strongly a phase of m beats stands out from the beats in general, in units of their spread - the best phase of each meter.
strength = onset_env[beat_frames].astype(float)


def accent(m: int) -> float:
    spread = strength.std() or 1.0
    return max((strength[p::m].mean() - strength.mean()) / spread for p in range(m))


# conservative: 3 only with enough beats to tell and a clear margin - a 4/4 song stays 4/4 whatever its pattern. Measured on 14 of
# the project songs (all 4/4): the accent of a third beat 0.02-0.16, of a fourth 0.04-0.32; a synthetic waltz 0.26 against 0.06.
beats_per_bar = 3 if len(beats) >= 24 and accent(3) > 0.2 and accent(3) > accent(4) * 1.5 + 0.1 else 4

# Downbeats: pick the beat phase with the strongest onsets
phase = max(range(beats_per_bar), key=lambda p: onset_env[beat_frames[p::beats_per_bar]].mean())
downbeats = beats[phase::beats_per_bar]

# Energy per bar, normalized 0..1
rms = librosa.feature.rms(y=y)[0]
rms_times = librosa.frames_to_time(np.arange(len(rms)), sr=sr)
bar_edges = np.append(downbeats, duration)
bar_energy = np.array([rms[(rms_times >= s) & (rms_times < e)].mean() if e > s else 0.0
                       for s, e in zip(bar_edges[:-1], bar_edges[1:])])
bar_energy = (bar_energy - bar_energy.min()) / max(np.ptp(bar_energy), 1e-9)

# Sections: novelty on a bar-level self-similarity matrix (timbre + harmony + loudness),
# boundaries only on 4-bar phrase starts, as sections in pop/metal almost always are
chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13)
bar_frames = librosa.time_to_frames(downbeats, sr=sr)
# sync() makes one column per bar plus the pickup before the first downbeat - unless that downbeat is at frame 0, then there is no pickup
pickup = 1 if len(bar_frames) and bar_frames[0] > 0 else 0
per_bar = [librosa.util.sync(f, bar_frames)[:, pickup:] for f in (chroma, mfcc)]
features = np.vstack([librosa.util.normalize(f, axis=0) for f in per_bar] + [bar_energy[None, :]])
features = (features - features.mean(axis=1, keepdims=True)) / (features.std(axis=1, keepdims=True) + 1e-9)
unit = features / (np.linalg.norm(features, axis=0, keepdims=True) + 1e-9)
similarity = unit.T @ unit

half = 4  # bars on each side of a candidate boundary
g = np.exp(-0.5 * (np.linspace(-1, 1, 2 * half) / 0.5) ** 2)
kernel = np.outer(g, g) * np.kron([[1, -1], [-1, 1]], np.ones((half, half)))
padded = np.pad(similarity, half, mode='edge')
novelty = np.array([(padded[i:i + 2 * half, i:i + 2 * half] * kernel).sum() for i in range(len(bar_energy))])

n_bars = len(bar_energy)
candidates = [b for b in range(4, n_bars - 3, 4)]
chosen: list[int] = []
for b in sorted(candidates, key=lambda b: -novelty[b]):
    if len(chosen) == len(labels) - 1:
        break
    if all(abs(b - c) >= 4 for c in chosen):
        chosen.append(b)
if len(chosen) < len(labels) - 1:
    # fewer section starts than labels would silently drop the last sections (and the song would be analyzed again on every run)
    sys.exit(f"Song analysis: found only {len(chosen) + 1} section(s) in {n_bars} bars for {len(labels)} lyric sections - "
             "the song is too short or its beat could not be tracked; merge sections in the lyrics or use a longer song")
starts = [0.0] + [float(downbeats[b]) for b in sorted(chosen)]
ends = starts[1:] + [duration]

sections = []
for label, start, end in zip(labels, starts, ends):
    in_section = (downbeats >= start) & (downbeats < end)
    sections.append({
        "label": label,
        "start": round(start, 3),
        "end": round(end, 3),
        "energy": round(float(bar_energy[in_section].mean()) if in_section.any() else 0.0, 3),
    })

print(json.dumps({
    "bpm": round(bpm, 2),
    "beatsPerBar": beats_per_bar,
    "durationSec": round(duration, 3),
    "downbeats": [round(float(t), 3) for t in downbeats],
    "barEnergy": [round(float(e), 3) for e in bar_energy],
    "sections": sections,
}))
