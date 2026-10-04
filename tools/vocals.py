# /// script
# requires-python = ">=3.11,<3.13"
# dependencies = ["torch>=2.14", "torchaudio>=2.11", "demucs>=4.0.1", "faster-whisper>=1.0", "soundfile", "numpy", "librosa>=0.10", "nvidia-cublas-cu12; sys_platform == 'linux'", "nvidia-cudnn-cu12; sys_platform == 'linux'"]
#
# [tool.uv.sources]
# # the CUDA 13.0 wheels only exist for Linux and Windows - macOS takes the regular PyPI build
# torch = [{ index = "pytorch-cu130", marker = "sys_platform != 'darwin'" }]
# torchaudio = [{ index = "pytorch-cu130", marker = "sys_platform != 'darwin'" }]
#
# [[tool.uv.index]]
# name = "pytorch-cu130"
# url = "https://download.pytorch.org/whl/cu130"
# explicit = true
# ///
"""Stem separation and vocal transcription for the lyrics alignment.

usage: uv run tools/vocals.py separate <song.wav> <stems-dir> [model] [only...]
       uv run tools/vocals.py transcribe <vocals.wav> <language> <lyrics.txt>
       uv run tools/vocals.py activity <stem.wav>
       uv run tools/vocals.py draft <vocals.wav> <language>

separate    [model] defaults to htdemucs_ft -> <stems-dir>/{vocals,drums,bass,other}.wav
            htdemucs_ft (the fine-tuned 4-source bag of models) gives the cleanest vocal separation of the
            demucs family - instrument bleed (e.g. guitar leaking into the vocals stem) is more common with
            htdemucs_6s, which spends model capacity splitting out a dedicated guitar/piano stem instead.
            Pass "htdemucs_6s" as [model] with "guitar" and/or "piano" as [only] to separate just those two
            (on top of the htdemucs_ft stems already on disk, never overwriting them) when a character's prop
            needs one - htdemucs_ft's "other" stem is too coarse (every non-drum/bass/vocal instrument at
            once) to time a guitar's or piano's own entry against.
transcribe  faster-whisper (CTranslate2) large-v3, the known lyrics as a hotwords hint, word-level timing.
            faster-whisper's "hotwords" (not "initial_prompt") are re-injected into every ~30s window
            regardless of condition_on_previous_text, so the known lyrics keep steering the whole song, not
            just the first window - openai-whisper needed a separate carry_initial_prompt flag for that.
            A segment that comes back without word timings falls back to spreading its words evenly across it,
            matching how the alignment step already interpolates words it can't pin down exactly.
            Stretches where the vocals are active but whisper wrote (almost) nothing get a second pass: the same audio
            cut out and transcribed on its own (whisper can go deaf for half a minute inside a long song).
            Also runs an RMS-energy vocal activity detection on the same audio (independent of whisper) - for
            growled/screamed vocals whisper often transcribes nothing at all, but the alignment step can still
            place interpolated words inside a real detected-activity window instead of guessing blind.
            Prints {"words": [{"text", "start", "end", "probability"}], "activity": [{"start", "end"}]} as JSON.
activity    The same RMS-energy activity detection, run standalone on any stem (e.g. drums.wav, bass.wav,
            other.wav) - used to ground a band member's on-screen instrument use in whether it is actually
            audible at that point in the song, instead of playing continuously through every shot.
            Prints {"activity": [{"start", "end"}]} as JSON.
draft       For a song whose lyrics are lost (e.g. an old AceStep/Suno generation) - unbiased transcription,
            no lyrics file, no hotwords hint, so purely what whisper actually hears. Prints one timestamped
            line per whisper segment to stdout, meant to be read and hand-edited into a proper lyrics.txt
            (merging/splitting lines, adding [Section] tags) - no tool can reliably guess song structure, but
            turning a rough transcript into clean lyrics by ear is quick for a human. Run "separate" first to
            get the vocals stem.

Runs on CUDA if available (PyTorch cu130 wheels - cu128 builds are missing precompiled kernels for RTX 50xx/
Blackwell (sm_120), which forces slow driver-side PTX JIT compilation on every CUDA call), else on the CPU.
The models are downloaded on first use: demucs htdemucs_ft ~320 MB (a bag of four models), whisper large-v3 ~3 GB.
Progress goes to stderr, stdout only carries the result.
"""
import gc
import json
import math
import os
import re
import sys
from pathlib import Path

