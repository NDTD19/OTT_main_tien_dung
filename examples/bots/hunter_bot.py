
import json
import sys
import random

BEATS = {
    "rock": "scissors",
    "paper": "rock",
    "scissors": "paper"
}

VISITS = {}

def distance(a, b):
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]))

def enemy_can_capture(board, r, c, owner, piece_type):
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            if dr == 0 and dc == 0:
                continue

            nr, nc = r + dr, c + dc

            if not (0 <= nr < 8 and 0 <= nc < 8):
                continue

            enemy = board[nr][nc]

            if enemy is None:
                continue

            if enemy["owner"] != owner:
                if BEATS[enemy["type"]] == piece_type:
                    return True

    return False


def choose_move(obs):
    board = obs["board"]
    moves = obs.get("moves", [])
    owner = obs["owner"]

    if not moves:
        return {"type": "pass"}

    goal = [0, 7] if owner == "p1" else [7, 0]
    enemy_goal = [7, 0] if owner == "p1" else [0, 7]

    best_move = None
    best_score = float("-inf")

    for move in moves:
        fr, fc = move["from"]
        tr, tc = move["to"]

        piece = board[fr][fc]
        target = board[tr][tc]

        old_dist = distance([fr, fc], goal)
        new_dist = distance([tr, tc], goal)

        # Immediate victory
        if [tr, tc] == goal:
            return {
                "from": move["from"],
                "to": move["to"]
            }

        score = random.random() * 0.3

        # Move toward our goal
        score += (old_dist - new_dist) * 8

        # Capture enemy
        if target is not None and target["owner"] != owner:
            score += 25

        # Simulate the move
        next_board = [row[:] for row in board]
        next_board[fr][fc] = None
        next_board[tr][tc] = piece

        # Avoid squares where enemy can capture us
        if enemy_can_capture(
            next_board, tr, tc, owner, piece["type"]
        ):
            score -= 35

        # Prefer capturing threatening enemy pieces
        if target is not None and target["owner"] != owner:
            if distance([tr, tc], enemy_goal) <= 2:
                score += 20

        # Defend our opponent's destination
        for r in range(8):
            for c in range(8):
                enemy = next_board[r][c]

                if enemy is None or enemy["owner"] == owner:
                    continue

                if distance([r, c], enemy_goal) <= 2:
                    if distance([tr, tc], [r, c]) <= 1:
                        if BEATS[piece["type"]] == enemy["type"]:
                            score += 12

        # Discourage repeatedly visiting the same square
        key = (piece["id"], tr, tc)
        score -= VISITS.get(key, 0) * 6

        # Prefer remaining near enemy pieces we can defeat
        for r in range(8):
            for c in range(8):
                enemy = next_board[r][c]

                if enemy is None or enemy["owner"] == owner:
                    continue

                if BEATS[piece["type"]] == enemy["type"]:
                    d = distance([tr, tc], [r, c])
                    score += max(0, 4 - d) * 1.5

        if score > best_score:
            best_score = score
            best_move = move

    fr, fc = best_move["from"]
    tr, tc = best_move["to"]

    piece = board[fr][fc]
    key = (piece["id"], tr, tc)

    VISITS[key] = VISITS.get(key, 0) + 1

    return {
        "from": best_move["from"],
        "to": best_move["to"]
    }


for line in sys.stdin:
    try:
        observation = json.loads(line)
        result = choose_move(observation)
        print(json.dumps(result), flush=True)

    except Exception as exc:
        print("Bot error:", exc, file=sys.stderr)
        print(json.dumps({"type": "pass"}), flush=True)
