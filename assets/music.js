/*! 尚贤圈 · 音乐播放器增强层（music.js）
 *  ── 依赖 app.js 已定义的：MS / nc / msPlay / msNext / msToggle / msSetQueue
 *                          msDur / msArtists / esc / toast / $ / readLS / writeLS
 *  ── 本轮新增（2026-09-26）：
 *     ① 底部迷你播放条（全站常驻，可展开）
 *     ② 全屏播放页：封面三种样式可切 / 标签切「歌曲·歌词·歌单」/ 滚动词词 + 点击跳进度
 *     ③ 可拖动进度条、四种循环模式、音质三档、音量
 *     ④ MediaSession：锁屏与通知栏封面/歌名/切歌、耳机按键
 *     ⑤ 恢复全部进度（队列/第几首/播放位置/音量/循环/音质/封面样式）
 *     ⑥ 收藏（本地）
 *     ⑦ 睡眠定时
 *     ⑧ cookie 过期提示 + 一键重登
 *
 *  设计参考：QQ 音乐（卡片式、封面居中、操作在底部、辅助功能用空心线型图标、
 *            播放键用实心图标、左右滑或标签切页、点歌词跳进度）；
 *  刻意不学酷狗的四方向手势堆叠（信息杂、易误操作）。
 */
(function () {
  'use strict'
  if (typeof MS === 'undefined') return

  var LSKEY = 'xq_music_v3'
  var LYR = { id: '', lines: [], at: [] }

  /* ═══════════ 0. 全局错误暴露 ═══════════
     用户反馈「所有新功能点不了」——那通常不是按钮坏了，而是**某处抛了异常
     把整条链打断了**。这里把任何未捕获错误直接显示出来，绝不让它静默。 */
  function showErr (msg) {
    try {
      var el = document.getElementById('mpErr')
      if (!el) {
        el = document.createElement('div')
        el.id = 'mpErr'
        el.className = 'mp-err'
        document.body.appendChild(el)
      }
      el.textContent = '播放器出错：' + String(msg).slice(0, 120)
      el.classList.add('on')
      clearTimeout(showErr._t)
      showErr._t = setTimeout(function () { el.classList.remove('on') }, 9000)
    } catch (e) {}
  }
  window.addEventListener('error', function (e) {
    // 只报与播放器相关的脚本错误，避免噪音
    var src = (e.filename || '')
    if (/music\.js|liquid-glass\.js/.test(src) || /is not defined|is not a function|Cannot read/.test(e.message || '')) {
      showErr(e.message)
    }
  })
  window.addEventListener('unhandledrejection', function (e) {
    var m = (e.reason && (e.reason.message || e.reason)) || ''
    if (/music|播放|audio/i.test(String(m))) showErr(m)
  })

  /* 封面样式：六种（对齐 QQ 音乐的做法，并把细节做精） */
  var COVER_STYLES = [
    { k: 'vinyl', n: '黑胶浅' },
    { k: 'vinyl-dark', n: '黑胶深' },
    { k: 'rotate', n: '旋转圆形' },
    { k: 'circle', n: '静态圆形' },
    { k: 'square', n: '方形封面' },
    { k: 'artist', n: '歌手写真' }
  ]
  var LOOPS = [
    { k: 'order', n: '顺序播放' },
    { k: 'list', n: '列表循环' },
    { k: 'one', n: '单曲循环' },
    { k: 'shuffle', n: '随机播放' }
  ]
  var QUALITY = [
    { k: 'standard', n: '标准' },
    { k: 'higher', n: '较高' },
    { k: 'exhigh', n: '极高' }
  ]
  var THEMES = [
    { k: 'default', n: '默认' },
    { k: 'eye', n: '护眼' },
    { k: 'dark', n: '深色' }
  ]
  var FSS = [
    { k: 0.9, n: '小' },
    { k: 1, n: '中' },
    { k: 1.12, n: '大' },
    { k: 1.25, n: '特大' }
  ]

  /* 播放页背景：多套可切（覆盖你提的「动态/静态/渐变/平铺 + 歌手写真」） */
  var BGS = [
    { k: 'gradient', n: '封面渐变' },
    { k: 'static', n: '封面主色' },
    { k: 'tile', n: '封面平铺' },
    { k: 'artist', n: '歌手写真' },
    { k: 'dynamic', n: '动态流动' }
  ]

  /* 低端设备自动降级
     ⚠️ 阈值不能太激进：之前用 deviceMemory<=4 / cores<=4，
     普通电脑也会被误判成低端（用户反馈背景选项少了两项、唱片不转了）。
     现在收紧到 <=2，且**低端模式也不关闭唱片旋转**（那点动画不耗性能）。 */
  var LITE = (function () {
    var mem = navigator.deviceMemory || 0
    var cores = navigator.hardwareConcurrency || 0
    var m = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    return m || (mem && mem <= 2) || (cores && cores <= 2)
  })()
  if (LITE) document.documentElement.classList.add('mp-lite')

  /* ── 预处理：补齐状态字段 ── */
  MS.loop = MS.loop || 'list'
  MS.quality = MS.quality || 'higher'
  MS.cover = MS.cover || 'vinyl'
  MS.favs = MS.favs || []          // [{id,name,ar,dt,al}]
  MS.sleepAt = 0                   // 睡眠定时到期时间戳
  MS.lastTime = 0                  // 上次播放位置
  MS.recent = MS.recent || []      // 最近播放（本地，最多 50 首）
  MS.lySize = MS.lySize || 15.5    // 歌词字号
  MS.lyTrans = !!MS.lyTrans        // 歌词翻译开关
  MS.deskLy = !!MS.deskLy          // 桌面歌词开关
  MS.fx = 'flat'                   // 音效已停用：强制回原声，清掉历史上选过的值
  MS.plays = MS.plays || {}        // { trackId: 次数 } 用于听歌报告
  MS.artistCount = MS.artistCount || {}  // { 歌手: 次数 }
  MS.nightPlays = MS.nightPlays || 0     // 深夜播放次数（23:00–05:00）
  MS.karaoke = MS.karaoke !== false      // 逐字高亮（卡拉OK）默认开
  MS.theme = MS.theme || 'default'       // default | eye | dark
  MS.fontScale = MS.fontScale || 1       // 字号倍率 0.9 / 1 / 1.12 / 1.25
  MS.daily = MS.daily || null            // { date, songs } 每日推荐缓存

  var $q = function (s, r) { return (r || document).querySelector(s) }
  var $$q = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)) }
  var track = function () { return (MS.queue && MS.queue[MS.idx]) || null }
  var cover = function (t) {
    if (!t) return ''
    return (t.al && (t.al.picUrl || t.al.picUrl_str)) || (t.picUrl || '') || ''
  }
  var esc2 = function (s) { return (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s)) }
  var isFav = function (id) { return MS.favs.some(function (x) { return String(x.id) === String(id) }) }
  /* 歌手写真：取第一位歌手的图（网易云部分接口会带 picUrl / img1v1Url） */
  function artistPicOf (t) {
    try {
      var a = (t && t.ar && t.ar[0]) || null
      if (!a) return ''
      return a.picUrl || a.img1v1Url || (a.img1v1 && a.img1v1.url) || ''
    } catch (e) { return '' }
  }

  /* ═══════════ 1. 持久化：保存/恢复全部播放状态 ═══════════ */
  function saveAll () {
    var a = MS.audio
    try {
      writeLS(LSKEY, {
        cookie: MS.cookie,
        volume: MS.volume,
        loop: MS.loop,
        quality: MS.quality,
        cover: MS.cover,
        queue: (MS.queue || []).slice(0, 200),
        queueName: MS.queueName,
        idx: MS.idx,
        time: a ? a.currentTime : 0,
        rate: MS.rate || 1,
        bg: MS.bg || 'gradient',
        recent: (MS.recent || []).slice(0, 50),
        lySize: MS.lySize, lyTrans: MS.lyTrans, deskLy: MS.deskLy, fx: MS.fx,
        karaoke: MS.karaoke, theme: MS.theme, fontScale: MS.fontScale,
        plays: MS.plays, artistCount: MS.artistCount, nightPlays: MS.nightPlays,
        favs: MS.favs
      })
    } catch (e) {}
  }
  function restoreAll () {
    var s = readLS(LSKEY, null)
    if (!s) return
    if (s.cookie) MS.cookie = s.cookie
    if (typeof s.volume === 'number') MS.volume = s.volume
    if (s.loop) MS.loop = s.loop
    if (s.quality) MS.quality = s.quality
    if (s.cover) MS.cover = s.cover
    if (s.rate) MS.rate = s.rate
    if (s.bg) MS.bg = s.bg
    if (s.recent) MS.recent = s.recent
    if (s.lySize) MS.lySize = s.lySize
    if (s.lyTrans) MS.lyTrans = s.lyTrans
    if (s.deskLy) MS.deskLy = s.deskLy
    if (s.fx) MS.fx = s.fx
    if (s.karaoke === false) MS.karaoke = false
    if (s.theme) MS.theme = s.theme
    if (s.fontScale) MS.fontScale = s.fontScale
    if (s.plays) MS.plays = s.plays
    if (s.artistCount) MS.artistCount = s.artistCount
    if (s.nightPlays) MS.nightPlays = s.nightPlays
    if (s.favs) MS.favs = s.favs
    if (s.queue && s.queue.length) {
      MS.queue = s.queue
      MS.queueName = s.queueName || ''
      MS.idx = Math.min(s.idx || 0, s.queue.length - 1)
      MS.lastTime = s.time || 0
      MS.resume = true            // 标个位，首次播放时跳到上次位置
    }
  }
  // 接管原有保存函数，让 cookie/音量之外的状态也一起写进去
  var _save = window.saveMusicPref
  window.saveMusicPref = function () { try { if (_save) _save() } catch (e) {} saveAll() }
  restoreAll()

  /* ═══════════ 2. 构建界面（迷你条 + 全屏页） ═══════════ */
  function buildUI () {
    if ($q('.mp-bar')) return

    var bar = document.createElement('div')
    bar.className = 'mp-bar'
    bar.innerHTML =
      '<div class="mp-bg"></div>' +
      '<div class="mp-cover" data-act="expand"><span class="mp-cover-ph">贤</span></div>' +
      '<div class="mp-meta" data-act="expand">' +
        '<b class="mp-name">未在播放</b><span class="mp-artist">选一首歌开始</span>' +
        '<div class="mp-track" data-seek="1"><i class="mp-fill"></i></div>' +
      '</div>' +
      '<div class="mp-time"><span class="mp-cur">0:00</span><span class="mp-sep">/</span><span class="mp-dur">0:00</span></div>' +
      '<div class="mp-acts">' +
        '<button class="mp-btn" data-act="loop" title="循环模式"></button>' +
        '<button class="mp-btn" data-act="prev" title="上一首">' + svg('prev') + '</button>' +
        '<button class="mp-btn mp-play" data-act="toggle" title="播放 / 暂停">' + svg('play') + '</button>' +
        '<button class="mp-btn" data-act="next" title="下一首">' + svg('next') + '</button>' +
        '<button class="mp-btn" data-act="fav" title="收藏">' + svg('heart') + '</button>' +
        '<button class="mp-btn" data-act="list" title="播放列表">' + svg('list') + '</button>' +
        '<button class="mp-btn mp-vol-toggle" data-act="vol" title="音量">' + svg('vol') + '</button>' +
        '<input class="mp-vol" type="range" min="0" max="100" value="' + Math.round(MS.volume * 100) + '">' +
      '</div>'

    var full = document.createElement('div')
    full.className = 'mp-full'
    full.innerHTML =
      '<div class="mp-full-bg"></div>' +
      '<div class="mp-full-in">' +
        '<div class="mp-full-hd">' +
          '<button class="mp-x" data-act="collapse" aria-label="收起">' + svg('down') + '</button>' +
          '<div class="mp-ftitle"><b></b><span></span></div>' +
          '<div class="mp-styles" data-role="styles"></div>' +
        '</div>' +
        '<div class="mp-full-body">' +
          '<div class="mp-stage" data-act="cycleCover">' +
            '<div class="mp-tonearm" aria-hidden="true"><i></i></div>' +
            '<div class="mp-disc">' +
              '<div class="mp-grooves" aria-hidden="true"></div>' +
              '<div class="mp-disc-art"></div>' +
              '<div class="mp-spindle" aria-hidden="true"></div>' +
            '</div>' +
            '<div class="mp-art"></div>' +
          '</div>' +
          '<div class="mp-panel">' +
            '<div class="mp-tabs" data-role="tabs">' +
              '<button class="on" data-tab="song">歌曲</button>' +
              '<button data-tab="lyric">歌词</button>' +
              '<button data-tab="queue">歌单</button>' +
              '<button data-tab="cmt">评论</button>' +
            '</div>' +
            '<div class="mp-tabbody">' +
              '<div class="mp-pane on" data-pane="song">' +
                '<div class="mp-now"><b></b><span></span></div>' +
                '<div class="mp-tools" data-role="quality"></div>' +
                '<div class="mp-tools" data-role="sleep"></div>' +
                '<div class="mp-tools" data-role="bg"></div>' +
                '<div class="mp-tools" data-role="speed"></div>' +
                '<div class="mp-tools" data-role="fx"></div>' +
                '<div class="mp-tools" data-role="theme"></div>' +
                '<div class="mp-tools mp-tools-feed">' +
                  '<button data-act="daily">每日推荐</button>' +
                  '<button data-act="fm">私人 FM</button>' +
                  '<button data-act="poster">歌词海报</button>' +
                '</div>' +
                '<div class="mp-tools" data-role="together"></div>' +
                '<div data-role="room"></div>' +
              '</div>' +
              '<div class="mp-pane" data-pane="lyric">' +
                '<div class="mp-lytools" data-role="lytools"></div>' +
                '<div class="mp-lyric" data-role="lyric">暂无歌词</div>' +
              '</div>' +
              '<div class="mp-pane" data-pane="queue"><div class="mp-queue" data-role="queue"></div></div>' +
              '<div class="mp-pane" data-pane="cmt">' +
                '<div class="mp-cmt-form">' +
                  '<input class="mp-cmt-in" data-role="cmtin" type="text" maxlength="200" placeholder="说点什么…（200 字内）">' +
                  '<button class="mp-cmt-send" data-act="cmtsend">发送</button>' +
                '</div>' +
                '<div class="mp-cmt-list" data-role="cmtlist"><div class="mp-empty">点这里看这首歌的评论</div></div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="mp-full-ft">' +
          '<div class="mp-track mp-track-lg" data-seek="1"><i class="mp-fill"></i></div>' +
          '<div class="mp-times"><span class="mp-cur">0:00</span><span class="mp-dur">0:00</span></div>' +
          '<div class="mp-acts mp-acts-lg">' +
            '<span class="mp-loopwrap">' +
              '<button class="mp-btn" data-act="loop">' + svg('loop') + '</button>' +
              '<em data-role="looptag">列表循环</em>' +
            '</span>' +
            '<button class="mp-btn" data-act="prev">' + svg('prev') + '</button>' +
            '<button class="mp-btn mp-play" data-act="toggle">' + svg('play') + '</button>' +
            '<button class="mp-btn" data-act="next">' + svg('next') + '</button>' +
            '<button class="mp-btn" data-act="fav">' + svg('heart') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>'

    document.body.appendChild(bar)
    document.body.appendChild(full)
  }

  function svg (k) {
    var P = {
      play: '<path d="M8 5l11 7-11 7z" fill="currentColor"/>',
      pause: '<path d="M8 5h3.2v14H8zM12.8 5H16v14h-3.2z" fill="currentColor"/>',
      prev: '<path d="M7 5v14M18 5l-9 7 9 7z"/>',
      next: '<path d="M17 5v14M6 5l9 7-9 7z"/>',
      heart: '<path d="M12 20s-7-4.6-7-9.4A4.1 4.1 0 0112 8a4.1 4.1 0 017 2.6C19 15.4 12 20 12 20z"/>',
      list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
      vol: '<path d="M5 10v4h3l4 3V7L8 10zM16 9.5a4 4 0 010 5M18.5 7a7.5 7.5 0 010 10"/>',
      down: '<path d="M6 9l6 6 6-6"/>',
      loop: '<path d="M17 4l3 3-3 3M20 7H8a4 4 0 000 8h1M7 20l-3-3 3-3M4 17h12a4 4 0 000-8h-1"/>',
      loop1: '<path d="M17 4l3 3-3 3M20 7H8a4 4 0 000 8h1M7 20l-3-3 3-3M4 17h12a4 4 0 000-8h-1M12 10v4"/>',
      shuffle: '<path d="M16 4l4 3-4 3M20 7h-3l-9 10H4M4 7h3l2 2M16 20l4-3-4-3"/>',
      order: '<path d="M4 7h16M4 12h16M4 17h16"/>',
      sleep: '<path d="M12 3a7 7 0 000 14 9 9 0 010-14z"/>'
    }
    return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + (P[k] || '') + '</svg>'
  }

  /* ── 背景：按选择的样式渲染（动态/静态/渐变/平铺/歌手写真） ── */
  function applyBg (cov, t) {
    var full = $q('.mp-full')
    if (!full) return
    var el = $q('.mp-full-bg', full)
    if (!el) return
    var artistPic = ''
    try {
      var ar0 = (t && t.ar && t.ar[0]) || null
      artistPic = (ar0 && (ar0.picUrl || ar0.img1v1Url)) || ''
    } catch (e) {}
    var style = MS.bg || 'gradient'
    if (LITE && (style === 'dynamic' || style === 'tile')) style = 'gradient'   // 低端机降级
    var changed = full.__bg !== style
    full.__bg = style
    full.classList.remove('bg-gradient', 'bg-static', 'bg-tile', 'bg-artist', 'bg-dynamic')
    full.classList.add('bg-' + style)
    // 切换时走一次入场动画，让"切背景"这件事看得见
    if (changed) {
      full.classList.remove('bg-anim')
      void full.offsetWidth                    // 强制重排，动画能重新触发
      full.classList.add('bg-anim')
      clearTimeout(applyBg._t)
      applyBg._t = setTimeout(function () { full.classList.remove('bg-anim') }, 700)
    }
    var src = style === 'artist' ? (artistPic || cov) : cov
    el.style.backgroundImage = src ? 'url("' + src + '")' : 'none'
  }

  /* ── 绘制 ── */
  var curLyric = -1
  var lastTrackId = ''
  /* paint() 包一层 try/catch：任何一处画错都不能让整个播放器停摆
     （用户反馈「所有新功能点不了」，往往就是 paint 里某一行抛异常） */
  function paint () {
    try { paintInner() } catch (e) { showErr((e && e.message) || e) }
  }
  function paintInner () {
    var t = track(), a = MS.audio
    var cov = cover(t)
    var nm = t ? (t.name || '未知曲目') : '未在播放'
    var ar = t ? (msArtists(t) || '') : '选一首歌开始'
    if (!t && MS.queueName) ar = '《' + MS.queueName + '》待播放'

    /* 换歌了：必须重置歌词，否则会一直显示上一首的（用户反馈第 4 条）
       —— 清掉旧歌词，若当前正停在歌词标签则立刻重拉。 */
    if (String(t && t.id || '') !== lastTrackId) {
      lastTrackId = String(t && t.id || '')
      LYR = { id: '', lines: [] }
      curLyric = -1
      var lp = $q('.mp-pane[data-pane="lyric"]')
      if (lp && lp.classList.contains('on')) {
        setTimeout(loadLyric, 0)                 // 正停在歌词标签 → 立刻重拉
      } else {
        var lh = $q('[data-role="lyric"]')
        if (lh) lh.innerHTML = '<div class="mp-empty">点「歌词」标签查看</div>'
      }
      // 评论也跟着换歌：正停在评论标签就重拉，否则清空避免残留
      var cp = $q('.mp-pane[data-pane="cmt"]')
      var ch = $q('[data-role="cmtlist"]')
      if (cp && cp.classList.contains('on')) setTimeout(loadComments, 0)
      else if (ch) ch.innerHTML = '<div class="mp-empty">点「评论」标签查看</div>'
    }

    // 迷你条出现时给主内容留出底部空间
    document.body.classList.toggle('mp-on', !!t)
    var fullEl = $q('.mp-full')
    if (fullEl) document.body.classList.toggle('mp-full-on', fullEl.classList.contains('on'))

    // 迷你条
    var bar = $q('.mp-bar')
    bar.classList.toggle('on', !!t)
    bar.classList.toggle('playing', !!MS.playing)
    $q('.mp-name', bar).textContent = nm
    $q('.mp-artist', bar).textContent = ar
    var cEl = $q('.mp-cover', bar)
    cEl.innerHTML = cov ? '<img src="' + esc2(cov) + '" alt="">' : '<span class="mp-cover-ph">贤</span>'
    var pb = $q('.mp-play', bar)
    pb.innerHTML = MS.playing ? svg('pause') : svg('play')
    var lb = $q('[data-act="loop"]', bar)
    lb.innerHTML = svg(MS.loop === 'one' ? 'loop1' : MS.loop === 'shuffle' ? 'shuffle' : MS.loop === 'order' ? 'order' : 'loop')
    lb.title = (LOOPS.filter(function (x) { return x.k === MS.loop })[0] || LOOPS[1]).n
    var fb = $q('[data-act="fav"]', bar)
    fb.classList.toggle('on', !!(t && isFav(t.id)))

    // 全屏页
    var full = $q('.mp-full')
    $q('.mp-ftitle b', full).textContent = nm
    $q('.mp-ftitle span', full).textContent = ar
    $q('.mp-now b', full).textContent = nm
    $q('.mp-now span', full).textContent = ar
    // 循环按钮：迷你条与全屏页必须同步（之前全屏页那个点了不变，就是这个漏了）
    var loopIcon = MS.loop === 'one' ? 'loop1' : MS.loop === 'shuffle' ? 'shuffle' : MS.loop === 'order' ? 'order' : 'loop'
    var loopName = (LOOPS.filter(function (x) { return x.k === MS.loop })[0] || LOOPS[1]).n
    ;[[bar, '.mp-bar'], [full, '.mp-full']].forEach(function (pair) {
      var host = pair[0]
      var lb2 = $q('[data-act="loop"]', host)
      if (lb2) { lb2.innerHTML = svg(loopIcon); lb2.classList.add('has-label') }
    })
    var loopTag = $q('[data-role="looptag"]', full)
    if (loopTag) loopTag.textContent = loopName
    // 背景
    applyBg(cov, t)
    var fbg = $q('.mp-full-bg', full)
    if (fbg) fbg.dataset.cov = cov || ''
    var d = $q('.mp-disc-art', full), art = $q('.mp-art', full)
    var artSrc = MS.cover === 'artist' ? (artistPicOf(t) || cov) : cov
    if (d) d.style.backgroundImage = cov ? 'url("' + cov + '")' : 'none'
    if (art) art.style.backgroundImage = artSrc ? 'url("' + artSrc + '")' : 'none'
    full.classList.remove('cover-vinyl', 'cover-vinyl-dark', 'cover-rotate', 'cover-circle', 'cover-square', 'cover-artist')
    full.classList.add('cover-' + MS.cover)
    full.classList.toggle('playing', !!MS.playing)
    $q('.mp-full .mp-play', full).innerHTML = MS.playing ? svg('pause') : svg('play')
    $q('.mp-full [data-act="fav"]', full).classList.toggle('on', !!(t && isFav(t.id)))

    // 封面样式按钮
    var st = ''
    COVER_STYLES.forEach(function (s) {
      st += '<button class="' + (MS.cover === s.k ? 'on' : '') + '" data-cover="' + s.k + '">' + s.n + '</button>'
    })
    $q('[data-role="styles"]', full).innerHTML = st
    // 音质
    $q('[data-role="quality"]', full).innerHTML = '<span class="mp-tool-label">音质</span>' +
      QUALITY.map(function (q) { return '<button class="' + (MS.quality === q.k ? 'on' : '') + '" data-quality="' + q.k + '">' + q.n + '</button>' }).join('')
    // 睡眠定时
    var left = MS.sleepAt ? Math.max(0, Math.round((MS.sleepAt - Date.now()) / 60000)) : 0
    $q('[data-role="sleep"]', full).innerHTML = '<span class="mp-tool-label">睡眠</span>' +
      (MS.sleepAt
        ? '<button class="on" data-sleep="off">' + left + ' 分钟后停（点此取消）</button>'
        : '<button data-sleep="30">30 分钟</button><button data-sleep="60">60 分钟</button><button data-sleep="end">放完这首</button>')
    // 倍速：拉成一排选项，当前项高亮（和音质那排一致，点了立刻有反馈）
    var spHost = $q('[data-role="speed"]', full)
    if (spHost) {
      spHost.innerHTML = '<span class="mp-tool-label">倍速</span>' +
        RATES.map(function (r) {
          return '<button class="' + ((MS.rate || 1) === r ? 'on' : '') + '" data-rate="' + r + '">' + r + '×</button>'
        }).join('')
    }
    // 音效：已停用（浏览器接管音频会把声音搞没），这里只留说明
    var fxHost = $q('[data-role="fx"]', full)
    if (fxHost) {
      fxHost.innerHTML = '<span class="mp-tool-label">音效</span>' +
        '<span class="mp-off-note">暂时停用（接管音频会导致没声音）</span>'
    }
    // 歌词字号
    var ly = $q('[data-role="lyric"]')
    if (ly) ly.style.setProperty('--ly-size', (MS.lySize || 15.5) + 'px')
    // ⚠️ 歌词工具栏必须在这里重绘：以前只在 buildUI 里渲染一次，
    //    导致「翻译/逐字/桌面歌词」点了状态变了但高亮永远不动 = 看起来点了没反应
    var lyHost = $q('[data-role="lytools"]', full)
    if (lyHost) {
      lyHost.innerHTML =
        '<button data-act="lysmall" title="减小字号">A−</button>' +
        '<button data-act="lybig" title="加大字号">A+</button>' +
        '<button class="' + (MS.lyTrans ? 'on' : '') + '" data-act="lytrans">翻译</button>' +
        '<button class="' + (MS.karaoke ? 'on' : '') + '" data-act="karaoke">逐字</button>' +
        '<button class="' + (MS.deskLy ? 'on' : '') + '" data-act="deskly">桌面歌词</button>'
    }
    // 一起听
    var tgHost = $q('[data-role="together"]', full)
    if (tgHost) {
      tgHost.innerHTML = '<span class="mp-tool-label">一起听</span>' +
        (TG.room
          ? '<button class="on" data-act="tgshare">房间 ' + TG.room + ' · 复制链接</button>' +
            '<button data-act="tgleave">退出房间</button>'
          : '<button data-act="tgstart">开一个房间</button>' +
            '<input class="mp-roomin" data-role="roomin" type="text" inputmode="numeric" maxlength="4" ' +
              'placeholder="房间号" value="' + esc2(TG.roomIn || '') + '" aria-label="输入房间号">' +
            '<button data-act="tgjoin">进入房间</button>')
    }
    // 外观：主题 + 字号
    var thHost = $q('[data-role="theme"]', full)
    if (thHost) {
      thHost.innerHTML = '<span class="mp-tool-label">外观</span>' +
        THEMES.map(function (x) {
          return '<button class="' + ((MS.theme || 'default') === x.k ? 'on' : '') + '" data-theme="' + x.k + '">' + x.n + '</button>'
        }).join('') +
        '<span class="mp-tool-label" style="margin-left:10px">字号</span>' +
        FSS.map(function (x) {
          return '<button class="' + ((MS.fontScale || 1) === x.k ? 'on' : '') + '" data-fs="' + x.k + '">' + x.n + '</button>'
        }).join('')
    }
    // 背景样式可选（低端机隐藏动态与平铺）
    var bgHost = $q('[data-role="bg"]', full)
    if (bgHost) {
      bgHost.innerHTML = '<span class="mp-tool-label">背景</span>' +
        BGS.filter(function (b) { return !(LITE && (b.k === 'dynamic' || b.k === 'tile')) })
          .map(function (b) {
            return '<button class="' + ((MS.bg || 'gradient') === b.k ? 'on' : '') + '" data-bg="' + b.k + '">' + b.n + '</button>'
          }).join('')
    }
    paintQueue()
    paintTime()
    paintAccountBanner()
  }

  function paintTime () {
    var a = MS.audio || {}
    var c = a.currentTime || 0, d = a.duration || 0
    $$q('.mp-bar .mp-cur, .mp-full .mp-cur').forEach(function (e) { e.textContent = msDur(c * 1000) })
    $$q('.mp-bar .mp-dur, .mp-full .mp-dur').forEach(function (e) { e.textContent = msDur(d * 1000) })
    var pct = d ? (c / d * 100) : 0
    $$q('.mp-fill').forEach(function (e) { e.style.width = pct + '%' })
    paintDeskLy()
  }

  var IMP_HTML =
    '<div class="mp-import">' +
      '<input class="mp-imp-in" type="text" placeholder="粘贴分享码或歌单链接，回车导入" data-role="impin">' +
      '<button class="mp-imp-btn" data-act="impclip">从剪贴板</button>' +
      '<button class="mp-imp-btn" data-act="impgo">导入</button>' +
    '</div>'

  function paintQueue () {
    var host = $q('[data-role="queue"]')
    if (!host) return
    if (!MS.queue || !MS.queue.length) {
      // 列表为空时**更要**给出导入入口（之前这里直接 return，等于没有录入的地方）
      host.innerHTML = IMP_HTML + '<div class="mp-empty">播放列表是空的。<br>去音乐库挑几首，或把同学的分享码粘到上面导入。</div>'
      return
    }
    host.innerHTML = IMP_HTML +
      '<div class="mp-q-hd"><b>' + esc2(MS.queueName || '播放列表') + '</b><span>' + MS.queue.length + ' 首</span>' +
        '<button class="mp-q-share" data-act="share">分享歌单</button></div>' +
      MS.queue.map(function (s, i) {
        return '<button class="mp-q-row' + (i === MS.idx ? ' on' : '') + '" data-qi="' + i + '">' +
          '<span class="mp-q-n">' + (i + 1) + '</span>' +
          '<span class="mp-q-t"><b>' + esc2(s.name) + '</b><span>' + esc2(msArtists(s)) + '</span></span>' +
          '<span class="mp-q-d">' + msDur(s.dt) + '</span></button>'
      }).join('')
  }

  /* ═══════════ 4. 歌词 ═══════════ */
  function parseLrc (txt) {
    var out = []
    if (!txt) return out
    txt.split('\n').forEach(function (line) {
      var m = line.match(/\[(\d+):(\d+)(?:[.:](\d+))?\](.*)/)
      if (!m) return
      var t = Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(('0.' + m[3])) : 0)
      var s = (m[4] || '').trim()
      if (s) out.push({ t: t, s: s })
    })
    out.sort(function (a, b) { return a.t - b.t })
    return out
  }
  async function loadLyric () {
    var t = track(), host = $q('[data-role="lyric"]')
    if (!host) return
    if (!t) { host.innerHTML = '<div class="mp-empty">还没有在播放的歌曲。</div>'; LYR = { id: '', lines: [] }; return }
    if (LYR.id === String(t.id)) return
    LYR = { id: String(t.id), lines: [] }
    host.innerHTML = '<div class="mp-empty">歌词加载中…</div>'
    try {
      var b = await nc('lyric', { id: t.id })
      var raw = (b && (b.lrc && b.lrc.lyric ? b.lrc.lyric : b.lyric)) || ''
      var kraw = (b && b.klyric && b.klyric.lyric) || ''
      var traw = (b && (b.tlyric && b.tlyric.lyric)) || ''
      var trArr = parseLrc(traw)
      var trMap = {}
      trArr.forEach(function (x) { trMap[x.t.toFixed(2)] = x.s })
      /* 逐字优先：有 klyric 且开了卡拉OK，就用逐字数据（含每段自己的时间戳） */
      var kArr = MS.karaoke ? parseKrc(kraw) : []
      var base = (kArr.length ? kArr : parseLrc(raw)).map(function (l) {
        var best = '', bestD = 0.6
        for (var i = 0; i < trArr.length; i++) {
          var d = Math.abs(trArr[i].t - l.t)
          if (d < bestD) { bestD = d; best = trArr[i].s }
        }
        return { t: l.t, s: l.s, tr: best, words: l.words || null }
      })
      LYR.lines = base
      if (!LYR.lines.length) { host.innerHTML = '<div class="mp-empty">这首歌暂无歌词</div>'; return }
      LYR.karaoke = !!(kArr.length && MS.karaoke)
      host.classList.toggle('krc', LYR.karaoke)
      host.innerHTML = LYR.lines.map(function (l, i) {
        var inner = l.words
          ? l.words.map(function (w) {
              return '<span class="w" data-wt="' + w.t + '">' + esc2(w.s) + '</span>'
            }).join('')
          : esc2(l.s)
        return '<p data-li="' + i + '" data-t="' + l.t + '">' + inner +
          (l.tr && MS.lyTrans ? '<em>' + esc2(l.tr) + '</em>' : '') + '</p>'
      }).join('')
      curLyric = -1
      syncLyric()
    } catch (e) {
      host.innerHTML = '<div class="mp-empty">歌词加载失败：' + esc2(e.message) + '</div>'
    }
  }
  function syncLyric () {
    var host = $q('[data-role="lyric"]')
    if (!host || !LYR.lines.length) return
    var c = (MS.audio && MS.audio.currentTime) || 0
    var i = -1
    for (var k = 0; k < LYR.lines.length; k++) if (LYR.lines[k].t <= c + 0.25) i = k

    /* 逐字进度：必须每帧更新（不能只在换行时更新），所以放在 curLyric 早退之前 */
    if (LYR.karaoke && i >= 0) {
      var p = $$q('p', host)[i]
      if (p) {
        var ws = $$q('.w', p)
        for (var n = 0; n < ws.length; n++) {
          var wt = Number(ws[n].dataset.wt)
          var nxt = n + 1 < ws.length
            ? Number(ws[n + 1].dataset.wt)
            : (i + 1 < LYR.lines.length ? LYR.lines[i + 1].t : wt + 1)
          if (c >= nxt) {
            ws[n].classList.add('lit'); ws[n].classList.remove('cur')
            ws[n].style.removeProperty('--wf')
          } else if (c >= wt) {
            ws[n].classList.add('cur'); ws[n].classList.remove('lit')
            var f = Math.max(0, Math.min(1, (c - wt) / Math.max(0.05, nxt - wt)))
            ws[n].style.setProperty('--wf', (f * 100).toFixed(1) + '%')
          } else {
            ws[n].classList.remove('lit', 'cur'); ws[n].style.removeProperty('--wf')
          }
        }
      }
    }

    if (i === curLyric) return
    curLyric = i
    $$q('p', host).forEach(function (pp, idx) {
      pp.classList.toggle('on', idx === i)
      pp.classList.toggle('past', idx < i)
    })
    if (i >= 0) {
      var el = $$q('p', host)[i]
      if (el) host.scrollTop = el.offsetTop - host.clientHeight / 2 + el.offsetHeight / 2
    }
  }

  /* ═══════════ 5. MediaSession（锁屏 / 通知栏 / 耳机按键） ═══════════ */
  function mediaSession () {
    if (!('mediaSession' in navigator)) return
    var t = track()
    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: t ? (t.name || '未知曲目') : '尚贤圈',
        artist: t ? (msArtists(t) || '') : '',
        album: MS.queueName || '尚贤圈',
        artwork: cover(t) ? [{ src: cover(t), sizes: '512x512', type: 'image/jpeg' }] : []
      })
      navigator.mediaSession.playbackState = MS.playing ? 'playing' : 'paused'
      navigator.mediaSession.setActionHandler('play', function () { if (!MS.playing) msToggle() })
      navigator.mediaSession.setActionHandler('pause', function () { if (MS.playing) msToggle() })
      navigator.mediaSession.setActionHandler('previoustrack', function () { msNext(-1) })
      navigator.mediaSession.setActionHandler('nexttrack', function () { msNext(1) })
      navigator.mediaSession.setActionHandler('seekto', function (d) {
        if (MS.audio && d.seekTime != null) MS.audio.currentTime = d.seekTime
      })
    } catch (e) {}
  }

  /* ═══════════ 6. 循环 / 音质 / 收藏 / 睡眠 / 音量 ═══════════ */
  function cycleLoop () {
    var i = LOOPS.map(function (x) { return x.k }).indexOf(MS.loop)
    MS.loop = LOOPS[(i + 1) % LOOPS.length].k
    saveAll(); paint()
    toast('循环模式：' + (LOOPS.filter(function (x) { return x.k === MS.loop })[0] || {}).n)
  }
  function onEnded () {
    if (MS.sleepAt && MS.sleepAt === -1) { MS.sleepAt = 0; stop(); return toast('已按设置停止播放') }
    if (MS.loop === 'one') { MS.audio.currentTime = 0; MS.audio.play(); return }
    if (MS.loop === 'order' && MS.idx >= MS.queue.length - 1) { stop(); return toast('已播放完列表') }
    msNext(1)
    // 随机：跳到随机一首
    if (MS.loop === 'shuffle' && MS.queue.length > 1) {
      var n = MS.idx
      while (n === MS.idx) n = Math.floor(Math.random() * MS.queue.length)
      MS.idx = n; msPlay()
    }
  }
  function stop () { if (MS.audio) { MS.audio.pause(); MS.playing = false } paint(); mediaSession() }
  function toggleFav () {
    var t = track(); if (!t) return toast('还没有在播放的歌')
    var i = MS.favs.findIndex(function (x) { return String(x.id) === String(t.id) })
    if (i >= 0) { MS.favs.splice(i, 1); toast('已取消收藏') }
    else { MS.favs.unshift({ id: t.id, name: t.name, ar: t.ar, dt: t.dt, al: t.al }); toast('已收藏') }
    saveAll(); paint()
  }
  function setSleep (v) {
    if (v === 'off') { MS.sleepAt = 0; toast('已取消睡眠定时') }
    else if (v === 'end') { MS.sleepAt = -1; toast('放完这首就停') }
    else { MS.sleepAt = Date.now() + Number(v) * 60000; toast(v + ' 分钟后停止播放') }
    paint()
  }
  /* ── 倍速 ── */
  var RATES = [0.75, 1, 1.25, 1.5, 2]
  function cycleSpeed () {
    var i = RATES.indexOf(MS.rate || 1)
    MS.rate = RATES[(i + 1) % RATES.length]
    if (MS.audio) MS.audio.playbackRate = MS.rate
    saveAll(); paint()
    toast('播放倍速 ' + MS.rate + '×')
  }

  /* ── 导入歌单：自家分享码 / 完整链接 / 外部平台链接 ── */
  function extractCode (raw) {
    var s = String(raw || '').trim()
    if (!s) return ''
    var m = s.match(/[?&]pl=([A-Za-z0-9\-_]+)/)
    if (m) return m[1]
    if (/^[A-Za-z0-9\-_]{20,}$/.test(s)) return s
    return ''
  }
  function doImport (raw) {
    var input = $q('[data-role="impin"]')
    var val = raw != null ? raw : (input ? input.value : '')
    var code = extractCode(val)
    if (code) {
      var o = decPlaylist(code)
      if (o && o.songs.length) {
        try { msSetQueue(o.songs, o.name, 0) } catch (e) {}
        toast('已导入《' + o.name + '》，共 ' + o.songs.length + ' 首')
        paint(); return
      }
      return toast('分享码无效或已损坏，请让同学重新分享一次')
    }
    // 外部平台歌单链接：网易云能直接导入（解析 id），QQ/酷狗给明确提示
    if (/music\.163\.com|y\.qq\.com|c6\.y\.qq\.com|kugou\.com/i.test(val) || /^(QQ|KG)$/.test(extractPlaylistId(val))) {
      importExternal(val)
      return
    }
    toast('没识别出分享码。可以粘贴：① 同学分享的链接/分享码 ② 网易云歌单链接')
  }
  function importFromClipboard () {
    if (!navigator.clipboard || !navigator.clipboard.readText) return toast('这个浏览器不允许读剪贴板，请手动粘贴')
    navigator.clipboard.readText().then(function (t) {
      var input = $q('[data-role="impin"]')
      if (input) input.value = t
      doImport(t)
    }, function () { toast('读取剪贴板被拒绝，请手动粘贴') })
  }

  var sleepTimer = setInterval(function () {
    if (MS.sleepAt > 0 && Date.now() >= MS.sleepAt) { MS.sleepAt = 0; stop(); toast('睡眠定时到，已停止播放') }
    paintTime()
  }, 1000)

  /* ═══════════ 7. 交互绑定 ═══════════ */
  /* 播放器点击统一入口（委托与直绑共用一个实现） */
  function handlePlayerClick (el, e) {
      // 主题
      if (el.dataset.theme) { MS.theme = el.dataset.theme; applyTheme(); saveAll(); paint(); return }
      // 字号
      if (el.dataset.fs) { MS.fontScale = Number(el.dataset.fs); applyTheme(); saveAll(); paint(); return }
      // 音效已停用（见顶部说明）：这里只给一句解释，不再碰音频路由
      if (el.dataset.fx) {
        toast('音效暂时不可用：浏览器接管音频会导致没有声音，已经停用')
        return
      }
      // 倍速：点了立刻切并高亮
      if (el.dataset.rate) {
        MS.rate = Number(el.dataset.rate)
        if (MS.audio) { try { MS.audio.playbackRate = MS.rate } catch (err) {} }
        saveAll(); paint()
        toast('播放倍速 ' + MS.rate + '×')
        return
      }
      // 背景样式
      if (el.dataset.bg) { MS.bg = el.dataset.bg; saveAll(); paint(); return }

      // 标签切页
      if (el.dataset.tab) {
        var tab = el.dataset.tab
        $$q('.mp-tabs button').forEach(function (b) { b.classList.toggle('on', b === el) })
        $$q('.mp-pane').forEach(function (p) { p.classList.toggle('on', p.dataset.pane === tab) })
        if (tab === 'lyric') loadLyric()
        if (tab === 'queue') paintQueue()
        if (tab === 'cmt') loadComments()
        return
      }
      // 封面样式
      if (el.dataset.cover) { MS.cover = el.dataset.cover; saveAll(); paint(); return }
      // 音质
      if (el.dataset.quality) {
        MS.quality = el.dataset.quality; saveAll(); paint()
        toast('音质：' + (QUALITY.filter(function (q) { return q.k === MS.quality })[0] || {}).n + '（下一首生效）')
        return
      }
      // 睡眠
      if (el.dataset.sleep) { setSleep(el.dataset.sleep); return }
      // 队列点击
      if (el.dataset.qi != null) { MS.idx = Number(el.dataset.qi); msPlay(); paint(); return }
      // 歌词点击跳进度
      if (el.dataset.li != null) {
        var t = Number(el.dataset.t)
        if (MS.audio && isFinite(t)) { MS.audio.currentTime = t; if (!MS.playing) msToggle(); syncLyric() }
        return
      }
      // 进度条拖动
      if (el.dataset.seek) {
        var rect = el.getBoundingClientRect()
        var ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
        if (MS.audio && MS.audio.duration) {
          MS.audio.currentTime = ratio * MS.audio.duration
          paintTime(); syncLyric()
        }
        return
      }

      switch (el.dataset.act) {
        case 'expand': $q('.mp-full').classList.add('on'); loadLyric(); paintQueue(); paint(); break
        case 'collapse': $q('.mp-full').classList.remove('on'); break
        case 'toggle': msToggle(); paint(); setTimeout(mediaSession, 60); break
        case 'prev': msNext(-1); paint(); setTimeout(mediaSession, 60); break
        case 'next': msNext(1); paint(); setTimeout(mediaSession, 60); break
        case 'loop': cycleLoop(); break
        case 'fav': toggleFav(); break
        case 'vol': $q('.mp-bar').classList.toggle('vol-open'); break
        case 'list': $q('.mp-full').classList.add('on');
                     $$q('.mp-tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === 'queue') })
                     $$q('.mp-pane').forEach(function (p) { p.classList.toggle('on', p.dataset.pane === 'queue') })
                     paintQueue(); break
        case 'cycleCover': break
        case 'poster': makePoster(); break
        case 'share': sharePlaylist(); break
        case 'relogin':
          if (typeof openMusic === 'function') openMusic()
          else toast('请打开音乐库重新登录')
          break
        case 'speed': cycleSpeed(); break
        case 'impgo': doImport(); break
        case 'impclip': importFromClipboard(); break
        /* 歌词：字号 / 翻译 / 桌面歌词 */
        case 'lysmall':
          MS.lySize = Math.max(12, (MS.lySize || 15.5) - 1); saveAll(); paint(); toast('歌词字号 ' + MS.lySize + 'px')
          break
        case 'lybig':
          MS.lySize = Math.min(30, (MS.lySize || 15.5) + 1); saveAll(); paint(); toast('歌词字号 ' + MS.lySize + 'px')
          break
        case 'lytrans':
          MS.lyTrans = !MS.lyTrans; saveAll()
          LYR.id = ''                       // 强制重渲染以插入/移除翻译
          paint(); loadLyric()
          toast(MS.lyTrans ? '已显示歌词翻译' : '已关闭歌词翻译')
          break
        case 'karaoke':
          MS.karaoke = !MS.karaoke; saveAll()
          LYR.id = ''                       // 强制重拉（换用/换回逐字数据）
          paint(); loadLyric()
          toast(MS.karaoke ? '已开启逐字高亮' : '已关闭逐字高亮')
          break
        case 'daily':
          toast('正在取今天的推荐…')
          getDaily().then(function (songs) {
            if (!songs.length) return toast('今天没取到推荐，稍后再试')
            try { msSetQueue(songs, '每日推荐 · ' + todayKey(), 0) } catch (e) {}
            msPlay(); paint()
            toast('每日推荐已就绪，共 ' + songs.length + ' 首')
          }, function () { toast('每日推荐加载失败，稍后再试') })
          break
        case 'fm': startFM(); break
        case 'cmtsend': sendComment(); break
        case 'cmtdel': delComment(el.dataset.id); break
        case 'tgstart': tgStart(); break
        case 'tgjoin':
          var rin = $q('[data-role="roomin"]')
          var rv = String((rin && rin.value) || TG.roomIn || '').replace(/\D/g, '')
          if (rv.length !== 4) { toast('房间号是 4 位数字，问同学要一下'); break }
          tgJoin(rv, false)
          break
        case 'tgshare': tgShare(); break
        case 'tgleave': tgLeave(); break
        case 'extimp':
          var xi = $q('[data-role="extin"]')
          importExternal(xi ? xi.value : '')
          break
        case 'deskly':
          MS.deskLy = !MS.deskLy; saveAll()
          if (MS.deskLy) { buildDeskLy(); toast('桌面歌词已开启，可拖动左上角把手移动') }
          paintDeskLy(); paint()
          break
        /* 桌面歌词上的控制 */
        case 'dlprev': msNext(-1); paint(); break
        case 'dlnext': msNext(1); paint(); break
        case 'dltoggle': msToggle(); paint(); break
        case 'dlfav': toggleFav(); paint(); break
        case 'dlloop': cycleLoop(); paint(); break
        case 'dlclose': MS.deskLy = false; saveAll(); paintDeskLy(); paint(); break
      }
  }

  function bind () {
    // ① 委托：DOM 怎么重绘都不会丢
    document.addEventListener('click', function (e) {
      try {
        var el = e.target.closest && e.target.closest('[data-act],[data-cover],[data-quality],[data-sleep],[data-tab],[data-qi],[data-li],[data-seek],[data-bg],[data-rate],[data-fx],[data-theme],[data-fs]')
        if (!el) return
        handlePlayerClick(el, e)
      } catch (err) { showErr((err && err.message) || err) }
    })

    // 房间号输入：把值记在内存里，避免面板重绘时把用户正在输的内容清掉
    document.addEventListener('input', function (e) {
      if (e.target && e.target.dataset && e.target.dataset.role === 'roomin') {
        TG.roomIn = String(e.target.value || '').replace(/\D/g, '').slice(0, 4)
        if (e.target.value !== TG.roomIn) e.target.value = TG.roomIn
      }
    })

    // ② 直绑兜底：万一同 document 委托冲突或被别的元素吃掉事件，直绑仍能点
    var SEL = '.mp-bar [data-act],.mp-full [data-act],.mp-full [data-bg],.mp-full [data-rate],' +
              '.mp-full [data-theme],.mp-full [data-fs],.mp-full [data-quality],.mp-full [data-sleep],' +
              '.mp-full [data-li],.mp-full [data-tab],.mp-full [data-qi],.mp-full [data-seek]'
    function bindDirect () {
      $$q(SEL).forEach(function (b) {
        if (b.__mpb) return
        b.__mpb = 1
        b.addEventListener('click', function (ev) {
          ev.stopPropagation()
          try { handlePlayerClick(b, ev) } catch (err) { showErr((err && err.message) || err) }
        })
      })
    }
    bindDirect()
    setInterval(bindDirect, 1500)      // 面板是动态重绘的，定期补挂

    document.addEventListener('keydown', function (e) {
      // 房间号输入框：回车直接进房间；且不冒泡到全局快捷键
      if (e.target && e.target.dataset && e.target.dataset.role === 'roomin') {
        if (e.key === 'Enter') {
          e.preventDefault()
          TG.roomIn = String(e.target.value || '').replace(/\D/g, '')
          if (TG.roomIn.length === 4) tgJoin(TG.roomIn, false)
          else toast('房间号是 4 位数字，问同学要一下')
        }
        return
      }
      if (e.target && e.target.dataset && e.target.dataset.role === 'impin') {
        if (e.key === 'Enter') { e.preventDefault(); doImport(e.target.value) }
        return
      }
      // 评论框：回车发送（不冒泡到全局的 Space 播放快捷键）
      if (e.target && e.target.dataset && e.target.dataset.role === 'cmtin') {
        if (e.key === 'Enter') { e.preventDefault(); sendComment() }
        return
      }
      if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName) || e.target.isContentEditable) return
      if (e.code === 'Space' && $q('.mp-full').classList.contains('on')) { e.preventDefault(); msToggle(); paint() }
      if (e.key === 'Escape') $q('.mp-full').classList.remove('on')
    })

    var vol = document.querySelector('.mp-vol')
    if (vol) vol.addEventListener('input', function () {
      MS.volume = Number(vol.value) / 100
      if (MS.audio) MS.audio.volume = MS.volume
      saveAll()
    })
  }

  /* ═══════════ 8. 挂到已有播放器上：接管事件与状态同步 ═══════════ */
  function hook () {
    var a = MS.audio
    if (!a || a.__mpHooked) return
    a.__mpHooked = true
    // 去掉原来的 ended（改为我们的循环逻辑）
    a.addEventListener('ended', function (e) { e.stopImmediatePropagation(); onEnded() }, true)
    a.addEventListener('timeupdate', function () { paintTime(); syncLyric() })
    a.addEventListener('play', function () {
      MS.playing = true
      if (MS.rate && MS.rate !== 1) { try { a.playbackRate = MS.rate } catch (e) {} }
      setTimeout(tgBroadcast, 60)
      paint(); mediaSession()
    })
    a.addEventListener('pause', function () { setTimeout(tgBroadcast, 60) })
    a.addEventListener('seeked', function () { tgBroadcast() })
    a.addEventListener('pause', function () { MS.playing = false; paint(); mediaSession() })
    a.addEventListener('loadedmetadata', function () {
      // 记录播放历史（最多 50 首，同曲去重后置顶）
      var cur = track()
      if (cur && cur.id != null) {
        MS.recent = (MS.recent || []).filter(function (x) { return String(x.id) !== String(cur.id) })
        MS.recent.unshift(cur)
        if (MS.recent.length > 50) MS.recent.length = 50
        // 听歌报告用的统计
        var key = String(cur.id)
        MS.plays[key] = (MS.plays[key] || 0) + 1
        var an = msArtists(cur)
        if (an && an !== '未知') MS.artistCount[an] = (MS.artistCount[an] || 0) + 1
        var hr = new Date().getHours()
        if (hr >= 23 || hr < 5) MS.nightPlays = (MS.nightPlays || 0) + 1
        saveAll()
      }
      // 恢复上次播放位置
      if (MS.resume && MS.lastTime > 3 && MS.lastTime < (a.duration - 5)) {
        a.currentTime = MS.lastTime
        toast('已从上次的位置继续播放')
      }
      MS.resume = false
      setTimeout(tgBroadcast, 80)          // 切歌也广播（房主）
      paint(); mediaSession()
    })
    // 播放失败：不要静默。未登录/VIP 曲目/版权限制都从这里给明确提示
    a.addEventListener('error', function () {
      MS.playing = false
      paint()
      var logged = !!(MS.cookie || MS.profile)
      toast(logged
        ? '这首暂时放不出来（可能是 VIP 或版权限制），换一首试试'
        : '未登录时只能播放免费曲目。点播放页顶部「登录网易云」可听完整曲库')
      paintAccountBanner()
    })
    // 音质：下一首生效（song_url 带 level）
    paint(); mediaSession()
  }

  /* ═══════════ 8.5 歌词海报（canvas 生成，可下载） ═══════════ */
  function posterLines () {
    // 取当前歌词行前后各 2 行
    var host = $q('[data-role="lyric"]')
    if (!LYR.lines.length) return []
    var c = (MS.audio && MS.audio.currentTime) || 0
    var i = -1
    for (var k = 0; k < LYR.lines.length; k++) if (LYR.lines[k].t <= c + 0.25) i = k
    if (i < 0) i = 0
    var out = []
    for (var j = i - 2; j <= i + 2; j++) {
      if (j >= 0 && j < LYR.lines.length) out.push({ s: LYR.lines[j].s, on: j === i })
    }
    return out
  }

  function loadImg (src) {
    return new Promise(function (res) {
      if (!src) return res(null)
      var im = new Image()
      im.crossOrigin = 'anonymous'
      im.onload = function () { res(im) }
      im.onerror = function () { res(null) }
      im.src = src
    })
  }

  async function makePoster () {
    var t = track()
    if (!t) return toast('还没有在播放的歌')
    if (LYR.id !== String(t.id)) { await loadLyric() }
    toast('正在生成歌词海报…')

    var W = 900, H = 1200
    var c = document.createElement('canvas')
    c.width = W; c.height = H
    var x = c.getContext('2d')

    // 背景：品牌纸色 + 顶部渐晕
    var g = x.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, '#faf6ee'); g.addColorStop(.55, '#f4efe6'); g.addColorStop(1, '#ece5d6')
    x.fillStyle = g; x.fillRect(0, 0, W, H)
    var rg = x.createRadialGradient(W * .82, 120, 0, W * .82, 120, 620)
    rg.addColorStop(0, 'rgba(214,72,47,.16)'); rg.addColorStop(1, 'rgba(214,72,47,0)')
    x.fillStyle = rg; x.fillRect(0, 0, W, H)

    // 封面
    var cov = cover(t), img = await loadImg(cov)
    var cs = 320, cx = (W - cs) / 2, cy = 120
    x.save()
    x.beginPath()
    var r = 24
    x.moveTo(cx + r, cy); x.arcTo(cx + cs, cy, cx + cs, cy + cs, r)
    x.arcTo(cx + cs, cy + cs, cx, cy + cs, r); x.arcTo(cx, cy + cs, cx, cy, r)
    x.arcTo(cx, cy, cx + cs, cy, r); x.closePath()
    x.clip()
    if (img) {
      var s = Math.max(cs / img.width, cs / img.height)
      x.drawImage(img, cx + (cs - img.width * s) / 2, cy + (cs - img.height * s) / 2, img.width * s, img.height * s)
    } else {
      var cg = x.createLinearGradient(cx, cy, cx + cs, cy + cs)
      cg.addColorStop(0, '#d6482f'); cg.addColorStop(1, '#9e3015')
      x.fillStyle = cg; x.fillRect(cx, cy, cs, cs)
      x.fillStyle = '#fff'; x.font = '900 120px "PingFang SC",sans-serif'
      x.textAlign = 'center'; x.textBaseline = 'middle'
      x.fillText('贤', cx + cs / 2, cy + cs / 2)
    }
    x.restore()

    // 歌名 / 歌手
    x.textAlign = 'center'; x.fillStyle = '#1c1a17'
    x.font = '900 42px "PingFang SC","Microsoft YaHei",sans-serif'
    x.fillText(clip(x, t.name || '未知曲目', W - 160), W / 2, cy + cs + 84)
    x.fillStyle = '#8b8270'
    x.font = '500 24px "PingFang SC",sans-serif'
    x.fillText(clip(x, msArtists(t) || '', W - 160), W / 2, cy + cs + 128)

    // 分隔线
    x.strokeStyle = 'rgba(31,28,24,.12)'; x.lineWidth = 1
    x.beginPath(); x.moveTo(120, cy + cs + 176); x.lineTo(W - 120, cy + cs + 176); x.stroke()

    // 歌词（当前行高亮）
    var lines = posterLines()
    var ly = cy + cs + 246
    if (!lines.length) {
      x.fillStyle = '#8b8270'; x.font = '500 26px "PingFang SC",sans-serif'
      x.fillText('这首歌暂无歌词', W / 2, ly + 20)
    } else {
      lines.forEach(function (l, i) {
        if (l.on) {
          x.fillStyle = '#c8401f'
          x.font = '900 34px "PingFang SC","Microsoft YaHei",sans-serif'
        } else {
          x.fillStyle = 'rgba(87,80,63,.62)'
          x.font = '500 27px "PingFang SC",sans-serif'
        }
        x.fillText(clip(x, l.s, W - 160), W / 2, ly + i * 56)
      })
    }

    // 底部：品牌 + 链接 + 二维码
    x.fillStyle = '#1c1a17'
    x.font = '900 30px "PingFang SC",sans-serif'
    x.textAlign = 'left'
    x.fillText('尚贤圈', 120, H - 96)
    x.fillStyle = '#8b8270'
    x.font = '500 20px ui-monospace,Consolas,monospace'
    x.fillText('sxcommunity.github.io/xq-center', 120, H - 62)

    // 二维码（qrcode.min.js 已加载则用；失败就跳过，不影响出图）
    try {
      if (window.QRCode) {
        var qr = document.createElement('div')
        qr.style.cssText = 'position:fixed;left:-9999px;top:0'
        document.body.appendChild(qr)
        new window.QRCode(qr, { text: location.origin + location.pathname, width: 132, height: 132,
          colorDark: '#1c1a17', colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel.M })
        await new Promise(function (r) { setTimeout(r, 260) })
        var cv = qr.querySelector('canvas') || qr.querySelector('img')
        if (cv) x.drawImage(cv, W - 120 - 132, H - 190, 132, 132)
        qr.remove()
      }
    } catch (e) {}

    // 出图
    c.toBlob(function (blob) {
      if (!blob) return toast('海报生成失败')
      var url = URL.createObjectURL(blob)
      var a = document.createElement('a')
      a.href = url
      a.download = '尚贤圈-歌词海报-' + (t.name || 'unknown') + '.png'
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(function () { URL.revokeObjectURL(url) }, 4000)
      toast('歌词海报已生成，检查浏览器下载')
      // 顺手在页面里给个预览
      var full = $q('.mp-full')
      var ov = $q('.mp-poster')
      if (!ov) {
        ov = document.createElement('div')
        ov.className = 'mp-poster'
        ov.innerHTML = '<button class="mp-poster-x" aria-label="关闭">×</button><img alt="歌词海报">'
        full.appendChild(ov)
        ov.querySelector('.mp-poster-x').onclick = function () { ov.classList.remove('on') }
      }
      ov.querySelector('img').src = url
      ov.classList.add('on')
    }, 'image/png')
  }
  function clip (x, s, max) {
    s = String(s || '')
    if (x.measureText(s).width <= max) return s
    var out = s
    while (out.length > 1 && x.measureText(out + '…').width > max) out = out.slice(0, -1)
    return out + '…'
  }

  /* ═══════════ 8.6 歌单分享：把歌曲 ID 编进链接（不用数据库） ═══════════ */
  function encPlaylist () {
    if (!MS.queue || !MS.queue.length) return ''
    var slim = MS.queue.slice(0, 100).map(function (s) {
      return { i: s.id, n: s.name, a: msArtists(s), d: s.dt, p: cover(s) }
    })
    var json = JSON.stringify({ name: MS.queueName || '分享的歌单', songs: slim })
    try {
      return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    } catch (e) { return '' }
  }
  function decPlaylist (code) {
    try {
      var b = code.replace(/-/g, '+').replace(/_/g, '/')
      while (b.length % 4) b += '='
      var json = decodeURIComponent(escape(atob(b)))
      var o = JSON.parse(json)
      if (!o || !Array.isArray(o.songs)) return null
      return { name: o.name || '分享的歌单', songs: o.songs.map(function (s) {
        return { id: s.i, name: s.n, ar: [{ name: s.a }], dt: s.d, al: { picUrl: s.p } }
      }) }
    } catch (e) { return null }
  }
  function sharePlaylist () {
    var code = encPlaylist()
    if (!code) return toast('播放列表是空的')
    var url = location.origin + location.pathname + '?pl=' + code
    var done = function () { toast('这个链接发给同学，点开就能听同一份歌单（不用登录）') }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, fallback)
    } else fallback()
    function fallback () {
      var ta = document.createElement('textarea')
      ta.value = url; document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy'); done() } catch (e) { toast('请手动复制地址栏链接') }
      ta.remove()
    }
    // 同时把链接写进地址栏，方便直接复制
    try { history.replaceState(history.state, '', '?pl=' + code + location.hash) } catch (e) {}
  }
  function readSharedPlaylist () {
    var q
    try { q = new URLSearchParams(location.search) } catch (e) { return }
    var code = q.get('pl')
    if (!code) return
    var o = decPlaylist(code)
    if (!o || !o.songs.length) return
    try {
      msSetQueue(o.songs, o.name, 0)
      toast('已载入分享的歌单《' + o.name + '》，共 ' + o.songs.length + ' 首')
    } catch (e) {}
  }

  /* ═══════════ 8.7 登录状态：过期提示 + 未登录保底说明 ═══════════ */
  function paintAccountBanner () {
    var full = $q('.mp-full')
    if (!full) return
    var host = $q('[data-role="account"]')
    if (!host) {
      host = document.createElement('div')
      host.className = 'mp-acct'
      var hd = $q('.mp-full-hd', full)
      if (hd && hd.parentNode) hd.parentNode.insertBefore(host, hd.nextSibling)
    }
    var msg = ''
    if (MS.expired) {
      msg = '<b>网易云登录已过期</b><span>免费曲目仍可播放；要听完整曲库请重新登录。</span>' +
        '<button data-act="relogin">重新登录</button>'
    } else if (!MS.cookie && !MS.profile) {
      msg = '<b>未登录</b><span>未登录也能播放免费曲目；登录后可听完整曲库、音质更高。</span>' +
        '<button data-act="relogin">登录网易云</button>'
    }
    host.innerHTML = msg
    host.classList.toggle('on', !!msg)
  }

  /* ═══════════ 8.8 右栏逐卡视差（错位由 CSS 做，这里只做速度差） ═══════════ */
  function initRailParallax () {
    if (LITE) return
    var rail = null, items = [], cache = []
    function collect () {
      rail = document.querySelector('.cell.c-side')
      if (!rail) { items = []; cache = []; return }
      items = [].slice.call(rail.children).filter(function (el) {
        return el.nodeType === 1 && !el.classList.contains('sk-card')
      })
      cache = items.map(function (el) {
        var r = el.getBoundingClientRect()
        return { top: r.top + window.scrollY, h: r.height || 1 }
      })
    }
    // 每张卡速度不同：-0.05 / 0 / +0.05 轮转，形成参差
    function speedOf (i) { return ((i % 3) - 1) * 0.05 }
    var raf = null
    function render () {
      raf = null
      var sy = window.scrollY, vh = window.innerHeight
      for (var i = 0; i < items.length; i++) {
        var c = cache[i]
        if (!c) continue
        var mid = c.top + c.h / 2 - sy
        var off = (mid - vh / 2) / vh
        items[i].style.transform = 'translate3d(0,' + (off * speedOf(i) * 100).toFixed(2) + 'px,0)'
      }
    }
    function onScroll () { if (!raf) raf = requestAnimationFrame(render) }

    collect(); render()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', function () { collect(); onScroll() })
    // 路由切换会重建右栏，用 MutationObserver 重新采集
    try {
      var mo = new MutationObserver(function () { clearTimeout(mo._t); mo._t = setTimeout(function () { collect(); render() }, 260) })
      var main = document.getElementById('main')
      if (main) mo.observe(main, { childList: true, subtree: false })
    } catch (e) {}
    setInterval(function () { if (items.length !== (rail ? rail.children.length : 0)) { collect(); render() } }, 2000)
  }

  /* ═══════════ 8.9 真·液态玻璃接入 ═══════════
     选择只挂在这些「大面积可见表面」上：液态玻璃的 backdrop 采样本身有成本，
     全站每一个小元素都挂会拖慢滚动。这四个覆盖了用户 90% 的视线落点。 */
  function initGlass () {
    if (!window.LiquidGlass) return
    /* 只挂「真正悬浮在内容之上」的表面——这样折射才有东西可折，
       而且文字不会被背景干扰（弹层/面板/卡片一律实心）。 */
    // 底部胶囊（整圆）
    window.LiquidGlass.auto('.mp-bar', { roundness: 1, inset: 0.012, edge: 0.1, blur: 0.6 })
    // 右栏卡片（悬浮在页面底色之上）
    window.LiquidGlass.auto('.cell.c-side > *', { roundness: 0.2, inset: 0.02, edge: 0.1, blur: 0.5 })
    // 播放页顶部的样式切换按钮（小、悬浮、形状明确）
    window.LiquidGlass.auto('.mp-styles button', { roundness: 1, inset: 0.06, edge: 0.22, blur: 0.5 })
    // 桌面歌词条
    window.LiquidGlass.auto('.mp-deskly', { roundness: 0.3, inset: 0.02, edge: 0.12, blur: 0.6 })
    // 迷你条第一次出现时尺寸才有值，补挂一次
    setTimeout(function () {
      window.LiquidGlass.attachAll('.mp-bar', { roundness: 1, inset: 0.012, edge: 0.1, blur: 0.6 })
      window.LiquidGlass.attachAll('.mp-deskly', { roundness: 0.3, inset: 0.02, edge: 0.12, blur: 0.6 })
    }, 1200)
  }

  /* ═══════════ 8.95 音效 —— 已彻底停用 ═══════════
     ⚠️ 教训（用你的音乐换来的）：
     `AudioContext.createMediaElementSource()` 会把 <audio> 的音频**永久改道**进
     AudioContext，**不可逆**。只要这个 AudioContext 没被唤醒（浏览器自动播放策略
     随时可能挂起它），结果就是：**进度条照走、但一点声音都没有**。
     我前后试了两次「在 play 事件里建图 + resume」，两次都把你的音乐搞成静音。

     结论：**这个 API 不适合用在这个场景**。宁可没有音效，也不能没有声音。
     现在这块只保留一个说明，不再碰音频路由。
     （如果以后真要做音效，正确路径是用 Web Audio 自己管理音源，
       而不是从 <audio> 元素上"接管"——那是另一个工程。） */
  var FX_OFF = true

  /* ═══════════ 8.96 桌面歌词（可拖动悬浮条） ═══════════ */
  function buildDeskLy () {
    if ($q('.mp-deskly')) return
    var el = document.createElement('div')
    el.className = 'mp-deskly'
    el.innerHTML =
      '<div class="dl-handle" title="拖动移动">⠿</div>' +
      '<div class="dl-body">' +
        '<div class="dl-meta">' +
          '<b class="dl-song"></b><span class="dl-artist"></span><i class="dl-time"></i>' +
        '</div>' +
        '<div class="dl-cur">桌面歌词</div>' +
        '<div class="dl-next"></div>' +
        '<div class="dl-track"><i></i></div>' +
      '</div>' +
      '<div class="dl-acts">' +
        '<button data-act="dlfav" title="收藏">' + svg('heart') + '</button>' +
        '<button data-act="dlloop" title="循环模式">' + svg('loop') + '</button>' +
        '<button data-act="dlprev" aria-label="上一首">' + svg('prev') + '</button>' +
        '<button data-act="dltoggle" aria-label="播放暂停">' + svg('play') + '</button>' +
        '<button data-act="dlnext" aria-label="下一首">' + svg('next') + '</button>' +
        '<button data-act="dlclose" aria-label="关闭">×</button>' +
      '</div>'
    document.body.appendChild(el)
    /* 拖动
       ⚠️ 之前拖不动的原因：CSS 里给 .mp-deskly 的 left/top 加了 !important
       （为了压过更早那份旧样式），而**内联样式压不过 CSS 的 !important**，
       所以 JS 设的 style.left 完全无效。
       解法：内联也用 !important（内联 !important 优先级最高），
       并在按下瞬间把 transform 清掉，避免 translateX(-50%) 干扰定位。 */
    var drag = null
    function place (x, y) {
      el.style.setProperty('left', x + 'px', 'important')
      el.style.setProperty('top', y + 'px', 'important')
      el.style.setProperty('right', 'auto', 'important')
      el.style.setProperty('bottom', 'auto', 'important')
      el.style.setProperty('transform', 'none', 'important')
    }
    el.querySelector('.dl-handle').addEventListener('pointerdown', function (ev) {
      var r = el.getBoundingClientRect()
      drag = { x: ev.clientX, y: ev.clientY, left: r.left, top: r.top, w: r.width, h: r.height }
      place(r.left, r.top)
      el.classList.add('dragging')
      try { ev.target.setPointerCapture(ev.pointerId) } catch (e) {}
      ev.preventDefault()
    })
    window.addEventListener('pointermove', function (ev) {
      if (!drag) return
      var nx = Math.max(6, Math.min(window.innerWidth - drag.w - 6, drag.left + ev.clientX - drag.x))
      var ny = Math.max(6, Math.min(window.innerHeight - drag.h - 6, drag.top + ev.clientY - drag.y))
      place(nx, ny)
    })
    window.addEventListener('pointerup', function () {
      if (!drag) return
      drag = null
      el.classList.remove('dragging')
      try {
        writeLS('xq_deskly_pos', { x: el.style.getPropertyValue('left'), y: el.style.getPropertyValue('top') })
      } catch (e) {}
    })
    // 恢复上次位置（也要带 !important）
    try {
      var pos = readLS('xq_deskly_pos', null)
      if (pos && pos.x) {
        place(parseFloat(pos.x) || 60, parseFloat(pos.y) || 60)
      }
    } catch (e) {}
  }
  function paintDeskLy () {
    var el = $q('.mp-deskly')
    if (!el) return
    var on = !!MS.deskLy
    el.classList.toggle('on', on)
    if (!on) return
    var t = track()
    var lines = LYR.lines || []
    var c = (MS.audio && MS.audio.currentTime) || 0
    var i = -1
    for (var k = 0; k < lines.length; k++) if (lines[k].t <= c + 0.25) i = k
    // 歌名 / 歌手 / 时间
    var song = el.querySelector('.dl-song')
    var artist = el.querySelector('.dl-artist')
    var time = el.querySelector('.dl-time')
    if (song) song.textContent = t ? (t.name || '未知曲目') : '未在播放'
    if (artist) artist.textContent = t ? (msArtists(t) || '') : ''
    if (time) {
      var d = (MS.audio && MS.audio.duration) || 0
      time.textContent = msDur(c * 1000) + ' / ' + msDur(d * 1000)
    }
    // 当前行 / 下一行
    el.querySelector('.dl-cur').textContent = i >= 0 ? lines[i].s : (t ? '♪ ' + (t.name || '') : '未在播放')
    el.querySelector('.dl-next').textContent = (i + 1 >= 0 && i + 1 < lines.length) ? lines[i + 1].s : ''
    // 细进度条
    var bar = el.querySelector('.dl-track i')
    if (bar) {
      var dd = (MS.audio && MS.audio.duration) || 0
      bar.style.width = dd ? (c / dd * 100).toFixed(1) + '%' : '0%'
    }
    // 播放态 / 收藏 / 循环
    el.querySelector('[data-act="dltoggle"]').innerHTML = MS.playing ? svg('pause') : svg('play')
    var fb = el.querySelector('[data-act="dlfav"]')
    if (fb) fb.classList.toggle('on', !!(t && isFav(t.id)))
    var lb = el.querySelector('[data-act="dlloop"]')
    if (lb) {
      lb.innerHTML = svg(MS.loop === 'one' ? 'loop1' : MS.loop === 'shuffle' ? 'shuffle' : MS.loop === 'order' ? 'order' : 'loop')
      lb.title = '循环：' + ((LOOPS.filter(function (x) { return x.k === MS.loop })[0] || {}).n || '')
    }
  }

  /* ═══════════ 8.97 听歌报告（基于本地统计，参考酷狗「音乐DNA」） ═══════════ */
  function reportHTML () {
    var plays = MS.plays || {}
    var ids = Object.keys(plays)
    var total = 0
    ids.forEach(function (k) { total += plays[k] })
    var recent = MS.recent || []
    if (!total && !recent.length) {
      return '<div class="empty">还没有足够的听歌数据。<br>多听几首，这里会生成你的听歌报告。</div>'
    }
    // 最常听的歌
    var topSong = null, topN = 0
    recent.forEach(function (s) {
      var n = plays[String(s.id)] || 0
      if (n > topN) { topN = n; topSong = s }
    })
    // 最常听的歌手
    var ar = MS.artistCount || {}
    var topArtist = '', topAN = 0
    Object.keys(ar).forEach(function (k) { if (ar[k] > topAN) { topAN = ar[k]; topArtist = k } })
    // 深夜指数
    var night = Math.round((MS.nightPlays || 0) / Math.max(1, total) * 100)
    // 音乐年龄（好玩的口径：循环越多越"老"）
    var variety = ids.length || recent.length
    var age = Math.max(13, Math.min(60, Math.round(40 - variety * 0.6 + (topN || 1) * 1.2)))
    var uniq = (MS.recent || []).length
    function stat (label, val, unit, desc) {
      return '<div class="rp-item"><b>' + val + '<i>' + (unit || '') + '</i></b><span>' + label + '</span>' +
        (desc ? '<p>' + desc + '</p>' : '') + '</div>'
    }
    return '<div class="rp-hd"><b>我的听歌报告</b><span>基于本机记录，数据不上传</span></div>' +
      '<div class="rp-grid">' +
        stat('累计播放', total, ' 次') +
        stat('听过的歌', uniq, ' 首') +
        stat('深夜指数', night, '%', '23:00–5:00 听歌占比') +
        stat('音乐年龄', age, ' 岁', '循环越多越"资深"') +
      '</div>' +
      (topSong ? '<div class="rp-top"><span>循环最多</span><b>' + esc2(topSong.name) + '</b>' +
        '<i>' + esc2(msArtists(topSong)) + ' · ' + topN + ' 次</i></div>' : '') +
      (topArtist ? '<div class="rp-top"><span>最常听</span><b>' + esc2(topArtist) + '</b>' +
        '<i>' + topAN + ' 次</i></div>' : '') +
      '<p class="muted" style="margin-top:14px;font-size:12px;line-height:1.8">' +
      '统计只存在你自己的浏览器里，不会上传，换设备会重新开始。</p>'
  }

  /* 逐字歌词（网易云 klyric）：行内每段都带自己的时间戳，
     格式 [mm:ss.xx]字[mm:ss.xx]字… */
  function parseKrc (txt) {
    var out = []
    if (!txt) return out
    txt.split('\n').forEach(function (line) {
      var head = line.match(/^\[(\d+):(\d+)(?:[.:](\d+))?\]/)
      if (!head) return
      var lt = Number(head[1]) * 60 + Number(head[2]) + (head[3] ? Number('0.' + head[3]) : 0)
      var words = []
      var re = /\[(\d+):(\d+)(?:[.:](\d+))?\]([^\[]*)/g
      var m, plain = ''
      while ((m = re.exec(line))) {
        var t = Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number('0.' + m[3]) : 0)
        var s = m[4]
        if (s) { words.push({ t: t, s: s }); plain += s }
      }
      if (words.length) out.push({ t: lt, s: plain, words: words })
    })
    out.sort(function (a, b) { return a.t - b.t })
    return out
  }

  /* ── 主题与字号 ── */
  function applyTheme () {
    var r = document.documentElement
    r.setAttribute('data-sxq-theme', MS.theme || 'default')
    r.style.setProperty('--sxq-fs', String(MS.fontScale || 1))
  }

  /* ── 每日推荐：按日期做种子，从当日飙升榜里挑 20 首（当天缓存） ── */
  function todayKey () {
    var d = new Date()
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate()
  }
  async function getDaily () {
    if (MS.daily && MS.daily.date === todayKey() && MS.daily.songs && MS.daily.songs.length) return MS.daily.songs
    // 用 toplist 取飙升榜（第一项通常是飙升榜），再按日期种子洗牌
    var b = await nc('toplist')
    var list = (b && b.list) || []
    if (!list.length) throw new Error('榜单为空')
    var target = list.find(function (x) { return /飙升|新歌/.test(x.name || '') }) || list[0]
    var d = await nc('playlist_detail', { id: target.id })
    var tracks = ((d.playlist && d.playlist.tracks) || []).slice()
    // 日期做种子的确定性洗牌（同一天结果一致）
    var seed = 0
    var key = todayKey()
    for (var i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) >>> 0
    function rnd () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    for (var j = tracks.length - 1; j > 0; j--) {
      var k = Math.floor(rnd() * (j + 1))
      var t = tracks[j]; tracks[j] = tracks[k]; tracks[k] = t
    }
    var songs = tracks.slice(0, 20)
    MS.daily = { date: key, songs: songs, from: target.name || '榜单' }
    saveAll()
    return songs
  }

  /* ── 私人 FM：收藏 + 最近播放 + 每日推荐 混成无限流 ── */
  function fmPool () {
    var pool = [], seen = {}
    function push (arr) {
      (arr || []).forEach(function (s) {
        if (!s || s.id == null) return
        var k = String(s.id)
        if (seen[k]) return
        seen[k] = 1; pool.push(s)
      })
    }
    push(MS.favs)
    push(MS.recent)
    push(MS.daily && MS.daily.songs)
    return pool
  }
  function startFM () {
    var pool = fmPool()
    if (pool.length < 3) return toast('FM 需要一点底料：先收藏几首，或听几首')
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1))
      var t = pool[i]; pool[i] = pool[j]; pool[j] = t
    }
    try { msSetQueue(pool, '私人 FM', 0) } catch (e) {}
    msPlay()
    toast('私人 FM 开始，共 ' + pool.length + ' 首；不喜欢就点下一首')
    paint()
  }

  /* ── 桌面角标（PWA / 支持的浏览器） ── */
  function setBadge (n) {
    try {
      if (n > 0 && navigator.setAppBadge) navigator.setAppBadge(n)
      else if (navigator.clearAppBadge) navigator.clearAppBadge()
    } catch (e) {}
  }

  /* ═══════════ 8.98 歌曲评论（用尚贤圈自己的接口） ═══════════ */
  function fmtAgo (t) {
    try {
      var d = (Date.now() - new Date(t).getTime()) / 1000
      if (d < 60) return '刚刚'
      if (d < 3600) return Math.floor(d / 60) + ' 分钟前'
      if (d < 86400) return Math.floor(d / 3600) + ' 小时前'
      if (d < 2592000) return Math.floor(d / 86400) + ' 天前'
      return String(t).slice(0, 10)
    } catch (e) { return '' }
  }
  async function loadComments () {
    var host = $q('[data-role="cmtlist"]')
    if (!host) return
    var t = track()
    if (!t) { host.innerHTML = '<div class="mp-empty">还没有在播放的歌曲</div>'; return }
    host.innerHTML = '<div class="mp-empty">评论加载中…</div>'
    try {
      var d = await rpc('xq_song_comment_list', { songId: String(t.id) })
      var list = (d && d.list) || []
      if (!list.length) {
        host.innerHTML = '<div class="mp-empty">还没有人评论这首歌。<br>你可以是第一个。</div>'
        return
      }
      host.innerHTML = list.map(function (c) {
        return '<div class="mp-cmt" data-cid="' + c.id + '">' +
          '<div class="mp-cmt-hd"><b>' + esc2(c.name) + '</b><time>' + fmtAgo(c.createTime) + '</time>' +
          (c.mine ? '<button class="mp-cmt-del" data-act="cmtdel" data-id="' + c.id + '">删除</button>' : '') +
          '</div><p>' + esc2(c.content) + '</p></div>'
      }).join('')
    } catch (e) {
      var m = (e && e.message) || ''
      host.innerHTML = '<div class="mp-empty">' +
        (/Could not find|PGRST202|does not exist/i.test(m)
          ? '评论功能还没开通（数据库补丁 033 未执行）'
          : '评论加载失败：' + esc2(m)) + '</div>'
    }
  }
  async function sendComment () {
    var t = track()
    if (!t) return toast('还没有在播放的歌曲')
    var inp = $q('[data-role="cmtin"]')
    var v = inp ? String(inp.value || '').trim() : ''
    if (v.length < 2) return toast('至少写 2 个字')
    var btn = $q('[data-act="cmtsend"]')
    if (btn) btn.disabled = true
    try {
      await rpc('xq_song_comment_add', { songId: String(t.id), songName: t.name || '', content: v })
      if (inp) inp.value = ''
      toast('评论已发布')
      loadComments()
    } catch (e) {
      toast((e && e.message) || '发布失败，稍后再试')
    } finally { if (btn) btn.disabled = false }
  }
  async function delComment (id) {
    try {
      await rpc('xq_song_comment_del', { id: Number(id) })
      toast('已删除')
      loadComments()
    } catch (e) { toast((e && e.message) || '删除失败') }
  }

  /* ═══════════ 8.99 一起听（Supabase Realtime 广播，不需要建表） ═══════════
     原理：用一个房间号开一条 Realtime broadcast 频道；
     房主每次播放/暂停/切歌/拖进度都会广播一条 sync；
     其他人收到后跟随（跳歌 + 对齐进度）。 */
  var TG = { ch: null, room: '', host: false, applying: false, roomIn: '', members: [], acts: [] }

  function tgMe () {
    try {
      if (MS.profile && MS.profile.nickname) return MS.profile.nickname
      if (window.S && S.me && S.me.email) return String(S.me.email).split('@')[0]
    } catch (e) {}
    return '同学'
  }
  function tgPushAct (text) {
    if (!text) return
    TG.acts.unshift({ t: text, at: Date.now() })
    if (TG.acts.length > 24) TG.acts.length = 24
    // 房间动态也给房间里的人看
    try {
      if (TG.ch && TG.host) TG.ch.send({ type: 'broadcast', event: 'act', payload: { t: text, at: Date.now() } })
    } catch (e) {}
    paintRoom()
  }
  function tgFmtTime (t) {
    try {
      var d = new Date(t)
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
    } catch (e) { return '' }
  }
  function tgToast (t) { toast(t) }
  function tgPayload () {
    var t = track()
    return {
      id: t ? t.id : null,
      name: t ? t.name : '',
      ar: t ? msArtists(t) : '',
      queue: (MS.queue || []).slice(0, 60),
      idx: MS.idx,
      at: (MS.audio && MS.audio.currentTime) || 0,
      playing: !!MS.playing,
      loop: MS.loop,
      ts: Date.now()
    }
  }
  function tgBroadcast () {
    if (!TG.ch || !TG.host || TG.applying) return
    var p = tgPayload()
    try { TG.ch.send({ type: 'broadcast', event: 'sync', payload: p }) } catch (e) {}
    // 切歌也算房间动态
    if (p.name && TG.lastName !== p.name) {
      TG.lastName = p.name
      tgPushAct(tgMe() + ' 切到了《' + p.name + '》')
    }
  }
  function tgClient () {
    /* ⚠️ 关键：app.js 里是 `const sbAuth = supabase.createClient(...)`，
       const/let 只创建**全局词法绑定**，**不会挂到 window 上**。
       所以 `window.sbAuth` 永远是 undefined —— 之前一起听报「环境不支持」就是这个原因。
       正确做法：用 typeof 守卫直接引用裸标识符。 */
    try {
      if (typeof sbAuth !== 'undefined' && sbAuth && typeof sbAuth.channel === 'function') return sbAuth
    } catch (e) {}
    try {
      if (window.sbAuth && typeof window.sbAuth.channel === 'function') return window.sbAuth
    } catch (e) {}
    return null
  }
  function tgJoin (room, asHost) {
    var client = tgClient()
    if (!client) return tgToast('一起听需要实时通道，当前环境不支持')
    tgLeave(true)
    TG.room = room
    TG.host = !!asHost
    try {
      var ch = client.channel('sxq-listen-' + room, { config: { broadcast: { self: false } } })
      // ① 同步指令
      ch.on('broadcast', { event: 'sync' }, function (m) {
        if (TG.host) return                       // 房主不听别人的
        var p = m && m.payload
        if (!p || !p.id) return
        TG.applying = true
        try {
          if (String((track() || {}).id) !== String(p.id)) {
            var i = (p.queue || []).findIndex(function (x) { return String(x.id) === String(p.id) })
            if (i >= 0) msSetQueue(p.queue, '一起听 · ' + room, i)
            else if (p.queue && p.queue.length) msSetQueue(p.queue, '一起听 · ' + room, Math.min(p.idx || 0, p.queue.length - 1))
            msPlay()
          }
          // 对齐进度：差超过 2 秒才拉，避免频繁打断
          setTimeout(function () {
            try {
              if (MS.audio && isFinite(p.at)) {
                var d = Math.abs(MS.audio.currentTime - p.at)
                if (d > 2) MS.audio.currentTime = p.at
              }
              if (p.playing && !MS.playing) msToggle()
              if (!p.playing && MS.playing) msToggle()
            } catch (e) {}
            setTimeout(function () { TG.applying = false }, 300)
          }, 500)
        } catch (e) { TG.applying = false }
        paint()
      })
      // ② 房间动态（谁切了歌、谁暂停了）
      ch.on('broadcast', { event: 'act' }, function (m) {
        var p = m && m.payload
        if (!p || !p.t) return
        TG.acts.unshift({ t: p.t, at: p.at || Date.now() })
        if (TG.acts.length > 24) TG.acts.length = 24
        paintRoom()
      })

      // ③ 在线状态（presence）：进房 / 离房 / 成员同步——Supabase 自带，不用建表
      ch.on('presence', { event: 'sync' }, function () {
        try {
          var st = ch.presenceState()
          var ms = []
          Object.keys(st).forEach(function (k) {
            (st[k] || []).forEach(function (p) { ms.push(p) })
          })
          TG.members = ms
        } catch (e) { TG.members = [] }
        paintRoom(); paint()
      })
      ch.on('presence', { event: 'join' }, function (p) {
        var n = ((p.newPresences || [])[0] || {}).name
        if (n && n !== tgMe()) tgPushAct(n + ' 加入了房间')
      })
      ch.on('presence', { event: 'leave' }, function (p) {
        var n = ((p.leftPresences || [])[0] || {}).name
        if (n && n !== tgMe()) tgPushAct(n + ' 离开了房间')
      })

      ch.subscribe(function (st) {
        if (st !== 'SUBSCRIBED') return
        // 广播自己在场（在线人数就靠这个）
        try { ch.track({ name: tgMe(), at: Date.now() }) } catch (e) {}
        tgPushAct(TG.host ? ('你创建了房间 ' + room) : (tgMe() + ' 加入了房间'))
        tgToast(TG.host ? '一起听已开启，房间号 ' + room + '，把链接发给同学' : '已加入房间 ' + room)
        if (TG.host) tgBroadcast()
        paintRoom(); paint()
      })
      TG.ch = ch
      try { history.replaceState(history.state, '', '?room=' + room + location.hash) } catch (e) {}
      paint()
    } catch (e) { tgToast('加入失败，请稍后再试') }
  }
  function tgLeave (silent) {
    var client = tgClient()
    var wasRoom = TG.room
    try { if (TG.ch && client) client.removeChannel(TG.ch) } catch (e) {}
    TG.ch = null; TG.room = ''
    TG.members = []; TG.acts = []
    paintRoom()
    if (!silent && wasRoom) {
      tgToast('已退出房间')
      try { history.replaceState(history.state, '', location.pathname + location.hash) } catch (e) {}
      paint()
    }
  }
  function tgShare () {
    if (!TG.room) return
    var url = location.origin + location.pathname + '?room=' + TG.room
    var done = function () { tgToast('链接已复制，发给同学就能一起听') }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { tgToast('请手动复制地址栏链接') })
    else tgToast('请手动复制地址栏链接')
  }
  function tgStart () {
    var room = String(Math.floor(1000 + Math.random() * 9000))
    tgJoin(room, true)
  }
  function tgAutoJoin () {
    var q
    try { q = new URLSearchParams(location.search) } catch (e) { return }
    var room = q.get('room')
    if (room && /^\d{4}$/.test(room)) tgJoin(room, false)
  }

  /* ═══════════ 8.100 外部歌单导入（解析链接里的 ID） ═══════════ */
  function extractPlaylistId (raw) {
    var s = String(raw || '').trim()
    if (!s) return ''
    // 网易云：music.163.com/#/playlist?id=123456  /  ?id=123456  /  纯数字
    var m = s.match(/[?&#]id=(\d{4,})/) || s.match(/playlist\/(\d{4,})/) || s.match(/^(\d{4,})$/)
    if (m && /163\.com/.test(s)) return m[1]
    // 网易云短链 / 其它平台
    if (/163\.com/.test(s)) return m ? m[1] : ''
    if (/y\.qq\.com|c6\.y\.qq\.com/.test(s)) return 'QQ'
    if (/kugou\.com/.test(s)) return 'KG'
    return m ? m[1] : ''
  }
  async function importExternal (raw) {
    var id = extractPlaylistId(raw)
    if (!id) return tgToast('没识别出歌单 ID。请粘贴网易云的歌单链接（含 id=数字）')
    if (id === 'QQ' || id === 'KG') {
      var plat = id === 'QQ' ? 'QQ 音乐' : '酷狗'
      return tgToast(plat + ' 的歌单需要另外对接接口，当前还没做。可以先用网易云的同名歌单。')
    }
    tgToast('正在导入歌单…')
    try {
      var b = await nc('playlist_detail', { id: id })
      var pl = (b && b.playlist) || {}
      var tracks = pl.tracks || []
      if (!tracks.length) return tgToast('这个歌单没有可播放的曲目')
      try { msSetQueue(tracks, pl.name || '导入的歌单', 0) } catch (e) {}
      toast('已导入《' + (pl.name || '歌单') + '》，共 ' + tracks.length + ' 首')
      paint()
    } catch (e) {
      tgToast('导入失败：' + ((e && e.message) || '请检查链接'))
    }
  }

  /* ── 房间状态面板：房间号 / 在线人数 / 成员 / 房间动态 ── */
  function paintRoom () {
    var host = $q('[data-role="room"]')
    if (!host) return
    if (!TG.room) { host.innerHTML = ''; return }
    var ms = TG.members || []
    var n = Math.max(1, ms.length)
    var seen = {}
    var names = []
    ms.forEach(function (m) {
      var nm = (m && m.name) || '同学'
      if (seen[nm]) return
      seen[nm] = 1; names.push(nm)
    })
    host.innerHTML =
      '<div class="mp-room">' +
        '<div class="mp-room-hd">' +
          '<b>房间 ' + esc2(TG.room) + '</b>' +
          '<span class="mp-room-live' + (n > 1 ? ' multi' : '') + '"><i></i>在线 ' + n + ' 人</span>' +
        '</div>' +
        '<div class="mp-room-mem">' +
          names.map(function (nm) { return '<span class="mp-mem">' + esc2(nm) + '</span>' }).join('') +
        '</div>' +
        '<div class="mp-room-acts">' +
          (TG.acts.length
            ? TG.acts.slice(0, 8).map(function (a) {
                return '<div class="mp-room-act"><time>' + tgFmtTime(a.at) + '</time><span>' + esc2(a.t) + '</span></div>'
              }).join('')
            : '<div class="mp-room-act empty"><span>房间刚建立，还没有动态</span></div>') +
        '</div>' +
      '</div>'
  }

  /* ═══════════ 9. 启动 ═══════════ */
  function boot () {
    applyTheme()                  // 先应用主题与字号，避免闪一下
    buildUI()
    bind()
    readSharedPlaylist()          // 别人分享的歌单链接：进来就自动载入
    tgAutoJoin()                  // ?room=1234 → 自动加入一起听
    initRailParallax()            // 右栏逐卡视差
    initGlass()                   // 真·液态玻璃
    // 桌面角标：跟随未读通知数（app.js 把未读数写在 #hdDot 上）
    try {
      var dot = document.getElementById('hdDot')
      if (dot) {
        setBadge(dot.hidden ? 0 : 1)
        new MutationObserver(function () { setBadge(dot.hidden ? 0 : 1) })
          .observe(dot, { attributes: true, attributeFilter: ['hidden'] })
      }
    } catch (e) {}
    // 等 app.js 的 initMusic() 建好 audio 再挂
    var tries = 0
    var t = setInterval(function () {
      tries++
      if (MS.audio) { clearInterval(t); hook() }
      else if (tries > 60) clearInterval(t)
      paint()
    }, 300)
    paint()
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()

  // 暴露给外部（音乐库要用：最近播放、导入、刷新）
  window.SXQ_MP = {
    paint: paint,
    loadLyric: loadLyric,
    saveAll: saveAll,
    recent: function () { return (MS.recent || []).slice() },
    report: reportHTML,
    importFrom: doImport,
    importFromClipboard: importFromClipboard
  }
})()
