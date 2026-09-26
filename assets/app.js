/* ═══ 贤圈中心 · 逻辑层 v2 ═══
   新库 ocgqafxaapfzraeiehqg + 主库 OAuth 单点登录
   规范：统一 payload 单参数 · 统一 {ok,data} 信封（此处统一解包）
   契约以 supabase/patches/014·016·019·020·022·023 + 线上实测为准
   ═══════════════════════════════════════════ */

'use strict'

/* ═══ 常量 ═══ */
const SB_URL  = 'https://ocgqafxaapfzraeiehqg.supabase.co'
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9jZ3FhZnhhYXBmenJhZWllaHFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5OTYwOTYsImV4cCI6MjEwMzU3MjA5Nn0.icNXBGRtofllZkvypUvbJqwRxxaLwVLaXC92J5DhKI0'
const MAIN_URL  = 'https://gfxkpljewqchdbrepqia.supabase.co'
const MAIN_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdmeGtwbGpld3FjaGRicmVwcWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2MjA2NDIsImV4cCI6MjEwMzE5NjY0Mn0.VWr_iNA25QTviaFiwYMvTV43ZK3I7kEKXSYO5jHZrBY'
const BUCKET    = 'xq-images'

/* ═══ Supabase 客户端 ═══ */
const sbAuth = supabase.createClient(SB_URL, SB_ANON, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
})
const sbMain = supabase.createClient(MAIN_URL, MAIN_ANON, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'xq-main' }
})

/* ═══ 状态 ═══ */
const S = {
  me: null,
  route: 'feed',
  feedSort: 'new',
  feedPage: 0,
  feedList: [],
  feedDone: false,
  mkTab: 'selling',
  lostTab: 'lost',
  askTab: 'q',
  askSort: 'bump',
  askTag: '',
  meTab: 'mine',
  unread: 0,
  notifOn: false,
  notifTimer: null,
  routineOn: true,
  routineHalf: false,
  routineTimer: null,
  feedWatchTimer: null,
  busy: false,
}

/* ═══ 工具 ═══ */
const $  = (s) => document.querySelector(s)
const $$ = (s) => Array.from(document.querySelectorAll(s))
const esc = (s) => { if (s === null || s === undefined) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }
const AV = './assets/icons/icon-192.png'
const toast = (msg, ms) => {
  const t = $('#toast'); if (!t) return
  t.textContent = msg; t.hidden = false
  clearTimeout(t._timer); t._timer = setTimeout(() => { t.hidden = true }, ms || 2400)
}
const fmtDate = (d) => { if (!d) return ''; const x = new Date(d); return (x.getMonth()+1) + '月' + x.getDate() + '日' }
const fmtTime = (d) => {
  if (!d) return ''
  const x = new Date(d), diff = (Date.now() - x.getTime()) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return Math.floor(diff/60) + '分钟前'
  if (diff < 86400) return Math.floor(diff/3600) + '小时前'
  if (diff < 604800) return Math.floor(diff/86400) + '天前'
  return fmtDate(d)
}
const tagsOf = (t) => !t ? [] : (Array.isArray(t) ? t : [t])

/* ═══ 收藏 / 关注（依赖 026 补丁；未执行时自动降级为空集） ═══ */
const FAV = { moment: new Set(), question: new Set(), market: new Set() }
let QFOLLOW = new Set()

async function refreshFavIds (type) {
  if (!S.me) { FAV[type] = new Set(); return }
  try {
    const d = await rpc('xq_favorite_ids', { targetType: type })
    FAV[type] = new Set((d && d.ids) || [])
  } catch (e) { FAV[type] = new Set() }
}
async function refreshQFollowIds () {
  if (!S.me) { QFOLLOW = new Set(); return }
  try {
    const d = await rpc('xq_question_follow_ids')
    QFOLLOW = new Set((d && d.ids) || [])
  } catch (e) { QFOLLOW = new Set() }
}
const favOn = (type, id) => FAV[type] && FAV[type].has(id)

/* 通用收藏切换：成功后更新本地集合并回调重绘 */
async function toggleFav (type, id, after) {
  if (!S.me) return openAuth()
  try {
    const d = await rpc('xq_toggle_favorite', { targetType: type, targetId: id })
    if (!FAV[type]) FAV[type] = new Set()
    if (d.favorited) FAV[type].add(id); else FAV[type].delete(id)
    toast(d.favorited ? '已收藏' : '已取消收藏')
    if (after) after()
  } catch (e) {
    if (String(e.message || '').includes('does not exist') || String(e.message || '').includes('Could not find')) {
      toast('收藏功能待数据库补丁 026 执行后可用')
    } else toast(e.message)
  }
}

/* 用户名片浮层（点头像/昵称打开） */
async function openUserSheet (uid) {
  if (!uid) return
  const layer = $('#layer')
  layer.hidden = false
  const isMe = S.me && uid === S.me.userId
  layer.innerHTML = '<div class="sheet narrow" data-sheet><button class="sheet-x" data-close>' + ICON.close + '</button>' +
    '<div class="sk-line">加载中…</div></div>'
  bindSheet()
  try {
    const [fd, fdollow] = await Promise.all([
      rpc('xq_moments_feed', { page: 0, pageSize: 50 }).catch(() => ({ list: [] })),
      rpc('xq_follow_list', { kind: 'following' }).catch(() => ({ list: [] })),
    ])
    const mine = ((fd && fd.list) || []).filter((x) => (x.author || {}).userId === uid)
    const node = mine[0] ? mine[0].author : null
    const nickname = node ? node.nickname : '同学'
    const avatar = node ? node.avatarUrl : ''
    const following = ((fdollow && fdollow.list) || []).some((x) => x.userId === uid)
    layer.innerHTML = '<div class="sheet narrow" data-sheet>' +
      '<button class="sheet-x" data-close>' + ICON.close + '</button>' +
      '<div class="u-card">' +
        '<img class="me-ava" src="' + esc(avatar || AV) + '" alt="">' +
        '<div class="me-name">' + esc(nickname) + '</div>' +
        '<div class="me-id">' + mine.length + ' 条公开动态</div>' +
        (isMe ? '<div class="muted" style="margin-top:10px">这是你自己</div>'
              : '<button class="btn-mini' + (following ? ' on' : '') + '" id="uFollow">' + (following ? '已关注' : '关注') + '</button>') +
      '</div>' +
      '<div class="ans-head">TA 的动态</div>' +
      '<div class="ans-list">' + (mine.length
        ? mine.slice(0, 6).map((x) => '<div class="ans"><p>' + esc(x.content || '（图片动态）') + '</p>' +
            '<header style="margin:6px 0 0"><time>' + fmtTime(x.createTime) + '</time></header></div>').join('')
        : '<div class="empty">暂无公开动态</div>') + '</div>' +
    '</div>'
    bindSheet()
    const fu = $('#uFollow')
    if (fu) fu.onclick = async () => {
      try {
        const d = await rpc('xq_toggle_follow', { userId: uid })
        fu.textContent = d.following ? '已关注' : '关注'
        fu.classList.toggle('on', d.following)
        toast(d.following ? '已关注' : '已取消关注')
      } catch (e) {
        if (String(e.message || '').includes('Could not find')) toast('关注功能待数据库补丁 026 执行后可用')
        else toast(e.message)
      }
    }
  } catch (e) {
    layer.innerHTML = '<div class="sheet narrow"><button class="sheet-x" data-close>' + ICON.close + '</button><div class="empty">加载失败：' + esc(e.message) + '</div></div>'
    bindSheet()
  }
}

/* ═══ RPC（统一解包 {ok,data}） ═══ */
async function rpc (fn, params) {
  const { data, error } = await sbAuth.rpc(fn, { payload: params || {} })
  if (error) throw error
  if (data && typeof data === 'object' && !Array.isArray(data)
      && data.ok === true && Object.prototype.hasOwnProperty.call(data, 'data')) {
    return data.data
  }
  return data
}

/* ═══ 认证 ═══ */
function openAuth () { const m = $('#authMask'); if (m) m.hidden = false }
function closeAuth () { const m = $('#authMask'); if (m) m.hidden = true }

let authMode = 'login'
function setAuthMode (mode) {
  authMode = mode
  const isLogin = mode === 'login'
  $('#authSubmit').textContent = isLogin ? '登录' : '注册'
  $('#authCodeRow').hidden = isLogin
  $('#authModeBtn').textContent = isLogin ? '注册新账号' : '已有账号？登录'
  const t = $('#authTitle'); if (t) t.textContent = isLogin ? '登录贤圈中心' : '注册贤圈中心'
}

/* ═══════════ 本地存储小工具 ═══════════
   ⚠️ 之前这两个函数只在别处被调用，却从来没有定义过 —— 一共 10 处调用全是抛异常：
     · saveNotifPref()      → 设置页三个开关点了没反应（改完内存状态就抛错，界面没更新）
     · loadMusicPref()      → 网易云登录与音量保存不上
     · initInstallPrompt()  → PC「搞到桌面」提示永远不出现
     · initIosInstallGuide()→ iOS 添加到主屏幕引导永远不出现
     · startRoutineNotify() → 整点报时去重失效，可能重复提醒
   因为这些调用大多包在 try/catch 里，异常被静默吞掉，所以一直没被发现。
   现在补上，并把所有异常都留在返回值里，不再静默。 */
function readLS (key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null || raw === undefined) return fallback
    return JSON.parse(raw)
  } catch (e) { return fallback }
}
function writeLS (key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true }
  catch (e) { return false }
}

function bindAuth () {
  $('#authModeBtn').onclick = () => setAuthMode(authMode === 'login' ? 'register' : 'login')
  $('#authClose').onclick = closeAuth
  $('#authMask').addEventListener('click', (e) => { if (e.target === $('#authMask')) closeAuth() })

  $('#authSubmit').onclick = async () => {
    const email = $('#authEmail').value.trim()
    const pass = $('#authPass').value
    if (!email || !pass) return toast('请填写邮箱和密码')
    if (authMode === 'register' && pass.length < 6) return toast('密码至少 6 位')
    const btn = $('#authSubmit'); btn.disabled = true
    try {
      if (authMode === 'register') {
        const { error } = await sbAuth.auth.signUp({ email, password: pass })
        if (error) throw error
        toast('注册成功，请查收验证邮件后登录')
      } else {
        const { error } = await sbAuth.auth.signInWithPassword({ email, password: pass })
        if (error) throw error
        await loadMe()
        closeAuth()
        render()
        toast('欢迎回来' + (S.me && S.me.nickname ? '，' + S.me.nickname : ''))
      }
    } catch (e) { toast(e.message || '操作失败') }
    btn.disabled = false
  }

  $('#oauthBtn').onclick = async () => {
    try {
      const { error } = await sbAuth.auth.signInWithOAuth({
        provider: 'custom:shangxianquan',
        options: { redirectTo: location.origin + location.pathname }
      })
      if (error) throw error
    } catch (e) { toast('一键登录暂不可用，请用邮箱密码登录') }
  }

  $('#authForgot').onclick = async () => {
    const email = $('#authEmail').value.trim()
    if (!email) return toast('请先输入邮箱')
    const { error } = await sbAuth.auth.resetPasswordForEmail(email)
    if (error) return toast(error.message)
    toast('重置链接已发送到邮箱')
  }
}

async function loadMe () {
  // getSession() 在 OAuth 回调期间可能抛错（URL 处理 / 锁竞争），这里必须兜住，
  // 否则会让整个启动流程中断、页面空白。
  let session = null
  try {
    const r = await sbAuth.auth.getSession()
    session = (r && r.data) ? r.data.session : null
  } catch (e) { session = null }
  if (!session) { S.me = null; try { renderHeader() } catch (e2) {}; return }
  try {
    S.me = await rpc('xq_me')
  } catch (e) {
    try {
      await rpc('xq_update_self', { nickname: '同学' + Math.floor(Math.random()*9000+1000) })
      S.me = await rpc('xq_me')
    } catch (e2) { S.me = null }
  }
  try { renderHeader() } catch (e3) {}
}

/* ═══ 顶栏 ═══ */
function renderHeader () {
  const el = $('#hdUser'); if (!el) return
  if (S.me) {
    el.innerHTML =
      '<button class="hd-ic" id="hdSearch" title="搜索" aria-label="搜索">' + ICON.search + '</button>' +
      '<button class="hd-ic" id="hdBell" title="通知" aria-label="通知">' + ICON.bell +
        '<i class="hd-dot" id="hdDot" hidden></i></button>' +
      '<img class="hd-ava" src="' + esc(S.me.avatarUrl || AV) + '" data-nav="me" alt="我的">'
    $('#hdSearch').onclick = openSearch
    $('#hdBell').onclick = openNotify
  } else {
    el.innerHTML = '<button class="hd-login" id="hdLogin">登录</button>'
    $('#hdLogin').onclick = openAuth
  }
  paintUnread()
}

/* ═══ 图标（内联 SVG，无 emoji） ═══ */
const ICON = {
  search: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M16.5 16.5L21 21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  bell:   '<svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M18 8a6 6 0 10-12 0c0 7-3 8-3 8h18s-3-1-3-8" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M13.7 21a2 2 0 01-3.4 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  heart:  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none"><path d="M12 20s-7-4.6-7-9.6A4 4 0 0112 8a4 4 0 017 2.4c0 5-7 9.6-7 9.6z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  heartF: '<svg viewBox="0 0 24 24" width="15" height="15"><path d="M12 20s-7-4.6-7-9.6A4 4 0 0112 8a4 4 0 017 2.4c0 5-7 9.6-7 9.6z" fill="currentColor"/></svg>',
  chat:   '<svg viewBox="0 0 24 24" width="15" height="15" fill="none"><path d="M21 12a8 8 0 01-8 8H7l-4 3v-6.5A8 8 0 1113 4a8 8 0 018 8z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  eye:    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none"><path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.6" stroke="currentColor" stroke-width="2"/></svg>',
  close:  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  plus:   '<svg viewBox="0 0 24 24" width="20" height="20" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  star:   '<svg viewBox="0 0 24 24" width="15" height="15" fill="none"><path d="M12 4l2.5 5.2 5.5.8-4 3.9.95 5.6L12 16.8 7.05 19.5 8 13.9 4 10l5.5-.8z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>',
  starF:  '<svg viewBox="0 0 24 24" width="15" height="15"><path d="M12 4l2.5 5.2 5.5.8-4 3.9.95 5.6L12 16.8 7.05 19.5 8 13.9 4 10l5.5-.8z" fill="currentColor"/></svg>',
  bellS:  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none"><path d="M18 8a6 6 0 10-12 0c0 7-3 8-3 8h18s-3-1-3-8" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M13.7 21a2 2 0 01-3.4 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  bellSF: '<svg viewBox="0 0 24 24" width="15" height="15"><path d="M18 8a6 6 0 10-12 0c0 7-3 8-3 8h18s-3-1-3-8z" fill="currentColor"/><path d="M13.7 21a2 2 0 01-3.4 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  wallet: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none"><rect x="3" y="6" width="18" height="13" rx="2.5" stroke="currentColor" stroke-width="1.9"/><path d="M3 10h18M16.5 14.5h1.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
}

/* ═══ 路由（单页 Tab 切换） ═══ */
const ROUTES = ['feed', 'market', 'lost', 'ask', 'thanks', 'me']

function nav (route, force) {
  if (!force && S.route === route) { render(); return }
  S.route = route
  if (location.hash !== '#' + route) location.hash = route
  render()
}

