"""Batch IPA refinement on bounded vocal excerpts. Reads input, writes candidates only."""
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
from phoneme_alignment import ctc_path, fill_short_gaps, MODEL

REVISION = 'ae45363bf3413b374fecd9dc8bc1df0e24c3b7f4'


def phone_tokens(phone, vocab):
    """Preserve native tokens; only split the explicitly evaluated IPA composite."""
    if phone in vocab:
        return [vocab[phone]]
    parts = {'ʊɐ': ('ʊ', 'ɐ')}.get(phone)
    if parts and all(part in vocab for part in parts):
        return [vocab[part] for part in parts]
    raise ValueError(f'Unsupported IPA symbol {phone!r}; original timing retained')


def word_phones(words, speak):
    groups = [p.strip().split() for p in speak([' '.join(words)])[0].split('|') if p.strip()]
    if len(groups) != len(words):
        # eSpeak can join English function words. Preserve identity by pronouncing
        # each source word separately in this case (less coarticulation context).
        groups = [p.replace('|', ' ').split() for p in speak(words)]
    if len(groups) != len(words) or any(not p for p in groups):
        raise ValueError('Cannot preserve the lyric words in phoneme conversion')
    return groups


def windows(lines, duration):
    result = []
    i = 0
    while i < len(lines):
        j = i + 1
        while j < len(lines) and j - i < 3 and lines[j]['end'] - lines[i]['start'] <= 23 and lines[j]['start'] - lines[j - 1]['end'] < 5:
            j += 1
        core = lines[i:j]
        context = list(core)
        if i and core[-1]['end'] - lines[i - 1]['start'] <= 23 and core[0]['start'] - lines[i - 1]['end'] < 5:
            context.insert(0, lines[i - 1])
        if j < len(lines) and lines[j]['end'] - context[0]['start'] <= 23 and lines[j]['start'] - core[-1]['end'] < 5:
            context.append(lines[j])
        start = max(0, context[0]['start'] - 2)
        end = min(duration, context[-1]['end'] + 3, start + 30)
        result.append({'start': start, 'end': end, 'lines': context, 'targets': [l['line'] for l in core]})
        i = j
    return result


def alignment_windows(request):
    if 'window' not in request:
        return windows(request['lines'], request['duration'])
    window = request['window']
    start, end = window.get('start'), window.get('end')
    finite = lambda n: type(n) in (int, float) and math.isfinite(n)
    if not all(finite(n) for n in (start, end, request['duration'])) or not 0 <= start < end <= request['duration'] or end - start > 30:
        raise ValueError('Passage must fit within 30 seconds of the audio')
    ids = [line['line'] for line in request['lines']]
    targets = window.get('targets')
    if (len(ids) != len(set(ids)) or not isinstance(targets, list) or not targets
            or any(type(n) is not int or n not in ids for n in targets)
            or len(targets) != len(set(targets))):
        raise ValueError('Passage targets must be unique lines within its context')
    return [{'start': start, 'end': end, 'targets': targets, 'lines': request['lines']}]


def main():
    source, destination = map(Path, sys.argv[1:])
    request = json.loads(source.read_text(encoding='utf-8'))
    chunks = alignment_windows(request)
    language = {'de': 'de', 'en': 'en-us', 'fr': 'fr-fr'}[request['language']]
    import espeakng_loader
    from phonemizer.backend.espeak.wrapper import EspeakWrapper
    EspeakWrapper.set_library(espeakng_loader.get_library_path())
    EspeakWrapper.set_data_path(espeakng_loader.get_data_path())
    from phonemizer import phonemize
    from phonemizer.separator import Separator
    def speak(texts):
        return phonemize(texts, language=language, backend='espeak', strip=True,
                         separator=Separator(phone=' ', word=' | '), with_stress=False,
                         preserve_punctuation=False, language_switch='remove-flags')
    import torch
    import soundfile as sf
    from transformers import AutoModelForCTC, AutoProcessor
    processor = AutoProcessor.from_pretrained(MODEL, revision=REVISION)
    model = AutoModelForCTC.from_pretrained(MODEL, revision=REVISION).eval()
    vocab = processor.tokenizer.get_vocab()
    results = []
    with tempfile.TemporaryDirectory(prefix='lyrics-refine-') as temp:
        audiofile = str(Path(temp) / 'vocals.wav')
        for index, chunk in enumerate(chunks):
            print(f'Phoneme alignment {index + 1}/{len(chunks)}', file=sys.stderr, flush=True)
            try:
                subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(chunk['start']), '-i', request['audio'], '-t', str(chunk['end'] - chunk['start']), '-ac', '1', '-ar', '16000', audiofile], check=True, capture_output=True)
                audio, rate = sf.read(audiofile, dtype='float32')
                words, phones, tokens = [], [], []
                for line in chunk['lines']:
                    texts = [w['text'] for w in line['words']]
                    for text, group in zip(texts, word_phones(texts, speak)):
                        word_id = len(words)
                        words.append({'line': line['line'], 'text': text})
                        for phone in group:
                            for token in phone_tokens(phone, vocab):
                                phones.append({'word': word_id})
                                tokens.append(token)
                inputs = processor(audio, sampling_rate=rate, return_tensors='pt').input_values
                with torch.inference_mode():
                    scores = model(inputs).logits[0].log_softmax(-1).numpy()
                spans = ctc_path(scores, tokens, processor.tokenizer.pad_token_id)
                hop = math.prod(model.config.conv_stride) / rate
                for phone, (start, end) in zip(phones, spans):
                    phone.update(start=start * hop + chunk['start'], end=end * hop + chunk['start'])
                fill_short_gaps(phones)
                for word_id, word in enumerate(words):
                    own = [p for p in phones if p['word'] == word_id]
                    word.update(start=own[0]['start'], end=own[-1]['end'])
                for line_id in chunk['targets']:
                    own = [{k: w[k] for k in ('text', 'start', 'end')} for w in words if w['line'] == line_id]
                    if not own or own[0]['start'] <= chunk['start'] + .04 or own[-1]['end'] >= chunk['end'] - .06:
                        results.append({'line': line_id, 'error': 'Alignment touches excerpt boundary; needs a wider or corrected coarse alignment.'})
                    else:
                        results.append({'line': line_id, 'words': own})
            except (ValueError, RuntimeError, subprocess.CalledProcessError) as error:
                results.extend({'line': line_id, 'error': str(error)} for line_id in chunk['targets'])
    destination.write_text(json.dumps({'model': MODEL, 'revision': REVISION, 'lines': results}, ensure_ascii=False, allow_nan=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
