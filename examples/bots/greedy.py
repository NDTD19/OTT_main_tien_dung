"""OTT bot protocol v1. One JSON input per turn; one JSON move output.
Use flush=True and do not print debug messages to stdout.
"""
import json
import sys


def choose(obs):
    moves = obs.get('moves', [])
    owner = obs.get('owner', 'p1')
    goal = (0, 7) if owner == 'p1' else (7, 0)
    if not moves:
        return {'type': 'pass'}

    def score(m):
        r, c = m['to']
        distance = max(abs(r - goal[0]), abs(c - goal[1]))
        return (1000 if distance == 0 else 0) + (50 if m.get('capture') else 0) - 3 * distance

    best = max(moves, key=score)
    return {'from': best['from'], 'to': best['to']}


for line in sys.stdin:
    try:
        print(json.dumps(choose(json.loads(line))), flush=True)
    except Exception as exc:
        print(json.dumps({'type': 'pass'}), flush=True)
        print('Bot error:', exc, file=sys.stderr)