# huggingface_hub defaults to symlinking its cache, which needs Developer Mode or admin rights on Windows and
# otherwise fails the model download outright (WinError 1314) - copy the files instead. Must be set before
# huggingface_hub (pulled in transitively by faster_whisper) is imported anywhere.
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS", "1")


def preload_cuda12_libs():
    # faster-whisper's CTranslate2 is built against CUDA 12 (libcublas.so.12, libcudnn.so.9), but torch is the cu130
    # build with CUDA 13 libraries - without a system-wide CUDA 12 the loader finds neither. The nvidia-*-cu12 wheels
    # bring them; loading them by path first makes CTranslate2 pick them up. Linux only, Windows ships its own DLLs.
    if not sys.platform.startswith("linux"):
        return
    import ctypes
    import importlib.util
    for package, pattern in (("nvidia.cublas", "libcublas*.so.12"), ("nvidia.cudnn", "libcudnn*.so.9")):
        spec = importlib.util.find_spec(package)
        if not spec or not spec.submodule_search_locations:
            continue
        # cudnn's libraries depend on each other and on cublas - load in an order that resolves, ignore failures
        for lib in sorted(Path(list(spec.submodule_search_locations)[0], "lib").glob(pattern)):
            try:
                ctypes.CDLL(str(lib), mode=ctypes.RTLD_GLOBAL)
            except OSError:
                pass


preload_cuda12_libs()

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


def separate(song: str, stems_dir: str, model_name: str = "htdemucs_ft", only: list[str] | None = None):
    from demucs.apply import apply_model
    from demucs.pretrained import get_model
    from julius import resample_frac

    model = get_model(model_name)
    model.to(device).eval()
    log(f"demucs {model_name} on {device}")

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
        if only and name not in only:
            continue
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


def whisper_words(model, audio, language: str, lyrics_file: str, offset: float = 0.0) -> list[dict]:
    segments, _info = model.transcribe(
        audio,
        language=language,
        # word-level timing, straight from faster-whisper - no Triton dependency, no extra flag needed
        word_timestamps=True,
        condition_on_previous_text=False,
        # hotwords (not initial_prompt) get re-injected into every ~30s window regardless of
        # condition_on_previous_text - the known lyrics keep steering transcription through the whole song
        hotwords=lyrics_prompt(lyrics_file) or None,
        hallucination_silence_threshold=2.0,
        # harsh/screamed vocals often don't score as "speech" to whisper's no-speech gate, so it silently skips
        # the whole segment instead of transcribing it - raised (default 0.6) so it still attempts a transcript;
        # logprob/compression_ratio then catch genuinely bad decodes instead (values from a prior project's tuning
        # for the same problem - stricter than whisper's defaults, guards against repeat-loop hallucinations like
        # "no honor in fire no honor in fire ..." on hard-to-parse screamed vocals)
        no_speech_threshold=0.75,
        log_prob_threshold=-0.5,
        compression_ratio_threshold=2.0,
        # left at faster-whisper's own default (a temperature fallback ladder, not a fixed value) - pinning
        # this to 0 disables that ladder, so a bad/looping greedy decode (e.g. "the silence of hell" repeated
        # ~15x) never gets retried at a higher temperature the way whisper normally would recover from it
    )

    # per-word timing from faster-whisper - falls back to spreading a segment's words evenly across it (same as
    # lib/lyrics.ts interpolates words it can't match) only if that segment came back without one
    words = []
    for segment in segments:
        segment_words = segment.words or []
        if segment_words:
            words.extend({
                "text": w.word.strip(),
                "start": round(w.start + offset, 3),
                "end": round(w.end + offset, 3),
                "probability": round(w.probability, 3),
            } for w in segment_words if w.word.strip())
            continue
        text_words = segment.text.split()
        if not text_words:
            continue
        start, end = segment.start, segment.end
        step = (end - start) / len(text_words)
        probability = round(math.exp(segment.avg_logprob), 3)
        words.extend({
            "text": w,
            "start": round(offset + start + i * step, 3),
            "end": round(offset + start + (i + 1) * step, 3),
            "probability": probability,
        } for i, w in enumerate(text_words))
    return words


