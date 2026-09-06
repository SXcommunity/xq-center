/* ═══ 贤圈中心 · 全新逻辑层 ═══
   Supabase 新库 (ocgqafxaapfzraeiehqg) + 主库 OAuth 单点登录
   Bento 布局 · 响应式一体 · 全实名
   ═══════════════════════════════════════════ */

'use strict'

/* ═══ 常量 ═══ */
const SB_URL  = 'https://ocgqafxaapfzraeiehqg.supabase.co'
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9jZ3FhZnhhYXBmenJhZWllaHFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5OTYwOTYsImV4cCI6MjEwMzU3MjA5Nn0.icNXBGRtofllZkvypUvbJqwRxxaLwVLaXC92J5DhKI0'
const MAIN_URL  = 'https://gfxkpljewqchdbrepqia.supabase.co'
const MAIN_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdmeGtwbGpld3FjaGRicmVwcWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2MjA2NDIsImV4cCI6MjEwMzE5NjY0Mn0.VWr_iNA25QTviaFiwYMvTV43ZK3I7kEKXSYO5jHZrBY'

/* ═══ Supabase 客户端 ═══ */
const sbAuth = supabase.createClient(SB_URL, SB_ANON, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
})
const sbMain = supabase.createClient(MAIN_URL, MAIN_ANON, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'xq-main' }
})

/* ═══ 状态 ═══ */
const S = {
  me: null,          // 当前用户 (xq_profiles 行)
  session: null,     // Supabase 会话
  route: 'feed',
  feedPage: 0,
  askTab: 'q',
  askSort: 'new',
  askTag: '',
  unread: 0,
  replyTarget: null,
  editing: null,
}

/* ═══ 工具 ═══ */
const $ = (s) => document.querySelector(s)
const $$ = (s) => document.querySelectorAll(s)
const esc = (s) => { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }
const toast = (msg, ms) => {
  const t = $('#toast'); t.textContent = msg; t.hidden = false
  clearTimeout(t._timer); t._timer = setTimeout(() => { t.hidden = true }, ms || 2200)
}
const fmtDate = (d) => { if (!d) return ''; const x = new Date(d); return (x.getMonth()+1) + '月' + x.getDate() + '日' }
const fmtTime = (d) => { if (!d) return ''; const x = new Date(d); const now = new Date(); const diff = (now - x) / 1000
  if (diff < 60) return '刚刚'; if (diff < 3600) return Math.floor(diff/60) + '分钟前'
  if (diff < 86400) return Math.floor(diff/3600) + '小时前'; if (diff < 604800) return Math.floor(diff/86400) + '天前'
  return fmtDate(d) }

/* ═══ RPC 调用（统一 payload 约定） ═══ */
async function rpc(fn, params) {
  const { data, error } = await sbAuth.rpc(fn, { payload: params || {} })
  if (error) throw error
  return data
}