function render () {
  $$('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === S.route))
  const map = {
    feed: renderFeed, market: renderMarket, lost: renderLost,
    ask: renderAsk, thanks: renderThanks, me: renderMe
  }
  const fn = map[S.route] || renderFeed
  try { fn() } catch (e) { $('#main').innerHTML = '<div class="card"><div class="empty">页面渲染出错：' + esc(e.message) + '</div></div>' }
  try { paintMusic() } catch (e) {}
}

/* ═══ 天气 ═══ */
let wxCache = null, wxTime = 0

const WMO = {
  0:'晴', 1:'少云', 2:'多云', 3:'阴', 45:'雾', 48:'雾凇',
  51:'毛毛雨', 53:'毛毛雨', 55:'毛毛雨', 56:'冻毛毛雨', 57:'冻毛毛雨',
  61:'小雨', 63:'中雨', 65:'大雨', 66:'冻雨', 67:'冻雨',
  71:'小雪', 73:'中雪', 75:'大雪', 77:'米雪',
  80:'阵雨', 81:'强阵雨', 82:'暴雨', 85:'阵雪', 86:'强阵雪',
  95:'雷阵雨', 96:'雷阵雨伴冰雹', 99:'强雷暴伴冰雹',
}
const WMO_NIGHT = { 0:'晴', 1:'晴间多云', 2:'多云' }
const DIRS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北']
const windDirText = (deg) => DIRS[Math.round(((Number(deg) || 0) % 360) / 45) % 8] + '风'

function wxTip (t) {
  if (t >= 32) return '高温，注意防晒补水，避免正午长时间户外'
  if (t >= 28) return '天气炎热，注意防晒补水'
  if (t >= 20) return '温度舒适，适合户外活动'
  if (t >= 12) return '微凉，建议加件外套'
  if (t >= 5) return '天气较冷，注意保暖'
  return '寒冷，务必穿厚外套、注意防寒'
}
function wxBand (t) {
  return t >= 32 ? 'hot' : t >= 28 ? 'hot' : t >= 20 ? 'mild' : t >= 12 ? 'cool' : 'cold'
}
const dayLabel = (iso, idx) => {
  if (idx === 0) return '今天'
  if (idx === 1) return '明天'
  if (idx === 2) return '后天'
  const d = new Date(iso)
  return '周' + ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
}

/* 穿衣建议：按温度分档，叠加降水与风力修正 */
function wxOutfit (wx) {
  const t = Number(wx.temp)
  const rainy = /雨|雷/.test(wx.desc || '')
  const windy = Number(wx.wind) >= 20
  let main = '', tags = []
  if (t >= 32) { main = '高温天气，穿轻薄透气的短袖短裤，注意防晒与补水。'; tags = ['短袖', '短裤', '防晒'] }
  else if (t >= 28) { main = '天气炎热，短袖 T 恤或薄衬衫即可，面料以透气为主。'; tags = ['短袖 T 恤', '薄长裤', '透气'] }
  else if (t >= 24) { main = '温度舒适，短袖或薄长袖都合适；早晚可备一件薄外套。'; tags = ['短袖 / 薄长袖', '薄外套'] }
  else if (t >= 20) { main = '微暖偏凉，建议长袖衬衫或薄卫衣，下装长裤。'; tags = ['长袖衬衫', '薄卫衣', '长裤'] }
  else if (t >= 16) { main = '有点凉，加一件薄外套或针织衫比较稳妥。'; tags = ['薄外套', '针织衫'] }
  else if (t >= 12) { main = '较凉，建议夹克或风衣配长裤，注意早晚温差。'; tags = ['夹克', '风衣', '长裤'] }
  else if (t >= 5) { main = '偏冷，穿厚外套或毛衣，注意保暖别着凉。'; tags = ['厚外套', '毛衣'] }
  else { main = '寒冷，务必穿羽绒服或棉服，围巾手套也别落下。'; tags = ['羽绒服', '围巾', '手套'] }
  if (rainy) { main += ' 今天有降水，出门记得带伞，鞋子选防滑的。'; tags.push('带伞') }
  if (windy) { main += ' 风力较大，外套建议选防风款。'; tags.push('防风外套') }
  return { main, tags }
}

async function getWeather () {
  if (wxCache && Date.now() - wxTime < 1800000) return wxCache
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=25.24&longitude=110.17'
    + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset'
    + '&hourly=temperature_2m,weather_code&timezone=Asia%2FShanghai&forecast_days=3'
  try {
    const r = await fetch(url)
    const d = await r.json()
    const c = d.current || {}
    const t = Math.round(c.temperature_2m)
    const daily = ((d.daily && d.daily.time) || []).map((iso, i) => ({
      date: iso,
      max: Math.round(d.daily.temperature_2m_max[i]),
      min: Math.round(d.daily.temperature_2m_min[i]),
      code: d.daily.weather_code[i],
      sunrise: String(d.daily.sunrise[i] || '').slice(11, 16),
      sunset: String(d.daily.sunset[i] || '').slice(11, 16),
    }))
    const nowIso = c.time || ''
    const hours = (((d.hourly && d.hourly.time) || []).map((iso, i) => ({
      iso, t: Math.round(d.hourly.temperature_2m[i]), code: d.hourly.weather_code[i],
    })).filter((h) => h.iso >= nowIso).slice(0, 12))
    wxCache = {
      temp: t, desc: WMO[c.weather_code] || '—', tip: wxTip(t), band: wxBand(t),
      feels: Math.round(c.apparent_temperature),
      humidity: c.relative_humidity_2m,
      wind: Math.round(c.wind_speed_10m),
      windDir: windDirText(c.wind_direction_10m),
      daily, hours, today: daily[0] || null,
    }
    wxTime = Date.now()
    return wxCache
  } catch (e) {
    return { temp: '--', desc: '--', tip: '天气服务暂不可用', band: 'na', daily: [], hours: [] }
  }
}

/* 天气详情模态框 */
async function openWeather () {
  const layer = $('#layer')
  layer.hidden = false
  layer.innerHTML = '<div class="sheet narrow" data-sheet><button class="sheet-x" data-close>' + ICON.close + '</button><div class="sk-line">读取天气…</div></div>'
  bindSheet()
  const wx = await getWeather()
  const dl = wx.daily || [], hs = wx.hours || []
  const fit = wxOutfit(wx)
  layer.innerHTML = '<div class="sheet narrow" data-sheet>' +
    '<button class="sheet-x" data-close>' + ICON.close + '</button>' +
    '<div class="sheet-h"><h3>天气详情</h3><span class="wx-loc">桂林 · 尚贤</span></div>' +
    '<div class="wxm-hero wx-' + esc(wx.band) + '">' +
      '<div class="wxm-now"><span class="wxm-temp">' + esc(wx.temp) + '<i>°</i></span>' +
        '<div><b>' + esc(wx.desc) + '</b><span>体感 ' + esc(wx.feels) + '°</span></div></div>' +
      '<div class="wxm-facts">' +
        '<div class="wxm-fact"><b>' + esc(wx.humidity) + '%</b><span>湿度</span></div>' +
        '<div class="wxm-fact"><b>' + esc(wx.wind) + '</b><span>风速 km/h</span></div>' +
        '<div class="wxm-fact"><b>' + esc(wx.windDir) + '</b><span>风向</span></div>' +
      '</div>' +
    '</div>' +
    '<div class="wxm-tip">' + esc(wx.tip) + '</div>' +
    '<div class="wxm-outfit">' +
      '<div class="wxm-outfit-h">穿衣建议</div>' +
      '<p>' + esc(fit.main) + '</p>' +
      '<div class="wxm-tags">' + fit.tags.map((t) => '<span>' + esc(t) + '</span>').join('') + '</div>' +
    '</div>' +
    (dl.length ? '<div class="wxm-sec"><div class="sec-title">未来三天</div><div class="wxm-days">' +
      dl.map((d, i) => '<div class="wxm-day">' +
        '<div class="wxm-dname">' + dayLabel(d.date, i) + '</div>' +
        '<div class="wxm-ddesc">' + esc(WMO[d.code] || '—') + '</div>' +
        '<div class="wxm-dtemp"><b>' + esc(d.max) + '°</b><span>' + esc(d.min) + '°</span></div>' +
      '</div>').join('') + '</div></div>' : '') +
    (hs.length ? (function () {
      const temps = hs.map((h) => h.t)
      const mn = Math.min.apply(null, temps), mx = Math.max.apply(null, temps)
      const span = Math.max(1, mx - mn)
      return '<div class="wxm-sec"><div class="sec-title">未来 12 小时<span class="sec-sub">' + esc(mn) + '° ~ ' + esc(mx) + '°</span></div>' +
        '<div class="wxm-hours">' + hs.map((h) => {
          const pct = 24 + Math.round((h.t - mn) / span * 68)
          return '<div class="wxm-hour">' +
            '<span class="wxm-ht">' + esc(h.t) + '°</span>' +
            '<span class="wxm-barw"><i style="height:' + pct + '%"></i></span>' +
            '<span class="wxm-hh">' + esc(String(h.iso).slice(11, 16)) + '</span>' +
          '</div>'
        }).join('') + '</div></div>'
    })() : '') +
    (wx.today && wx.today.sunrise ? '<div class="wxm-sec"><div class="sec-title">日出日落</div>' +
      '<div class="wxm-sun"><span>日出 <b>' + esc(wx.today.sunrise) + '</b></span><span>日落 <b>' + esc(wx.today.sunset) + '</b></span></div></div>' : '') +
    '<div class="wxm-foot">数据来源：Open-Meteo · 缓存 30 分钟</div>' +
  '</div>'
  bindSheet()
}

/* ═══════════════════ 广场 ═══════════════════ */
async function renderFeed () {
  $('#main').innerHTML =
    '<div class="bento">' +
      '<div class="cell c-side">' + skeletonAside() + '</div>' +
      '<div class="cell c-main">' +
        '<div class="feed-bar">' +
          '<div class="seg">' +
            '<button data-fsort="new" class="' + (S.feedSort === 'new' ? 'on' : '') + '">最新</button>' +
            '<button data-fsort="hot" class="' + (S.feedSort === 'hot' ? 'on' : '') + '">热门</button>' +
            '<button data-fsort="collection" class="' + (S.feedSort === 'collection' ? 'on' : '') + '">合集</button>' +
          '</div>' +
          '<button class="btn-mini" id="feedPublish">' + ICON.plus + ' 发布动态</button>' +
        '</div>' +
        '<div id="feedList"></div>' +
        '<div class="list-foot" id="feedFoot"></div>' +
      '</div>' +
    '</div>'

  $$('[data-fsort]').forEach((b) => { b.onclick = () => { S.feedSort = b.dataset.fsort; S.feedPage = 0; S.feedList = []; S.feedDone = false; render() } })
  $('#feedPublish').onclick = () => openCompose('moment')

  fill_weather(); fill_notice()
  if (S.feedSort === 'collection') renderCollection()
  else loadFeed(false)
}

/* ── 热门合集 + 月度月刊（S2/S3，纯前端派生，无需新表） ── */
function heat (x) { return (x.likes || 0) + (x.commentsCount || 0) * 2 }
function withinDays (t, n) { return t && (Date.now() - new Date(t).getTime()) < n * 86400000 }

async function renderCollection () {
  const box = $('#feedList'); if (!box) return
  const foot = $('#feedFoot'); if (foot) foot.innerHTML = ''
  box.innerHTML = '<div class="sk-line">聚合中…</div>'
  try {
    const [fd, qd] = await Promise.all([
      rpc('xq_moments_feed', { page: 0, pageSize: 50 }).catch(() => ({ list: [] })),
      rpc('xq_questions_list', { sort: 'bump', page: 0, pageSize: 50 }).catch(() => ({ list: [] })),
    ])
    const ms = (fd && fd.list) || []
    const qs = (qd && qd.list) || []
    const week = ms.filter((x) => withinDays(x.createTime, 7)).sort((a, b) => heat(b) - heat(a))
    const month = ms.filter((x) => withinDays(x.createTime, 30)).sort((a, b) => heat(b) - heat(a))
    const qTop = qs.slice().sort((a, b) => (b.answersCount || 0) * 2 + (b.views || 0) / 10 - ((a.answersCount || 0) * 2 + (a.views || 0) / 10))

    // 月刊归档：按 YYYY-MM 分组
    const groups = {}
    ms.forEach((x) => {
      const ym = String(x.createTime || '').slice(0, 7)
      if (!ym) return
      groups[ym] = groups[ym] || []
      groups[ym].push(x)
    })
    const months = Object.keys(groups).sort().reverse()

    const rowM = (x, i, type) => '<div class="mini-row click" ' + (type === 'q' ? 'data-openq="' + esc(x._id) + '"' : '') + '>' +
      '<span class="rank-no">' + (i + 1) + '</span>' +
      '<b>' + esc(type === 'q' ? x.title : (x.content || '（图片动态）').slice(0, 34)) + '</b>' +
      '<span>' + (type === 'q' ? (x.answersCount || 0) + ' 答' : heat(x) + ' 热度') + '</span></div>'

    box.innerHTML =
      '<div class="card"><div class="sec-title">本周热门<span class="sec-sub">近 7 天</span></div>' +
        (week.length ? week.slice(0, 6).map((x, i) => rowM(x, i, 'm')).join('') : '<div class="muted">本周还没有动态</div>') +
      '</div>' +
      '<div class="card"><div class="sec-title">本月精选<span class="sec-sub">近 30 天</span></div>' +
        (month.length ? month.slice(0, 6).map((x, i) => rowM(x, i, 'm')).join('') : '<div class="muted">本月还没有动态</div>') +
      '</div>' +
      '<div class="card"><div class="sec-title">热门提问<span class="sec-sub">按回答数</span></div>' +
        (qTop.length ? qTop.slice(0, 5).map((x, i) => rowM(x, i, 'q')).join('') : '<div class="muted">暂无提问</div>') +
      '</div>' +
      '<div class="card"><div class="sec-title">月刊归档<span class="sec-sub">共 ' + months.length + ' 期</span></div>' +
        (months.length ? months.map((ym) => {
          const g = groups[ym]
          const top = g.slice().sort((a, b) => heat(b) - heat(a))[0]
          const [y, m] = ym.split('-')
          return '<div class="month-row">' +
            '<div class="month-tag">' + esc(y) + '年' + esc(Number(m)) + '月</div>' +
            '<div class="month-body"><b>' + g.length + ' 条动态</b>' +
              '<span>' + esc((top.content || '（图片动态）').slice(0, 40)) + '</span></div>' +
          '</div>'
        }).join('') : '<div class="muted">还没有可归档的内容</div>') +
      '</div>'

    $$('#feedList [data-openq]').forEach((el) => { el.onclick = () => openQuestion(el.dataset.openq) })
  } catch (e) {
    box.innerHTML = '<div class="card"><div class="empty">合集加载失败：' + esc(e.message) + '</div></div>'
  }
}

async function fill_weather () {
  const wx = await getWeather()
  const el = $('#wxCard'); if (!el) return
  el.className = 'wx-card wx-' + wx.band + ' wx-clickable'
  el.setAttribute('role', 'button')
  el.setAttribute('tabindex', '0')
  el.innerHTML =
    '<div class="wx-l"><span class="wx-temp">' + esc(wx.temp) + '<i>°</i></span>' +
      '<div class="wx-meta"><b>' + esc(wx.desc) + '</b>' +
        '<span>体感 ' + esc(wx.feels) + '°' + (wx.today ? ' · ' + esc(wx.today.min) + '~' + esc(wx.today.max) + '°' : '') + '</span>' +
        '<span>桂林 · 尚贤</span></div></div>' +
    '<div class="wx-tip">' + esc(wx.tip) + '</div>' +
    '<div class="wx-more">查看详情</div>'
  el.onclick = openWeather
  el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openWeather() } }
}

async function fill_notice () {
  const el = $('#noticeCard'); if (!el) return
  try {
    const d = await rpc('xq_notice_active')
    const n = d && d.notice
    el.innerHTML = n
      ? '<div class="notice notice-' + esc(n.level || 'info') + '"><b>' + esc(n.title || '公告') + '</b><span>' + esc(n.content || '') + '</span></div>'
      : ''
  } catch (e) { el.innerHTML = '' }
}

function skeletonAside () {
  return '<div class="wx-card" id="wxCard"><div class="sk"></div></div>' +
    '<div id="noticeCard" class="notice-slot"></div>' +
    '<div class="card"><div class="sec-title">怎么玩</div>' +
      '<ul class="tips"><li>广场发动态，全实名、友善交流</li><li>提问区可悬赏鸡腿，采纳后手动答谢</li>' +
      '<li>集市与失物仅提供信息，平台不介入交易</li><li>每周双榜周一零点重置，仅荣誉展示</li></ul></div>' +
    '<div id="musicCard" class="card music-card"></div>'
}

async function loadFeed (append) {
  if (S.busy) return
  S.busy = true
  const foot = $('#feedFoot')
  if (foot && !append) foot.innerHTML = ''
  try {
    const d = await rpc('xq_moments_feed', { page: S.feedPage, pageSize: 20 })
    let list = (d && d.list) || []
    if (S.feedSort === 'hot') {
      list = list.slice().sort((a, b) => (b.likes + b.commentsCount * 2) - (a.likes + a.commentsCount * 2))
    }
    if (!append) S.feedList = []
    S.feedList = S.feedList.concat(list)
    S.feedDone = list.length < 20
    await refreshFavIds('moment')
    paintFeed()
  } catch (e) {
    if (foot) foot.innerHTML = '<span class="empty">加载失败：' + esc(e.message) + '</span>'
  }
  S.busy = false
}

function paintFeed () {
  const el = $('#feedList'); if (!el) return
  if (!S.feedList.length) {
    el.innerHTML = '<div class="card"><div class="empty">还没有动态，来发第一条吧</div></div>'
  } else {
    el.innerHTML = S.feedList.map(momentCard).join('')
  }
  bindMomentCards()
  const foot = $('#feedFoot')
  if (foot) {
    foot.innerHTML = S.feedDone
      ? (S.feedList.length ? '<span class="muted">没有更多了</span>' : '')
      : '<button class="btn-mini" id="feedMore">加载更多</button>'
    const more = $('#feedMore')
    if (more) more.onclick = () => { S.feedPage++; loadFeed(true) }
  }
}

function momentCard (m) {
  const a = m.author || {}
  const own = S.me && a.userId === S.me.userId
  const fav = favOn('moment', m._id)
  const imgs = (m.images || []).map((u) => '<img src="' + esc(u) + '" loading="lazy" alt="" data-zoom="' + esc(u) + '">').join('')
  return '<article class="mcard" data-mid="' + esc(m._id) + '">' +
    '<header class="mc-h">' +
      '<img class="ava" src="' + esc(a.avatarUrl || AV) + '" alt="" data-user="' + esc(a.userId || '') + '">' +
      '<div class="mc-who" data-user="' + esc(a.userId || '') + '"><b>' + esc(a.nickname || '同学') + '</b><time>' + fmtTime(m.createTime) + '</time></div>' +
      (own ? '<button class="mc-more" data-del="' + esc(m._id) + '" title="删除">' + ICON.close + '</button>' : '') +
    '</header>' +
    (m.content ? '<div class="mc-txt">' + esc(m.content) + '</div>' : '') +
    (imgs ? '<div class="mc-imgs">' + imgs + '</div>' : '') +
    '<footer class="mc-f">' +
      '<button class="mc-act ' + (m.liked ? 'on' : '') + '" data-like="' + esc(m._id) + '">' + (m.liked ? ICON.heartF : ICON.heart) + '<span>' + (m.likes || 0) + '</span></button>' +
      '<button class="mc-act" data-cmt="' + esc(m._id) + '">' + ICON.chat + '<span>' + (m.commentsCount || 0) + '</span></button>' +
      '<button class="mc-act ' + (fav ? 'on' : '') + ' fav-btn" data-fav="' + esc(m._id) + '" title="收藏">' + (fav ? ICON.starF : ICON.star) + '</button>' +
      '<button class="mc-act" data-mopen="' + esc(m._id) + '" title="查看详情">详情</button>' +
    '</footer>' +
    '<div class="mc-cmts" id="cmts-' + esc(m._id) + '" hidden></div>' +
  '</article>'
}

function bindMomentCards () {
  $$('#feedList [data-like]').forEach((el) => {
    el.onclick = async () => {
      if (!S.me) return openAuth()
      const id = el.dataset.like
      try {
        const d = await rpc('xq_toggle_moment_like', { momentId: id })
        const m = S.feedList.find((x) => x._id === id)
        if (m) { m.liked = d.liked; m.likes = Math.max(0, (m.likes || 0) + (d.liked ? 1 : -1)) }
        paintFeed()
      } catch (e) { toast(e.message) }
    }
  })
  $$('#feedList [data-cmt]').forEach((el) => { el.onclick = () => toggleMomentComments(el.dataset.cmt) })
  $$('#feedList [data-fav]').forEach((el) => { el.onclick = () => toggleFav('moment', el.dataset.fav, () => paintFeed()) })
  $$('#feedList [data-mopen]').forEach((el) => { el.onclick = () => openMoment(el.dataset.mopen) })
  $$('#feedList [data-user]').forEach((el) => {
    el.onclick = (ev) => { ev.stopPropagation(); if (el.dataset.user) openUserSheet(el.dataset.user) }
  })
  $$('#feedList [data-del]').forEach((el) => {
    el.onclick = async () => {
      if (!confirm('确定删除这条动态？')) return
      try { await rpc('xq_delete_moment', { momentId: el.dataset.del }); toast('已删除'); S.feedPage = 0; S.feedList = []; loadFeed(false) }
      catch (e) { toast(e.message) }
    }
  })
  bindZoom()
}

async function toggleMomentComments (mid) {
  const box = $('#cmts-' + mid); if (!box) return
  if (!box.hidden) { box.hidden = true; return }
  box.hidden = false
  box.innerHTML = '<div class="sk-line">加载中…</div>'
  try {
    const d = await rpc('xq_moment_comments', { momentId: mid })
    box.innerHTML = cmtListHTML((d && d.list) || []) + cmtFormHTML(mid)
    bindCmtForm(box, mid, 'xq_comment_moment', 'momentId')
  } catch (e) { box.innerHTML = '<div class="empty">评论加载失败</div>' }
}

function cmtListHTML (list) {
  if (!list.length) return '<div class="cmt-none">还没有评论</div>'
  return list.map((c) => {
    const a = c.author || {}
    return '<div class="cmt' + (c.deleted ? ' del' : '') + '"><b>' + esc(a.nickname || '同学') + '</b><span>' + esc(c.content) + '</span></div>'
  }).join('')
}
function cmtFormHTML (id) {
  return '<div class="cmt-form"><input class="ipt" placeholder="写评论…" data-inp="' + esc(id) + '"><button class="btn-mini" data-send="' + esc(id) + '">发送</button></div>'
}
function bindCmtForm (box, id, fn, key, onDone) {
  const btn = box.querySelector('[data-send]'), inp = box.querySelector('[data-inp]')
  if (!btn || !inp) return
  const listFn = fn === 'xq_comment_moment' ? 'xq_moment_comments' : 'xq_market_comments'
  const send = async () => {
    if (!S.me) return openAuth()
    const v = inp.value.trim(); if (!v) return
    btn.disabled = true
    try {
      const p = {}; p[key] = id; p.content = v
      await rpc(fn, p)
      inp.value = ''
      if (onDone) { onDone(); return }
      const d = await rpc(listFn, fn === 'xq_comment_moment' ? { momentId: id } : { itemId: id })
      box.innerHTML = cmtListHTML((d && d.list) || []) + cmtFormHTML(id)
      bindCmtForm(box, id, fn, key)
    } catch (e) { toast(e.message) }
    btn.disabled = false
  }
  btn.onclick = send
  inp.onkeydown = (e) => { if (e.key === 'Enter') send() }
}

