/*!
 * 尚贤圈产品片 · 贤圈中心「广场顶部视频带」
 * ─────────────────────────────────────────────────────────────
 * 用户要求：静音自动循环 + **每次进站都播**，放在广场顶部。
 * 自包含：不依赖 app.js 内部状态，只在 feed 渲染后把自己挂上去。
 * 广场是 SPA 的 hash 路由（#/feed），所以用 MutationObserver 监听重绘。
 */
(function () {
  'use strict'

  var SRC = './assets/sxq-product-film.mp4'
  var POSTER = './assets/sxq-product-film-poster.jpg'
  var HOST_ID = 'sxqFilmBand'
  var MOUNT_RETRY = 0

  var CSS = `
  .filmband{
    position:relative;margin:0 0 18px;border-radius:16px;overflow:hidden;
    background:#0c0b0a;border:1px solid rgba(31,28,24,.1);
    box-shadow:0 18px 48px rgba(31,28,24,.14);
    animation:fbIn .62s cubic-bezier(.16,1,.3,1) both;
  }
  @keyframes fbIn{from{opacity:0;transform:translateY(16px) scale(.985)}to{opacity:1;transform:none}}
  .filmband video{display:block;width:100%;height:auto;background:#0c0b0a}
  .filmband-cap{
    position:absolute;left:0;right:0;bottom:0;padding:20px 24px;
    background:linear-gradient(180deg,transparent,rgba(12,11,10,.86));
    display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;
    pointer-events:none;
  }
  .filmband-cap > *{pointer-events:auto}
  .filmband-k{
    font:800 10px/1 ui-monospace,Consolas,monospace;letter-spacing:.24em;
    text-transform:uppercase;color:#d9b96a;margin-bottom:8px;
  }
  .filmband-t{
    font-family:"Songti SC","Noto Serif SC",serif;font-weight:900;
    font-size:clamp(19px,2.6vw,30px);color:#fff;letter-spacing:.01em;line-height:1.2;
    text-shadow:0 3px 22px rgba(0,0,0,.6);
  }
  .filmband-s{
    font-size:13px;color:rgba(255,255,255,.72);margin-top:7px;line-height:1.65;max-width:46ch;
  }
  .filmband-ctl{display:flex;gap:7px;position:absolute;right:14px;top:14px;opacity:0;transition:opacity .28s}
  .filmband:hover .filmband-ctl,.filmband:focus-within .filmband-ctl{opacity:1}
  .filmband-btn{
    appearance:none;border:1px solid rgba(255,255,255,.28);background:rgba(12,11,10,.56);
    color:#fff;font:800 10.5px/1 ui-monospace,monospace;letter-spacing:.12em;
    padding:8px 12px;border-radius:999px;cursor:pointer;backdrop-filter:blur(8px);
    transition:all .16s cubic-bezier(.4,0,.2,1);
  }
  .filmband-btn:hover{background:rgba(214,72,47,.88);border-color:transparent}
  .filmband-prog{position:absolute;left:0;right:0;bottom:0;height:2.5px;background:rgba(255,255,255,.16)}
  .filmband-prog i{display:block;height:100%;width:0;background:linear-gradient(90deg,#d6482f,#b98a2f)}
  .filmband-play{
    position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;
    background:radial-gradient(ellipse at center,rgba(12,11,10,.16),rgba(12,11,10,.46));
    transition:opacity .6s cubic-bezier(.16,1,.3,1);
  }
  .filmband-play i{
    width:66px;height:66px;border-radius:50%;display:grid;place-items:center;
    background:rgba(255,255,255,.94);color:#d6482f;font-size:22px;padding-left:4px;
    box-shadow:0 12px 36px rgba(0,0,0,.3);
  }
  .filmband.playing .filmband-play{opacity:0}
  @media(max-width:720px){ .filmband-ctl{opacity:1;right:10px;top:10px} }
  @media(prefers-reduced-motion:reduce){ .filmband{animation:none} }
  `

  function injectCss () {
    if (document.getElementById('fbCss')) return
    var s = document.createElement('style')
    s.id = 'fbCss'
    s.textContent = CSS
    document.head.appendChild(s)
  }

  function build () {
    var wrap = document.createElement('div')
    wrap.className = 'filmband'
    wrap.id = HOST_ID

    var v = document.createElement('video')
    v.src = SRC; v.poster = POSTER
    v.muted = true; v.loop = true; v.playsInline = true
    v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '')
    v.preload = 'metadata'
    v.setAttribute('aria-label', '尚贤圈是什么 · 产品片')
    wrap.appendChild(v)

    var prog = document.createElement('div')
    prog.className = 'filmband-prog'; prog.innerHTML = '<i></i>'
    wrap.appendChild(prog)

    var ctl = document.createElement('div')
    ctl.className = 'filmband-ctl'
    var bm = document.createElement('button')
    bm.className = 'filmband-btn'; bm.type = 'button'; bm.textContent = '开声音'
    var br = document.createElement('button')
    br.className = 'filmband-btn'; br.type = 'button'; br.textContent = '重播'
    ctl.appendChild(bm); ctl.appendChild(br)
    wrap.appendChild(ctl)

    var play = document.createElement('div')
    play.className = 'filmband-play'; play.innerHTML = '<i>▶</i>'
    wrap.appendChild(play)

    var cap = document.createElement('div')
    cap.className = 'filmband-cap'
    cap.innerHTML =
      '<div>' +
        '<div class="filmband-k">SHANGXIANQUAN · PRODUCT FILM</div>' +
        '<div class="filmband-t">尚贤圈，是什么</div>' +
        '<div class="filmband-s">六大板块一次讲完。片中所有界面都是手绘线稿，没有用任何截图。</div>' +
      '</div>'
    wrap.appendChild(cap)

    var bar = prog.querySelector('i')
    v.addEventListener('timeupdate', function () {
      if (!v.duration) return
      bar.style.width = ((v.currentTime / v.duration) * 100).toFixed(2) + '%'
    })
    var tryPlay = function () {
      var p = v.play()
      if (p && p.catch) p.catch(function () {})
    }
    v.addEventListener('playing', function () { wrap.classList.add('playing') })
    v.addEventListener('pause', function () { wrap.classList.remove('playing') })
    bm.addEventListener('click', function () {
      v.muted = !v.muted
      bm.textContent = v.muted ? '开声音' : '关声音'
      if (!v.muted) tryPlay()
    })
    br.addEventListener('click', function () { v.currentTime = 0; tryPlay() })
    v.addEventListener('click', function () { if (v.paused) tryPlay(); else v.pause() })
      /* 用户明确要求：音乐不要停 → 不做「滚走暂停」，始终播放 */
      tryPlay()

    wrap._video = v
    return wrap
  }

  /** 挂到广场主列顶部 */
  function mount () {
    injectCss()
    if (document.getElementById(HOST_ID)) return
    var hash = String(location.hash || '').replace('#', '')
    if (hash && hash !== 'feed') { // 只在广场页出现
      return
    }
    var main = document.getElementById('main')
    if (!main) return
    var col = main.querySelector('.cell.c-main') || main.querySelector('.cell')
    if (!col) { // 还没渲染好，稍后重试
      if (MOUNT_RETRY++ < 20) setTimeout(mount, 400)
      return
    }
    MOUNT_RETRY = 0
    col.insertBefore(build(), col.firstChild)
  }

  /** SPA 换页会重建 DOM → 监听 body 变化自动补挂 */
  function watch () {
    mount()
    try {
      var mo = new MutationObserver(function () { clearTimeout(mo._t); mo._t = setTimeout(mount, 260) })
      var main = document.getElementById('main')
      if (main) mo.observe(main, { childList: true, subtree: false })
      window.addEventListener('hashchange', function () { setTimeout(mount, 320) })
    } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch)
  else watch()
})()
