/**
 * 音素驱动的像素风 SVG 人脸嘴型模块。
 *
 * 设计要点：
 * 1) 所有视位共用一个参数化「嘴」模型：w(半宽)/h(半高)/r(圆角)/teeth/tongue，
 *    改参数而不换元素，风格保持统一；
 * 2) 在 requestAnimationFrame 循环里对参数做线性插值（lerp），避免瞬变导致的闪动；
 * 3) 对外暴露 PhonemeFaceApi.renderGallery(container) 以在页面底部展示全部视位预览。
 * 4) 眼睛：眨眼 + 随嘴张开度微调 + 随播放时间轻微扫视；暂停时单独 rAF 仍驱动眨眼。
 */
(function () {
  "use strict";

  /** @type {{ start_sec: number, end_sec: number, phone: string }[] | null} */
  let segments = null;
  /** 暂停/空闲时仅刷新眼睛的 rAF id，避免不播放时眼睛完全静止。 */
  let eyeIdleRaf = null;
  /** TTS 等待返回期间的场景预览 rAF id（无 segments 也持续动画）。 */
  let sceneWaitingRaf = null;
  /** 当前目标视位 key，由 update(t) 设置。 */
  let targetKey = "REST";
  /** 正在显示的插值参数，每帧向 VISEMES[targetKey] 靠拢。 */
  let displayParams = { w: 6, h: 2, r: 1, teeth: 0, tongue: 0 };

  // 每个视位只是一组参数，SVG 结构不变：
  // - w/h 以 (0,0) 为嘴中心的半宽/半高
  // - r 控制圆角（大 r 形成圆，小 r 形成窄缝/扁方）
  // - teeth 上排牙线可见度（0~1）
  // - tongue 舌头小三角可见度（0~1）
  const VISEMES = {
    REST: { w: 6.9, h: 2, r: 1, teeth: 0, tongue: 0, label: "REST 静音" },
    EE: { w: 12.4, h: 2.2, r: 1.1, teeth: 0.2, tongue: 0, label: "EE i/ee 扁窄" },
    EH: { w: 12.9, h: 3, r: 1.8, teeth: 0.15, tongue: 0, label: "EH e/eh 中扁" },
    AH: { w: 8.6, h: 5, r: 4.5, teeth: 0, tongue: 0, label: "AH a 中圆" },
    AO: { w: 9.7, h: 7, r: 6.5, teeth: 0, tongue: 0, label: "AO ao 大圆" },
    AW: { w: 9.2, h: 6, r: 5.5, teeth: 0, tongue: 0, label: "AW aw 中大圆" },
    OH: { w: 10.3, h: 4, r: 3.6, teeth: 0, tongue: 0, label: "OH ou 扁长" },
    OO: { w: 5.5, h: 4.8, r: 4.6, teeth: 0, tongue: 0, label: "OO u 小圆" },
    OU: { w: 6.9, h: 5.2, r: 4.8, teeth: 0, tongue: 0, label: "OU ou 中圆" },
    BMP: { w: 10.3, h: 1, r: 0.9, teeth: 0, tongue: 0, label: "B/M/P 闭合" },
    CHJH: { w: 9.2, h: 2.5, r: 1.3, teeth: 0.6, tongue: 0, label: "CH/JH 塞擦" },
    FV: { w: 9.7, h: 2, r: 1, teeth: 1, tongue: 0, label: "F/V 唇齿" },
    R: { w: 5.7, h: 4, r: 3, teeth: 0, tongue: 0, label: "R 卷舌小圆" },
    L: { w: 9.2, h: 3.2, r: 1.6, teeth: 0, tongue: 1, label: "L 舌尖抵齿龈" },
    N: { w: 9.2, h: 2.8, r: 1.8, teeth: 0.25, tongue: 0, label: "N/NG 鼻音" },
    KG: { w: 6.9, h: 4, r: 3, teeth: 0, tongue: 0, label: "K/G/H 软腭" },
    S: { w: 9.7, h: 1.8, r: 0.9, teeth: 1, tongue: 0, label: "S/Z 齿间窄缝" },
    // === 新增17个音素表情 ===
    TH: { w: 10.5, h: 2.2, r: 1.0, teeth: 0.85, tongue: 0.6, label: "TH 咬舌音" },
    DH: { w: 10.8, h: 2.4, r: 1.1, teeth: 0.8, tongue: 0.55, label: "DH 浊咬舌" },
    SH: { w: 7.8, h: 3.6, r: 3.2, teeth: 0, tongue: 0, label: "SH 清擦音" },
    ZH: { w: 8.2, h: 3.8, r: 3.4, teeth: 0, tongue: 0.15, label: "ZH 浊擦音" },
    W: { w: 6.2, h: 3.8, r: 3.6, teeth: 0, tongue: 0, label: "W 圆唇音" },
    Y: { w: 11.5, h: 2.0, r: 1.2, teeth: 0.3, tongue: 0, label: "Y 腭近音" },
    MM: { w: 10.3, h: 1.0, r: 0.9, teeth: 0, tongue: 0, label: "M 鼻音闭合" },
    NN: { w: 9.5, h: 2.5, r: 2.0, teeth: 0.3, tongue: 0, label: "N 鼻音" },
    TT: { w: 9.2, h: 2.0, r: 1.0, teeth: 0.9, tongue: 0.4, label: "T 塞音" },
    DD: { w: 9.4, h: 2.2, r: 1.1, teeth: 0.85, tongue: 0.35, label: "D 浊塞音" },
    PP: { w: 10.0, h: 0.8, r: 0.6, teeth: 0, tongue: 0, label: "P 爆破音" },
    BB: { w: 10.2, h: 0.9, r: 0.7, teeth: 0, tongue: 0, label: "B 浊爆破" },
    HH: { w: 8.5, h: 5.5, r: 4.8, teeth: 0, tongue: 0, label: "H 呼气音" },
    VV: { w: 9.8, h: 2.1, r: 1.0, teeth: 1, tongue: 0.1, label: "V 浊唇齿" },
    ZZ: { w: 9.9, h: 2.0, r: 0.95, teeth: 0.95, tongue: 0.2, label: "Z 浊齿擦" },
    CHH: { w: 8.8, h: 2.8, r: 1.5, teeth: 0.55, tongue: 0.1, label: "CH 清塞擦" },
    JH: { w: 9.0, h: 3.0, r: 1.6, teeth: 0.5, tongue: 0.15, label: "JH 浊塞擦" },
  };

  // 特殊眼形：key -> 主脸坐标系下的 SVG 片段。
  // 所有形状以「半径 3.6」为基准设计，预览卡里通过 scale(0.667) 缩小。
  const EYE_SHAPES = {
    NORMAL: '<circle cx="0" cy="0" r="3.6" fill="#ffffff"/>',
    DOT_BIG: '<circle cx="0" cy="0" r="3.4" fill="#ffffff"/>',
    DOT_SMALL: '<circle cx="0" cy="0" r="2.2" fill="#ffffff"/>',
    SLEEPY: '<line x1="-3.2" y1="0" x2="3.2" y2="0" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round"/>',
    HAPPY_ARC: '<path d="M -3.2 1 Q 0 -2.8 3.2 1" stroke="#ffffff" stroke-width="1.5" fill="none" stroke-linecap="round"/>',
    UP_ARC: '<path d="M -3 -0.2 Q 0 2.8 3 -0.2" stroke="#ffffff" stroke-width="1.5" fill="none" stroke-linecap="round"/>',
    X_MARK: '<path d="M -2.6 -2.6 L 2.6 2.6 M -2.6 2.6 L 2.6 -2.6" stroke="#ffffff" stroke-width="1.3" stroke-linecap="round" fill="none"/>',
    HEART: '<path d="M 0 3 C -3.6 1 -3.6 -2 -1.8 -2 C -0.7 -2 0 -1 0 -0.1 C 0 -1 0.7 -2 1.8 -2 C 3.6 -2 3.6 1 0 3 Z" fill="#ff6b9e"/>',
    STAR: '<polygon points="0,-3.4 0.95,-0.95 3.4,-0.95 1.45,0.55 2.1,2.9 0,1.6 -2.1,2.9 -1.45,0.55 -3.4,-0.95 -0.95,-0.95" fill="#ffd84d"/>',
    SWIRL: '<path d="M -2.4 0 Q 0 -2.6 2.4 0 Q 2.4 1.8 0 1.8 Q -1.4 1.8 -1.4 0.6 Q -1.4 -0.4 0 -0.4" stroke="#ffffff" stroke-width="0.9" fill="none" stroke-linecap="round"/>',
    COOL: '<rect x="-3.9" y="-1.7" width="7.8" height="3.4" rx="0.4" fill="#0b0b11" stroke="#ffffff" stroke-width="0.9"/>',
    SNOW: '<path d="M -3 0 L 3 0 M 0 -3 L 0 3 M -2.2 -2.2 L 2.2 2.2 M -2.2 2.2 L 2.2 -2.2" stroke="#93c5fd" stroke-width="1.1" stroke-linecap="round"/>',
    BULB: '<path d="M 0 -3 C -2.2 -3 -3.2 -1.6 -3.2 0 C -3.2 1.4 -2.4 2.4 -1.4 2.9 L -1.4 3.4 L 1.4 3.4 L 1.4 2.9 C 2.4 2.4 3.2 1.4 3.2 0 C 3.2 -1.6 2.2 -3 0 -3 Z" fill="#fde68a" stroke="#fef3c7" stroke-width="0.9"/>',
    // 圆框眼镜：留给其它表情/指令使用；开灯前半段已改为 NORMAL 日常眼。
    GLASSES:
      '<g fill="none" stroke="#e5e7eb" stroke-width="1.05" stroke-linecap="round">' +
      '<circle cx="-2.5" cy="0" r="2.65"/>' +
      '<circle cx="2.5" cy="0" r="2.65"/>' +
      '<line x1="-0.2" y1="0" x2="0.2" y2="0" stroke-width="1.35"/>' +
      '<line x1="-5.15" y1="0" x2="-5.9" y2="0.35"/>' +
      '<line x1="5.15" y1="0" x2="5.9" y2="0.35"/>' +
      "</g>",
    // 灯泡 emoji：开灯后半段由 paintEyes 切换到此眼形（依赖系统彩色字体）。
    BULB_EMOJI:
      '<text x="0" y="0" text-anchor="middle" dominant-baseline="central" font-size="15" ' +
      'font-family="Segoe UI Emoji, Apple Color Emoji, Noto Color Emoji, sans-serif">💡</text>',
    // 手绘惊悚风：不规则外轮廓 + 小瞳孔，贴近用户草图里的“垂眼皮”感觉。
    SKETCH_GHOST:
      '<path d="M -6.2 1.4 L -3.4 -1.4 Q -0.4 -3.8 3.8 -1.9 L 6.2 2.1 L 3.8 1.6 Q 2.1 3.6 0.1 2.6 Q -1.9 3.6 -3.8 1.8 Z" ' +
      'fill="none" stroke="#f8fafc" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="0.2" cy="0.4" r="1.05" fill="#f8fafc"/>',
    // === 新增17个配套眼形 ===
    WIDE: '<ellipse cx="0" cy="0" rx="4.2" ry="3.8" fill="#ffffff"/>',
    SQUINT: '<ellipse cx="0" cy="0" rx="3.8" ry="1.6" fill="#ffffff"/>',
    LEFT_GAZE: '<circle cx="-1.2" cy="0" r="3.6" fill="#ffffff"/>',
    RIGHT_GAZE: '<circle cx="1.2" cy="0" r="3.6" fill="#ffffff"/>',
    RAISED_BROW: '<path d="M -3.6 -1 Q 0 -4.5 3.6 -1" stroke="#ffffff" stroke-width="1.6" fill="none" stroke-linecap="round"/><circle cx="0" cy="1.2" r="2.8" fill="#ffffff"/>',
    BLINK_HALF: '<ellipse cx="0" cy="0" rx="3.6" ry="2.0" fill="#ffffff"/>',
    FROWN: '<path d="M -3.2 1 Q 0 0.5 3.2 1" stroke="#ffffff" stroke-width="1.5" fill="none" stroke-linecap="round"/><circle cx="0" cy="-1" r="2.4" fill="#ffffff"/>',
    SURPRISED: '<circle cx="0" cy="0" r="3.2" fill="#ffffff"/><circle cx="0" cy="0" r="1.6" fill="#0b0f14"/>',
    DETERMINED: '<ellipse cx="0" cy="0" rx="3.4" ry="2.8" fill="#ffffff"/><path d="M -2.8 -1.4 L 2.8 -1.4" stroke="#0b0f14" stroke-width="1"/>',
    WORRIED: '<ellipse cx="0" cy="0.8" rx="3.4" ry="2.6" fill="#ffffff"/>',
    EXCITED: '<ellipse cx="0" cy="-0.4" rx="3.8" ry="3.4" fill="#ffffff"/>',
    FOCUSED: '<circle cx="0" cy="0" r="3.0" fill="#ffffff" stroke="#ffffff" stroke-width="0.8"/>',
    CURIOUS: '<ellipse cx="0.4" cy="0" rx="3.6" ry="3.2" fill="#ffffff"/>',
    SKEPTICAL: '<ellipse cx="0" cy="-0.6" rx="3.6" ry="2.4" fill="#ffffff"/>',
    GENTLE: '<ellipse cx="0" cy="0.6" rx="3.4" ry="2.8" fill="#ffffff" opacity="0.95"/>',
    INTENSE: '<circle cx="0" cy="0" r="3.0" fill="#ffffff"/><circle cx="0" cy="0" r="1.2" fill="#0b0f14"/>',
    RELAXED: '<ellipse cx="0" cy="0.4" rx="3.6" ry="3.0" fill="#ffffff" opacity="0.9"/>',
  };

  // 眼形 SVG 资源拆分后的文件路径映射：键名与 EYE_SHAPES 保持一致。
  const EYE_SHAPE_FILES = {
    NORMAL: "/static/svg/eyes/NORMAL.svg",
    DOT_BIG: "/static/svg/eyes/DOT_BIG.svg",
    DOT_SMALL: "/static/svg/eyes/DOT_SMALL.svg",
    SLEEPY: "/static/svg/eyes/SLEEPY.svg",
    HAPPY_ARC: "/static/svg/eyes/HAPPY_ARC.svg",
    UP_ARC: "/static/svg/eyes/UP_ARC.svg",
    X_MARK: "/static/svg/eyes/X_MARK.svg",
    HEART: "/static/svg/eyes/HEART.svg",
    STAR: "/static/svg/eyes/STAR.svg",
    SWIRL: "/static/svg/eyes/SWIRL.svg",
    COOL: "/static/svg/eyes/COOL.svg",
    SNOW: "/static/svg/eyes/SNOW.svg",
    BULB: "/static/svg/eyes/BULB.svg",
    GLASSES: "/static/svg/eyes/GLASSES.svg",
    BULB_EMOJI: "/static/svg/eyes/BULB_EMOJI.svg",
    // === 新增17个配套眼形文件映射 ===
    WIDE: "/static/svg/eyes/WIDE.svg",
    SQUINT: "/static/svg/eyes/SQUINT.svg",
    LEFT_GAZE: "/static/svg/eyes/LEFT_GAZE.svg",
    RIGHT_GAZE: "/static/svg/eyes/RIGHT_GAZE.svg",
    RAISED_BROW: "/static/svg/eyes/RAISED_BROW.svg",
    BLINK_HALF: "/static/svg/eyes/BLINK_HALF.svg",
    FROWN: "/static/svg/eyes/FROWN.svg",
    SURPRISED: "/static/svg/eyes/SURPRISED.svg",
    DETERMINED: "/static/svg/eyes/DETERMINED.svg",
    WORRIED: "/static/svg/eyes/WORRIED.svg",
    EXCITED: "/static/svg/eyes/EXCITED.svg",
    FOCUSED: "/static/svg/eyes/FOCUSED.svg",
    CURIOUS: "/static/svg/eyes/CURIOUS.svg",
    SKEPTICAL: "/static/svg/eyes/SKEPTICAL.svg",
    GENTLE: "/static/svg/eyes/GENTLE.svg",
    INTENSE: "/static/svg/eyes/INTENSE.svg",
    RELAXED: "/static/svg/eyes/RELAXED.svg",
  };
  /** @type {Promise<void>|null} */
  let eyeSvgLoadPromise = null;

  /**
   * 运行时加载拆分后的眼形 SVG 文件，并覆盖 EYE_SHAPES 默认内联内容。
   * 若加载失败则保留默认值，保证动画逻辑不受影响。
   * @returns {Promise<void>}
   */
  function ensureEyeShapeAssetsLoaded() {
    if (eyeSvgLoadPromise) return eyeSvgLoadPromise;
    const tasks = Object.keys(EYE_SHAPE_FILES).map(async (key) => {
      const url = EYE_SHAPE_FILES[key];
      try {
        const resp = await fetch(url, { cache: "no-store" });
        if (!resp.ok) return;
        const txt = (await resp.text()).trim();
        // 针对文本型眼形（如 BULB_EMOJI）做乱码保护：检测到替换字符时回退内联默认值。
        const hasBrokenChar = txt.includes("\uFFFD");
        if (txt && !hasBrokenChar) EYE_SHAPES[key] = txt;
      } catch (_) {
        // 忽略加载失败，继续使用内联默认眼形。
      }
    });
    eyeSvgLoadPromise = Promise.all(tasks).then(() => {});
    return eyeSvgLoadPromise;
  }

  // 主脸（120x120）坐标系下的装饰 DOM 模板：
  // 每项描述一个 SVG 元素（或带 innerHTML 的 <g>），可选 `anim(localSec)` 返回逐帧属性覆盖。
  // `anim` 的返回对象允许键：opacity / transform / text（text 会改写 textContent）及其他 SVG 原生属性。
  // `localSec` 为该装饰出现以来的秒数（切换时重置为 0）。
  const DECOR_DEFS = {
    NONE: [],

    // 唤起动作：只保留“从睡眠被唤醒”的过程，不叠加文字或装饰符号。
    AWAKEN_ACTION: [
      // 前半段残留的 z，逐渐上浮并淡出，表示“从睡眠状态被唤醒”。
      { tag: "text", attrs: { x: 102, y: 26, "font-family": "Consolas,monospace", "font-size": 12, fill: "#e5e7eb", "font-weight": 700 }, text: "z",
        anim: (t) => {
          const k = Math.min(1, t / 0.58);
          return {
            transform: `translate(${(Math.sin(t * 6) * 0.8).toFixed(2)}, ${(-k * 8).toFixed(2)})`,
            opacity: (1 - k).toFixed(3),
          };
        } },
      { tag: "text", attrs: { x: 108, y: 15, "font-family": "Consolas,monospace", "font-size": 16, fill: "#e5e7eb", "font-weight": 700 }, text: "Z",
        anim: (t) => {
          const k = Math.min(1, Math.max(0, (t - 0.08) / 0.55));
          return {
            transform: `translate(${(Math.sin(t * 6 + 0.7) * 0.7).toFixed(2)}, ${(-k * 9).toFixed(2)})`,
            opacity: (1 - k).toFixed(3),
          };
        } },
    ],

    // 手绘惊悚风：鼻线 + 锯齿嘴描边，附加轻微抖动，模拟手绘“颤动感”。
    SKETCH_GHOST: [
      {
        tag: "path",
        attrs: {
          d: "M 72 56 L 76 58 L 74 62 L 84 63",
          stroke: "#f8fafc",
          "stroke-width": 1.35,
          fill: "none",
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        },
      },
      {
        tag: "path",
        attrs: {
          d: "M 53 77 L 58 96 L 70 93 L 78 96 L 85 92 L 92 94 L 99 91 L 104 77 Z",
          stroke: "#f8fafc",
          "stroke-width": 1.45,
          fill: "none",
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        },
        anim: (t) => ({
          transform: `translate(${(Math.sin(t * 5.1) * 0.55).toFixed(2)}, ${(Math.cos(t * 4.2) * 0.45).toFixed(2)})`,
          opacity: (0.88 + 0.12 * Math.sin(t * 3.6)).toFixed(3),
        }),
      },
    ],

    // 注视动作：纯净表达，不叠加额外装饰，主要由“睁大眼睛”来体现。
    GAZE_LOCK_ACTION: [
      // 空装饰：由眼睛状态（睁大）承担“被注视”表达。
    ],

    // 关灯动作：底部拿起灯泡，细腻吞入口中，吞得越多画面越暗。
    LIGHT_OFF_ACTION: [
      // 底部出现一颗接近嘴大小的灯泡，沿细腻轨迹送入口中；大小保持不变。
      { tag: "g", attrs: {}, html:
        '<ellipse cx="0" cy="-3.6" rx="4.9" ry="5.9" fill="#fde68a" stroke="#fef3c7" stroke-width="1.0"/>' +
        '<rect x="-2.2" y="1.3" width="4.4" height="2.8" rx="0.9" fill="#b08946" stroke="#e5c07b" stroke-width="0.6"/>' +
        '<line x1="-1.5" y1="2.6" x2="1.5" y2="2.6" stroke="#fef3c7" stroke-width="0.5" opacity="0.7"/>' +
        '<ellipse cx="-1.4" cy="-5.2" rx="1.3" ry="1.8" fill="#fff7cc" opacity="0.62"/>',
        anim: (t) => {
          // 三段式：先送入口中 -> 到嘴短暂停顿 -> 在嘴内吞没（不露边）。
          const p = Math.min(1, t / 1.50);
          const moveK = Math.min(1, p / 0.78);
          const k = moveK * moveK * (3 - 2 * moveK);
          const x = 67 + (79 - 67) * k;
          const y = 104 + (71 - 104) * k - Math.sin(k * Math.PI) * 1.0;
          let op = 1;
          // 0.78~0.83 为停顿窗口（约 75~80ms），随后吞没。
          if (p > 0.83) {
            const swallow = Math.min(1, (p - 0.83) / 0.17);
            op = 1 - swallow;
          }
          return {
            transform: `translate(${x.toFixed(2)}, ${y.toFixed(2)}) scale(1)`,
            opacity: op.toFixed(3),
          };
        } },
      // 吞得越多越暗。
      { tag: "rect", attrs: { x: 0, y: 0, width: 120, height: 120, fill: "#0a0c12" },
        anim: (t) => {
          const p = Math.min(1, t / 1.38);
          const k = p * p * (3 - 2 * p);
          return { opacity: (0.03 + k * 0.78).toFixed(3) };
        } },
    ],

    // 开灯动作（单次）：眼形由代码从「日常白圆眼」切到 💡；装饰层不再叠黄色光晕（用户要求只要灯泡）。
    LIGHT_ON_ACTION: [
      // 刺眼闪白：快速冲高再衰减（全屏白，非眼后黄晕）
      { tag: "rect", attrs: { x: 0, y: 0, width: 120, height: 120, fill: "#ffffff" },
        anim: (t) => {
          const ph = Math.min(1, t / 0.9);
          let op = 0;
          if (ph < 0.25) op = ph / 0.25 * 0.6;
          else op = Math.max(0, 0.6 * (1 - (ph - 0.25) / 0.75));
          return { opacity: op.toFixed(3) };
        } },
    ],

    // 播放音乐动作（单次）：戴上耳机，音符上浮一次后停住。
    MUSIC_ON_ACTION: [
      // 耳机头梁
      { tag: "path", attrs: { d: "M 48 40 C 48 32 54 27 60 27 C 66 27 72 32 72 40", stroke: "#8ec5ff", "stroke-width": 2.2, fill: "none", "stroke-linecap": "round" },
        anim: (t) => {
          const k = Math.min(1, t / 0.8);
          const y = (1 - k) * -6;
          return { transform: `translate(0, ${y.toFixed(2)})`, opacity: k.toFixed(3) };
        } },
      // 左耳罩
      { tag: "rect", attrs: { x: 46, y: 39, width: 4.2, height: 10, rx: 1.2, fill: "#8ec5ff" },
        anim: (t) => {
          const k = Math.min(1, t / 0.8);
          const y = (1 - k) * -6;
          return { transform: `translate(0, ${y.toFixed(2)})`, opacity: k.toFixed(3) };
        } },
      // 右耳罩
      { tag: "rect", attrs: { x: 69.8, y: 39, width: 4.2, height: 10, rx: 1.2, fill: "#8ec5ff" },
        anim: (t) => {
          const k = Math.min(1, t / 0.8);
          const y = (1 - k) * -6;
          return { transform: `translate(0, ${y.toFixed(2)})`, opacity: k.toFixed(3) };
        } },
      // 音符 1
      { tag: "text", attrs: { x: 18, y: 44, "font-size": 12, fill: "#8ec5ff" }, text: "♪",
        anim: (t) => {
          const k = Math.min(1, t / 1.2);
          return { transform: `translate(${(k * 8).toFixed(2)}, ${(-k * 10).toFixed(2)})`, opacity: (1 - k * 0.15).toFixed(3) };
        } },
      // 音符 2
      { tag: "text", attrs: { x: 92, y: 52, "font-size": 11, fill: "#8ec5ff" }, text: "♫",
        anim: (t) => {
          const k = Math.min(1, Math.max(0, (t - 0.2) / 1.2));
          return { transform: `translate(${(-k * 8).toFixed(2)}, ${(-k * 10).toFixed(2)})`, opacity: (1 - k * 0.15).toFixed(3) };
        } },
    ],

    // 暂停音乐动作：耳机上抬摘下 + 音符淡出。
    MUSIC_OFF_ACTION: [
      { tag: "path", attrs: { d: "M 48 40 C 48 32 54 27 60 27 C 66 27 72 32 72 40", stroke: "#8ec5ff", "stroke-width": 2.2, fill: "none", "stroke-linecap": "round" },
        anim: (t) => {
          const k = Math.min(1, t / 1.0);
          return { transform: `translate(0, ${(-k * 14).toFixed(2)})`, opacity: (1 - k).toFixed(3) };
        } },
      { tag: "rect", attrs: { x: 46, y: 39, width: 4.2, height: 10, rx: 1.2, fill: "#8ec5ff" },
        anim: (t) => {
          const k = Math.min(1, t / 1.0);
          return { transform: `translate(0, ${(-k * 14).toFixed(2)})`, opacity: (1 - k).toFixed(3) };
        } },
      { tag: "rect", attrs: { x: 69.8, y: 39, width: 4.2, height: 10, rx: 1.2, fill: "#8ec5ff" },
        anim: (t) => {
          const k = Math.min(1, t / 1.0);
          return { transform: `translate(0, ${(-k * 14).toFixed(2)})`, opacity: (1 - k).toFixed(3) };
        } },
      { tag: "text", attrs: { x: 20, y: 44, "font-size": 12, fill: "#8ec5ff" }, text: "♪",
        anim: (t) => {
          const k = Math.min(1, t / 0.8);
          return { opacity: (1 - k).toFixed(3), transform: `translate(${(k * 2).toFixed(2)}, ${(-k * 5).toFixed(2)})` };
        } },
      { tag: "text", attrs: { x: 92, y: 52, "font-size": 11, fill: "#8ec5ff" }, text: "♫",
        anim: (t) => {
          const k = Math.min(1, t / 0.8);
          return { opacity: (1 - k).toFixed(3), transform: `translate(${(-k * 2).toFixed(2)}, ${(-k * 5).toFixed(2)})` };
        } },
    ],

    // 开空调（单次）：去掉旧飘雪贴图，仅保留冷风氛围；主体由雪花眼 + 抖动驱动。
    AC_ON_ACTION: [
      { tag: "path", attrs: { d: "M 8 70 C 20 66 32 74 44 70 M 76 70 C 88 66 100 74 112 70", stroke: "#93c5fd", "stroke-width": 1.4, fill: "none", "stroke-linecap": "round" },
        anim: (t) => {
          const k = Math.min(1, t / 1.0);
          return { opacity: (0.15 + 0.75 * k).toFixed(3) };
        } },
    ],

    // 关空调：冷风条纹收缩消失。
    AC_OFF_ACTION: [
      { tag: "path", attrs: { d: "M 12 70 C 24 66 36 74 48 70 M 72 70 C 84 66 96 74 108 70", stroke: "#93c5fd", "stroke-width": 1.4, fill: "none", "stroke-linecap": "round" },
        anim: (t) => {
          const k = Math.min(1, t / 1.0);
          const sx = 1 - 0.7 * k;
          return { opacity: (1 - k).toFixed(3), transform: `translate(${(60 * (1 - sx)).toFixed(2)}, 0) scale(${sx.toFixed(3)}, 1)` };
        } },
    ],

    // 开窗帘：两侧帘布向外拉开。
    CURTAIN_ON_ACTION: [
      { tag: "rect", attrs: { x: 0, y: 0, width: 30, height: 120, fill: "#475569" },
        anim: (t) => { const k = Math.min(1, t / 1.1); return { transform: `translate(${(-26 * k).toFixed(2)},0)` }; } },
      { tag: "rect", attrs: { x: 90, y: 0, width: 30, height: 120, fill: "#475569" },
        anim: (t) => { const k = Math.min(1, t / 1.1); return { transform: `translate(${(26 * k).toFixed(2)},0)` }; } },
    ],

    // 关窗帘：两侧帘布向中间闭合。
    CURTAIN_OFF_ACTION: [
      { tag: "rect", attrs: { x: -26, y: 0, width: 30, height: 120, fill: "#475569" },
        anim: (t) => { const k = Math.min(1, t / 1.1); return { transform: `translate(${(26 * k).toFixed(2)},0)` }; } },
      { tag: "rect", attrs: { x: 116, y: 0, width: 30, height: 120, fill: "#475569" },
        anim: (t) => { const k = Math.min(1, t / 1.1); return { transform: `translate(${(-26 * k).toFixed(2)},0)` }; } },
    ],

    // 扫地（单次）：灰尘从四周被吸向嘴部；嘴型由 resolveTarget 驱动成「吸吮」。
    CLEAN_ACTION: [
      { tag: "circle", attrs: { cx: 0, cy: 0, r: 1.35, fill: "#78716c" },
        anim: (t) => {
          const sx = 10;
          const sy = 32;
          const delay = 0;
          const dur = 1.05;
          const u = Math.max(0, Math.min(1, (t - delay) / dur));
          const k = u * u * (3 - 2 * u);
          const x = sx + (79 - sx) * k;
          const y = sy + (71 - sy) * k;
          const op = 1 - k * 0.92;
          return { transform: `translate(${x.toFixed(2)},${y.toFixed(2)})`, opacity: op.toFixed(3) };
        } },
      { tag: "circle", attrs: { cx: 0, cy: 0, r: 1.05, fill: "#a8a29e" },
        anim: (t) => {
          const sx = 108;
          const sy = 38;
          const delay = 0.08;
          const dur = 1.12;
          const u = Math.max(0, Math.min(1, (t - delay) / dur));
          const k = u * u * (3 - 2 * u);
          const x = sx + (79 - sx) * k;
          const y = sy + (71 - sy) * k;
          const op = 1 - k * 0.9;
          return { transform: `translate(${x.toFixed(2)},${y.toFixed(2)})`, opacity: op.toFixed(3) };
        } },
      { tag: "circle", attrs: { cx: 0, cy: 0, r: 1.55, fill: "#57534e" },
        anim: (t) => {
          const sx = 22;
          const sy = 18;
          const delay = 0.05;
          const dur = 1.18;
          const u = Math.max(0, Math.min(1, (t - delay) / dur));
          const k = u * u * (3 - 2 * u);
          const x = sx + (79 - sx) * k;
          const y = sy + (71 - sy) * k;
          const op = 1 - k * 0.93;
          return { transform: `translate(${x.toFixed(2)},${y.toFixed(2)})`, opacity: op.toFixed(3) };
        } },
      { tag: "circle", attrs: { cx: 0, cy: 0, r: 0.95, fill: "#d6d3d1" },
        anim: (t) => {
          const sx = 96;
          const sy = 22;
          const delay = 0.12;
          const dur = 1.0;
          const u = Math.max(0, Math.min(1, (t - delay) / dur));
          const k = u * u * (3 - 2 * u);
          const x = sx + (79 - sx) * k;
          const y = sy + (71 - sy) * k;
          const op = 1 - k * 0.88;
          return { transform: `translate(${x.toFixed(2)},${y.toFixed(2)})`, opacity: op.toFixed(3) };
        } },
      { tag: "circle", attrs: { cx: 0, cy: 0, r: 1.2, fill: "#78716c" },
        anim: (t) => {
          const sx = 60;
          const sy = 14;
          const delay = 0.18;
          const dur = 1.14;
          const u = Math.max(0, Math.min(1, (t - delay) / dur));
          const k = u * u * (3 - 2 * u);
          const x = sx + (79 - sx) * k;
          const y = sy + (71 - sy) * k;
          const op = 1 - k * 0.91;
          return { transform: `translate(${x.toFixed(2)},${y.toFixed(2)})`, opacity: op.toFixed(3) };
        } },
      { tag: "circle", attrs: { cx: 0, cy: 0, r: 0.85, fill: "#a8a29e" },
        anim: (t) => {
          const sx = 44;
          const sy = 102;
          const delay = 0.22;
          const dur = 0.98;
          const u = Math.max(0, Math.min(1, (t - delay) / dur));
          const k = u * u * (3 - 2 * u);
          const x = sx + (79 - sx) * k;
          const y = sy + (71 - sy) * k;
          const op = 1 - k * 0.9;
          return { transform: `translate(${x.toFixed(2)},${y.toFixed(2)})`, opacity: op.toFixed(3) };
        } },
      { tag: "circle", attrs: { cx: 0, cy: 0, r: 1.1, fill: "#57534e" },
        anim: (t) => {
          const sx = 112;
          const sy = 72;
          const delay = 0.15;
          const dur = 1.06;
          const u = Math.max(0, Math.min(1, (t - delay) / dur));
          const k = u * u * (3 - 2 * u);
          const x = sx + (79 - sx) * k;
          const y = sy + (71 - sy) * k;
          const op = 1 - k * 0.92;
          return { transform: `translate(${x.toFixed(2)},${y.toFixed(2)})`, opacity: op.toFixed(3) };
        } },
      { tag: "circle", attrs: { cx: 0, cy: 0, r: 0.75, fill: "#78716c" },
        anim: (t) => {
          const sx = 8;
          const sy = 70;
          const delay = 0.28;
          const dur = 1.02;
          const u = Math.max(0, Math.min(1, (t - delay) / dur));
          const k = u * u * (3 - 2 * u);
          const x = sx + (79 - sx) * k;
          const y = sy + (71 - sy) * k;
          const op = 1 - k * 0.89;
          return { transform: `translate(${x.toFixed(2)},${y.toFixed(2)})`, opacity: op.toFixed(3) };
        } },
      { tag: "circle", attrs: { cx: 0, cy: 0, r: 1.25, fill: "#a8a29e" },
        anim: (t) => {
          const sx = 78;
          const sy = 108;
          const delay = 0.1;
          const dur = 1.2;
          const u = Math.max(0, Math.min(1, (t - delay) / dur));
          const k = u * u * (3 - 2 * u);
          const x = sx + (79 - sx) * k;
          const y = sy + (71 - sy) * k;
          const op = 1 - k * 0.93;
          return { transform: `translate(${x.toFixed(2)},${y.toFixed(2)})`, opacity: op.toFixed(3) };
        } },
    ],

    // 音量升高（单次）：声波连续扩散一次。
    VOL_UP_ACTION: [
      { tag: "path", attrs: { d: "M 14 62 L 24 62 L 34 52 L 34 88 L 24 78 L 14 78 Z", fill: "#fca5a5" } },
      { tag: "path", attrs: { d: "M 40 62 Q 52 70 40 78", stroke: "#fca5a5", "stroke-width": 2, fill: "none", "stroke-linecap": "round" },
        anim: (t) => {
          const k = Math.min(1, t / 0.9);
          return { opacity: (1 - k * 0.25).toFixed(3), transform: `translate(${(k * 5).toFixed(2)},0)` };
        } },
      { tag: "path", attrs: { d: "M 46 56 Q 64 70 46 84", stroke: "#fca5a5", "stroke-width": 2, fill: "none", "stroke-linecap": "round" },
        anim: (t) => {
          const k = Math.min(1, Math.max(0, (t - 0.15) / 0.9));
          return { opacity: (1 - k * 0.25).toFixed(3), transform: `translate(${(k * 6).toFixed(2)},0)` };
        } },
    ],

    // 音量降低（单次）：只出现一道小声波，快速收束。
    VOL_DOWN_ACTION: [
      { tag: "path", attrs: { d: "M 14 62 L 24 62 L 34 52 L 34 88 L 24 78 L 14 78 Z", fill: "#94a3b8" } },
      { tag: "path", attrs: { d: "M 40 62 Q 52 70 40 78", stroke: "#94a3b8", "stroke-width": 1.6, fill: "none", "stroke-linecap": "round" },
        anim: (t) => {
          const k = Math.min(1, t / 0.8);
          return { opacity: (0.7 * (1 - k)).toFixed(3), transform: `translate(${(k * 3).toFixed(2)},0)` };
        } },
    ],

    // 粉色腮红：两片椭圆随呼吸轻微脉动，不会抢戏。
    BLUSH: [
      { tag: "ellipse", attrs: { cx: 44, cy: 60, rx: 4.5, ry: 2, fill: "#ff9cbd" },
        anim: (t) => ({ opacity: (0.55 + 0.3 * (0.5 + 0.5 * Math.sin(t * 2.6))).toFixed(3) }) },
      { tag: "ellipse", attrs: { cx: 92, cy: 60, rx: 4.5, ry: 2, fill: "#ff9cbd" },
        anim: (t) => ({ opacity: (0.55 + 0.3 * (0.5 + 0.5 * Math.sin(t * 2.6 + 0.5))).toFixed(3) }) },
    ],

    // 眼泪：两滴从眼角生出 → 向下滑 → 消失；相差半个周期交替滴落。
    TEARS: [
      { tag: "g", attrs: {}, html: '<path d="M 0 0 l 0 9 q 2 2.2 4 0 l 0 -9 z" fill="#60a5fa"/>',
        anim: (t) => {
          const cyc = 1.6; const ph = ((t) % cyc) / cyc;
          const tyOff = ph * 14;
          const op = ph < 0.15 ? ph / 0.15 : Math.max(0, 1 - (ph - 0.15) / 0.85);
          return { transform: `translate(50, ${(56 + tyOff).toFixed(2)})`, opacity: op.toFixed(3) };
        } },
      { tag: "g", attrs: {}, html: '<path d="M 0 0 l 0 9 q 2 2.2 4 0 l 0 -9 z" fill="#60a5fa"/>',
        anim: (t) => {
          const cyc = 1.6; const ph = ((t + 0.8) % cyc) / cyc;
          const tyOff = ph * 14;
          const op = ph < 0.15 ? ph / 0.15 : Math.max(0, 1 - (ph - 0.15) / 0.85);
          return { transform: `translate(86, ${(56 + tyOff).toFixed(2)})`, opacity: op.toFixed(3) };
        } },
    ],

    // 汗滴：反复「从无到有 → 保持 → 下滑消失」2.4s 为一周期，非常「社恐」。
    SWEAT: [
      { tag: "g", attrs: {}, html: '<path d="M 0 0 l 0 10 q 2 3 4 0 l 0 -10 z" fill="#60a5fa"/>',
        anim: (t) => {
          const cyc = 2.4; const ph = (t % cyc) / cyc;
          let opacity, ty;
          if (ph < 0.35) { opacity = (ph / 0.35); ty = 0; }
          else if (ph < 0.7) { opacity = 1; ty = (ph - 0.35) * 2; }
          else { opacity = Math.max(0, 1 - (ph - 0.7) / 0.3); ty = 0.7 + (ph - 0.7) * 20; }
          return { transform: `translate(100, ${(22 + ty).toFixed(2)})`, opacity: opacity.toFixed(3) };
        } },
    ],

    // 单个 z：轻微左右漂浮。
    Z_SINGLE: [
      { tag: "text", attrs: { x: 104, y: 26, "font-family": "Consolas,monospace", "font-size": 14, fill: "#e5e7eb", "font-weight": 700 },
        text: "z",
        anim: (t) => ({ transform: `translate(${(Math.sin(t * 3) * 1.6).toFixed(2)}, ${(Math.sin(t * 3 + 1) * 1.2).toFixed(2)})` }) },
    ],

    // ZZZ 累加：z → Z → ZZZ，每 2.1s 循环一轮，3 个字母依次淡入后一起消失。
    ZZZ: [
      { tag: "text", attrs: { x: 100, y: 34, "font-family": "Consolas,monospace", "font-size": 11, fill: "#e5e7eb", "font-weight": 700 },
        text: "z",
        anim: (t) => {
          const cyc = 2.1; const ph = (t % cyc) / cyc;
          let o;
          if (ph < 0.08) o = ph / 0.08;
          else if (ph < 0.85) o = 1;
          else o = Math.max(0, 1 - (ph - 0.85) / 0.15);
          return { opacity: o.toFixed(3), transform: `translate(${(Math.sin(t * 2) * 0.8).toFixed(2)}, 0)` };
        } },
      { tag: "text", attrs: { x: 104, y: 22, "font-family": "Consolas,monospace", "font-size": 14, fill: "#e5e7eb", "font-weight": 700 },
        text: "Z",
        anim: (t) => {
          const cyc = 2.1; const ph = (t % cyc) / cyc;
          let o;
          if (ph < 0.28) o = 0;
          else if (ph < 0.36) o = (ph - 0.28) / 0.08;
          else if (ph < 0.85) o = 1;
          else o = Math.max(0, 1 - (ph - 0.85) / 0.15);
          return { opacity: o.toFixed(3), transform: `translate(${(Math.sin(t * 2 + 0.6) * 0.8).toFixed(2)}, 0)` };
        } },
      { tag: "text", attrs: { x: 110, y: 10, "font-family": "Consolas,monospace", "font-size": 18, fill: "#e5e7eb", "font-weight": 700 },
        text: "Z",
        anim: (t) => {
          const cyc = 2.1; const ph = (t % cyc) / cyc;
          let o;
          if (ph < 0.56) o = 0;
          else if (ph < 0.64) o = (ph - 0.56) / 0.08;
          else if (ph < 0.85) o = 1;
          else o = Math.max(0, 1 - (ph - 0.85) / 0.15);
          return { opacity: o.toFixed(3), transform: `translate(${(Math.sin(t * 2 + 1.2) * 0.8).toFixed(2)}, 0)` };
        } },
    ],

    // 火花：左上一颗大、右下一颗小，各自眨巴（opacity 脉冲 + 微缩放）。
    SPARKLE: [
      { tag: "g", attrs: {}, html: '<text x="0" y="0" font-size="14" fill="#fbbf24">✦</text>',
        anim: (t) => {
          const s = 0.85 + 0.25 * Math.abs(Math.sin(t * 3.4));
          const op = 0.4 + 0.6 * Math.abs(Math.sin(t * 3.4));
          return { transform: `translate(18, 26) scale(${s.toFixed(3)})`, opacity: op.toFixed(3) };
        } },
      { tag: "g", attrs: {}, html: '<text x="0" y="0" font-size="12" fill="#fbbf24">✧</text>',
        anim: (t) => {
          const s = 0.85 + 0.25 * Math.abs(Math.sin(t * 3.4 + 1.3));
          const op = 0.4 + 0.6 * Math.abs(Math.sin(t * 3.4 + 1.3));
          return { transform: `translate(96, 106) scale(${s.toFixed(3)})`, opacity: op.toFixed(3) };
        } },
    ],

    // 爱心：两颗向上飘浮并淡出，反复循环，体现「心动」氛围。
    HEARTS: [
      { tag: "g", attrs: {}, html: '<text x="0" y="0" font-size="16" fill="#ff6b9e">♥</text>',
        anim: (t) => {
          const cyc = 2.2; const ph = (t % cyc) / cyc;
          const ty = -ph * 14;
          const op = ph < 0.1 ? ph / 0.1 : Math.max(0, 1 - (ph - 0.1) / 0.9);
          return { transform: `translate(12, ${(32 + ty).toFixed(2)})`, opacity: op.toFixed(3) };
        } },
      { tag: "g", attrs: {}, html: '<text x="0" y="0" font-size="12" fill="#ff6b9e">♥</text>',
        anim: (t) => {
          const cyc = 2.2; const ph = ((t + 1.1) % cyc) / cyc;
          const ty = -ph * 14;
          const op = ph < 0.1 ? ph / 0.1 : Math.max(0, 1 - (ph - 0.1) / 0.9);
          return { transform: `translate(100, ${(26 + ty).toFixed(2)})`, opacity: op.toFixed(3) };
        } },
    ],

    // 问号：反复「弹跳 + 微缩放」，表达困惑。
    QUESTION: [
      { tag: "g", attrs: {}, html: '<text x="0" y="0" font-family="Consolas,monospace" font-size="22" fill="#fcd34d" font-weight="700">?</text>',
        anim: (t) => {
          const ph = (t % 1.4) / 1.4;
          const bump = ph < 0.22 ? Math.sin(ph / 0.22 * Math.PI) * 3.5 : 0;
          const s = 1 + (ph < 0.22 ? Math.sin(ph / 0.22 * Math.PI) * 0.12 : 0);
          return { transform: `translate(98, ${(32 - bump).toFixed(2)}) scale(${s.toFixed(3)})` };
        } },
    ],

    // 感叹号：持续「急促抖动」，表达吃惊。
    EXCLAIM: [
      { tag: "g", attrs: {}, html: '<text x="0" y="0" font-family="Consolas,monospace" font-size="22" fill="#fca5a5" font-weight="700">!</text>',
        anim: (t) => {
          const bump = Math.abs(Math.sin(t * 9)) * 3;
          const s = 1 + Math.abs(Math.sin(t * 9)) * 0.15;
          return { transform: `translate(100, ${(30 - bump).toFixed(2)}) scale(${s.toFixed(3)})` };
        } },
    ],

    // 蒸汽：三条曲线依次上升 + 淡出，像冒热气。
    STEAM: [
      { tag: "g", attrs: {}, html: '<path d="M 0 0 c 3 2 -2 6 1 9" stroke="#fca5a5" stroke-width="1.4" fill="none"/>',
        anim: (t) => {
          const cyc = 1.6; const ph = (t % cyc) / cyc;
          return { transform: `translate(92, ${(22 - ph * 10).toFixed(2)})`, opacity: Math.max(0, 1 - ph).toFixed(3) };
        } },
      { tag: "g", attrs: {}, html: '<path d="M 0 0 c 3 2 -2 6 1 9" stroke="#fca5a5" stroke-width="1.4" fill="none"/>',
        anim: (t) => {
          const cyc = 1.6; const ph = ((t + 0.53) % cyc) / cyc;
          return { transform: `translate(100, ${(16 - ph * 10).toFixed(2)})`, opacity: Math.max(0, 1 - ph).toFixed(3) };
        } },
      { tag: "g", attrs: {}, html: '<path d="M 0 0 c 3 2 -2 6 1 9" stroke="#fca5a5" stroke-width="1.4" fill="none"/>',
        anim: (t) => {
          const cyc = 1.6; const ph = ((t + 1.06) % cyc) / cyc;
          return { transform: `translate(108, ${(22 - ph * 10).toFixed(2)})`, opacity: Math.max(0, 1 - ph).toFixed(3) };
        } },
    ],

    // 乌云：两团椭圆在头顶左右飘动、上下起伏，体现愁云。
    CLOUD: [
      { tag: "ellipse", attrs: { cx: 100, cy: 22, rx: 10, ry: 4, fill: "#9ca3af", opacity: 0.7 },
        anim: (t) => ({ transform: `translate(${(Math.sin(t * 0.9) * 3).toFixed(2)}, ${(Math.sin(t * 1.3) * 1.6).toFixed(2)})` }) },
      { tag: "ellipse", attrs: { cx: 92, cy: 26, rx: 5, ry: 2.4, fill: "#9ca3af", opacity: 0.7 },
        anim: (t) => ({ transform: `translate(${(Math.sin(t * 0.9 + 0.6) * 3).toFixed(2)}, ${(Math.sin(t * 1.3 + 0.6) * 1.6).toFixed(2)})` }) },
    ],

    // 省略号：三个圆点轮流弹跳（typing indicator 风格）。
    DOT_DOT: [
      { tag: "circle", attrs: { cx: 100, cy: 28, r: 1.8, fill: "#e5e7eb" },
        anim: (t) => {
          const ph = (t % 1.2) / 1.2;
          const bump = ph < 0.2 ? Math.sin(ph / 0.2 * Math.PI) * 2.6 : 0;
          return { transform: `translate(0, ${(-bump).toFixed(2)})` };
        } },
      { tag: "circle", attrs: { cx: 106, cy: 28, r: 1.8, fill: "#e5e7eb" },
        anim: (t) => {
          const ph = ((t + 0.4) % 1.2) / 1.2;
          const bump = ph < 0.2 ? Math.sin(ph / 0.2 * Math.PI) * 2.6 : 0;
          return { transform: `translate(0, ${(-bump).toFixed(2)})` };
        } },
      { tag: "circle", attrs: { cx: 112, cy: 28, r: 1.8, fill: "#e5e7eb" },
        anim: (t) => {
          const ph = ((t + 0.8) % 1.2) / 1.2;
          const bump = ph < 0.2 ? Math.sin(ph / 0.2 * Math.PI) * 2.6 : 0;
          return { transform: `translate(0, ${(-bump).toFixed(2)})` };
        } },
    ],

    // 吐舌头：方形舌尖左右摆动。
    TONGUE_OUT: [
      { tag: "rect", attrs: { x: 76, y: 88, width: 6, height: 6, rx: 1.2, fill: "#ff6b9e" },
        anim: (t) => ({ transform: `translate(${(Math.sin(t * 6) * 1.4).toFixed(2)}, ${(Math.abs(Math.sin(t * 6)) * 0.6).toFixed(2)})` }) },
    ],

    // 派对氛围：中心星光旋转 + 彩色碎屑飘落（精选「生动」表情用）。
    PARTY_POP: [
      { tag: "text", attrs: { x: 60, y: 22, "font-size": 22, fill: "#f472b6", "text-anchor": "middle" }, text: "✦",
        anim: (t) => {
          const rot = ((t * 140) % 360).toFixed(1);
          const s = (1.05 + 0.28 * Math.sin(t * 5.5)).toFixed(3);
          return { transform: `rotate(${rot} 60 22) scale(${s})`, opacity: (0.82 + 0.18 * Math.sin(t * 4.1)).toFixed(3) };
        } },
      { tag: "rect", attrs: { width: 3.2, height: 3.2, fill: "#60a5fa", rx: 0.4 },
        anim: (t) => {
          const cyc = 2.8;
          const ph = (t % cyc) / cyc;
          return {
            transform: `translate(${(14 + ph * 86).toFixed(2)}, ${(10 + Math.sin(ph * 6.28) * 6 + ph * 52).toFixed(2)}) rotate(${(ph * 220).toFixed(1)})`,
            opacity: (ph < 0.08 ? ph / 0.08 : ph > 0.92 ? (1 - ph) / 0.08 : 0.95).toFixed(3),
          };
        } },
      { tag: "rect", attrs: { width: 2.8, height: 2.8, fill: "#fbbf24", rx: 0.3 },
        anim: (t) => {
          const cyc = 3.1;
          const ph = ((t + 0.7) % cyc) / cyc;
          return {
            transform: `translate(${(22 + ph * 72).toFixed(2)}, ${(8 + Math.cos(ph * 6.28) * 5 + ph * 56).toFixed(2)}) rotate(${(ph * -180).toFixed(1)})`,
            opacity: (ph < 0.07 ? ph / 0.07 : ph > 0.93 ? (1 - ph) / 0.07 : 0.9).toFixed(3),
          };
        } },
      { tag: "rect", attrs: { width: 2.6, height: 2.6, fill: "#f472b6", rx: 0.3 },
        anim: (t) => {
          const cyc = 2.5;
          const ph = ((t + 1.2) % cyc) / cyc;
          return {
            transform: `translate(${(8 + ph * 96).toFixed(2)}, ${(14 + ph * 48).toFixed(2)}) rotate(${(ph * 260).toFixed(1)})`,
            opacity: (ph < 0.06 ? ph / 0.06 : ph > 0.94 ? (1 - ph) / 0.06 : 0.88).toFixed(3),
          };
        } },
    ],

    // 辣椒感：嘴旁火焰状条纹快速明暗跳动。
    FIRE_FLICKER: [
      { tag: "path", attrs: { d: "M 52 78 Q 56 62 60 78 Q 58 88 56 92 Q 54 84 52 78 Z", fill: "#fb923c" },
        anim: (t) => ({
          opacity: (0.45 + 0.55 * Math.abs(Math.sin(t * 11))).toFixed(3),
          transform: `translate(${(Math.sin(t * 14) * 0.8).toFixed(2)}, ${(-Math.abs(Math.sin(t * 9)) * 1.2).toFixed(2)})`,
        }) },
      { tag: "path", attrs: { d: "M 72 78 Q 76 60 80 78 Q 78 90 76 94 Q 74 86 72 78 Z", fill: "#ef4444" },
        anim: (t) => ({
          opacity: (0.4 + 0.55 * Math.abs(Math.sin(t * 13 + 0.7))).toFixed(3),
          transform: `translate(${(Math.sin(t * 15 + 1) * 0.7).toFixed(2)}, ${(-Math.abs(Math.sin(t * 10 + 0.5)) * 1.1).toFixed(2)})`,
        }) },
      { tag: "path", attrs: { d: "M 62 74 Q 64 68 66 74 Q 65 80 63 82 Q 61 78 62 74 Z", fill: "#fde047" },
        anim: (t) => ({
          opacity: (0.35 + 0.6 * Math.abs(Math.sin(t * 16 + 1.2))).toFixed(3),
        }) },
    ],

    // 心动爆发：多颗心沿四角飞出再淡出。
    HEART_BURST: [
      { tag: "g", attrs: {}, html: '<text x="0" y="0" font-size="14" fill="#ff6b9e">♥</text>',
        anim: (t) => {
          const cyc = 2.4;
          const ph = (t % cyc) / cyc;
          const k = ph * ph * (3 - 2 * ph);
          const op = ph < 0.12 ? ph / 0.12 : Math.max(0, 1 - (ph - 0.12) / 0.88);
          return { transform: `translate(${(60 - k * 38).toFixed(2)}, ${(48 - k * 28).toFixed(2)}) scale(${(0.75 + k * 0.35).toFixed(3)})`, opacity: op.toFixed(3) };
        } },
      { tag: "g", attrs: {}, html: '<text x="0" y="0" font-size="13" fill="#fb7185">♥</text>',
        anim: (t) => {
          const cyc = 2.4;
          const ph = ((t + 0.55) % cyc) / cyc;
          const k = ph * ph * (3 - 2 * ph);
          const op = ph < 0.12 ? ph / 0.12 : Math.max(0, 1 - (ph - 0.12) / 0.88);
          return { transform: `translate(${(60 + k * 40).toFixed(2)}, ${(48 - k * 26).toFixed(2)}) scale(${(0.72 + k * 0.38).toFixed(3)})`, opacity: op.toFixed(3) };
        } },
      { tag: "g", attrs: {}, html: '<text x="0" y="0" font-size="12" fill="#fda4af">♥</text>',
        anim: (t) => {
          const cyc = 2.4;
          const ph = ((t + 1.1) % cyc) / cyc;
          const k = ph * ph * (3 - 2 * ph);
          const op = ph < 0.12 ? ph / 0.12 : Math.max(0, 1 - (ph - 0.12) / 0.88);
          return { transform: `translate(${(60 - k * 22).toFixed(2)}, ${(56 + k * 34).toFixed(2)}) scale(${(0.7 + k * 0.4).toFixed(3)})`, opacity: op.toFixed(3) };
        } },
      { tag: "g", attrs: {}, html: '<text x="0" y="0" font-size="11" fill="#ff6b9e">♥</text>',
        anim: (t) => {
          const cyc = 2.4;
          const ph = ((t + 1.65) % cyc) / cyc;
          const k = ph * ph * (3 - 2 * ph);
          const op = ph < 0.12 ? ph / 0.12 : Math.max(0, 1 - (ph - 0.12) / 0.88);
          return { transform: `translate(${(60 + k * 24).toFixed(2)}, ${(54 + k * 32).toFixed(2)}) scale(${(0.68 + k * 0.42).toFixed(3)})`, opacity: op.toFixed(3) };
        } },
    ],

    // 泡泡上浮：透明圆缓慢摇摆上升。
    BUBBLE_DRIFT: [
      { tag: "circle", attrs: { cx: 0, cy: 0, r: 3.2, fill: "none", stroke: "#93c5fd", "stroke-width": 1.1 },
        anim: (t) => {
          const cyc = 3.6;
          const ph = (t % cyc) / cyc;
          const y = 78 - ph * 52;
          const x = 22 + Math.sin(ph * 6.28 + 0.3) * 5;
          const op = ph < 0.1 ? ph / 0.1 : ph > 0.88 ? (1 - ph) / 0.12 : 0.75;
          return { transform: `translate(${x.toFixed(2)}, ${y.toFixed(2)})`, opacity: op.toFixed(3) };
        } },
      { tag: "circle", attrs: { cx: 0, cy: 0, r: 2.4, fill: "none", stroke: "#a5b4fc", "stroke-width": 0.95 },
        anim: (t) => {
          const cyc = 3.2;
          const ph = ((t + 1.1) % cyc) / cyc;
          const y = 82 - ph * 54;
          const x = 88 + Math.cos(ph * 6.28) * 4;
          const op = ph < 0.08 ? ph / 0.08 : ph > 0.9 ? (1 - ph) / 0.1 : 0.65;
          return { transform: `translate(${x.toFixed(2)}, ${y.toFixed(2)})`, opacity: op.toFixed(3) };
        } },
      { tag: "circle", attrs: { cx: 0, cy: 0, r: 2.0, fill: "none", stroke: "#e9d5ff", "stroke-width": 0.85 },
        anim: (t) => {
          const cyc = 2.9;
          const ph = ((t + 0.45) % cyc) / cyc;
          const y = 74 - ph * 48;
          const x = 52 + Math.sin(ph * 8.2) * 6;
          const op = ph < 0.09 ? ph / 0.09 : ph > 0.86 ? (1 - ph) / 0.14 : 0.55;
          return { transform: `translate(${x.toFixed(2)}, ${y.toFixed(2)})`, opacity: op.toFixed(3) };
        } },
    ],

    // 律动音符：三枚音符左右弹跳，节奏错开。
    NOTE_GROOVE: [
      { tag: "text", attrs: { x: 24, y: 28, "font-size": 16, fill: "#8ec5ff" }, text: "♪",
        anim: (t) => {
          const bump = Math.abs(Math.sin(t * 6.8)) * 5;
          return { transform: `translate(${(Math.sin(t * 3.1) * 3).toFixed(2)}, ${(-bump).toFixed(2)})` };
        } },
      { tag: "text", attrs: { x: 58, y: 22, "font-size": 18, fill: "#c4b5fd" }, text: "♫",
        anim: (t) => {
          const bump = Math.abs(Math.sin(t * 6.8 + 1.1)) * 6;
          return { transform: `translate(${(Math.sin(t * 3.4 + 0.8) * 2.5).toFixed(2)}, ${(-bump).toFixed(2)})` };
        } },
      { tag: "text", attrs: { x: 92, y: 30, "font-size": 15, fill: "#f9a8d4" }, text: "♪",
        anim: (t) => {
          const bump = Math.abs(Math.sin(t * 6.8 + 2.0)) * 4.5;
          return { transform: `translate(${(Math.sin(t * 3.2 + 1.6) * 3.5).toFixed(2)}, ${(-bump).toFixed(2)})` };
        } },
    ],
  };

  // 预览卡（56x56）坐标系下的装饰。
  const DECOR_SMALL = {
    NONE: "",
    BLUSH:
      '<ellipse cx="17" cy="28" rx="2" ry="1" fill="#ff9cbd" opacity="0.85"/>' +
      '<ellipse cx="33" cy="28" rx="2" ry="1" fill="#ff9cbd" opacity="0.85"/>',
    TEARS:
      '<path d="M 20 27 l 0 4 q 1 1 1.5 0 l 0 -4 z" fill="#60a5fa"/>' +
      '<path d="M 31 27 l 0 4 q 1 1 1.5 0 l 0 -4 z" fill="#60a5fa"/>',
    SWEAT: '<path d="M 44 12 l 0 5 q 1 1.4 2 0 l 0 -5 z" fill="#60a5fa"/>',
    Z_SINGLE: '<text x="44" y="12" font-size="7" fill="#e5e7eb" font-weight="700">z</text>',
    ZZZ:
      '<text x="42" y="16" font-size="6" fill="#e5e7eb" font-weight="700">z</text>' +
      '<text x="45" y="10" font-size="8" fill="#e5e7eb" font-weight="700">Z</text>',
    SPARKLE: '<text x="6" y="12" font-size="8" fill="#fbbf24">✦</text>',
    HEARTS: '<text x="4" y="14" font-size="9" fill="#ff6b9e">♥</text>',
    QUESTION: '<text x="44" y="14" font-size="11" fill="#fcd34d" font-weight="700">?</text>',
    EXCLAIM: '<text x="45" y="14" font-size="11" fill="#fca5a5" font-weight="700">!</text>',
    STEAM:
      '<path d="M 40 8 c 1 1 -1 3 0 5" stroke="#fca5a5" stroke-width="0.8" fill="none"/>' +
      '<path d="M 45 6 c 1 1 -1 3 0 5" stroke="#fca5a5" stroke-width="0.8" fill="none"/>',
    CLOUD: '<ellipse cx="43" cy="10" rx="6" ry="2.4" fill="#9ca3af" opacity="0.7"/>',
    DOT_DOT: '<text x="44" y="14" font-size="9" fill="#e5e7eb" font-weight="700">…</text>',
    TONGUE_OUT: '<rect x="31" y="40" width="3" height="3" rx="0.6" fill="#ff6b9e"/>',
    GAZE_LOCK_ACTION:
      '',
    AWAKEN_ACTION:
      '<text x="43" y="12" font-size="8" fill="#e5e7eb" font-weight="700">z</text>' +
      '<text x="46" y="8" font-size="9" fill="#e5e7eb" font-weight="700">Z</text>',
    SKETCH_GHOST:
      '<path d="M 23 24 L 26 26 L 24 29 L 32 30" stroke="#f8fafc" stroke-width="1.05" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M 14 38 L 17 49 L 23 47 L 27 49 L 31 46 L 35 48 L 40 46 L 43 38 Z" stroke="#f8fafc" stroke-width="1.05" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    PARTY_POP:
      '<text x="28" y="14" font-size="10" fill="#f472b6">✦</text>' +
      '<rect x="40" y="10" width="3" height="3" fill="#60a5fa" rx="0.3"/>',
    FIRE_FLICKER:
      '<path d="M 26 42 Q 28 36 30 42 Z" fill="#fb923c"/>' +
      '<path d="M 38 41 Q 40 35 42 41 Z" fill="#ef4444"/>',
    HEART_BURST:
      '<text x="12" y="18" font-size="9" fill="#ff6b9e">♥</text>' +
      '<text x="40" y="12" font-size="8" fill="#fb7185">♥</text>',
    BUBBLE_DRIFT:
      '<circle cx="18" cy="28" r="3" fill="none" stroke="#93c5fd" stroke-width="0.8"/>' +
      '<circle cx="34" cy="32" r="2.2" fill="none" stroke="#a5b4fc" stroke-width="0.7"/>',
    NOTE_GROOVE:
      '<text x="10" y="16" font-size="10" fill="#8ec5ff">♪</text>' +
      '<text x="34" y="12" font-size="11" fill="#c4b5fd">♫</text>',
  };

  // 不说话（REST）时可触发的情绪表情：26 种，含嘴型 + 眼形 + 装饰。
  const IDLE_MOODS = {
    BORED:     { label: "无聊",    mouth: { w: 8.2, h: 1.3, r: 0.8, teeth: 0, tongue: 0 },     eyeOpenMul: 0.55, eyeYBias: 0.6,  eyeCross: 0.2,  eyeStyle: "NORMAL",    decor: "DOT_DOT" },
    SLEEPY:    { label: "犯困",    mouth: { w: 7.4, h: 1.1, r: 0.8, teeth: 0, tongue: 0 },     eyeOpenMul: 0.35, eyeYBias: 1.1,  eyeCross: 0,    eyeStyle: "SLEEPY",    decor: "Z_SINGLE" },
    SLEEP:     { label: "睡觉",    mouth: { w: 6.2, h: 1.0, r: 0.7, teeth: 0, tongue: 0 },     eyeOpenMul: 0.12, eyeYBias: 1.6,  eyeCross: 0,    eyeStyle: "SLEEPY",    decor: "ZZZ" },
    CUTE:      { label: "卖萌",    mouth: { w: 5.8, h: 2.2, r: 2.0, teeth: 0, tongue: 0.3 },   eyeOpenMul: 1.0,  eyeYBias: -0.4, eyeCross: 0.9,  eyeStyle: "UP_ARC",    decor: "BLUSH" },
    SHY:       { label: "害羞",    mouth: { w: 6.0, h: 1.6, r: 1.3, teeth: 0, tongue: 0.15 },  eyeOpenMul: 0.8,  eyeYBias: 0.5,  eyeCross: 0.65, eyeStyle: "HAPPY_ARC", decor: "BLUSH" },
    HAPPY:     { label: "开心",    mouth: { w: 10.4, h: 3.2, r: 2.8, teeth: 0.4,  tongue: 0 }, eyeOpenMul: 1.0,  eyeYBias: -0.15, eyeCross: 0.15, eyeStyle: "HAPPY_ARC", decor: "NONE" },
    LAUGH:     { label: "大笑",    mouth: { w: 11.2, h: 5.6, r: 4.2, teeth: 0.8,  tongue: 0.2 }, eyeOpenMul: 1.0, eyeYBias: 0,    eyeCross: 0.2,  eyeStyle: "HAPPY_ARC", decor: "SPARKLE" },
    LOVE:      { label: "恋爱",    mouth: { w: 8.0, h: 3.2, r: 2.8, teeth: 0.2,  tongue: 0 },  eyeOpenMul: 1.0,  eyeYBias: -0.1, eyeCross: 0.1,  eyeStyle: "HEART",     decor: "HEARTS" },
    STARSTRUCK:{ label: "星星眼",  mouth: { w: 8.6, h: 3.6, r: 3.0, teeth: 0.35, tongue: 0 },  eyeOpenMul: 1.0,  eyeYBias: -0.1, eyeCross: 0.1,  eyeStyle: "STAR",      decor: "SPARKLE" },
    KISS:      { label: "嘟嘴",    mouth: { w: 5.0, h: 4.2, r: 3.8, teeth: 0, tongue: 0 },     eyeOpenMul: 0.9,  eyeYBias: 0.2,  eyeCross: 0.45, eyeStyle: "HAPPY_ARC", decor: "HEARTS" },
    PLAYFUL:   { label: "调皮",    mouth: { w: 8.4, h: 2.8, r: 2.0, teeth: 0.2, tongue: 0 },   eyeOpenMul: 1.0,  eyeYBias: -0.1, eyeCross: 0.55, eyeStyle: "HAPPY_ARC", decor: "TONGUE_OUT" },
    SMIRK:     { label: "坏笑",    mouth: { w: 8.6, h: 2.0, r: 1.2, teeth: 0.25, tongue: 0 },  eyeOpenMul: 0.75, eyeYBias: 0.3,  eyeCross: 0.05, eyeStyle: "NORMAL",    decor: "SPARKLE" },
    CALM:      { label: "平静",    mouth: { w: 7.6, h: 1.7, r: 1.0, teeth: 0, tongue: 0 },     eyeOpenMul: 0.9,  eyeYBias: 0,    eyeCross: 0,    eyeStyle: "NORMAL",    decor: "NONE" },
    CURIOUS:   { label: "好奇",    mouth: { w: 6.6, h: 3.0, r: 2.4, teeth: 0, tongue: 0 },     eyeOpenMul: 1.15, eyeYBias: -0.35, eyeCross: 0.25, eyeStyle: "DOT_BIG",  decor: "QUESTION" },
    SURPRISED: { label: "惊讶",    mouth: { w: 5.6, h: 5.6, r: 5.0, teeth: 0, tongue: 0 },     eyeOpenMul: 1.3,  eyeYBias: -0.5,  eyeCross: 0,    eyeStyle: "DOT_BIG",  decor: "EXCLAIM" },
    CONFUSED:  { label: "疑惑",    mouth: { w: 7.2, h: 2.0, r: 1.1, teeth: 0.15, tongue: 0 },  eyeOpenMul: 0.95, eyeYBias: 0.05, eyeCross: 0.15, eyeStyle: "NORMAL",    decor: "QUESTION" },
    THINKING:  { label: "思考",    mouth: { w: 7.0, h: 1.6, r: 1.0, teeth: 0, tongue: 0 },     eyeOpenMul: 0.82, eyeYBias: 0.35, eyeCross: 0.1,  eyeStyle: "NORMAL",    decor: "DOT_DOT" },
    GRUMPY:    { label: "闷闷不乐", mouth: { w: 8.4, h: 1.3, r: 0.9, teeth: 0, tongue: 0 },    eyeOpenMul: 0.7,  eyeYBias: 0.6,  eyeCross: 0.15, eyeStyle: "NORMAL",    decor: "CLOUD" },
    ANNOYED:   { label: "烦躁",    mouth: { w: 8.6, h: 1.4, r: 0.8, teeth: 0.12, tongue: 0 },  eyeOpenMul: 0.9,  eyeYBias: 0.2,  eyeCross: 0.25, eyeStyle: "X_MARK",    decor: "STEAM" },
    YAWN:      { label: "打哈欠",  mouth: { w: 9.6, h: 6.2, r: 5.4, teeth: 0.15, tongue: 0.2 }, eyeOpenMul: 1.0, eyeYBias: 0.6, eyeCross: 0,      eyeStyle: "HAPPY_ARC", decor: "NONE" },
    COOL:      { label: "耍酷",    mouth: { w: 8.0, h: 1.7, r: 0.9, teeth: 0, tongue: 0 },     eyeOpenMul: 1.0,  eyeYBias: 0,    eyeCross: 0,    eyeStyle: "COOL",      decor: "SPARKLE" },
    FOCUS:     { label: "专注",    mouth: { w: 7.0, h: 2.2, r: 1.4, teeth: 0.1,  tongue: 0 },  eyeOpenMul: 1.05, eyeYBias: 0,    eyeCross: 0.1,  eyeStyle: "DOT_SMALL", decor: "SPARKLE" },
    FOCUS_LOCK:{ label: "被注视/高度集中", mouth: { w: 6.6, h: 1.3, r: 0.9, teeth: 0, tongue: 0 }, eyeOpenMul: 1.28, eyeYBias: -0.35, eyeCross: 0.02, eyeStyle: "DOT_BIG", decor: "GAZE_LOCK_ACTION" },
    AWAKEN_LISTEN:{ label: "唤起/认真聆听", mouth: { w: 6.3, h: 1.25, r: 0.85, teeth: 0, tongue: 0 }, eyeOpenMul: 1.18, eyeYBias: -0.28, eyeCross: 0.05, eyeStyle: "DOT_BIG", decor: "AWAKEN_ACTION" },
    NERVOUS:   { label: "紧张",    mouth: { w: 6.4, h: 2.4, r: 2.0, teeth: 0.15, tongue: 0.1 }, eyeOpenMul: 1.15, eyeYBias: -0.1, eyeCross: 0.45, eyeStyle: "DOT_BIG", decor: "SWEAT" },
    DIZZY:     { label: "晕乎乎",  mouth: { w: 6.8, h: 3.0, r: 2.6, teeth: 0, tongue: 0 },     eyeOpenMul: 1.0,  eyeYBias: 0.15, eyeCross: 0,    eyeStyle: "SWIRL",     decor: "NONE" },
    PROUD:     { label: "得意",    mouth: { w: 8.4, h: 2.4, r: 1.5, teeth: 0.25, tongue: 0 },  eyeOpenMul: 1.0,  eyeYBias: -0.18, eyeCross: 0.1, eyeStyle: "HAPPY_ARC", decor: "SPARKLE" },
    DAYDREAM:  { label: "发呆",    mouth: { w: 7.2, h: 1.4, r: 0.9, teeth: 0, tongue: 0 },     eyeOpenMul: 0.55, eyeYBias: 0.9,  eyeCross: 0.06, eyeStyle: "SLEEPY",    decor: "CLOUD" },
    CRYING:    { label: "委屈",    mouth: { w: 6.0, h: 1.4, r: 0.9, teeth: 0, tongue: 0 },     eyeOpenMul: 0.85, eyeYBias: 0.2,  eyeCross: 0.3,  eyeStyle: "NORMAL",    decor: "TEARS" },
    // 以下为 TTS 页「精选生动表情」模块专用：装饰层动画更强，仍会参与空闲随机池。
    VIVID_PARTY:   { label: "狂欢派对", mouth: { w: 10.8, h: 4.2, r: 3.2, teeth: 0.35, tongue: 0.15 }, eyeOpenMul: 1.08, eyeYBias: -0.22, eyeCross: 0.12, eyeStyle: "STAR",      decor: "PARTY_POP" },
    VIVID_SPICY:   { label: "辣到喷火", mouth: { w: 9.4, h: 4.8, r: 4.0, teeth: 0.2, tongue: 0.25 },   eyeOpenMul: 1.22, eyeYBias: -0.38, eyeCross: 0.05, eyeStyle: "DOT_BIG",   decor: "FIRE_FLICKER" },
    VIVID_ROMANCE: { label: "心动暴击", mouth: { w: 8.2, h: 3.6, r: 2.9, teeth: 0.22, tongue: 0.08 }, eyeOpenMul: 1.05, eyeYBias: -0.12, eyeCross: 0.08, eyeStyle: "HEART",     decor: "HEART_BURST" },
    VIVID_BUBBLE:  { label: "泡泡幻想", mouth: { w: 6.2, h: 2.6, r: 2.1, teeth: 0, tongue: 0.2 },     eyeOpenMul: 1.02, eyeYBias: -0.35, eyeCross: 0.85, eyeStyle: "UP_ARC",    decor: "BUBBLE_DRIFT" },
    VIVID_GROOVE:  { label: "摇摆律动", mouth: { w: 9.8, h: 3.4, r: 2.6, teeth: 0.28, tongue: 0 },    eyeOpenMul: 1.0,  eyeYBias: -0.12, eyeCross: 0.18, eyeStyle: "HAPPY_ARC", decor: "NOTE_GROOVE" },
  };
  /** TTS 页「精选生动表情」模块展示的 5 个 key（与 IDLE_MOODS 对应）。 */
  const FEATURED_MOOD_KEYS = ["VIVID_PARTY", "VIVID_SPICY", "VIVID_ROMANCE", "VIVID_BUBBLE", "VIVID_GROOVE"];
  const IDLE_MOOD_KEYS = Object.keys(IDLE_MOODS);
  let currentIdleMoodKey = "BORED";
  let nextIdleMoodAtSec = 0;
  /** 非空时锁定空闲表情 key，供精选预览按钮使用；新一轮合成 bindSegments 会清空。 */
  let idleMoodPreviewKey = null;
  // 节流「眼形 + 装饰」DOM 重写，避免每帧 innerHTML 重建。
  let lastMoodVisualSig = "";
  // 过渡相关：切换情绪瞬间把旧层 opacity=1、新层 opacity=0，在 TRANSITION_DURATION 秒内交叉淡入淡出。
  const TRANSITION_DURATION = 0.32;
  let transitionStartSec = -10;
  // 装饰动画「局部时间」起点，用于让每次切换重置动画相位（例如 ZZZ 从 z 开始累加）。
  let decorStartSec = 0;
  let currentDecorKey = "NONE";

  /**
   * 当前指令场景：由外部（米家快捷指令）设置，覆盖播放时的眼形/装饰，
   * 并在播放结束后短暂保留「回执表情」（postMood）做收束动画。
   * @type {{eyeStyle:string, decor:string, postMood:string|null, postUntilSec:number}|null}
   */
  let scene = null;

  // 稍微「顿感」的插值系数：大 → 反应快但可能跳；小 → 更连贯但跟不紧。
  const LERP_ALPHA = 0.28;

  /** 左眼基准中心（与 ensureFaceDom 中一致）。 */
  const EYE_LEFT_BASE = { x: 56, y: 47 };
  /** 右眼基准中心（在上次位置基础上向右移动 1 个眼睛直径：3.6*2=7.2）。 */
  const EYE_RIGHT_BASE = { x: 80.8, y: 47 };
  /** 嘴巴基准中心。 */
  const MOUTH_BASE = { x: 79, y: 71 };
  /** 默认页面的脸部场景缩放：保持 1:1。 */
  const FACE_LAYOUT_DEFAULT = Object.freeze({ scaleX: 1, scaleY: 1, originX: 72, originY: 62 });
  /**
   * 128x64 页面专用场景缩放：
   * 放大全部脸部元素（眼/嘴/装饰/间距）以提升可读性，但不改 SVG 画布尺寸。
   */
  const FACE_LAYOUT_128 = Object.freeze({ scaleX: 1.18, scaleY: 1.1, originX: 72, originY: 62 });
  /** 默认页面 SVG 视窗：完整显示 120x120。 */
  const FACE_VIEWPORT_DEFAULT = Object.freeze({
    viewBox: "0 0 120 120",
    preserveAspectRatio: "xMidYMid meet",
  });
  /**
   * 128x64 页面专用视窗策略：
   * - 仍然使用 120x120 逻辑画布（不改画布尺寸）；
   * - 改用 `slice` 让脸部铺满 128x64 视口，避免左右大留白导致“看起来太小”。
   */
  const FACE_VIEWPORT_128 = Object.freeze({
    viewBox: "0 0 120 120",
    preserveAspectRatio: "xMidYMid slice",
  });

  /**
   * 判断当前是否为 128x64 独立页面，仅该页面启用脸部放大。
   * @returns {boolean}
   */
  function is128x64PreviewPage() {
    const body = document.body;
    return !!(body && body.classList && body.classList.contains("size-128x64-page"));
  }

  /**
   * 获取当前页面的脸部布局参数。
   * @returns {{scaleX:number, scaleY:number, originX:number, originY:number}}
   */
  function getFaceLayout() {
    return is128x64PreviewPage() ? FACE_LAYOUT_128 : FACE_LAYOUT_DEFAULT;
  }

  /**
   * 获取当前页面的 SVG 视窗策略。
   * @returns {{viewBox:string, preserveAspectRatio:string}}
   */
  function getFaceViewport() {
    return is128x64PreviewPage() ? FACE_VIEWPORT_128 : FACE_VIEWPORT_DEFAULT;
  }

  /**
   * 生成场景 transform 字符串；返回空串表示不需要缩放。
   * @param {{scaleX:number, scaleY:number, originX:number, originY:number}=} layout
   * @returns {string}
   */
  function buildFaceSceneTransform(layout) {
    const conf = layout || getFaceLayout();
    const sx = Number(conf.scaleX || 1);
    const sy = Number(conf.scaleY || 1);
    if (Math.abs(sx - 1) < 1e-6 && Math.abs(sy - 1) < 1e-6) return "";
    const ox = Number(conf.originX || 0);
    const oy = Number(conf.originY || 0);
    const tx = ox - ox * sx;
    const ty = oy - oy * sy;
    return `translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${sx.toFixed(3)},${sy.toFixed(3)})`;
  }
  /**
   * 眼睛动态默认参数（页面控件“恢复默认值”即回到这里）。
   * 说明：
   * - blink*: 眨眼节奏/幅度
   * - breathe*: 呼吸式微漂
   * - track*: 随语音节奏横向扫视
   * - mouth*: 嘴巴张开度对眼睛位置/缩放的联动
   */
  const EYE_MOTION_DEFAULTS = Object.freeze({
    blinkPeriodSec: 3.5,
    blinkDurationSec: 0.14,
    blinkAmplitude: 0.9,
    blinkYOffset: 2.4,
    breatheAmplitude: 0.25,
    breatheSpeed: 0.85,
    trackAmplitude: 0.55,
    trackSpeed: 5.2,
    trackLeftMul: 0.5,
    trackRightMul: 0.35,
    mouthEyeLiftMul: 1.6,
    opennessScaleX: 0.12,
    opennessScaleY: 0.1,
  });
  /** 当前眼睛动态参数：可被页面控件实时覆盖。 */
  let eyeMotionTuning = { ...EYE_MOTION_DEFAULTS };

  /**
   * 把未知输入安全夹紧到区间，避免 UI/外部调用传入非法值导致动画异常。
   * @param {unknown} value
   * @param {number} min
   * @param {number} max
   * @param {number} fallback
   * @returns {number}
   */
  function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  /**
   * 合并并校验眼睛动态参数。
   * @param {Record<string, unknown>=} partial
   */
  function setEyeMotionTuning(partial) {
    const p = partial || {};
    eyeMotionTuning = {
      blinkPeriodSec: clampNumber(p.blinkPeriodSec, 1.2, 8, eyeMotionTuning.blinkPeriodSec),
      blinkDurationSec: clampNumber(p.blinkDurationSec, 0.05, 0.5, eyeMotionTuning.blinkDurationSec),
      blinkAmplitude: clampNumber(p.blinkAmplitude, 0, 1.5, eyeMotionTuning.blinkAmplitude),
      blinkYOffset: clampNumber(p.blinkYOffset, 0, 4.2, eyeMotionTuning.blinkYOffset),
      breatheAmplitude: clampNumber(p.breatheAmplitude, 0, 1.2, eyeMotionTuning.breatheAmplitude),
      breatheSpeed: clampNumber(p.breatheSpeed, 0.2, 3, eyeMotionTuning.breatheSpeed),
      trackAmplitude: clampNumber(p.trackAmplitude, 0, 2.2, eyeMotionTuning.trackAmplitude),
      trackSpeed: clampNumber(p.trackSpeed, 0.5, 12, eyeMotionTuning.trackSpeed),
      trackLeftMul: clampNumber(p.trackLeftMul, 0, 1.5, eyeMotionTuning.trackLeftMul),
      trackRightMul: clampNumber(p.trackRightMul, 0, 1.5, eyeMotionTuning.trackRightMul),
      mouthEyeLiftMul: clampNumber(p.mouthEyeLiftMul, 0, 3.5, eyeMotionTuning.mouthEyeLiftMul),
      opennessScaleX: clampNumber(p.opennessScaleX, 0, 0.35, eyeMotionTuning.opennessScaleX),
      opennessScaleY: clampNumber(p.opennessScaleY, 0, 0.35, eyeMotionTuning.opennessScaleY),
    };
  }

  /**
   * 把 phone 字符串规范化：小写、去空白、去末尾声调数字。
   * @param {string} raw
   */
  function normalizePhone(raw) {
    let s = String(raw || "")
      .trim()
      .toLowerCase();
    s = s.replace(/[0-9]+$/, "");
    return s;
  }

  /**
   * 根据 phone 返回视位 key。覆盖常见 ARPABET 与 PaddleSpeech zh 词典写法。
   * @param {string} rawPhone
   * @returns {string}
   */
  function pickVisemeKey(rawPhone) {
    const p = normalizePhone(rawPhone);
    if (!p || /^(sp|sil|eps|pad|unk|_|#|<.*>)/.test(p)) return "REST";

    // ARPABET
    if (/^iy$/.test(p)) return "EE";
    if (/^(ih|ey|ae|eh)$/.test(p)) return "EH";
    if (/^(ah|ax|er)$/.test(p)) return "AH";
    if (/^(aa|ao)$/.test(p)) return "AO";
    if (/^(aw|ay)$/.test(p)) return "AW";
    if (/^(ow|oy)$/.test(p)) return "OH";
    if (/^(uw|uh)$/.test(p)) return "OO";
    if (/^ou$/.test(p)) return "OU";
    if (/^(b|m|p)$/.test(p)) return "BMP";
    if (/^(ch|jh)$/.test(p)) return "CHJH";
    if (/^(f|v)$/.test(p)) return "FV";
    if (/^r$/.test(p)) return "R";
    if (/^l$/.test(p)) return "L";
    if (/^(n|ng)$/.test(p)) return "N";
    if (/^(k|g|hh|w|y)$/.test(p)) return "KG";
    if (/^(s|z|sh|zh|th|dh|t|d)$/.test(p)) return "S";

    // 中文常见 phone 组合
    if (/^(iou|iu|ui|uei)$/.test(p)) return "OU";
    if (/^(ong|eng|en|ang|an|in|ing|un|uen)$/.test(p)) return "N";
    if (/^(iong|iang|ian|uang|uan|ua|ue|üe|ve)$/.test(p)) return "AH";
    if (/^er$/.test(p)) return "R";
    if (/^(ai|ei)$/.test(p)) return "EH";
    if (/^(ao|ia)$/.test(p)) return "AO";
    if (/^(ou|uo)$/.test(p)) return "OH";
    if (/^(u|ü|v|uu)$/.test(p)) return "OO";
    if (/^o$/.test(p)) return "AO";
    if (/^i$/.test(p)) return "EE";
    if (/^(e|ê)$/.test(p)) return "EH";
    if (/^a$/.test(p)) return "AH";
    if (/^(zh|ch|sh)$/.test(p)) return "CHJH";
    if (/^(z|c|s|x|j|q)$/.test(p)) return "S";
    if (/^(b|p|m)$/.test(p)) return "BMP";
    if (/^(f|v)$/.test(p)) return "FV";
    if (/^(k|g|h)$/.test(p)) return "KG";
    if (/^l$/.test(p)) return "L";
    if (/^(n|ng)$/.test(p)) return "N";
    if (/^(d|t)$/.test(p)) return "S";
    if (/^r$/.test(p)) return "R";

    if (/^[aeiou]/.test(p)) return "AH";
    return "REST";
  }

  /**
   * 线性插值。
   * @param {number} a
   * @param {number} b
   * @param {number} t 0~1
   */
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /**
   * 返回一个随机情绪 key，并尽量避免和上一次相同。
   * @returns {string}
   */
  function randomIdleMoodKey() {
    if (IDLE_MOOD_KEYS.length <= 1) return IDLE_MOOD_KEYS[0] || "BORED";
    let k = IDLE_MOOD_KEYS[Math.floor(Math.random() * IDLE_MOOD_KEYS.length)];
    if (k === currentIdleMoodKey) {
      k = IDLE_MOOD_KEYS[(IDLE_MOOD_KEYS.indexOf(k) + 1) % IDLE_MOOD_KEYS.length];
    }
    return k;
  }

  /**
   * 在 REST 状态下偶尔切换随机情绪。
   * @param {number} wallSec
   */
  function updateIdleMood(wallSec) {
    if (idleMoodPreviewKey) return;
    if (wallSec < nextIdleMoodAtSec) return;
    // 25% 概率回归普通 REST，75% 概率切到随机情绪，形成“偶尔冒出别的表情”。
    if (Math.random() < 0.25) {
      currentIdleMoodKey = "BORED";
    } else {
      currentIdleMoodKey = randomIdleMoodKey();
    }
    nextIdleMoodAtSec = wallSec + 1.2 + Math.random() * 3.5;
  }

  /**
   * 读取当前空闲情绪对象（兜底为 BORED）。
   */
  function getCurrentIdleMood() {
    if (idleMoodPreviewKey && IDLE_MOODS[idleMoodPreviewKey]) return IDLE_MOODS[idleMoodPreviewKey];
    return IDLE_MOODS[currentIdleMoodKey] || IDLE_MOODS.BORED;
  }

  /**
   * 根据墙钟时间计算眨眼强度 0~1（正弦包络，中间最闭）。
   * @param {number} wallSec performance.now()/1000
   */
  function blinkStrength(wallSec) {
    const period = Math.max(0.001, eyeMotionTuning.blinkPeriodSec);
    const duration = Math.max(0.001, Math.min(eyeMotionTuning.blinkDurationSec, period));
    const ph = wallSec % period;
    if (ph >= duration) return 0;
    return Math.sin((Math.PI * ph) / duration);
  }

  /**
   * 停止「仅眼睛」的 idle 动画循环。
   */
  function stopEyeIdleLoop() {
    if (eyeIdleRaf != null) {
      cancelAnimationFrame(eyeIdleRaf);
      eyeIdleRaf = null;
    }
  }

  /** 停止「等待 TTS 返回」阶段的场景动画循环。 */
  function stopSceneWaitingLoop() {
    if (sceneWaitingRaf != null) {
      cancelAnimationFrame(sceneWaitingRaf);
      sceneWaitingRaf = null;
    }
  }

  /**
   * 暂停或未绑定时仍让眼睛眨眼：每帧只更新眼睛 transform。
   */
  function eyeIdleLoop() {
    eyeIdleRaf = null;
    if (!segments || !segments.length) return;
    const wrap = document.getElementById("phoneme-face-wrap");
    if (!wrap || wrap.classList.contains("hidden")) return;
    const player = document.getElementById("player");
    const paused = !player || player.paused || player.ended;
    if (!paused) return;
    const tAudio = player && Number.isFinite(player.currentTime) ? player.currentTime : 0;
    // 音频播放结束时：强制走 REST 路径，这样 postMood 回执表情能接管；
    // 暂停（非 ended）时仍保留当前 viseme 的「定格」，只眨眼。
    const seg = player && player.ended ? null : pickSegment(tAudio);
    const targetInfo = resolveTarget(seg);
    setTargetViseme(targetInfo.key);
    applyMoodVisuals(targetInfo.key, targetInfo.eyeStyle, targetInfo.decor);
    stepLerp(targetInfo.mouth);
    const svg = document.getElementById("phoneme-face-svg");
    const group = svg && svg.querySelector("#face-mouth");
    if (group) {
      applyMouthTransform();
      paintMouth(group, displayParams);
    }
    paintEyes(tAudio);
    const wallSec = performance.now() / 1000;
    paintTransitions(wallSec);
    paintDecor(wallSec);
    setFaceStatusText(
      "空闲随机表情运行中\n当前状态 = " +
        targetInfo.key +
        "（" +
        targetInfo.label +
        "）"
    );
    eyeIdleRaf = requestAnimationFrame(eyeIdleLoop);
  }

  /**
   * 若当前应处于「仅眼睛 idle」状态则启动循环。
   */
  function scheduleEyeIdleIfNeeded() {
    const player = document.getElementById("player");
    const paused = !player || player.paused || player.ended;
    if (segments && segments.length && paused && eyeIdleRaf == null) {
      eyeIdleRaf = requestAnimationFrame(eyeIdleLoop);
    }
  }

  /**
   * 等待 TTS 返回期间（尚无 segments）仍持续播放场景动画，避免画面“卡住”。
   */
  function sceneWaitingLoop() {
    sceneWaitingRaf = null;
    if (!scene) return;
    if (segments && segments.length) return;
    const wrap = document.getElementById("phoneme-face-wrap");
    if (!wrap || wrap.classList.contains("hidden")) return;
    ensureFaceDom();
    const targetInfo = resolveTarget(null);
    setTargetViseme(targetInfo.key);
    applyMoodVisuals(targetInfo.key, targetInfo.eyeStyle, targetInfo.decor);
    stepLerp(targetInfo.mouth);
    const svg = document.getElementById("phoneme-face-svg");
    const group = svg && svg.querySelector("#face-mouth");
    if (group) {
      applyMouthTransform();
      paintMouth(group, displayParams);
    }
    paintEyes(0);
    const wallSec = performance.now() / 1000;
    paintTransitions(wallSec);
    paintDecor(wallSec);
    setFaceStatusText("状态：正在合成语音，先播放指令动作预览...");
    sceneWaitingRaf = requestAnimationFrame(sceneWaitingLoop);
  }

  /**
   * 同步写入主状态文字与悬浮状态文字，保证滚动页面时也能看到状态。
   * @param {string} text
   */
  function setFaceStatusText(text) {
    const main = document.getElementById("phoneme-face-label");
    if (main) main.textContent = text;
    const floating = document.getElementById("floating-status-text");
    if (floating) floating.textContent = text;
  }

  /**
   * 场景附加姿态：开空调时给嘴部叠加“打哆嗦”抖动。
   */
  function applyMouthTransform() {
    const svg = document.getElementById("phoneme-face-svg");
    const group = svg && svg.querySelector("#face-mouth");
    if (!group) return;
    const wallSec = performance.now() / 1000;
    let dx = 0;
    let dy = 0;
    if (scene && scene.decor === "AC_ON_ACTION" && scene.postUntilSec <= 0) {
      dx = Math.sin(wallSec * 18) * 0.95;
      dy = Math.sin(wallSec * 24) * 0.55;
    }
    group.setAttribute(
      "transform",
      "translate(" + (MOUTH_BASE.x + dx).toFixed(2) + "," + (MOUTH_BASE.y + dy).toFixed(2) + ")"
    );
  }

  /**
   * 根据嘴张开度与音频时间更新左右眼组的 transform（translate + scale）。
   * @param {number} tAudioSec 播放器当前秒，用于轻微扫视相位。
   */
  function paintEyes(tAudioSec) {
    const svg = document.getElementById("phoneme-face-svg");
    if (!svg || svg.dataset.ready !== "1") return;
    const leftG = svg.querySelector("#face-eye-left");
    const rightG = svg.querySelector("#face-eye-right");
    if (!leftG || !rightG) return;

    const wallSec = performance.now() / 1000;
    const blink = blinkStrength(wallSec);
    const idleMood = targetKey.startsWith("IDLE:") ? getCurrentIdleMood() : null;
    // 嘴半高越大 → 略放大眼睛、略上移，像跟着重音「瞪一下」。
    const openness = Math.min(1, Math.max(0, (displayParams.h - 2) / 5.5));
    const breathe = Math.sin(wallSec * eyeMotionTuning.breatheSpeed) * eyeMotionTuning.breatheAmplitude;
    const track = Number.isFinite(tAudioSec)
      ? Math.sin(tAudioSec * eyeMotionTuning.trackSpeed) * eyeMotionTuning.trackAmplitude
      : 0;

    const eyeOpenMul = idleMood ? Number(idleMood.eyeOpenMul || 1) : 1;
    const eyeYBias = idleMood ? Number(idleMood.eyeYBias || 0) : 0;
    const eyeCross = idleMood ? Number(idleMood.eyeCross || 0) : 0;
    // 注视/唤起后段：眼睛整体放大并更“睁开”，体现注意力明显提升。
    const isGazeActive = scene && scene.decor === "GAZE_LOCK_ACTION" && scene.postUntilSec <= 0;
    const isAwakenFocus = scene && scene.decor === "AWAKEN_ACTION" && scene.postUntilSec <= 0 && (wallSec - decorStartSec) >= 0.92;
    const attentionBoostX = (isGazeActive || isAwakenFocus) ? 1.2 : 1;
    const attentionBoostY = (isGazeActive || isAwakenFocus) ? 1.42 : 1;
    const sx = (1 + openness * eyeMotionTuning.opennessScaleX) * (1 + eyeCross * 0.05) * attentionBoostX;
    const sy =
      (1 - blink * eyeMotionTuning.blinkAmplitude) *
      (1 + openness * eyeMotionTuning.opennessScaleY) *
      eyeOpenMul *
      attentionBoostY;

    // 开空调：眼睛也参与抖动，强化“打哆嗦”体感。
    let shiverX = 0;
    let shiverY = 0;
    if (scene && scene.decor === "AC_ON_ACTION" && scene.postUntilSec <= 0) {
      shiverX = Math.sin(wallSec * 18) * 0.95;
      shiverY = Math.sin(wallSec * 24) * 0.55;
    }
    const txL = EYE_LEFT_BASE.x + breathe + track * eyeMotionTuning.trackLeftMul + eyeCross + shiverX;
    const tyL =
      EYE_LEFT_BASE.y -
      openness * eyeMotionTuning.mouthEyeLiftMul +
      blink * eyeMotionTuning.blinkYOffset +
      eyeYBias +
      shiverY;
    const txR = EYE_RIGHT_BASE.x + breathe - track * eyeMotionTuning.trackRightMul - eyeCross + shiverX;
    const tyR =
      EYE_RIGHT_BASE.y -
      openness * eyeMotionTuning.mouthEyeLiftMul +
      blink * eyeMotionTuning.blinkYOffset +
      eyeYBias +
      shiverY;

    leftG.setAttribute(
      "transform",
      "translate(" + txL.toFixed(2) + "," + tyL.toFixed(2) + ") scale(" + sx.toFixed(3) + "," + sy.toFixed(3) + ")"
    );
    rightG.setAttribute(
      "transform",
      "translate(" + txR.toFixed(2) + "," + tyR.toFixed(2) + ") scale(" + sx.toFixed(3) + "," + sy.toFixed(3) + ")"
    );

    // 米家「开灯」：前半段日常白圆眼，后半段切换为 emoji 💡 灯泡眼（避免「一种灯泡变另一种灯泡」）。
    if (scene && scene.decor === "LIGHT_ON_ACTION" && scene.postUntilSec <= 0) {
      const tRel = wallSec - decorStartSec;
      const phase = tRel < 0.55 ? "g" : "e";
      const leftNew = svg.querySelector("#face-eye-left-new");
      const rightNew = svg.querySelector("#face-eye-right-new");
      if (leftNew && rightNew) {
        const cur = leftNew.getAttribute("data-ph-light");
        if (cur !== phase) {
          const html = phase === "g" ? EYE_SHAPES.NORMAL : EYE_SHAPES.BULB_EMOJI;
          leftNew.innerHTML = html;
          rightNew.innerHTML = html;
          leftNew.setAttribute("data-ph-light", phase);
          rightNew.setAttribute("data-ph-light", phase);
        }
      }
    }

    // 米家「唤起」：加入“睡觉 -> 唤醒 -> 专注听命”的眼形过渡，避免直接跳变。
    if (scene && scene.decor === "AWAKEN_ACTION" && scene.postUntilSec <= 0) {
      const tRel = wallSec - decorStartSec;
      // s = sleepy（睡眠），n = normal（睁开），f = focus（专注）
      let phase = "f";
      if (tRel < 0.48) phase = "s";
      else if (tRel < 0.92) phase = "n";
      const leftNew = svg.querySelector("#face-eye-left-new");
      const rightNew = svg.querySelector("#face-eye-right-new");
      if (leftNew && rightNew) {
        const cur = leftNew.getAttribute("data-ph-awaken");
        if (cur !== phase) {
          const html =
            phase === "s"
              ? (EYE_SHAPES.SLEEPY || EYE_SHAPES.NORMAL)
              : phase === "n"
                ? EYE_SHAPES.NORMAL
                : (EYE_SHAPES.DOT_BIG || EYE_SHAPES.NORMAL);
          leftNew.innerHTML = html;
          rightNew.innerHTML = html;
          leftNew.setAttribute("data-ph-awaken", phase);
          rightNew.setAttribute("data-ph-awaken", phase);
        }
      }
    }
  }

  /** 把 displayParams 向 target 参数插值一步。 */
  function stepLerp(target) {
    displayParams.w = lerp(displayParams.w, target.w, LERP_ALPHA);
    displayParams.h = lerp(displayParams.h, target.h, LERP_ALPHA);
    displayParams.r = lerp(displayParams.r, target.r, LERP_ALPHA);
    displayParams.teeth = lerp(displayParams.teeth, target.teeth, LERP_ALPHA);
    displayParams.tongue = lerp(displayParams.tongue, target.tongue, LERP_ALPHA);
  }

  const SVG_NS = "http://www.w3.org/2000/svg";

  /**
   * 在嘴部容器里预建三件套元素（rect/line/path），返回引用以便后续只做 setAttribute。
   * @param {SVGGElement} group
   */
  function ensureMouthElements(group) {
    if (group._mouthReady) return;
    while (group.firstChild) group.removeChild(group.firstChild);
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("fill", "none");
    rect.setAttribute("stroke", "#ffffff");
    rect.setAttribute("stroke-width", "1.8");
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("stroke", "#ffffff");
    line.setAttribute("stroke-width", "1.1");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("fill", "#ffffff");
    group.appendChild(rect);
    group.appendChild(line);
    group.appendChild(path);
    group._mouthRect = rect;
    group._mouthLine = line;
    group._mouthTongue = path;
    group._mouthReady = true;
  }

  /**
   * 按参数刷新嘴部（仅 setAttribute，无 DOM 重建）。
   * @param {SVGGElement} group
   * @param {{w:number,h:number,r:number,teeth:number,tongue:number}} p
   */
  function paintMouth(group, p) {
    ensureMouthElements(group);
    const w = Math.max(0.5, p.w);
    const h = Math.max(0.5, p.h);
    const r = Math.max(0, Math.min(p.r, Math.min(w, h)));
    const teeth = Math.max(0, Math.min(1, p.teeth));
    const tongue = Math.max(0, Math.min(1, p.tongue));
    const teethY = -h + Math.max(0.8, h * 0.4);
    const tongueTopY = -h * 0.25;
    const tongueBotY = h * 0.65;

    const rect = group._mouthRect;
    rect.setAttribute("x", (-w).toFixed(2));
    rect.setAttribute("y", (-h).toFixed(2));
    rect.setAttribute("width", (2 * w).toFixed(2));
    rect.setAttribute("height", (2 * h).toFixed(2));
    rect.setAttribute("rx", r.toFixed(2));
    rect.setAttribute("ry", r.toFixed(2));

    const line = group._mouthLine;
    line.setAttribute("x1", (-w * 0.7).toFixed(2));
    line.setAttribute("y1", teethY.toFixed(2));
    line.setAttribute("x2", (w * 0.7).toFixed(2));
    line.setAttribute("y2", teethY.toFixed(2));
    line.setAttribute("opacity", teeth.toFixed(2));

    const path = group._mouthTongue;
    path.setAttribute(
      "d",
      "M " + (-w * 0.22).toFixed(2) + " " + tongueBotY.toFixed(2) +
        " L 0 " + tongueTopY.toFixed(2) +
        " L " + (w * 0.22).toFixed(2) + " " + tongueBotY.toFixed(2) + " Z"
    );
    path.setAttribute("opacity", tongue.toFixed(2));
  }

  /**
   * 在给定时间点查找当前音素段。
   * @param {number} t
   */
  function pickSegment(t) {
    if (!segments || !segments.length) return null;
    const tt = Number.isFinite(t) ? t : 0;
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      if (tt >= s.start_sec && tt < s.end_sec) return s;
    }
    const last = segments[segments.length - 1];
    if (tt >= last.start_sec) return last;
    return segments[0];
  }

  /**
   * 首次挂载：往主人脸 SVG 注入静态元素 + 嘴的占位容器。
   *
   * 布局按预览卡 80×56 的比例等比放大到 200×120：
   *   在保持大小不变前提下，把「眼中心 -> 嘴中心」位移缩小 30%（方向向左上）。
   *   当前大脸 eye={74,106}/y=47，眼中点 x=90，嘴 translate(97,71)；
   *   当前预览 eye={30,42}/y=22，眼中点 x=36，嘴 translate(39,33)。
   */
  function ensureFaceDom() {
    const svg = document.getElementById("phoneme-face-svg");
    if (!svg || svg.dataset.ready === "1") return;
    const sceneTransform = buildFaceSceneTransform();
    const viewport = getFaceViewport();
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.setAttribute("viewBox", viewport.viewBox);
    svg.setAttribute("preserveAspectRatio", viewport.preserveAspectRatio);
    svg.innerHTML = [
      // 主画布背景改为透明：由外层容器底色（深灰）来承接视觉背景。
      '<rect x="0" y="0" width="120" height="120" fill="transparent"/>',
      sceneTransform
        ? `<g id="face-scene" transform="${sceneTransform}">`
        : '<g id="face-scene">',
      // 眼睛放在独立 <g> 内：外层 <g> 做 translate+scale 的动画，
      // 内部再嵌两层 `-old` / `-new`，用透明度交叉淡入淡出，切换不会「啪」一下跳。
      '<g id="face-eye-left" transform="translate(56,47)">' +
        '<g id="face-eye-left-old" opacity="0"></g>' +
        '<g id="face-eye-left-new" opacity="1"><circle cx="0" cy="0" r="3.6" fill="#ffffff"/></g>' +
        '</g>',
      '<g id="face-eye-right" transform="translate(80.8,47)">' +
        '<g id="face-eye-right-old" opacity="0"></g>' +
        '<g id="face-eye-right-new" opacity="1"><circle cx="0" cy="0" r="3.6" fill="#ffffff"/></g>' +
        '</g>',
      '<g id="face-mouth" transform="translate(79,71)"></g>',
      // 贴图装饰层也用 `-old` / `-new` 双层，交叉淡入淡出避免瞬切。
      '<g id="face-decor">' +
        '<g id="face-decor-old" opacity="0"></g>' +
        '<g id="face-decor-new" opacity="1"></g>' +
        '</g>',
      '</g>',
      '<text id="face-viseme-text" x="42" y="112" font-family="Consolas, Menlo, monospace" font-size="12" fill="#ffffff" text-anchor="middle" letter-spacing="1.4">REST</text>',
    ].join("");
    svg.dataset.ready = "1";
    lastMoodVisualSig = "";
    transitionStartSec = -10;
    paintMouth(svg.querySelector("#face-mouth"), displayParams);
    paintEyes(0);
  }

  /**
   * 把 DECOR_DEFS[decorKey] 的声明实例化成 SVG DOM，追加进指定容器。
   * 每个元素的 anim 回调挂在 DOM 节点的 __anim 属性上，供 paintDecor 每帧调用。
   * @param {SVGElement} container
   * @param {string} decorKey
   */
  function buildDecorElements(container, decorKey) {
    const defs = DECOR_DEFS[decorKey] || [];
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i];
      const el = document.createElementNS(SVG_NS, d.tag);
      if (d.attrs) {
        for (const k in d.attrs) {
          el.setAttribute(k, d.attrs[k]);
        }
      }
      if (d.text != null) {
        el.textContent = d.text;
      }
      if (d.html != null) {
        // SVG 元素可直接通过 innerHTML 写入子节点（现代浏览器已支持）。
        el.innerHTML = d.html;
      }
      if (d.anim) el.__anim = d.anim;
      container.appendChild(el);
    }
  }

  /**
   * 切换情绪时：
   *   1. 把 `-new` 的内容搬到 `-old`，让它淡出（但保留已渲染帧画面）；
   *   2. 在 `-new` 里重建新装饰/眼形元素，让它淡入；
   *   3. 记录 `transitionStartSec` 与 `decorStartSec`，供 paintTransitions + paintDecor 使用。
   * 用签名节流，同一组 (key, eyeStyle, decor) 重复调用不会重建。
   * @param {string} key 目标 key（viseme 原 key 或 "IDLE:XXX"）
   * @param {string} eyeStyle EYE_SHAPES 的 key
   * @param {string} decorKey DECOR_DEFS 的 key
   */
  function applyMoodVisuals(key, eyeStyle, decorKey) {
    // 注意：签名不再包含 key（visemeKey 会高频变化），否则会导致同一装饰反复重建，
    // 像「拉绳」这类一次性动作会在说话期间不断重复触发。
    const sig = eyeStyle + "|" + decorKey;
    if (sig === lastMoodVisualSig) return;
    lastMoodVisualSig = sig;
    const svg = document.getElementById("phoneme-face-svg");
    if (!svg) return;
    const isActionDecor = typeof decorKey === "string" && decorKey.endsWith("_ACTION");

    // 眼睛双层交叉：new 的内容搬到 old → new 重建。
    ["left", "right"].forEach((side) => {
      const oldG = svg.querySelector("#face-eye-" + side + "-old");
      const newG = svg.querySelector("#face-eye-" + side + "-new");
      if (!oldG || !newG) return;
      oldG.innerHTML = newG.innerHTML;
      newG.innerHTML = EYE_SHAPES[eyeStyle] || EYE_SHAPES.NORMAL;
      // 开灯场景会在 paintEyes 里按时间切换日常眼/💡，重建眼形时清掉阶段标记。
      newG.removeAttribute("data-ph-light");
      // 唤起场景会在 paintEyes 里按时间切换睡眠/唤醒/专注，重建时清掉阶段标记。
      newG.removeAttribute("data-ph-awaken");
    });

    // 装饰双层交叉：new 的 DOM 搬到 old（保留静态快照），new 重建带 anim 的新一组元素。
    const decorOld = svg.querySelector("#face-decor-old");
    const decorNew = svg.querySelector("#face-decor-new");
    if (decorOld && decorNew) {
      // 用 innerHTML 快照搬家：旧层放弃动画只做淡出，够用。
      decorOld.innerHTML = decorNew.innerHTML;
      while (decorNew.firstChild) decorNew.removeChild(decorNew.firstChild);
      buildDecorElements(decorNew, decorKey);
    }
    currentDecorKey = decorKey;

    const now = performance.now() / 1000;
    // 米家动作装饰要求“直接进入正片”，不做首帧交叉淡入，避免先闪一下。
    if (isActionDecor) {
      transitionStartSec = now - TRANSITION_DURATION;
      // 动作场景下清空 old 层，彻底避免 old/new 混叠的闪帧。
      ["left", "right"].forEach((side) => {
        const oldG = svg.querySelector("#face-eye-" + side + "-old");
        if (oldG) oldG.innerHTML = "";
      });
      const dOld = svg.querySelector("#face-decor-old");
      if (dOld) dOld.innerHTML = "";
    } else {
      transitionStartSec = now;
    }
    decorStartSec = now;
  }

  /**
   * 每帧更新交叉淡入淡出透明度（眼 + 装饰）。
   * 只在 TRANSITION_DURATION 窗口内生效；窗口之外 new=1 / old=0。
   * @param {number} wallSec performance.now()/1000
   */
  function paintTransitions(wallSec) {
    const svg = document.getElementById("phoneme-face-svg");
    if (!svg || svg.dataset.ready !== "1") return;
    const u = Math.max(0, Math.min(1, (wallSec - transitionStartSec) / TRANSITION_DURATION));
    const uNew = u.toFixed(3);
    const uOld = (1 - u).toFixed(3);
    ["left", "right"].forEach((side) => {
      const oldG = svg.querySelector("#face-eye-" + side + "-old");
      const newG = svg.querySelector("#face-eye-" + side + "-new");
      if (oldG) oldG.setAttribute("opacity", uOld);
      if (newG) newG.setAttribute("opacity", uNew);
    });
    const dOld = svg.querySelector("#face-decor-old");
    const dNew = svg.querySelector("#face-decor-new");
    if (dOld) dOld.setAttribute("opacity", uOld);
    if (dNew) dNew.setAttribute("opacity", uNew);
  }

  /**
   * 每帧根据「装饰出现以来经过秒数」驱动 `-new` 图层里每个元素的 anim 回调。
   * anim 返回对象示例：{ opacity, transform, text, ... }，会逐键 setAttribute；
   * `text` 特殊键会改写 textContent（用于 ZZZ 那种文字累加）。
   * @param {number} wallSec
   */
  function paintDecor(wallSec) {
    const group = document.querySelector("#face-decor-new");
    if (!group) return;
    const t = Math.max(0, wallSec - decorStartSec);
    const children = group.children;
    for (let i = 0; i < children.length; i++) {
      const el = children[i];
      if (!el.__anim) continue;
      const out = el.__anim(t);
      if (!out) continue;
      for (const k in out) {
        if (k === "text") {
          if (el.textContent !== out[k]) el.textContent = out[k];
        } else {
          el.setAttribute(k, out[k]);
        }
      }
    }
  }

  /** 切换大脸的目标视位；实际数值靠 stepLerp 每帧插值。 */
  function setTargetViseme(key) {
    if (!VISEMES[key]) key = "REST";
    targetKey = key;
    const txt = document.getElementById("face-viseme-text");
    if (txt) txt.textContent = key;
  }

  /**
   * 根据当前音素段选择目标参数：非 REST 走正常视位，REST 走随机空闲情绪。
   * @param {{phone:string}|null} seg
   * @returns {{key:string,label:string,mouth:{w:number,h:number,r:number,teeth:number,tongue:number}}}
   */
  /**
   * 「扫地吸尘」嘴型：在 REST 与圆嘴 OO 之间振荡，模拟用力吸气。
   * @param {number} wallSec 墙钟秒
   */
  function mouthCleanSuck(wallSec) {
    const p = 0.5 + 0.5 * Math.sin(wallSec * 6.8);
    const q = p * 0.92;
    const r0 = VISEMES.REST;
    const r1 = VISEMES.OO;
    return {
      w: r0.w * (1 - q) + r1.w * q,
      h: r0.h * (1 - q) + r1.h * q,
      r: r0.r * (1 - q) + r1.r * q,
      teeth: 0,
      tongue: 0,
    };
  }

  /**
   * 「被注视」嘴型：保持克制闭口，同时轻微紧张脉冲，体现注意力高度集中。
   * @param {number} wallSec 墙钟秒
   */
  function mouthGazeLock(wallSec) {
    const p = 0.5 + 0.5 * Math.sin(wallSec * 7.6);
    const base = VISEMES.REST;
    return {
      w: base.w - 0.45 + p * 0.22,
      h: 1.08 + p * 0.25,
      r: 0.82 + p * 0.12,
      teeth: 0,
      tongue: 0,
    };
  }

  /**
   * 「唤起聆听」嘴型：先收口，再出现轻微紧绷起伏，体现“认真听主人吩咐”。
   * @param {number} wallSec 墙钟秒
   */
  function mouthAwakenListen(wallSec) {
    const p = 0.5 + 0.5 * Math.sin(wallSec * 8.2);
    const base = VISEMES.REST;
    return {
      w: base.w - 0.6 + p * 0.2,
      h: 1.0 + p * 0.22,
      r: 0.78 + p * 0.1,
      teeth: 0,
      tongue: 0,
    };
  }

  function resolveTarget(seg) {
    const wallSec = performance.now() / 1000;
    // 读取播放器运行态：用于区分“说话中的静音段”和“真正空闲待机”。
    const player = document.getElementById("player");
    const isActivePlayback = !!(player && !player.paused && !player.ended);

    // 场景过期（postUntilSec 已过）自动清场，回到普通随机 idle。
    if (scene && scene.postUntilSec > 0 && wallSec >= scene.postUntilSec) {
      scene = null;
    }

    const visemeKey = seg ? pickVisemeKey(seg.phone) : "REST";
    if (visemeKey !== "REST") {
      const v = VISEMES[visemeKey] || VISEMES.REST;
      // 米家指令场景：按用户要求，执行动作动画时不再播放说话口型。
      // 默认固定 REST 嘴；音乐播放场景给一个轻微“哼唱”起伏。
      let mouthOut = v;
      if (scene) {
        if (scene.decor === "MUSIC_ON_ACTION") {
          const hum = 0.5 + 0.5 * Math.sin(wallSec * 5.2);
          const base = VISEMES.REST;
          mouthOut = {
            w: base.w + hum * 0.38,
            h: base.h + hum * 0.58,
            r: base.r + hum * 0.22,
            teeth: 0,
            tongue: 0,
          };
        } else if (scene.decor === "CLEAN_ACTION") {
          mouthOut = mouthCleanSuck(wallSec);
        } else if (scene.decor === "GAZE_LOCK_ACTION") {
          mouthOut = mouthGazeLock(wallSec);
        } else if (scene.decor === "AWAKEN_ACTION") {
          mouthOut = mouthAwakenListen(wallSec);
        } else {
          mouthOut = VISEMES.REST;
        }
      }
      return {
        key: visemeKey,
        label: v.label,
        mouth: mouthOut,
        eyeStyle: scene ? scene.eyeStyle : "NORMAL",
        decor: scene ? scene.decor : "NONE",
      };
    }

    // REST：若指令场景正在执行中（postUntilSec 尚未设置），
    // 也要持续同一场景动画，不允许掉回随机 idle（否则会出现“中途重置一次”的断裂感）。
    if (scene && scene.postUntilSec <= 0) {
      const base = VISEMES.REST;
      let mouthOut = base;
      // 播放音乐场景在停顿段也保持轻微“哼唱”起伏，避免卡住。
      if (scene.decor === "MUSIC_ON_ACTION") {
        const hum = 0.5 + 0.5 * Math.sin(wallSec * 5.2);
        mouthOut = {
          w: base.w + hum * 0.38,
          h: base.h + hum * 0.58,
          r: base.r + hum * 0.22,
          teeth: 0,
          tongue: 0,
        };
      } else if (scene.decor === "CLEAN_ACTION") {
        mouthOut = mouthCleanSuck(wallSec);
      } else if (scene.decor === "GAZE_LOCK_ACTION") {
        mouthOut = mouthGazeLock(wallSec);
      } else if (scene.decor === "AWAKEN_ACTION") {
        mouthOut = mouthAwakenListen(wallSec);
      }
      return {
        key: "SCENE:RUNNING",
        label: "指令执行中",
        mouth: mouthOut,
        eyeStyle: scene.eyeStyle || "NORMAL",
        decor: scene.decor || "NONE",
      };
    }

    // REST：如果场景有 postMood 且窗口内，就强制用 postMood 作为回执表情，
    // 不再随机。这样命令执行完有一个统一的「收束」表情（例如关灯 → SLEEP）。
    if (
      scene &&
      scene.postUntilSec > 0 &&
      wallSec < scene.postUntilSec &&
      scene.postMood &&
      IDLE_MOODS[scene.postMood]
    ) {
      const pm = IDLE_MOODS[scene.postMood];
      return {
        key: "SCENE:" + scene.postMood,
        label: "指令回执/" + pm.label,
        mouth: pm.mouth,
        eyeStyle: pm.eyeStyle || "NORMAL",
        decor: pm.decor || "NONE",
      };
    }

    // 关键修正：
    // 说话过程中会夹杂 REST/sil 段（停顿、换气、断句）。这些段如果也走随机情绪，
    // 视觉上会出现“说到一半突然卖萌/睡觉”的违和感。
    // 因此在“音频正在播放”时，REST 一律收敛到中性态；仅在暂停/播完后才进入随机 idle。
    if (isActivePlayback) {
      return {
        key: "REST:PLAYING",
        label: "播放中静音段/中性",
        mouth: VISEMES.REST,
        eyeStyle: "NORMAL",
        decor: "NONE",
      };
    }

    updateIdleMood(wallSec);
    const mood = getCurrentIdleMood();
    const moodKeyActive = idleMoodPreviewKey || currentIdleMoodKey;
    // 某些情绪的嘴巴要呼吸起伏（像打呼噜），避免「死表情」：
    // SLEEP 深睡 → 嘴 h/w 明显随 ~0.6Hz 起伏；SLEEPY 犯困、DAYDREAM 发呆 → 轻微抖一抖。
    let mouthOut = mood.mouth;
    if (currentIdleMoodKey === "SLEEP") {
      const br = 0.5 + 0.5 * Math.sin(wallSec * 1.5);
      mouthOut = {
        w: mood.mouth.w + br * 0.5,
        h: mood.mouth.h + br * 1.2,
        r: mood.mouth.r + br * 0.4,
        teeth: mood.mouth.teeth,
        tongue: mood.mouth.tongue,
      };
    } else if (currentIdleMoodKey === "SLEEPY" || currentIdleMoodKey === "DAYDREAM") {
      const br = 0.5 + 0.5 * Math.sin(wallSec * 1.1);
      mouthOut = {
        w: mood.mouth.w + br * 0.25,
        h: mood.mouth.h + br * 0.5,
        r: mood.mouth.r + br * 0.15,
        teeth: mood.mouth.teeth,
        tongue: mood.mouth.tongue,
      };
    } else if (moodKeyActive === "VIVID_PARTY" || moodKeyActive === "VIVID_GROOVE") {
      const br = 0.5 + 0.5 * Math.sin(wallSec * 4.0);
      mouthOut = {
        w: mood.mouth.w + br * 0.55,
        h: mood.mouth.h + br * 0.42,
        r: mood.mouth.r + br * 0.18,
        teeth: mood.mouth.teeth,
        tongue: mood.mouth.tongue,
      };
    } else if (moodKeyActive === "VIVID_ROMANCE") {
      const br = 0.5 + 0.5 * Math.sin(wallSec * 2.6);
      mouthOut = {
        w: mood.mouth.w + br * 0.28,
        h: mood.mouth.h + br * 0.22,
        r: mood.mouth.r + br * 0.12,
        teeth: mood.mouth.teeth,
        tongue: mood.mouth.tongue,
      };
    } else if (moodKeyActive === "VIVID_BUBBLE") {
      const br = 0.5 + 0.5 * Math.sin(wallSec * 2.2);
      mouthOut = {
        w: mood.mouth.w + br * 0.18,
        h: mood.mouth.h + br * 0.35,
        r: mood.mouth.r + br * 0.2,
        teeth: mood.mouth.teeth,
        tongue: mood.mouth.tongue,
      };
    } else if (moodKeyActive === "VIVID_SPICY") {
      const br = 0.5 + 0.5 * Math.sin(wallSec * 7.5);
      mouthOut = {
        w: mood.mouth.w + br * 0.35,
        h: mood.mouth.h + br * 0.62,
        r: mood.mouth.r + br * 0.22,
        teeth: mood.mouth.teeth,
        tongue: mood.mouth.tongue,
      };
    }
    return {
      key: "IDLE:" + (idleMoodPreviewKey || currentIdleMoodKey),
      label: "空闲情绪/" + mood.label,
      mouth: mouthOut,
      eyeStyle: mood.eyeStyle || "NORMAL",
      decor: mood.decor || "NONE",
    };
  }

  /**
   * 显隐人脸外层。
   * @param {boolean} visible
   */
  function setWrapVisible(visible) {
    const wrap = document.getElementById("phoneme-face-wrap");
    const empty = document.getElementById("phoneme-face-empty");
    if (wrap) wrap.classList.toggle("hidden", !visible);
    if (empty) empty.classList.toggle("hidden", visible);
  }

  /**
   * 构造一张预览小卡（同一套嘴模型，静态展示），供底部 gallery 使用。
   * @param {string} key
   * @returns {HTMLElement}
   */
  function makeGalleryCard(key) {
    const v = VISEMES[key];
    const card = document.createElement("div");
    card.className = "viseme-card";
    card.setAttribute("data-key", key);
    card.innerHTML = [
      '<svg viewBox="0 0 56 56" width="92" height="92" xmlns="http://www.w3.org/2000/svg">',
      // 预览卡也使用完整正方形画布，避免“方块外还有底色”。
      '<rect x="0" y="0" width="56" height="56" fill="transparent"/>',
      '<circle cx="21.6" cy="22" r="2.4" fill="#ffffff"/>',
      '<circle cx="28.8" cy="22" r="2.4" fill="#ffffff"/>',
      '<g transform="translate(30.6,33)" id="m"></g>',
      "</svg>",
      `<div class="viseme-card-key">${key}</div>`,
      `<div class="viseme-card-label">${v.label}</div>`,
    ].join("");
    // 画静态嘴
    const group = card.querySelector("#m");
    if (group) {
      paintMouth(group, v);
    }
    return card;
  }

  /**
   * 在底部容器渲染所有视位卡片。
   * @param {HTMLElement} container
   */
  function renderGallery(container) {
    if (!container) return;
    container.innerHTML = "";
    Object.keys(VISEMES).forEach((key) => {
      container.appendChild(makeGalleryCard(key));
    });
  }

  /**
   * 构造情绪预览卡：展示随机程序中的静态状态（20+）。
   * @param {string} moodKey
   * @returns {HTMLElement}
   */
  function makeMoodCard(moodKey) {
    const mood = IDLE_MOODS[moodKey];
    const card = document.createElement("div");
    card.className = "viseme-card mood-card";
    card.setAttribute("data-mood", moodKey);
    const eyeCross = Number(mood.eyeCross || 0) * 0.55;
    const eyeY = 22 + Number(mood.eyeYBias || 0) * 0.6;
    const eyeOpenMul = Number(mood.eyeOpenMul || 1);
    // 预览卡里单眼半径 2.4，相对主脸 3.6 的缩放 = 0.667。
    const eyeScale = 2.4 / 3.6;
    const eyeSvg = EYE_SHAPES[mood.eyeStyle || "NORMAL"] || EYE_SHAPES.NORMAL;
    const eyeOpenScaleY = Math.max(0.12, eyeOpenMul).toFixed(3);
    // 把主脸半径 3.6 的眼形包一个缩放 + 纵向开合倍率，模拟眯眼/瞪眼静态感。
    const eyeWrapL = `<g transform="translate(${(21.6 + eyeCross).toFixed(2)},${eyeY.toFixed(2)}) scale(${eyeScale.toFixed(3)},${(eyeScale * eyeOpenScaleY).toFixed(3)})">${eyeSvg}</g>`;
    const eyeWrapR = `<g transform="translate(${(28.8 - eyeCross).toFixed(2)},${eyeY.toFixed(2)}) scale(${eyeScale.toFixed(3)},${(eyeScale * eyeOpenScaleY).toFixed(3)})">${eyeSvg}</g>`;
    const decorSmall = DECOR_SMALL[mood.decor || "NONE"] || "";
    card.innerHTML = [
      '<svg viewBox="0 0 56 56" width="92" height="92" xmlns="http://www.w3.org/2000/svg">',
      '<rect x="0" y="0" width="56" height="56" fill="transparent"/>',
      eyeWrapL,
      eyeWrapR,
      '<g transform="translate(30.6,33)" id="m"></g>',
      decorSmall,
      "</svg>",
      `<div class="viseme-card-key">${moodKey}</div>`,
      `<div class="viseme-card-label">${mood.label}</div>`,
      `<button class="download-svg-btn" type="button" onclick="PhonemeFaceApi.downloadSvg(this)" data-name="${moodKey}">下载 SVG</button>`,
    ].join("");
    const group = card.querySelector("#m");
    if (group) paintMouth(group, mood.mouth);
    return card;
  }

  /**
   * 渲染全部随机情绪预览卡。
   * @param {HTMLElement} container
   */
  function renderMoodGallery(container) {
    if (!container) return;
    container.innerHTML = "";
    IDLE_MOOD_KEYS.forEach((moodKey) => {
      container.appendChild(makeMoodCard(moodKey));
    });
  }

  function renderMoodTable(tbody) {
    if (!tbody) return;
    tbody.innerHTML = "";
    IDLE_MOOD_KEYS.forEach((moodKey) => {
      const mood = IDLE_MOODS[moodKey];
      if (!mood) return;
      const tr = document.createElement("tr");
      const mouth = mood.mouth || {};
      const cells = [
        moodKey,
        mood.label || "",
        mood.eyeStyle || "",
        mood.decor || "",
        String(mood.eyeOpenMul ?? ""),
        String(mood.eyeYBias ?? ""),
        String(mood.eyeCross ?? ""),
        `${mouth.w ?? ""},${mouth.h ?? ""},${mouth.r ?? ""}`,
        String(mouth.teeth ?? ""),
        String(mouth.tongue ?? ""),
      ];
      cells.forEach((txt) => {
        const td = document.createElement("td");
        td.textContent = txt;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  function buildFaceSvgStringForExport(opts) {
    const eyeStyle = (opts && opts.eyeStyle) || "NORMAL";
    const decorKey = (opts && opts.decor) || "NONE";
    const mouth = (opts && opts.mouth) || VISEMES.REST;
    const t = Number.isFinite(opts && opts.t) ? Number(opts.t) : 0;
    const bgColor = (opts && opts.bgColor) || "transparent";

    const svg = document.createElementNS(SVG_NS, "svg");
    const viewport = getFaceViewport();
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.setAttribute("viewBox", viewport.viewBox);
    svg.setAttribute("preserveAspectRatio", viewport.preserveAspectRatio);

    svg.setAttribute("style", "background: transparent;");
    const sceneLayer = document.createElementNS(SVG_NS, "g");
    // 导出卡片也沿用页面布局缩放，保证 128x64 页面“主脸与图库”视觉一致。
    const sceneTransform = buildFaceSceneTransform();
    if (sceneTransform) sceneLayer.setAttribute("transform", sceneTransform);

    // 导出背景保持可配置：默认透明；仅当显式传入非透明色时才绘制底板。
    if (bgColor && bgColor !== "transparent") {
      const bgRect = document.createElementNS(SVG_NS, "rect");
      bgRect.setAttribute("x", "0");
      bgRect.setAttribute("y", "0");
      bgRect.setAttribute("width", "120");
      bgRect.setAttribute("height", "120");
      bgRect.setAttribute("fill", bgColor);
      svg.appendChild(bgRect);
    }

    let eyeKey = eyeStyle;
    if (decorKey === "LIGHT_ON_ACTION") {
      eyeKey = t < 0.55 ? "NORMAL" : "BULB_EMOJI";
    }
    const eyeSvg = EYE_SHAPES[eyeKey] || EYE_SHAPES.NORMAL;

    // --- 开始动态计算眼睛的眨眼、呼吸和情绪状态 ---
    const wallSec = t;
    const blink = blinkStrength(wallSec);
    // 注意：这里用 t 模拟动画秒数，所以 idleMood 传 null，因为导出场景都是动作不是 IDLE
    const openness = Math.min(1, Math.max(0, (mouth.h - 2) / 5.5));
    const breathe = Math.sin(wallSec * eyeMotionTuning.breatheSpeed) * eyeMotionTuning.breatheAmplitude;
    const track = Math.sin(t * eyeMotionTuning.trackSpeed) * eyeMotionTuning.trackAmplitude; // 用 t 代替音频进度
    
    const isGazeActive = decorKey === "GAZE_LOCK_ACTION";
    const isAwakenFocus = decorKey === "AWAKEN_ACTION" && t >= 0.92;
    const attentionBoostX = (isGazeActive || isAwakenFocus) ? 1.2 : 1;
    const attentionBoostY = (isGazeActive || isAwakenFocus) ? 1.42 : 1;
    
    // export 期间没有 idleMood 参数
    const eyeOpenMul = 1;
    const eyeYBias = 0;
    const eyeCross = 0;

    let sx =
      (1 + openness * eyeMotionTuning.opennessScaleX) *
      (1 + eyeCross * 0.05) *
      attentionBoostX;
    let sy =
      (1 - blink * eyeMotionTuning.blinkAmplitude) *
      (1 + openness * eyeMotionTuning.opennessScaleY) *
      eyeOpenMul *
      attentionBoostY;

    let shiverX = 0;
    let shiverY = 0;
    if (decorKey === "AC_ON_ACTION") {
      shiverX = Math.sin(wallSec * 18) * 0.95;
      shiverY = Math.sin(wallSec * 24) * 0.55;
    }
    
    const txL = EYE_LEFT_BASE.x + breathe + track * eyeMotionTuning.trackLeftMul + eyeCross + shiverX;
    const tyL =
      EYE_LEFT_BASE.y -
      openness * eyeMotionTuning.mouthEyeLiftMul +
      blink * eyeMotionTuning.blinkYOffset +
      eyeYBias +
      shiverY;
    const txR = EYE_RIGHT_BASE.x + breathe - track * eyeMotionTuning.trackRightMul - eyeCross + shiverX;
    const tyR =
      EYE_RIGHT_BASE.y -
      openness * eyeMotionTuning.mouthEyeLiftMul +
      blink * eyeMotionTuning.blinkYOffset +
      eyeYBias +
      shiverY;

    function addEye(x, y, scaleX, scaleY) {
      const g = document.createElementNS(SVG_NS, "g");
      let finalSx = scaleX;
      let finalSy = scaleY;
      if (isGazeActive) {
        // 注视场景的轻微脉冲
        finalSx *= (1 + Math.sin(t * 6.2) * 0.045);
        finalSy *= (1 + Math.sin(t * 6.2) * 0.07);
      }
      g.setAttribute("transform", `translate(${x.toFixed(2)},${y.toFixed(2)}) scale(${finalSx.toFixed(3)},${finalSy.toFixed(3)})`);
      g.innerHTML = eyeSvg;
      sceneLayer.appendChild(g);
    }
    
    addEye(txL, tyL, sx, sy);
    addEye(txR, tyR, sx, sy);

    const mouthG = document.createElementNS(SVG_NS, "g");
    mouthG.setAttribute("transform", `translate(${(MOUTH_BASE.x + shiverX).toFixed(2)},${(MOUTH_BASE.y + shiverY).toFixed(2)})`);
    paintMouth(mouthG, mouth);
    sceneLayer.appendChild(mouthG);

    const decorG = document.createElementNS(SVG_NS, "g");
    const defs = DECOR_DEFS[decorKey] || [];
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i];
      const el = document.createElementNS(SVG_NS, d.tag);
      if (d.attrs) {
        for (const k in d.attrs) el.setAttribute(k, d.attrs[k]);
      }
      if (d.text != null) el.textContent = d.text;
      if (d.html != null) el.innerHTML = d.html;
      if (d.anim) {
        const out = d.anim(t);
        if (out) {
          for (const k in out) {
            if (k === "text") el.textContent = out[k];
            else el.setAttribute(k, out[k]);
          }
        }
      }
      decorG.appendChild(el);
    }
    sceneLayer.appendChild(decorG);
    svg.appendChild(sceneLayer);

    const serializer = new XMLSerializer();
    return serializer.serializeToString(svg);
  }

  async function exportSvgFilesToServer(subdir, files) {
    const batchSize = 250;
    let savedTotal = 0;
    let lastDir = "";
    for (let i = 0; i < files.length; i += batchSize) {
      const chunk = files.slice(i, i + batchSize);
      setFaceStatusText(`导出中：${savedTotal}/${files.length}`);
      const resp = await fetch("/api/export_svgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subdir, files: chunk }),
      });
      const data = await resp.json().catch(() => null);
      if (!data || !data.ok) {
        const msg = data && data.error ? data.error : "导出失败";
        throw new Error(msg);
      }
      savedTotal += Number(data.saved_count || 0);
      if (data.dir) lastDir = String(data.dir);
    }
    return { savedTotal, dir: lastDir };
  }

  /**
   * 把 SVG 字符串转换为 PNG dataURL（浏览器端栅格化，避免系统依赖）。
   * @param {string} svgText
   * @param {number} sizePx
   * @returns {Promise<string>}
   */
  function svgTextToPngDataUrl(svgText, widthPx, heightPx) {
    const width = Number.isFinite(widthPx) ? Number(widthPx) : 320;
    const height = Number.isFinite(heightPx) ? Number(heightPx) : 240;
    return new Promise((resolve, reject) => {
      const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          const png = canvas.toDataURL("image/png");
          URL.revokeObjectURL(url);
          resolve(png);
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
        }
      };
      img.onerror = (ev) => {
        URL.revokeObjectURL(url);
        reject(ev || new Error("svg 转 png 失败"));
      };
      img.src = url;
    });
  }

  /**
   * 让出主线程一个事件循环切片，避免长循环时页面看起来“卡住”。
   * @returns {Promise<void>}
   */
  function nextTick() {
    return new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  function buildFrameFilesForScene(name, scene, opts) {
    const fps = (opts && opts.fps) || 12;
    const durationSec = (opts && opts.durationSec) || 2.6;
    const frames = Math.max(1, Math.floor(durationSec * fps) + 1);
    const files = [];
    for (let i = 0; i < frames; i++) {
      const t = i / fps;
      let mouth = VISEMES.REST;
      // 导出帧也套用场景嘴型逻辑，避免某些场景看起来像静态图。
      if (scene && scene.decor === "MUSIC_ON_ACTION") mouth = mouthMusicHum(t);
      else if (scene && scene.decor === "CLEAN_ACTION") mouth = mouthCleanSuck(t);
      else if (scene && scene.decor === "GAZE_LOCK_ACTION") mouth = mouthGazeLock(t);
      else if (scene && scene.decor === "AWAKEN_ACTION") mouth = mouthAwakenListen(t);
      const svg = buildFaceSvgStringForExport({
        eyeStyle: (scene && scene.eyeStyle) || "NORMAL",
        decor: (scene && scene.decor) || "NONE",
        mouth,
        t,
      });
      const idx = String(i).padStart(3, "0");
      files.push({ name: `${name}/${idx}.svg`, content: svg });
    }
    if (scene && scene.postMood && IDLE_MOODS[scene.postMood]) {
      const mood = IDLE_MOODS[scene.postMood];
      const svg = buildFaceSvgStringForExport({
        eyeStyle: mood.eyeStyle || "NORMAL",
        decor: mood.decor || "NONE",
        mouth: mood.mouth || VISEMES.REST,
        t: 0,
      });
      files.push({ name: `${name}/post_${scene.postMood}.svg`, content: svg });
    }
    return files;
  }

  /**
   * 构建某个场景的 SVG 帧序列（用于后续转 APNG）。
   * @param {{eyeStyle?:string, decor?:string, postMood?:string|null}} scene
   * @param {{fps?:number, durationSec?:number}=} opts
   * @returns {string[]}
   */
  function buildFrameSvgsForScene(scene, opts) {
    const fps = (opts && opts.fps) || 12;
    const durationSec = (opts && opts.durationSec) || 2.6;
    const frames = Math.max(1, Math.floor(durationSec * fps) + 1);
    const arr = [];
    for (let i = 0; i < frames; i++) {
      const t = i / fps;
      let mouth = VISEMES.REST;
      // 导出 APNG 时复用场景嘴型动画，确保“唤起/注视”等场景更容易看出动态。
      if (scene && scene.decor === "MUSIC_ON_ACTION") mouth = mouthMusicHum(t);
      else if (scene && scene.decor === "CLEAN_ACTION") mouth = mouthCleanSuck(t);
      else if (scene && scene.decor === "GAZE_LOCK_ACTION") mouth = mouthGazeLock(t);
      else if (scene && scene.decor === "AWAKEN_ACTION") mouth = mouthAwakenListen(t);
      arr.push(
        buildFaceSvgStringForExport({
          eyeStyle: (scene && scene.eyeStyle) || "NORMAL",
          decor: (scene && scene.decor) || "NONE",
          mouth,
          t,
          bgColor: "transparent",
        })
      );
    }
    return arr;
  }

  /**
   * 导出单个场景 APNG。
   * @param {string} subdir
   * @param {string} name
   * @param {{eyeStyle?:string, decor?:string, postMood?:string|null}} scene
   * @param {{fps?:number, durationSec?:number, sizePx?:number}=} opts
   */
  async function exportOneSceneApng(subdir, name, scene, opts) {
    const fps = (opts && opts.fps) || 12;
    const widthPx = (opts && opts.widthPx) || 320;
    const heightPx = (opts && opts.heightPx) || 240;
    const requestTimeoutMs = (opts && opts.requestTimeoutMs) || 45000;
    const frameSvgs = buildFrameSvgsForScene(scene || {}, opts);
    const framePngs = [];
    for (let i = 0; i < frameSvgs.length; i++) {
      const png = await svgTextToPngDataUrl(frameSvgs[i], widthPx, heightPx);
      framePngs.push(png);
      // 每 4 帧主动让出一次主线程，减少“导出卡死”体感。
      if (i % 4 === 0) {
        await nextTick();
      }
      if (i % 6 === 0) {
        setFaceStatusText(`APNG 渲染中：${name} (${i + 1}/${frameSvgs.length})`);
      }
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), requestTimeoutMs);
    let resp;
    try {
      resp = await fetch("/api/export_apng", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subdir,
          name,
          frames: framePngs,
          duration_ms: Math.max(20, Math.round(1000 / fps)),
        }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const data = await resp.json().catch(() => null);
    if (!data || !data.ok) {
      throw new Error((data && data.error) || "导出 APNG 失败");
    }
    return data;
  }

  window.PhonemeFaceApi = {
    /**
     * 设置眼睛动态参数（支持传入部分字段，未传字段保持不变）。
     * @param {Record<string, unknown>} partial
     * @returns {{[k:string]:number}} 设置后的完整参数快照
     */
    setEyeMotionTuning(partial) {
      setEyeMotionTuning(partial);
      return { ...eyeMotionTuning };
    },
    /**
     * 重置眼睛动态参数到默认值。
     * @returns {{[k:string]:number}}
     */
    resetEyeMotionTuning() {
      eyeMotionTuning = { ...EYE_MOTION_DEFAULTS };
      return { ...eyeMotionTuning };
    },
    /**
     * 读取当前眼睛动态参数（用于 UI 回显）。
     * @returns {{[k:string]:number}}
     */
    getEyeMotionTuning() {
      return { ...eyeMotionTuning };
    },
    /**
     * 读取默认参数（用于“恢复默认”文案与按钮逻辑）。
     * @returns {{[k:string]:number}}
     */
    getEyeMotionDefaults() {
      return { ...EYE_MOTION_DEFAULTS };
    },
    /**
     * 绑定音素时间轴。
     * @param {unknown} segs
     */
    bindSegments(segs) {
      if (!Array.isArray(segs) || segs.length === 0) {
        segments = null;
        idleMoodPreviewKey = null;
        setWrapVisible(false);
        return;
      }
      stopSceneWaitingLoop();
      idleMoodPreviewKey = null;
      segments = segs.map((row) => ({
        start_sec: Number(row.start_sec),
        end_sec: Number(row.end_sec),
        phone: String(row.phone ?? ""),
      }));
      ensureFaceDom();
      // 新一轮合成开始时重置视觉签名，确保同一指令重复触发也会从头播放动作。
      lastMoodVisualSig = "";
      currentIdleMoodKey = "BORED";
      nextIdleMoodAtSec = performance.now() / 1000 + 0.8;
      setTargetViseme("REST");
      setWrapVisible(true);
      setFaceStatusText("已就绪：播放音频后，嘴型会随 phone 连续切换（带插值）；眼睛会眨眼并随嘴型微动。");
      scheduleEyeIdleIfNeeded();
    },

    /** 清空并隐藏。 */
    clear() {
      segments = null;
      idleMoodPreviewKey = null;
      stopEyeIdleLoop();
      stopSceneWaitingLoop();
      // 清空时重置视觉签名，避免下一轮相同动作被误判为“无需重建”。
      lastMoodVisualSig = "";
      currentIdleMoodKey = "BORED";
      setTargetViseme("REST");
      setWrapVisible(false);
      setFaceStatusText("状态：等待播放...");
    },

    /**
     * 每帧调用：读取当前音素 → 设目标视位 → 插值一步 → 重绘嘴。
     * @param {number} tSec audio.currentTime
     */
    update(tSec) {
      if (!segments || !segments.length) return;
      stopSceneWaitingLoop();
      ensureFaceDom();
      const seg = pickSegment(tSec);
      const targetInfo = resolveTarget(seg);
      setTargetViseme(targetInfo.key);
      applyMoodVisuals(targetInfo.key, targetInfo.eyeStyle, targetInfo.decor);
      stepLerp(targetInfo.mouth);
      const svg = document.getElementById("phoneme-face-svg");
      const group = svg && svg.querySelector("#face-mouth");
      if (group) {
        applyMouthTransform();
        paintMouth(group, displayParams);
      }
      paintEyes(Number.isFinite(tSec) ? tSec : 0);
      const wallSec = performance.now() / 1000;
      paintTransitions(wallSec);
      paintDecor(wallSec);
      stopEyeIdleLoop();
      const player = document.getElementById("player");
      if (player && (player.paused || player.ended)) {
        scheduleEyeIdleIfNeeded();
      }
      if (seg) {
        setFaceStatusText(
          "当前 phone = “" +
            seg.phone +
            "”\n映射视位 = " +
            targetInfo.key +
            "（" +
            targetInfo.label +
            "）\n时间段 = " +
            seg.start_sec.toFixed(2) +
            "s – " +
            seg.end_sec.toFixed(2) +
            "s"
        );
      }
    },

    /**
     * 设置当前指令场景：播放时覆盖眼形/装饰，播放结束后 endScene 会触发 postMood 收束。
     * 传 null 视为清空场景。
     * @param {{eyeStyle?:string, decor?:string, postMood?:string|null}|null} s
     */
    setScene(s) {
      if (!s) {
        scene = null;
        stopSceneWaitingLoop();
        return;
      }
      // 每次设置场景都重置签名与时间轴，确保动作从第一帧重新开始。
      lastMoodVisualSig = "";
      decorStartSec = performance.now() / 1000;
      transitionStartSec = -10;
      scene = {
        eyeStyle: s.eyeStyle || "NORMAL",
        decor: s.decor || "NONE",
        postMood: s.postMood || null,
        postUntilSec: 0,
      };
      // 进入等待阶段立即显示并持续播放场景动画。
      ensureFaceDom();
      setWrapVisible(true);
      stopSceneWaitingLoop();
      sceneWaitingRaf = requestAnimationFrame(sceneWaitingLoop);
    },

    /**
     * 通知当前指令已经播完，开启 postMood 回执窗口（默认 2.6s）。
     * 结束后 resolveTarget 会自动把 scene 清空，回到正常随机 idle。
     * @param {number=} durationSec
     */
    endScene(durationSec) {
      if (!scene) return;
      scene.postUntilSec = performance.now() / 1000 + (durationSec || 2.6);
    },

    /** 强制清空当前场景（例如用户切换到非指令的自由输入）。 */
    clearScene() {
      scene = null;
      stopSceneWaitingLoop();
    },

    /** 渲染全部视位到给定容器。 */
    renderGallery,
    /** 渲染全部空闲情绪到给定容器。 */
    renderMoodGallery,

    /** 精选生动表情 key 列表（供页面模块与外部脚本引用）。 */
    FEATURED_MOOD_KEYS,

    /**
     * 在主脸区域预览指定空闲表情（静音 sil 段 + 锁定随机切换）。
     * @param {string} moodKey
     * @returns {boolean}
     */
    previewIdleMood(moodKey) {
      const k = String(moodKey || "");
      if (!IDLE_MOODS[k]) return false;
      stopSceneWaitingLoop();
      scene = null;
      idleMoodPreviewKey = k;
      currentIdleMoodKey = k;
      nextIdleMoodAtSec = performance.now() / 1000 + 1e9;
      segments = [
        { start_sec: 0, end_sec: 86400, phone: "sil" },
      ].map((row) => ({
        start_sec: Number(row.start_sec),
        end_sec: Number(row.end_sec),
        phone: String(row.phone ?? ""),
      }));
      lastMoodVisualSig = "";
      decorStartSec = performance.now() / 1000;
      transitionStartSec = -10;
      ensureFaceDom();
      setTargetViseme("REST");
      setWrapVisible(true);
      const lab = (IDLE_MOODS[k].label || k);
      setFaceStatusText(`精选表情预览：${lab}\n退出：点下方按钮，或发起一次新的语音合成。`);
      scheduleEyeIdleIfNeeded();
      return true;
    },

    /**
     * 结束精选预览：隐藏主脸并清空静音绑定（不影响播放器其它逻辑）。
     */
    exitFeaturedIdlePreview() {
      idleMoodPreviewKey = null;
      segments = null;
      stopEyeIdleLoop();
      setWrapVisible(false);
      setFaceStatusText("状态：等待播放...");
    },
    /**
     * 读取指定情绪 key 对应的场景参数，供外部（如预览卡点击）直接触发。
     * @param {string} moodKey
     * @returns {{eyeStyle:string, decor:string, postMood:string, label:string}|null}
     */
    getMoodScene(moodKey) {
      const key = String(moodKey || "");
      const mood = IDLE_MOODS[key];
      if (!mood) return null;
      return {
        eyeStyle: mood.eyeStyle || "NORMAL",
        decor: mood.decor || "NONE",
        postMood: key,
        label: mood.label || key,
      };
    },
    downloadSvg(btn) {
      const card = btn.closest(".viseme-card");
      if (!card) return;
      const svgEl = card.querySelector("svg");
      if (!svgEl) return;
      const name = btn.getAttribute("data-name") || "mood";
      const serializer = new XMLSerializer();
      let source = serializer.serializeToString(svgEl);
      if (!source.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) {
          source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
      }
      const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name}.svg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    downloadAllMoodSvgs() {
      const container = document.getElementById("mood-gallery");
      if (!container) return;
      const btns = container.querySelectorAll(".download-svg-btn");
      let i = 0;
      function next() {
        if (i < btns.length) {
          btns[i].click();
          i++;
           setTimeout(next, 300);
        }
      }
      next();
    },

    async exportDecorAnimationsToFolder() {
      const subdir = `decor_${Date.now()}`;
      const keys = Object.keys(DECOR_DEFS).filter((k) => k && k !== "NONE");
      const files = [];
      for (let i = 0; i < keys.length; i++) {
        const decorKey = keys[i];
        const name = `decor/${decorKey}`;
        const scene = { eyeStyle: "NORMAL", decor: decorKey, postMood: null };
        files.push(...buildFrameFilesForScene(name, scene));
      }
      const out = await exportSvgFilesToServer(subdir, files);
      setFaceStatusText(`导出完成：${out.savedTotal} 个文件\n目录：${out.dir || subdir}`);
      return { subdir, saved: out.savedTotal, dir: out.dir };
    },

    async exportMiScenesToFolder(items) {
      const subdir = `mijia_${Date.now()}`;
      const list = Array.isArray(items) ? items : [];
      const files = [];
      for (let i = 0; i < list.length; i++) {
        const it = list[i] || {};
        const base = String(it.name || it.id || `cmd_${i}`);
        const safe = base.replace(/[\\\/:*?"<>|]/g, "_");
        files.push(...buildFrameFilesForScene(`mijia/${safe}`, it.scene || {}));
      }
      const out = await exportSvgFilesToServer(subdir, files);
      setFaceStatusText(`导出完成：${out.savedTotal} 个文件\n目录：${out.dir || subdir}`);
      return { subdir, saved: out.savedTotal, dir: out.dir };
    },
    async exportAllExpressionsApngToFolder(items, opts) {
      const subdir = `apng_${Date.now()}`;
      const list = Array.isArray(items) ? items : [];
      const allTasks = [];
      for (let i = 0; i < list.length; i++) {
        const it = list[i] || {};
        const base = String(it.name || it.id || `cmd_${i}`);
        const safe = base.replace(/[\\\/:*?"<>|]/g, "_");
        allTasks.push({
          kind: "scene",
          name: `scene_${safe}`,
          scene: it.scene || {},
        });
      }
      const moodKeys = Object.keys(IDLE_MOODS);
      for (let i = 0; i < moodKeys.length; i++) {
        const key = moodKeys[i];
        const mood = IDLE_MOODS[key] || {};
        allTasks.push({
          kind: "mood",
          name: `mood_${key}`,
          scene: {
            eyeStyle: mood.eyeStyle || "NORMAL",
            decor: mood.decor || "NONE",
            postMood: null,
          },
        });
      }
      let okCount = 0;
      const failed = [];
      for (let i = 0; i < allTasks.length; i++) {
        const t = allTasks[i];
        setFaceStatusText(`导出 APNG：${i + 1}/${allTasks.length}\n${t.name}`);
        try {
          await exportOneSceneApng(subdir, t.name, t.scene, opts || {});
          okCount += 1;
        } catch (err) {
          failed.push({ name: t.name, error: String(err) });
        }
      }
      setFaceStatusText(
        `APNG 导出完成：成功 ${okCount}，失败 ${failed.length}\n目录：exported_apng/${subdir}`
      );
      return { subdir, count: okCount, failed, dir: `exported_apng/${subdir}` };
    },
  };

  // 页面加载后自动把全部视位预览画到底部 gallery 容器（若存在）。
  document.addEventListener("DOMContentLoaded", () => {
    // 启动后异步加载拆分后的眼形 SVG 资源（失败时会自动回退到内联默认值）。
    ensureEyeShapeAssetsLoaded();
    const container = document.getElementById("viseme-gallery");
    if (container) renderGallery(container);
    const moodContainer = document.getElementById("mood-gallery");
    if (moodContainer) renderMoodGallery(moodContainer);
    const moodTbody = document.getElementById("mood-tbody");
    if (moodTbody) renderMoodTable(moodTbody);
    // 精选生动表情：大卡片按钮，点击即在主脸开启预览。
    const featuredGrid = document.getElementById("featured-mood-grid");
    const featuredClear = document.getElementById("featured-mood-clear");
    if (featuredGrid) {
      featuredGrid.innerHTML = "";
      FEATURED_MOOD_KEYS.forEach((key) => {
        const mood = IDLE_MOODS[key];
        if (!mood) return;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "featured-mood-tile";
        btn.setAttribute("aria-label", `预览表情 ${mood.label}`);
        btn.innerHTML =
          '<span class="featured-mood-k">' +
          key +
          "</span>" +
          '<span class="featured-mood-cn">' +
          mood.label +
          "</span>" +
          '<span class="featured-mood-hint">点击在主脸播放动态装饰</span>';
        btn.addEventListener("click", () => {
          window.PhonemeFaceApi.previewIdleMood(key);
        });
        featuredGrid.appendChild(btn);
      });
    }
    if (featuredClear) {
      featuredClear.addEventListener("click", () => {
        window.PhonemeFaceApi.exitFeaturedIdlePreview();
      });
    }
    // 播放/暂停切换时：播放中由 app.js 的 rAF 调 update 驱动眼睛；暂停则启动仅眼睛的 idle 循环。
    const player = document.getElementById("player");
    if (player) {
      player.addEventListener("play", () => {
        stopEyeIdleLoop();
      });
      player.addEventListener("pause", () => {
        scheduleEyeIdleIfNeeded();
      });
      player.addEventListener("ended", () => {
        scheduleEyeIdleIfNeeded();
        // 指令模式：音频结束后进入 postMood 回执窗口（持续 2.6s）。
        if (scene) {
          scene.postUntilSec = performance.now() / 1000 + 2.6;
        }
      });
    }
  });
})();