/* ── 动态详情（A5）：全屏内容 + 评论 ── */
async function openMoment (mid) {
  const layer = $('#layer')
  layer.hidden = false
  layer.innerHTML = '<div class="sheet" data-sheet><button class="sheet-x" data-close>' + ICON.close + '</button><div class="sk-line">加载中…</div></div>'
  bindSheet()
  try {
    let item = S.feedList.find((x) => x._id === mid)
    if (!item) {
      const d = await rpc('xq_moments_feed', { page: 0, pageSize: 50 })
      item = ((d && d.list) || []).find((x) => x._id === mid)
    }
    if (!item) throw new Error('动态不存在或已删除')
    const a = item.author || {}
    const c = await rpc('xq_moment_comments', { momentId: mid })
    const cl = (c && c.list) || []
    layer.innerHTML = '<div class="sheet" data-sheet>' +
      '<button class="sheet-x" data-close>' + ICON.close + '</button>' +
      '<header class="mc-h"><img class="ava" src="' + esc(a.avatarUrl || AV) + '" alt="" data-user="' + esc(a.userId || '') + '">' +
        '<div class="mc-who" data-user="' + esc(a.userId || '') + '"><b>' + esc(a.nickname || '同学') + '</b><time>' + fmtTime(item.createTime) + '</time></div></header>' +
      (item.content ? '<div class="mc-txt">' + esc(item.content) + '</div>' : '') +
      ((item.images || []).length ? '<div class="mc-imgs">' + item.images.map((u) => '<img src="' + esc(u) + '" alt="" data-zoom="' + esc(u) + '">').join('') + '</div>' : '') +
      '<footer class="mc-f">' +
        '<button class="mc-act ' + (item.liked ? 'on' : '') + '" id="mdLike">' + (item.liked ? ICON.heartF : ICON.heart) + '<span>' + (item.likes || 0) + '</span></button>' +
        '<button class="mc-act ' + (favOn('moment', item._id) ? 'on' : '') + ' fav-btn" id="mdFav">' + (favOn('moment', item._id) ? ICON.starF : ICON.star) + '</button>' +
      '</footer>' +
      '<div class="ans-head">' + cl.length + ' 条评论</div>' +
      (cl.length ? '<div class="cmt-list">' + cmtListHTML(cl) + '</div>' : '<div class="empty">还没有评论</div>') +
      '<div class="ans-form">' + cmtFormHTML(item._id) + '</div>' +
    '</div>'
    bindSheet()
    bindZoom()
    $$('#layer [data-user]').forEach((el) => { el.onclick = () => { if (el.dataset.user) openUserSheet(el.dataset.user) } })
    $('#mdLike').onclick = async () => {
      if (!S.me) return openAuth()
      try {
        const d = await rpc('xq_toggle_moment_like', { momentId: item._id })
        item.liked = d.liked; item.likes = Math.max(0, (item.likes || 0) + (d.liked ? 1 : -1))
        const src = S.feedList.find((x) => x._id === item._id)
        if (src) { src.liked = item.liked; src.likes = item.likes }
        paintFeed(); openMoment(item._id)
      } catch (e) { toast(e.message) }
    }
    $('#mdFav').onclick = () => toggleFav('moment', item._id, () => { paintFeed(); openMoment(item._id) })
    bindCmtForm(layer.querySelector('.ans-form'), item._id, 'xq_comment_moment', 'momentId', () => {
      const src = S.feedList.find((x) => x._id === item._id)
      if (src) src.commentsCount = (src.commentsCount || 0) + 1
      paintFeed(); openMoment(item._id)
    })
  } catch (e) {
    layer.innerHTML = '<div class="sheet"><button class="sheet-x" data-close>' + ICON.close + '</button><div class="empty">加载失败：' + esc(e.message) + '</div></div>'
    bindSheet()
  }
}

/* ═══════════════════ 集市 ═══════════════════ */
async function renderMarket () {
  $('#main').innerHTML =
    '<div class="bento">' +
      '<div class="cell c-left">' +
        '<div class="card"><div class="sec-title">二手集市</div>' +
          '<p class="muted">校园二手 · 信息发布 · 平台不介入交易，买卖双方自行沟通</p>' +
          '<button class="btn-primary w100" id="mkAdd">发布闲置</button>' +
          '<div class="notice notice-warn small">未成年人交易须经监护人同意；平台不担保、不代收款项。</div>' +
        '</div>' +
      '</div>' +
      '<div class="cell c-main">' +
        pageHead('MARKET', '二手集市', '校园闲置信息发布 · 平台不介入交易') +
        '<div class="seg">' +
          '<button data-mktab="selling" class="' + (S.mkTab === 'selling' ? 'on' : '') + '">在售</button>' +
          '<button data-mktab="sold" class="' + (S.mkTab === 'sold' ? 'on' : '') + '">已售出</button>' +
        '</div>' +
        '<div id="mkList"></div>' +
      '</div>' +
    '</div>'
  $$('[data-mktab]').forEach((b) => { b.onclick = () => { S.mkTab = b.dataset.mktab; render() } })
  $('#mkAdd').onclick = () => openCompose('market')
  loadMarket()
}

async function loadMarket () {
  const box = $('#mkList'); if (!box) return
  box.innerHTML = '<div class="sk-line">加载中…</div>'
  try {
    const d = await rpc('xq_market_list', { page: 0, pageSize: 40 })
    const all = (d && d.list) || []
    await refreshFavIds('market')
    const list = all.filter((x) => (S.mkTab === 'sold' ? x.status === 'sold' : x.status !== 'sold'))
    if (!list.length) { box.innerHTML = '<div class="card"><div class="empty">' + (S.mkTab === 'sold' ? '暂无已售出物品' : '暂无在售闲置，来发布第一件吧') + '</div></div>'; return }
    box.innerHTML = '<div class="mk-grid">' + list.map(marketCard).join('') + '</div>'
    bindMarketCards()
  } catch (e) { box.innerHTML = '<div class="card"><div class="empty">加载失败：' + esc(e.message) + '</div></div>' }
}

function marketCard (x) {
  const sold = x.status === 'sold'
  const imgs = (x.images || []).map((u) => '<img src="' + esc(u) + '" loading="lazy" alt="" data-zoom="' + esc(u) + '">').join('')
  return '<article class="mk-card' + (sold ? ' sold' : '') + '" data-item="' + esc(x._id) + '">' +
    (imgs ? '<div class="mk-imgs">' + imgs + '</div>' : '<div class="mk-noimg">无图</div>') +
    '<div class="mk-body">' +
      '<div class="mk-top"><h4>' + esc(x.title) + '</h4>' + (sold ? '<span class="mk-sold">已售出</span>' : '') + '</div>' +
      '<div class="mk-price">¥' + esc(x.price) + (x.negotiable ? '<i>可议</i>' : '') + '</div>' +
      (x.detail ? '<p class="mk-desc">' + esc(x.detail.length > 70 ? x.detail.slice(0, 70) + '…' : x.detail) + '</p>' : '') +
      '<div class="mk-meta"><span class="u-link" data-user="' + esc((x.author || {}).userId || '') + '">' + esc((x.author || {}).nickname || '同学') + '</span><span>' + fmtTime(x.createTime) + '</span>' +
        (x.expired ? '<span class="mk-exp">待刷新</span>' : '') + '</div>' +
      '<div class="mk-acts">' +
        '<button class="mc-act ' + (x.wanted ? 'on' : '') + '" data-want="' + esc(x._id) + '">' + (x.wanted ? ICON.heartF : ICON.heart) + '<span>' + (x.wants || 0) + '</span></button>' +
        '<button class="mc-act" data-mkcmt="' + esc(x._id) + '">' + ICON.chat + ' 询价</button>' +
        '<button class="mc-act ' + (favOn('market', x._id) ? 'on' : '') + ' fav-btn" data-mkfav="' + esc(x._id) + '" title="收藏">' + (favOn('market', x._id) ? ICON.starF : ICON.star) + '</button>' +
        (x.isOwn && !sold ? '<button class="mc-act" data-mksell="' + esc(x._id) + '">标记已售</button>' : '') +
      '</div>' +
      '<div class="mc-cmts" id="mkcmts-' + esc(x._id) + '" hidden></div>' +
    '</div>' +
  '</article>'
}

function bindMarketCards () {
  $$('#mkList [data-want]').forEach((el) => {
    el.onclick = async () => {
      if (!S.me) return openAuth()
      try { const d = await rpc('xq_market_toggle_want', { itemId: el.dataset.want }); toast(d.wanted ? '已想要' : '已取消'); loadMarket() }
      catch (e) { toast(e.message) }
    }
  })
  $$('#mkList [data-mksell]').forEach((el) => {
    el.onclick = async () => {
      if (!confirm('标记为已售出？之后将不再接受询价。')) return
      try { await rpc('xq_market_set_status', { itemId: el.dataset.mksell, status: 'sold' }); toast('已标记售出'); loadMarket() }
      catch (e) { toast(e.message) }
    }
  })
  $$('#mkList [data-mkcmt]').forEach((el) => {
    el.onclick = async () => {
      const id = el.dataset.mkcmt, box = $('#mkcmts-' + id)
      if (!box) return
      if (!box.hidden) { box.hidden = true; return }
      box.hidden = false
      box.innerHTML = '<div class="sk-line">加载中…</div>'
      try {
        const d = await rpc('xq_market_comments', { itemId: id })
        box.innerHTML = cmtListHTML((d && d.list) || []) + cmtFormHTML(id)
        bindCmtForm(box, id, 'xq_market_comment', 'itemId')
      } catch (e) { box.innerHTML = '<div class="empty">加载失败</div>' }
    }
  })
  $$('#mkList [data-mkfav]').forEach((el) => { el.onclick = () => toggleFav('market', el.dataset.mkfav, () => loadMarket()) })
  $$('#mkList [data-user]').forEach((el) => { el.onclick = () => { if (el.dataset.user) openUserSheet(el.dataset.user) } })
  bindZoom()
}

/* ═══════════════════ 失物招领 ═══════════════════ */
async function renderLost () {
  $('#main').innerHTML =
    '<div class="bento">' +
      '<div class="cell c-left">' +
        '<div class="card"><div class="sec-title">失物招领</div>' +
          '<p class="muted">联系方式必填，方便同学一键联系。信息仅作展示，平台不介入。</p>' +
          '<button class="btn-primary w100" id="lostAdd">发布信息</button>' +
        '</div>' +
      '</div>' +
      '<div class="cell c-main">' +
        pageHead('LOST & FOUND', '失物招领', '联系方式必填 · 信息仅作展示') +
        '<div class="seg">' +
          '<button data-lost="lost" class="' + (S.lostTab === 'lost' ? 'on' : '') + '">我丢了东西</button>' +
          '<button data-lost="found" class="' + (S.lostTab === 'found' ? 'on' : '') + '">我捡到东西</button>' +
        '</div>' +
        '<div id="lostList"></div>' +
      '</div>' +
    '</div>'
  $$('[data-lost]').forEach((b) => { b.onclick = () => { S.lostTab = b.dataset.lost; render() } })
  $('#lostAdd').onclick = () => openCompose('lost')
  loadLost()
}

async function loadLost () {
  const box = $('#lostList'); if (!box) return
  box.innerHTML = '<div class="sk-line">加载中…</div>'
  try {
    const d = await rpc('xq_lost_list', { kind: S.lostTab, page: 0, pageSize: 40 })
    const list = (d && d.list) || []
    if (!list.length) { box.innerHTML = '<div class="card"><div class="empty">' + (S.lostTab === 'lost' ? '暂无寻物信息' : '暂无招领信息') + '</div></div>'; return }
    box.innerHTML = list.map(lostCard).join('')
    bindLostCards()
  } catch (e) { box.innerHTML = '<div class="card"><div class="empty">加载失败：' + esc(e.message) + '</div></div>' }
}

function lostCard (l) {
  const a = l.author || {}
  const done = l.status === 'resolved'
  return '<article class="lost-card' + (done ? ' done' : '') + '">' +
    '<div class="lost-kind ' + (l.kind === 'found' ? 'found' : 'lost') + '">' + (l.kind === 'found' ? '捡到' : '丢失') + '</div>' +
    '<div class="lost-body">' +
      '<h4>' + esc(l.title) + (done ? '<span class="lost-done">已解决</span>' : '') + '</h4>' +
      (l.detail ? '<p>' + esc(l.detail) + '</p>' : '') +
      '<div class="lost-meta">' +
        (l.place ? '<span>地点：' + esc(l.place) + '</span>' : '') +
        '<span>' + esc(a.nickname || '同学') + '</span><span>' + fmtTime(l.createTime) + '</span>' +
      '</div>' +
      '<div class="lost-acts">' +
        '<button class="btn-mini" data-copy="' + esc(l.contact || '') + '">复制联系方式</button>' +
        (l.isOwn && !done ? '<button class="btn-mini ghost" data-lostdone="' + esc(l._id) + '">标记已解决</button>' : '') +
      '</div>' +
    '</div>' +
  '</article>'
}

function bindLostCards () {
  $$('#lostList [data-copy]').forEach((el) => {
    el.onclick = () => {
      const v = el.dataset.copy
      if (!v) return toast('对方未填写联系方式')
      copyText(v, el, '复制联系方式')
    }
  })
  $$('#lostList [data-lostdone]').forEach((el) => {
    el.onclick = async () => {
      try { await rpc('xq_lost_update', { lostId: el.dataset.lostdone, status: 'resolved' }); toast('已标记解决'); loadLost() }
      catch (e) { toast(e.message) }
    }
  })
}

function copyText (v, btn, label) {
  const done = () => { const old = btn.textContent; btn.textContent = '已复制'; setTimeout(() => { btn.textContent = old || label }, 1500) }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(v).then(done).catch(() => alert('请手动复制：' + v))
  } else alert('请手动复制：' + v)
}

/* ═══════════════════ 提问 + 知识库 ═══════════════════ */
async function renderAsk () {
  $('#main').innerHTML =
    '<div class="bento">' +
      '<div class="cell c-left">' +
        '<div class="card"><div class="sec-title">提问社区</div>' +
          '<p class="muted">纯文字提问 · 评论式回答 · 有用投票 · 可悬赏鸡腿</p>' +
          '<button class="btn-primary w100" id="askAdd">我要提问</button>' +
          '<div class="notice notice-info small">悬赏仅作标记，采纳后由提问者手动答谢，平台不碰钱、不担保。</div>' +
        '</div>' +
        '<div class="card" id="rankBox"><div class="sec-title">每周双榜</div><div class="sk-line">读取中…</div></div>' +
      '</div>' +
      '<div class="cell c-main">' +
        pageHead('Q & A', '提问社区', '纯文字提问 · 评论式回答 · 可悬赏鸡腿') +
        '<div class="seg">' +
          '<button data-asktab="q" class="' + (S.askTab === 'q' ? 'on' : '') + '">问答</button>' +
          '<button data-asktab="kb" class="' + (S.askTab === 'kb' ? 'on' : '') + '">知识库</button>' +
        '</div>' +
        '<div class="ask-bar">' +
          '<input class="ipt" id="askTagIpt" placeholder="按标签筛选，如：数学" value="' + esc(S.askTag) + '">' +
          '<button class="chip ' + (S.askSort === 'bump' ? 'on' : '') + '" data-asksort="bump">悬赏优先</button>' +
          '<button class="chip ' + (S.askSort === 'new' ? 'on' : '') + '" data-asksort="new">最新</button>' +
        '</div>' +
        '<div id="askList"></div>' +
      '</div>' +
    '</div>'

  $$('[data-asktab]').forEach((b) => { b.onclick = () => { S.askTab = b.dataset.asktab; render() } })
  $$('[data-asksort]').forEach((b) => { b.onclick = () => { S.askSort = b.dataset.asksort; render() } })
  const ti = $('#askTagIpt')
  ti.onkeydown = (e) => { if (e.key === 'Enter') { S.askTag = ti.value.trim(); render() } }
  $('#askAdd').onclick = () => openCompose('question')

  loadRank()
  if (S.askTab === 'kb') loadKb(); else loadQuestions()
}

async function loadRank () {
  const box = $('#rankBox'); if (!box) return
  try {
    const d = await rpc('xq_weekly_rank')
    const col = (arr, title) => '<div class="rank-col"><div class="rank-t">' + title + '</div>' +
      (arr && arr.length
        ? arr.map((x, i) => '<div class="rank-row"><b>' + (i+1) + '</b><span>' + esc(x.name || '同学') + '</span><i>' + esc(x.score || 0) + '</i></div>').join('')
        : '<div class="muted">虚位以待</div>') + '</div>'
    box.innerHTML = '<div class="sec-title">每周双榜 <span class="sec-sub">' + esc(d.weekStart || '') + ' 起</span></div>' +
      col(d.answer, '热心回答') + col(d.question, '优质提问')
  } catch (e) { box.innerHTML = '<div class="sec-title">每周双榜</div><div class="muted">加载失败</div>' }
}

async function loadQuestions () {
  const box = $('#askList'); if (!box) return
  box.innerHTML = '<div class="sk-line">加载中…</div>'
  try {
    const d = await rpc('xq_questions_list', { tag: S.askTag, sort: S.askSort, page: 0, pageSize: 30 })
    const list = (d && d.list) || []
    if (!list.length) { box.innerHTML = '<div class="card"><div class="empty">暂无问题，来提第一个吧</div></div>'; return }
    box.innerHTML = list.map(qCard).join('')
    bindQCards()
  } catch (e) { box.innerHTML = '<div class="card"><div class="empty">加载失败：' + esc(e.message) + '</div></div>' }
}

function qCard (q) {
  return '<article class="qcard" data-qid="' + esc(q._id) + '">' +
    '<div class="q-top"><h4>' + esc(q.title) + '</h4>' +
      (q.status === 'resolved' ? '<span class="q-badge ok">已解决</span>' : '') +
      (q.bountyAmount ? '<span class="q-badge bounty">悬赏 ¥' + esc(q.bountyAmount) + '</span>' : '') +
    '</div>' +
    '<div class="q-meta">' +
      '<span>' + ICON.chat + ' ' + (q.answersCount || 0) + '</span>' +
      '<span>' + ICON.eye + ' ' + (q.views || 0) + '</span>' +
      '<span>' + esc((q.author || {}).nickname || '同学') + '</span>' +
      '<span>' + fmtTime(q.bumpedAt || q.createTime) + '</span>' +
      tagsOf(q.tags).map((t) => '<span class="q-tag clickable" data-tag="' + esc(t) + '" title="查看该标签">' + esc(t) + '</span>').join('') +
    '</div>' +
  '</article>'
}

function bindQCards () {
  $$('#askList [data-qid]').forEach((el) => { el.onclick = () => openQuestion(el.dataset.qid) })
  $$('#askList [data-tag]').forEach((el) => {
    el.onclick = (ev) => { ev.stopPropagation(); S.askTag = el.dataset.tag; S.askTab = 'q'; render() }
  })
}

