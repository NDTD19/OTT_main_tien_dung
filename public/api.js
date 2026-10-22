/* OTT Arena local API bridge & Auth Management */

// ─── Auth state ───────────────────────────────────────────────────────────────
const authState = {
  token: localStorage.getItem('ott_token') || null,
  username: localStorage.getItem('ott_username') || null
};

function authHeaders() {
  return authState.token ? { 'Authorization': 'Bearer ' + authState.token } : {};
}

function saveAuth(token, username, role) {
  authState.token = token;
  authState.username = username;
  localStorage.setItem('ott_token', token);
  localStorage.setItem('ott_username', username);
  localStorage.setItem('ott_role', role || 'user');
}

function clearAuth() {
  authState.token = null;
  authState.username = null;
  localStorage.removeItem('ott_token');
  localStorage.removeItem('ott_username');
  localStorage.removeItem('ott_role');
}

const api = {
  async call(url, options = {}) {
    let response;
    try {
      response = await fetch('/api' + url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
          ...(options.headers || {})
        }
      });
    } catch (netErr) {
      throw Error('Không thể kết nối đến server. Hãy chắc chắn server Node đang chạy trên port 3000.');
    }
    const value = await response.json();
    if (response.status === 401 && !url.startsWith('/auth/')) {
      clearAuth();
      if (typeof render === 'function') render();
    }
    if (!response.ok) throw Error(value.error || 'Yêu cầu thất bại');
    return value;
  },
  get(path) { return this.call(path); },
  post(path, payload) { return this.call(path, { method: 'POST', body: JSON.stringify(payload) }); }
};

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ─── Login & Register Page Logic ──────────────────────────────────────────────
let authPageMode = 'login'; // 'login' | 'register'
let previousPage = 'overview';

function openLoginPage() {
  if (state.page !== 'login') {
    previousPage = state.page || 'overview';
  }
  authPageMode = 'login';
  go('login');
}

function switchAuthMode(mode) {
  authPageMode = mode;
  renderLoginPage();
}

function showAuthAlert(msg, type = 'error') {
  const alertBox = document.getElementById('loginAlertBox');
  if (!alertBox) return;
  alertBox.style.display = 'flex';
  alertBox.className = 'login-alert ' + type;
  alertBox.innerHTML = `
    <span style="font-size:16px;line-height:1">${type === 'success' ? '✓' : '⚠'}</span>
    <span style="flex:1">${escapeHtml(msg)}</span>
  `;
}

async function handleAuthSubmit(e) {
  if (e) e.preventDefault();
  const submitBtn = document.getElementById('loginSubmitBtn');
  const usernameInput = document.getElementById('loginUsername');
  const passwordInput = document.getElementById('loginPassword');
  const confirmInput = document.getElementById('loginPasswordConfirm');

  const username = usernameInput?.value?.trim()?.toLowerCase();
  const password = passwordInput?.value;

  if (!username) {
    showAuthAlert('Vui lòng nhập tên tài khoản', 'error');
    usernameInput?.focus();
    return;
  }
  if (!password) {
    showAuthAlert('Vui lòng nhập mật khẩu', 'error');
    passwordInput?.focus();
    return;
  }

  if (authPageMode === 'register') {
    const confirm = confirmInput?.value;
    if (password !== confirm) {
      showAuthAlert('Mật khẩu xác nhận không khớp. Vui lòng kiểm tra lại!', 'error');
      confirmInput?.focus();
      return;
    }
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Đang xử lý...';
  }

  try {
    const endpoint = authPageMode === 'register' ? '/auth/register' : '/auth/login';
    const data = await api.post(endpoint, { username, password });
    saveAuth(data.token, data.username, data.role);

    showAuthAlert(
      (authPageMode === 'register' ? 'Đăng ký thành công! ' : 'Đăng nhập thành công! ') +
      'Chào mừng ' + data.username + '. Đang chuyển về màn hình chính...',
      'success'
    );
    notice('Đăng nhập thành công: ' + data.username);

    setTimeout(() => {
      go(previousPage || 'overview');
    }, 350);
  } catch (err) {
    showAuthAlert(err.message || 'Đăng nhập thất bại. Vui lòng thử lại!', 'error');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = authPageMode === 'login' ? 'Đăng nhập ngay →' : 'Tạo tài khoản & Đăng nhập →';
    }
  }
}

