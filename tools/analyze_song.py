# /// script
# requires-python = ">=3.11,<3.14"
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

# Downbeats: assume 4/4 and pick the beat phase with the strongest onsets
phase = max(range(4), key=lambda p: onset_env[beat_frames[p::4]].mean())
downbeats = beats[phase::4]

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
per_bar = [librosa.util.sync(f, bar_frames)[:, 1:] for f in (chroma, mfcc)]  # drop the pickup before bar 0
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
    "durationSec": round(duration, 3),
    "downbeats": [round(float(t), 3) for t in downbeats],
    "barEnergy": [round(float(e), 3) for e in bar_energy],
    "sections": sections,
}))
