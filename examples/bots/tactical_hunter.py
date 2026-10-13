"""Tactical Hunter Bot for OTT Arena (Battlecode).
Chiến thuật: Kiểm soát bàn cờ, săn diệt quân đối phương, phòng thủ chặn đường và né bẫy.
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
    """Kiểm tra xem ô (r, c) có nằm trong tầm ăn của quân địch khắc chế không."""
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


def count_potential_prey(board, r, c, unit, enemy_owner, captured_pos=None):
    """Đếm số quân địch mà quân ta có thể đe dọa ăn ở lượt tiếp theo từ ô (r, c)."""
    count = 0
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
                    if BEATS.get(unit) == enemy_type:
                        count += 1
    return count


def choose(obs):
    moves = obs.get('moves', [])
    if not moves:
        return {'type': 'pass'}

    owner = obs.get('owner', 'p1')
    enemy_owner = 'p2' if owner == 'p1' else 'p1'
    board = obs.get('board', [])
    my_goal = (0, 7) if owner == 'p1' else (7, 0)
    enemy_goal = (7, 0) if owner == 'p1' else (0, 7)

    # Tìm những quân địch đang áp sát goal của họ (nguy cơ thua)
    threatening_enemies = set()
    if board:
        for r in range(8):
            for c in range(8):
                piece = board[r][c]
                if piece and piece.get('owner') == enemy_owner:
                    dist_to_enemy_goal = max(abs(r - enemy_goal[0]), abs(c - enemy_goal[1]))
                    if dist_to_enemy_goal <= 2:
                        threatening_enemies.add((r, c))

    def score(m):
        to_r, to_c = m['to']
        unit = m.get('unit', '')
        is_capture = m.get('capture', False)
        captured_pos = (to_r, to_c) if is_capture else None

        # Khoảng cách tới đích
        dist_goal = max(abs(to_r - my_goal[0]), abs(to_c - my_goal[1]))

        # 1. Thắng ngay nếu chạm đích
        if dist_goal == 0:
            return 100000

        pts = 0.0

        # 2. Cứu nguy: Tiêu diệt quân địch đang mon men gần đích của nó
        if is_capture and (to_r, to_c) in threatening_enemies:
            pts += 600.0

        # 3. Ưu tiên săn mồi (Capture)
        if is_capture:
            pts += 180.0

        # 4. Kiểm tra an toàn: Tuyệt đối tránh nhảy vào miệng cọp
        if board and is_threatened(board, to_r, to_c, unit, enemy_owner, captured_pos):
            pts -= 220.0

        # 5. Đe dọa quân địch ở nước kế tiếp (Tạo áp lực)
        if board:
            prey = count_potential_prey(board, to_r, to_c, unit, enemy_owner, captured_pos)
            pts += prey * 25.0

        # 6. Kiểm soát khu vực trung tâm (row 2-5, col 2-5)
        if 2 <= to_r <= 5 and 2 <= to_c <= 5:
            pts += 10.0

        # 7. Tiến bước về phía đích
        pts += (7 - dist_goal) * 8.0

        # Ngẫu nhiên nhẹ để nước đi biến hóa
        pts += _rand_float() * 2.0
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
            print(f"Hunter Error: {exc}", file=sys.stderr)
            print(json.dumps({'type': 'pass'}), flush=True)


if __name__ == '__main__':
    main()
