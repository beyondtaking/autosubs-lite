// src/i18n/locales.ts
// All UI strings in zh (Chinese) and en (English)

export type Locale = 'zh' | 'en'

export const locales = {
  zh: {
    // ── App ──
    appTitle: 'AutoSubs Lite',
    version: '版本',
    prefs: '偏好设置',

    // ── TitleBar buttons ──
    close: '关闭',
    minimize: '最小化',
    maximize: '最大化',

    // ── Queue panel ──
    queue: '视频队列',
    addFile: '添加视频文件',
    addFolder: '添加视频文件夹',
    addSubFile: '添加字幕文件',
    clearQueue: '清空',
    sortBy: '排序：',
    sortPath: '路径',
    sortName: '文件名',
    sortDuration: '时长',
    sortStatus: '状态',
    filesCount: (n: number, done: number) =>
      done > 0 ? `${n} 个 · ${done} 已完成` : `${n} 个`,
    emptyTitle: '添加视频文件开始转录',
    emptyHint: '或「添加字幕文件」直接翻译已有字幕',
    subtitleBadge: '字幕',
    subtitleScanHint: '字幕文件需勾选「生成中文字幕」后才能开始处理',

    // ── File status badges ──
    done: '已完成',
    failed: '失败',

    // ── Task banner ──
    taskDetected: '检测到任务文件',
    taskSub: (done: number, total: number, pending: number) =>
      `上次更新 · 已完成 ${done} / ${total} · ${pending} 个待处理`,
    taskResume: '续传进度',
    taskIgnore: '忽略',

    // ── Config tabs ──
    tabModelLang: '模型 & 语言',
    tabFormat: '文本格式化',
    tabTask: '任务文件',

    // ── Model section ──
    whisperModel: 'Whisper 模型',
    modelDirHint: '存放路径见「偏好设置 → Whisper 模型」',
    downloaded: '已下载',
    download: '下载',
    fastest: '最快',
    balanced: '均衡',
    accurate: '较准确',
    highQuality: '高精度',
    recommended: '推荐',
    bestQuality: '最高精度',

    // ── Language section ──
    languageSection: '语言',
    sourceLanguage: '音频源语言',
    langHint: '目标字幕语言随音频原语言，无需手动设置',
    langAuto: '自动探测',
    langEn: '英语',
    langZh: '中文',
    langJa: '日语',
    langKo: '韩语',
    langFr: '法语',
    langDe: '德语',

    // ── CN card ──
    generateCn: '生成中文字幕',
    generateCnSub: '转录/读取字幕后调用大模型翻译，输出 .cn.srt / .cn.vtt',
    translationModel: '翻译模型',
    noModelConfigured: '尚未配置翻译模型 —',
    goToPrefs: '前往偏好设置',

    // ── Output section ──
    outputFiles: '输出文件',
    outputOriginal: '原语言字幕',
    outputCn: '中文字幕',
    outputHint: '与视频同目录、同文件名',

    // ── Text formatting ──
    lineRules: '字幕断行规则',
    maxCharsPerLine: '每行最大字符数',
    maxLines: '最大行数',
    lineN: (n: number) => `${n} 行`,
    lineUnlimited: '不限',
    lineBreakMethod: '断行方式',
    breakNlp: 'NLP 语义断行（推荐）',
    breakWord: '按单词断行',
    // ── Re-segmentation (Udemy-style) ──
    resegSection: '重分段（Udemy 风格）',
    resegEnable: '启用重分段',
    resegHint: '根据词级时间戳把 Whisper 长句重新切成短 cue，每条独立时间、始终单行、不截断、不丢字',
    resegTargetChars: '目标字符数',
    resegMaxChars: '最大字符数（硬上限）',
    resegMinDuration: '最短显示时长（秒）',
    resegMaxDuration: '最长显示时长（秒）',
    resegMaxCps: '最大阅读速度（字符/秒）',
    breakChar: '按字符数强制断行',

    textCase: '字母大小写',
    caseOriginal: '保持原文',
    caseSentence: '句首大写',
    caseUpper: '全部大写',
    caseLower: '全部小写',
    caseTitle: '词首大写',

    punctuation: '标点符号处理',
    removePunct: '移除标点符号',
    removePunctHint: '逗号、句号、感叹号、问号等',
    keepEllipsis: '保留省略号 …',
    removeFillers: '移除填充词',
    removeFillersHint: 'uh、um、you know、like 等口语词',

    censor: '敏感词过滤',
    censorEnable: '启用敏感词过滤',
    censorEnableHint: '匹配词替换为指定字符',
    censorChar: '替换字符',
    censorKeepEnds: '首尾保留',
    censorWords: '敏感词列表',
    censorInputPlaceholder: '输入词语后回车添加…',
    censorAdd: '添加',
    censorCaseInsensitive: '大小写不敏感匹配',

    previewSection: '效果预览',
    previewInput: '输入（Whisper 原始）',
    previewOutput: '输出（处理后）',

    // ── Task file tab ──
    currentTaskFile: '当前任务文件',
    tfFileName: '文件名',
    tfRootDir: '根目录',
    tfStatus: '状态',
    tfLoaded: '已加载',
    tfDone: '已完成',
    tfPending: '待处理',
    tfUpdated: '上次更新',
    tfNotFound: '未检测到任务文件',
    tfNoFolder: '尚未选择文件夹',
    tfExport: '导出任务',
    tfReset: '重置进度',
    tfFormat: '文件格式',
    tfAutoSection: '自动行为',
    tfAutoDetect: '选择文件夹时自动检测任务文件',
    tfSkipSrt: '跳过已有 .srt 的视频',
    tfAutoSave: '完成后自动保存任务文件',

    // ── Bottom bar ──
    processing: '处理中：',
    remaining: '剩余',
    ready: '就绪',
    filesDone: (done: number) => `${done} 已完成`,
    addFilesHint: '添加视频文件或字幕文件开始处理',
    startProcessing: '开始处理',
    stop: '停止',
    statQueue: '队列：',
    statDuration: '总时长：',
    statModel: '模型：',
    statTranslation: '翻译：',
    statOutput: '输出：',

    // ── Prefs panel ──
    prefTitle: '偏好设置',
    prefTabLLM: '翻译模型',
    prefTabWhisper: 'Whisper',
    prefTabProxy: '代理',
    prefTabAppearance: '外观',
    cancel: '取消',
    save: '保存',

    // ── LLM tab ──
    llmConfig: '翻译模型配置',
    llmUsing: '当前使用',
    llmConfigured: '已配置',
    llmNotConfigured: '未配置',
    llmBaseUrl: 'API Base URL',
    llmApiKey: 'API Key',
    llmModel: '模型名称',
    llmTest: '连接测试',
    llmTesting: '测试中…',
    llmConnOk: (ms: number) => `连接正常 · ${ms} ms`,
    llmConnError: (_msg: string) => `连接失败`,
    llmSetActive: '设为当前使用',
    llmBatchSection: '翻译分批',
    llmBatchSize: '每批字幕条数',
    llmBatchHint: '建议 50–100，过大可能超出模型单次上下文限制',

    // ── Whisper tab ──
    whisperDirSection: '模型文件存放目录',
    whisperDirDesc: 'Whisper 模型文件（.bin）下载后统一存放在此目录。点击主界面「下载」按钮时，文件会自动保存到该路径。',
    whisperDirLabel: '存放路径',
    browse: '浏览',
    whisperDownloaded: (names: string) => `已下载：${names}`,
    whisperSpace: (gb: string) => `剩余可用空间：${gb} GB`,
    whisperDownloadSection: '下载设置',
    whisperConcurrent: '下载并发数',
    whisperConcurrentHint: '模型文件较大，建议保持 1',

    // ── Proxy tab ──
    proxySection: '网络代理',
    proxyDesc: '用于 Whisper 模型下载及 OpenAI 等境外 API 调用。DeepSeek / GLM / Kimi / MiniMax 为国内服务，通常无需代理。',
    proxyEnable: '启用代理',
    proxyModeSystem: '跟随系统',
    proxyModeCustom: '自定义',
    proxyProtocol: '协议',
    proxyHost: '地址',
    proxyPort: '端口',
    proxyTest: '测试代理连接',
    proxyTesting: '测试中…',
    proxyOk: (ms: number) => `代理正常 · ${ms} ms`,
    proxyFail: (_msg: string) => `代理失败`,

    // ── Appearance tab ──
    appearanceTheme: '主题',
    appearanceThemeDesc: '选择界面配色方案',
    appearanceLanguage: '界面语言',
    themeLight: '浅色',
    themeDark: '深色',
    themeSystem: '跟随系统',
    langUi: '界面语言',
    langUiZh: '中文',
    langUiEn: 'English',
    currentThemeDark: '当前：深色模式',
    currentThemeLight: '当前：浅色模式',
    currentThemeSystem: '当前：跟随系统设置',
  },

  en: {
    // ── App ──
    appTitle: 'AutoSubs Lite',
    version: 'version',
    prefs: 'Preferences',

    // ── TitleBar ──
    close: 'Close',
    minimize: 'Minimize',
    maximize: 'Maximize',

    // ── Queue panel ──
    queue: 'Video Queue',
    addFile: 'Add Video Files',
    addFolder: 'Add Video Folder',
    addSubFile: 'Add Subtitle Files',
    clearQueue: 'Clear',
    sortBy: 'Sort:',
    sortPath: 'Path',
    sortName: 'Name',
    sortDuration: 'Duration',
    sortStatus: 'Status',
    filesCount: (n: number, done: number) =>
      done > 0 ? `${n} files · ${done} done` : `${n} files`,
    emptyTitle: 'Add video files to transcribe',
    emptyHint: 'or "Add Subtitle Files" to translate existing subtitles',
    subtitleBadge: 'SUB',
    subtitleScanHint: 'Subtitle files require "Generate Chinese Subtitles" to be enabled',

    // ── Status badges ──
    done: 'Done',
    failed: 'Failed',

    // ── Task banner ──
    taskDetected: 'Task file detected',
    taskSub: (done: number, total: number, pending: number) =>
      `Last updated · ${done} / ${total} done · ${pending} pending`,
    taskResume: 'Resume',
    taskIgnore: 'Ignore',

    // ── Config tabs ──
    tabModelLang: 'Model & Language',
    tabFormat: 'Text Formatting',
    tabTask: 'Task File',

    // ── Model section ──
    whisperModel: 'Whisper Model',
    modelDirHint: 'Storage path: Preferences → Whisper',
    downloaded: 'Downloaded',
    download: 'Download',
    fastest: 'Fastest',
    balanced: 'Balanced',
    accurate: 'Accurate',
    highQuality: 'High quality',
    recommended: 'Recommended',
    bestQuality: 'Best quality',

    // ── Language section ──
    languageSection: 'Language',
    sourceLanguage: 'Source Language',
    langHint: 'Subtitle language follows audio language automatically',
    langAuto: 'Auto detect',
    langEn: 'English',
    langZh: 'Chinese',
    langJa: 'Japanese',
    langKo: 'Korean',
    langFr: 'French',
    langDe: 'German',

    // ── CN card ──
    generateCn: 'Generate Chinese Subtitles',
    generateCnSub: 'Translate via LLM after transcription or from subtitle files, output .cn.srt / .cn.vtt',
    translationModel: 'Translation model',
    noModelConfigured: 'No translation model configured —',
    goToPrefs: 'Go to Preferences',

    // ── Output section ──
    outputFiles: 'Output Files',
    outputOriginal: 'Original language',
    outputCn: 'Chinese',
    outputHint: 'Saved in same folder as video, same filename',

    // ── Text formatting ──
    lineRules: 'Subtitle Line Rules',
    maxCharsPerLine: 'Max characters per line',
    maxLines: 'Max lines',
    lineN: (n: number) => `${n} line${n > 1 ? 's' : ''}`,
    lineUnlimited: 'Unlimited',
    lineBreakMethod: 'Line break method',
    breakNlp: 'NLP semantic break (recommended)',
    breakWord: 'Break at word boundary',
    // ── Re-segmentation (Udemy-style) ──
    resegSection: 'Re-segmentation (Udemy-style)',
    resegEnable: 'Enable re-segmentation',
    resegHint: 'Uses word-level timestamps to re-cut Whisper output into short single-line cues — each with its own time range, no truncation, nothing dropped',
    resegTargetChars: 'Target chars per cue',
    resegMaxChars: 'Max chars (hard ceiling)',
    resegMinDuration: 'Min display duration (s)',
    resegMaxDuration: 'Max display duration (s)',
    resegMaxCps: 'Max reading speed (CPS)',
    breakChar: 'Hard break at char limit',

    textCase: 'Text Case',
    caseOriginal: 'Original',
    caseSentence: 'Sentence case',
    caseUpper: 'UPPERCASE',
    caseLower: 'lowercase',
    caseTitle: 'Title Case',

    punctuation: 'Remove Punctuation',
    removePunct: 'Remove punctuation',
    removePunctHint: 'Commas, periods, exclamation marks, question marks, etc.',
    keepEllipsis: 'Keep ellipsis …',
    removeFillers: 'Remove filler words',
    removeFillersHint: 'uh, um, you know, like, etc.',

    censor: 'Censor Sensitive Words',
    censorEnable: 'Enable word censoring',
    censorEnableHint: 'Matched words are replaced with the chosen character',
    censorChar: 'Replacement',
    censorKeepEnds: 'Keep first & last',
    censorWords: 'Word list',
    censorInputPlaceholder: 'Type a word and press Enter…',
    censorAdd: 'Add',
    censorCaseInsensitive: 'Case-insensitive matching',

    previewSection: 'Live Preview',
    previewInput: 'Input (Whisper raw)',
    previewOutput: 'Output (after processing)',

    // ── Task file tab ──
    currentTaskFile: 'Current Task File',
    tfFileName: 'Filename',
    tfRootDir: 'Root dir',
    tfStatus: 'Status',
    tfLoaded: 'Loaded',
    tfDone: 'Done',
    tfPending: 'Pending',
    tfUpdated: 'Last updated',
    tfNotFound: 'No task file found',
    tfNoFolder: 'No folder selected',
    tfExport: 'Export task',
    tfReset: 'Reset progress',
    tfFormat: 'File format',
    tfAutoSection: 'Automatic behavior',
    tfAutoDetect: 'Auto-detect task file when opening a folder',
    tfSkipSrt: 'Skip videos that already have a .srt file',
    tfAutoSave: 'Auto-save task file after completion',

    // ── Bottom bar ──
    processing: 'Processing:',
    remaining: 'remaining',
    ready: 'Ready',
    filesDone: (done: number) => `${done} done`,
    addFilesHint: 'Add video or subtitle files to get started',
    startProcessing: 'Start',
    stop: 'Stop',
    statQueue: 'Queue:',
    statDuration: 'Duration:',
    statModel: 'Model:',
    statTranslation: 'Translation:',
    statOutput: 'Output:',

    // ── Prefs panel ──
    prefTitle: 'Preferences',
    prefTabLLM: 'Translation',
    prefTabWhisper: 'Whisper',
    prefTabProxy: 'Proxy',
    prefTabAppearance: 'Appearance',
    cancel: 'Cancel',
    save: 'Save',

    // ── LLM tab ──
    llmConfig: 'Translation Model Configuration',
    llmUsing: 'Active',
    llmConfigured: 'Configured',
    llmNotConfigured: 'Not configured',
    llmBaseUrl: 'API Base URL',
    llmApiKey: 'API Key',
    llmModel: 'Model name',
    llmTest: 'Test connection',
    llmTesting: 'Testing…',
    llmConnOk: (ms: number) => `Connected · ${ms} ms`,
    llmConnError: (_msg: string) => `Failed`,
    llmSetActive: 'Set as active',
    llmBatchSection: 'Translation Batching',
    llmBatchSize: 'Subtitles per batch',
    llmBatchHint: 'Recommended 50–100. Too large may exceed the model context limit.',

    // ── Whisper tab ──
    whisperDirSection: 'Model Storage Directory',
    whisperDirDesc: 'Whisper model files (.bin) are stored here. Clicking "Download" in the main window will save files to this path.',
    whisperDirLabel: 'Path',
    browse: 'Browse',
    whisperDownloaded: (names: string) => `Downloaded: ${names}`,
    whisperSpace: (gb: string) => `Free space: ${gb} GB`,
    whisperDownloadSection: 'Download Settings',
    whisperConcurrent: 'Concurrent downloads',
    whisperConcurrentHint: 'Model files are large. Keep at 1 to avoid saturating bandwidth.',

    // ── Proxy tab ──
    proxySection: 'Network Proxy',
    proxyDesc: 'Used for Whisper model downloads and OpenAI API calls. DeepSeek / GLM / Kimi / MiniMax are China-based services and usually do not need a proxy.',
    proxyEnable: 'Enable proxy',
    proxyModeSystem: 'Use system proxy',
    proxyModeCustom: 'Custom',
    proxyProtocol: 'Protocol',
    proxyHost: 'Host',
    proxyPort: 'Port',
    proxyTest: 'Test proxy connection',
    proxyTesting: 'Testing…',
    proxyOk: (ms: number) => `Proxy OK · ${ms} ms`,
    proxyFail: (_msg: string) => `Proxy failed`,

    // ── Appearance tab ──
    appearanceTheme: 'Theme',
    appearanceThemeDesc: 'Choose a color scheme',
    appearanceLanguage: 'Interface Language',
    themeLight: 'Light',
    themeDark: 'Dark',
    themeSystem: 'Follow system',
    langUi: 'Interface language',
    langUiZh: '中文',
    langUiEn: 'English',
    currentThemeDark: 'Current: Dark',
    currentThemeLight: 'Current: Light',
    currentThemeSystem: 'Current: Follow system',
  },
} as const

export type Strings = typeof locales['zh']