/* ═══ 路由 ═══ */
const routes = ['feed', 'market', 'ask', 'thanks', 'me']
function nav(route, force) {
  if (!force && S.route === route) return
  S.route = route
  $$('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === route))
  location.hash = '#' + route
  const renderMap = {
    feed: renderFeed, market: renderMarket, ask: renderAsk,
    thanks: renderThanks, me: renderMe
  }
  ;(renderMap[route] || renderFeed)()
}

/* ═══ 认证 ═══ */
function openAuth() { $('#authMask').hidden = false }
function closeAuth() { $('#authMask').hidden = true }

let authMode = 'login' // login | register
$('#authModeBtn').onclick = () => {
  authMode = authMode === 'login' ? 'register' : 'login'
  $('#authSubmit').textContent = authMode === 'login' ? '登录' : '注册'
  $('#authCodeRow').hidden = authMode === 'login'
  $('#authModeBtn').textContent = authMode === 'login' ? '注册新账号' : '已有账号？登录'
}
$('#authClose').onclick = closeAuth
$('#authMask').addEventListener('click', e => { if (e.target === $('#authMask')) closeAuth() })

$('#authSubmit').onclick = async () => {
  const email = $('#authEmail').value.trim()
  const pass = $('#authPass').value
  if (!email || !pass) return toast('请填写邮箱和密码')
  $('#authSubmit').disabled = true
  try {
    if (authMode === 'register') {
      const { error } = await sbAuth.auth.signUp({ email, password: pass })
      if (error) throw error
      toast('注册成功，请查收验证邮件')
    } else {
      const { error } = await sbAuth.auth.signInWithPassword({ email, password: pass })
      if (error) throw error
      await loadMe()
      closeAuth()
      nav(S.route, true)
    }
  } catch (e) { toast(e.message || '操作失败') }
  $('#authSubmit').disabled = false
}

$('#oauthBtn').onclick = async () => {
  try {
    const { error } = await sbAuth.auth.signInWithOAuth({
      provider: 'custom:shangxianquan',
      options: { redirectTo: location.origin + location.pathname }
    })
    if (error) throw error
  } catch (e) { toast('一键登录暂不可用') }
}

$('#authForgot').onclick = async () => {
  const email = $('#authEmail').value.trim()
  if (!email) return toast('请先输入邮箱')
  const { error } = await sbAuth.auth.resetPasswordForEmail(email)
  if (error) return toast(error.message)
  toast('重置链接已发送到邮箱')
}

async function loadMe() {
  const { data: { session } } = await sbAuth.auth.getSession()
  if (!session) { S.me = null; return }
  try {
    const d = await rpc('xq_me')
    S.me = d
    renderHeader()
  } catch (e) {
    // 可能还没注册 xq_profiles → 自动注册
    try {
      const d = await rpc('xq_update_self', { nick_name: '同学' + Math.floor(Math.random() * 9000 + 1000) })
      S.me = d
      renderHeader()
    } catch (e2) { S.me = null }
  }
}

/* ═══ 渲染：顶栏用户 ═══ */
function renderHeader() {
  const el = $('#hdUser')
  if (S.me) {
    el.innerHTML = `<img src="${esc(S.me.avatar_url || './assets/icons/icon-192.png')}" style="width:34px;height:34px;border-radius:50%;object-fit:cover;cursor:pointer" data-nav="me" alt="">`
  } else {
    el.innerHTML = '<button class="hd-login" onclick="openAuth()">登录</button>'
  }
}

/* ═══ 路由分发 ═══ */
function nav(route, force) {
  if (!force && S.route === route) return
  S.route = route
  $$('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === route))
  location.hash = '#' + route
  const map = { feed: renderFeed, market: renderMarket, ask: renderAsk, thanks: renderThanks, me: renderMe }
  ;(map[route] || renderFeed)()
}

/* ═══ 天气卡 ═══ */
let wxCache = null, wxTime = 0
async function getWeather() {
  if (wxCache && Date.now() - wxTime < 1800000) return wxCache
  try {
    const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=25.24&longitude=110.17&current_weather=true&timezone=Asia/Shanghai')
    const d = await r.json()
    const t = Math.round(d.current_weather.temperature)
    const code = d.current_weather.weathercode
    const desc = {0:'晴',1:'多云',2:'阴',3:'阴',45:'雾',48:'雾',51:'毛毛雨',53:'毛毛雨',55:'毛毛雨',61:'小雨',63:'中雨',65:'大雨',71:'小雪',73:'中雪',75:'大雪',80:'阵雨',81:'阵雨',82:'暴雨',95:'雷雨',96:'雷雨',99:'雷雨'}[code] || '—'
    const tip = t >= 28 ? '天气炎热，注意防晒补水' : t >= 20 ? '温度舒适，适合户外活动' : t >= 12 ? '微凉，建议加件外套' : '天气较冷，注意保暖'
    wxCache = { temp: t, desc, tip }; wxTime = Date.now()
    return wxCache
  } catch (e) { return { temp: '--', desc: '--', tip: '天气服务暂不可用' } }
}

/* ═══ 页面：广场（日常动态流） ═══ */
async function renderFeed() {
  const wx = await getWeather()
  let html = `
    <div class="wx-card">
      <div class="wx-icon">${wx.temp >= 25 ? '☀️' : wx.temp >= 15 ? '⛅' : '🌧️'}</div>
      <div><span class="wx-temp">${wx.temp}°</span><div class="wx-desc">${wx.desc} · 桂林</div><div class="wx-tip">${wx.tip}</div></div>
    </div>`
  if (S.me) {
    html += `
    <div class="card" style="margin-top:14px">
      <div class="sec-title">最新动态</div>
    </div>
    <div id="feedList"><div class="sk" style="width:80%"></div><div class="sk" style="width:60%"></div></div>
    <div style="text-align:center;margin-top:14px"><button class="btn btn-ghost" id="feedMore">加载更多</button></div>`
  } else {
    html += `<div class="card" style="margin-top:14px"><div class="empty">登录后查看校园动态</div></div>`
  }
  $('#main').innerHTML = `<div class="bento">${html}</div>`

  // 加载更多按钮
  const moreBtn = $('#feedMore')
  if (moreBtn) moreBtn.onclick = () => { S.feedPage++; loadFeed(true) }

  if (S.me) await loadFeed(false)
}

let feedList = []
async function loadFeed(append) {
  try {
    const r = await rpc('xq_moments_feed', { page: S.feedPage || 0, pageSize: 20 })
    const list = r.list || r || []
    const isFirst = !append
    if (isFirst) feedList = []
    feedList = feedList.concat(list)
    renderFeedList(isFirst)
    const moreBtn = $('#feedMore')
    if (moreBtn) moreBtn.style.display = list.length === 20 ? '' : 'none'
  } catch (e) { $('#feedList').innerHTML = '<div class="card"><div class="empty">加载失败，请刷新重试</div></div>' }
}

function renderFeedList(isFirst) {
  const el = $('#feedList'); if (!el) return
  const html = feedList.map(m => {
    const imgs = (m.images || []).map(u => `<img src="${esc(u)}" loading="lazy" alt="">`).join('')
    const liked = m.liked ? 'on' : ''
    return `<div class="mcard" data-id="${m.id}">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <img src="${esc(m.avatar_url || './assets/icons/icon-192.png')}" style="width:40px;height:40px;border-radius:50%;object-fit:cover" alt="">
        <div><b style="font-size:14.5px">${esc(m.nick_name || '同学')}</b><div class="muted" style="font-size:12px">${fmtTime(m.created_at)}</div></div>
      </div>
      <div style="font-size:15px;line-height:1.8">${esc(m.content)}</div>
      ${imgs ? `<div class="mcard-imgs" style="margin-top:10px">${imgs}</div>` : ''}
      <div class="mcard-actions">
        <span class="${liked}" data-act="like" data-id="${m.id}">❤️ ${m.like_count || 0}</span>
        <span data-act="cmt" data-id="${m.id}">💬 ${m.comment_count || 0}</span>
      </div>
      <div class="mcard-cmts" id="cmts-${m.id}" hidden></div>
    </div>`
  }).join('')
  if (isFirst) el.innerHTML = html
  else el.insertAdjacentHTML('beforeend', html)
  bindFeedActions()
}

function bindFeedActions() {
  $$('#feedList [data-act]').forEach(el => {
    el.onclick = async () => {
      if (!S.me) return openAuth()
      const id = el.dataset.id, act = el.dataset.act
      if (act === 'like') {
        const r = await rpc('xq_toggle_moment_like', { momentId: id })
        el.classList.toggle('on', r.liked)
        el.innerHTML = '❤️ ' + (r.like_count || 0)
      } else if (act === 'cmt') {
        const box = $('#cmts-' + id)
        if (box.hidden) {
          box.hidden = false
          const r = await rpc('xq_moment_comments', { momentId: id })
          const cmts = (r.list || r || [])
          box.innerHTML = cmts.map(c => `<div class="mcard-cmt"><b>${esc(c.nick_name || '同学')}</b><span>${esc(c.content)}</span></div>`).join('')
            + `<div class="mcard-cmt"><input class="ipt" style="flex:1;padding:6px 10px;font-size:13px" placeholder="写评论…" data-mid="${id}"><button class="chip" style="margin-left:4px" data-send="${id}">发</button></div>`
          box.querySelector('[data-send]').onclick = async (e) => {
            const ipt = e.target.previousElementSibling
            if (!ipt.value.trim()) return
            await rpc('xq_comment_moment', { momentId: id, content: ipt.value.trim() })
            ipt.value = ''
            const more = await rpc('xq_moment_comments', { momentId: id })
            const cl = (more.list || more || [])
            box.innerHTML = cl.map(cm => `<div class="mcard-cmt"><b>${esc(cm.nick_name || '同学')}</b><span>${esc(cm.content)}</span></div>`).join('')
              + `<div class="mcard-cmt"><input class="ipt" style="flex:1;padding:6px 10px;font-size:13px" data-mid="${id}"><button class="chip" data-send="${id}">发</button></div>`
          }
        } else { box.hidden = true }
      }
    }
  })
}

/* ═══ 页面：集市 ═══ */
async function renderMarket() {
  $('#main').innerHTML = `
    <div class="bento">
      <div class="card" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <span style="font-weight:700">二手集市</span>
        <span class="muted" style="font-size:13px">校园二手 · 信息发布 · 平台不介入交易</span>
        <button class="btn btn-primary" style="margin-left:auto;padding:8px 18px;font-size:13px" id="mkAdd">＋ 发布闲置</button>
      </div>
      <div id="mkList"><div class="sk" style="width:80%"></div></div>
    </div>`
  try {
    const r = await rpc('xq_market_list', { page: 0, pageSize: 30 })
    const list = r.list || []
    $('#mkList').innerHTML = list.length
      ? `<div class="mk-grid">${list.map(x => `
        <div class="mk-card">
          ${(x.images || []).length ? `<div class="mk-imgs">${x.images.map(u => `<img src="${esc(u)}" loading="lazy" alt="">`).join('')}</div>` : ''}
          <div class="mk-body">
            <div style="font-weight:700">${esc(x.title)}</div>
            <div class="mk-price">¥${x.price}${x.negotiable ? '<span class="muted" style="font-size:12px"> 可议</span>' : ''}</div>
            <div class="muted" style="font-size:13px;margin-top:4px">${esc((x.detail || '').slice(0, 80))}</div>
            <div class="mk-tags"><span class="tag">${esc(x.condition || '九成新')}</span><span class="tag">${fmtTime(x.created_at)}</span></div>
          </div>
        </div>`).join('')}</div>`
      : '<div class="card"><div class="empty">暂无闲置物品</div></div>'
  } catch (e) { $('#mkList').innerHTML = '<div class="card"><div class="empty">加载失败</div></div>' }

  $('#mkAdd').onclick = () => toast('发布功能即将上线，敬请期待')
}

/* ═══ 页面：提问 ═══ */
async function renderAsk() {
  $('#main').innerHTML = `
    <div class="seg">
      <button id="askSegQ" class="${S.askTab === 'q' ? 'on' : ''}">提问社区</button>
      <button id="askSegKb" class="${S.askTab === 'kb' ? 'on' : ''}">知识库</button>
    </div>
    <div id="askQArea">
      <div class="card" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <input class="ipt" id="askTag" placeholder="按标签筛选，如：数学" style="flex:1" value="${esc(S.askTag)}" />
        <button class="chip ${S.askSort === 'bump' ? 'on' : ''}" data-sort="bump">悬赏优先</button>
        <button class="chip ${S.askSort === 'new' ? 'on' : ''}" data-sort="new">最新</button>
      </div>
      <div class="card" style="margin-top:12px">
        <div class="sec-title">怎么提问</div>
        <div class="muted" style="line-height:1.9">1. 标题写清楚，别人才好帮你<br />2. 可悬赏鸡腿，采纳后你手动答谢<br />3. 48 小时内可催办一次<br />4. 全部实名，请友善交流</div>
      </div>
      <div id="rankBox" style="margin-top:12px"><div class="card"><div class="sec-title">每周双榜</div><div class="muted">读取中…</div></div></div>
      <div id="askList"><div class="sk" style="width:80%"></div><div class="sk" style="width:60%"></div></div>
    </div>
    <div id="askKbArea" style="display:none"><div class="sk" style="width:70%"></div></div>`

  $$('[data-sort]').forEach(b => { b.onclick = () => { S.askSort = b.dataset.sort; renderAsk() } })
  $('#askTag').onkeydown = e => { if (e.key === 'Enter') { S.askTag = $('#askTag').value.trim(); renderAsk() } }
  $('#askSegQ').onclick = () => { S.askTab = 'q'; renderAsk() }
  $('#askSegKb').onclick = () => { S.askTab = 'kb'; renderAsk() }

  // 双榜
  rpc('xq_weekly_rank', {}).then(r => {
    const d = r; const box = $('#rankBox'); if (!box) return
    const mk = (arr, title) => arr && arr.length
      ? `<div class="sec-title">${title}</div>` + arr.map((x, i) => `<div style="display:flex;gap:8px;padding:4px 0"><b style="color:var(--gold);min-width:20px">${i+1}</b><span>${esc(x.name || x.nick_name || '同学')}</span><span style="margin-left:auto;color:var(--muted);font-size:12px">${x.score || x.count || ''}</span></div>`).join('')
      : '<div class="muted">虚位以待</div>'
    box.innerHTML = '<div class="card">' + mk(d.answer_rank, '热心回答榜') + '<div style="height:8px"></div>' + mk(d.question_rank, '优质提问榜') + '</div>'
  }).catch(() => { if ($('#rankBox')) $('#rankBox').innerHTML = '<div class="card"><div class="sec-title">每周双榜</div><div class="muted">加载失败</div></div>' })

  // 问题列表
  try {
    const r = await rpc('xq_questions_list', { tag: S.askTag, sort: S.askSort, page: 0, pageSize: 30 })
    const list = r.list || []
    $('#askList').innerHTML = list.length
      ? list.map(q => `<div class="qcard" data-qid="${q._id}">
          <div class="qcard-title">${esc(q.title)}</div>
          <div class="muted" style="margin:6px 0">${esc((q.detail || '').slice(0, 100))}${(q.detail || '').length > 100 ? '…' : ''}</div>
          <div class="qcard-meta">
            <span>💬 ${q.answer_count || 0}</span><span>👁 ${q.views || 0}</span>
            ${q.bounty_tier ? '<span class="qcard-bounty">🍗 悬赏</span>' : ''}
            ${q.status === 'resolved' ? '<span class="qcard-resolved">✓ 已解决</span>' : ''}
            ${q.tags ? (Array.isArray(q.tags) ? q.tags : [q.tags]).map(t => `<span class="qcard-tag">${esc(t)}</span>`).join('') : ''}
          </div>
        </div>`).join('')
      : '<div class="card"><div class="empty">暂无问题</div></div>'
    $$('#askList [data-qid]').forEach(el => { el.onclick = () => toast('问题详情页即将上线') })
  } catch (e) { $('#askList').innerHTML = '<div class="card"><div class="empty">加载失败</div></div>' }

  if (S.askTab === 'kb') {
    $('#askQArea').style.display = 'none'
    $('#askKbArea').style.display = ''
    $('#askKbArea').innerHTML = '<div class="sk" style="width:70%"></div>'
    try {
      const r = await rpc('xq_kb_list', { tag: S.askTag, page: 0, pageSize: 30 })
      const list = r.list || []
      $('#askKbArea').innerHTML = list.length
        ? list.map(e => `<div class="card" style="margin-bottom:10px"><div style="font-weight:700">${esc(e.question_title || '')}</div><div class="muted" style="font-size:13px;margin:4px 0">${esc((e.answer_content || '').slice(0, 120))}…</div><div style="font-size:12px;color:var(--gold)">👍 ${e.useful || 0}</div></div>`).join('')
        : '<div class="card"><div class="empty">知识库暂无条目</div></div>'
    } catch (e) { $('#askKbArea').innerHTML = '<div class="card"><div class="empty">加载失败</div></div>' }
  }
}

/* ═══ 页面：鸣谢 ═══ */
async function renderThanks() {
  $('#main').innerHTML = '<div class="card"><div class="sec-title">支持尚贤圈 · 鸣谢墙</div><div class="sk" style="width:50%"></div></div>'
  try {
    const r = await rpc('xq_thanks_wall', {})
    const d = r
    const ph = (n, t) => Array.from({ length: n }, () => t)
    const row = (arr, cls, label) => {
      const items = arr && arr.length ? arr : ph(3, { name: '虚位以待' })
      return `<div class="tier-card"><div class="tier-head"><span class="tier-name">${label}</span></div><div class="mq"><div class="mq-track">${items.map(x => `<span class="thanks-name">${esc(x.name || x)}</span>`).join('')}</div></div></div>`
    }
    $('#main').innerHTML = `
      <div class="card"><div class="sec-title">鸣谢墙</div><div class="muted">感谢每一位支持尚贤圈的同学与朋友</div></div>
      <div class="tier-row">
        ${row(d.diamond, '', '钻级鸡腿 ¥200 · 永久铭牌')}
        ${row(d.star, '', '星级鸡腿 ¥100 · 永久名单')}
        ${row(d.royal, '', '皇级鸡腿 ¥50 · 当月陈列')}
      </div>
      <div class="card" style="margin-top:16px"><div class="muted">每一根鸡腿都会公示用途：三成以上（普遍五到八成）直接投入平台开发与维护。</div>
      <a class="btn btn-primary" style="display:inline-flex;margin-top:12px" href="https://ifdian.net/a/kernthal-sxquan" target="_blank">前往支持 →</a></div>`
  } catch (e) { $('#main').innerHTML = '<div class="card"><div class="empty">鸣谢墙加载失败</div></div>' }
}

/* ═══ 页面：我的 ═══ */
async function renderMe() {
  if (!S.me) { openAuth(); $('#main').innerHTML = '<div class="card"><div class="empty">登录后查看我的贤圈</div></div>'; return }
  const m = S.me
  $('#main').innerHTML = `
    <div class="bento">
      <div class="cell c-main">
        <div class="card" style="text-align:center">
          <img src="${esc(m.avatar_url || './assets/icons/icon-192.png')}" style="width:72px;height:72px;border-radius:50%;object-fit:cover;margin:0 auto 12px" alt="">
          <div style="font-weight:800;font-size:18px">${esc(m.nick_name || '同学')}</div>
          <div class="muted" style="font-size:13px;margin:4px 0">${esc(m.signature || '')}</div>
          ${m.xq_id ? `<div style="font-size:12px;color:var(--gold);margin-top:4px">贤圈ID ${esc(m.xq_id)} · 已绑定 ✓</div>` : `<button class="btn btn-ghost" style="margin-top:8px;padding:8px 20px;font-size:13px" onclick="toast('绑定功能即将上线')">绑定贤圈ID</button>`}
        </div>
        <div class="card" style="margin-top:14px">
          <div class="sec-title">我的徽章</div>
          <div id="myBadges"><div class="muted">加载中…</div></div>
        </div>
      </div>
      <div class="cell">
        <div class="card">
          <div class="sec-title">账号操作</div>
          <button class="btn btn-ghost" style="width:100%;margin-bottom:8px" onclick="toast('编辑功能即将上线')">编辑资料</button>
          <button class="btn btn-ghost" style="width:100%" onclick="if(confirm('确定退出登录？')){sbAuth.auth.signOut().then(()=>location.reload())}">退出登录</button>
        </div>
      </div>
    </div>`
  // 徽章
  rpc('xq_badges_all', {}).then(r => {
    const el = $('#myBadges'); if (!el) return
    const list = r.list || r || []
    el.innerHTML = list.length
      ? `<div class="badge-grid">${list.map(b => `<div class="badge-cell ${b.earned ? 'earned' : ''}"><div class="badge-ico">${b.earned ? b.icon : '🔒'}</div><div class="badge-name">${esc(b.name)}</div></div>`).join('')}</div>`
      : '<div class="muted">暂无徽章</div>'
  }).catch(() => {})
}

/* ═══ 发布球 ═══ */
$('#fab').onclick = () => {
  if (!S.me) return openAuth()
  if (S.route === 'ask') return toast('提问功能请在"提问"标签页使用')
  toast('发布功能即将上线')
}
$('#tabPlus').onclick = $('#fab').onclick

/* ═══ 导航事件 ═══ */
document.addEventListener('click', e => {
  const navEl = e.target.closest && e.target.closest('[data-nav]')
  if (navEl) { nav(navEl.dataset.nav); return }
  if (e.target.closest('#burger')) {
    $('#burger').classList.toggle('open')
    $('#drawer').hidden = !$('#drawer').hidden
    $('#drawerMask').hidden = !$('#drawer').hidden
  }
  if (e.target.id === 'drawerMask' || e.target.closest('.drawer a')) {
    $('#drawer').hidden = true; $('#drawerMask').hidden = true
    $('#burger').classList.remove('open')
  }
  if (e.target.closest('#tabPlus')) return
})
$$('#tabbar a, #drawer a').forEach(a => { a.addEventListener('click', () => { closeDrawer() }) })
function closeDrawer() { const d = $('#drawer'); if (d) d.hidden = true; const m = $('#drawerMask'); if (m) m.hidden = true; const b = $('#burger'); if (b) b.classList.remove('open') }

/* ═══ 初始化 ═══ */
;(async () => {
  // 检查 hash 路由
  const hash = location.hash.replace('#', '')
  const initialRoute = routes.includes(hash) ? hash : 'feed'
  await loadMe()
  nav(initialRoute, true)
  // 启动红点轮询
  startUnreadPoll()
})()

function startUnreadPoll() {
  if (window.__uPoll) return
  window.__uPoll = setInterval(async () => {
    if (!S.me) return
    try {
      // 可扩展：刷新通知红点
    } catch (e) {}
  }, 30000)
}