function renderLoginPage() {
  const appEl = document.getElementById('app');
  if (!appEl) return;
  document.documentElement.className = state.theme === 'light' ? 'light' : '';

  appEl.innerHTML = `
    <div class="login-page-wrap">
      <header class="login-header">
        <div style="display:flex;align-items:center;gap:12px;cursor:pointer" onclick="go(previousPage || 'overview')">
          <span class="brandicon">◈</span>
          <div>
            <div style="font-weight:800;font-size:18px;letter-spacing:-0.5px">OTT<span class="accent">ARENA</span></div>
            <div class="tiny muted" style="letter-spacing:1px">BOT BATTLE PLATFORM</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <button class="btn sm secondary" onclick="go(previousPage || 'overview')">
            ← Quay lại chương trình
          </button>
          <button class="iconbtn" title="Chuyển theme sáng/tối" onclick="state.theme=state.theme==='dark'?'light':'dark';localStorage.setItem('ott-theme',JSON.stringify(state.theme));renderLoginPage()">
            ${svg(state.theme==='dark'?'sun':'moon')}
          </button>
        </div>
      </header>
      <main class="login-body-center">
        <div class="login-card">
          <div style="text-align:center;margin-bottom:24px">
            <h2 style="font-size:24px;margin-bottom:8px">
              ${authPageMode === 'login' ? 'Đăng nhập Arena' : 'Đăng ký tài khoản mới'}
            </h2>
            <p class="muted small" style="margin:0">
              ${authPageMode === 'login' ? 'Đăng nhập để quản lý bot của bạn và tham gia thi đấu xếp hạng' : 'Tạo tài khoản để upload bot và thi đấu trực tiếp với người chơi khác'}
            </p>
          </div>

          <div class="login-tabs">
            <button type="button" class="login-tab-btn ${authPageMode === 'login' ? 'active' : ''}" onclick="switchAuthMode('login')">
              Đăng nhập
            </button>
            <button type="button" class="login-tab-btn ${authPageMode === 'register' ? 'active' : ''}" onclick="switchAuthMode('register')">
              Đăng ký tài khoản
            </button>
          </div>

          <div id="loginAlertBox" style="display:none"></div>

          <form id="authForm" onsubmit="handleAuthSubmit(event)">
            <div class="form-group">
              <label class="form-label" for="loginUsername">Tên tài khoản (Username)</label>
              <input class="field" id="loginUsername" placeholder="ví dụ: player_one, pro_bot..." autocomplete="username" required autofocus>
              <div class="tiny muted" style="margin-top:5px">Chữ thường, số hoặc dấu gạch dưới (2-32 ký tự)</div>
            </div>

            <div class="form-group">
              <label class="form-label" for="loginPassword">Mật khẩu (Password)</label>
              <input class="field" id="loginPassword" type="password" placeholder="Nhập mật khẩu..." autocomplete="${authPageMode === 'login' ? 'current-password' : 'new-password'}" required>
            </div>

            ${authPageMode === 'register' ? `
            <div class="form-group">
              <label class="form-label" for="loginPasswordConfirm">Xác nhận mật khẩu</label>
              <input class="field" id="loginPasswordConfirm" type="password" placeholder="Nhập lại mật khẩu để xác nhận..." autocomplete="new-password" required>
            </div>` : ''}

            <button class="btn" id="loginSubmitBtn" type="submit" style="width:100%;padding:13px;font-size:14px;margin-top:10px;justify-content:center">
              ${authPageMode === 'login' ? 'Đăng nhập ngay →' : 'Tạo tài khoản & Đăng nhập →'}
            </button>
          </form>

          <div style="margin-top:22px;text-align:center">
            <p class="tiny muted" style="margin:0">
              💡 ${authPageMode === 'login' 
                ? 'Chưa có tài khoản? <a href="javascript:void(0)" onclick="switchAuthMode(\'register\')" style="color:var(--accent);font-weight:700">Đăng ký ngay tại đây</a>' 
                : 'Đã có tài khoản? <a href="javascript:void(0)" onclick="switchAuthMode(\'login\')" style="color:var(--accent);font-weight:700">Đăng nhập tại đây</a>'}
            </p>
          </div>
        </div>
      </main>
    </div>
  `;
}

