"""Experimental IPA CTC alignment; reads comparison excerpts, never source projects."""
import argparse
import copy
import importlib.metadata
import math
from pathlib import Path
import time
from alignment_compare import read, write, map_words, compare

from phoneme_alignment import ctc_path, fill_short_gaps, MODEL


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('experiment', type=Path)
    args = parser.parse_args()
    folder = args.experiment.resolve()
    if any((folder / name).exists() for name in ('ipa.json', 'ipa-raw.json')):
        raise ValueError('IPA results already exist; use a fresh experiment')
    manifest = read(folder / 'manifest.json')
    language = {'de': 'de', 'en': 'en-us', 'fr': 'fr-fr'}[manifest['language']]
    started = time.monotonic()
    import espeakng_loader
    from phonemizer.backend.espeak.wrapper import EspeakWrapper
    EspeakWrapper.set_library(espeakng_loader.get_library_path())
    EspeakWrapper.set_data_path(espeakng_loader.get_data_path())
    from phonemizer import phonemize
    from phonemizer.separator import Separator
    language_probe = {code: phonemize(text, language=code, backend='espeak', strip=True,
                                      separator=Separator(phone=' ', word=' | '), with_stress=False)
                      for code, text in [('de', 'Ich singe im Licht'), ('en-us', 'I sing in the light'),
                                         ('fr-fr', 'Je chante dans la nuit')]}
    # Whole-line G2P retains pronunciation context; reject changes in word count.
    sentences = [line['text'] for line in manifest['lines']]
    transcriptions = phonemize(sentences, language=language, backend='espeak', strip=True,
                              separator=Separator(phone=' ', word=' | '), with_stress=False,
                              preserve_punctuation=False, language_switch='remove-flags')
    import torch
    import soundfile as sf
    from transformers import AutoModelForCTC, AutoProcessor
    processor = AutoProcessor.from_pretrained(MODEL)
    model = AutoModelForCTC.from_pretrained(MODEL).eval()
    vocab = processor.tokenizer.get_vocab()
    words, phones, tokens = [], [], []
    for line, transcription in zip(manifest['lines'], transcriptions):
        groups = [p.strip() for p in transcription.split('|') if p.strip()]
        texts = line['text'].split()
        if len(groups) != len(texts):
            raise ValueError(f'G2P word count changed for line {line["line"]}: {transcription}')
        for text, group in zip(texts, groups):
            word_id = len(words)
            words.append(text)
            for phone in group.split():
                if phone not in vocab:
                    raise ValueError(f'Unsupported IPA symbol {phone!r} in {text!r}; no silent substitution')
                tokens.append(vocab[phone])
                phones.append({'ipa': phone, 'word': word_id})
    audio, rate = sf.read(folder / 'audio.wav', dtype='float32')
    if rate != 16000 or audio.ndim != 1:
        raise ValueError('Expected the prepared mono 16 kHz excerpt')
    inputs = processor(audio, sampling_rate=rate, return_tensors='pt').input_values
    print(f'Aligning {len(words)} words / {len(tokens)} phones on CPU', flush=True)
    with torch.inference_mode():
        emissions = model(inputs).logits[0].log_softmax(-1).numpy()
    spans = ctc_path(emissions, tokens, processor.tokenizer.pad_token_id)
    # Model convolution stride is 320 samples (20 ms); do not stretch frames to clip duration.
    hop = math.prod(model.config.conv_stride) / rate
    for phone, token, (start, end) in zip(phones, tokens, spans):
        phone.update(start=start * hop, end=end * hop,
                     acoustic_score=float(emissions[start:end, token].mean()))
    raw = copy.deepcopy(phones)
    fill_short_gaps(phones)
    for name, sequence in [('ipa-raw', raw), ('ipa', phones)]:
        aligned_words = []
        for i, word in enumerate(words):
            own = [p for p in sequence if p['word'] == i]
            aligned_words.append({'text': word, 'start': own[0]['start'], 'end': own[-1]['end']})
        lines = map_words(manifest['lines'], aligned_words, manifest['offset'])
        write(folder / (name + '.json'), {
            'backend': name, 'model': MODEL, 'model_revision': model.config._commit_hash,
            'package_version': importlib.metadata.version('transformers'),
            'versions': {p: importlib.metadata.version(p) for p in ('torch', 'phonemizer', 'espeakng-loader')},
            'language': language, 'elapsed_sec': time.monotonic() - started,
            'language_probe': language_probe,
            'phones': sequence, 'raw_words': aligned_words, 'lines': lines,
            'comparison': compare(manifest['lines'], lines, []),
            'warning': 'CTC forces all target phones. Scores are not calibrated confidence or omission detection. '
                       'ipa uses heuristic gap redistribution; ipa-raw does not. No SOFA or singing fine-tuning.'})
    print(folder / 'ipa.json')


if __name__ == '__main__':
    main()