async function openQuestion (qid) {
  const layer = $('#layer')
  layer.hidden = false
  layer.innerHTML = '<div class="sheet"><div class="sk-line">加载中…</div></div>'
  try {
    const d = await rpc('xq_question_detail', { questionId: qid })
    const q = d.question, answers = d.answers || []
    await Promise.all([refreshFavIds('question'), refreshQFollowIds()])
    layer.innerHTML = '<div class="sheet" data-sheet>' +
      '<button class="sheet-x" data-close>' + ICON.close + '</button>' +
      '<div class="q-detail">' +
        '<div class="q-top"><h3>' + esc(q.title) + '</h3>' +
          (q.status === 'resolved' ? '<span class="q-badge ok">已解决</span>' : '') +
          (q.bountyAmount ? '<span class="q-badge bounty">悬赏 ¥' + esc(q.bountyAmount) + '</span>' : '') +
        '</div>' +
        (q.detail ? '<p class="q-dtxt">' + esc(q.detail) + '</p>' : '') +
        '<div class="q-meta">' +
          '<span>' + esc((q.author || {}).nickname || '同学') + '</span>' +
          '<span>' + ICON.eye + ' ' + (q.views || 0) + '</span>' +
          '<span>' + fmtTime(q.createTime) + '</span>' +
          tagsOf(q.tags).map((t) => '<span class="q-tag">' + esc(t) + '</span>').join('') +
        '</div>' +
        '<div class="q-ops">' +
          '<button class="btn-mini' + (favOn('question', q._id) ? ' on' : '') + '" id="qFav">' + (favOn('question', q._id) ? '已收藏' : '收藏') + '</button>' +
          '<button class="btn-mini' + (QFOLLOW.has(q._id) ? ' on' : '') + '" id="qFollow">' + (QFOLLOW.has(q._id) ? '已关注' : '关注问题') + '</button>' +
          (q.isOwn && q.status !== 'resolved' ? '<button class="btn-mini" data-bump="' + esc(q._id) + '">催一下</button>' : '') +
          (q.isOwn ? '<button class="btn-mini ghost" data-qdel="' + esc(q._id) + '">删除问题</button>' : '') +
        '</div>' +
      '</div>' +
      '<div class="ans-head">' + answers.length + ' 个回答</div>' +
      '<div class="ans-list">' + (answers.length ? answers.map((a) => ansHTML(a, q)).join('') : '<div class="empty">还没有回答，来帮帮这位同学</div>') + '</div>' +
      '<div class="ans-form">' +
        '<textarea class="ta" id="ansInput" placeholder="写下你的回答…（最多 2000 字）"></textarea>' +
        '<button class="btn-primary" id="ansSend">发布回答</button>' +
      '</div>' +
    '</div>'
    bindSheet()
    bindQuestionOps(q, answers)
  } catch (e) {
    layer.innerHTML = '<div class="sheet"><button class="sheet-x" data-close>' + ICON.close + '</button><div class="empty">加载失败：' + esc(e.message) + '</div></div>'
    bindSheet()
  }
}

function ansHTML (a, q) {
  const au = a.author || {}
  return '<div class="ans' + (a.isAccepted ? ' accepted' : '') + '">' +
    '<header><img class="ava sm" src="' + esc(au.avatarUrl || AV) + '" alt=""><b>' + esc(au.nickname || '同学') + '</b>' +
      (a.isAccepted ? '<span class="q-badge ok">已采纳</span>' : '') +
      '<time>' + fmtTime(a.createTime) + '</time></header>' +
    '<p>' + esc(a.content) + '</p>' +
    '<footer>' +
      '<button class="mc-act" data-useful="' + esc(a._id) + '">有用 ' + (a.useful || 0) + '</button>' +
      (q.isOwn && !a.isAccepted ? '<button class="mc-act" data-accept="' + esc(a._id) + '">采纳</button>' : '') +
    '</footer>' +
  '</div>'
}

function bindQuestionOps (q, answers) {
  const qf = $('#layer #qFav')
  if (qf) qf.onclick = () => toggleFav('question', q._id, () => openQuestion(q._id))
  const qfl = $('#layer #qFollow')
  if (qfl) qfl.onclick = async () => {
    if (!S.me) return openAuth()
    try {
      const d = await rpc('xq_toggle_question_follow', { questionId: q._id })
      toast(d.following ? '已关注，有新回答会通知你' : '已取消关注')
      openQuestion(q._id)
    } catch (e) {
      toast(String(e.message || '').includes('Could not find') ? '关注功能待数据库补丁 026 执行后可用' : e.message)
    }
  }
  $$('#layer [data-useful]').forEach((el) => {
    el.onclick = async () => {
      if (!S.me) return openAuth()
      try { const d = await rpc('xq_toggle_useful', { answerId: el.dataset.useful }); toast(d.useful ? '已标记有用' : '已取消'); openQuestion(q._id) }
      catch (e) { toast(e.message) }
    }
  })
  $$('#layer [data-accept]').forEach((el) => {
    el.onclick = async () => {
      if (!confirm('确认采纳这个回答？采纳后不可撤销。')) return
      try { await rpc('xq_accept_answer', { answerId: el.dataset.accept }); toast('已采纳'); openQuestion(q._id) }
      catch (e) { toast(e.message) }
    }
  })
  const bump = $('#layer [data-bump]')
  if (bump) bump.onclick = async () => { try { await rpc('xq_bump_question', { questionId: q._id }); toast('已催办，问题将置顶 24 小时') } catch (e) { toast(e.message) } }
  const qdel = $('#layer [data-qdel]')
  if (qdel) qdel.onclick = async () => {
    if (!confirm('确定删除这个问题？')) return
    try { await rpc('xq_delete_question', { questionId: q._id }); toast('已删除'); closeLayer(); loadQuestions() } catch (e) { toast(e.message) }
  }
  const send = $('#ansSend')
  if (send) send.onclick = async () => {
    if (!S.me) return openAuth()
    const v = $('#ansInput').value.trim(); if (!v) return toast('请输入回答内容')
    send.disabled = true
    try { await rpc('xq_create_answer', { questionId: q._id, content: v }); toast('回答已发布'); openQuestion(q._id) }
    catch (e) { toast(e.message) }
    send.disabled = false
  }
}

async function loadKb () {
  const box = $('#askList'); if (!box) return
  box.innerHTML = '<div class="sk-line">加载中…</div>'
  try {
    const d = await rpc('xq_kb_list', { tag: S.askTag, page: 0, pageSize: 30 })
    const list = (d && d.list) || []
    if (!list.length) { box.innerHTML = '<div class="card"><div class="empty">知识库暂无条目（回答被采纳或「有用」≥5 会自动收录）</div></div>'; return }
    box.innerHTML = list.map((e) =>
      '<article class="kb-card' + (e.featured ? ' feat' : '') + '">' +
        '<h4>' + (e.featured ? '<span class="kb-star">精</span>' : '') + esc(e.title) + '</h4>' +
        '<p>' + esc((e.content || '').slice(0, 160)) + ((e.content || '').length > 160 ? '…' : '') + '</p>' +
        '<div class="kb-meta"><span>' + esc(e.author || '同学') + '</span>' +
          tagsOf(e.tags).map((t) => '<span class="q-tag">' + esc(t) + '</span>').join('') + '</div>' +
      '</article>').join('')
  } catch (e) { box.innerHTML = '<div class="card"><div class="empty">加载失败：' + esc(e.message) + '</div></div>' }
}

/* ═══════════════════ 鸣谢 ═══════════════════ */
const OPEN_SOURCE = [
  ['Supabase', '数据库 / 认证 / 存储'],
  ['uni-app', '跨端应用框架'],
  ['Capacitor', '原生容器'],
  ['Vue 3', '前端框架'],
  ['Vite', '构建工具'],
  ['Lottie', '动画运行时'],
]
const VERSION_LOG = [
  ['v1.0.21', '评论体系修复 · 管理面板分页签 · 诊断上报', '当前'],
  ['v1.0.19', '轻量化 13MB · 开屏书法重做'],
  ['v1.0.18', '删除内置字体包 · 官网改版'],
]
const CONTRIBUTORS = [
  ['开发与运营', 'KernthalStudio', 'App / 官网 / 贤圈中心的开发与日常维护'],
  ['社区管理', '恸', '社区秩序与内容管理'],
  ['内容贡献', '所有发帖的同学', '动态、提问、回答、集市与失物信息'],
  ['开源社区', '见「开源依赖」', '没有这些开源项目就没有尚贤圈'],
]

async function renderThanks () {
  $('#main').innerHTML =
    '<div class="bento">' +
      '<div class="cell c-main">' +
        pageHead('THANKS', '鸣谢墙', '基础功能永久免费、无广告 · 感谢每一份支持') +
        '<div id="thanksTiers"></div>' +
      '</div>' +
      '<div class="cell c-side">' +
        '<div class="card"><div class="sec-title">开源依赖</div><div class="os-list">' +
          OPEN_SOURCE.map((x) => '<div class="os-row"><b>' + esc(x[0]) + '</b><span>' + esc(x[1]) + '</span></div>').join('') +
        '</div></div>' +
        '<div class="card"><div class="sec-title">版本日志</div><div class="ver-list">' +
          VERSION_LOG.map((x) => '<div class="ver-row"><b>' + esc(x[0]) + '</b><span>' + esc(x[1]) + '</span>' + (x[2] ? '<i>' + esc(x[2]) + '</i>' : '') + '</div>').join('') +
        '</div></div>' +
        '<div class="card"><div class="sec-title">贡献者名单</div><div class="os-list">' +
          CONTRIBUTORS.map((x) => '<div class="os-row"><b>' + esc(x[0]) + '</b><span>' + esc(x[1]) + ' · ' + esc(x[2]) + '</span></div>').join('') +
        '</div></div>' +
        '<div class="card"><div class="muted">鸡腿与赞助金额三成以上（普遍五到八成）直接投入平台开发与维护，用途在此公示。</div>' +
          '<a class="btn-primary w100 mt12" href="https://ifdian.net/a/kernthal-sxquan" target="_blank" rel="noopener">前往支持</a></div>' +
      '</div>' +
    '</div>'
  const box = $('#thanksTiers')
  box.innerHTML = '<div class="sk-line">读取中…</div>'
  try {
    const d = await rpc('xq_thanks_wall')
    box.innerHTML = tierCard(d.diamond, '钻级 · ¥200', '永久名单 + 专属铭牌', 'diamond') +
      tierCard(d.star, '星级 · ¥100', '永久名单', 'star') +
      tierCard(d.royal, '皇级 · ¥50', '当月陈列', 'royal')
  } catch (e) { box.innerHTML = '<div class="card"><div class="empty">鸣谢墙加载失败</div></div>' }
}

function tierCard (arr, label, sub, cls) {
  const names = (arr || []).filter(Boolean)
  const body = names.length
    ? '<div class="tier-names">' + names.map((n) => '<span class="tname">' + esc(n) + '</span>').join('') + '</div>'
    : '<div class="tier-empty">虚位以待</div>'
  return '<div class="tier-card ' + cls + '">' +
    '<div class="tier-head"><div><b>' + esc(label) + '</b><span>' + esc(sub) + '</span></div>' +
      '<i>' + names.length + ' 位</i></div>' + body + '</div>'
}

/* ═══════════════════ 我的 ═══════════════════ */
const BADGE_ICON = {
  first_question: '问', first_answer: '答', accepted5: '采', question_master: '达',
  answer_master: '热', streak7: '七', kb_contributor: '库', losthero: '拾',
  active15: '勤', fullweek: '周', veteran: '元',
}

async function renderMe () {
  if (!S.me) {
    $('#main').innerHTML = '<div class="bento"><div class="cell c-main"><div class="card"><div class="empty">登录后查看我的贤圈</div>' +
      '<button class="btn-primary w100" id="meLogin">登录 / 注册</button></div></div></div>'
    $('#meLogin').onclick = openAuth
    return
  }
  const m = S.me
  const TABS = [
    ['mine', '我的内容'], ['fav', '收藏'], ['follow', '关注'],
    ['wallet', '钱包'], ['badges', '徽章'], ['set', '设置'],
  ]
  $('#main').innerHTML =
    '<div class="bento bento-single">' +
      '<div class="cell c-full">' +
        '<div class="me-hero">' +
          '<div class="me-hero-bg"></div>' +
          '<img class="me-ava-lg" src="' + esc(m.avatarUrl || AV) + '" alt="">' +
          '<div class="me-hero-main">' +
            '<div class="me-name">' + esc(m.nickname || '同学') +
              (m.isVip ? '<span class="vip-tag">' + esc(m.vipTitle || '贤士') + '</span>' : '') + '</div>' +
            '<div class="me-sig">' + esc(m.signature || '这个人很懒，什么都没写') + '</div>' +
            '<div class="me-chips">' +
              (m.xqId ? '<span>贤圈ID ' + esc(m.xqId) + '</span>' : (m.linked ? '<span>已关联主 App 账号</span>' : '<span>未关联贤圈ID</span>')) +
              (m.isVip ? '<span class="gold">会员剩余 ' + esc(m.vipDaysLeft) + ' 天</span>' : '') +
            '</div>' +
          '</div>' +
          '<button class="btn-mini me-edit" id="meEdit">编辑资料</button>' +
        '</div>' +
        '<div class="me-stats" id="meStats"></div>' +
      '</div>' +
      '<div class="cell c-full">' +
        '<div class="me-tabs" id="meTabs">' +
          TABS.map((t) => '<button data-metab="' + t[0] + '" class="' + (S.meTab === t[0] ? 'on' : '') + '">' + t[1] + '</button>').join('') +
        '</div>' +
        '<div id="meBody"></div>' +
      '</div>' +
    '</div>'

  $$('[data-metab]').forEach((b) => { b.onclick = () => { S.meTab = b.dataset.metab; render() } })
  $('#meEdit').onclick = openEditProfile
  loadMeStats()

  if (S.meTab === 'badges') loadBadges()
  else if (S.meTab === 'set') paintSettings()
  else if (S.meTab === 'fav') loadFav()
  else if (S.meTab === 'follow') loadFollow()
  else if (S.meTab === 'wallet') loadWallet()
  else loadMine()
}

/* 头部四格统计：动态 / 提问 / 收藏 / 关注 */
async function loadMeStats () {
  const box = $('#meStats'); if (!box) return
  box.innerHTML = '<div class="stat"><b>—</b><span>动态</span></div><div class="stat"><b>—</b><span>提问</span></div>' +
    '<div class="stat"><b>—</b><span>收藏</span></div><div class="stat"><b>—</b><span>关注</span></div>'
  const mCount = '<div class="stat"><b>%1</b><span>动态</span></div><div class="stat"><b>%2</b><span>提问</span></div>' +
    '<div class="stat"><b>%3</b><span>收藏</span></div><div class="stat"><b>%4</b><span>关注</span></div>'
  try {
    const uid = S.me.userId
    const [fd, qd, sc] = await Promise.all([
      rpc('xq_moments_feed', { page: 0, pageSize: 50 }).catch(() => ({ list: [] })),
      rpc('xq_questions_list', { page: 0, pageSize: 50 }).catch(() => ({ list: [] })),
      rpc('xq_social_counts').catch(() => null),
    ])
    const nM = ((fd && fd.list) || []).filter((x) => (x.author || {}).userId === uid).length
    const nQ = ((qd && qd.list) || []).filter((x) => (x.author || {}).userId === uid).length
    box.innerHTML = mCount.replace('%1', nM).replace('%2', nQ)
      .replace('%3', sc ? (sc.favorites || 0) : '—')
      .replace('%4', sc ? (sc.following || 0) : '—')
  } catch (e) { /* 保持占位 */ }
}

/* ── 我的收藏 ── */
const FAV_LABEL = { moment: '动态', question: '提问', market: '闲置' }
async function loadFav () {
  const box = $('#meBody'); if (!box) return
  box.innerHTML = '<div class="sk-line">加载中…</div>'
  try {
    const d = await rpc('xq_favorites_list', { page: 0, pageSize: 40 })
    const list = (d && d.list) || []
    if (!list.length) {
      box.innerHTML = '<div class="card"><div class="empty">还没有收藏。在动态、提问、闲置上点星标即可收藏。</div></div>'
      return
    }
    box.innerHTML = '<div class="card"><div class="sec-title">我的收藏<span class="sec-sub">' + list.length + ' 条</span></div>' +
      list.map((f) => '<div class="mini-row' + (f.targetType === 'question' && f.alive ? ' click' : '') + '"' +
        (f.targetType === 'question' && f.alive ? ' data-openq="' + esc(f.targetId) + '"' : '') + '>' +
        '<span class="fav-type">' + esc(FAV_LABEL[f.targetType] || '内容') + '</span>' +
        '<b>' + esc(f.title || '') + (f.alive ? '' : ' <i class="fav-dead">已删除</i>') + '</b>' +
        '<span>' + fmtTime(f.createTime) + '</span>' +
        '<button class="mc-act" data-unfav="' + esc(f.targetId) + '" data-ftype="' + esc(f.targetType) + '" title="取消收藏">' + ICON.starF + '</button>' +
      '</div>').join('') + '</div>'
    $$('#meBody [data-openq]').forEach((el) => { el.onclick = () => openQuestion(el.dataset.openq) })
    $$('#meBody [data-unfav]').forEach((el) => {
      el.onclick = (ev) => { ev.stopPropagation(); toggleFav(el.dataset.ftype, el.dataset.unfav, () => loadFav()) }
    })
  } catch (e) {
    box.innerHTML = '<div class="card"><div class="empty">' + (String(e.message || '').includes('Could not find') ? '收藏功能待数据库补丁 026 执行后可用' : '加载失败：' + esc(e.message)) + '</div></div>'
  }
}

/* ── 我的关注 ── */
async function loadFollow () {
  const box = $('#meBody'); if (!box) return
  box.innerHTML = '<div class="sk-line">加载中…</div>'
  try {
    const [fd, qd, cd] = await Promise.all([
      rpc('xq_follow_list', { kind: 'following' }).catch(() => ({ list: [] })),
      rpc('xq_my_question_follows').catch(() => ({ list: [] })),
      rpc('xq_social_counts').catch(() => null),
    ])
    const fl = (fd && fd.list) || []
    const ql = (qd && qd.list) || []
    box.innerHTML =
      '<div class="card"><div class="sec-title">关注的人<span class="sec-sub">' + fl.length + '</span></div>' +
        (fl.length ? fl.map((u) => '<div class="mini-row u-link" data-user="' + esc(u.userId) + '">' +
            '<img class="ava sm" src="' + esc(u.avatarUrl || AV) + '" alt="">' +
            '<b>' + esc(u.nickname || '同学') + '</b>' +
            (u.xqId ? '<span>' + esc(u.xqId) + '</span>' : '<span></span>') +
            '<button class="mc-act" data-unfollow="' + esc(u.userId) + '" title="取消关注">' + ICON.bellSF + '</button>' +
          '</div>').join('') : '<div class="muted">还没有关注的人。在动态里点作者头像即可关注。</div>') +
      '</div>' +
      '<div class="card"><div class="sec-title">关注的提问<span class="sec-sub">' + ql.length + '</span></div>' +
        (ql.length ? ql.map((q) => '<div class="mini-row click" data-openq="' + esc(q._id) + '">' +
            '<b>' + esc(q.title) + '</b><span>' + (q.answersCount || 0) + ' 答</span></div>').join('')
          : '<div class="muted">还没有关注的提问。在问题详情里点「关注问题」。</div>') +
      '</div>' +
      (cd ? '<div class="card"><div class="sec-title">统计</div><div class="stat-row">' +
        '<div class="stat"><b>' + (cd.following || 0) + '</b><span>关注中</span></div>' +
        '<div class="stat"><b>' + (cd.followers || 0) + '</b><span>关注我</span></div>' +
        '<div class="stat"><b>' + (cd.favorites || 0) + '</b><span>收藏</span></div>' +
        '<div class="stat"><b>' + (cd.qFollowing || 0) + '</b><span>关注提问</span></div>' +
      '</div></div>' : '')
    $$('#meBody [data-user]').forEach((el) => { el.onclick = () => openUserSheet(el.dataset.user) })
    $$('#meBody [data-openq]').forEach((el) => { el.onclick = () => openQuestion(el.dataset.openq) })
    $$('#meBody [data-unfollow]').forEach((el) => {
      el.onclick = async (ev) => {
        ev.stopPropagation()
        try { await rpc('xq_toggle_follow', { userId: el.dataset.unfollow }); toast('已取消关注'); loadFollow() } catch (e) { toast(e.message) }
      }
    })
  } catch (e) {
    box.innerHTML = '<div class="card"><div class="empty">' + (String(e.message || '').includes('Could not find') ? '关注功能待数据库补丁 026 执行后可用' : '加载失败：' + esc(e.message)) + '</div></div>'
  }
}