// ─── Header & Sidebar Auth UI Integration ─────────────────────────────────────
function injectTopNavAuth() {
  const actions = document.querySelector('.topactions');
  if (!actions) return;

  const oldWrap = document.getElementById('authUserWrap');
  if (oldWrap) oldWrap.remove();
  const oldBtn = document.getElementById('authNavBtn');
  if (oldBtn) oldBtn.remove();

  if (authState.username) {
    const wrap = document.createElement('div');
    wrap.id = 'authUserWrap';
    wrap.className = 'auth-user-dropdown-wrap';
    const initials = authState.username.slice(0, 2).toUpperCase();
    wrap.innerHTML = `
      <button class="btn sm secondary" id="authNavBtn" type="button" onclick="toggleUserMenu(event)">
        <span class="user-avatar-badge">${escapeHtml(initials)}</span>
        <span style="font-weight:700">${escapeHtml(authState.username)}</span>
        <span style="font-size:10px;opacity:0.7">▼</span>
      </button>
      <div class="auth-dropdown-menu" id="authDropdownMenu" style="display:none">
        <div class="auth-dropdown-header">
          <div style="font-weight:700;font-size:13px">${escapeHtml(authState.username)}</div>
          <div class="tiny muted">Tài khoản chính thức</div>
        </div>
        <button type="button" class="auth-dropdown-item" onclick="go('submit')">
          <span>⇧</span> Bot của tôi
        </button>
        <button type="button" class="auth-dropdown-item" onclick="go('arena')">
          <span>⚔</span> Đấu trường Arena
        </button>
        <div class="auth-dropdown-divider"></div>
        <button type="button" class="auth-dropdown-item danger" onclick="authLogout()">
          <span>🚪</span> Đăng xuất
        </button>
      </div>
    `;
    actions.prepend(wrap);
  } else {
    const btn = document.createElement('button');
    btn.id = 'authNavBtn';
    btn.className = 'btn sm';
    btn.type = 'button';
    btn.onclick = openLoginPage;
    btn.innerHTML = `<span style="font-size:13px">🔑</span> Đăng nhập`;
    actions.prepend(btn);
  }
}

function toggleUserMenu(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById('authDropdownMenu');
  if (menu) {
    menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
  }
}

function updateSidebarProfile() {
  const profileEl = document.querySelector('.side-profile');
  if (!profileEl) return;
  if (authState.username) {
    const initials = authState.username.slice(0, 2).toUpperCase();
    profileEl.innerHTML = `
      <span class="avatar" style="background:#5c4fff;color:#fff">${escapeHtml(initials)}</span>
      <div>
        <div class="strong small">${escapeHtml(authState.username)}</div>
        <div class="tiny muted">Đã đăng nhập · Online</div>
      </div>
      <button class="iconbtn" title="Đăng xuất" style="width:26px;height:26px;margin-left:auto;font-size:12px" onclick="authLogout()">🚪</button>
    `;
  } else {
    profileEl.innerHTML = `
      <span class="avatar" style="background:#303839;color:#a9b6b1">?</span>
      <div>
        <div class="strong small">Khách</div>
        <div class="tiny muted"><a href="javascript:void(0)" onclick="openLoginPage()" style="color:var(--accent);font-weight:700">Đăng nhập</a> để thi đấu</div>
      </div>
    `;
  }
}

function authLogout() {
  const oldUser = authState.username;
  clearAuth();
  notice('Đã đăng xuất tài khoản' + (oldUser ? ' (' + oldUser + ')' : '') + '.');
  render();
}

// ─── WebSocket real-time connection ───────────────────────────────────────────
let wsConn = null;
let wsReconnectTimer = null;

function connectWebSocket() {
  if (wsConn && wsConn.readyState < 2) return;
  const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  wsConn = new WebSocket(wsUrl);

  wsConn.onopen = () => {
    console.log('[WS] Connected to OTT Arena server');
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    updateWSIndicator(true);
  };

  wsConn.onmessage = (evt) => {
    try { handleWSMessage(JSON.parse(evt.data)); } catch (e) { console.warn('[WS] Parse error', e); }
  };

  wsConn.onclose = () => {
    updateWSIndicator(false);
    wsReconnectTimer = setTimeout(connectWebSocket, 3000);
  };

  wsConn.onerror = () => {};
}

