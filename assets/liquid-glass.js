/*! 尚贤圈 · 真液态玻璃（liquid-glass.js）
 *
 *  原理（参考 shuding/liquid-glass 的 SVG 位移折射思路，独立实现）：
 *    ① 用 canvas 按「圆角矩形距离场（roundedRectSDF）」算出一张位移贴图，
 *       把靠近边缘的像素**向内拉**，形成透镜/折射感；
 *    ② dx/dy 编码进贴图的 R/G 通道；
 *    ③ 建一个 SVG <filter>：feImage 放贴图 → feDisplacementMap 按 R/G 位移；
 *    ④ 元素上写 backdrop-filter: url(#filter) blur() contrast() brightness() saturate()
 *
 *  ⚠️ 关键性能设计：**位移贴图只算一次**（与 shuding 原版不同——原版跟随鼠标每帧重算）。
 *     本实现不依赖鼠标，所以贴图是静态的；只在尺寸变化时防抖重算。
 *     → 运行时零逐帧计算，只有浏览器合成的 backdrop 采样，成本可控。
 *
 *  用法：
 *    LiquidGlass.attach(el)            // 单个元素
 *    LiquidGlass.attachAll('.card')    // 批量
 *    LiquidGlass.refresh()             // 尺寸变化后重算（内部已自动监听）
 */