/* ── 钱包 / 到账历史（主库 rpc_public_check，匿名 + IP 限频 3 次/分钟） ── */
async function loadWallet () {
  const box = $('#meBody'); if (!box) return
  const xqId = (S.me && S.me.xqId) || ''
  if (!xqId) {
    box.innerHTML = '<div class="card"><div class="empty">当前账号还没有关联贤圈ID，无法查询到账记录。<br>请在尚贤圈 App 内用同一账号登录以自动关联。</div></div>'
    return
  }
  box.innerHTML = '<div class="sk-line">查询中…</div>'
  try {
    const { data, error } = await sbMain.rpc('rpc_public_check', { p_xq: xqId })
    if (error) throw error
    const d = data || {}
    if (d.found === false) {
      box.innerHTML = '<div class="card"><div class="empty">未找到贤圈ID「' + esc(xqId) + '」对应的账号。</div></div>'
      return
    }
    if (d.ok === false) {
      box.innerHTML = '<div class="card"><div class="empty">' + esc(d.error || '查询失败') + '</div></div>'
      return
    }
    const perks = d.perks || {}
    const perkRows = Object.keys(perks).length
      ? Object.keys(perks).map((k) => '<div class="set-row"><div><b>' + esc(k) + '</b><span>增量额度</span></div><span>+' + esc(perks[k]) + '</span></div>').join('')
      : '<div class="muted">暂无增量包</div>'
    const recent = d.recent || []
    box.innerHTML =
      '<div class="card"><div class="sec-title">会员状态<span class="sec-sub">' + esc(xqId) + '</span></div>' +
        '<div class="wallet-hero ' + (d.vip_active ? 'on' : '') + '">' +
          '<b>' + (d.vip_active ? esc(d.vip_title || '贤士') + ' · 生效中' : '未开通会员') + '</b>' +
          '<span>' + (d.vip_active ? '到期时间 ' + esc(String(d.vip_until || '').slice(0, 10)) : '在官网或 App 内开通后可享额度提升') + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="card"><div class="sec-title">增量权益包</div>' + perkRows + '</div>' +
      '<div class="card"><div class="sec-title">最近到账<span class="sec-sub">最多 5 笔</span></div>' +
        (recent.length ? recent.map((o) => '<div class="mini-row"><b>' + esc(o.plan || '订单') + '</b>' +
            '<span>¥' + esc(o.amount) + ' · ' + (o.applied ? '已到账' : '待处理') + '</span></div>').join('')
          : '<div class="muted">暂无到账记录</div>') +
      '</div>' +
      '<div class="card"><div class="muted">到账由爱发电订单自动匹配（每分钟拉取一次）。若长时间未到账，请确认下单时「留言」已填写贤圈ID。</div>' +
        '<a class="btn-primary w100 mt12" href="https://ifdian.net/a/kernthal-sxquan" target="_blank" rel="noopener">前往爱发电</a></div>'
  } catch (e) {
    const msg = String(e.message || e)
    const missing = msg.includes('Could not find the function') || msg.includes('PGRST202')
    box.innerHTML = '<div class="card"><div class="empty">' +
      (missing ? '到账查询服务尚未启用：需先在<b>主库</b>执行补丁 <code>025_public_check.sql</code>。' : '查询失败：' + esc(msg)) +
      '</div><button class="btn-mini w100 mt12" id="walletRetry">重试</button></div>'
    const rt = $('#walletRetry'); if (rt) rt.onclick = () => loadWallet()
  }
}

/* 我的内容：四类统一列出，每行都能直接删 */
const MY_KIND = {
  moment: { label: '动态', key: 'momentId', rpc: 'xq_delete_moment' },
  question: { label: '提问', key: 'questionId', rpc: 'xq_delete_question' },
  market: { label: '闲置', key: 'itemId', rpc: 'xq_market_delete_item' },
  lost: { label: '失物', key: 'lostId', rpc: 'xq_lost_delete' },
}

async function loadMine () {
  const box = $('#meBody'); if (!box) return
  box.innerHTML = '<div class="sk-line">加载中…</div>'
  const uid = S.me.userId

  // 优先用 029 补丁提供的聚合接口；没有就由四个列表兜底拼装
  let list = null
  try { const d = await rpc('xq_my_content'); list = (d && d.list) || [] } catch (e) { list = null }

  const [fd, qd, md, ld] = await Promise.all([
    rpc('xq_moments_feed', { page: 0, pageSize: 50 }).catch(() => ({ list: [] })),
    rpc('xq_questions_list', { page: 0, pageSize: 50 }).catch(() => ({ list: [] })),
    rpc('xq_market_list', { page: 0, pageSize: 50 }).catch(() => ({ list: [] })),
    rpc('xq_lost_list', { page: 0, pageSize: 50 }).catch(() => ({ list: [] })),
  ])
  const questions = ((qd && qd.list) || []).filter((x) => (x.author || {}).userId === uid)

  if (!list) {
    list = [
      ...((fd && fd.list) || []).filter((x) => (x.author || {}).userId === uid)
        .map((x) => ({ kind: 'moment', _id: x._id, title: x.content || '（图片动态）', createTime: x.createTime, extra: (x.likes || 0) + ' 赞' })),
      ...questions.map((x) => ({ kind: 'question', _id: x._id, title: x.title, createTime: x.createTime, extra: (x.answersCount || 0) + ' 答' })),
      ...((md && md.list) || []).filter((x) => x.isOwn)
        .map((x) => ({ kind: 'market', _id: x._id, title: x.title, createTime: x.createTime, extra: '¥' + x.price + ' · ' + (x.status === 'sold' ? '已售出' : '在售') })),
      ...((ld && ld.list) || []).filter((x) => x.isOwn)
        .map((x) => ({ kind: 'lost', _id: x._id, title: x.title, createTime: x.createTime, extra: x.status === 'resolved' ? '已解决' : '进行中' })),
    ]
    list.sort((a, b) => new Date(b.createTime || 0) - new Date(a.createTime || 0))
  }

  const myB = questions.filter((x) => (x.bountyAmount || 0) > 0)

  const row = (x) => {
    const k = MY_KIND[x.kind] || { label: '内容' }
    const openable = x.kind === 'question'
    return '<div class="mini-row' + (openable ? ' click' : '') + '"' +
      (openable ? ' data-openq="' + esc(x._id) + '"' : '') + '>' +
      '<span class="mine-kind">' + esc(k.label) + '</span>' +
      '<b>' + esc(String(x.title || '').slice(0, 34)) + '</b>' +
      '<span>' + esc(x.extra || '') + '</span>' +
      '<button class="del-btn" data-act="del" data-kind="' + esc(x.kind) + '" data-id="' + esc(x._id) + '">删除</button>' +
    '</div>'
  }

  box.innerHTML =
    sec('我的悬赏', myB.length, myB.map((x) => '<div class="mini-row click" data-openq="' + esc(x._id) + '"><b>' + esc(x.title) + '</b><span>¥' + esc(x.bountyAmount) + ' · ' + (x.hasAccepted ? '已答谢' : '待采纳') + '</span></div>').join('')) +
    '<div class="card sec-block"><div class="sec-title">我的内容<span class="sec-sub">' + list.length + ' 条 · 右侧可直接删除</span></div>' +
      (list.length ? list.map(row).join('') : '<div class="muted">还没有发布过内容</div>') + '</div>'

  $$('#meBody [data-openq]').forEach((el) => {
    el.onclick = (ev) => { if (ev.target.closest && ev.target.closest('[data-act]')) return; openQuestion(el.dataset.openq) }
  })
}

/* 删除自己的内容（四类统一入口） */
async function deleteMyContent (kind, id, btn) {
  const k = MY_KIND[kind]
  if (!k) return toast('未知类型')
  if (!confirm('确定删除这条' + k.label + '？删除后其他同学将不再看到，且无法自行恢复。')) return
  const row = btn && btn.closest ? btn.closest('.mini-row') : null
  if (btn) btn.disabled = true
  try {
    const p = {}; p[k.key] = id
    await rpc(k.rpc, p)
    if (row) {
      row.classList.add('removing')
      await new Promise((r) => setTimeout(r, 320))
    }
    toast(k.label + '已删除')
    // 让广场/集市等列表下次进入时重新拉取
    S.feedPage = 0; S.feedList = []; S.feedDone = false
    if (S.meTab === 'mine') loadMine()
    loadMeStats()
  } catch (e) {
    const m = String(e.message || e)
    if (m.includes('Could not find') || m.includes('PGRST202')) toast('「' + k.label + '」删除需先执行数据库补丁 029')
    else toast('删除失败：' + m)
    if (btn) btn.disabled = false
  }
}

function sec (title, n, html) {
  return '<div class="card sec-block"><div class="sec-title">' + title + '<span class="sec-sub">' + n + ' 条</span></div>' +
    (n ? html : '<div class="muted">暂无记录</div>') + '</div>'
}

/* 页面标题区（统一各页视觉起点） */
function pageHead (eyebrow, title, sub) {
  return '<div class="page-head">' +
    '<span class="ph-eyebrow">' + esc(eyebrow) + '</span>' +
    '<h2 class="ph-title">' + esc(title) + '</h2>' +
    (sub ? '<p class="ph-sub">' + esc(sub) + '</p>' : '') +
  '</div>'
}

async function loadBadges () {
  const box = $('#meBody'); if (!box) return
  box.innerHTML = '<div class="sk-line">加载中…</div>'
  try {
    const d = await rpc('xq_badges_all')
    const list = (d && d.list) || []
    const got = list.filter((b) => b.earnedAt).length
    box.innerHTML = '<div class="card"><div class="sec-title">徽章墙<span class="sec-sub">已获 ' + got + ' / ' + list.length + '</span></div>' +
      '<div class="badge-grid">' + list.map((b) =>
        '<div class="badge-cell' + (b.earnedAt ? ' earned' : '') + '" title="' + esc(b.desc || '') + '">' +
          '<div class="badge-ico">' + esc(BADGE_ICON[b.code] || '章') + '</div>' +
          '<div class="badge-name">' + esc(b.name) + '</div>' +
        '</div>').join('') + '</div></div>'
  } catch (e) { box.innerHTML = '<div class="card"><div class="empty">徽章加载失败：' + esc(e.message) + '</div></div>' }
}

function saveNotifPref () {
  writeLS('xq_notif_pref', { desktop: S.notifOn, routineOn: S.routineOn, routineHalf: S.routineHalf })
}
function paintSettings () {
  const box = $('#meBody'); if (!box) return
  const sw = (on, act, label) =>
    '<div class="set-acts">' +
      '<span class="set-state' + (on ? ' on' : '') + '">' + (on ? '已开启' : '已关闭') + '</span>' +
      '<button class="sw' + (on ? ' on' : '') + '" data-act="' + act + '" role="switch" ' +
        'aria-checked="' + (on ? 'true' : 'false') + '" aria-label="' + esc(label) + '"></button>' +
    '</div>'
  box.innerHTML =
    '<div class="card"><div class="sec-title">通知偏好</div>' +
      '<div class="set-row set-click" data-act-row="notif">' +
        '<div><b>桌面通知</b><span>电脑端也能收到回复、系统通知与新帖提醒</span></div>' +
        sw(S.notifOn, 'notif', '桌面通知') + '</div>' +
      '<div class="set-row set-click" data-act-row="routine">' +
        '<div><b>整点报时</b><span>每小时整点提醒：时间 + 天气 + 一句建议</span></div>' +
        sw(S.routineOn, 'routine', '整点报时') + '</div>' +
      '<div class="set-row set-click" data-act-row="half">' +
        '<div><b>半小时提醒</b><span>每半点追加一次（需先开启整点报时）</span></div>' +
        sw(S.routineHalf, 'half', '半小时提醒') + '</div>' +
      '<div class="set-row"><div><b>未读红点</b><span>每 30 秒刷新，别人发新帖也会推给你</span></div>' +
        '<span class="muted">常开</span></div>' +
      '<button class="btn-mini w100 mt12" data-act="try">立即试一条提醒</button>' +
      '<div id="swDiag"></div>' +
    '</div>' +
    '<div class="card"><div class="sec-title">账号</div>' +
      '<div class="set-row"><div><b>' + esc(S.me.email || '') + '</b><span>当前登录账号</span></div></div>' +
      '<div class="set-row"><div><b>贤圈ID</b><span>' + (S.me.xqId ? esc(S.me.xqId) : '未关联') + '</span></div></div>' +
      '<button class="btn-mini w100 mt12" data-act="out">退出登录</button>' +
    '</div>'

  /* ═══ ① 整行可点：万一右侧开关被别的元素盖住，点左边的文字也能切换 ═══ */
  $$('#meBody .set-click').forEach((row) => {
    row.onclick = (ev) => {
      if (ev.target.closest && ev.target.closest('.sw')) return   // 开关自己会处理，避免切两次
      ev.stopPropagation()
      const el = row.querySelector('.sw')
      if (el) { try { handleMeAct(el, ev) } catch (err) { revealError(err) } }
    }
  })

  /* ═══ ② 自检：开关中心点上到底是哪个元素？被挡住了就写出来 ═══ */
  setTimeout(() => {
    const host = $('#swDiag')
    if (!host) return
    const lines = []
    $$('#meBody .sw').forEach((el) => {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) return
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2
      const top = document.elementFromPoint(cx, cy)
      const label = el.getAttribute('aria-label') || '开关'
      if (!top || el.contains(top) || top === el) {
        lines.push('· ' + label + '：未被遮挡')
      } else {
        const d = top.tagName.toLowerCase() +
          (top.id ? '#' + top.id : '') +
          (top.className && typeof top.className === 'string' ? '.' + top.className.trim().split(/\s+/).join('.') : '')
        lines.push('· ' + label + '：被 ' + d + ' 挡住了')
      }
    })
    const blocked = lines.some((l) => l.indexOf('挡住了') >= 0)
    if (blocked) {
      host.innerHTML = '<div class="err-box" style="margin-top:12px"><b>开关被遮挡自检</b><br>' +
        lines.join('<br>') +
        '<br><br>把这段截图发给开发者即可定位。你仍然可以点每行左边的文字来切换。</div>'
    } else {
      host.innerHTML = '<div class="note" style="margin-top:10px">自检：三个开关均未被遮挡。点开关或点整行文字都能切换。</div>'
      setTimeout(() => { if (host && host.parentNode) host.innerHTML = '' }, 6000)
    }
  }, 700)

  /* ═══ 双保险：除了全局委托，这里再给每个可点元素直绑一次 ═══
     全局委托万一被别的元素吃掉了事件，直绑仍然能点。
     直绑里 stopPropagation，避免和委托重复触发。 */
  $$('#meBody [data-act]').forEach((el) => {
    el.onclick = (ev) => {
      ev.stopPropagation()
      try { handleMeAct(el, ev) } catch (err) { revealError(err) }
    }
  })
}

/* 把异常显示出来，不再静默失败（之前开关点不动就是因为它静默了） */
function revealError (err) {
  const m = (err && (err.message || err)) + ''
  try { toast('出错了：' + m.slice(0, 60)) } catch (e) {}
  const box = $('#meBody')
  if (box) {
    const d = document.createElement('div')
    d.className = 'err-box'
    d.textContent = '操作出错：' + m
    box.appendChild(d)
    setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d) }, 8000)
  }
}

/* ═══ 「我的」页统一事件委托 ═══
   原来是逐个 $('#setNotif').onclick = …，只要其中任意一行抛异常，
   后面所有按钮就都绑不上（这就是「开关点不动」的根因）。
   改成委托：DOM 怎么重绘都不会丢事件。 */
async function handleMeAct (el, ev) {
  const act = el.dataset.act
  if (!act) return
  try {
  if (act === 'notif') { toggleNotif(); return }
  if (act === 'try') { routineNotify(true); return }
  if (act === 'del') { deleteMyContent(el.dataset.kind, el.dataset.id, el); return }
  if (act === 'out') {
    if (!confirm('确定退出登录？')) return
    await sbAuth.auth.signOut()
    S.me = null; S.meTab = 'mine'; renderHeader(); nav('feed', true); toast('已退出登录')
    return
  }
  if (act === 'routine' || act === 'half') {
    const key = act === 'routine' ? 'routineOn' : 'routineHalf'
    S[key] = !S[key]
    saveNotifPref()
    const on = S[key]
    el.classList.toggle('on', on)
    el.setAttribute('aria-checked', on ? 'true' : 'false')
    el.classList.add('just'); setTimeout(() => el.classList.remove('just'), 520)
    const st = el.parentNode && el.parentNode.querySelector ? el.parentNode.querySelector('.set-state') : null
    if (st) { st.textContent = on ? '已开启' : '已关闭'; st.classList.toggle('on', on) }
    toast(on ? '已开启' + el.getAttribute('aria-label') : '已关闭' + el.getAttribute('aria-label'))
    return
  }
  } catch (err) { revealError(err) }
}

/* ═══════════════════ 通知 ═══════════════════ */
const TYPE_LABEL = { reply: '回复', at: '@提及', system: '系统', order: '订单', kb: '知识库', info: '提醒' }

async function openNotify () {
  if (!S.me) return openAuth()
  const layer = $('#layer')
  layer.hidden = false
  layer.innerHTML = '<div class="sheet narrow"><div class="sk-line">加载中…</div></div>'
  try {
    const d = await rpc('xq_notif_list')
    const list = (d && d.list) || []
    layer.innerHTML = '<div class="sheet narrow" data-sheet>' +
      '<button class="sheet-x" data-close>' + ICON.close + '</button>' +
      '<div class="sheet-h"><h3>通知</h3><button class="btn-mini ghost" id="notifReadAll">全部已读</button></div>' +
      '<div class="notif-list">' + (list.length
        ? list.map((n) => '<div class="notif-row' + (n.read ? '' : ' unread') + '">' +
            '<b>' + esc(TYPE_LABEL[n.type] || '通知') + '</b><p>' + esc(n.content) + '</p>' +
            '<time>' + fmtTime(n.createTime) + '</time></div>').join('')
        : '<div class="empty">暂无通知</div>') + '</div>' +
    '</div>'
    bindSheet()
    const ra = $('#notifReadAll')
    if (ra) ra.onclick = async () => {
      try { await rpc('xq_notif_read_all'); S.unread = 0; paintUnread(); openNotify() } catch (e) { toast(e.message) }
    }
  } catch (e) {
    layer.innerHTML = '<div class="sheet narrow"><button class="sheet-x" data-close>' + ICON.close + '</button><div class="empty">加载失败：' + esc(e.message) + '</div></div>'
    bindSheet()
  }
}

async function refreshUnread () {
  if (!S.me) return
  try {
    const d = await rpc('xq_notif_list')
    const un = (d && d.unread) || 0
    if (un > S.unread) desktopNotify('尚贤圈有新消息', '你有 ' + un + ' 条未读通知')
    S.unread = un
    paintUnread()
  } catch (e) {}
}

