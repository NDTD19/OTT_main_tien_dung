/* ================================================================
   OTT Arena — Tournament Manager Frontend
   Pages: list, detail (participants, rounds, standings, bracket, logs)
   ================================================================ */
'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  page: 'list',        // 'list' | 'detail'
  tournaments: [],
  current: null,       // current tournament object
  tab: 'participants', // detail tabs
  standings: [],
  loading: false,
  user: null,          // { username, role, token }
};

// ─── Auth ─────────────────────────────────────────────────────────────────────
function loadAuth() {
  const token = localStorage.getItem('ott_token');
  const username = localStorage.getItem('ott_username');
  const role = localStorage.getItem('ott_role') || 'user';
  if (token && username) state.user = { token, username, role };
}
function saveAuth(data) {
  state.user = { token: data.token, username: data.username, role: data.role || 'user' };
  localStorage.setItem('ott_token', data.token);
  localStorage.setItem('ott_username', data.username);
  localStorage.setItem('ott_role', data.role || 'user');
}
function clearAuth() {
  state.user = null;
  localStorage.removeItem('ott_token');
  localStorage.removeItem('ott_username');
  localStorage.removeItem('ott_role');
}
function authHeaders() {
  return state.user ? { 'Authorization': 'Bearer ' + state.user.token } : {};
}
function isAdmin() { return state.user && (state.user.role === 'admin' || state.user.username === 'admin'); }

// ─── API ──────────────────────────────────────────────────────────────────────
async function api(method, path, body) {
  try {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const r = await fetch('/api' + path, opts);
    const data = await r.json();
    if (!r.ok) throw Object.assign(new Error(data.error || 'Request failed'), { data });
    return data;
  } catch (e) {
    if (e.message.includes('fetch')) throw new Error('Không thể kết nối server. Hãy đảm bảo server đang chạy.');
    throw e;
  }
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function openModal(title, bodyHTML, onConfirm) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHTML;
  document.getElementById('modal-overlay').classList.remove('hidden');
  if (onConfirm) window._modalConfirm = onConfirm;
}
function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.querySelector('.modal-box')?.classList.remove('wide');
  window._modalConfirm = null;
  stopViewer();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric' }) + ' ' +
         d.toLocaleTimeString('vi-VN', { hour:'2-digit', minute:'2-digit' });
}
function fmtDateShort(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('vi-VN', { day:'2-digit', month:'2-digit' });
}
function avatarColor(username) {
  const colors = ['#7c3aed','#2563eb','#059669','#d97706','#dc2626','#db2777'];
  let h = 0;
  for (const c of (username||'')) h = ((h<<5)-h)+c.charCodeAt(0);
  return colors[Math.abs(h) % colors.length];
}
function avatarInitials(username) {
  return (username || '?').slice(0,2).toUpperCase();
}
function statusLabel(s) {
  const m = { draft:'Bản Nháp', registration:'Đăng Ký', locked:'Đã Khóa', active:'Đang Diễn Ra', completed:'Kết Thúc', cancelled:'Đã Hủy' };
  return m[s] || s;
}
function formatLabel(f) { return f === 'elimination' ? '🗡 Đấu Loại' : '🔄 Vòng Tròn'; }
function winnerLabel(w, nameA, nameB) {
  if (!w) return '—';
  if (w === 'a') return nameA + ' thắng';
  if (w === 'b') return nameB + ' thắng';
  if (w === 'draw') return 'Hòa';
  if (w === 'bye') return 'BYE';
  return w;
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function go(page, data) {
  state.page = page;
  if (data) Object.assign(state, data);
  render();
}
function setTab(t) { state.tab = t; render(); }

// ─── Auth Actions ─────────────────────────────────────────────────────────────
async function doLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username')?.value.trim();
  const password = document.getElementById('login-password')?.value;
  try {
    const data = await api('POST', '/auth/login', { username, password });
    saveAuth(data);
    toast('Đăng nhập thành công! Xin chào ' + data.username, 'success');
    render();
  } catch (err) { toast(err.message, 'error'); }
}
async function doRegister(e) {
  e.preventDefault();
  const username = document.getElementById('reg-username')?.value.trim();
  const password = document.getElementById('reg-password')?.value;
  try {
    const data = await api('POST', '/auth/register', { username, password });
    saveAuth(data);
    toast('Đăng ký thành công! Vai trò: ' + (data.role || 'user'), 'success');
    render();
  } catch (err) { toast(err.message, 'error'); }
}
function doLogout() {
  clearAuth();
  toast('Đã đăng xuất', 'info');
  render();
}

// ─── Tournament Actions ───────────────────────────────────────────────────────
async function loadTournaments() {
  state.loading = true; render();
  try {
    state.tournaments = await api('GET', '/tournaments');
  } catch (e) { toast(e.message, 'error'); }
  state.loading = false; render();
}

async function loadTournament(id) {
  state.loading = true; render();
  try {
    state.current = await api('GET', '/tournaments/' + id);
    if (state.current.format === 'round-robin') {
      state.standings = await api('GET', '/tournaments/' + id + '/standings');
    }
    state.page = 'detail';
    if (state.tab === 'bracket' && state.current.format !== 'elimination') state.tab = 'participants';
    if (state.tab === 'standings' && state.current.format !== 'round-robin') state.tab = 'participants';
  } catch (e) { toast(e.message, 'error'); }
  state.loading = false; render();
}

async function doAction(path, body, successMsg) {
  try {
    const result = await api('POST', path, body);
    if (successMsg) toast(successMsg, 'success');
    if (state.current && path.startsWith('/tournaments/' + state.current.id)) {
      state.current = result;
      if (state.current.format === 'round-robin') {
        state.standings = await api('GET', '/tournaments/' + state.current.id + '/standings');
      }
    } else {
      await loadTournaments();
    }
    render();
    return result;
  } catch (e) { toast(e.message, 'error'); return null; }
}

// ─── Modals ───────────────────────────────────────────────────────────────────
function showCreateTournament() {
  openModal('Tạo Giải Đấu Mới', `
    <form id="create-form" onsubmit="submitCreateTournament(event)">
      <div class="form-group">
        <label class="form-label">Tên Giải Đấu *</label>
        <input class="form-input" id="trn-name" placeholder="VD: OTT Championship 2026" required maxlength="100">
      </div>
      <div class="form-group">
        <label class="form-label">Mô Tả</label>
        <textarea class="form-textarea" id="trn-desc" placeholder="Mô tả ngắn về giải đấu..." maxlength="500"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Thể Thức Thi Đấu *</label>
        <select class="form-select" id="trn-format">
          <option value="round-robin">🔄 Vòng Tròn — Ai điểm cao nhất thắng (Thắng +3, Hòa +1, Thua +0)</option>
          <option value="elimination">🗡 Đấu Loại Trực Tiếp — Thua là dừng, lẻ người thì được BYE</option>
        </select>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Hủy</button>
        <button type="submit" class="btn btn-gold">🏆 Tạo Giải</button>
      </div>
    </form>
  `);
}

async function submitCreateTournament(e) {
  e.preventDefault();
  const name = document.getElementById('trn-name').value.trim();
  const description = document.getElementById('trn-desc').value.trim();
  const format = document.getElementById('trn-format').value;
  const result = await doAction('/tournaments', { name, description, format }, '✅ Tạo giải thành công!');
  if (result) { closeModal(); await loadTournaments(); }
}