(function () {
  'use strict'

  var UID = 0
  var reg = []            // { el, id, w, h, opts }

  /* ── 数学工具 ── */
  function smoothStep (a, b, t) {
    t = Math.max(0, Math.min(1, (t - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }
  function len (x, y) { return Math.sqrt(x * x + y * y) }
  /* 圆角矩形有符号距离场：<0 在内部，0 在边界，>0 在外部 */
  function roundedRectSDF (x, y, halfW, halfH, r) {
    var qx = Math.abs(x) - halfW + r
    var qy = Math.abs(y) - halfH + r
    return Math.min(Math.max(qx, qy), 0) + len(Math.max(qx, 0), Math.max(qy, 0)) - r
  }

  /* ── 生成位移贴图（canvas → dataURL） ── */
  function buildMap (w, h, opts) {
    var dpr = 1
    var cvs = document.createElement('canvas')
    cvs.width = Math.max(2, Math.round(w * dpr))
    cvs.height = Math.max(2, Math.round(h * dpr))
    var ctx = cvs.getContext('2d')
    var W = cvs.width, H = cvs.height

    // 形状参数（归一化 0~1）
    var inset = opts.inset != null ? opts.inset : 0.02
    var halfW = 0.5 - inset
    var halfH = 0.5 - inset
    var roundness = opts.roundness != null ? opts.roundness : 1
    var r = Math.min(halfW, halfH) * roundness
    var edge = opts.edge != null ? opts.edge : 0.12      // 边缘折射带宽度
    var strength = opts.strength != null ? opts.strength : 1

    var data = new Uint8ClampedArray(W * H * 4)
    var maxScale = 0
    var raw = []

    for (var i = 0; i < data.length; i += 4) {
      var x = (i / 4) % W
      var y = Math.floor((i / 4) / W)
      var ux = x / W, uy = y / H
      var ix = ux - 0.5, iy = uy - 0.5
      var d = roundedRectSDF(ix, iy, halfW, halfH, r)
      // 离边界越近，位移越强；内部趋 0
      var disp = smoothStep(edge, 0, d - edge * 0.35)
      var scaled = smoothStep(0, 1, disp) * strength
      var nx = ix * scaled + 0.5
      var ny = iy * scaled + 0.5
      var dx = nx * W - x
      var dy = ny * H - y
      if (Math.abs(dx) > maxScale) maxScale = Math.abs(dx)
      if (Math.abs(dy) > maxScale) maxScale = Math.abs(dy)
      raw.push(dx, dy)
    }
    maxScale *= 0.5
    if (maxScale < 0.0001) maxScale = 1

    var k = 0
    for (var j = 0; j < data.length; j += 4) {
      data[j] = (raw[k++] / maxScale + 0.5) * 255        // R = x 位移
      data[j + 1] = (raw[k++] / maxScale + 0.5) * 255    // G = y 位移
      data[j + 2] = 0
      data[j + 3] = 255
    }
    ctx.putImageData(new ImageData(data, W, H), 0, 0)
    return { url: cvs.toDataURL(), scale: maxScale / dpr }
  }

  /* ── 建 SVG filter ── */
  function makeFilter (id, w, h, mapUrl, scale) {
    var NS = 'http://www.w3.org/2000/svg'
    var svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('width', '0')
    svg.setAttribute('height', '0')
    svg.setAttribute('aria-hidden', 'true')
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none'

    var defs = document.createElementNS(NS, 'defs')
    var filter = document.createElementNS(NS, 'filter')
    filter.setAttribute('id', id)
    filter.setAttribute('filterUnits', 'userSpaceOnUse')
    filter.setAttribute('colorInterpolationFilters', 'sRGB')
    filter.setAttribute('x', '0'); filter.setAttribute('y', '0')
    filter.setAttribute('width', String(w)); filter.setAttribute('height', String(h))

    var img = document.createElementNS(NS, 'feImage')
    img.setAttribute('width', String(w)); img.setAttribute('height', String(h))
    img.setAttribute('preserveAspectRatio', 'none')
    img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', mapUrl)
    img.setAttribute('href', mapUrl)

    var dm = document.createElementNS(NS, 'feDisplacementMap')
    dm.setAttribute('in', 'SourceGraphic')
    dm.setAttribute('in2', id + '_map')
    dm.setAttribute('xChannelSelector', 'R')
    dm.setAttribute('yChannelSelector', 'G')
    dm.setAttribute('scale', String(scale))

    img.setAttribute('id', id + '_map')
    filter.appendChild(img)
    filter.appendChild(dm)
    defs.appendChild(filter)
    svg.appendChild(defs)
    document.body.appendChild(svg)
    return svg
  }

  /* ── 给元素挂玻璃 ── */
  function attach (el, opts) {
    if (!el || el.__lg) return
    opts = opts || {}
    var w = el.offsetWidth, h = el.offsetHeight
    if (w < 8 || h < 8) return          // 太小或不可见，跳过
    var id = 'lg' + (++UID)
    var map = buildMap(w, h, opts)
    var svg = makeFilter(id, w, h, map.url, map.scale)
    // 玻璃本体：折射 + 极轻的对比/亮度/饱和修正（不是大范围模糊）
    var chain = 'url(#' + id + ')'
    if (opts.extraBlur !== false) chain += ' blur(' + (opts.blur || 0.6) + 'px)'
    chain += ' contrast(' + (opts.contrast || 1.16) + ')'
    chain += ' brightness(' + (opts.brightness || 1.04) + ')'
    chain += ' saturate(' + (opts.saturate || 1.2) + ')'
    el.style.setProperty('-webkit-backdrop-filter', chain)
    el.style.setProperty('backdrop-filter', chain)
    // 同时写进 CSS 变量：CSS 里用 .lg-on{backdrop-filter:var(--lg-f)!important}
    // 就能压过之前那些 !important 的关模糊规则（内联样式压不过 !important）
    el.style.setProperty('--lg-f', chain)
    el.classList.add('lg-on')
    el.__lg = { id: id, svg: svg, w: w, h: h, opts: opts }
    reg.push(el)
  }

  function attachAll (sel, opts) {
    var list = document.querySelectorAll(sel)
    for (var i = 0; i < list.length; i++) attach(list[i], opts)
  }

  /* ── 尺寸变化后重算（防抖，且只在尺寸真的变了才重算） ── */
  var t = null
  function refresh () {
    clearTimeout(t)
    t = setTimeout(function () {
      reg = reg.filter(function (el) { return el.isConnected })
      reg.forEach(function (el) {
        var o = el.__lg
        if (!o) return
        var w = el.offsetWidth, h = el.offsetHeight
        if (Math.abs(w - o.w) < 2 && Math.abs(h - o.h) < 2) return
        if (o.svg && o.svg.parentNode) o.svg.parentNode.removeChild(o.svg)
        el.__lg = null
        el.classList.remove('lg-on')
        el.style.removeProperty('-webkit-backdrop-filter')
        el.style.removeProperty('backdrop-filter')
        attach(el, o.opts)
      })
    }, 320)
  }
  window.addEventListener('resize', refresh, { passive: true })

  /* ── 路由/ DOM 变化后自动补挂（贤圈中心会重建 DOM） ── */
  var autoSel = []
  function auto (sel, opts) {
    autoSel.push({ sel: sel, opts: opts })
    attachAll(sel, opts)
  }
  function scanAuto () {
    autoSel.forEach(function (a) { attachAll(a.sel, a.opts) })
  }
  try {
    var mo = new MutationObserver(function () { clearTimeout(mo._t); mo._t = setTimeout(scanAuto, 400) })
    var main = document.getElementById('main') || document.body
    mo.observe(main, { childList: true, subtree: true })
  } catch (e) {}
  setTimeout(scanAuto, 1200)

  window.LiquidGlass = {
    attach: attach,
    attachAll: attachAll,
    auto: auto,
    refresh: refresh
  }
})()
