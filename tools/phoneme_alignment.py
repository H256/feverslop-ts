"""Shared CTC alignment primitives for vocal timing."""
import math

MODEL = 'facebook/wav2vec2-lv-60-espeak-cv-ft'


def ctc_path(scores, tokens, blank):
    """Viterbi through blank-interleaved targets; preserve repeated token positions."""
    if not tokens or len(scores) < len(tokens) + sum(a == b for a, b in zip(tokens, tokens[1:])):
        raise ValueError('Not enough acoustic frames for target sequence')
    states = [blank]
    for token in tokens:
        states.extend([token, blank])
    prev = [-math.inf] * len(states)
    prev[0], prev[1] = float(scores[0][blank]), float(scores[0][tokens[0]])
    history = [bytearray(len(states))]
    for frame in scores[1:]:
        now, moves = [], bytearray(len(states))
        for s, token in enumerate(states):
            best, step = prev[s], 0
            if s and prev[s - 1] > best:
                best, step = prev[s - 1], 1
            if s > 1 and token != blank and token != states[s - 2] and prev[s - 2] > best:
                best, step = prev[s - 2], 2
            now.append(best + float(frame[token]))
            moves[s] = step
        history.append(moves)
        prev = now
    state = len(states) - (1 if prev[-1] >= prev[-2] else 2)
    if not math.isfinite(prev[state]):
        raise ValueError('No valid acoustic alignment')
    spans = [[None, None] for _ in tokens]
    for t in range(len(scores) - 1, -1, -1):
        if state % 2:
            span = spans[state // 2]
            span[0] = t
            if span[1] is None:
                span[1] = t + 1
        state -= history[t][state]
    return [tuple(span) for span in spans]


def fill_short_gaps(phones, max_gap=.30):
    """Experimental redistribution, not acoustic evidence; raw spans are retained."""
    for left, right in zip(phones, phones[1:]):
        gap = right['start'] - left['end']
        if 0 < gap <= max_gap:
            boundary = left['end'] + .4 * gap
            left['end'] = right['start'] = boundary