function showReportMatch(t, round, match) {
  const pA = t.participants.find(p => p.userId === match.playerA);
  const pB = t.participants.find(p => p.userId === match.playerB);
  const nameA = pA?.username || match.playerA;
  const nameB = match.playerB === 'BYE' ? 'BYE' : (pB?.username || match.playerB);
  const botA = pA?.officialBotName || '—';
  const botB = pB?.officialBotName || '—';

  openModal(`Báo Cáo Kết Quả — ${round.name}`, `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:20px">
      <div style="text-align:center;flex:1">
        <div style="font-size:1.4rem;font-weight:900;color:#fff">${esc(nameA)}</div>
        <div style="font-size:0.78rem;color:var(--text-dim)">${esc(botA)}</div>
      </div>
      <div style="font-size:1rem;font-weight:800;color:var(--text-faint)">VS</div>
      <div style="text-align:center;flex:1">
        <div style="font-size:1.4rem;font-weight:900;color:#fff">${esc(nameB)}</div>
        <div style="font-size:0.78rem;color:var(--text-dim)">${esc(botB)}</div>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Kết Quả</label>
      <select class="form-select" id="report-winner">
        <option value="a">🏆 ${esc(nameA)} thắng</option>
        <option value="b">🏆 ${esc(nameB)} thắng</option>
        ${match.playerB !== 'BYE' && t.format !== 'elimination' ? '<option value="draw">🤝 Hòa</option>' : ''}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Match ID (tham chiếu — tùy chọn)</label>
      <input class="form-input" id="report-matchref" placeholder="M-XXXXXXXX">
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Hủy</button>
      <button class="btn btn-success" onclick="submitReportMatch('${esc(t.id)}','${esc(round.id)}','${esc(match.id)}')">✅ Xác Nhận Kết Quả</button>
    </div>
  `);
}

async function submitReportMatch(tid, roundId, matchId) {
  const winner = document.getElementById('report-winner').value;
  const matchRef = document.getElementById('report-matchref')?.value.trim() || null;
  const result = await doAction('/tournaments/' + tid + '/report-match', { roundId, matchId, winner, matchRef }, '✅ Kết quả đã được cập nhật!');
  if (result) closeModal();
}

function showScheduleMatch(t, round, match) {
  openModal('Lên Lịch Trận', `
    <div class="form-group">
      <label class="form-label">Thời Gian Thi Đấu</label>
      <input class="form-input" type="datetime-local" id="sched-dt">
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Hủy</button>
      <button class="btn btn-blue" onclick="submitSchedule('${esc(t.id)}','${esc(round.id)}','${esc(match.id)}')">📅 Lên Lịch</button>
    </div>
  `);
}

async function submitSchedule(tid, roundId, matchId) {
  const dt = document.getElementById('sched-dt').value;
  if (!dt) { toast('Vui lòng chọn thời gian', 'error'); return; }
  const result = await doAction('/tournaments/' + tid + '/schedule-match', { roundId, matchId, scheduledAt: dt }, '📅 Đã lên lịch!');
  if (result) closeModal();
}

function showCancelMatch(t, round, match) {
  openModal('Hủy Trận Đấu', `
    <p style="color:var(--text-dim);margin-bottom:14px">Bạn chắc chắn muốn hủy trận này?</p>
    <div class="form-group">
      <label class="form-label">Lý Do Hủy</label>
      <input class="form-input" id="cancel-reason" placeholder="VD: Người chơi không có mặt...">
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Quay Lại</button>
      <button class="btn btn-danger" onclick="submitCancelMatch('${esc(t.id)}','${esc(round.id)}','${esc(match.id)}')">🗑 Xác Nhận Hủy</button>
    </div>
  `);
}

async function submitCancelMatch(tid, roundId, matchId) {
  const reason = document.getElementById('cancel-reason').value.trim();
  const result = await doAction('/tournaments/' + tid + '/cancel-match', { roundId, matchId, reason }, '🗑 Đã hủy trận!');
  if (result) closeModal();
}

function showSetOfficialBot(t) {
  if (!state.user) { toast('Cần đăng nhập', 'error'); return; }
  openModal('Chọn Bot Chính Thức', `
    <p style="color:var(--text-dim);margin-bottom:14px">Nhập ID bài nộp của bạn:</p>
    <div class="form-group">
      <label class="form-label">Submission ID</label>
      <input class="form-input" id="bot-sub-id" placeholder="SUB-XXXXXXXX">
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Hủy</button>
      <button class="btn btn-primary" onclick="submitSetBot('${esc(t.id)}')">🤖 Xác Nhận Bot</button>
    </div>
  `);
}

async function submitSetBot(tid) {
  const submissionId = document.getElementById('bot-sub-id').value.trim();
  const result = await doAction('/tournaments/' + tid + '/set-official-bot', { submissionId, userId: state.user.username }, '🤖 Bot chính thức đã được chọn!');
  if (result) closeModal();
}

function showAnnounce(t) {
  openModal('Công Bố Kết Quả', `
    <div class="form-group">
      <label class="form-label">Nội Dung Thông Báo</label>
      <textarea class="form-textarea" id="announce-msg" placeholder="VD: Chúc mừng người chiến thắng!...">${esc(t.announcement||'')}</textarea>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Hủy</button>
      <button class="btn btn-gold" onclick="submitAnnounce('${esc(t.id)}')">📢 Công Bố</button>
    </div>
  `);
}

async function submitAnnounce(tid) {
  const message = document.getElementById('announce-msg').value.trim();
  const result = await doAction('/tournaments/' + tid + '/announce', { message }, '📢 Đã công bố!');
  if (result) closeModal();
}

// ─── Render Functions ─────────────────────────────────────────────────────────

