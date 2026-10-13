import json
import random
import sys

for line in sys.stdin:
    try:
        observation = json.loads(line)
        choices = observation.get('moves', [])
        choice = random.choice(choices) if choices else {'type': 'pass'}
        print(json.dumps({'from': choice['from'], 'to': choice['to']} if choices else choice), flush=True)
    except Exception as exc:
        print('Error: ', exc, file=sys.stderr)
        print('{}', flush=True)