function handleWSMessage(msg) {
  switch (msg.event) {
    case 'welcome':
      updateServerStats(msg);
      break;
    case 'match-queued':
      notice('Trận mới xếp hàng: ' + msg.match.a + ' vs ' + msg.match.b);
      void loadBackend();
      break;
    case 'match-started':
      if (msg.ownedBy && msg.ownedBy === authState.username) {
        notice('Trận của bạn đã bắt đầu: ' + msg.a + ' vs ' + msg.b + ' [' + msg.matchId + ']');
      }
      updateServerStats(msg);
      break;
    case 'match-finished': {
      const isMyMatch = msg.ownedBy && msg.ownedBy === authState.username;
      if (isMyMatch) {
        const resultTxt = msg.winner === 'p1' ? msg.a + ' thắng' : msg.winner === 'p2' ? msg.b + ' thắng' : 'Hòa';
        notice('Trận của bạn kết thúc! ' + resultTxt + ' (' + msg.reason + ')');
      }
      void loadBackend();
      if (wsWatchingMatch === msg.matchId) {
        wsWatchingMatch = null;
        if (msg.status === 'completed') {
          openServerMatch(msg.matchId).catch(() => {});
        } else {
          notice('Trận thất bại: ' + (msg.reason || 'lỗi không xác định'));
        }
      }
      break;
    }
  }
}

function updateWSIndicator(online) {
  const el = document.getElementById('wsStatusIndicator');
  if (!el) return;
  el.textContent = online ? 'Live' : 'Offline';
  el.style.color = online ? '#4ade80' : '#f87171';
}

function updateServerStats(msg) {
  const el = document.getElementById('activeJobsCount');
  if (el && msg.activeJobs !== undefined) el.textContent = msg.activeJobs + ' active / ' + (msg.pendingJobs || 0) + ' pending';
}

// ─── WebSocket-based match watching ───────────────────────────────────────────
let wsWatchingMatch = null;

