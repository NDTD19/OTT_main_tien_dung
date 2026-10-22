/* ══════════════════════════════════════════════════════════════════════════════
   OTT Arena — Embedded Tournament Manager & Arena Integration
   ══════════════════════════════════════════════════════════════════════════════ */
'use strict';

(function () {
  // ─── Module State ─────────────────────────────────────────────────────────────
  window.trnState = {
    tournaments: [],
    current: null,
    tab: 'rounds', // 'rounds' | 'participants' | 'standings' | 'bracket' | 'logs'
    standings: [],
    loading: false,
    modal: null,
    // Live / Replay state in Match Arena
    liveData: null,
    livePollTimer: null,
    replayData: null,
    replayFrame: 0,
    replayPlaying: false,
    replaySpeed: 1,
    replayTimer: null,
    activeTid: null,
    activeMid: null,
  };

  const ts = window.trnState;

  // ─── Helper Functions ─────────────────────────────────────────────────────────
  function isAdmin() {
    if (typeof window.isUserAdmin === 'function') return window.isUserAdmin();
    const role = localStorage.getItem('ott_role');
    const user = localStorage.getItem('ott_username');
    return role === 'admin' || user === 'admin';
  }

  function getUsername() {
    return localStorage.getItem('ott_username') || '';
  }

  function getToken() {
    return localStorage.getItem('ott_token') || '';
  }

  async function trnApi(method, path, body) {
    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(getToken() ? { 'Authorization': 'Bearer ' + getToken() } : {})
      }
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch('/api' + path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Yêu cầu thất bại (' + res.status + ')');
    return data;
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('vi-VN') + ' ' + d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    } catch { return iso; }
  }

  const FORMAT_NAME = {
    'round-robin': '🔄 Đấu vòng tròn (3/1/0 điểm)',
    'elimination': '⚡ Đấu loại trực tiếp (Odd BYE)'
  };

  const STATUS_NAME = {
    'draft': 'Bản nháp',
    'registration': 'Mở đăng ký',
    'active': 'Đang thi đấu',
    'completed': 'Đã hoàn thành',
    'cancelled': 'Đã hủy'
  };

  const STATUS_CLASS = {
    'draft': 'chip gray',
    'registration': 'chip purplechip',
    'active': 'chip',
    'completed': 'chip orangec',
    'cancelled': 'chip gray'
  };

  // ─── Tournament List Loader ───────────────────────────────────────────────────
  async function loadTournaments() {
    ts.loading = true;
    try {
      ts.tournaments = await trnApi('GET', '/tournaments');
    } catch (e) {
      console.warn('Lỗi tải danh sách giải:', e.message);
    } finally {
      ts.loading = false;
    }
  }

  async function selectTournament(tid) {
    try {
      notice('Đang mở giải đấu...');
      ts.current = await trnApi('GET', '/tournaments/' + tid);
      if (ts.current.format === 'round-robin') {
        try {
          ts.standings = await trnApi('GET', '/tournaments/' + tid + '/standings');
        } catch { ts.standings = []; }
      }
      ts.tab = 'rounds';
      render();
    } catch (e) {
      notice('Lỗi: ' + e.message);
    }
  }

  async function refreshTournament() {
    if (!ts.current) return;
    try {
      ts.current = await trnApi('GET', '/tournaments/' + ts.current.id);
      if (ts.current.format === 'round-robin') {
        ts.standings = await trnApi('GET', '/tournaments/' + ts.current.id + '/standings');
      }
      render();
    } catch (e) {
      console.warn('Lỗi refresh giải:', e.message);
    }
  }

  // ─── Main Native View: tournaments() ──────────────────────────────────────────
  window.renderTournamentsNative = function () {
    if (!ts.current) {
      return renderTournamentList();
    } else {
      return renderTournamentDetail();
    }
  };

  // ─── 1. Tournament List Page ──────────────────────────────────────────────────
  function renderTournamentList() {
    const admin = isAdmin();
    const total = ts.tournaments.length;
    const active = ts.tournaments.filter(t => t.status === 'active').length;
    const reg = ts.tournaments.filter(t => t.status === 'registration').length;

    const listHtml = ts.tournaments.length === 0 ? `
      <div class="card empty" style="padding:48px 24px">
        <div style="font-size:42px;margin-bottom:12px">🏆</div>
        <h3>Chưa có giải đấu nào</h3>
        <p class="muted" style="margin-top:6px">
          ${admin ? 'Hãy nhấn nút "+ Tạo giải đấu mới" ở trên để khởi tạo giải đấu đầu tiên!' : 'Hiện tại chưa có giải đấu nào được tổ chức. Vui lòng quay lại sau!'}
        </p>
        ${admin ? `<button class="btn" style="margin-top:16px" onclick="trnOpenCreateModal()">+ Tạo Giải Đấu Mới</button>` : ''}
      </div>
    ` : `
      <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(320px, 1fr));gap:18px">
        ${ts.tournaments.map(t => {
          const isRegOpen = t.status === 'registration';
          const isComplete = t.status === 'completed';
          return `
            <div class="card" style="padding:22px;display:flex;flex-direction:column;justify-content:space-between;gap:14px;border:3px solid var(--line,#6f4d31)">
              <div>
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px">
                  <span class="${STATUS_CLASS[t.status] || 'chip'}">${STATUS_NAME[t.status] || t.status}</span>
                  <span class="chip gray" style="font-size:11px">${t.format === 'elimination' ? '⚡ Loại trực tiếp' : '🔄 Vòng tròn'}</span>
                </div>
                <h3 style="font-size:18px;margin-bottom:8px;color:var(--text)">${esc(t.name)}</h3>
                <p class="small muted" style="line-height:1.6;margin-bottom:12px">${esc(t.description || 'Giải đấu tranh tài thuật toán Bot chiến lược OTT Super Arena.')}</p>
                <div style="font-size:12px;color:var(--muted);display:flex;gap:14px;flex-wrap:wrap">
                  <span>👥 <b>${t.participantCount || 0}</b> thí sinh</span>
                  <span>📅 ${fmtDate(t.createdAt)}</span>
                </div>
                ${t.champion ? `
                  <div style="margin-top:12px;padding:8px 12px;background:#ffe68822;border:1px solid #ffd84f;border-radius:6px;color:#d88a1f;font-weight:700;font-size:13px;display:flex;align-items:center;gap:6px">
                    👑 Vô địch: <b>${esc(t.champion)}</b>
                  </div>
                ` : ''}
              </div>
              <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
                <button class="btn" style="flex:1" onclick="trnSelect('${t.id}')">Vào xem giải đấu →</button>
                ${isRegOpen ? `<button class="btn secondary" onclick="trnQuickJoin('${t.id}')" title="Đăng ký tham gia">✋ Tham gia</button>` : ''}
                ${admin ? `<button class="btn sm danger" onclick="trnDeleteTournamentConfirm('${t.id}')" title="Xóa vĩnh viễn giải đấu">🗑 Xóa</button>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    return `
      ${header('HỆ THỐNG GIẢI ĐẤU OTT ARENA', 'Quản lý giải đấu', 'Thiết lập, theo dõi và tham gia các giải đấu tranh tài Bot chiến thuật.', admin ? `<button class="btn" onclick="trnOpenCreateModal()">+ Tạo Giải Đấu Mới</button>` : '')}
      
      <div class="stats">
        ${stat('Tổng số giải đấu', String(total), 'Đã khởi tạo', 'cup')}
        ${stat('Đang thi đấu', String(active), 'Trực tiếp tại Đấu trường', 'code')}
        ${stat('Đang mở đăng ký', String(reg), 'Sẵn sàng nhận Bot', 'users')}
        ${stat('Thể thức hỗ trợ', '2 thể thức', 'Vòng tròn & Loại trực tiếp', 'chart')}
      </div>

      ${listHtml}
      ${renderCreateModal()}
    `;
  }

  // ─── 2. Tournament Detail Page ────────────────────────────────────────────────
  function renderTournamentDetail() {
    const t = ts.current;
    if (!t) return '';
    const admin = isAdmin();
    const me = getUsername();
    const myEntry = (t.participants || []).find(p => p.userId === me);
    const approvedCount = (t.participants || []).filter(p => p.approved && p.officialBot).length;

    // Submissions of current user for official bot selection
    const userSubs = (state.submissions || []);

    return `
      <div class="page-heading" style="margin-bottom:18px">
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <button class="btn sm secondary" onclick="trnBackToList()">← Tất cả giải</button>
            <button class="btn sm secondary" id="trn-refresh-btn" onclick="trnRefreshClick()" title="Cập nhật lại dữ liệu giải đấu">🔄 Cập nhật lại</button>
            <span class="${STATUS_CLASS[t.status] || 'chip'}">${STATUS_NAME[t.status] || t.status}</span>
            <span class="chip gray">${FORMAT_NAME[t.format] || t.format}</span>
            ${t.submissionsLocked ? '<span class="chip orangec">🔒 Bài nộp đã khóa</span>' : ''}
          </div>
          <h1 style="margin-bottom:6px">${esc(t.name)}</h1>
          <p class="intro">${esc(t.description || 'Giải đấu tranh tài thuật toán Bot chiến lược OTT.')}</p>
        </div>
      </div>

      ${t.champion ? `
        <div class="card" style="padding:18px 24px;margin-bottom:20px;background:linear-gradient(135deg,rgba(255,223,108,0.2),rgba(240,172,29,0.1));border:2px solid #ffc933;display:flex;align-items:center;gap:16px">
          <div style="font-size:38px">👑</div>
          <div>
            <div style="font-size:12px;color:var(--gold,#f5c842);font-weight:800;letter-spacing:1.5px">NHÀ VÔ ĐỊCH GIẢI ĐẤU</div>
            <div style="font-size:24px;font-weight:900;color:var(--text);margin-top:2px">${esc(t.champion)}</div>
          </div>
        </div>
      ` : ''}

      ${t.announcement ? `
        <div class="notice" style="margin-bottom:20px;display:flex;align-items:center;gap:12px">
          <span style="font-size:20px">📢</span>
          <div>
            <b>Thông báo trọng tài:</b> ${esc(t.announcement)}
            <small class="muted" style="margin-left:8px">(${fmtDate(t.announcedAt)})</small>
          </div>
        </div>
      ` : ''}

      ${admin ? renderAdminToolbar(t, approvedCount) : ''}
      ${renderPlayerParticipationBox(t, myEntry, userSubs)}

      <!-- TABS -->
      <div class="tabbar" style="margin:20px 0 16px">
        <button class="tab ${ts.tab === 'rounds' ? 'on' : ''}" onclick="trnSetTab('rounds')">📅 Lịch đấu & Trận đấu (${(t.rounds || []).length} vòng)</button>
        <button class="tab ${ts.tab === 'participants' ? 'on' : ''}" onclick="trnSetTab('participants')">👥 Thí sinh (${(t.participants || []).length})</button>
        ${t.format === 'round-robin' ? `<button class="tab ${ts.tab === 'standings' ? 'on' : ''}" onclick="trnSetTab('standings')">🏆 Bảng xếp hạng</button>` : ''}
        ${t.format === 'elimination' ? `<button class="tab ${ts.tab === 'bracket' ? 'on' : ''}" onclick="trnSetTab('bracket')">🌲 Nhánh đấu (Bracket)</button>` : ''}
        <button class="tab ${ts.tab === 'logs' ? 'on' : ''}" onclick="trnSetTab('logs')">📜 Nhật ký trọng tài (${(t.logs || []).length})</button>
      </div>

      <!-- TAB CONTENT -->
      <div id="trnTabContent">
        ${ts.tab === 'rounds' ? renderRoundsTab(t, admin) : ''}
        ${ts.tab === 'participants' ? renderParticipantsTab(t, admin) : ''}
        ${ts.tab === 'standings' ? renderStandingsTab(t) : ''}
        ${ts.tab === 'bracket' ? renderBracketTab(t) : ''}
        ${ts.tab === 'logs' ? renderLogsTab(t) : ''}
      </div>

      ${renderCreateModal()}
      ${renderAnnounceModal()}
      ${renderManualReportModal()}
    `;
  }

  // ─── Admin Command Toolbar ───────────────────────────────────────────────────
  function renderAdminToolbar(t, approvedCount) {
    const totalP = (t.participants || []).length;
    return `
      <div class="card" style="padding:16px 20px;margin-bottom:20px;background:var(--surface2,#1e2526);border:2px dashed var(--accent,#24c623)">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:18px">👑</span>
            <b style="font-size:13px;letter-spacing:1px;text-transform:uppercase;color:var(--accent)">Bảng điều khiển Trọng tài (Admin)</b>
          </div>
          <div style="font-size:12px;color:var(--muted)">
            Đã đăng ký: <b>${totalP}</b> thí sinh (${approvedCount} đã duyệt & có bot)
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${!t.registrationOpen && t.status !== 'completed' && t.status !== 'cancelled' ? `
            <button class="btn sm" onclick="trnAction('open-registration', {}, '📢 Đã mở đăng ký tham gia!')">📢 Mở đăng ký tham gia</button>
          ` : ''}
          ${t.registrationOpen ? `
            <button class="btn sm secondary" onclick="trnAction('close-registration', {}, '🔒 Đã đóng cổng đăng ký!')">🔒 Đóng đăng ký</button>
          ` : ''}
          ${!t.submissionsLocked ? `
            <button class="btn sm secondary" onclick="trnAction('lock-submissions', {}, '🔒 Đã khóa bài nộp!')">🔒 Khóa bài nộp</button>
          ` : `
            <button class="btn sm secondary" onclick="trnAction('unlock-submissions', {}, '🔓 Đã mở lại nộp bài!')">🔓 Mở nộp bài</button>
          `}
          ${t.status !== 'completed' && t.status !== 'cancelled' ? `
            <button class="btn sm" onclick="trnGenerateRoundsConfirm()" style="background:#24c623;color:#000;font-weight:800">
              🎲 Bốc thăm & Tạo lịch thi đấu
            </button>
          ` : ''}
          <button class="btn sm secondary" onclick="trnOpenAnnounceModal()">📢 Phát thông báo</button>
          ${t.status !== 'cancelled' && t.status !== 'completed' ? `
            <button class="btn sm secondary" onclick="trnCancelTournamentConfirm()">🛑 Hủy giải đấu</button>
          ` : ''}
          <button class="btn sm danger" onclick="trnDeleteTournamentConfirm('${t.id}')">🗑 Xóa giải đấu</button>
        </div>
      </div>
    `;
  }

  // ─── Player Participation Box ────────────────────────────────────────────────
  function renderPlayerParticipationBox(t, myEntry, userSubs) {
    const isRegOpen = t.registrationOpen && t.status === 'registration';
    const me = getUsername();
    if (!me) {
      return `
        <div class="card" style="padding:16px 20px;margin-bottom:20px;background:var(--surface,#171d1e);display:flex;align-items:center;justify-content:space-between;gap:12px">
          <div>
            <b>Đăng nhập để tham gia giải đấu này!</b>
            <div class="small muted">Nộp bot chiến thuật và tham gia tranh tài cùng các thí sinh khác.</div>
          </div>
          <button class="btn sm" onclick="openLoginPage()">🔑 Đăng nhập ngay</button>
        </div>
      `;
    }

    if (!myEntry) {
      if (isRegOpen) {
        return `
          <div class="card" style="padding:18px 22px;margin-bottom:20px;background:linear-gradient(135deg,rgba(36,198,35,0.12),rgba(20,54,107,0.2));border:2px solid var(--accent,#24c623);display:flex;align-items:center;justify-content:space-between;gap:16px">
            <div>
              <div style="font-size:16px;font-weight:700">✋ Tham gia tranh tài giải đấu này</div>
              <div class="small muted" style="margin-top:4px">Đăng ký ngay bây giờ trong thời gian mở đăng ký.</div>
            </div>
            <button class="btn" onclick="trnAction('register', {}, 'Đăng ký thành công!')">✋ Đăng Ký Tham Gia</button>
          </div>
        `;
      }
      return '';
    }

    // Already registered
    const botOpts = userSubs.map(s => `<option value="${s.id}" ${myEntry.officialBot === s.id ? 'selected' : ''}>${esc(s.name)} (${s.lang} · ${s.version})</option>`).join('');

    return `
      <div class="card" style="padding:16px 20px;margin-bottom:20px;background:var(--surface2,#1e2526);border:2px solid var(--line,#2b3434)">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px">
          <div>
            <span style="font-size:16px">🤖</span> <b>Trạng thái của bạn (${esc(me)}):</b>
            <span class="chip ${myEntry.approved ? 'chip' : 'gray'}" style="margin-left:8px">
              ${myEntry.approved ? '✓ Đã duyệt tham gia' : '⏳ Đang chờ trọng tài duyệt'}
            </span>
          </div>
          <div class="small muted">Bot chính thức: <b>${esc(myEntry.officialBotName || 'Chưa chọn')}</b></div>
        </div>

        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <label style="font-size:12px;font-weight:700">Chọn Bot thi đấu chính thức:</label>
          <select id="trnOfficialBotSelect" class="select" style="min-width:240px;height:38px" ${t.submissionsLocked && !isAdmin() ? 'disabled' : ''}>
            ${botOpts || '<option value="">Chưa có bot nào — hãy vào tab "My submissions" để upload</option>'}
          </select>
          <button class="btn sm" onclick="trnSaveOfficialBot()" ${t.submissionsLocked && !isAdmin() ? 'disabled' : ''}>💾 Lưu Bot Chính Thức</button>
          <button class="btn sm secondary" onclick="go('submit')">⇧ Upload bot mới</button>
        </div>
        ${t.submissionsLocked ? '<div class="small" style="color:var(--orange);margin-top:8px">🔒 Trọng tài đã khóa bài nộp. Không thể đổi bot.</div>' : ''}
      </div>
    `;
  }

  // ─── 3. Tabs Implementation ───────────────────────────────────────────────────

  // Tab 1: Rounds & Matches
  function renderRoundsTab(t, admin) {
    if (!t.rounds || t.rounds.length === 0) {
      return `
        <div class="card empty" style="padding:36px">
          <h3>Chưa có vòng thi đấu nào</h3>
          <p class="muted" style="margin-top:6px">
            ${admin ? 'Sau khi duyệt thí sinh và chọn bot chính thức, hãy nhấn nút "🎲 Bốc thăm & Tạo lịch thi đấu" ở trên!' : 'Lịch thi đấu sẽ được công bố khi trọng tài hoàn tất bốc thăm chia bảng.'}
          </p>
        </div>
      `;
    }

    return `
      <div style="display:flex;flex-direction:column;gap:20px">
        ${t.rounds.map(r => {
          const completed = (r.matches || []).filter(m => m.status === 'completed').length;
          const total = (r.matches || []).length;
          const hasPending = (r.matches || []).some(m => m.status === 'pending' && m.playerB !== 'BYE');
          return `
            <div class="card" style="padding:20px">
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px;border-bottom:2px solid var(--line,#2b3434);padding-bottom:12px">
                <div style="display:flex;align-items:center;gap:10px">
                  <span class="chip purplechip" style="font-size:12px">Vòng ${r.roundNumber}</span>
                  <h3 style="margin:0">${esc(r.name || ('Vòng ' + r.roundNumber))}</h3>
                  <span class="small muted">(${completed}/${total} trận xong)</span>
                </div>
                <div style="display:flex;gap:8px">
                  ${admin && t.status === 'active' && hasPending ? `
                    <button class="btn sm" onclick="trnRunRound('${r.id}')">▶ Chạy cả vòng</button>
                  ` : ''}
                  ${admin && (r.matches || []).some(m => m.status !== 'pending' || m.error) ? `
                    <button class="btn sm secondary" onclick="trnResetRoundConfirm('${r.id}')" title="Đặt lại toàn bộ các trận trong vòng này về chờ đấu">↺ Đặt lại vòng</button>
                  ` : ''}
                </div>
              </div>

              <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(340px, 1fr));gap:12px">
                ${(r.matches || []).map(m => renderMatchCard(t, r, m, admin)).join('')}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderMatchCard(t, r, m, admin) {
    const isBye = m.playerB === 'BYE';
    const isRunning = m.status === 'running';
    const isPaused = !!m.paused;
    const isCompleted = m.status === 'completed';
    const isCancelled = m.status === 'cancelled';

    const pA = (t.participants || []).find(p => p.userId === m.playerA);
    const pB = isBye ? null : (t.participants || []).find(p => p.userId === m.playerB);
    const nameA = pA?.username || m.playerA;
    const nameB = isBye ? 'BYE (Vào thẳng)' : (pB?.username || m.playerB);

    let winnerTxt = '';
    if (isCompleted) {
      if (m.winner === 'a') winnerTxt = '🏆 ' + nameA + ' thắng';
      else if (m.winner === 'b') winnerTxt = '🏆 ' + nameB + ' thắng';
      else if (m.winner === 'draw') winnerTxt = '🤝 Hòa trận';
      else if (m.winner === 'bye') winnerTxt = '⏩ ' + nameA + ' vào thẳng';
    }

    return `
      <div class="card" style="padding:14px;background:var(--surface2,#1e2526);border:2px solid ${isRunning ? 'var(--accent,#24c623)' : isPaused ? '#ffb33f' : 'var(--line,#2b3434)'}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-size:11px">
          <span class="muted">${m.id}</span>
          ${isRunning ? (isPaused ? '<span class="chip orangec">⏸ TẠM DỪNG</span>' : '<span class="chip" style="animation:pulse 1.2s infinite">● ĐANG ĐẤU (LIVE)</span>') : ''}
          ${isCompleted ? '<span class="chip">✓ Hoàn tất</span>' : ''}
          ${isCancelled ? '<span class="chip gray">🗑 Đã hủy</span>' : ''}
          ${m.status === 'pending' ? '<span class="chip gray">⏳ Chờ đấu</span>' : ''}
        </div>

        <!-- Competitors -->
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line,#2b3434)">
          <div style="font-weight:700;${m.winner === 'a' ? 'color:var(--accent);' : ''}">
            ${m.winner === 'a' ? '👑 ' : ''}🟡 ${esc(nameA)}
            <div class="tiny muted">${esc(pA?.officialBotName || '—')}</div>
          </div>
          <div style="font-size:11px;font-weight:800;color:var(--muted)">VS</div>
          <div style="font-weight:700;text-align:right;${m.winner === 'b' ? 'color:var(--accent);' : ''}">
            ${m.winner === 'b' ? '👑 ' : ''}🔵 ${esc(nameB)}
            <div class="tiny muted">${isBye ? '(auto)' : esc(pB?.officialBotName || '—')}</div>
          </div>
        </div>

        ${winnerTxt ? `
          <div style="margin:8px 0;font-size:12px;font-weight:700;color:var(--accent);text-align:center">
            ${winnerTxt}
          </div>
        ` : ''}

        <!-- Actions -->
        <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;align-items:center">
          ${isRunning ? `
            <button class="btn sm" onclick="trnWatchLive('${t.id}','${m.id}')">📺 Xem trực tiếp</button>
          ` : ''}
          ${isCompleted && m.hasReplay ? `
            <button class="btn sm secondary" onclick="trnWatchReplay('${t.id}','${m.id}')">🎬 Xem lại trận</button>
          ` : ''}

          <!-- Admin Referee Controls -->
          ${admin && m.status === 'pending' && !isBye ? `
            <button class="btn sm" onclick="trnStartMatch('${r.id}','${m.id}')" ${t.status !== 'active' ? 'disabled' : ''}>▶ Đấu</button>
            <button class="btn sm secondary" onclick="trnOpenReportModal('${r.id}','${m.id}','${esc(nameA)}','${esc(nameB)}')">✍ Điểm</button>
          ` : ''}
          ${admin && isRunning ? (isPaused ? `
            <button class="btn sm" onclick="trnMatchCtl('resume-match','${r.id}','${m.id}')" title="Tiếp tục">▶ Tiếp</button>
          ` : `
            <button class="btn sm secondary" onclick="trnMatchCtl('pause-match','${r.id}','${m.id}')" title="Tạm dừng">⏸ Dừng</button>
          `) : ''}
          ${admin && (m.status === 'pending' || isRunning) && !isBye ? `
            <button class="btn sm danger" onclick="trnMatchCtl('cancel-match','${r.id}','${m.id}')" title="Hủy trận">🛑 Hủy</button>
          ` : ''}
          ${admin && (m.status !== 'pending' || m.error) && !isBye ? `
            <button class="btn sm secondary" onclick="trnResetMatchConfirm('${r.id}','${m.id}')" title="Đặt lại trận này về chờ đấu để thi đấu lại">↺ Đặt lại</button>
          ` : ''}
        </div>
      </div>
    `;
  }

  // Tab 2: Participants
  function renderParticipantsTab(t, admin) {
    const list = t.participants || [];
    if (!list.length) {
      return `<div class="card empty" style="padding:36px"><h3>Chưa có thí sinh nào đăng ký</h3></div>`;
    }

    return `
      <div class="card">
        <div class="tablewrap">
          <table class="table">
            <thead>
              <tr>
                <th>Thí sinh</th>
                <th>Bot chính thức</th>
                <th>Thời gian đăng ký</th>
                <th>Trạng thái duyệt</th>
                ${admin ? '<th>Thao tác Admin</th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${list.map(p => `
                <tr>
                  <td><b>${esc(p.username)}</b></td>
                  <td>${p.officialBotName ? `<span class="chip">${esc(p.officialBotName)}</span>` : '<span class="muted">Chưa chọn</span>'}</td>
                  <td class="small muted">${fmtDate(p.registeredAt)}</td>
                  <td>
                    ${p.approved ? '<span class="chip">✓ Đã duyệt</span>' : '<span class="chip gray">⏳ Chờ duyệt</span>'}
                  </td>
                  ${admin ? `
                    <td>
                      ${!p.approved ? `
                        <button class="btn sm" onclick="trnApproveParticipant('${p.userId}')">✓ Duyệt</button>
                      ` : ''}
                      <button class="btn sm danger" onclick="trnRejectParticipant('${p.userId}')">✕ Từ chối</button>
                    </td>
                  ` : ''}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // Tab 3: Standings (Round Robin)
  function renderStandingsTab(t) {
    const standings = ts.standings || [];
    return `
      <div class="card">
        <div class="section-head">
          <h3>Bảng xếp hạng giải đấu (Tính điểm 3/1/0)</h3>
          <span class="chip gray">Thắng: +3đ · Hòa: +1đ · Thua: 0đ</span>
        </div>
        <div class="tablewrap">
          <table class="table">
            <thead>
              <tr>
                <th>Hạng</th>
                <th>Thí sinh</th>
                <th>Điểm</th>
                <th>Trận đã đấu</th>
                <th>Thắng</th>
                <th>Hòa</th>
                <th>Thua</th>
              </tr>
            </thead>
            <tbody>
              ${standings.length ? standings.map((s, i) => `
                <tr>
                  <td>
                    <span class="rank ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}">
                      ${i === 0 ? '🥇 #1' : i === 1 ? '🥈 #2' : i === 2 ? '🥉 #3' : '#' + (i + 1)}
                    </span>
                  </td>
                  <td><b>${esc(s.name || s.userId)}</b></td>
                  <td><strong style="font-size:16px;color:var(--accent)">${s.points}</strong></td>
                  <td>${s.played}</td>
                  <td style="color:var(--green)">${s.wins}</td>
                  <td style="color:var(--orange)">${s.draws}</td>
                  <td style="color:var(--red)">${s.losses}</td>
                </tr>
              `).join('') : `
                <tr><td colspan="7" class="empty">Chưa có kết quả thi đấu nào để tính điểm.</td></tr>
              `}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // Tab 4: Bracket (Knockout)
  function renderBracketTab(t) {
    const rounds = t.rounds || [];
    if (!rounds.length) return `<div class="card empty" style="padding:36px"><h3>Chưa có nhánh đấu</h3></div>`;

    return `
      <div class="card" style="padding:20px;overflow-x:auto">
        <div style="display:flex;gap:24px;min-width:max-content">
          ${rounds.map(r => `
            <div style="display:flex;flex-direction:column;gap:14px;min-width:240px">
              <div class="roundtitle" style="font-size:12px;font-weight:800;color:var(--accent)">${esc(r.name || ('Vòng ' + r.roundNumber))}</div>
              ${(r.matches || []).map(m => {
                const isBye = m.playerB === 'BYE';
                const pA = (t.participants || []).find(p => p.userId === m.playerA);
                const pB = isBye ? null : (t.participants || []).find(p => p.userId === m.playerB);
                const nameA = pA?.username || m.playerA;
                const nameB = isBye ? 'BYE (Vào thẳng)' : (pB?.username || m.playerB);
                return `
                  <div class="bracket-match" style="border:2px solid ${m.status === 'running' ? 'var(--accent)' : 'var(--line)'};padding:10px">
                    <div style="display:flex;justify-content:space-between;padding:6px;${m.winner === 'a' ? 'font-weight:800;color:var(--accent)' : ''}">
                      <span>${m.winner === 'a' ? '👑 ' : ''}${esc(nameA)}</span>
                      <b>${m.winner === 'a' ? '1' : m.status === 'completed' ? '0' : '—'}</b>
                    </div>
                    <div style="display:flex;justify-content:space-between;padding:6px;${m.winner === 'b' ? 'font-weight:800;color:var(--accent)' : ''}">
                      <span>${m.winner === 'b' ? '👑 ' : ''}${esc(nameB)}</span>
                      <b>${m.winner === 'b' ? '1' : m.status === 'completed' ? '0' : '—'}</b>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // Tab 5: Audit Logs
  function renderLogsTab(t) {
    const logs = (t.logs || []).slice().reverse();
    if (!logs.length) return `<div class="card empty" style="padding:36px"><h3>Chưa có nhật ký nào</h3></div>`;

    return `
      <div class="card">
        <div class="section-head">
          <h3>Nhật ký thao tác của Trọng tài</h3>
          <span class="chip gray">Minh bạch & Toàn vẹn</span>
        </div>
        <div class="activity" style="margin:0">
          ${logs.map(l => `
            <div class="item">
              <span class="symbol">⚖</span>
              <div style="flex:1">
                <p><b>[${esc(l.action)}]</b> ${esc(l.detail || '')}</p>
                <small>Bởi <b>${esc(l.by)}</b> · ${fmtDate(l.at)}</small>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // ─── Modal Dialogs ────────────────────────────────────────────────────────────
  function renderCreateModal() {
    if (ts.modal !== 'create') return '';
    return `
      <div class="modaloverlay" onclick="if(event.target===this)trnCloseModal()">
        <div class="modal" role="dialog">
          <div class="modal-head">
            <div>
              <div class="eyebrow">QUẢN LÝ GIẢI ĐẤU</div>
              <h2>Tạo Giải Đấu Mới</h2>
            </div>
            <button class="iconbtn" onclick="trnCloseModal()">✕</button>
          </div>
          <form onsubmit="trnSubmitCreate(event)">
            <div class="form-group">
              <label class="form-label">Tên giải đấu *</label>
              <input id="trnCreateName" class="field" placeholder="Ví dụ: Cúp Vô Địch OTT Mùa Xuân 2026" required maxlength="100">
            </div>

            <div class="form-group">
              <label class="form-label">Mô tả giải đấu</label>
              <textarea id="trnCreateDesc" class="field" style="height:70px;resize:none" placeholder="Mô tả quy mô, giải thưởng, đối tượng tham gia..."></textarea>
            </div>

            <div class="form-group">
              <label class="form-label">Thể thức thi đấu * (Chọn 1 trong 2)</label>
              <select id="trnCreateFormat" class="field" required>
                <option value="round-robin">🔄 Đấu vòng tròn (Round Robin) — Thắng +3đ, Hòa +1đ, Thua 0đ</option>
                <option value="elimination">⚡ Đấu loại trực tiếp (Single Elimination) — Nếu lẻ người được vào thẳng (BYE)</option>
              </select>
            </div>

            <div class="notice" style="margin-bottom:18px">
              💡 <b>Lưu ý thể thức:</b><br>
              • <b>Đấu vòng tròn:</b> Tất cả đối thủ gặp nhau một lần, tìm người vô địch dựa trên điểm số cao nhất.<br>
              • <b>Đấu loại trực tiếp:</b> Chia cặp 1-1, người thua bị loại ngay. Nếu số người lẻ, 1 người sẽ tự động nhận BYE vào thẳng vòng sau.
            </div>

            <div class="row" style="justify-content:flex-end;gap:10px">
              <button class="btn secondary" type="button" onclick="trnCloseModal()">Hủy</button>
              <button class="btn" type="submit">+ Khởi Tạo Giải Đấu</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  function renderAnnounceModal() {
    if (ts.modal !== 'announce') return '';
    return `
      <div class="modaloverlay" onclick="if(event.target===this)trnCloseModal()">
        <div class="modal" role="dialog">
          <div class="modal-head">
            <div>
              <div class="eyebrow">TRỌNG TÀI</div>
              <h2>Phát Thông Báo / Công Bố</h2>
            </div>
            <button class="iconbtn" onclick="trnCloseModal()">✕</button>
          </div>
          <form onsubmit="trnSubmitAnnounce(event)">
            <div class="form-group">
              <label class="form-label">Nội dung thông báo</label>
              <textarea id="trnAnnounceMsg" class="field" style="height:90px" placeholder="Nhập nội dung công bố kết quả hoặc nhắc nhở thí sinh..." required></textarea>
            </div>
            <div class="row" style="justify-content:flex-end;gap:10px">
              <button class="btn secondary" type="button" onclick="trnCloseModal()">Hủy</button>
              <button class="btn" type="submit">📢 Phát Thông Báo</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  function renderManualReportModal() {
    if (ts.modal !== 'report') return '';
    const d = ts.reportData;
    return `
      <div class="modaloverlay" onclick="if(event.target===this)trnCloseModal()">
        <div class="modal" role="dialog">
          <div class="modal-head">
            <div>
              <div class="eyebrow">TRỌNG TÀI</div>
              <h2>Nhập Kết Quả Thủ Công</h2>
            </div>
            <button class="iconbtn" onclick="trnCloseModal()">✕</button>
          </div>
          <form onsubmit="trnSubmitReport(event)">
            <p>Trận: <b>${esc(d.nameA)}</b> vs <b>${esc(d.nameB)}</b></p>
            <div class="form-group">
              <label class="form-label">Chọn kết quả *</label>
              <select id="trnReportWinner" class="field" required>
                <option value="a">${esc(d.nameA)} thắng (Player A)</option>
                <option value="b">${esc(d.nameB)} thắng (Player B)</option>
                ${ts.current?.format === 'round-robin' ? '<option value="draw">Hòa (Mỗi bên +1 điểm)</option>' : ''}
              </select>
            </div>
            <div class="row" style="justify-content:flex-end;gap:10px">
              <button class="btn secondary" type="button" onclick="trnCloseModal()">Hủy</button>
              <button class="btn" type="submit">💾 Lưu Kết Quả</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  // ─── Actions Dispatcher ───────────────────────────────────────────────────────
  window.trnSelect = function (id) {
    selectTournament(id);
  };

  window.trnBackToList = function () {
    ts.current = null;
    loadTournaments().then(render);
  };

  window.trnSetTab = function (tab) {
    ts.tab = tab;
    render();
  };

  window.trnOpenCreateModal = function () {
    ts.modal = 'create';
    render();
  };

  window.trnCloseModal = function () {
    ts.modal = null;
    render();
  };

  window.trnSubmitCreate = async function (e) {
    e.preventDefault();
    const name = document.getElementById('trnCreateName')?.value?.trim();
    const description = document.getElementById('trnCreateDesc')?.value?.trim();
    const format = document.getElementById('trnCreateFormat')?.value;
    if (!name) return notice('Vui lòng nhập tên giải đấu!');
    try {
      const res = await trnApi('POST', '/tournaments', { name, description, format });
      notice('✅ Đã tạo giải đấu "' + name + '" thành công!');
      ts.modal = null;
      ts.current = res;
      ts.tab = 'rounds';
      render();
    } catch (err) {
      notice('Lỗi: ' + err.message);
    }
  };

  window.trnAction = async function (action, extra = {}, successMsg) {
    if (!ts.current) return;
    try {
      const res = await trnApi('POST', '/tournaments/' + ts.current.id + '/' + action, extra);
      if (res && res.id) ts.current = res;
      await refreshTournament();
      if (successMsg) notice(successMsg);
    } catch (e) {
      notice('Lỗi: ' + e.message);
    }
  };

  window.trnQuickJoin = async function (tid) {
    try {
      await trnApi('POST', '/tournaments/' + tid + '/register', {});
      notice('✅ Đăng ký tham gia thành công!');
      selectTournament(tid);
    } catch (e) {
      notice('Lỗi: ' + e.message);
    }
  };

  window.trnSaveOfficialBot = async function () {
    const sel = document.getElementById('trnOfficialBotSelect');
    const subId = sel?.value;
    if (!subId) return notice('Vui lòng chọn 1 bot từ danh sách!');
    try {
      await trnApi('POST', '/tournaments/' + ts.current.id + '/set-official-bot', { submissionId: subId });
      notice('✅ Đã lưu bot chính thức!');
      refreshTournament();
    } catch (e) {
      notice('Lỗi: ' + e.message);
    }
  };

  window.trnApproveParticipant = function (userId) {
    trnAction('approve-participant', { userId }, '✅ Đã duyệt thí sinh!');
  };

  window.trnRejectParticipant = function (userId) {
    if (confirm('Từ chối và loại thí sinh này khỏi giải đấu?')) {
      trnAction('reject-participant', { userId }, 'Đã loại thí sinh khỏi giải.');
    }
  };

  window.trnGenerateRoundsConfirm = function () {
    const t = ts.current;
    if (!t) return;
    const count = (t.participants || []).length;
    if (count < 2) {
      alert('Cần ít nhất 2 thí sinh tham gia giải đấu để bốc thăm tạo lịch đấu! (Hiện có: ' + count + ' thí sinh).\nHãy mở đăng ký hoặc đăng ký thêm thí sinh!');
      return;
    }
    if (confirm('Bốc thăm và sinh lịch thi đấu cho ' + count + ' thí sinh tham gia?\n(Hệ thống sẽ tự động duyệt và gán bot thi đấu cho các thí sinh)\nLưu ý: Không thể hoàn tác sau khi tạo vòng.')) {
      trnAction('generate-rounds', {}, '🎲 Bốc thăm tạo lịch thi đấu thành công!');
    }
  };

  window.trnDeleteTournamentConfirm = async function (tid) {
    if (!confirm('Bạn có CHẮC CHẮN muốn XÓA VĨNH VIỄN giải đấu này không?\nHành động này không thể hoàn tác!')) return;
    try {
      await trnApi('POST', '/tournaments/' + tid + '/delete', {});
      notice('🗑 Đã xóa vĩnh viễn giải đấu!');
      if (ts.current && ts.current.id === tid) {
        ts.current = null;
      }
      await loadTournaments();
      render();
    } catch (e) {
      notice('Lỗi xóa giải: ' + e.message);
    }
  };

  window.trnCancelTournamentConfirm = function () {
    const reason = prompt('Nhập lý do hủy giải đấu:');
    if (reason !== null) {
      trnAction('cancel', { reason: reason || 'Trọng tài hủy giải' }, '🛑 Giải đấu đã bị hủy.');
    }
  };

  window.trnOpenAnnounceModal = function () {
    ts.modal = 'announce';
    render();
  };

  window.trnSubmitAnnounce = async function (e) {
    e.preventDefault();
    const msg = document.getElementById('trnAnnounceMsg')?.value?.trim();
    if (!msg) return;
    await trnAction('announce', { message: msg }, '📢 Đã phát thông báo!');
    ts.modal = null;
    render();
  };

  window.trnStartMatch = async function (roundId, matchId) {
    notice('▶ Đang khởi động trận đấu...');
    try {
      await trnApi('POST', '/tournaments/' + ts.current.id + '/start-match', { roundId, matchId, demo: true });
      notice('▶ Trận đấu đã bắt đầu! Đang chuyển đến Đấu trường Arena...');
      await refreshTournament();
      trnWatchLive(ts.current.id, matchId);
    } catch (e) {
      notice('Lỗi bắt đầu trận: ' + e.message);
    }
  };

  window.trnRunRound = async function (roundId) {
    if (!confirm('Chạy tất cả các trận trong vòng này?')) return;
    notice('▶ Đang chạy cả vòng...');
    try {
      await trnApi('POST', '/tournaments/' + ts.current.id + '/run-round', { roundId, demo: true });
      notice('▶ Đã bắt đầu tất cả các trận trong vòng!');
      refreshTournament();
    } catch (e) {
      notice('Lỗi: ' + e.message);
    }
  };

  window.trnMatchCtl = async function (action, roundId, matchId, extra = {}) {
    try {
      await trnApi('POST', '/tournaments/' + ts.current.id + '/' + action, { roundId, matchId, ...extra });
      notice('Thao tác trọng tài hoàn tất.');
      refreshTournament();
    } catch (e) {
      notice('Lỗi: ' + e.message);
    }
  };

  window.trnOpenReportModal = function (roundId, matchId, nameA, nameB) {
    ts.modal = 'report';
    ts.reportData = { roundId, matchId, nameA, nameB };
    render();
  };

  window.trnSubmitReport = async function (e) {
    e.preventDefault();
    const winner = document.getElementById('trnReportWinner')?.value;
    const { roundId, matchId } = ts.reportData;
    await trnAction('report-match', { roundId, matchId, winner }, '✅ Đã lưu kết quả trận đấu!');
    ts.modal = null;
    render();
  };

  window.trnRefreshClick = async function () {
    const btn = document.getElementById('trn-refresh-btn');
    if (btn) btn.classList.add('loading');
    notice('🔄 Đang cập nhật dữ liệu giải đấu...');
    try {
      await refreshTournament();
      notice('✅ Đã cập nhật dữ liệu giải đấu mới nhất!');
    } catch (e) {
      notice('Lỗi cập nhật: ' + e.message);
    } finally {
      if (btn) btn.classList.remove('loading');
    }
  };

  window.trnResetMatchConfirm = async function (roundId, matchId) {
    if (!confirm('Bạn có chắc muốn ĐẶT LẠI trận đấu này về trạng thái chờ đấu?\nKết quả cũ và bản ghi trận sẽ được xóa để có thể thi đấu lại.')) return;
    try {
      const updated = await trnApi('POST', '/tournaments/' + ts.current.id + '/reset-match', { roundId, matchId });
      if (updated && updated.id) {
        ts.current = updated;
        render();
      }
      notice('↺ Đã đặt lại trận đấu về trạng thái chờ đấu!');
      await refreshTournament();
    } catch (e) {
      notice('Lỗi đặt lại trận: ' + e.message);
    }
  };

  window.trnResetRoundConfirm = async function (roundId) {
    if (!confirm('Bạn có chắc muốn ĐẶT LẠI TOÀN BỘ các trận trong vòng này về chờ đấu?\nTất cả kết quả và bản ghi của vòng này sẽ được xóa để thi đấu lại.')) return;
    try {
      const updated = await trnApi('POST', '/tournaments/' + ts.current.id + '/reset-round', { roundId });
      if (updated && updated.id) {
        ts.current = updated;
        render();
      }
      notice('↺ Đã đặt lại toàn bộ các trận trong vòng về chờ đấu!');
      await refreshTournament();
    } catch (e) {
      notice('Lỗi đặt lại vòng: ' + e.message);
    }
  };

  // ─── 4. ARENA LIVE & REPLAY INTEGRATION ───────────────────────────────────────
  window.trnWatchLive = function (tid, mid) {
    ts.activeTid = tid;
    ts.activeMid = mid;
    state.arenaMode = 'tournament-live';
    state.page = 'arena';
    clearInterval(ts.livePollTimer);
    ts.livePollTimer = setInterval(pollTournamentLive, 600);
    pollTournamentLive();
    go('arena');
  };

  window.trnWatchReplay = async function (tid, mid) {
    ts.activeTid = tid;
    ts.activeMid = mid;
    notice('Đang tải dữ liệu phát lại trận đấu...');
    try {
      const rp = await trnApi('GET', '/tournaments/' + tid + '/matches/' + mid + '/replay');
      ts.replayData = rp;
      ts.replayFrame = 0;
      ts.replayPlaying = false;
      state.arenaMode = 'tournament-replay';
      state.page = 'arena';
      clearInterval(ts.replayTimer);
      go('arena');
    } catch (e) {
      notice('Lỗi tải replay: ' + e.message);
    }
  };

  async function pollTournamentLive() {
    if (state.page !== 'arena' || state.arenaMode !== 'tournament-live') {
      clearInterval(ts.livePollTimer);
      return;
    }
    try {
      const d = await trnApi('GET', '/tournaments/' + ts.activeTid + '/matches/' + ts.activeMid + '/live');
      ts.liveData = d;
      render();
      if (d.status === 'completed') {
        clearInterval(ts.livePollTimer);
        notice('🏁 Trận đấu đã kết thúc! Chuyển sang xem lại...');
        refreshTournament();
        setTimeout(() => {
          trnWatchReplay(ts.activeTid, ts.activeMid);
        }, 1200);
      }
    } catch (e) {
      console.warn('Live poll error:', e.message);
    }
  }

  // Render Arena when in Tournament Mode
  window.renderTournamentArena = function () {
    if (state.arenaMode === 'tournament-live') {
      return renderTournamentArenaLive();
    } else if (state.arenaMode === 'tournament-replay') {
      return renderTournamentArenaReplay();
    }
    return '';
  };

  function renderTournamentArenaLive() {
    const d = ts.liveData;
    const admin = isAdmin();
    if (!d) {
      return header('ĐẤU TRƯỜNG GIẢI ĐẤU', 'Trực tiếp trận đấu', 'Đang kết nối đến đấu trường...', `<button class="btn secondary" onclick="trnReturnFromArena()">← Trở về Giải đấu</button>`) + `
        <div class="card empty" style="padding:48px">
          <div style="font-size:36px">⚔</div>
          <h3>Đang kết nối tín hiệu trực tiếp...</h3>
        </div>
      `;
    }

    const nameA = d.players?.a || 'Đấu thủ A';
    const nameB = d.players?.b || 'Đấu thủ B';
    const isPaused = !!d.paused;
    const currentTurn = d.turn || 0;
    const maxMoves = d.maxMoves || 200;
    const pct = Math.min(100, Math.round((currentTurn / maxMoves) * 100));

    // Board snapshot
    const boardHtml = renderLiveGameBoard(d.board, d.lastMove);

    return `
      <div class="page-heading">
        <div>
          <div class="eyebrow" style="color:var(--accent)">GIẢI ĐẤU OTT · TRỰC TIẾP</div>
          <h1>Đấu trường Trực tiếp: ${esc(nameA)} vs ${esc(nameB)}</h1>
          <p class="intro">Trận đấu đang diễn ra theo thời gian thực trên bàn cờ Rock–Paper–Scissors 8×8.</p>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn secondary" onclick="trnReturnFromArena()">← Trở về Giải đấu</button>
        </div>
      </div>

      <div class="toolbar" style="display:flex;justify-content:space-between;align-items:center;background:var(--surface,#171d1e);padding:10px 16px;border-radius:10px">
        <div style="display:flex;align-items:center;gap:12px">
          ${isPaused ? '<span class="chip orangec">⏸ ĐANG TẠM DỪNG</span>' : '<span class="chip" style="background:#24c623;color:#000;font-weight:900;animation:pulse 1.2s infinite">🔴 TRỰC TIẾP (LIVE)</span>'}
          <span style="font-weight:700">Lượt: ${currentTurn} / ${maxMoves}</span>
        </div>

        ${admin ? `
          <div style="display:flex;align-items:center;gap:8px">
            <span class="small muted">Trọng tài:</span>
            ${isPaused ? `
              <button class="btn sm" onclick="trnLiveAction('resume-match')">▶ Tiếp tục trận</button>
            ` : `
              <button class="btn sm secondary" onclick="trnLiveAction('pause-match')">⏸ Tạm dừng trận</button>
            `}
            <button class="btn sm danger" onclick="trnLiveAction('cancel-match')">🛑 Hủy trận</button>
          </div>
        ` : ''}
      </div>

      <div class="arena-layout" style="margin-top:20px">
        <div class="card arena-stage">
          <div class="fightbar">
            <div class="fighter">
              ${avatar(nameA.slice(0, 2).toUpperCase(), 'orange')}
              <b>${esc(nameA)}</b>
              <small>🟡 Gold · Mục tiêu h8 · Quân còn: ${countBoardPieces(d.board, 'p1')}</small>
            </div>
            <div class="vs">VS</div>
            <div class="fighter">
              ${avatar(nameB.slice(0, 2).toUpperCase(), 'purple')}
              <b>${esc(nameB)}</b>
              <small>🔵 Blue · Mục tiêu a1 · Quân còn: ${countBoardPieces(d.board, 'p2')}</small>
            </div>
          </div>

          <div class="boardwrap">
            ${boardHtml}
          </div>

          <div class="progress" style="margin-top:20px"><div style="width:${pct}%"></div></div>
          <div class="row between small" style="margin-top:6px">
            <span class="muted">Tiến trình trận đấu: ${currentTurn} / ${maxMoves} lượt</span>
            <span class="muted">${d.lastMove ? `${d.lastMove.owner === 'p1' ? 'Gold' : 'Blue'}: ${ottCoord(d.lastMove.from)} → ${ottCoord(d.lastMove.to)}${d.lastMove.capture ? ' (Ăn quân!)' : ''}` : 'Sẵn sàng'}</span>
          </div>
        </div>

        <div>
          <div class="card">
            <div class="section-head">
              <h3>Diễn biến gần nhất</h3>
              <span class="small muted">${(d.events || []).length} nước đi</span>
            </div>
            <div class="results" style="max-height:480px;overflow-y:auto">
              ${(d.events || []).slice().reverse().slice(0, 15).map(e => `
                <div class="logline" style="font-size:12px">
                  <strong>${e.owner === 'p1' ? '🟡 Gold' : '🔵 Blue'}</strong> ${OTT_SIGNS[e.unit] || e.unit} 
                  ${ottCoord(e.from)} → ${ottCoord(e.to)} 
                  ${e.capture ? ' · ⚔ <b>Ăn ' + (OTT_SIGNS[e.captured] || e.captured) + '</b>' : ''}
                </div>
              `).join('') || '<div class="logline muted">Trận đấu đang chuẩn bị khai cuộc...</div>'}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderTournamentArenaReplay() {
    const rp = ts.replayData;
    if (!rp) return '<div class="card empty"><h3>Không tìm thấy replay trận đấu</h3></div>';
    const totalFrames = (rp.events || []).length;
    const curFrame = Math.min(ts.replayFrame, totalFrames);
    const snap = rp.snapshots[curFrame] || rp.snapshots[0];
    const last = rp.events[curFrame - 1];
    const nameA = rp.players?.a || 'Đấu thủ A';
    const nameB = rp.players?.b || 'Đấu thủ B';
    const pct = totalFrames > 0 ? (curFrame / totalFrames) * 100 : 0;

    const winnerTxt = rp.winner === 'p1' ? '👑 Gold (' + nameA + ') thắng!' : rp.winner === 'p2' ? '👑 Blue (' + nameB + ') thắng!' : '🤝 Hòa trận';

    return `
      <div class="page-heading">
        <div>
          <div class="eyebrow" style="color:var(--accent)">GIẢI ĐẤU OTT · PHÁT LẠI (REPLAY)</div>
          <h1>Xem lại trận: ${esc(nameA)} vs ${esc(nameB)}</h1>
          <p class="intro">Kết quả chung cuộc: <b style="color:var(--accent)">${winnerTxt}</b> (${esc(rp.reason || 'Kết thúc')}) · Tổng số lượt: ${rp.turns || totalFrames}</p>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn secondary" onclick="trnReturnFromArena()">← Trở về Giải đấu</button>
        </div>
      </div>

      <div class="arena-layout">
        <div class="card arena-stage">
          <div class="fightbar">
            <div class="fighter">
              ${avatar(nameA.slice(0, 2).toUpperCase(), 'orange')}
              <b>${esc(nameA)}</b>
              <small>🟡 Gold · h8</small>
            </div>
            <div class="vs">VS</div>
            <div class="fighter">
              ${avatar(nameB.slice(0, 2).toUpperCase(), 'purple')}
              <b>${esc(nameB)}</b>
              <small>🔵 Blue · a1</small>
            </div>
          </div>

          <div class="boardwrap">
            ${renderReplayGameBoard(snap, last)}
          </div>

          <div class="replay-controls">
            <div class="row between small">
              <span class="muted">Lượt ${curFrame} / ${totalFrames}</span>
              <span class="muted">${last ? `${last.owner === 'p1' ? 'Gold' : 'Blue'}: ${ottCoord(last.from)} → ${ottCoord(last.to)}${last.capture ? ' · ĂN QUÂN' : ''}` : 'Khởi đầu'}</span>
            </div>
            <div class="progress"><div style="width:${pct}%"></div></div>
            <div class="controlbar">
              <button onclick="trnReplayStep(-1)" title="Lùi 1 nước">◂◂</button>
              <button class="primary" onclick="trnReplayToggle()" title="Phát hoặc Dừng">${svg(ts.replayPlaying ? 'pause' : 'play')}</button>
              <button onclick="trnReplayStep(1)" title="Tiến 1 nước">▸▸</button>
              <button onclick="trnReplayCycleSpeed()">${ts.replaySpeed}×</button>
              <button onclick="trnReplayReset()" title="Về đầu">${svg('reset', 15)}</button>
            </div>
          </div>
        </div>

        <div>
          <div class="card">
            <div class="section-head">
              <h3>Nhật ký nước đi</h3>
              <span class="small muted">${curFrame} lượt</span>
            </div>
            <div class="results" style="max-height:480px;overflow-y:auto">
              ${(rp.events || []).slice(0, curFrame).reverse().slice(0, 15).map((e, i) => `
                <div class="logline" style="font-size:12px">
                  <span>#${String(curFrame - i).padStart(3, '0')}</span>
                  <strong>${e.owner === 'p1' ? '🟡 Gold' : '🔵 Blue'}</strong> ${OTT_SIGNS[e.unit] || e.unit} 
                  ${ottCoord(e.from)} → ${ottCoord(e.to)} 
                  ${e.capture ? ' · ⚔ <b>Ăn ' + (OTT_SIGNS[e.captured] || e.captured) + '</b>' : ''}
                </div>
              `).join('') || '<div class="logline muted">Nhấn ▶ để bắt đầu phát lại trận đấu.</div>'}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderLiveGameBoard(b, lastMove) {
    if (!b) return '<div class="card empty" style="aspect-ratio:1;display:grid;place-items:center">Đang tải bàn cờ...</div>';
    const isFrom = (r, c) => lastMove && lastMove.from && lastMove.from[0] === r && lastMove.from[1] === c;
    const isTo = (r, c) => lastMove && lastMove.to && lastMove.to[0] === r && lastMove.to[1] === c;

    return `
      <div class="ott-board-shell">
        <div class="ott-files">${'abcdefgh'.split('').map(x => `<span>${x}</span>`).join('')}</div>
        <div class="gameboard ott-board">
          ${b.flatMap((row, r) => row.map((p, c) => `
            <div class="square ${(r + c) % 2 ? 'alt' : ''} ${r === 0 && c === 7 ? 'goal-blue' : ''} ${r === 7 && c === 0 ? 'goal-gold' : ''} ${isFrom(r, c) ? 'from-sq' : ''} ${isTo(r, c) ? 'to-sq' : ''}" style="${isTo(r,c) ? 'background:#d5ff6255!important;' : isFrom(r,c) ? 'background:#ff8c4244!important;' : ''}">
              ${c === 0 ? `<span class="rank-label">${8 - r}</span>` : ''}
              ${(r === 0 && c === 7 || r === 7 && c === 0) ? '<span class="goal-marker">⚑</span>' : ''}
              ${p ? `<span class="ott-piece ${p.owner} ${p.type}">${pieceSVG(p.type, p.owner)}</span>` : ''}
            </div>
          `)).join('')}
        </div>
        <div class="board-caption">
          <span>🟡 Gold goal → h8</span>
          <span>🔵 Blue goal → a1</span>
        </div>
      </div>
    `;
  }

  function renderReplayGameBoard(b, lastMove) {
    if (!b) return '';
    const isFrom = (r, c) => lastMove && lastMove.from && lastMove.from[0] === r && lastMove.from[1] === c;
    const isTo = (r, c) => lastMove && lastMove.to && lastMove.to[0] === r && lastMove.to[1] === c;

    return `
      <div class="ott-board-shell">
        <div class="ott-files">${'abcdefgh'.split('').map(x => `<span>${x}</span>`).join('')}</div>
        <div class="gameboard ott-board">
          ${b.flatMap((row, r) => row.map((p, c) => `
            <div class="square ${(r + c) % 2 ? 'alt' : ''} ${r === 0 && c === 7 ? 'goal-blue' : ''} ${r === 7 && c === 0 ? 'goal-gold' : ''}" style="${isTo(r,c) ? 'background:#d5ff6255!important;' : isFrom(r,c) ? 'background:#ff8c4244!important;' : ''}">
              ${c === 0 ? `<span class="rank-label">${8 - r}</span>` : ''}
              ${(r === 0 && c === 7 || r === 7 && c === 0) ? '<span class="goal-marker">⚑</span>' : ''}
              ${p ? `<span class="ott-piece ${p.owner} ${p.type}">${pieceSVG(p.type, p.owner)}</span>` : ''}
            </div>
          `)).join('')}
        </div>
        <div class="board-caption">
          <span>🟡 Gold goal → h8</span>
          <span>🔵 Blue goal → a1</span>
        </div>
      </div>
    `;
  }

  function countBoardPieces(b, owner) {
    if (!b) return 0;
    return b.flat().filter(p => p && p.owner === owner).length;
  }

  window.trnLiveAction = async function (action) {
    if (!ts.activeTid || !ts.activeMid) return;
    try {
      await trnApi('POST', '/tournaments/' + ts.activeTid + '/' + action, { matchId: ts.activeMid });
      notice('Thao tác trọng tài hoàn tất.');
      pollTournamentLive();
    } catch (e) {
      notice('Lỗi: ' + e.message);
    }
  };

  window.trnReturnFromArena = function () {
    clearInterval(ts.livePollTimer);
    clearInterval(ts.replayTimer);
    state.arenaMode = 'normal';
    go('tournaments');
  };

  window.trnReplayStep = function (delta) {
    if (!ts.replayData) return;
    const max = (ts.replayData.events || []).length;
    ts.replayFrame = Math.max(0, Math.min(max, ts.replayFrame + delta));
    render();
  };

  window.trnReplayToggle = function () {
    if (!ts.replayData) return;
    const max = (ts.replayData.events || []).length;
    if (ts.replayFrame >= max) ts.replayFrame = 0;
    ts.replayPlaying = !ts.replayPlaying;
    clearInterval(ts.replayTimer);
    if (ts.replayPlaying) {
      ts.replayTimer = setInterval(() => {
        if (!ts.replayPlaying || state.arenaMode !== 'tournament-replay') {
          clearInterval(ts.replayTimer);
          return;
        }
        if (ts.replayFrame >= max) {
          ts.replayPlaying = false;
          clearInterval(ts.replayTimer);
          render();
          return;
        }
        trnReplayStep(1);
      }, 700 / ts.replaySpeed);
    }
    render();
  };

  window.trnReplayReset = function () {
    ts.replayFrame = 0;
    ts.replayPlaying = false;
    clearInterval(ts.replayTimer);
    render();
  };

  window.trnReplayCycleSpeed = function () {
    ts.replaySpeed = ts.replaySpeed === 1 ? 2 : ts.replaySpeed === 2 ? 4 : 1;
    if (ts.replayPlaying) {
      trnReplayToggle();
      trnReplayToggle();
    } else {
      render();
    }
  };

  // Auto-polling: Tự động cập nhật khi trận đấu xong
  let lastCompletedCount = -1;
  let lastChampionAnnounced = null;

  setInterval(async () => {
    if (state.page !== 'tournaments' || !ts.current) return;
    const t = ts.current;
    const hasRunning = (t.rounds || []).some(r => (r.matches || []).some(m => m.status === 'running'));
    const isActive = t.status === 'active';

    if (hasRunning || isActive) {
      try {
        const updated = await trnApi('GET', '/tournaments/' + t.id);
        const oldCompleted = (t.rounds || []).reduce((acc, r) => acc + (r.matches || []).filter(m => m.status === 'completed').length, 0);
        const newCompleted = (updated.rounds || []).reduce((acc, r) => acc + (r.matches || []).filter(m => m.status === 'completed').length, 0);

        let dataChanged = false;
        if (JSON.stringify(t.rounds) !== JSON.stringify(updated.rounds) || t.status !== updated.status || t.champion !== updated.champion) {
          dataChanged = true;
        }

        ts.current = updated;
        if (updated.format === 'round-robin') {
          try {
            ts.standings = await trnApi('GET', '/tournaments/' + updated.id + '/standings');
          } catch {}
        }

        if (newCompleted > oldCompleted && oldCompleted >= 0) {
          notice('🏁 Trận đấu vừa hoàn tất! Đã tự động cập nhật kết quả & lịch thi đấu.');
        }

        if (updated.champion && updated.champion !== lastChampionAnnounced) {
          lastChampionAnnounced = updated.champion;
          notice('👑 Chúc mừng ' + updated.champion + ' đã xuất sắc vô địch giải đấu!');
        }

        if (dataChanged) {
          render();
        }
      } catch (e) {
        // quiet catch
      }
    }
  }, 2000);

  // Initial tournament load on startup
  loadTournaments();
})();