function render() {
  renderNav();
  renderAuthStatus();
  if (state.loading) {
    document.getElementById('main').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚙️</div>
        <div class="empty-title">Đang tải...</div>
      </div>`;
    return;
  }
  if (state.page === 'list') renderList();
  else if (state.page === 'detail' && state.current) renderDetail();
}

function renderNav() {
  const tabs = document.getElementById('nav-tabs');
  if (!tabs) return;
  tabs.innerHTML = `
    <button class="nav-tab ${state.page === 'list' ? 'active' : ''}" onclick="go('list')">📋 Tất Cả Giải</button>
    ${state.page === 'detail' && state.current ? `<button class="nav-tab active">🏟 ${esc(state.current.name)}</button>` : ''}
  `;
}

function renderAuthStatus() {
  const el = document.getElementById('auth-status');
  if (!el) return;
  if (state.user) {
    el.innerHTML = `
      <div class="auth-pill">
        <span>👤</span>
        <span class="username">${esc(state.user.username)}</span>
        <span class="role-badge ${isAdmin()?'role-admin':'role-user'}">${isAdmin()?'Admin':'User'}</span>
        <button class="btn btn-ghost btn-sm" onclick="doLogout()">Đăng xuất</button>
      </div>`;
  } else {
    el.innerHTML = `
      <form class="login-bar" onsubmit="doLogin(event)">
        <input id="login-username" placeholder="Username" autocomplete="username" required>
        <input id="login-password" type="password" placeholder="Password" autocomplete="current-password" required>
        <button class="btn btn-primary btn-sm" type="submit">Đăng nhập</button>
        <button class="btn btn-ghost btn-sm" type="button" onclick="doRegisterPrompt()">Đăng ký</button>
      </form>`;
  }
}

function doRegisterPrompt() {
  openModal('Đăng Ký Tài Khoản', `
    <form onsubmit="doRegister(event)">
      <div class="form-group">
        <label class="form-label">Username</label>
        <input class="form-input" id="reg-username" placeholder="VD: player01" required autocomplete="username" pattern="[a-z0-9_]{2,32}">
        <small style="color:var(--text-faint);font-size:0.75rem">2-32 ký tự, chữ thường, số, dấu _</small>
      </div>
      <div class="form-group">
        <label class="form-label">Password</label>
        <input class="form-input" id="reg-password" type="password" placeholder="Mật khẩu" required autocomplete="new-password">
      </div>
      <p style="color:var(--text-faint);font-size:0.78rem;margin-bottom:14px">💡 Người đầu tiên đăng ký sẽ là Admin. Username "admin" luôn là Admin.</p>
      <div class="modal-footer">
        <button class="btn btn-ghost" type="button" onclick="closeModal()">Hủy</button>
        <button class="btn btn-primary" type="submit">Đăng Ký</button>
      </div>
    </form>
  `);
}

// ─── List Page ────────────────────────────────────────────────────────────────
function renderList() {
  const main = document.getElementById('main');
  const hasList = state.tournaments.length > 0;
  main.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <div class="eyebrow">OTT ARENA</div>
        <h1>🏆 Quản Lý Giải Đấu</h1>
        <p>Tổ chức và quản lý các giải đấu Bot — Vòng Tròn & Đấu Loại Trực Tiếp</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-ghost" onclick="loadTournaments()">🔄 Tải Lại</button>
        ${isAdmin() ? `<button class="btn btn-gold" onclick="showCreateTournament()">+ Tạo Giải</button>` : ''}
      </div>
    </div>

    ${!hasList ? `
      <div class="empty-state" style="padding:80px 20px">
        <div class="empty-icon">🏆</div>
        <div class="empty-title">Chưa có giải đấu nào</div>
        <div class="empty-desc">${isAdmin() ? 'Nhấn "Tạo Giải" để tạo giải đấu đầu tiên.' : 'Chưa có giải đấu nào được tạo. Hãy đợi Admin tạo giải.'}</div>
      </div>
    ` : `
      <div class="tournament-grid">
        ${state.tournaments.map(t => renderTournamentCard(t)).join('')}
      </div>
    `}
  `;
}

function renderTournamentCard(t) {
  return `
    <div class="tournament-card" onclick="loadTournament('${esc(t.id)}')">
      <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
        <div class="tc-badge ${statusForClass(t.status)}">${statusDot(t.status)} ${statusLabel(t.status)}</div>
        <div class="tc-badge ${t.format==='elimination'?'format-elim':'format-rr'}">${formatLabel(t.format)}</div>
      </div>
      <div class="tc-name">${esc(t.name)}</div>
      ${t.description ? `<div class="tc-desc">${esc(t.description.slice(0,120))}${t.description.length>120?'...':''}</div>` : ''}
      <div class="tc-meta">
        <span class="tc-tag">📅 ${fmtDateShort(t.createdAt)}</span>
        <span class="tc-tag">👤 ${t.createdBy}</span>
        <span class="tc-tag">🎮 ${t.participantCount} người</span>
      </div>
      ${t.champion ? `<div style="margin-top:12px;padding:8px 12px;border-radius:8px;background:var(--gold-dim);color:var(--gold);font-weight:700;font-size:0.82rem">👑 Vô Địch: ${esc(t.champion)}</div>` : ''}
      <div class="tc-footer">
        <span class="tc-participants">${t.id}</span>
        <span class="tc-arrow">→</span>
      </div>
    </div>
  `;
}

function statusDot(s) {
  const map = { draft:'⬜', registration:'🔵', active:'🟢', completed:'🏅', cancelled:'🔴', locked:'🔒' };
  return map[s] || '⬜';
}
function statusForClass(s) {
  const m = { draft:'status-draft', registration:'status-registration', active:'status-active', completed:'status-completed', cancelled:'status-cancelled', locked:'status-locked' };
  return m[s] || 'status-draft';
}

// ─── Detail Page ──────────────────────────────────────────────────────────────
function renderDetail() {
  const t = state.current;
  const main = document.getElementById('main');
  const myParticipant = t.participants?.find(p => p.userId === state.user?.username);
  const detailTabs = [
    ['participants','👥 Người Tham Gia'],
    ['rounds','⚔ Vòng Đấu'],
    ...(t.format === 'round-robin' ? [['standings','📊 Bảng Xếp Hạng']] : [['bracket','🗺 Sơ Đồ']]),
    ['logs','📋 Nhật Ký'],
  ];

  main.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <div class="eyebrow">
          <button class="btn btn-ghost btn-sm" onclick="go('list')" style="margin-right:8px">← Quay Lại</button>
          ${esc(t.id)}
        </div>
        <h1>${esc(t.name)}</h1>
        <p style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <span class="tc-badge ${statusForClass(t.status)}" style="display:inline-flex">${statusDot(t.status)} ${statusLabel(t.status)}</span>
          <span class="tc-badge ${t.format==='elimination'?'format-elim':'format-rr'}" style="display:inline-flex">${formatLabel(t.format)}</span>
          <span style="color:var(--text-dim);font-size:0.85rem">Tạo bởi: ${esc(t.createdBy)} · ${fmtDate(t.createdAt)}</span>
        </p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-ghost btn-sm" onclick="loadTournament('${esc(t.id)}')">🔄 Cập nhật lại</button>
      </div>
    </div>

    ${t.announcement ? `<div class="announcement-box"><div class="announcement-header">📢 Thông Báo Chính Thức</div><div class="announcement-text">${esc(t.announcement)}</div></div>` : ''}
    ${t.champion ? `<div class="champion-banner"><div class="champion-crown">👑</div><div class="champion-text"><div class="label">Nhà Vô Địch</div><div class="name">${esc(t.champion)}</div></div></div>` : ''}

    <div class="detail-layout">
      <div class="detail-main">
        <div class="tabs">${detailTabs.map(([tab, label]) => `<button class="tab ${state.tab===tab?'active':''}" onclick="setTab('${tab}')">${label}</button>`).join('')}</div>
        <div id="tab-content"></div>
      </div>
      <div class="sidebar">
        ${renderInfoSidebar(t)}
        ${renderPlayerSidebar(t, myParticipant)}
        ${isAdmin() ? renderAdminSidebar(t) : ''}
      </div>
    </div>
  `;

  renderTabContent();
}

function renderInfoSidebar(t) {
  const approved = (t.participants||[]).filter(p=>p.approved).length;
  const withBot  = (t.participants||[]).filter(p=>p.officialBot).length;
  const total    = (t.participants||[]).length;
  return `
    <div class="sidebar-card">
      <h3><span class="icon">ℹ</span> Thông Tin Giải</h3>
      <div class="info-row"><span class="info-label">Trạng thái</span><span class="info-value">${statusLabel(t.status)}</span></div>
      <div class="info-row"><span class="info-label">Thể thức</span><span class="info-value">${formatLabel(t.format)}</span></div>
      <div class="info-row"><span class="info-label">Đăng ký</span><span class="info-value">${t.registrationOpen?'✅ Mở':'❌ Đóng'}</span></div>
      <div class="info-row"><span class="info-label">Bài nộp</span><span class="info-value">${t.submissionsLocked?'🔒 Đã khóa':'🔓 Mở'}</span></div>
      <div class="info-row"><span class="info-label">Người đăng ký</span><span class="info-value">${total}</span></div>
      <div class="info-row"><span class="info-label">Đã duyệt</span><span class="info-value">${approved}</span></div>
      <div class="info-row"><span class="info-label">Có bot</span><span class="info-value">${withBot}</span></div>
      <div class="info-row"><span class="info-label">Số vòng</span><span class="info-value">${(t.rounds||[]).length}</span></div>
      ${t.champion ? `<div class="info-row"><span class="info-label">Vô địch</span><span class="info-value" style="color:var(--gold)">👑 ${esc(t.champion)}</span></div>` : ''}
    </div>
  `;
}

function renderPlayerSidebar(t, myP) {
  if (!state.user) return `
    <div class="sidebar-card">
      <h3><span class="icon">🔐</span> Tài Khoản</h3>
      <p style="color:var(--text-dim);font-size:0.85rem;margin-bottom:12px">Đăng nhập để tham gia giải đấu và chọn bot chính thức.</p>
    </div>
  `;
  return `
    <div class="sidebar-card">
      <h3><span class="icon">🎮</span> Của Bạn</h3>
      ${!myP ? `
        <p style="color:var(--text-dim);font-size:0.85rem;margin-bottom:12px">Bạn chưa tham gia giải này.</p>
        ${t.registrationOpen && t.status === 'registration' ? `<button class="btn btn-primary" style="width:100%" onclick="doAction('/tournaments/${esc(t.id)}/register', {}, '✅ Đăng ký thành công!')">✋ Đăng Ký Tham Gia</button>` : ''}
      ` : `
        <div class="info-row"><span class="info-label">Trạng thái</span><span class="info-value">${myP.approved?'<span class="approved-badge">✅ Đã duyệt</span>':'<span class="pending-badge">⏳ Chờ duyệt</span>'}</span></div>
        <div class="info-row"><span class="info-label">Bot chính thức</span><span class="info-value">${myP.officialBotName?'🤖 '+esc(myP.officialBotName):'<span style="color:var(--red)">Chưa chọn</span>'}</span></div>
        ${!t.submissionsLocked ? `<button class="btn btn-blue" style="width:100%;margin-top:12px" onclick="showSetOfficialBot(state.current)">🤖 Chọn Bot Chính Thức</button>` : `<p style="color:var(--text-faint);font-size:0.8rem;margin-top:10px;text-align:center">🔒 Bài nộp đã khóa</p>`}
      `}
    </div>
  `;
}

function renderAdminSidebar(t) {
  const s = t.status;
  return `
    <div class="sidebar-card">
      <h3><span class="icon">⚙</span> Quản Trị</h3>
      <div class="admin-actions">
        ${!t.registrationOpen && s !== 'completed' && s !== 'cancelled' ? `<button class="admin-action-btn success" onclick="doAction('/tournaments/${esc(t.id)}/open-registration',{},'✅ Đã mở đăng ký!')"><span class="action-btn-icon">📝</span> Mở Đăng Ký</button>` : ''}
        ${t.registrationOpen ? `<button class="admin-action-btn" onclick="doAction('/tournaments/${esc(t.id)}/close-registration',{},'✅ Đã đóng đăng ký!')"><span class="action-btn-icon">🚪</span> Đóng Đăng Ký</button>` : ''}
        ${!t.submissionsLocked && (s==='registration'||s==='active') ? `<button class="admin-action-btn gold" onclick="doAction('/tournaments/${esc(t.id)}/lock-submissions',{},'🔒 Đã khóa bài nộp!')"><span class="action-btn-icon">🔒</span> Khóa Bài Nộp</button>` : ''}
        ${t.submissionsLocked ? `<button class="admin-action-btn" onclick="doAction('/tournaments/${esc(t.id)}/unlock-submissions',{},'🔓 Đã mở lại!')"><span class="action-btn-icon">🔓</span> Mở Lại Bài Nộp</button>` : ''}
        ${(s!=='completed'&&s!=='cancelled') ? `<button class="admin-action-btn success" onclick="confirmGenerateRounds()"><span class="action-btn-icon">⚡</span> Tạo Vòng Đấu</button>` : ''}
        ${(s==='active'||s==='completed') ? `<button class="admin-action-btn gold" onclick="showAnnounce(state.current)"><span class="action-btn-icon">📢</span> Công Bố Kết Quả</button>` : ''}
        ${s!=='cancelled'&&s!=='completed' ? `<button class="admin-action-btn" onclick="confirmCancel()"><span class="action-btn-icon">🛑</span> Hủy Giải</button>` : ''}
        <button class="admin-action-btn danger" onclick="confirmDeleteTournament('${esc(t.id)}')"><span class="action-btn-icon">🗑</span> Xóa Giải Đấu</button>
      </div>
    </div>
  `;
}

function confirmGenerateRounds() {
  const t = state.current;
  if (!t) return;
  const count = (t.participants || []).length;
  if (count < 2) {
    alert('Cần ít nhất 2 thí sinh tham gia giải đấu để tạo vòng! (Hiện có: ' + count + ' người)');
    return;
  }
  if (confirm('Bốc thăm và tạo lịch thi đấu cho ' + count + ' thí sinh tham gia?\n(Hệ thống sẽ tự động duyệt và gán bot cho các thí sinh)\nLưu ý: Không thể hoàn tác sau khi tạo vòng.')) {
    doAction('/tournaments/' + t.id + '/generate-rounds', {}, '⚡ Đã tạo vòng đấu thành công!');
  }
}

async function confirmDeleteTournament(id) {
  if (!confirm('Bạn có CHẮC CHẮN muốn XÓA VĨNH VIỄN giải đấu này?\nHành động này không thể hoàn tác!')) return;
  try {
    await api('POST', '/tournaments/' + id + '/delete', {});
    toast('🗑 Đã xóa giải đấu thành công!', 'success');
    state.current = null;
    await loadTournaments();
    go('list');
  } catch (e) {
    toast('Lỗi xóa giải: ' + e.message, 'error');
  }
}

function confirmCancel() {
  openModal('Xác Nhận Hủy Giải', `
    <p style="color:var(--text-dim);margin-bottom:14px">Bạn có chắc muốn hủy giải này? Hành động không thể hoàn tác.</p>
    <div class="form-group">
      <label class="form-label">Lý Do</label>
      <input class="form-input" id="cancel-trn-reason" placeholder="Lý do hủy...">
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Hủy</button>
      <button class="btn btn-danger" onclick="submitCancelTournament()">🛑 Xác Nhận Hủy</button>
    </div>
  `);
}
async function submitCancelTournament() {
  const reason = document.getElementById('cancel-trn-reason')?.value.trim();
  const result = await doAction('/tournaments/' + state.current.id + '/cancel', { reason }, '🛑 Đã hủy giải!');
  if (result) closeModal();
}

// ─── Tab Content ──────────────────────────────────────────────────────────────
function renderTabContent() {
  const container = document.getElementById('tab-content');
  if (!container) return;
  const t = state.current;
  switch (state.tab) {
    case 'participants': container.innerHTML = renderParticipantsTab(t); break;
    case 'rounds':       container.innerHTML = renderRoundsTab(t); break;
    case 'standings':    container.innerHTML = renderStandingsTab(t); break;
    case 'bracket':      container.innerHTML = renderBracketTab(t); break;
    case 'logs':         container.innerHTML = renderLogsTab(t); break;
    default:             container.innerHTML = '';
  }
}

function renderParticipantsTab(t) {
  const parts = t.participants || [];
  if (parts.length === 0) return `
    <div class="empty-state">
      <div class="empty-icon">👥</div>
      <div class="empty-title">Chưa có người tham gia</div>
      <div class="empty-desc">${t.registrationOpen ? 'Đăng ký đang mở. Người chơi có thể tham gia.' : 'Mở đăng ký để nhận người tham gia.'}</div>
    </div>`;

  return `
    <div class="stats-row" style="margin-bottom:16px">
      <div class="stat-card"><div class="stat-label">Tổng</div><div class="stat-value" style="color:var(--text)">${parts.length}</div></div>
      <div class="stat-card"><div class="stat-label">Đã Duyệt</div><div class="stat-value" style="color:var(--green)">${parts.filter(p=>p.approved).length}</div></div>
      <div class="stat-card"><div class="stat-label">Chờ Duyệt</div><div class="stat-value" style="color:#fbbf24">${parts.filter(p=>!p.approved).length}</div></div>
      <div class="stat-card"><div class="stat-label">Có Bot</div><div class="stat-value" style="color:var(--purple)">${parts.filter(p=>p.officialBot).length}</div></div>
    </div>
    <div class="participants-list">
      ${parts.map(p => renderParticipantCard(t, p)).join('')}
    </div>`;
}

function renderParticipantCard(t, p) {
  const color = avatarColor(p.username);
  const initials = avatarInitials(p.username);
  return `
    <div class="participant-card">
      <div class="participant-avatar" style="background:${color}22;color:${color};border:2px solid ${color}55">${initials}</div>
      <div class="participant-info">
        <div class="participant-name">${esc(p.username)}</div>
        <div class="participant-bot">${p.officialBot ? `🤖 ${esc(p.officialBotName||p.officialBot)}` : '<span style="color:var(--red)">⚠ Chưa chọn bot</span>'}</div>
        <div style="font-size:0.72rem;color:var(--text-faint)">Đăng ký: ${fmtDate(p.registeredAt)}</div>
      </div>
      <div class="participant-actions">
        ${p.approved ? '<span class="approved-badge">✅ Đã Duyệt</span>' : '<span class="pending-badge">⏳ Chờ Duyệt</span>'}
        ${isAdmin() && !p.approved ? `<button class="btn btn-success btn-sm" onclick="doAction('/tournaments/${esc(t.id)}/approve-participant',{userId:'${esc(p.userId)}'},'✅ Đã duyệt ${esc(p.username)}!')">Duyệt</button>` : ''}
        ${isAdmin() ? `<button class="btn btn-danger btn-sm" onclick="doAction('/tournaments/${esc(t.id)}/reject-participant',{userId:'${esc(p.userId)}'},'🗑 Đã từ chối!')">Từ Chối</button>` : ''}
        ${isAdmin() && p.approved && !p.officialBot ? `<button class="btn btn-ghost btn-sm" style="font-size:0.75rem">Chưa có bot</button>` : ''}
      </div>
    </div>`;
}

function renderRoundsTab(t) {
  const rounds = t.rounds || [];
  if (rounds.length === 0) return `
    <div class="empty-state">
      <div class="empty-icon">⚔</div>
      <div class="empty-title">Chưa có vòng đấu</div>
      <div class="empty-desc">${isAdmin() ? 'Nhấn "Tạo Vòng Đấu" trong bảng quản trị.' : 'Admin chưa tạo vòng đấu.'}</div>
    </div>`;

  const totalMatches = rounds.reduce((s, r) => s + r.matches.length, 0);
  const completed = rounds.reduce((s, r) => s + r.matches.filter(m=>m.status==='completed').length, 0);

  return `
    <div class="stats-row" style="margin-bottom:16px">
      <div class="stat-card"><div class="stat-label">Số Vòng</div><div class="stat-value" style="color:var(--purple)">${rounds.length}</div></div>
      <div class="stat-card"><div class="stat-label">Tổng Trận</div><div class="stat-value" style="color:var(--text)">${totalMatches}</div></div>
      <div class="stat-card"><div class="stat-label">Đã Xong</div><div class="stat-value" style="color:var(--green)">${completed}</div></div>
      <div class="stat-card"><div class="stat-label">Còn Lại</div><div class="stat-value" style="color:#fbbf24">${totalMatches-completed}</div></div>
    </div>
    <div class="rounds-list">
      ${rounds.map(round => renderRound(t, round)).join('')}
    </div>`;
}

function renderRound(t, round) {
  const done = round.matches.filter(m=>m.status==='completed').length;
  return `
    <div class="round-card">
      <div class="round-header">
        <div class="round-title">
          <div class="round-num">${round.roundNumber}</div>
          ${esc(round.name)}
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          ${isAdmin() && state.current.status === 'active' && round.matches.some(m => m.status === 'pending' && m.playerB !== 'BYE') ? `<button class="btn btn-primary btn-sm" onclick="runRoundUI('${esc(round.id)}')">▶ Chạy cả vòng</button>` : ''}
          ${isAdmin() && round.matches.some(m => m.status !== 'pending' || m.error) ? `<button class="btn btn-ghost btn-sm" title="Đặt lại tất cả các trận trong vòng về chờ đấu" onclick="resetRoundUI('${esc(round.id)}')">↺ Đặt lại vòng</button>` : ''}
          <span style="font-size:0.8rem;color:var(--text-dim)">${done}/${round.matches.length} xong</span>
          <span class="tc-badge ${statusForClass(round.status)}" style="display:inline-flex;font-size:0.72rem;padding:3px 9px">${statusLabel(round.status)}</span>
        </div>
      </div>
      <div class="round-matches">
        ${round.matches.map(m => renderMatch(t, round, m)).join('')}
      </div>
    </div>`;
}

function renderMatch(t, round, m) {
  const pA = t.participants.find(p => p.userId === m.playerA);
  const pB = m.playerB === 'BYE' ? null : t.participants.find(p => p.userId === m.playerB);
  const nameA = pA?.username || m.playerA;
  const nameB = m.playerB === 'BYE' ? 'BYE' : (pB?.username || m.playerB);
  const colorA = avatarColor(nameA), colorB = avatarColor(nameB);
  const isByeMatch = m.playerB === 'BYE';
  const winner = m.winner;

  let resultHTML = '';
  if (m.status === 'completed') {
    const cls = winner === 'draw' ? 'match-result-draw' : '';
    resultHTML = `<span class="match-result-badge ${cls}">${winner==='a'?'🏆':winner==='b'?'🏆':winner==='draw'?'🤝':'BYE'} ${esc(winnerLabel(winner, nameA, nameB))}</span>`;
  }

  const running = m.status === 'running';
  const cardClass = m.status === 'completed' ? 'completed' : m.status === 'cancelled' ? 'cancelled' : m.paused ? 'paused' : running ? 'running' : 'pending';
  const statusIcon = m.paused ? '⏸' : running ? '<span class="live-dot"></span>' : m.status === 'completed' ? '✅' : m.status === 'cancelled' ? '🗑' : '⏳';

  return `
    <div class="match-card ${cardClass}">
      <div class="player-slot">
        <div class="player-avatar-sm" style="background:${colorA}22;color:${colorA};border:2px solid ${colorA}55;font-weight:800;font-size:0.75rem">${avatarInitials(nameA)}</div>
        <div>
          <div class="player-name-sm" style="${winner==='a'?'color:var(--green);':''}">
            ${winner==='a'?'👑 ':''}${esc(nameA)}
          </div>
          <div class="player-bot-sm">${pA?.officialBotName||'—'}</div>
        </div>
      </div>

      <div class="match-vs">
        ${statusIcon}<br>
        ${m.scheduledAt ? `<span style="font-size:0.65rem;color:var(--text-faint)">${fmtDateShort(m.scheduledAt)}</span>` : 'VS'}
      </div>

      <div class="player-slot right">
        <div>
          <div class="player-name-sm" style="${winner==='b'?'color:var(--green);':''}">
            ${winner==='b'?'👑 ':''}${esc(nameB)}
          </div>
          <div class="player-bot-sm">${isByeMatch?'(auto)':pB?.officialBotName||'—'}</div>
        </div>
        ${!isByeMatch ? `<div class="player-avatar-sm" style="background:${colorB}22;color:${colorB};border:2px solid ${colorB}55;font-weight:800;font-size:0.75rem">${avatarInitials(nameB)}</div>` : ''}
      </div>

      <div class="match-actions">
        ${m.status === 'completed' ? resultHTML : ''}
        ${m.status === 'cancelled' ? `<span style="color:var(--red);font-size:0.75rem" title="${esc(m.cancelReason||'')}">🗑 Đã hủy</span>` : ''}
        ${running ? `<span class="live-chip ${m.paused ? 'paused' : ''}">${m.paused ? '⏸ TẠM DỪNG' : '● ĐANG ĐẤU'}</span>
          <button class="btn btn-primary btn-sm" onclick="openLive('${esc(t.id)}','${esc(m.id)}')">📺 Xem trực tiếp</button>` : ''}
        ${m.status === 'completed' && m.hasReplay ? `<button class="btn btn-ghost btn-sm" onclick="openReplay('${esc(t.id)}','${esc(m.id)}')">🎬 Xem lại</button>` : ''}
        ${isAdmin() && m.status === 'pending' && !isByeMatch ? `
          <button class="btn btn-primary btn-sm" onclick="startMatchUI('${esc(round.id)}','${esc(m.id)}')" ${t.status !== 'active' ? 'disabled' : ''}>▶ Chạy trận</button>
          <button class="btn btn-success btn-sm" title="Nhập kết quả tay" onclick="showReportMatch(state.current, state.current.rounds.find(r=>r.id==='${esc(round.id)}'), state.current.rounds.find(r=>r.id==='${esc(round.id)}').matches.find(m=>m.id==='${esc(m.id)}'))">✍</button>
          <button class="btn btn-ghost btn-sm" title="Lên lịch" onclick="showScheduleMatch(state.current, state.current.rounds.find(r=>r.id==='${esc(round.id)}'), state.current.rounds.find(r=>r.id==='${esc(round.id)}').matches.find(m=>m.id==='${esc(m.id)}'))">📅</button>` : ''}
        ${isAdmin() && running ? (m.paused
          ? `<button class="btn btn-success btn-sm" title="Tiếp tục" onclick="matchCtl('resume-match','${esc(round.id)}','${esc(m.id)}')">▶</button>`
          : `<button class="btn btn-ghost btn-sm" title="Tạm dừng" onclick="matchCtl('pause-match','${esc(round.id)}','${esc(m.id)}')">⏸</button>`) : ''}
        ${isAdmin() && (m.status === 'pending' || running) && !isByeMatch ? `<button class="btn btn-danger btn-sm" title="Hủy trận" onclick="showCancelMatch(state.current, state.current.rounds.find(r=>r.id==='${esc(round.id)}'), state.current.rounds.find(r=>r.id==='${esc(round.id)}').matches.find(m=>m.id==='${esc(m.id)}'))">🗑</button>` : ''}
        ${isAdmin() && (m.status !== 'pending' || m.error) && !isByeMatch ? `<button class="btn btn-ghost btn-sm" title="Đặt lại trận này về chờ đấu để thi đấu lại" onclick="resetMatchUI('${esc(round.id)}','${esc(m.id)}')">↺ Đặt lại</button>` : ''}
        ${m.error && m.status === 'pending' ? `<span class="match-error" title="${esc(m.error)}">⚠ ${esc(m.error.slice(0, 60))}</span>` : ''}
        ${m.matchRef ? `<span class="vw-tag" title="Tham chiếu">${esc(m.matchRef)}</span>` : ''}
      </div>
    </div>`;
}

// ─── Match control (admin) ────────────────────────────────────────────────────
async function refreshCurrent() {
  if (!state.current) return;
  try {
    state.current = await api('GET', '/tournaments/' + state.current.id);
    if (state.current.format === 'round-robin') state.standings = await api('GET', '/tournaments/' + state.current.id + '/standings');
    render();
  } catch {}
}

async function matchCtl(action, roundId, matchId, extra) {
  const msgs = { 'pause-match': '⏸ Đã tạm dừng trận', 'resume-match': '▶ Trận tiếp tục', 'reset-match': '↺ Trận đã được đặt lại', 'cancel-match': '🗑 Đã hủy trận' };
  const r = await doAction('/tournaments/' + state.current.id + '/' + action, { roundId, matchId, ...(extra || {}) }, msgs[action]);
  if (viewer && viewer.mode === 'live') pollLive();
  return r;
}

async function runWithDockerFallback(path, body) {
  try {
    const res = await api('POST', path, body);
    state.current = res; await refreshCurrent();
    return true;
  } catch (e) {
    if (e.data && e.data.dockerUnavailable) {
      const ok = confirm('Docker chưa chạy nên không thể chạy bot của người chơi.\n\nChạy thử bằng bot mẫu (Greedy vs Greedy)?\nLưu ý: kết quả sẽ được tính vào giải.');
      if (!ok) return false;
      return runWithDockerFallback(path, { ...body, demo: true });
    }
    toast(e.message, 'error'); return false;
  }
}

async function startMatchUI(roundId, matchId) {
  const ok = await runWithDockerFallback('/tournaments/' + state.current.id + '/start-match', { roundId, matchId });
  if (ok) { toast('▶ Trận đã bắt đầu', 'success'); openLive(state.current.id, matchId); }
}

async function runRoundUI(roundId) {
  const ok = await runWithDockerFallback('/tournaments/' + state.current.id + '/run-round', { roundId });
  if (ok) toast('▶ Đã chạy tất cả trận trong vòng', 'success');
}

async function resetMatchUI(roundId, matchId) {
  if (!confirm('Bạn có chắc muốn ĐẶT LẠI trận đấu này về trạng thái chờ đấu?\nKết quả cũ và bản ghi trận sẽ được xóa để có thể thi đấu lại.')) return;
  await matchCtl('reset-match', roundId, matchId);
  await refreshCurrent();
}

async function resetRoundUI(roundId) {
  if (!confirm('Bạn có chắc muốn ĐẶT LẠI TOÀN BỘ các trận trong vòng này về chờ đấu?\nTất cả kết quả và bản ghi của vòng này sẽ được xóa để thi đấu lại.')) return;
  await doAction('/tournaments/' + state.current.id + '/reset-round', { roundId }, '↺ Đã đặt lại vòng!');
  await refreshCurrent();
}

// Keep the detail page fresh while matches are running or tournament is active
setInterval(() => {
  if (state.page === 'detail' && state.current) {
    const hasRunning = (state.current.rounds || []).some(r => r.matches.some(m => m.status === 'running'));
    if (hasRunning || state.current.status === 'active') {
      refreshCurrent();
    }
  }
}, 2000);

// ─── Match viewer: live + replay ──────────────────────────────────────────────
const PIECE = { rock: '🪨', paper: '📄', scissors: '✂️' };
const REASON = { victory: 'Chiến thắng', 'move-limit': 'Hết lượt', 'no-legal-actions': 'Hết nước đi', 'invalid-action': 'Nước đi sai', 'bot-timeout': 'Bot quá thời gian', 'bot-crash': 'Bot lỗi', cancelled: 'Bị hủy' };
let viewer = null;

function stopViewer() {
  if (!viewer) return;
  clearInterval(viewer.poll); clearInterval(viewer.play);
  viewer = null;
}

function renderBoard(board, lastMove) {
  if (!board) return '<div class="vw-board-empty">Đang chuẩn bị bàn cờ…</div>';
  const isFrom = (r, c) => lastMove && lastMove.from[0] === r && lastMove.from[1] === c;
  const isTo = (r, c) => lastMove && lastMove.to[0] === r && lastMove.to[1] === c;
  let html = '<div class="vw-board">';
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = board[r][c];
    const cls = ['vw-cell', (r + c) % 2 ? 'dark' : 'light'];
    if (r === 0 && c === 7) cls.push('goal-a');
    if (r === 7 && c === 0) cls.push('goal-b');
    if (isFrom(r, c)) cls.push('from');
    if (isTo(r, c)) cls.push('to');
    html += `<div class="${cls.join(' ')}">${p ? `<span class="vw-piece ${p.owner}">${PIECE[p.type] || '?'}</span>` : ''}</div>`;
  }
  return html + '</div>';
}

function countOnBoard(board, owner) { return board ? board.flat().filter(p => p && p.owner === owner).length : 0; }

function viewerHeader(players, board) {
  return `<div class="vw-head">
    <div class="vw-player a"><span class="vw-swatch p1"></span><div><strong>${esc(players?.a || 'A')}</strong><small>${countOnBoard(board, 'p1')} quân · đích ↗</small></div></div>
    <div class="vw-vs">VS</div>
    <div class="vw-player b"><div style="text-align:right"><strong>${esc(players?.b || 'B')}</strong><small>${countOnBoard(board, 'p2')} quân · đích ↙</small></div><span class="vw-swatch p2"></span></div>
  </div>`;
}

function moveText(e, players) {
  const who = e.owner === 'p1' ? players?.a : players?.b;
  const sq = ([r, c]) => String.fromCharCode(97 + c) + (8 - r);
  return `${esc(who || e.owner)}: ${PIECE[e.unit] || ''} ${sq(e.from)}→${sq(e.to)}${e.captured ? ' ✖ ' + (PIECE[e.captured] || '') : ''}`;
}

function openViewerModal(title) {
  openModal(title, '<div id="viewer" class="viewer"></div>');
  document.querySelector('.modal-box')?.classList.add('wide');
}

// LIVE
async function openLive(tid, mid) {
  stopViewer();
  viewer = { tid, mid, mode: 'live' };
  openViewerModal('📺 Xem trực tiếp');
  await pollLive();
  if (viewer && viewer.mode === 'live' && viewer.mid === mid) viewer.poll = setInterval(pollLive, 500);
}

async function pollLive() {
  const v = viewer;
  if (!v || v.mode !== 'live') return;
  let d;
  try { d = await api('GET', `/tournaments/${v.tid}/matches/${v.mid}/live`); } catch (e) { return; }
  if (viewer !== v) return;
  if (d.status !== 'running') {
    clearInterval(v.poll);
    refreshCurrent();
    if (d.hasReplay) { toast('🏁 Trận kết thúc — chuyển sang xem lại', 'success'); openReplay(v.tid, v.mid, true); return; }
  }
  renderLive(d);
}

function renderLive(d) {
  const el = document.getElementById('viewer');
  if (!el) return;
  const round = state.current?.rounds.find(r => r.matches.some(m => m.id === d.matchId));
  const badge = d.status === 'running' ? (d.paused ? '<span class="live-chip paused">⏸ TẠM DỪNG</span>' : '<span class="live-chip">● TRỰC TIẾP</span>')
    : d.status === 'cancelled' ? '<span class="live-chip ended">🗑 ĐÃ HỦY</span>' : `<span class="live-chip ended">${esc(statusLabel(d.status))}</span>`;
  const pct = Math.min(100, Math.round((d.turn / (d.maxMoves || 1)) * 100));
  el.innerHTML = `
    ${viewerHeader(d.players, d.board)}
    <div class="vw-status">${badge}<span>Lượt <b>${d.turn}</b> / ${d.maxMoves}</span>${d.engine === 'demo' ? '<span class="vw-tag">bot mẫu</span>' : ''}</div>
    <div class="vw-progress"><div style="width:${pct}%"></div></div>
    <div class="vw-body">
      ${renderBoard(d.board, d.lastMove)}
      <div class="vw-log"><div class="vw-log-title">Nước đi gần nhất</div>
        ${(d.events || []).slice().reverse().map(e => `<div class="vw-log-item">${moveText(e, d.players)}</div>`).join('') || '<div class="vw-log-item muted">Chưa có nước đi</div>'}
      </div>
    </div>
    ${d.status === 'cancelled' ? '<p class="vw-note">Trọng tài đã hủy trận này.</p>' : ''}
    ${d.status === 'pending' ? '<p class="vw-note">Trận chưa bắt đầu (hoặc đã được đặt lại).</p>' : ''}
    ${d.error ? `<p class="vw-note err">⚠ ${esc(d.error)}</p>` : ''}
    ${isAdmin() && d.status === 'running' && round ? `<div class="vw-controls">
      ${d.paused ? `<button class="btn btn-success" onclick="matchCtl('resume-match','${esc(round.id)}','${esc(d.matchId)}')">▶ Tiếp tục</button>`
                 : `<button class="btn btn-ghost" onclick="matchCtl('pause-match','${esc(round.id)}','${esc(d.matchId)}')">⏸ Tạm dừng</button>`}
      <button class="btn btn-danger" onclick="if(confirm('Hủy trận đang đấu?')) matchCtl('cancel-match','${esc(round.id)}','${esc(d.matchId)}',{reason:'Trọng tài hủy khi đang đấu'})">🗑 Hủy trận</button>
    </div>` : ''}`;
}

// REPLAY
async function openReplay(tid, mid, fromLive) {
  stopViewer();
  let rp;
  try { rp = await api('GET', `/tournaments/${tid}/matches/${mid}/replay`); } catch (e) { toast(e.message, 'error'); return; }
  const m = state.current?.rounds.flatMap(r => r.matches).find(x => x.id === mid);
  if (!rp.players && m) rp.players = { a: nameOfP(m.playerA), b: nameOfP(m.playerB) };
  const last = rp.snapshots.length - 1;
  viewer = { tid, mid, mode: 'replay', rp, match: m, frame: fromLive ? last : 0, playing: !fromLive, speed: 1 };
  openViewerModal('🎬 Xem lại trận');
  const el = document.getElementById('viewer');
  const winTxt = m ? winnerLabel(m.winner, rp.players?.a, rp.players?.b) : (rp.winner || 'Hòa');
  el.innerHTML = `
    <div id="vw-head"></div>
    <div class="vw-status"><span class="live-chip ended">🏁 ${esc(winTxt)}</span><span>${esc(REASON[rp.reason] || rp.reason || '')}${m?.result?.note && m.result.note !== rp.reason ? ' · ' + esc(m.result.note) : ''}</span><span>${rp.turns} lượt</span></div>
    <div class="vw-body">
      <div id="vw-board"></div>
      <div class="vw-log"><div class="vw-log-title">Nước đi</div><div id="vw-move" class="vw-log-item"></div>
        ${rp.fault ? `<div class="vw-note err">⚠ ${esc(rp.fault.message)} (lượt ${rp.fault.turn})</div>` : ''}</div>
    </div>
    <input type="range" id="vw-seek" class="vw-seek" min="0" max="${last}" value="${viewer.frame}" oninput="replayCtl('seek', this.value)">
    <div class="vw-controls">
      <button class="btn btn-ghost btn-sm" onclick="replayCtl('first')" title="Về đầu">⏮</button>
      <button class="btn btn-ghost btn-sm" onclick="replayCtl('prev')" title="Lùi 1 lượt">◀</button>
      <button class="btn btn-primary btn-sm" id="vw-play" onclick="replayCtl('toggle')"></button>
      <button class="btn btn-ghost btn-sm" onclick="replayCtl('next')" title="Tiến 1 lượt">▶</button>
      <button class="btn btn-ghost btn-sm" onclick="replayCtl('last')" title="Về cuối">⏭</button>
      <span id="vw-turn" class="vw-turn"></span>
      <select class="form-select vw-speed" onchange="replayCtl('speed', this.value)">
        <option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option>
      </select>
    </div>`;
  updateReplay();
  if (viewer.playing) startReplayTimer();
}

function nameOfP(id) { return id === 'BYE' ? 'BYE' : (state.current?.participants.find(p => p.userId === id)?.username || id); }

function startReplayTimer() {
  const v = viewer; if (!v) return;
  clearInterval(v.play);
  v.play = setInterval(() => {
    if (viewer !== v) return clearInterval(v.play);
    if (v.frame >= v.rp.snapshots.length - 1) { v.playing = false; clearInterval(v.play); updateReplay(); return; }
    v.frame++; updateReplay();
  }, 450 / v.speed);
}

function replayCtl(cmd, val) {
  const v = viewer; if (!v || v.mode !== 'replay') return;
  const last = v.rp.snapshots.length - 1;
  if (cmd === 'toggle') {
    if (!v.playing && v.frame >= last) v.frame = 0;
    v.playing = !v.playing;
    v.playing ? startReplayTimer() : clearInterval(v.play);
  } else if (cmd === 'speed') { v.speed = Number(val) || 1; if (v.playing) startReplayTimer(); }
  else {
    v.playing = false; clearInterval(v.play);
    if (cmd === 'first') v.frame = 0;
    if (cmd === 'last') v.frame = last;
    if (cmd === 'prev') v.frame = Math.max(0, v.frame - 1);
    if (cmd === 'next') v.frame = Math.min(last, v.frame + 1);
    if (cmd === 'seek') v.frame = Math.max(0, Math.min(last, Number(val) || 0));
  }
  updateReplay();
}

function updateReplay() {
  const v = viewer; if (!v || v.mode !== 'replay') return;
  const board = v.rp.snapshots[v.frame];
  const ev = v.frame > 0 ? v.rp.events[v.frame - 1] : null;
  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  set('vw-head', viewerHeader(v.rp.players, board));
  set('vw-board', renderBoard(board, ev));
  set('vw-move', ev ? moveText(ev, v.rp.players) : 'Thế cờ ban đầu');
  set('vw-turn', `Lượt ${v.frame} / ${v.rp.snapshots.length - 1}`);
  set('vw-play', v.playing ? '⏸ Dừng' : '▶ Phát');
  const seek = document.getElementById('vw-seek'); if (seek && Number(seek.value) !== v.frame) seek.value = v.frame;
}

function viewMatchReplay(matchId) {
  if (!matchId || !state.current) return;
  openReplay(state.current.id, matchId);
}

function renderStandingsTab(t) {
  const st = state.standings || [];
  if (st.length === 0) return `
    <div class="empty-state">
      <div class="empty-icon">📊</div>
      <div class="empty-title">Chưa có dữ liệu</div>
      <div class="empty-desc">Bảng xếp hạng sẽ hiển thị sau khi có trận đã hoàn thành.</div>
    </div>`;

  return `
    <div style="font-size:0.82rem;color:var(--text-dim);margin-bottom:12px">
      Hệ thống điểm: <span style="color:var(--green);font-weight:700">Thắng +3</span> · <span style="color:#fbbf24;font-weight:700">Hòa +1</span> · <span style="color:var(--text-faint)">Thua +0</span>
    </div>
    <table class="standings-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Người Chơi</th>
          <th>Điểm</th>
          <th>Thắng</th>
          <th>Hòa</th>
          <th>Thua</th>
          <th>Đã Đấu</th>
        </tr>
      </thead>
      <tbody>
        ${st.map((s, i) => {
          const color = avatarColor(s.userId);
          return `
          <tr class="rank-${i+1}">
            <td><span class="rank-num">${i===0?'🥇':i===1?'🥈':i===2?'🥉':(i+1)}</span></td>
            <td>
              <div style="display:flex;align-items:center;gap:10px">
                <div class="participant-avatar" style="width:32px;height:32px;font-size:0.75rem;background:${color}22;color:${color};border:2px solid ${color}55">${avatarInitials(s.userId)}</div>
                <span style="font-weight:700">${esc(s.userId)}</span>
              </div>
            </td>
            <td><span class="points-chip">${s.points} pts</span></td>
            <td style="color:var(--green);font-weight:700">${s.wins}</td>
            <td style="color:#fbbf24;font-weight:700">${s.draws}</td>
            <td style="color:var(--text-dim)">${s.losses}</td>
            <td style="color:var(--text-dim)">${s.played}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

function renderBracketTab(t) {
  const rounds = t.rounds || [];
  if (rounds.length === 0) return `
    <div class="empty-state">
      <div class="empty-icon">🗺</div>
      <div class="empty-title">Chưa có sơ đồ</div>
      <div class="empty-desc">Admin cần tạo vòng đấu để xem sơ đồ.</div>
    </div>`;

  return `
    <div class="bracket-container">
      ${rounds.map(round => `
        <div class="bracket-round">
          <div class="bracket-round-title">${esc(round.name)}</div>
          ${round.matches.map(m => renderBracketMatch(t, m)).join('')}
        </div>
      `).join('')}
    </div>`;
}

function renderBracketMatch(t, m) {
  const pA = t.participants.find(p=>p.userId===m.playerA);
  const pB = m.playerB==='BYE'?null:t.participants.find(p=>p.userId===m.playerB);
  const nameA = pA?.username || m.playerA;
  const nameB = m.playerB==='BYE'?'BYE':(pB?.username||m.playerB);
  const cls = m.winner==='a'?'winner-a':m.winner==='b'?'winner-b':'';
  return `
    <div class="bracket-match ${cls}">
      <div class="bracket-player player-a">
        ${m.winner==='a'?'<span class="trophy">🏆</span>':''}
        ${esc(nameA)}
      </div>
      <div class="bracket-player player-b">
        ${m.winner==='b'?'<span class="trophy">🏆</span>':''}
        ${esc(nameB)}
      </div>
    </div>`;
}

function renderLogsTab(t) {
  const logs = t.logs || [];
  if (logs.length === 0) return `
    <div class="empty-state">
      <div class="empty-icon">📋</div>
      <div class="empty-title">Chưa có nhật ký</div>
      <div class="empty-desc">Mọi hành động của trọng tài sẽ được ghi lại ở đây.</div>
    </div>`;

  return `
    <div style="margin-bottom:12px;font-size:0.82rem;color:var(--text-dim)">
      ${logs.length} mục nhật ký · Mới nhất trước
    </div>
    <div class="audit-list">
      ${logs.map(log => `
        <div class="audit-item">
          <span class="audit-ts">${fmtDate(log.ts)}</span>
          <span class="audit-actor">${esc(log.actor)}</span>
          <span class="audit-action">${esc(log.action)}</span>
          <span class="audit-detail">${esc(log.detail)}</span>
        </div>
      `).join('')}
    </div>`;
}

// ─── Init ─────────────────────────────────────────────────────────────────────
// Embedded mode (inside the main app's Tournaments tab): hide own nav, sync role from server
const EMBED = new URLSearchParams(location.search).has('embed');
if (EMBED) document.body.classList.add('embed');
loadAuth();
if (state.user) {
  fetch('/api/auth/me', { headers: authHeaders() }).then(r => r.ok ? r.json() : null).then(me => {
    if (me && me.role && me.role !== state.user.role) {
      state.user.role = me.role; localStorage.setItem('ott_role', me.role); render();
    }
  }).catch(() => {});
}
loadTournaments();

// Hash-based routing (optional)
window.addEventListener('hashchange', () => {
  const h = location.hash.replace('#', '');
  if (h && h !== state.page) {
    if (h === 'list') { state.page = 'list'; render(); }
  }
});