async function waitForMatch(id) {
  if (wsConn && wsConn.readyState === 1) {
    wsWatchingMatch = id;
    notice('Đang chờ kết quả trận [' + id + '] qua WebSocket...');
    setTimeout(() => {
      if (wsWatchingMatch === id) {
        wsWatchingMatch = null;
        notice('Thời gian chờ quá lâu. Kiểm tra Match Arena.');
      }
    }, 300000);
  } else {
    try {
      for (let attempts = 0; attempts < 240; attempts++) {
        const match = await api.get('/matches/' + encodeURIComponent(id));
        if (match.status === 'completed') {
          await loadBackend();
          await openServerMatch(id);
          notice('Trận kết thúc: ' + match.reason);
          return;
        }
        if (match.status === 'failed') {
          await loadBackend();
          notice('Trận thất bại: ' + (match.error || match.reason));
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      notice('Trận vẫn đang chạy. Kiểm tra Match Arena.');
    } catch (e) {
      notice('Lỗi theo dõi trận: ' + e.message);
    }
  }
}

// ─── Arena & Tournament Data Loading ──────────────────────────────────────────
let serverMatches = [];

async function loadBackend() {
  try {
    const [sub, match, rank] = await Promise.all([
      api.get('/submissions'),
      api.get('/matches'),
      api.get('/leaderboard')
    ]);
    state.submissions = sub.map(s => ({
      ...s,
      date: new Date(s.date).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
    }));
    serverMatches = match;
    matches.splice(0, matches.length, ...match.map(m => ({
      ...m,
      score: m.status === 'completed' ? (m.winner === 'p1' ? '1 – 0' : m.winner === 'p2' ? '0 – 1' : '0.5 – 0.5') : m.status,
      type: m.mode === 'submitted' ? 'Submitted bots' : 'Built-in demo',
      time: new Date(m.createdAt).toLocaleString('en-US'),
      turns: m.turns || 0
    })));
    if (match.length) {
      const completed = match.find(m => m.status === 'completed');
      if (completed && (!match.some(m => m.id === state.selectedMatch) || !replayCache[state.selectedMatch])) {
        state.selectedMatch = completed.id;
        try {
          replayCache[completed.id] = await api.get('/matches/' + encodeURIComponent(completed.id) + '/replay');
        } catch (e) {
          console.warn('Replay not loaded:', e.message);
        }
      }
    }
    players.splice(0, players.length, ...rank.map((p, i) => [
      String(i + 1).padStart(2, '0'),
      p.name,
      p.name.slice(0, 2).toUpperCase(),
      p.lang,
      p.elo,
      '+0',
      ['purple', 'blue', 'orange', 'pink'][i % 4]
    ]));
    state.serverOnline = true;
    render();
  } catch (e) {
    state.serverOnline = false;
    console.warn('Backend unavailable:', e.message);
  }
}

const demoReplayBuilder = buildReplay;
buildReplay = function (id) {
  if (replayCache[id]) return replayCache[id];
  if (serverMatches.some(m => m.id === id)) return { snapshots: [initialOTT(1)], events: [], winner: null };
  return demoReplayBuilder(id);
};

async function openServerMatch(id) {
  try {
    state.playing = false;
    clearInterval(timer);
    const replay = await api.get('/matches/' + encodeURIComponent(id) + '/replay');
    replayCache[id] = replay;
    state.selectedMatch = id;
    state.play = 0;
    go('arena');
  } catch (e) {
    notice('Replay chưa sẵn sàng: ' + e.message);
  }
}

openMatch = function (id) {
  if (serverMatches.some(m => m.id === id)) return openServerMatch(id);
  state.selectedMatch = id;
  state.play = 0;
  state.playing = false;
  clearInterval(timer);
  go('arena');
};

async function createServerMatch() {
  const a = document.getElementById('playerA')?.value || 'Greedy Bot';
  const b = document.getElementById('playerB')?.value || 'Random Bot';
  try {
    const job = await api.post('/matches', { a, b, maxMoves: Number(state.maxMoves) || 200, first: state.firstMove, pieces: 6 });
    notice('Trận đấu demo đã được xếp hàng.');
    await loadBackend();
    await waitForMatch(job.id);
  } catch (e) {
    notice('Không thể tạo trận demo: ' + e.message);
  }
}

async function createSubmittedMatch() {
  if (!authState.token) {
    notice('Bạn cần đăng nhập trước khi tham gia trận đấu.');
    openLoginPage();
    return;
  }
  const submissionA = document.getElementById('submissionA')?.value;
  const submissionB = document.getElementById('submissionB')?.value;
  const maxMoves = Number(document.getElementById('duelMaxMoves')?.value || 200);
  const first = document.getElementById('duelFirst')?.value || 'Random';
  if (!submissionA || !submissionB || submissionA === submissionB) return notice('Chọn 2 bot khác nhau.');
  if (!Number.isInteger(maxMoves) || maxMoves < 1 || maxMoves > 1000) return notice('Move limit phải từ 1-1000.');
  try {
    const job = await api.post('/matches', { submissionA, submissionB, maxMoves, first, pieces: 6 });
    notice('Đang chạy trận đấu bot: ' + job.id);
    await loadBackend();
    await waitForMatch(job.id);
  } catch (e) {
    notice('Không thể bắt đầu trận: ' + e.message);
  }
}

async function challengeMatch() {
  if (!authState.token) {
    notice('Bạn cần đăng nhập trước khi tham gia thách đấu!');
    openLoginPage();
    return;
  }
  const myBot = document.getElementById('challengeBot')?.value;
  const maxMoves = Number(document.getElementById('challengeMaxMoves')?.value || 200);
  if (!myBot) return notice('Hãy chọn bot của bạn trước.');
  if (!Number.isInteger(maxMoves) || maxMoves < 1 || maxMoves > 1000) return notice('Move limit phải từ 1-1000.');
  const btn = document.getElementById('challengeBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Đang tìm đối thủ...'; }
  try {
    const job = await api.post('/matches', { submissionA: myBot, maxMoves, pieces: 6, first: 'Random' });
    notice('Đã ghép trận! Bot của bạn vs ' + (job.opponent || 'đối thủ ngẫu nhiên') + ' [' + job.id + ']');
    await loadBackend();
    await waitForMatch(job.id);
  } catch (e) {
    notice('Không thể tạo trận: ' + e.message);
  } finally {
    render();
  }
}

async function checkJudge() {
  try {
    const status = await api.get('/judge/status');
    state.dockerReady = status.dockerReady;
    const el = document.getElementById('judgeEnvironment');
    if (el) el.textContent = status.dockerReady ? '● Docker sandbox ready (' + status.activeJobs + ' active)' : '● Khởi động Docker Desktop để chạy bot';
  } catch {
    state.dockerReady = false;
  }
}

// ─── Inject Custom Styles for Auth, Dropdown & Login Page ─────────────────────
function injectAuthStyles() {
  const style = document.createElement('style');
  style.id = 'ott-auth-custom-styles';
  style.textContent = `
    .toast { z-index: 100000 !important; }
    .auth-user-dropdown-wrap {
      position: relative;
      display: inline-flex;
      align-items: center;
    }
    #authNavBtn {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      font-weight: 700;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .user-avatar-badge {
      display: inline-grid;
      place-items: center;
      width: 22px;
      height: 22px;
      border-radius: 6px;
      background: linear-gradient(135deg, #7c6fff, #ec6e9a);
      color: #fff;
      font-size: 11px;
      font-weight: 800;
      line-height: 1;
    }
    .auth-dropdown-menu {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      min-width: 200px;
      background: var(--surface, #171d1e);
      border: 1px solid var(--line, #2b3434);
      border-radius: 12px;
      box-shadow: 0 16px 40px rgba(0,0,0,0.5);
      padding: 8px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 3px;
      animation: authFadeIn 0.15s ease-out;
    }
    @keyframes authFadeIn {
      from { opacity: 0; transform: translateY(-6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .auth-dropdown-header {
      padding: 8px 10px;
      border-bottom: 1px solid var(--line, #2b3434);
      margin-bottom: 4px;
    }
    .auth-dropdown-item {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 12px;
      background: transparent;
      border: none;
      border-radius: 8px;
      color: var(--text, #f0f2eb);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      text-align: left;
      transition: background 0.15s;
    }
    .auth-dropdown-item:hover {
      background: var(--surface2, #1e2526);
    }
    .auth-dropdown-item.danger {
      color: #f87171;
    }
    .auth-dropdown-item.danger:hover {
      background: rgba(248, 113, 113, 0.14);
    }
    .auth-dropdown-divider {
      height: 1px;
      background: var(--line, #2b3434);
      margin: 4px 0;
    }

    /* Login Page Styles */
    .login-page-wrap {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      background: var(--bg, #0c1011);
      color: var(--text, #f0f2eb);
    }
    .login-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 36px;
      border-bottom: 1px solid var(--line, #2b3434);
      background: var(--surface, #171d1e);
    }
    .login-body-center {
      flex: 1;
      display: grid;
      place-items: center;
      padding: 40px 16px;
    }
    .login-card {
      width: 100%;
      max-width: 440px;
      background: var(--surface, #171d1e);
      border: 1px solid var(--line, #2b3434);
      border-radius: 18px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.55);
      padding: 34px 32px;
      position: relative;
    }
    .login-tabs {
      display: flex;
      gap: 6px;
      background: var(--surface2, #1e2526);
      padding: 5px;
      border-radius: 11px;
      margin-bottom: 22px;
    }
    .login-tab-btn {
      flex: 1;
      padding: 10px;
      text-align: center;
      border-radius: 8px;
      border: none;
      background: transparent;
      color: var(--muted, #899493);
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
    }
    .login-tab-btn.active {
      background: var(--surface, #171d1e);
      color: var(--text, #f0f2eb);
      box-shadow: 0 3px 10px rgba(0,0,0,0.25);
    }
    .login-alert {
      padding: 12px 14px;
      border-radius: 10px;
      font-size: 13px;
      margin-bottom: 18px;
      display: flex;
      align-items: center;
      gap: 10px;
      line-height: 1.45;
    }
    .login-alert.error {
      background: rgba(248, 113, 113, 0.15);
      border: 1px solid rgba(248, 113, 113, 0.4);
      color: #fca5a5;
    }
    .login-alert.success {
      background: rgba(74, 222, 128, 0.15);
      border: 1px solid rgba(74, 222, 128, 0.4);
      color: #86efac;
    }
  `;
  document.head.appendChild(style);
}

// Close user menu when clicking outside
document.addEventListener('click', (e) => {
  const menu = document.getElementById('authDropdownMenu');
  const btn = document.getElementById('authNavBtn');
  if (menu && menu.style.display !== 'none' && (!btn || !btn.contains(e.target))) {
    menu.style.display = 'none';
  }
});

// ─── Initialization & Render Patching ─────────────────────────────────────────
function isUserAdmin() {
  const role = localStorage.getItem('ott_role') || (authState.user && authState.user.role);
  return role === 'admin' || authState.username === 'admin';
}
window.isUserAdmin = isUserAdmin;
window.apiBridge = api;
window.authState = authState;

function setupAuthIntegration() {
  injectAuthStyles();

  // Patch global render function to support dedicated login page and inject navbar auth
  const _origRender = render;
  render = function() {
    if (state.page === 'login') {
      renderLoginPage();
      return;
    }
    _origRender();
    injectTopNavAuth();
    updateSidebarProfile();
  };

  if (state.page === 'login') {
    renderLoginPage();
  } else {
    injectTopNavAuth();
    updateSidebarProfile();
  }

  void loadBackend();
  void checkJudge();
  connectWebSocket();
}

window.addEventListener('hashchange', () => {
  if (location.hash === '#admin') void checkJudge();
});

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', setupAuthIntegration);
} else {
  setupAuthIntegration();
}