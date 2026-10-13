"""OmegaBot (Tactical Grandmaster) - OTT Rock-Paper-Scissors Tactics Bot
Tactics:
- Chặn đứng hiểm họa (Defensive Interception): Chặn hoặc tiêu diệt ngay quân địch đang áp sát Goal của nó.
- Đánh giá tương lai 1-bước (1-Ply Lookahead / Minimax): Kiểm tra nước phản công nguy hiểm nhất của đối thủ.
- Bảo toàn hệ sinh thái quân (Diversity Preservation): Không mạo hiểm quân duy nhất còn lại của mỗi loại.
- Bọc lót tương hỗ (Mutual Protection): Di chuyển trong phạm vi che chắn của đồng đội.
"""
import sys
import json

TYPES = ['rock', 'paper', 'scissors']
BEATS = {'rock': 'scissors', 'scissors': 'paper', 'paper': 'rock'}
WEAK_TO = {'scissors': 'rock', 'paper': 'scissors', 'rock': 'paper'}
GOAL = {'p1': [0, 7], 'p2': [7, 0]}
ENEMY_GOAL = {'p1': [7, 0], 'p2': [0, 7]}


def chebyshev_dist(p1, p2):
    return max(abs(p1[0] - p2[0]), abs(p1[1] - p2[1]))


def get_legal_moves(board, owner):
    """Tính toàn bộ nước đi hợp lệ cho phe owner."""
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


def simulate_move(board, move):
    """Mô phỏng nước đi trên bản cờ giả lập."""
    new_board = [[dict(cell) if cell else None for cell in row] for row in board]
    fr_r, fr_c = move['from']
    to_r, to_c = move['to']
    new_board[to_r][to_c] = new_board[fr_r][fr_c]
    new_board[fr_r][fr_c] = None
    return new_board


def evaluate_board_state(board, owner, my_goal, enemy_goal, enemy_owner):
    """Đánh giá toàn cảnh thế cờ sau khi thực hiện nước đi."""
    my_pieces = []
    enemy_pieces = []
    my_type_counts = {'rock': 0, 'paper': 0, 'scissors': 0}
    enemy_type_counts = {'rock': 0, 'paper': 0, 'scissors': 0}

    min_my_goal_dist = 999
    min_enemy_goal_dist = 999

    for r in range(8):
        for c in range(8):
            p = board[r][c]
            if not p:
                continue
            ptype = p.get('type', '').lower()
            if p.get('owner') == owner:
                my_pieces.append((r, c, ptype))
                my_type_counts[ptype] = my_type_counts.get(ptype, 0) + 1
                dist = chebyshev_dist([r, c], my_goal)
                if dist < min_my_goal_dist:
                    min_my_goal_dist = dist
            else:
                enemy_pieces.append((r, c, ptype))
                enemy_type_counts[ptype] = enemy_type_counts.get(ptype, 0) + 1
                dist = chebyshev_dist([r, c], enemy_goal)
                if dist < min_enemy_goal_dist:
                    min_enemy_goal_dist = dist

    # Địch hết quân -> Ta thắng tuyệt đối
    if not enemy_pieces:
        return 900000.0
    # Ta hết quân -> Thua
    if not my_pieces:
        return -900000.0

    # Lợi thế quân số (Material advantage)
    material_score = (len(my_pieces) - len(enemy_pieces)) * 120.0

    # Đa dạng binh chủng: cực kỳ trân trọng nếu bảo toàn được cả 3 hệ
    diversity_bonus = 0.0
    for t in TYPES:
        if my_type_counts[t] == 0:
            diversity_bonus -= 60.0
        if enemy_type_counts[t] == 0:
            diversity_bonus += 60.0

    # Nguy cơ phòng thủ: nếu địch áp sát đích của nó
    defense_penalty = 0.0
    if min_enemy_goal_dist == 0:
        return -900000.0
    elif min_enemy_goal_dist == 1:
        defense_penalty = -800.0
    elif min_enemy_goal_dist == 2:
        defense_penalty = -300.0

    # Tiến độ công phá đích của ta
    attack_bonus = 0.0
    if min_my_goal_dist == 0:
        return 1000000.0
    elif min_my_goal_dist == 1:
        attack_bonus = 600.0
    elif min_my_goal_dist == 2:
        attack_bonus = 250.0
    else:
        attack_bonus = (8 - min_my_goal_dist) * 20.0

    return material_score + diversity_bonus + attack_bonus + defense_penalty


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

    # 1. Kiểm tra thắng ngay trong 1 bước
    for m in moves:
        if m['to'][0] == my_goal[0] and m['to'][1] == my_goal[1]:
            return {'from': m['from'], 'to': m['to']}

    # 2. Duyệt qua từng nước đi, mô phỏng thế cờ và phản xạ của địch
    best_move = moves[0]
    best_score = -float('inf')

    for m in moves:
        sim_board = simulate_move(board, m)

        # Tính toán các nước đi phản công của địch trên bàn cờ mô phỏng
        enemy_responses = get_legal_moves(sim_board, enemy_owner)

        # Kiểm tra xem địch có thể thắng ngay ở lượt kế tiếp không
        enemy_can_win = False
        enemy_best_capture_val = 0.0

        for em in enemy_responses:
            if em['to'][0] == enemy_goal[0] and em['to'][1] == enemy_goal[1]:
                enemy_can_win = True
                break
            if em.get('capture'):
                # Địch ăn được quân ta
                captured_pos = em['to']
                if captured_pos[0] == m['to'][0] and captured_pos[1] == m['to'][1]:
                    # Chính là quân ta vừa di chuyển bị ăn ngay lập tức!
                    enemy_best_capture_val = max(enemy_best_capture_val, 350.0)
                else:
                    enemy_best_capture_val = max(enemy_best_capture_val, 150.0)

        if enemy_can_win:
            # Nước đi này để địch thắng -> bỏ qua hoặc trừ điểm cực nặng
            move_score = -800000.0
        else:
            base_eval = evaluate_board_state(sim_board, owner, my_goal, enemy_goal, enemy_owner)
            move_score = base_eval - enemy_best_capture_val

            # Thưởng thêm nếu là nước ăn quân trực tiếp
            if m.get('capture'):
                move_score += 180.0

            # Thưởng nếu chặn đường quân địch đang ở gần enemy_goal
            target_piece = board[m['to'][0]][m['to'][1]]
            if target_piece and target_piece.get('owner') == enemy_owner:
                threat_to_goal = chebyshev_dist(m['to'], enemy_goal)
                if threat_to_goal <= 2:
                    move_score += 400.0  # Triệt hạ quân địch nguy hiểm cao độ

        if move_score > best_score:
            best_score = move_score
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
            print(f"OmegaBot Error: {err}", file=sys.stderr)
            print(json.dumps({'type': 'pass'}), flush=True)


if __name__ == '__main__':
    main()