def deaf_windows(words: list[dict], activity: list[dict], *, min_active=4.0, join_gap=3.0, pad=1.5, max_window=60.0) -> list[tuple[float, float]]:
    """Stretches where the vocals stem is clearly active but whisper wrote nothing. Over a whole song whisper sometimes
    goes deaf for half a minute (a chorus it transcribed fine in a short excerpt) - the same audio cut out and
    transcribed on its own is heard, so these stretches get a second pass: every gap between two words that
    holds at least `min_active` seconds of vocal activity."""
    ordered = sorted(words, key=lambda w: w["start"])
    found: list[list[float]] = []
    for gap_start, gap_end in zip([0.0] + [w["end"] for w in ordered], [w["start"] for w in ordered] + [float("inf")]):
        inside = [(max(r["start"], gap_start), min(r["end"], gap_end)) for r in activity if r["end"] > gap_start and r["start"] < gap_end]
        inside = [(a, b) for a, b in inside if b > a]
        if sum(b - a for a, b in inside) >= min_active:
            found.append([min(a for a, _ in inside), max(b for _, b in inside)])
    merged: list[list[float]] = []
    for start, end in found:
        if merged and start - merged[-1][1] <= join_gap:
            merged[-1][1] = end
        else:
            merged.append([start, end])
    windows = []
    for start, end in merged:
        start, end = max(0.0, start - pad), end + pad
        while end - start > max_window:
            windows.append((start, start + max_window))
            start += max_window
        windows.append((start, end))
    return windows


def fill_deaf_windows(model, vocals: str, words: list[dict], activity: list[dict], language: str, lyrics_file: str) -> list[dict]:
    windows = deaf_windows(words, activity)
    if not windows:
        return words
    data, sr = sf.read(vocals, dtype="float32", always_2d=True)
    for start, end in windows:
        log(f"second pass on {start:.1f}-{end:.1f}s: vocals are active, whisper heard (almost) nothing there")
        chunk = data[int(start * sr):int(end * sr)]
        tmp = Path(vocals).with_name(f"_deaf_{int(start)}.wav")
        sf.write(tmp, chunk, sr)
        try:
            found = whisper_words(model, str(tmp), language, lyrics_file, offset=start)
        finally:
            tmp.unlink(missing_ok=True)
        log(f"  {len(found)} word(s)")
        if found:
            # the new words replace whatever the first pass wrote in that window (usually a single hallucinated word)
            words = [w for w in words if not (start <= w["start"] < end)] + found
    return sorted(words, key=lambda w: w["start"])


def transcribe(vocals: str, language: str, lyrics_file: str):
    from faster_whisper import WhisperModel

    model = WhisperModel("large-v3", device=device, compute_type="float16" if device == "cuda" else "int8")
    log(f"faster-whisper large-v3 on {device}")
    words = whisper_words(model, vocals, language, lyrics_file)
    activity = vocal_activity(vocals)
    words = fill_deaf_windows(model, vocals, words, activity, language, lyrics_file)
    del model
    unload()
    log(f"{len(words)} words")
    log(f"{len(activity)} vocal-activity range(s) from RMS energy")
    print(json.dumps({"words": words, "activity": activity}))


def format_time(seconds: float) -> str:
    m, s = divmod(round(seconds), 60)
    return f"{m}:{s:02d}"


def draft(vocals: str, language: str):
    from faster_whisper import WhisperModel

    model = WhisperModel("large-v3", device=device, compute_type="float16" if device == "cuda" else "int8")
    log(f"faster-whisper large-v3 on {device}")
    # no lyrics file, no hotwords - nothing to bias the decode towards, just whatever whisper actually hears
    segments, _info = model.transcribe(
        vocals,
        language=language,
        condition_on_previous_text=False,
        hallucination_silence_threshold=2.0,
        no_speech_threshold=0.75,
        log_prob_threshold=-0.5,
        compression_ratio_threshold=2.0,
    )
    n = 0
    for segment in segments:
        text = segment.text.strip()
        if text:
            n += 1
            print(f"[{format_time(segment.start)}] {text}")
    del model
    unload()
    log(f"{n} line(s) - silent/unintelligible stretches (screams, growls, instrumentals) print nothing")


if __name__ == "__main__":
    command, *args = sys.argv[1:]
    if command == "separate" and len(args) >= 2:
        separate(args[0], args[1], args[2] if len(args) > 2 else "htdemucs_ft", args[3:] or None)
    elif command == "transcribe" and len(args) == 3:
        transcribe(*args)
    elif command == "activity" and len(args) == 1:
        print(json.dumps({"activity": vocal_activity(*args)}))
    elif command == "draft" and len(args) == 2:
        draft(*args)
    else:
        sys.exit(__doc__)
