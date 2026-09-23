# /// script
# requires-python = ">=3.11,<3.13"
# dependencies = ["torch>=2.7", "torchaudio>=2.7", "demucs>=4.0.1", "openai-whisper>=20250625", "soundfile", "numpy"]
#
# [tool.uv.sources]
# torch = { index = "pytorch-cu128" }
# torchaudio = { index = "pytorch-cu128" }
#
# [[tool.uv.index]]
# name = "pytorch-cu128"
# url = "https://download.pytorch.org/whl/cu128"
# explicit = true
# ///
"""Stem separation and vocal transcription for the lyrics alignment.

usage: uv run tools/vocals.py separate <song.wav> <stems-dir>
       uv run tools/vocals.py transcribe <vocals.wav> <language> <lyrics.txt>

separate    demucs htdemucs_6s -> <stems-dir>/{vocals,drums,bass,guitar,piano,other}.wav
transcribe  Whisper large-v3 with word timestamps, the known lyrics as prompt.
            Prints {"words": [{"text", "start", "end", "probability"}]} as JSON to stdout.

Runs on CUDA if available (PyTorch cu128 wheels, needed for RTX 50xx), else on the CPU.
The models are downloaded on first use: demucs ~80 MB, whisper large-v3 ~3 GB.
Progress goes to stderr, stdout only carries the result.
"""
import gc
import inspect
import json
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

    model = get_model("htdemucs_6s")
    model.to(device).eval()
    log(f"demucs htdemucs_6s on {device}")

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
    with torch.no_grad():
        sources = apply_model(model, ((wav - mean) / std)[None], device=device, shifts=1, split=True, overlap=0.25, progress=True)[0]
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
        word_timestamps=True,
        condition_on_previous_text=False,
        initial_prompt=lyrics_prompt(lyrics_file) or None,
        hallucination_silence_threshold=2.0,
        fp16=device == "cuda",
        verbose=None,
    )
    # newer whisper versions can keep the prompt for every 30 s window, not only the first
    if "carry_initial_prompt" in inspect.signature(whisper.transcribe).parameters:
        options["carry_initial_prompt"] = True
    result = model.transcribe(whisper.load_audio(vocals), **options)
    del model
    unload()

    words = [
        {"text": w["word"].strip(), "start": round(float(w["start"]), 3), "end": round(float(w["end"]), 3), "probability": round(float(w["probability"]), 3)}
        for segment in result["segments"]
        for w in segment.get("words", [])
        if w["word"].strip()
    ]
    log(f"{len(words)} words")
    print(json.dumps({"words": words}))


if __name__ == "__main__":
    command, *args = sys.argv[1:]
    if command == "separate" and len(args) == 2:
        separate(*args)
    elif command == "transcribe" and len(args) == 3:
        transcribe(*args)
    else:
        sys.exit(__doc__)
