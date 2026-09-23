# /// script
# requires-python = ">=3.11,<3.13"
# dependencies = ["torch>=2.14", "torchaudio>=2.11", "demucs>=4.0.1", "openai-whisper>=20250625", "soundfile", "numpy", "librosa>=0.10"]
#
# [tool.uv.sources]
# torch = { index = "pytorch-cu130" }
# torchaudio = { index = "pytorch-cu130" }
#
# [[tool.uv.index]]
# name = "pytorch-cu130"
# url = "https://download.pytorch.org/whl/cu130"
# explicit = true
# ///
"""Stem separation and vocal transcription for the lyrics alignment.

usage: uv run tools/vocals.py separate <song.wav> <stems-dir>
       uv run tools/vocals.py transcribe <vocals.wav> <language> <lyrics.txt>

separate    demucs htdemucs_ft -> <stems-dir>/{vocals,drums,bass,other}.wav
            htdemucs_ft (the fine-tuned 4-source bag of models) gives the cleanest vocal separation of the
            demucs family - instrument bleed (e.g. guitar leaking into the vocals stem) is more common with
            htdemucs_6s, which spends model capacity splitting out guitar/piano that this project doesn't use.
transcribe  Whisper large-v3, the known lyrics as prompt. Segment-level timing only (word_timestamps=False) -
            whisper's word-level DTW alignment needs Triton kernels that are flaky/slow-to-nonexistent on
            Windows and on very new GPUs (e.g. RTX 50xx); word positions are instead spread evenly across each
            segment, matching how the alignment step already interpolates words it can't pin down exactly.
            Also runs an RMS-energy vocal activity detection on the same audio (independent of whisper) - for
            growled/screamed vocals whisper often transcribes nothing at all, but the alignment step can still
            place interpolated words inside a real detected-activity window instead of guessing blind.
            Prints {"words": [{"text", "start", "end", "probability"}], "activity": [{"start", "end"}]} as JSON.

Runs on CUDA if available (PyTorch cu130 wheels - cu128 builds are missing precompiled kernels for RTX 50xx/
Blackwell (sm_120), which forces slow driver-side PTX JIT compilation on every CUDA call), else on the CPU.
The models are downloaded on first use: demucs ~80 MB, whisper large-v3 ~3 GB.
Progress goes to stderr, stdout only carries the result.
"""
import gc
import inspect
import json
import math
import re
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

device = "cuda" if torch.cuda.is_available() else "cpu"


def log(message: str):
    print(message, file=sys.stderr, flush=True)


def unload():
    # frees the model's VRAM right away, not only when the process ends - ComfyUI may share the GPU
    gc.collect()
    if device == "cuda":
        torch.cuda.synchronize()
        torch.cuda.empty_cache()
        torch.cuda.ipc_collect()
        log(f"model unloaded, {torch.cuda.memory_allocated() / 2**20:.0f} MB VRAM still allocated")


def separate(song: str, stems_dir: str):
    from demucs.apply import apply_model
    from demucs.pretrained import get_model
    from julius import resample_frac

    model = get_model("htdemucs_ft")
    model.to(device).eval()
    log(f"demucs htdemucs_ft on {device}")

    # read with soundfile instead of torchaudio - newer torchaudio versions dropped their own audio IO
    data, sr = sf.read(song, dtype="float32", always_2d=True)
    wav = torch.from_numpy(data.T.copy())
    if wav.shape[0] == 1:
        wav = wav.repeat(2, 1)
    wav = wav[:2]
    if sr != model.samplerate:
        wav = resample_frac(wav, sr, model.samplerate)

    # the normalization demucs' own CLI does
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    # shifts=2: averages the prediction over 2 random time-shifts of the input, reducing separation artifacts
    # (incl. instrument bleed into the vocals stem) at roughly double the inference time
    with torch.no_grad():
        sources = apply_model(model, ((wav - mean) / std)[None], device=device, shifts=2, split=True, overlap=0.25, progress=True)[0]
    sources = sources.cpu() * std + mean
    names = list(model.sources)
    samplerate = model.samplerate
    del model
    unload()

    out = Path(stems_dir)
    out.mkdir(parents=True, exist_ok=True)
    for name, source in zip(names, sources):
        target = out / f"{name}.wav"
        sf.write(target, np.clip(source.numpy().T, -1, 1), samplerate, subtype="PCM_16")
        log(f"saved {target}")


