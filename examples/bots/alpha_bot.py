"""AlphaBot (Blitz Striker) - OTT Rock-Paper-Scissors Tactics Bot
Tactics:
- Chớp thời cơ cán đích (Goal Rush) ngay khi có cơ hội.
- Săn lùng và tiêu diệt quân địch (Hunter), đặc biệt là quân đe dọa.
- Tránh các nước đi tự sát (Safety check).
- Giải phóng đường tiến công hướng về Goal đối diện.
"""
import sys
import json

TYPES = ['rock', 'paper', 'scissors']
BEATS = {'rock': 'scissors', 'scissors': 'paper', 'paper': 'rock'}
GOAL = {'p1': [0, 7], 'p2': [7, 0]}
ENEMY_GOAL = {'p1': [7, 0], 'p2': [0, 7]}


def chebyshev_dist(p1, p2):
    return max(abs(p1[0] - p2[0]), abs(p1[1] - p2[1]))


def get_legal_moves(board, owner):
    moves = []
    for r in range(8):
        for c in range(8):
            p = board[r][c]
            if not p or p.get('owner') != owner:
                continue
            p_type = p.get('type', '').lower()
            for dr in (-1, 0, 1):
                for dc in (-1, 0, 1):
                    if dr == 0 and dc == 0:
                        continue
                    nr, nc = r + dr, c + dc
                    if 0 <= nr < 8 and 0 <= nc < 8:
                        target = board[nr][nc]
                        if not target:
                            moves.append({
                                'from': [r, c],
                                'to': [nr, nc],
                                'owner': owner,
                                'unit': p_type,
                                'capture': False
                            })
                        elif target.get('owner') != owner:
                            t_type = target.get('type', '').lower()
                            if BEATS.get(p_type) == t_type:
                                moves.append({
                                    'from': [r, c],
                                    'to': [nr, nc],
                                    'owner': owner,
                                    'unit': p_type,
                                    'capture': True
                                })
    return moves


def is_square_threatened(board, r, c, my_type, enemy_owner):
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            if dr == 0 and dc == 0:
                continue
            er, ec = r + dr, c + dc
            if 0 <= er < 8 and 0 <= ec < 8:
                enemy = board[er][ec]
                if enemy and enemy.get('owner') == enemy_owner:
                    e_type = enemy.get('type', '').lower()
                    if BEATS.get(e_type) == my_type:
                        return True
    return False


def evaluate_move(move, board, owner, my_goal, enemy_goal, enemy_owner):
    from_r, from_c = move['from']
    to_r, to_c = move['to']
    unit_type = move.get('unit', '').lower()
    is_capture = move.get('capture', False)

    # 1. Thắng ngay nếu chạm Goal
    if to_r == my_goal[0] and to_c == my_goal[1]:
        return 1000000.0

    score = 0.0

    # 2. Khoảng cách tới Goal
    old_dist = chebyshev_dist([from_r, from_c], my_goal)
    new_dist = chebyshev_dist([to_r, to_c], my_goal)
    dist_improvement = old_dist - new_dist

    if new_dist == 1:
        score += 800.0
    elif new_dist == 2:
        score += 350.0
    elif new_dist == 3:
        score += 150.0
    else:
        score += dist_improvement * 25.0 - new_dist * 5.0

    # 3. Bắt quân
    if is_capture:
        target_piece = board[to_r][to_c]
        if target_piece:
            enemy_threat_dist = chebyshev_dist([to_r, to_c], enemy_goal)
            score += 450.0 + (8 - enemy_threat_dist) * 20.0

    # 4. Kiểm tra an toàn
    threatened_at_dest = is_square_threatened(board, to_r, to_c, unit_type, enemy_owner)
    if threatened_at_dest:
        score -= 500.0

    # 5. Thoát hiểm
    was_threatened = is_square_threatened(board, from_r, from_c, unit_type, enemy_owner)
    if was_threatened and not threatened_at_dest:
        score += 200.0

    # 6. Phòng thủ sân nhà
    to_enemy_home_dist = chebyshev_dist([to_r, to_c], enemy_goal)
    if to_enemy_home_dist <= 2 and is_capture:
        score += 300.0

    return score


def choose_best_move(obs):
    owner = obs.get('owner') or obs.get('player', 'p1')
    enemy_owner = 'p2' if owner == 'p1' else 'p1'
    my_goal = obs.get('goal') or GOAL[owner]
    enemy_goal = ENEMY_GOAL[owner]
    board = obs.get('board', [])

    moves = obs.get('moves') or obs.get('legalActions')
    if not moves:
        moves = get_legal_moves(board, owner)

    if not moves:
        return {'type': 'pass'}

    best_move = moves[0]
    best_score = -float('inf')

    for m in moves:
        score = evaluate_move(m, board, owner, my_goal, enemy_goal, enemy_owner)
        if score > best_score:
            best_score = score
            best_move = m

    return {'from': best_move['from'], 'to': best_move['to']}


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            obs = json.loads(line)
            action = choose_best_move(obs)
            print(json.dumps(action), flush=True)
        except Exception as err:
            print(f"AlphaBot Error: {err}", file=sys.stderr)
            print(json.dumps({'type': 'pass'}), flush=True)


if __name__ == '__main__':
    main()