function paintUnread () {
  const dot = $('#hdDot'); if (dot) dot.hidden = !(S.unread > 0)
  const tab = $('#tabMe'); if (tab) tab.classList.toggle('dot', S.unread > 0)
}

function toggleNotif () {
  if (S.notifOn) { S.notifOn = false; saveNotifPref(); toast('已关闭桌面通知'); paintSettings(); return }
  if (!('Notification' in window)) return toast('当前浏览器不支持桌面通知')
  Notification.requestPermission().then((p) => {
    if (p === 'granted') {
      S.notifOn = true
      saveNotifPref()
      toast('桌面通知已开启')
      desktopNotify('尚贤圈', '桌面通知已开启。整点会提醒你时间与天气，别人发帖也会推给你。')
    } else toast('未获得通知权限，请在浏览器地址栏左侧放行')
    paintSettings()
  })
}
function desktopNotify (title, body) {
  if (!S.notifOn || !('Notification' in window) || Notification.permission !== 'granted') return false
  try { new Notification(title, { body, icon: './assets/icons/icon-192.png' }); return true } catch (e) { return false }
}

/* 页面内通知卡：桌面通知没开 / 被系统拦下时，至少让用户看见内容。
   之前「试一条提醒」只弹一个转瞬即逝的 toast，等于什么都没发生。 */
function inAppNotify (title, body) {
  let host = $('#inAppNotif')
  if (!host) {
    host = document.createElement('div')
    host.id = 'inAppNotif'
    host.className = 'inapp-notif'
    document.body.appendChild(host)
  }
  host.innerHTML =
    '<span class="ian-ic">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M18 9a6 6 0 10-12 0c0 5-2 6-2 6h16s-2-1-2-6"/><path d="M10.3 19a2 2 0 003.4 0"/></svg>' +
    '</span>' +
    '<span class="ian-b"><b>' + esc(title) + '</b><p>' + esc(body).replace(/\n/g, '<br>') + '</p></span>' +
    '<button class="ian-x" aria-label="关闭">×</button>'
  host.classList.add('on')
  const x = host.querySelector('.ian-x')
  if (x) x.onclick = (ev) => { ev.stopPropagation(); host.classList.remove('on') }
  clearTimeout(inAppNotify._t)
  inAppNotify._t = setTimeout(() => host.classList.remove('on'), 10000)
}
function startUnreadPoll () {
  if (S.notifTimer) return
  S.notifTimer = setInterval(refreshUnread, 30000)
  refreshUnread()
}

/* ═══ 定时提醒：整点报时 + 天气 + 一句建议 ═══ */
const ROUTINE_SUGGEST = [
  '课间起来走两步，肩膀放松一下。',
  '记得喝水，久坐别忘了活动脖子。',
  '作业还没写完的话，现在开始最划算。',
  '眼睛累了看看窗外远处，放松一下。',
  '有想问的问题可以发到提问区，同学会帮你。',
  '去看看「合集」里的本周热门，也许有你需要的内容。',
]
function routineSlotKey (half) {
  const d = new Date()
  return d.toDateString() + ' ' + d.getHours() + (half ? ':30' : ':00')
}
async function routineNotify (manual) {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const wx = await getWeather()
  const tip = ROUTINE_SUGGEST[d.getHours() % ROUTINE_SUGGEST.length]
  const title = '现在是 ' + hh + ':' + mm
  const body = '桂林 ' + wx.temp + '° ' + wx.desc +
    (wx.feels !== undefined ? '，体感 ' + wx.feels + '°' : '') + '。' + wx.tip + '\n' + tip

  // 手动点「试一条提醒」时，用户意图很明确：顺手把桌面通知权限要下来
  if (manual && 'Notification' in window && !S.notifOn) {
    try {
      if (Notification.permission === 'granted') { S.notifOn = true; saveNotifPref() }
      else if (Notification.permission === 'default') {
        const p = await Notification.requestPermission()
        if (p === 'granted') { S.notifOn = true; saveNotifPref() }
      }
    } catch (e) {}
    if (typeof paintSettings === 'function') { try { paintSettings() } catch (e) {} }
  }

  const sent = desktopNotify(title, body)
  // 无论如何都在页面里显示一次，保证「点了有反应」
  inAppNotify(title, body)
  if (manual) {
    toast(sent ? '已推送一条桌面通知' :
      (S.notifOn ? '系统拦下了通知，已在页面内显示' : '桌面通知未开启，已在页面内显示'))
  }
}
function startRoutineNotify () {
  if (S.routineTimer) return
  S.routineTimer = setInterval(() => {
    if (!S.routineOn) return
    const d = new Date()
    const m = d.getMinutes()
    const isHour = m === 0
    const isHalf = m === 30
    if (!isHour && !isHalf) return
    if (isHalf && !S.routineHalf) return
    const k = routineSlotKey(isHalf)
    if (readLS('xq_routine_last', '') === k) return
    writeLS('xq_routine_last', k)
    routineNotify(false)
  }, 30000)
}

/* ═══ PC 端「搞到桌面 / 设为常驻」提示 ═══
   只在 PC 显示（用户明确：这是电脑端的事）。
   若浏览器给了 beforeinstallprompt 就一键装；否则给「创建快捷方式（在窗口中打开）」
   的分步指引——那条路不需要 Service Worker 也能得到一个无地址栏的独立窗口。 */
let deferredInstall = null

function isStandalone () {
  try {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: window-controls-overlay)').matches ||
      window.navigator.standalone === true
  } catch (e) { return false }
}

function installSteps () {
  return '<ol class="inst-steps">' +
    '<li>点浏览器右上角的 <b>⋮</b>（Chrome）或 <b>…</b>（Edge）</li>' +
    '<li>选「<b>投放、保存和分享</b>」→「<b>创建快捷方式</b>」</li>' +
    '<li>勾选「<b>在窗口中打开</b>」，点创建</li>' +
    '<li>桌面会多一个「贤圈中心」，双击打开就是<b>没有地址栏和插件栏的独立应用</b></li>' +
  '</ol>'
}

function showInstallPrompt (manualOnly) {
  if (isStandalone() || window.innerWidth < 860) return
  if ($('#sxqInst')) return
  const el = document.createElement('div')
  el.className = 'sxq-inst'
  el.id = 'sxqInst'
  el.innerHTML =
    '<div class="sxq-inst-head">' +
      '<span class="sxq-inst-seal">贤</span>' +
      '<span class="sxq-inst-title">把贤圈中心弄到桌面？</span>' +
      '<button class="sxq-inst-x" data-inst="close" aria-label="关闭">×</button>' +
    '</div>' +
    '<p>装到桌面后，它会变成一个<b>独立窗口的应用</b>——没有地址栏、没有浏览器插件栏，<br>像正常软件一样双击就能用。</p>' +
    '<div id="sxqInstSteps" hidden>' + installSteps() + '</div>' +
    '<div class="sxq-inst-acts">' +
      (manualOnly
        ? '<button class="btn-primary" data-inst="steps">怎么弄？</button>'
        : '<button class="btn-primary" data-inst="go">一键安装</button>' +
          '<button class="btn-mini" data-inst="steps">手动方式</button>') +
      '<button class="btn-mini" data-inst="close">以后再说</button>' +
    '</div>'
  document.body.appendChild(el)

  el.addEventListener('click', async (e) => {
    const b = e.target.closest && e.target.closest('[data-inst]')
    if (!b) return
    const a = b.dataset.inst
    if (a === 'steps') {
      const s = $('#sxqInstSteps')
      if (s) s.hidden = !s.hidden
      return
    }
    if (a === 'go' && deferredInstall) {
      try {
        deferredInstall.prompt()
        const r = await deferredInstall.userChoice
        if (r && r.outcome === 'accepted') { dismissInstall(); toast('已开始安装，稍等桌面图标出现'); return }
      } catch (err) {}
      const s = $('#sxqInstSteps'); if (s) s.hidden = false
      return
    }
    if (a === 'close') dismissInstall()
  })
}

function dismissInstall () {
  const el = $('#sxqInst')
  if (el) { el.classList.add('leaving'); setTimeout(() => el.remove(), 320) }
  writeLS('xq_inst_dismiss', Date.now())
}

function initInstallPrompt () {
  if (isStandalone() || window.innerWidth < 860) return
  const last = Number(readLS('xq_inst_dismiss', 0)) || 0
  if (last && Date.now() - last < 7 * 86400000) return   // 关过一次，7 天内不再打扰

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredInstall = e
    showInstallPrompt(false)
  })
  // 没等到 beforeinstallprompt（站点未注册可安装 SW 时会这样）→ 直接给手动指引
  setTimeout(() => { if (!deferredInstall) showInstallPrompt(true) }, 4000)
}

/* ═══ iOS / 移动端：键盘弹出不遮住输入框 ═══
   用 visualViewport 算出键盘占掉的高度写进 --kb，
   弹层据此上抬、并把聚焦的输入框滚进视野。 */
function initKeyboardFix () {
  const vv = window.visualViewport
  if (!vv) return
  const root = document.documentElement
  const apply = () => {
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
    root.style.setProperty('--kb', kb + 'px')
  }
  vv.addEventListener('resize', apply)
  vv.addEventListener('scroll', apply)
  apply()
  // 聚焦输入框时等键盘动画结束后滚到视野中央
  document.addEventListener('focusin', (e) => {
    const t = e.target
    if (!t || !t.tagName || !/^(INPUT|TEXTAREA)$/.test(t.tagName)) return
    setTimeout(() => {
      try { t.scrollIntoView({ block: 'center', behavior: 'smooth' }) }
      catch (err) { try { t.scrollIntoView() } catch (e2) {} }
    }, 280)
  })
  // 失焦后恢复
  document.addEventListener('focusout', () => { setTimeout(apply, 120) })
}

/* ═══ iOS「添加到主屏幕」引导 ═══
   iOS 不会触发 beforeinstallprompt，只能给分步图示。
   仅 iPhone/iPad 显示；已在主屏不显示；关掉后 14 天不再打扰。 */
function initIosInstallGuide () {
  const ua = navigator.userAgent || ''
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (!isIOS) return
  if (navigator.standalone === true) return
  const last = Number(readLS('xq_ios_inst', 0)) || 0
  if (last && Date.now() - last < 14 * 86400000) return
  setTimeout(showIosInstallGuide, 9000)   // 别一进来就打扰
}

function showIosInstallGuide () {
  if ($('#iosInst') || navigator.standalone === true) return
  const el = document.createElement('div')
  el.className = 'ios-inst'
  el.id = 'iosInst'
  el.innerHTML =
    '<div class="ios-inst-head">' +
      '<span class="sxq-inst-seal">贤</span>' +
      '<b>把贤圈中心加到主屏幕？</b>' +
      '<button class="ios-inst-x" data-ios="close" aria-label="关闭">×</button>' +
    '</div>' +
    '<p>加到主屏后，它会像 App 一样全屏打开，<b>没有地址栏、不用每次输网址</b>。</p>' +
    '<ol class="ios-inst-steps">' +
      '<li><i>1</i><span>点 Safari 底部中间的「分享」按钮 <span class="ios-inst-share"></span></span></li>' +
      '<li><i>2</i><span>在弹出菜单里往下滑，找到「<b>添加到主屏幕</b>」</span></li>' +
      '<li><i>3</i><span>点右上角「添加」，桌面就会出现图标</span></li>' +
    '</ol>' +
    '<div class="ios-inst-acts">' +
      '<button class="btn-primary" data-ios="close">知道了</button>' +
      '<button class="btn-mini" data-ios="later">以后再说</button>' +
    '</div>'
  document.body.appendChild(el)
  el.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-ios]')
    if (!b) return
    if (b.dataset.ios === 'later') writeLS('xq_ios_inst', Date.now())
    el.classList.add('leaving')
    setTimeout(() => el.remove(), 320)
  })
}
/* ═══ 新帖监测：别人发了新动态 → 通知（服务端触发器之外的兜底） ═══ */
function startFeedWatch () {
  if (S.feedWatchTimer) return
  let lastId = null
  const tick = async () => {
    try {
      const d = await rpc('xq_moments_feed', { page: 0, pageSize: 3 })
      const list = (d && d.list) || []
      if (!list.length) return
      const top = list[0]
      if (lastId === null) { lastId = top._id; return }
      if (top._id === lastId) return
      lastId = top._id
      const a = top.author || {}
      if (S.me && a.userId === S.me.userId) return
      desktopNotify('尚贤圈有新动态', (a.nickname || '同学') + '：' + String(top.content || '（图片动态）').slice(0, 40))
      if (S.route === 'feed' && S.feedSort !== 'collection') { S.feedPage = 0; loadFeed(false) }
      refreshUnread()
    } catch (e) {}
  }
  S.feedWatchTimer = setInterval(tick, 45000)
  tick()
}

/* ═══════════════════ 搜索 ═══════════════════ */
function openSearch () {
  const layer = $('#layer')
  layer.hidden = false
  layer.innerHTML = '<div class="sheet narrow" data-sheet>' +
    '<button class="sheet-x" data-close>' + ICON.close + '</button>' +
    '<div class="sheet-h"><h3>搜索</h3></div>' +
    '<div class="search-bar"><input class="ipt" id="searchIpt" placeholder="搜索动态 / 提问 / 集市 / 失物"></div>' +
    '<div id="searchRes" class="search-res"><div class="muted">输入关键词后回车搜索</div></div>' +
  '</div>'
  bindSheet()
  const ipt = $('#searchIpt')
  ipt.focus()
  ipt.onkeydown = (e) => { if (e.key === 'Enter') doSearch(ipt.value.trim()) }
}

async function doSearch (kw) {
  const box = $('#searchRes'); if (!box) return
  if (!kw) { box.innerHTML = '<div class="muted">输入关键词后回车搜索</div>'; return }
  box.innerHTML = '<div class="sk-line">搜索中…</div>'
  const kwl = kw.toLowerCase()
  const hit = (s) => String(s || '').toLowerCase().includes(kwl)
  try {
    const [fd, qd, md, ld] = await Promise.all([
      rpc('xq_moments_feed', { page: 0, pageSize: 50 }).catch(() => ({ list: [] })),
      rpc('xq_questions_list', { page: 0, pageSize: 50 }).catch(() => ({ list: [] })),
      rpc('xq_market_list', { page: 0, pageSize: 50 }).catch(() => ({ list: [] })),
      rpc('xq_lost_list', { page: 0, pageSize: 50 }).catch(() => ({ list: [] })),
    ])
    const g = [
      { t: '动态', rows: ((fd.list) || []).filter((x) => hit(x.content)).map((x) => ({ k: x._id, t: (x.content || '（图片动态）').slice(0, 40), s: (x.author || {}).nickname })) },
      { t: '提问', rows: ((qd.list) || []).filter((x) => hit(x.title) || hit(x.detail)).map((x) => ({ k: x._id, t: x.title, s: (x.author || {}).nickname, q: 1 })) },
      { t: '集市', rows: ((md.list) || []).filter((x) => hit(x.title) || hit(x.detail)).map((x) => ({ k: x._id, t: x.title + ' ¥' + x.price, s: (x.author || {}).nickname })) },
      { t: '失物', rows: ((ld.list) || []).filter((x) => hit(x.title) || hit(x.detail)).map((x) => ({ k: x._id, t: x.title, s: x.place })) },
    ].filter((x) => x.rows.length)
    box.innerHTML = g.length
      ? g.map((grp) => '<div class="sr-group"><div class="sr-t">' + grp.t + ' · ' + grp.rows.length + '</div>' +
          grp.rows.map((r) => '<div class="sr-row"' + (r.q ? ' data-openq="' + esc(r.k) + '"' : '') + '><b>' + esc(r.t) + '</b><span>' + esc(r.s || '') + '</span></div>').join('') +
        '</div>').join('')
      : '<div class="empty">没有找到相关内容</div>'
    $$('#searchRes [data-openq]').forEach((el) => { el.onclick = () => openQuestion(el.dataset.openq) })
  } catch (e) { box.innerHTML = '<div class="empty">搜索失败：' + esc(e.message) + '</div>' }
}

/* ═══════════════════ 弹层通用 ═══════════════════ */
function closeLayer () { const l = $('#layer'); if (l) { l.hidden = true; l.innerHTML = '' } }
function bindSheet () {
  $$('#layer [data-close]').forEach((el) => { el.onclick = closeLayer })
  const layer = $('#layer')
  layer.onclick = (e) => { if (e.target === layer) closeLayer() }
}

function bindZoom () {
  $$('[data-zoom]').forEach((el) => {
    el.onclick = () => {
      const layer = $('#layer')
      layer.hidden = false
      layer.innerHTML = '<div class="zoom"><img src="' + esc(el.dataset.zoom) + '" alt=""></div>'
      layer.onclick = closeLayer
    }
  })
}