def vocal_activity(vocals: str, *, frame_length=2048, hop_length=512, min_duration=0.4, merge_gap=0.5,
                    low_percentile=20.0, high_percentile=85.0, ratio=0.35) -> list[dict]:
    """Time ranges where the vocals stem is loud relative to itself, independent of whisper - screamed/growled
    vocals that whisper can't transcribe still show up here, giving the alignment step real acoustic grounding
    to place interpolated words in instead of spreading them blindly across a whole silent-looking gap."""
    import librosa

    y, sr = librosa.load(vocals, sr=None, mono=True)
    rms = librosa.feature.rms(y=y, frame_length=frame_length, hop_length=hop_length)[0]
    if rms.size == 0:
        return []
    low, high = np.percentile(rms, low_percentile), np.percentile(rms, high_percentile)
    threshold = low + (high - low) * ratio
    times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop_length)
    active = rms > threshold

    ranges: list[tuple[float, float]] = []
    start = None
    for t, is_active in zip(times, active):
        t = float(t)
        if is_active and start is None:
            start = t
        elif not is_active and start is not None:
            if t - start >= min_duration:
                ranges.append((start, t))
            start = None
    if start is not None and float(times[-1]) - start >= min_duration:
        ranges.append((start, float(times[-1])))

    merged: list[tuple[float, float]] = []
    for s, e in ranges:
        if merged and s - merged[-1][1] <= merge_gap:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e))
        else:
            merged.append((s, e))
    return [{"start": round(s, 3), "end": round(e, 3)} for s, e in merged]


def lyrics_prompt(lyrics_file: str) -> str:
    # the sung text only: no [Section] tags, no (performance notes), every line once
    lines: list[str] = []
    for raw in Path(lyrics_file).read_text(encoding="utf-8").splitlines():
        line = re.sub(r"\([^)]*\)", "", raw).strip()
        if line and not re.fullmatch(r"\[.*]", line) and line not in lines:
            lines.append(line)
    return "\n".join(lines)


def transcribe(vocals: str, language: str, lyrics_file: str):
    import whisper

    model = whisper.load_model("large-v3", device=device)
    log(f"whisper large-v3 on {device}")
    options = dict(
        language=language,
        # word-level timing comes from whisper's DTW cross-attention alignment, which needs Triton kernels -
        # unavailable on Windows without extra setup, and unreliably slow (JIT recompiles, CPU fallback) on very
        # new GPUs. Segment-level timing is plenty: growled/screamed vocals rarely get confident per-word matches
        # anyway, and unmatched words are already interpolated further down the pipeline (lib/lyrics.ts)
        word_timestamps=False,
        condition_on_previous_text=False,
        initial_prompt=lyrics_prompt(lyrics_file) or None,
        hallucination_silence_threshold=2.0,
        # harsh/screamed vocals often don't score as "speech" to whisper's no-speech gate, so it silently skips
        # the whole segment instead of transcribing it - raised (default 0.6) so it still attempts a transcript;
        # logprob/compression_ratio then catch genuinely bad decodes instead (values from a prior project's tuning
        # for the same problem - stricter than whisper's defaults, guards against repeat-loop hallucinations like
        # "no honor in fire no honor in fire ..." on hard-to-parse screamed vocals)
        no_speech_threshold=0.75,
        logprob_threshold=-0.5,
        compression_ratio_threshold=2.0,
        temperature=0,
        fp16=device == "cuda",
        verbose=False,  # False (not None) shows whisper's own tqdm progress bar on stderr, without a full transcript dump
    )
    # newer whisper versions can keep the prompt for every 30 s window, not only the first
    if "carry_initial_prompt" in inspect.signature(whisper.transcribe).parameters:
        options["carry_initial_prompt"] = True
    result = model.transcribe(whisper.load_audio(vocals), **options)
    del model
    unload()

    # no per-word timing from whisper (word_timestamps=False) - spread each segment's words evenly across it,
    # the same way lib/lyrics.ts interpolates words it can't match to the transcript
    words = []
    for segment in result["segments"]:
        text_words = segment["text"].split()
        if not text_words:
            continue
        start, end = float(segment["start"]), float(segment["end"])
        step = (end - start) / len(text_words)
        probability = round(math.exp(float(segment.get("avg_logprob", 0.0))), 3)
        words.extend({
            "text": w,
            "start": round(start + i * step, 3),
            "end": round(start + (i + 1) * step, 3),
            "probability": probability,
        } for i, w in enumerate(text_words))
    log(f"{len(words)} words")
    activity = vocal_activity(vocals)
    log(f"{len(activity)} vocal-activity range(s) from RMS energy")
    print(json.dumps({"words": words, "activity": activity}))


if __name__ == "__main__":
    command, *args = sys.argv[1:]
    if command == "separate" and len(args) == 2:
        separate(*args)
    elif command == "transcribe" and len(args) == 3:
        transcribe(*args)
    else:
        sys.exit(__doc__)
