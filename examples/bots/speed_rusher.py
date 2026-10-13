"""Speed Rusher Bot for OTT Arena (Battlecode).
Chiến thuật: Tấn công thần tốc, ưu tiên lao nhanh về đích (goal) và né tránh bẫy.
"""
import json
import sys
import time

BEATS = {'rock': 'scissors', 'scissors': 'paper', 'paper': 'rock'}

_seed = int(time.time() * 1000) & 0x7FFFFFFF


def _rand_float():
    global _seed
    _seed = (_seed * 1103515245 + 12345) & 0x7FFFFFFF
    return _seed / 2147483648.0


def is_threatened(board, r, c, unit, enemy_owner, captured_pos=None):
    """Kiểm tra ô (r, c) sau khi đi có bị quân địch kề bên khắc chế và ăn mất không."""
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            if dr == 0 and dc == 0:
                continue
            nr, nc = r + dr, c + dc
            if 0 <= nr < 8 and 0 <= nc < 8:
                if captured_pos and (nr, nc) == captured_pos:
                    continue
                piece = board[nr][nc]
                if piece and piece.get('owner') == enemy_owner:
                    enemy_type = piece.get('type')
                    if BEATS.get(enemy_type) == unit:
                        return True
    return False


def choose(obs):
    moves = obs.get('moves', [])
    if not moves:
        return {'type': 'pass'}

    owner = obs.get('owner', 'p1')
    enemy_owner = 'p2' if owner == 'p1' else 'p1'
    board = obs.get('board', [])
    goal = (0, 7) if owner == 'p1' else (7, 0)

    def score(m):
        to_r, to_c = m['to']
        unit = m.get('unit', '')
        is_capture = m.get('capture', False)
        captured_pos = (to_r, to_c) if is_capture else None

        # Khoảng cách Chebyshev tới đích
        dist = max(abs(to_r - goal[0]), abs(to_c - goal[1]))

        # 1. Thắng ngay lập tức nếu bước vào ô đích
        if dist == 0:
            return 100000

        pts = 0.0

        # 2. Càng gần đích càng nhiều điểm (khoảng cách 8x8 tối đa là 7)
        pts += (7 - dist) * 20.0

        # 3. Tiện tay ăn quân đối phương
        if is_capture:
            pts += 45.0

        # 4. Kiểm tra an toàn: Né ô bị quân địch khắc chế đứng rình
        if board and is_threatened(board, to_r, to_c, unit, enemy_owner, captured_pos):
            pts -= 120.0

        # Chút ngẫu nhiên nhẹ để tránh việc 2 quân lặp lại nước đi
        pts += _rand_float() * 1.5
        return pts

    best = max(moves, key=score)
    return {'from': best['from'], 'to': best['to']}


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            obs = json.loads(line)
            action = choose(obs)
            print(json.dumps(action), flush=True)
        except Exception as exc:
            print(f"Rusher Error: {exc}", file=sys.stderr)
            print(json.dumps({'type': 'pass'}), flush=True)


if __name__ == '__main__':
    main()