/* ═══════════════════ 发布 / 编辑 ═══════════════════ */
function openCompose (kind) {
  if (!S.me) return openAuth()
  const layer = $('#layer')
  layer.hidden = false
  const titles = { moment: '发布动态', market: '发布闲置', lost: '发布失物信息', question: '提问' }
  layer.innerHTML = '<div class="sheet narrow" data-sheet>' +
    '<button class="sheet-x" data-close>' + ICON.close + '</button>' +
    '<div class="sheet-h"><h3>' + titles[kind] + '</h3></div>' +
    '<div class="compose" id="composeBody"></div>' +
  '</div>'
  bindSheet()
  const b = $('#composeBody')
  if (kind === 'moment') {
    b.innerHTML =
      '<textarea class="ta" id="cContent" placeholder="分享点什么…（最多 2000 字）"></textarea>' +
      '<div class="up-row"><label class="btn-mini">添加图片<input type="file" accept="image/*" multiple hidden id="cImgs"></label>' +
        '<span class="muted" id="cImgN">最多 9 张</span></div>' +
      '<div class="thumb-row" id="cThumbs"></div>' +
      '<button class="btn-primary w100 mt12" id="cSend">发布</button>'
    bindUploader('#cImgs', '#cThumbs', 9)
    $('#cSend').onclick = async () => {
      const content = $('#cContent').value.trim()
      const images = collectThumbs('#cThumbs')
      if (!content && !images.length) return toast('发点内容再发布吧')
      const btn = $('#cSend'); btn.disabled = true
      try { await rpc('xq_create_moment', { content, images }); toast('发布成功'); desktopNotify('发布成功', '你的动态已发布，可在广场看到'); closeLayer(); if (S.route !== 'feed') nav('feed', true); else { S.feedPage = 0; S.feedList = []; loadFeed(false) } }
      catch (e) { toast(e.message) }
      btn.disabled = false
    }
  } else if (kind === 'market') {
    b.innerHTML =
      '<input class="ipt" id="cTitle" placeholder="标题（最多 40 字）" maxlength="40">' +
      '<div class="two"><input class="ipt" id="cPrice" type="number" min="0" placeholder="价格 ¥">' +
        '<label class="chk"><input type="checkbox" id="cNeg"> 可议价</label></div>' +
      '<input class="ipt" id="cContact" placeholder="联系方式（必填，如微信/QQ）" maxlength="100">' +
      '<textarea class="ta" id="cDetail" placeholder="描述成色、瑕疵等（最多 1000 字）"></textarea>' +
      '<div class="up-row"><label class="btn-mini">添加图片<input type="file" accept="image/*" multiple hidden id="cImgs"></label>' +
        '<span class="muted" id="cImgN">最多 5 张</span></div>' +
      '<div class="thumb-row" id="cThumbs"></div>' +
      '<div class="notice notice-warn small">平台不介入交易、不担保；未成年人交易须经监护人同意。</div>' +
      '<button class="btn-primary w100" id="cSend">发布</button>'
    bindUploader('#cImgs', '#cThumbs', 5)
    $('#cSend').onclick = async () => {
      const title = $('#cTitle').value.trim(), contact = $('#cContact').value.trim()
      if (!title) return toast('请填写标题')
      if (!contact) return toast('联系方式必填')
      const btn = $('#cSend'); btn.disabled = true
      try {
        await rpc('xq_market_create', { title, price: Number($('#cPrice').value) || 0, contact,
          detail: $('#cDetail').value.trim(), negotiable: $('#cNeg').checked, images: collectThumbs('#cThumbs') })
        toast('发布成功'); desktopNotify('发布成功', '你的闲置已挂出'); closeLayer(); if (S.route !== 'market') nav('market', true); else loadMarket()
      } catch (e) { toast(e.message) }
      btn.disabled = false
    }
  } else if (kind === 'lost') {
    b.innerHTML =
      '<div class="seg"><button id="lkLost" class="on">我丢了东西</button><button id="lkFound">我捡到东西</button></div>' +
      '<input class="ipt" id="cTitle" placeholder="标题（最多 40 字）" maxlength="40">' +
      '<input class="ipt" id="cPlace" placeholder="地点（最多 40 字）" maxlength="40">' +
      '<input class="ipt" id="cContact" placeholder="联系方式（必填）" maxlength="100">' +
      '<textarea class="ta" id="cDetail" placeholder="详细描述（最多 1000 字）"></textarea>' +
      '<button class="btn-primary w100" id="cSend">发布</button>'
    let lk = 'lost'
    $('#lkLost').onclick = () => { lk = 'lost'; $('#lkLost').classList.add('on'); $('#lkFound').classList.remove('on') }
    $('#lkFound').onclick = () => { lk = 'found'; $('#lkFound').classList.add('on'); $('#lkLost').classList.remove('on') }
    $('#cSend').onclick = async () => {
      const title = $('#cTitle').value.trim(), contact = $('#cContact').value.trim()
      if (!title) return toast('请填写标题')
      if (!contact) return toast('联系方式必填，方便同学联系你')
      const btn = $('#cSend'); btn.disabled = true
      try {
        await rpc('xq_lost_create', { kind: lk, title, contact, place: $('#cPlace').value.trim(), detail: $('#cDetail').value.trim() })
        toast('发布成功'); desktopNotify('发布成功', '你的失物信息已发布'); closeLayer(); S.lostTab = lk; if (S.route !== 'lost') nav('lost', true); else loadLost()
      } catch (e) { toast(e.message) }
      btn.disabled = false
    }
  } else {
    const TIERS = ['不悬赏', '¥1', '¥3', '¥15', '¥30', '¥50', '¥100', '¥200']
    b.innerHTML =
      '<input class="ipt" id="cTitle" placeholder="问题标题（最多 50 字）" maxlength="50">' +
      '<textarea class="ta" id="cDetail" placeholder="补充详情（最多 2000 字）"></textarea>' +
      '<input class="ipt" id="cTags" placeholder="标签，逗号分隔，最多 5 个（如：数学,物理）">' +
      '<div class="tier-pick"><span class="muted">悬赏档位</span>' +
        '<div class="tier-chips">' + TIERS.map((t, i) => '<button class="chip ' + (i === 0 ? 'on' : '') + '" data-tier="' + i + '">' + t + '</button>').join('') + '</div></div>' +
      '<div class="notice notice-info small">悬赏仅作标记：采纳后由你手动把鸡腿赠送给回答者，平台不碰钱、不担保。</div>' +
      '<button class="btn-primary w100" id="cSend">发布提问</button>'
    let tier = 0
    $$('#composeBody [data-tier]').forEach((el) => {
      el.onclick = () => { tier = Number(el.dataset.tier); $$('#composeBody [data-tier]').forEach((x) => x.classList.toggle('on', x === el)) }
    })
    $('#cSend').onclick = async () => {
      const title = $('#cTitle').value.trim()
      if (!title) return toast('请填写问题标题')
      const tags = $('#cTags').value.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean).slice(0, 5)
      const btn = $('#cSend'); btn.disabled = true
      try {
        await rpc('xq_create_question', { title, detail: $('#cDetail').value.trim(), tags, bountyTier: tier })
        toast('提问已发布'); desktopNotify('发布成功', '你的提问已发布，有回答会通知你'); closeLayer(); if (S.route !== 'ask') nav('ask', true); else render()
      } catch (e) { toast(e.message) }
      btn.disabled = false
    }
  }
}

function openEditProfile () {
  const m = S.me
  const layer = $('#layer')
  layer.hidden = false
  layer.innerHTML = '<div class="sheet narrow" data-sheet>' +
    '<button class="sheet-x" data-close>' + ICON.close + '</button>' +
    '<div class="sheet-h"><h3>编辑资料</h3></div>' +
    '<div class="up-row center"><img class="me-ava sm" id="epAva" src="' + esc(m.avatarUrl || AV) + '" alt="">' +
      '<label class="btn-mini">更换头像<input type="file" accept="image/*" hidden id="epFile"></label></div>' +
    '<input class="ipt" id="epNick" placeholder="昵称（最多 20 字）" maxlength="20" value="' + esc(m.nickname || '') + '">' +
    '<input class="ipt" id="epSig" placeholder="个性签名" maxlength="60" value="' + esc(m.signature || '') + '">' +
    '<button class="btn-primary w100" id="epSave">保存</button>' +
  '</div>'
  bindSheet()
  let newAva = ''
  $('#epFile').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return
    try { newAva = await uploadImage(f); $('#epAva').src = newAva } catch (err) { toast('上传失败：' + err.message) }
  }
  $('#epSave').onclick = async () => {
    const btn = $('#epSave'); btn.disabled = true
    try {
      const p = { nickname: $('#epNick').value.trim(), signature: $('#epSig').value.trim() }
      if (newAva) p.avatarUrl = newAva
      await rpc('xq_update_self', p)
      await loadMe(); toast('已保存'); closeLayer(); render()
    } catch (e) { toast(e.message) }
    btn.disabled = false
  }
}

/* ═══════════════════ 图片上传（压缩 ≤800KB） ═══════════════════ */
function collectThumbs (sel) { return $$(sel + ' .thumb[data-url]').map((el) => el.dataset.url).filter(Boolean) }

function bindUploader (inputSel, thumbSel, max) {
  const inp = $(inputSel), row = $(thumbSel), cnt = $('#cImgN')
  inp.onchange = async (e) => {
    const files = Array.from(e.target.files || [])
    for (const f of files) {
      if (row.children.length >= max) { toast('最多 ' + max + ' 张'); break }
      const ph = document.createElement('div')
      ph.className = 'thumb loading'
      row.appendChild(ph)
      try {
        const url = await uploadImage(f)
        ph.classList.remove('loading')
        ph.dataset.url = url
        ph.innerHTML = '<img src="' + esc(url) + '" alt=""><button class="thumb-x">×</button>'
        ph.querySelector('.thumb-x').onclick = () => ph.remove()
      } catch (err) { ph.remove(); toast('上传失败：' + err.message) }
    }
    inp.value = ''
    if (cnt) cnt.textContent = '已选 ' + row.children.length + ' / ' + max
  }
}

async function uploadImage (file) {
  if (!S.me) throw new Error('请先登录')
  const blob = await compressImage(file, 800 * 1024)
  const ext = (blob.type === 'image/png') ? 'png' : 'jpg'
  const path = 'moments/' + S.me.userId + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '.' + ext
  const { error } = await sbAuth.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, upsert: false })
  if (error) throw error
  const { data } = sbAuth.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}

function compressImage (file, limit) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('不是图片文件'))
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let w = img.width, h = img.height
      const MAXW = 1600
      if (w > MAXW) { h = Math.round(h * MAXW / w); w = MAXW }
      const cv = document.createElement('canvas')
      cv.width = w; cv.height = h
      const ctx = cv.getContext('2d')
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
      let q = 0.88
      const tryOnce = () => {
        cv.toBlob((blob) => {
          if (!blob) return reject(new Error('压缩失败'))
          if (blob.size <= limit || q <= 0.4) return resolve(blob)
          q -= 0.12; tryOnce()
        }, 'image/jpeg', q)
      }
      tryOnce()
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')) }
    img.src = url
  })
}

/* ═══════════════════ 背景音乐播放器（网易云 · M1–M7） ═══════════════════
   经 Supabase 边缘函数 sxq-netease 访问网易云音乐：前端不直连，规避跨域与签名。
   登录方式：扫码 / 手机验证码（二选一）。
   曲库：全部来自网易云（推荐歌单 / 榜单 / 搜索 / 我的歌单），本地不预设任何曲目。
   ═══════════════════════════════════════════════════════════════════ */

const NETEASE_FN = MAIN_URL + '/functions/v1/sxq-netease'

const MS = {
  cookie: '',
  profile: null,
  expired: false,
  queue: [],       // 播放队列
  queueName: '',
  idx: 0,
  audio: null,
  playing: false,
  tab: 'rec',
  cache: {},       // 各 tab 列表缓存
  qrTimer: null,
  volume: 0.6,
}

async function nc (action, params) {
  const r = await fetch(NETEASE_FN, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: MAIN_ANON,
      Authorization: 'Bearer ' + MAIN_ANON,
    },
    body: JSON.stringify({ action, params: params || {}, cookie: MS.cookie }),
  })
  const j = await r.json().catch(() => null)
  if (!j || !j.ok) throw new Error((j && j.error) || ('音乐服务异常 HTTP ' + r.status))
  if (j.cookie && /MUSIC_U=/.test(j.cookie)) { MS.cookie = j.cookie; saveMusicPref() }
  return j.body || {}
}

function saveMusicPref () {
  writeLS('xq_music_v2', { cookie: MS.cookie, volume: MS.volume })
}
function loadMusicPref () {
  const s = readLS('xq_music_v2', {})
  if (s && s.cookie) MS.cookie = s.cookie
  if (s && typeof s.volume === 'number') MS.volume = s.volume
}

const msArtists = (s) => ((s.ar || s.artists || []).map((a) => a.name).join(' / ')) || '未知'
const msDur = (ms) => {
  const t = Math.round((ms || 0) / 1000)
  return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0')
}

async function initMusic () {
  loadMusicPref()
  const a = new Audio()
  a.volume = MS.volume
  a.addEventListener('timeupdate', paintMusicProgress)
  a.addEventListener('ended', () => msNext(1))
  a.addEventListener('waiting', () => { const b = $('#musBar'); if (b) b.classList.add('loading') })
  a.addEventListener('playing', () => { const b = $('#musBar'); if (b) b.classList.remove('loading'); })
  MS.audio = a

  // 校验登录态：**任何失败都保留 cookie**，绝不因为一次网络抖动把用户的登录清掉。
  // 只有网易云明确返回「已登出」才把 profile 置空（cookie 依然留着，便于重试）。
  if (MS.cookie) {
    try {
      const b = await nc('login_status')
      MS.profile = b.profile || null
      MS.expired = !b.profile
    } catch (e) {
      MS.expired = false // 网络问题，不算过期，界面按「已登录但资料未取到」处理
    }
  } else {
    MS.expired = false
  }
  paintMusic()
}

/* ── 侧边栏播放器卡片 ── */
function paintMusic () {
  const box = $('#musicCard'); if (!box) return
  const cur = MS.queue[MS.idx] || null
  const whoHTML = MS.profile
    ? '<div class="mus-who"><span class="mus-ava">' + esc((MS.profile.nickname || '我').slice(0, 1)) + '</span>' +
        '<b>' + esc(MS.profile.nickname || '已登录') + '</b>' +
        '<button class="mus-out" id="musOut" title="退出网易云登录">退出</button></div>'
    : (MS.cookie
      ? '<div class="mus-who"><span class="mus-ava">·</span><b>登录已失效</b>' +
          '<button class="mus-out" id="musOut">重新登录</button></div>'
      : '<div class="muted">登录网易云后可播放完整曲库。</div>')

  box.innerHTML =
    '<div class="sec-title">背景音乐<span class="sec-sub">网易云</span></div>' +
    whoHTML +
    (cur
      ? '<div class="mus-now"><b>' + esc(cur.name) + '</b><span>' + esc(msArtists(cur)) + '</span></div>' +
        '<div class="mus-prog"><div class="mus-bar" id="musBar"></div></div>' +
        '<div class="mus-acts">' +
          '<button class="mc-act" id="musPrev">上一首</button>' +
          '<button class="mc-act ' + (MS.playing ? 'on' : '') + '" id="musToggle">' + (MS.playing ? '暂停' : '播放') + '</button>' +
          '<button class="mc-act" id="musNext">下一首</button>' +
        '</div>'
      : '<div class="muted">' + (MS.queueName ? '《' + esc(MS.queueName) + '》已就绪，点播放开始。' : '还没有选歌，打开音乐库挑一首。') + '</div>') +
    '<div class="mus-vol"><span>音量</span><input type="range" id="musVol" min="0" max="100" value="' + Math.round(MS.volume * 100) + '"></div>' +
    '<button class="btn-mini w100 mt12" id="musOpen">' + (MS.profile ? '打开音乐库' : '登录 / 打开音乐库') + '</button>'

  const t = $('#musToggle'); if (t) t.onclick = () => msToggle()
  const p = $('#musPrev'); if (p) p.onclick = () => msNext(-1)
  const n = $('#musNext'); if (n) n.onclick = () => msNext(1)
  const v = $('#musVol')
  if (v) v.oninput = () => { MS.volume = Number(v.value) / 100; if (MS.audio) MS.audio.volume = MS.volume; saveMusicPref() }
  const o = $('#musOpen'); if (o) o.onclick = openMusic
  const so = $('#musOut')
  if (so) so.onclick = async () => {
    if (MS.profile) {
      if (!confirm('退出网易云登录？（只影响播放器，不影响贤圈中心账号）')) return
      try { await nc('logout') } catch (e) { /* 服务端登出失败也照样清本地 */ }
    }
    MS.cookie = ''; MS.profile = null; MS.expired = false
    MS.queue = []; MS.idx = 0; MS.queueName = ''
    if (MS.audio) { MS.audio.pause(); MS.audio.src = '' }
    MS.playing = false
    document.body.classList.remove('mx-playing')
    saveMusicPref()
    paintMusic()
    toast('已退出网易云登录')
  }
}

function paintMusicProgress () {
  const bar = $('#musBar')
  if (!bar || !MS.audio || !MS.audio.duration) return
  bar.style.width = (MS.audio.currentTime / MS.audio.duration * 100) + '%'
}

/* ── 音乐库弹层 ── */
async function openMusic () {
  const layer = $('#layer')
  layer.hidden = false
  layer.innerHTML = '<div class="sheet" data-sheet><button class="sheet-x" data-close>' + ICON.close + '</button>' +
    '<div class="sheet-h"><h3>音乐库</h3>' +
      (MS.profile ? '<span class="mus-hi">' + esc(MS.profile.nickname || '') + '</span>' : '') + '</div>' +
    '<div class="seg seg-wrap" id="musTabs"></div>' +
    '<div id="musBody" class="mus-body"><div class="sk-line">加载中…</div></div>' +
  '</div>'
  bindSheet()
  if (!MS.profile && MS.cookie) { try { const b = await nc('login_status'); MS.profile = b.profile || null } catch (e) {} }
  paintMusicTabs()
  loadMusicTab(MS.tab)
}

function paintMusicTabs () {
  const el = $('#musTabs'); if (!el) return
  const tabs = [
    ['rec', '推荐歌单'],
    ['top', '排行榜'],
    ['fav', '我的收藏'],
    ['recent', '最近播放'],
    ['radio', '电台'],
    ['search', '搜索'],
    ['import', '导入'],
    ['report', '听歌报告'],
    ['mine', MS.profile ? '我的歌单' : '登录'],
  ]
  el.innerHTML = tabs.map((t) => '<button data-mtab="' + t[0] + '" class="' + (MS.tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>').join('')
  $$('#musTabs [data-mtab]').forEach((b) => {
    b.onclick = () => { MS.tab = b.dataset.mtab; paintMusicTabs(); loadMusicTab(MS.tab) }
  })
}

async function loadMusicTab (tab) {
  const box = $('#musBody'); if (!box) return
  if (tab === 'mine' && !MS.profile) return renderMusicLogin(box)
  if (tab === 'search') return renderMusicSearch(box)

  /* ── 本地数据标签（收藏 / 最近播放 / 导入）── */
  if (tab === 'fav' || tab === 'recent') {
    const list = (tab === 'fav' ? (MS.favs || []) : (window.SXQ_MP && window.SXQ_MP.recent ? window.SXQ_MP.recent() : []))
    if (!list.length) {
      box.innerHTML = '<div class="empty">' +
        (tab === 'fav' ? '还没有收藏。播放时点播放器上的心形按钮即可收藏。' : '还没有播放记录。去推荐歌单里挑一首听听。') +
        '</div>'
      return
    }
    box.innerHTML = '<div class="mus-sec-hd"><b>' + (tab === 'fav' ? '我的收藏' : '最近播放') + '</b><span>' + list.length + ' 首</span>' +
      '<button class="btn-mini" id="musPlayAll">全部播放</button></div>' +
      '<div class="tr-list">' + list.map((s, i) => trRow(s, i)).join('') + '</div>'
    const pa = $('#musPlayAll')
    if (pa) pa.onclick = () => { msSetQueue(list.slice(), tab === 'fav' ? '我的收藏' : '最近播放', 0); msPlay(); toast('开始播放') }
    $$('#musBody .tr-row').forEach((el, i) => {
      el.onclick = () => { msSetQueue(list.slice(), tab === 'fav' ? '我的收藏' : '最近播放', i); msPlay() }
    })
    return
  }

  if (tab === 'import') {
    box.innerHTML =
      '<div class="mus-import">' +
        '<p class="muted" style="margin:0 0 10px;line-height:1.8">把同学发你的「分享歌单」链接或分享码粘进来，就能听同一份歌单。<b>不需要登录。</b></p>' +
        '<input class="mp-imp-in" id="musImpIn" type="text" placeholder="粘贴链接或分享码，回车导入">' +
        '<div class="mus-import-acts">' +
          '<button class="btn-mini" id="musImpClip">从剪贴板读取</button>' +
          '<button class="btn-mini" id="musImpGo">导入</button>' +
        '</div>' +
        '<p class="muted" style="margin:14px 0 0;line-height:1.8;font-size:12px">' +
          '<b>三种都能粘：</b><br>' +
          '· 同学分享的链接或分享码 → 直接导入<br>' +
          '· 网易云歌单链接（含 id=数字）→ 直接导入<br>' +
          '· QQ 音乐 / 酷狗歌单链接 → 会明确提示暂不支持' +
        '</p>' +
        '<p class="muted" style="margin:12px 0 0;line-height:1.8;font-size:12px">' +
          '外部歌单链接单独粘在这里也可以：' +
        '</p>' +
        '<div class="mus-import-acts" style="margin-top:8px">' +
          '<input class="mp-imp-in" data-role="extin" type="text" placeholder="粘贴网易云歌单链接">' +
          '<button class="btn-mini" data-act="extimp">导入外部歌单</button>' +
        '</div>' +
      '</div>'
    const inp = $('#musImpIn')
    const go = () => {
      if (!window.SXQ_MP || !window.SXQ_MP.importFrom) return
      window.SXQ_MP.importFrom(inp ? inp.value : '')
    }
    if ($('#musImpGo')) $('#musImpGo').onclick = go
    if ($('#musImpClip')) $('#musImpClip').onclick = () => {
      if (window.SXQ_MP && window.SXQ_MP.importFromClipboard) window.SXQ_MP.importFromClipboard()
    }
    if (inp) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go() } })
    return
  }

  if (tab === 'report') {
    box.innerHTML = (window.SXQ_MP && window.SXQ_MP.report)
      ? window.SXQ_MP.report()
      : '<div class="empty">报告还没准备好</div>'
    return
  }

  if (tab === 'radio') {
    // 本地电台：把收藏 + 最近播放混在一起随机洗，做成"不会重复的无限流"
    const fav = MS.favs || []
    const rec = (window.SXQ_MP && window.SXQ_MP.recent) ? window.SXQ_MP.recent() : []
    const pool = []
    const seen = {}
    fav.concat(rec).forEach((s) => { const k = String(s.id); if (!seen[k]) { seen[k] = 1; pool.push(s) } })
    if (!pool.length) {
      box.innerHTML = '<div class="empty">电台需要一些底料。<br>先去收藏几首、或听几首，再回来开电台。</div>'
      return
    }
    box.innerHTML = '<div class="mus-sec-hd"><b>我的电台</b><span>基于你的收藏与播放记录</span>' +
      '<button class="btn-mini" id="radioGo">开始播放</button></div>' +
      '<div class="tr-list">' + pool.map((s, i) => trRow(s, i)).join('') + '</div>'
    const start = () => {
      const shuffled = pool.slice()
      for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = t }
      msSetQueue(shuffled, '我的电台', 0); msPlay(); toast('电台开始，随机播放 ' + shuffled.length + ' 首')
    }
    if ($('#radioGo')) $('#radioGo').onclick = start
    $$('#musBody .tr-row').forEach((el, i) => { el.onclick = () => { msSetQueue(pool.slice(), '我的电台', i); msPlay() } })
    return
  }

  box.innerHTML = '<div class="sk-line">加载中…</div>'
  try {
    if (tab === 'rec') {
      let list = MS.cache.rec
      if (!list) { const b = await nc('personalized', { limit: 12 }); list = b.result || []; MS.cache.rec = list }
      box.innerHTML = '<div class="pl-grid">' + list.map((p) => plCard(p)).join('') + '</div>'
    } else if (tab === 'top') {
      let list = MS.cache.top
      if (!list) { const b = await nc('toplist'); list = b.list || []; MS.cache.top = list }
      box.innerHTML = '<div class="pl-grid">' + list.map((p) => plCard(p, true)).join('') + '</div>'
    } else if (tab === 'mine') {
      const b = await nc('user_playlist', { uid: MS.profile.userId })
      const list = b.playlist || []
      box.innerHTML = list.length
        ? '<div class="pl-grid">' + list.map((p) => plCard(p)).join('') + '</div>'
        : '<div class="empty">你的歌单是空的</div>'
    }
    bindPlCards()
  } catch (e) {
    box.innerHTML = '<div class="empty">加载失败：' + esc(e.message) + '</div>'
  }
}

