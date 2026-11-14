"""Read-only lyrics alignment experiment. See docs/alignment-comparison.md."""
import argparse
import difflib
import hashlib
import html
import importlib.metadata
import json
import math
from pathlib import Path
import re
import statistics
import subprocess
import time


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write(path, value):
    # Never overwrite a result, manifest, or project file.
    with Path(path).open("x", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)


def norm(text):
    return re.sub(r"[^\w]", "", text.casefold())


def map_words(lines, words, offset):
    expected = [w for line in lines for w in line["text"].split()]
    matcher = difflib.SequenceMatcher(None, list(map(norm, expected)),
                                     [norm(w["text"]) for w in words], autojunk=False)
    mapped = {}
    for block in matcher.get_matching_blocks():
        for i in range(block.size):
            word = words[block.b + i]
            start, end = word.get("start"), word.get("end")
            if (isinstance(start, (int, float)) and isinstance(end, (int, float))
                    and math.isfinite(start) and math.isfinite(end) and 0 <= start < end):
                mapped[block.a + i] = {"start": round(start + offset, 4),
                                       "end": round(end + offset, 4)}
    result, cursor = [], 0
    for line in lines:
        placed = []
        for word in line["text"].split():
            placed.append({"text": word, **mapped.get(cursor, {"start": None, "end": None})})
            cursor += 1
        timed = [w for w in placed if w["start"] is not None]
        result.append({"line": line["line"], "text": line["text"], "words": placed,
                       "start": placed[0]["start"] if placed else None,
                       "end": placed[-1]["end"] if placed else None,
                       "complete": len(timed) == len(placed)})
    return result


def compare(baseline, candidate, references):
    by_id = {l["line"]: l for l in candidate}
    changes = []
    for line in baseline:
        other = by_id.get(line["line"], {})
        changes.append({"line": line["line"], "text": line.get("text"), **{
            key + "_delta": round(other[key] - line[key], 4)
            if other.get(key) is not None and line.get(key) is not None else None
            for key in ("start", "end")}})
    errors = []
    missing = 0
    for line in references:
        other = by_id.get(line["line"], {})
        for key in ("start", "end"):
            if line.get(key) is None:
                continue
            if other.get(key) is None:
                missing += 1
            else:
                errors.append(abs(other[key] - line[key]))
    total = len(errors) + missing
    accuracy = None if not total else {
        "measured_boundaries": len(errors), "missing_boundaries": missing,
        "median_error_sec": statistics.median(errors) if errors else None,
        "max_error_sec": max(errors) if errors else None,
        "within": {str(t): sum(e <= t for e in errors) / total for t in (.05, .1, .2)}}
    return {"changes": changes, "accuracy": accuracy}


def prepare(args):
    project = args.project.resolve()
    output = args.output.resolve()
    if output == project or project in output.parents:
        raise ValueError("Experiment output must be outside the source project")
    if not 0 <= args.start < args.end or args.end - args.start > 300:
        raise ValueError("Window must be positive and at most 300 seconds")
    raw = (project / "project.json").read_bytes()
    data = json.loads(raw)
    selected = set(int(x) for x in args.lines.split(","))
    lines = [l for l in data["lyricsTiming"]["lines"] if l["line"] in selected]
    if len(lines) != len(selected):
        raise ValueError("Unknown or duplicate line IDs")
    audio = (project / data["stems"]["vocals"]).resolve()
    if project not in audio.parents:
        raise ValueError("Vocal stem must be inside the source project")
    output.mkdir(parents=True, exist_ok=False)
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-n", "-i", str(audio),
                    "-ss", str(args.start), "-t", str(args.end - args.start),
                    "-ar", "16000", "-ac", "1", str(output / "audio.wav")], check=True)
    write(output / "manifest.json", {"project": str(project), "project_sha256": hashlib.sha256(raw).hexdigest(),
          "offset": args.start, "duration": args.end - args.start, "language": args.language,
          "lines": lines, "warning": "Baseline is not ground truth; forced alignment does not prove a lyric was sung."})
    print(output / "manifest.json")


