// UI strings. Add a language by adding a block to MESSAGES and an entry to LOCALES.

export const LOCALES = [
  { code: 'ja', label: '日本語' },
  { code: 'en', label: 'English' },
  { code: 'zh', label: '简体中文' },
];

export const DEFAULT_LOCALE = 'en';

const MESSAGES = {
  ja: {
    'step.shape': '図案を選ぶ',
    'step.mode': 'モードを選ぶ',

    'shape.title': '図案を選ぶ',
    'shape.subtitle': '何を描いても、線は選んだ図案に変わります',
    'shape.shuffle': '他の図案を見る',
    'shape.custom': 'オリジナル図案',
    'shape.delete': '削除',
    'shape.deleteConfirm': '「{name}」を削除しますか？削除すると元に戻せません。',

    'mode.title': '変形モードを選ぶ',
    'mode.hint': 'あとから設定でいつでも切り替えられます',
    'mode.auto': '自動変形',
    'mode.autoDesc': '一画描いて手を離すと、自動で図案に変わります',
    'mode.manual': '手動変形',
    'mode.manualDesc': '線はそのまま残り、ツールバーの変形ボタンでまとめて変形します',

    'draw.title': 'いつのまにか{shape}',
    'draw.hintAuto': '一画描くと、{shape}に変わります',
    'draw.hintManual': '何画か描いて、ツールバーの変形ボタンで{shape}に変えましょう',
    'draw.undo': '元に戻す',
    'draw.shape': '図案を変える',
    'draw.settings': '設定',
    'draw.morph': 'すべての線を変形',
    'draw.clear': 'キャンバスを消す',
        'draw.publish': 'この絵を図案にする',
    'draw.publishEmpty': '先に何か描いてください',
    'gallery.like': 'いいね',
    'gallery.unlike': 'いいねを取り消す',
    'gallery.likes': '{count}',
'draw.save': '画像を保存',
    'draw.color': '線の色 {color}',
    'draw.anyColor': '好きな色',
    'draw.resetZoom': '表示を元に戻す',
    'draw.clearConfirm': '描いたものをすべて消しますか？',

    'settings.title': '設定',
    'settings.mode': '変形モード',
    'settings.palette': 'カラーパレット',
    'settings.paletteHint': '色をタップすると変更できます。数に制限はありません',
    'settings.paletteAdd': '色を追加',
    'settings.paletteRemove': 'この色を削除',
    'settings.minAspect': '最小のつぶれにくさ',
    'settings.minAspectHint': '大きいほど図案の元の比率が保たれます',
        'settings.heightScale': '図案の縦の大きさ',
    'settings.heightScaleHint': '100%より大きいと縦に伸び、小さいと縦に縮みます',
'settings.strokeWidth': '線の太さ',
    'settings.preview': 'プレビュー',
    'settings.smooth': '線の補正',
    'settings.smoothToggle': '手ぶれを補正する',
    'settings.smoothHint': '描いた線のガタつきをなめらかにします',
    'settings.smoothStrength': '強さ',
    'settings.language': '言語',
    'settings.reset': '設定を初期値に戻す',
    'settings.resetConfirm': '設定をすべて初期値に戻しますか？',
    'settings.about': 'このアプリについて',
    'settings.original': '原作',
    'settings.originalDesc': 'Stand404（周常临）氏の「总是XX」を基に制作しています',
    'settings.close': '閉じる',

    'custom.title': 'オリジナル図案',
    'custom.desc': '線画の画像かSVGから、自分だけの図案を作れます',
    'custom.add': '図案を作る',
    'custom.name': '名前',
    'custom.namePlaceholder': '図案の名前',
    'custom.color': 'テーマカラー',
    'custom.source': '元になる画像',
    'custom.pickImage': '画像・SVGを選ぶ',
    'custom.pickHint': 'PNG・JPGの線画は自動でSVGに変換します。SVGはそのまま読み込みます',
    'custom.tracing': '線画を変換しています…',
    'custom.traceSettings': '変換の調整',
    'custom.threshold': '線の拾い方',
    'custom.thresholdAuto': '自動',
    'custom.detail': '細かさ',
        'custom.smoothness': '線のなめらかさ',
    'custom.autoThreshold': '最適な設定を自動で探す',
    'custom.searching': '最適な設定を探しています…',
'custom.invert': '白い線・暗い背景の画像',
    'custom.retrace': '再変換',
    'custom.pathCount': '{count}本の線を検出しました',
    'custom.save': '追加する',
    'custom.cancel': 'キャンセル',
    'custom.errorName': '名前を入力してください',
    'custom.errorFile': '画像かSVGファイルを選んでください',
    'custom.errorParse': '読み込めませんでした。線画がはっきり写っているか確認してください',
    'custom.errorEmpty': '線を検出できませんでした。「線の拾い方」を調整してみてください',
    'custom.errorStorage': '保存できませんでした。ブラウザの保存容量が足りない可能性があります',

        'myshapes.title': 'オリジナル図案',
    'myshapes.create': '新しく作る',
    'myshapes.empty': 'まだ作っていません。「新しく作る」から始めましょう',

'gallery.title': 'みんなの図案',
    'gallery.open': 'みんなの図案',
    'gallery.sortNew': '新着',
    'gallery.sortPopular': '人気',
    'gallery.use': 'これで描く',
    'gallery.by': '作: {author}',
    'gallery.uses': '{count}回使用',
    'gallery.more': 'もっと見る',
    'gallery.empty': 'まだ投稿がありません。最初のひとりになりませんか',
    'gallery.loading': '読み込んでいます…',
    'gallery.offline': '図案を読み込めませんでした。時間をおいて試してください',
    'gallery.report': '通報',
    'gallery.reportPrompt': 'この図案を通報する理由を教えてください（任意）',
        'gallery.reported': '通報済み',
    'gallery.reportHidden': '通報が一定数に達したため、この図案は非表示になりました',
    'gallery.reportFailed': '通報できませんでした。時間をおいて試してください',
'gallery.reportDone': '通報を受け付けました。ありがとうございます',
    'gallery.reportDup': 'この図案はすでに通報済みです',

    'publish.toggle': 'みんなの図案として公開する',
    'publish.hint': '公開すると、誰でもこの図案を使えるようになります。取り消せないので注意してください',
    'publish.author': '作者名',
    'publish.authorPlaceholder': 'ニックネーム',
    'publish.working': '公開しています…',
    'publish.done': '公開しました',
    'publish.failed': '公開できませんでした。あとでもう一度試してください',
    'publish.rateLimited': '投稿が続いています。少し時間をおいてください',
    'publish.tooComplex': '線が多すぎます。「細かさ」を上げて単純にしてください',
    'publish.rules': '自分で描いたもの、または公開して問題のない図案だけを投稿してください',
  },

  en: {
    'step.shape': 'Pick a shape',
    'step.mode': 'Pick a mode',

    'shape.title': 'Pick a shape',
    'shape.subtitle': 'Whatever you draw, your strokes become the shape you pick',
    'shape.shuffle': 'Show other shapes',
    'shape.custom': 'Your own shape',
    'shape.delete': 'Delete',
    'shape.deleteConfirm': 'Delete "{name}"? This cannot be undone.',

    'mode.title': 'Pick a morph mode',
    'mode.hint': 'You can switch any time in settings',
    'mode.auto': 'Auto morph',
    'mode.autoDesc': 'Each stroke turns into the shape as soon as you lift your pen',
    'mode.manual': 'Manual morph',
    'mode.manualDesc': 'Strokes stay as drawn until you hit the morph button',

    'draw.title': 'Always {shape}',
    'draw.hintAuto': 'Draw a stroke and it becomes {shape}',
    'draw.hintManual': 'Draw a few strokes, then hit the morph button to turn them into {shape}',
    'draw.undo': 'Undo',
    'draw.shape': 'Change shape',
    'draw.settings': 'Settings',
    'draw.morph': 'Morph every stroke',
    'draw.clear': 'Clear canvas',
        'draw.publish': 'Turn this drawing into a shape',
    'draw.publishEmpty': 'Draw something first',
    'gallery.like': 'Like',
    'gallery.unlike': 'Remove like',
    'gallery.likes': '{count}',
'draw.save': 'Save image',
    'draw.color': 'Stroke colour {color}',
    'draw.anyColor': 'Any colour',
    'draw.resetZoom': 'Reset view',
    'draw.clearConfirm': 'Clear everything you have drawn?',

    'settings.title': 'Settings',
    'settings.mode': 'Morph mode',
    'settings.palette': 'Palette',
    'settings.paletteHint': 'Tap a colour to change it. Add as many as you like',
    'settings.paletteAdd': 'Add a colour',
    'settings.paletteRemove': 'Remove this colour',
    'settings.minAspect': 'Minimum squash',
    'settings.minAspectHint': 'Higher keeps more of the shape’s original proportions',
        'settings.heightScale': 'Shape height',
    'settings.heightScaleHint': 'Above 100% stretches the shape taller, below squashes it',
'settings.strokeWidth': 'Stroke width',
    'settings.preview': 'Preview',
    'settings.smooth': 'Stroke smoothing',
    'settings.smoothToggle': 'Smooth out shaky lines',
    'settings.smoothHint': 'Evens out the wobble in your strokes',
    'settings.smoothStrength': 'Strength',
    'settings.language': 'Language',
    'settings.reset': 'Reset to defaults',
    'settings.resetConfirm': 'Reset every setting to its default?',
    'settings.about': 'About',
    'settings.original': 'Original',
    'settings.originalDesc': 'Based on "总是XX" by Stand404',
    'settings.close': 'Close',

    'custom.title': 'Your own shape',
    'custom.desc': 'Turn a line drawing or an SVG into your own shape',
    'custom.add': 'Create a shape',
    'custom.name': 'Name',
    'custom.namePlaceholder': 'Shape name',
    'custom.color': 'Theme colour',
    'custom.source': 'Source image',
    'custom.pickImage': 'Choose image or SVG',
    'custom.pickHint': 'PNG and JPG line art is traced to SVG automatically. SVGs are used as-is',
    'custom.tracing': 'Tracing your drawing…',
    'custom.traceSettings': 'Tracing options',
    'custom.threshold': 'Line pickup',
    'custom.thresholdAuto': 'Auto',
    'custom.detail': 'Detail',
        'custom.smoothness': 'Curve smoothness',
    'custom.autoThreshold': 'Find the best settings automatically',
    'custom.searching': 'Looking for the best settings...',
'custom.invert': 'Light lines on a dark background',
    'custom.retrace': 'Trace again',
    'custom.pathCount': 'Found {count} strokes',
    'custom.save': 'Add shape',
    'custom.cancel': 'Cancel',
    'custom.errorName': 'Please enter a name',
    'custom.errorFile': 'Please choose an image or SVG file',
    'custom.errorParse': 'Could not read that file. Check the line art is clearly visible',
    'custom.errorEmpty': 'No strokes found. Try adjusting the line pickup',
    'custom.errorStorage': 'Could not save. Your browser storage may be full',

        'myshapes.title': 'Your shapes',
    'myshapes.create': 'Create new',
    'myshapes.empty': "You haven't made one yet. Start with Create new",

'gallery.title': 'Community shapes',
    'gallery.open': 'Community shapes',
    'gallery.sortNew': 'Newest',
    'gallery.sortPopular': 'Popular',
    'gallery.use': 'Draw with this',
    'gallery.by': 'by {author}',
    'gallery.uses': 'used {count}x',
    'gallery.more': 'Load more',
    'gallery.empty': 'Nothing here yet. Be the first to share one',
    'gallery.loading': 'Loading...',
    'gallery.offline': 'Could not load shapes. Try again in a moment',
    'gallery.report': 'Report',
    'gallery.reportPrompt': 'Why are you reporting this shape? (optional)',
        'gallery.reported': 'Reported',
    'gallery.reportHidden': 'This shape has now been hidden after enough reports',
    'gallery.reportFailed': 'Could not report that. Try again in a moment',
'gallery.reportDone': 'Reported. Thank you',
    'gallery.reportDup': 'You have already reported this shape',

    'publish.toggle': 'Share with everyone',
    'publish.hint': 'Anyone will be able to use this shape. This cannot be undone',
    'publish.author': 'Your name',
    'publish.authorPlaceholder': 'Nickname',
    'publish.working': 'Publishing...',
    'publish.done': 'Published',
    'publish.failed': 'Could not publish. Please try again later',
    'publish.rateLimited': 'You are publishing too quickly. Wait a moment',
    'publish.tooComplex': 'Too many strokes. Raise the detail slider to simplify',
    'publish.rules': 'Only share artwork you drew yourself or are free to share',
  },

  zh: {
    'step.shape': '选择图案',
    'step.mode': '选择模式',

    'shape.title': '选择一个图案',
    'shape.subtitle': '无论画什么，笔画总是会变成选定的图案',
    'shape.shuffle': '换一批图案',
    'shape.custom': '自定义图案',
    'shape.delete': '删除',
    'shape.deleteConfirm': '确定删除「{name}」吗？删除后无法恢复。',

    'mode.title': '选择变形模式',
    'mode.hint': '之后可在设置中随时切换',
    'mode.auto': '自动变形',
    'mode.autoDesc': '每画一笔，松手后自动变成图案',
    'mode.manual': '手动变形',
    'mode.manualDesc': '笔画保持原样，用工具栏变形按钮一起变形',

    'draw.title': '总是{shape}',
    'draw.hintAuto': '画一笔，松手后变成{shape}',
    'draw.hintManual': '画几笔，点工具栏变形按钮，一起变成{shape}',
    'draw.undo': '撤销',
    'draw.shape': '切换图案',
    'draw.settings': '设置',
    'draw.morph': '变形所有笔画',
    'draw.clear': '清除画布',
        'draw.publish': '把这幅画做成图案',
    'draw.publishEmpty': '请先画点什么',
    'gallery.like': '点赞',
    'gallery.unlike': '取消点赞',
    'gallery.likes': '{count}',
'draw.save': '保存图片',
    'draw.color': '笔触颜色 {color}',
    'draw.anyColor': '万能颜色',
    'draw.resetZoom': '重置视图',
    'draw.clearConfirm': '确定清除画布上的全部内容吗？',

    'settings.title': '设置',
    'settings.mode': '变形模式',
    'settings.palette': '色盘',
    'settings.paletteHint': '点击颜色可以修改，数量不限',
    'settings.paletteAdd': '添加颜色',
    'settings.paletteRemove': '删除这个颜色',
    'settings.minAspect': '最小扁度',
    'settings.minAspectHint': '数值越大越遵循图案原始比例',
        'settings.heightScale': '图案高度',
    'settings.heightScaleHint': '大于 100% 会拉高图案，小于则压扁',
'settings.strokeWidth': '笔画粗细',
    'settings.preview': '预览',
    'settings.smooth': '笔画平滑',
    'settings.smoothToggle': '平滑笔迹',
    'settings.smoothHint': '修正绘制时的手抖抖动',
    'settings.smoothStrength': '强度',
    'settings.language': '语言',
    'settings.reset': '恢复默认设置',
    'settings.resetConfirm': '确定把所有设置恢复为默认值吗？',
    'settings.about': '关于',
    'settings.original': '原作',
    'settings.originalDesc': '基于 Stand404（周常临）的「总是XX」制作',
    'settings.close': '关闭',

    'custom.title': '自定义图案',
    'custom.desc': '用线稿图片或 SVG 制作属于你的图案',
    'custom.add': '制作图案',
    'custom.name': '名称',
    'custom.namePlaceholder': '图案名称',
    'custom.color': '主题色',
    'custom.source': '源图片',
    'custom.pickImage': '选择图片或 SVG',
    'custom.pickHint': 'PNG、JPG 线稿会自动转换为 SVG；SVG 将直接使用',
    'custom.tracing': '正在转换线稿…',
    'custom.traceSettings': '转换选项',
    'custom.threshold': '取线强度',
    'custom.thresholdAuto': '自动',
    'custom.detail': '细节',
        'custom.smoothness': '曲线平滑度',
    'custom.autoThreshold': '自动寻找最佳设置',
    'custom.searching': '正在寻找最佳设置…',
'custom.invert': '深色背景上的浅色线条',
    'custom.retrace': '重新转换',
    'custom.pathCount': '检测到 {count} 条笔画',
    'custom.save': '添加',
    'custom.cancel': '取消',
    'custom.errorName': '请输入名称',
    'custom.errorFile': '请选择图片或 SVG 文件',
    'custom.errorParse': '无法读取该文件，请确认线稿清晰可见',
    'custom.errorEmpty': '没有检测到笔画，试着调整「取线强度」',
    'custom.errorStorage': '保存失败，浏览器存储空间可能已满',

        'myshapes.title': '自定义图案',
    'myshapes.create': '新建图案',
    'myshapes.empty': '还没有制作过，点击「新建图案」开始吧',

'gallery.title': '大家的图案',
    'gallery.open': '大家的图案',
    'gallery.sortNew': '最新',
    'gallery.sortPopular': '热门',
    'gallery.use': '用这个画',
    'gallery.by': '作者：{author}',
    'gallery.uses': '已使用 {count} 次',
    'gallery.more': '加载更多',
    'gallery.empty': '还没有人投稿，来当第一个吧',
    'gallery.loading': '加载中…',
    'gallery.offline': '无法加载图案，请稍后再试',
    'gallery.report': '举报',
    'gallery.reportPrompt': '请说明举报这个图案的理由（可选）',
        'gallery.reported': '已举报',
    'gallery.reportHidden': '举报达到一定数量，该图案已被隐藏',
    'gallery.reportFailed': '举报失败，请稍后再试',
'gallery.reportDone': '已举报，谢谢',
    'gallery.reportDup': '你已经举报过这个图案了',

    'publish.toggle': '公开给大家使用',
    'publish.hint': '公开后任何人都能使用这个图案，且无法撤销',
    'publish.author': '作者名',
    'publish.authorPlaceholder': '昵称',
    'publish.working': '正在公开…',
    'publish.done': '已公开',
    'publish.failed': '公开失败，请稍后再试',
    'publish.rateLimited': '投稿太频繁了，请稍等片刻',
    'publish.tooComplex': '笔画太多了，请调高「细节」使其简化',
    'publish.rules': '请只投稿你自己绘制或可以自由分享的图案',
  },
};

const STORAGE_KEY = 'always-xx:locale';

// English by default for everyone; only a locale the visitor picked themselves
// (saved from a previous visit) overrides it. No browser-language sniffing.
function detectLocale() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && MESSAGES[saved]) return saved;
  } catch {
    // Storage unavailable; use the default.
  }
  return DEFAULT_LOCALE;
}

let current = detectLocale();
const listeners = new Set();

export const getLocale = () => current;

export function setLocale(code) {
  if (!MESSAGES[code] || code === current) return;
  current = code;
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Preference just won't persist.
  }
  document.documentElement.lang = code === 'zh' ? 'zh-CN' : code;
  for (const fn of listeners) fn(code);
}

export function onLocaleChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Translate `key`, substituting `{placeholder}` values from `params`.
export function t(key, params) {
  const table = MESSAGES[current] ?? MESSAGES[DEFAULT_LOCALE];
  const raw = table[key] ?? MESSAGES[DEFAULT_LOCALE][key] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

// Pick the right label out of a `{ ja, en, zh }` name object.
export function localizedName(name) {
  if (typeof name === 'string') return name;
  if (!name) return '';
  return name[current] ?? name[DEFAULT_LOCALE] ?? Object.values(name)[0] ?? '';
}