/* 歌单卡片：加厚信息（歌曲数 / 播放量 / 创建者 / 悬停预览前几首） */
function plCard (p, isTop) {
  const cover = p.picUrl || p.coverImgUrl || ''
  const id = p.id
  const name = p.name || '未命名歌单'
  const cnt = p.trackCount ? p.trackCount + ' 首' : ''
  const play = p.playCount ? (p.playCount >= 10000 ? Math.round(p.playCount / 10000) + ' 万' : p.playCount) : ''
  const by = (p.creator && (p.creator.nickname || p.creator.name)) || p.copywriter || ''
  const tag = isTop ? (p.updateFrequency || '榜单') : ''
  const meta = [tag, cnt, play ? play + '播放' : ''].filter(Boolean).join(' · ')
  return '<div class="pl-card" data-plid="' + esc(id) + '" data-plname="' + esc(name) + '" data-plcover="' + esc(cover) + '">' +
    '<div class="pl-cover">' +
      (cover ? '<img src="' + esc(cover) + '" loading="lazy" alt="">' : '<span>歌单</span>') +
      (play ? '<i class="pl-badge">' + esc(play) + '</i>' : '') +
      '<span class="pl-play" aria-hidden="true"><svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M8 5l11 7-11 7z"/></svg></span>' +
    '</div>' +
    '<div class="pl-name">' + esc(name) + '</div>' +
    '<div class="pl-sub">' + esc(meta || '歌单') + '</div>' +
    (by ? '<div class="pl-by">' + esc(by) + '</div>' : '') +
  '</div>'
}

function bindPlCards () {
  $$('#musBody [data-plid]').forEach((el) => {
    el.onclick = () => openPlaylist(el.dataset.plid, el.dataset.plname)
  })
}

async function openPlaylist (id, name) {
  const box = $('#musBody'); if (!box) return
  box.innerHTML = '<div class="sk-line">载入歌单…</div>'
  try {
    const b = await nc('playlist_detail', { id })
    const pl = b.playlist || {}
    const tracks = pl.tracks || []
    if (!tracks.length) { box.innerHTML = '<div class="empty">这个歌单没有可播放的曲目</div>'; return }
    box.innerHTML = '<button class="btn-mini" id="plBack">← 返回列表</button>' +
      '<div class="pl-head"><b>' + esc(pl.name || name) + '</b><span>' + tracks.length + ' 首</span></div>' +
      '<div class="tr-list">' + tracks.map((s, i) => trRow(s, i)).join('') + '</div>'
    $('#plBack').onclick = () => loadMusicTab(MS.tab)
    $$('#musBody [data-tridx]').forEach((el) => {
      el.onclick = () => { msSetQueue(tracks, pl.name || name, Number(el.dataset.tridx)); msPlay() }
    })
  } catch (e) {
    box.innerHTML = '<div class="empty">歌单加载失败：' + esc(e.message) + '</div>'
  }
}

function trRow (s, i) {
  const cur = MS.queue[MS.idx] && MS.queue[MS.idx].id === s.id
  return '<div class="tr-row' + (cur ? ' on' : '') + '" data-tridx="' + i + '">' +
    '<span class="tr-no">' + (i + 1) + '</span>' +
    '<div class="tr-info"><b>' + esc(s.name) + '</b><span>' + esc(msArtists(s)) + '</span></div>' +
    '<span class="tr-dur">' + msDur(s.dt || s.duration) + '</span>' +
  '</div>'
}

function renderMusicSearch (box) {
  box.innerHTML = '<div class="search-bar"><input class="ipt" id="musSearchIpt" placeholder="搜索歌曲 / 歌手，回车搜索"></div>' +
    '<div id="musSearchRes"><div class="muted">输入关键词后回车</div></div>'
  const ipt = $('#musSearchIpt')
  ipt.focus()
  const go = async () => {
    const kw = ipt.value.trim(); if (!kw) return
    const res = $('#musSearchRes')
    res.innerHTML = '<div class="sk-line">搜索中…</div>'
    try {
      const b = await nc('search', { keywords: kw, limit: 30 })
      const songs = (b.result && b.result.songs) || []
      if (!songs.length) { res.innerHTML = '<div class="empty">没有找到相关歌曲</div>'; return }
      res.innerHTML = '<div class="tr-list">' + songs.map((s, i) => trRow(s, i)).join('') + '</div>'
      $$('#musSearchRes [data-tridx]').forEach((el) => {
        el.onclick = () => { msSetQueue(songs, '搜索：' + kw, Number(el.dataset.tridx)); msPlay() }
      })
    } catch (e) { res.innerHTML = '<div class="empty">搜索失败：' + esc(e.message) + '</div>' }
  }
  ipt.onkeydown = (e) => { if (e.key === 'Enter') go() }
}

/* ── 登录（扫码 / 手机验证码） ── */
function renderMusicLogin (box) {
  box.innerHTML =
    '<div class="ml-box">' +
      '<div class="ml-title">登录网易云音乐</div>' +
      '<p class="ml-sub">登录后即可播放完整曲库。尚贤圈不会保存你的账号密码，只保存网易云返回的登录凭据（存于本机浏览器）。</p>' +
      '<div class="seg"><button id="mlQr" class="on">扫码登录</button><button id="mlPhone">手机验证码</button></div>' +
      '<div id="mlBody"></div>' +
    '</div>'
  $('#mlQr').onclick = () => { $('#mlQr').classList.add('on'); $('#mlPhone').classList.remove('on'); showQrLogin() }
  $('#mlPhone').onclick = () => { $('#mlPhone').classList.add('on'); $('#mlQr').classList.remove('on'); showPhoneLogin() }
  showQrLogin()
}

function showQrLogin () {
  const box = $('#mlBody'); if (!box) return
  clearInterval(MS.qrTimer)
  box.innerHTML = '<div class="qr-wrap"><div class="qr-img" id="qrImg"></div>' +
    '<div class="qr-state" id="qrState">正在获取二维码…</div>' +
    '<button class="btn-mini mt12" id="qrRefresh">刷新二维码</button></div>'
  $('#qrRefresh').onclick = () => showQrLogin()

  nc('qr_key').then((b) => {
    const unikey = b.unikey
    if (!unikey) throw new Error('未获取到登录码')
    const el = $('#qrImg'); if (!el) return
    el.innerHTML = ''
    try {
      new QRCode(el, { text: 'https://music.163.com/login?codekey=' + unikey, width: 176, height: 176, correctLevel: QRCode.CorrectLevel.M })
    } catch (e) { el.textContent = '二维码渲染失败，请改用手机验证码' }

    const st = $('#qrState')
    st.textContent = '请用「网易云音乐」App 扫码'
    let done = false
    const started = Date.now()

    MS.qrTimer = setInterval(async () => {
      if (done) return
      const s = $('#qrState'); if (!s) { clearInterval(MS.qrTimer); return }
      if (Date.now() - started > 120000) { done = true; clearInterval(MS.qrTimer); s.textContent = '二维码已过期，请点「刷新二维码」'; return }
      try {
        const c = await nc('qr_check', { key: unikey })
        if (c.code === 800) { done = true; clearInterval(MS.qrTimer); s.textContent = '二维码已过期，请点「刷新二维码」' }
        else if (c.code === 801) s.textContent = '请用「网易云音乐」App 扫码'
        else if (c.code === 802) s.textContent = '已扫码，请在手机上点「确认登录」'
        else if (c.code === 803) {
          done = true
          clearInterval(MS.qrTimer)
          s.textContent = '已确认，正在同步登录状态…'
          await afterMusicLogin()
        }
      } catch (e) { /* 单次失败不中断轮询 */ }
    }, 1500)
  }).catch((e) => { const s = $('#qrState'); if (s) s.textContent = '获取失败：' + e.message + '（可改用手机验证码）' })
}

function showPhoneLogin () {
  const box = $('#mlBody'); if (!box) return
  clearInterval(MS.qrTimer)
  box.innerHTML =
    '<input class="ipt" id="mlPhoneIpt" inputmode="numeric" maxlength="11" placeholder="手机号">' +
    '<div class="ml-row"><input class="ipt" id="mlCodeIpt" inputmode="numeric" maxlength="6" placeholder="短信验证码（4 位）">' +
      '<button class="btn-mini" id="mlSend">发送验证码</button></div>' +
    '<button class="btn-primary w100" id="mlDo">登录</button>' +
    '<div class="ml-hint" id="mlHint"></div>'
  const hint = (t, ok) => { const h = $('#mlHint'); if (h) { h.textContent = t; h.style.color = ok ? 'var(--green)' : 'var(--red)' } }
  $('#mlSend').onclick = async (e) => {
    const phone = $('#mlPhoneIpt').value.trim()
    if (!/^\d{11}$/.test(phone)) return hint('请输入 11 位手机号')
    e.target.disabled = true
    try { await nc('captcha_sent', { phone }); hint('验证码已发送，请查收短信', true) }
    catch (err) { hint('发送失败：' + err.message) }
    e.target.disabled = false
  }
  $('#mlDo').onclick = async (e) => {
    const phone = $('#mlPhoneIpt').value.trim()
    const captcha = $('#mlCodeIpt').value.trim()
    if (!/^\d{11}$/.test(phone)) return hint('请输入 11 位手机号')
    if (!captcha) return hint('请输入验证码')
    e.target.disabled = true
    try { await nc('login_cellphone', { phone, captcha }); hint('登录成功，正在加载…', true); await afterMusicLogin() }
    catch (err) { hint('登录失败：' + err.message) }
    e.target.disabled = false
  }
}

async function afterMusicLogin () {
  let ok = false
  try {
    const b = await nc('login_status')
    MS.profile = b.profile || null
    ok = !!MS.profile
  } catch (e) { MS.profile = null }
  MS.expired = !ok
  saveMusicPref()
  paintMusic()
  if (!ok) {
    const s = $('#qrState')
    if (s) s.textContent = '登录凭据未同步成功，请重新扫码或改用手机验证码'
    const h = $('#mlHint')
    if (h) { h.textContent = '登录未完成：网易云没有返回有效凭据，请再试一次（或改用手机验证码）。'; h.style.color = 'var(--red)' }
    toast('登录未完成，请重试')
    return false
  }
  MS.cache = {}
  paintMusicTabs()
  MS.tab = 'mine'
  paintMusicTabs()
  loadMusicTab('mine')
  toast('已登录网易云：' + (MS.profile.nickname || ''))
  return true
}

/* ── 播放控制 ── */
function msSetQueue (tracks, name, idx) {
  MS.queue = tracks
  MS.queueName = name || ''
  MS.idx = Math.max(0, Math.min(idx || 0, tracks.length - 1))
}
async function msPlay () {
  const s = MS.queue[MS.idx]
  if (!s || !MS.audio) return
  try {
    const b = await nc('song_url', { id: s.id, level: 'standard' })
    const u = b.data && b.data[0]
    if (!u || !u.url) {
      toast('这首歌暂时拿不到播放地址（可能需要会员或无版权），已跳到下一首')
      return msNext(1)
    }
    MS.audio.src = u.url
    await MS.audio.play().catch(() => {})
    MS.playing = true
    document.body.classList.add('mx-playing')
    paintMusic()
    toast('正在播放：' + s.name)
  } catch (e) { toast('播放失败：' + e.message) }
}
function msToggle () {
  if (!MS.audio) return
  if (MS.playing) { MS.audio.pause(); MS.playing = false; document.body.classList.remove('mx-playing') }
  else { MS.audio.play().catch(() => {}); MS.playing = true; document.body.classList.add('mx-playing') }
  paintMusic()
}
function msNext (d) {
  if (!MS.queue.length) return
  MS.idx = (MS.idx + d + MS.queue.length) % MS.queue.length
  msPlay()
}

/* ═══════════════════ 导航事件（全局委托） ═══════════════════ */
function bindGlobal () {
  document.addEventListener('click', (e) => {
    const t = e.target
    // ① 统一动作（开关 / 删除 / 试提醒 / 退出）——委托，不怕 DOM 重绘
    const actEl = t.closest && t.closest('[data-act]')
    if (actEl && actEl.dataset.act) { handleMeAct(actEl, e); return }
    // ② 路由
    const navEl = t.closest && t.closest('[data-nav]')
    if (navEl) { nav(navEl.dataset.nav); if (window.innerWidth < 860) closeDrawer(); return }
    if (t.closest && t.closest('#burger')) { toggleDrawer(); return }
    if (t.id === 'drawerMask') { closeDrawer(); return }
    if (t.closest && t.closest('.drawer a')) { closeDrawer(); return }
  })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeLayer(); closeAuth() } })

  // 发布入口：按当前所在页决定发布类型
  const pickKind = () => S.route === 'market' ? 'market' : S.route === 'lost' ? 'lost' : S.route === 'ask' ? 'question' : 'moment'
  const doPublish = () => { if (!S.me) return openAuth(); openCompose(pickKind()) }
  const fab = $('#fab'); if (fab) fab.onclick = doPublish
  const tp = $('#tabPlus'); if (tp) tp.onclick = doPublish
  const sp = $('#sidePublish'); if (sp) sp.onclick = doPublish

  const v = 'v' + (window.SXQ_VER || '1.0.21')
  const ver = $('#ftVer'); if (ver) ver.textContent = v
  const ver2 = $('#sideVer'); if (ver2) ver2.textContent = v
}

function toggleDrawer () {
  const d = $('#drawer'); if (!d) return
  const open = d.hidden
  d.hidden = !open
  $('#drawerMask').hidden = !open
  $('#burger').classList.toggle('open', open)
}
function closeDrawer () {
  const d = $('#drawer'); if (d) d.hidden = true
  const m = $('#drawerMask'); if (m) m.hidden = true
  const b = $('#burger'); if (b) b.classList.remove('open')
}

/* ═══════════════════ 初始化 ═══════════════════ */
async function boot () {
  // ① 先把骨架渲染出来。任何一步失败都不允许出现「整页空白」——
  //    之前的写法是 await loadMe() 之后才 render()，OAuth 回调时
  //    getSession() 抛错会让 boot 整个中断，页面就空白了（点一下 tab 才恢复）。
  // ① 先把监听挂上。bindAuth 万一抛异常，绝不能连累 bindGlobal
  //    （之前所有 [data-act] 按钮点不动，就是这个顺序被打断的表现）
  try { bindAuth() } catch (e) { console.warn('bindAuth 失败', e) }
  try { bindGlobal() } catch (e) { console.warn('bindGlobal 失败', e) }
  // 通知偏好本地恢复
  try {
    const pref = readLS('xq_notif_pref', {})
    S.routineOn = pref.routineOn !== false
    S.routineHalf = !!pref.routineHalf
    S.notifOn = !!pref.desktop && ('Notification' in window) && Notification.permission === 'granted'
  } catch (e) {}

  const hash = String(location.hash || '').replace('#', '')
  S.route = ROUTES.includes(hash) ? hash : 'feed'
  safeRender()   // 立刻给用户看到内容

  // ② 身份就绪后再渲染一次（登录态会改变广场/我的的呈现）
  try { await loadMe() } catch (e) { S.me = null; try { renderHeader() } catch (e2) {} }
  safeRender()

  // ③ 其余增强能力互不阻塞，各自兜错
  try { await initMusic(); paintMusic() } catch (e) {}
  try { startUnreadPoll() } catch (e) {}
  try { startRoutineNotify() } catch (e) {}
  try { startFeedWatch() } catch (e) {}
  try { initInstallPrompt() } catch (e) {}
  try { initKeyboardFix() } catch (e) {}
  try { initIosInstallGuide() } catch (e) {}
  try {
    sbAuth.auth.onAuthStateChange((evt) => {
      if (evt !== 'SIGNED_IN' && evt !== 'SIGNED_OUT') return
      setTimeout(async () => {
        try { await loadMe() } catch (e) { S.me = null }
        safeRender()
      }, 0)
    })
  } catch (e) {}

  // ④ 兜底：若 3 秒后主区域仍是空的（任何未知异常），强制再渲染一次
  setTimeout(() => {
    const m = $('#main')
    if (m && !m.innerHTML.trim()) safeRender()
  }, 3000)
}

/* 渲染兜底：绝不让异常冒泡成空白页 */
function safeRender () {
  try { render() } catch (e) {
    const m = $('#main')
    if (m && !m.innerHTML.trim()) {
      m.innerHTML = '<div class="bento"><div class="cell c-full"><div class="card">' +
        '<div class="sec-title">页面加载出了点问题</div>' +
        '<div class="muted">请刷新页面重试。若反复出现，请把下面这条信息发给官方：</div>' +
        '<div class="err-box">' + esc(String((e && e.message) || e)) + '</div>' +
        '<button class="btn-mini w100 mt12" onclick="location.reload()">刷新页面</button>' +
        '</div></div></div>'
    }
  }
}

document.addEventListener('DOMContentLoaded', boot)