def run(args):
    folder = args.experiment.resolve()
    manifest = read(folder / "manifest.json")
    target = folder / (args.backend + ".json")
    if target.exists():
        raise ValueError(f"Result already exists: {target}")
    text = " ".join(l["text"] for l in manifest["lines"])
    started = time.monotonic()
    if args.backend == "whisperx":
        import whisperx
        model, metadata = whisperx.load_align_model(language_code=manifest["language"], device=args.device)
        audio = whisperx.load_audio(str(folder / "audio.wav"))
        result = whisperx.align([{"start": 0, "end": len(audio) / 16000, "text": text}],
                                model, metadata, audio, args.device, return_char_alignments=False)
        words = [{**w, "text": w["word"]} for w in result["word_segments"]]
        model_name = metadata.get("language")
        package = "whisperx"
    else:
        import torch
        from qwen_asr import Qwen3ForcedAligner
        model_name = "Qwen/Qwen3-ForcedAligner-0.6B"
        model = Qwen3ForcedAligner.from_pretrained(model_name, device_map=args.device,
                  dtype=torch.float32 if args.device == "cpu" else torch.bfloat16)
        languages = {"de": "German", "en": "English"}
        result = model.align(audio=str(folder / "audio.wav"), text=text,
                             language=languages.get(manifest["language"], manifest["language"]))
        words = [{"text": w.text, "start": w.start_time, "end": w.end_time} for w in result[0]]
        package = "qwen-asr"
    lines = map_words(manifest["lines"], words, manifest["offset"])
    write(target, {"backend": args.backend, "package_version": importlib.metadata.version(package),
                  "model": model_name, "elapsed_sec": time.monotonic() - started,
                  "raw_words": words, "lines": lines,
                  "comparison": compare(manifest["lines"], lines, [])})
    print(target)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    prep = commands.add_parser("prepare")
    prep.add_argument("project", type=Path)
    prep.add_argument("output", type=Path)
    prep.add_argument("--lines", required=True, help="Comma-separated zero-based line IDs")
    prep.add_argument("--start", type=float, required=True)
    prep.add_argument("--end", type=float, required=True)
    prep.add_argument("--language", default="de")
    align = commands.add_parser("run")
    align.add_argument("experiment", type=Path)
    align.add_argument("--backend", choices=["whisperx", "qwen"], required=True)
    align.add_argument("--device", default="cpu", choices=["cpu", "cuda"])
    report = commands.add_parser("report")
    report.add_argument("experiment", type=Path)
    report.add_argument("--reference", type=Path, help="JSON array of manually confirmed line/start/end values")
    report.add_argument("--html", action="store_true", help="Write a separate listening comparison")
    report.add_argument("--html-name", default="review.html", choices=["review.html", "review-ipa.html"])
    args = parser.parse_args()
    if args.command == "prepare":
        prepare(args)
    elif args.command == "run":
        run(args)
    else:
        manifest = read(args.experiment / "manifest.json")
        references = read(args.reference) if args.reference else []
        results = {"baseline": compare(manifest["lines"], manifest["lines"], references)}
        variants = {"baseline": manifest["lines"]}
        for backend in ("whisperx", "qwen", "ipa-raw", "ipa"):
            file = args.experiment / (backend + ".json")
            if file.exists():
                variants[backend] = read(file)["lines"]
                results[backend] = compare(manifest["lines"], variants[backend], references)
        if args.html:
            rows = []
            for line in manifest["lines"]:
                cells = [f'<th>{html.escape(line["text"])}</th>']
                for name, lines in variants.items():
                    found = next(l for l in lines if l["line"] == line["line"])
                    start, end = found.get("start"), found.get("end")
                    if start is None or end is None:
                        cells.append('<td>Keine vollständigen Grenzen</td>')
                    else:
                        a, b = start - manifest["offset"], end - manifest["offset"]
                        cells.append(f'<td>{start:.3f} – {end:.3f} s<br>'
                                     f'<button onclick="play({a},{b})">Grenzen hören</button>'
                                     f'<button onclick="play({max(0,a-.6)},{min(manifest["duration"],b+.6)})">Mit Kontext</button></td>')
                rows.append('<tr>' + ''.join(cells) + '</tr>')
            page = '''<!doctype html><meta charset="utf-8"><title>Lyrics-Hörvergleich</title>
<style>body{font:16px system-ui;background:#121519;color:#eee;margin:32px}table{border-collapse:collapse;width:100%}th,td{padding:16px;border:1px solid #555;text-align:left}button{padding:8px;margin:6px 6px 0 0}audio{width:100%;margin:20px 0}</style>
<h1>Lyrics-Hörvergleich</h1><p>Alle Zeiten sind absolute Songzeiten. Baseline ist der gespeicherte Stand, keine bestätigte Referenz. Kein Ergebnis wird ins Projekt übernommen.</p>
<p>„Grenzen hören“ stoppt am vorgeschlagenen Ende. „Mit Kontext“ spielt zusätzlich 0,6 Sekunden davor und danach. Bei unvollständigen oder nicht gesungenen Lyrics ist ein gefülltes Zeitfenster kein Nachweis.</p>
<audio id="audio" controls src="audio.wav"></audio><table><tr><th>Zeile</th>'''
            page += ''.join('<th>' + html.escape(k) + '</th>' for k in variants) + '</tr>' + ''.join(rows) + '</table>'
            page += '''<script>const audio=document.getElementById('audio');let stop=null;
function play(a,b){audio.currentTime=Math.max(0,a);stop=b;audio.play();}
audio.addEventListener('timeupdate',()=>{if(stop!==null&&audio.currentTime>=stop){audio.pause();stop=null;}});
</script>'''
            with (args.experiment / args.html_name).open("x", encoding="utf-8") as stream:
                stream.write(page)
        print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
