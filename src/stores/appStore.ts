// src/stores/appStore.ts
// Global app state with Zustand

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// ── Types ─────────────────────────────────────────────────────────

export type FileStatus = 'pending' | 'processing' | 'done' | 'error'

export interface QueueFile {
  id: string           // unique key (abs path)
  path: string         // absolute path
  relPath: string      // relative to root_dir (or same as path for single files)
  name: string         // basename
  dir: string          // parent directory display
  duration: number | null
  status: FileStatus
  srtEn: string | null
  srtCn: string | null
  isSubtitle: boolean  // true = subtitle-file (no Whisper, translate-only)
  language: string | null
  error: string | null
  progress: number     // 0-1
  progressMsg: string
}

export interface LLMProvider {
  id: string           // 'deepseek' | 'glm' | 'kimi' | 'openai' | 'minimax'
  name: string
  baseUrl: string
  apiKey: string
  model: string
}

export interface ProxyConfig {
  enabled: boolean
  mode: 'system' | 'custom'
  protocol: 'HTTP' | 'HTTPS' | 'SOCKS5'
  host: string
  port: string
}

export interface FmtConfig {
  maxCharsPerLine: number
  maxLines: number
  lineBreakMethod: 'nlp' | 'word' | 'char'
  textCase: 'original' | 'sentence' | 'upper' | 'lower' | 'title'
  removePunctuation: boolean
  keepEllipsis: boolean
  removeFillers: boolean
  censorEnabled: boolean
  censorWords: string[]
  censorChar: string
  censorCaseInsensitive: boolean
  // ── Re-segmentation (Udemy-style): re-cut Whisper output into
  //    single-line cues using word-level timestamps ──
  resegmentEnabled: boolean
  resegmentTargetChars: number   // preferred chars per cue
  resegmentMaxChars: number      // hard ceiling
  resegmentMinDuration: number   // seconds
  resegmentMaxDuration: number   // seconds
  resegmentMaxCps: number        // reading speed cap
}

export interface AppState {
  // ── theme & locale ──
  theme: 'dark' | 'light' | 'system'
  setTheme: (t: 'dark' | 'light' | 'system') => void
  locale: 'zh' | 'en'
  setLocale: (l: 'zh' | 'en') => void

  // ── queue ──
  files: QueueFile[]
  rootDir: string | null
  taskFileLoaded: boolean
  taskFileSummary: { total: number; done: number; pending: number; updated: string } | null
  setRootDir: (dir: string | null) => void
  addFiles: (files: QueueFile[]) => void
  clearFiles: () => void
  updateFileStatus: (id: string, patch: Partial<QueueFile>) => void
  setTaskFile: (summary: AppState['taskFileSummary']) => void
  dismissTaskFile: () => void

  // ── running state ──
  isRunning: boolean
  currentFileId: string | null
  startRun: () => void
  stopRun: () => void

  // ── whisper model ──
  selectedModel: string
  modelDir: string
  setModel: (m: string) => void
  setModelDir: (d: string) => void

  // ── language ──
  sourceLanguage: string   // 'auto' | 'en' | 'zh' | ...
  generateCn: boolean
  setSourceLanguage: (l: string) => void
  setGenerateCn: (v: boolean) => void

  // ── LLM providers ──
  providers: LLMProvider[]
  activeLLMId: string
  setActiveLLM: (id: string) => void
  updateProvider: (id: string, patch: Partial<LLMProvider>) => void
  batchSize: number
  setBatchSize: (n: number) => void

  // ── proxy ──
  proxy: ProxyConfig
  updateProxy: (patch: Partial<ProxyConfig>) => void

  // ── text formatting ──
  fmt: FmtConfig
  updateFmt: (patch: Partial<FmtConfig>) => void

  // ── task file options ──
  autoDetectTask: boolean
  skipExistingSrt: boolean
  autoSaveTask: boolean
  setTaskOption: (key: 'autoDetectTask' | 'skipExistingSrt' | 'autoSaveTask', v: boolean) => void

  // ── prefs panel ──
  prefOpen: boolean
  prefTab: number
  openPrefs: (tab?: number) => void
  closePrefs: () => void
}

// ── Default providers ─────────────────────────────────────────────

const DEFAULT_PROVIDERS: LLMProvider[] = [
  { id: 'deepseek',  name: 'DeepSeek',      baseUrl: 'https://api.deepseek.com/v1',                model: 'deepseek-chat',          apiKey: '' },
  { id: 'glm',       name: '智谱 GLM',       baseUrl: 'https://open.bigmodel.cn/api/paas/v4',       model: 'glm-4-flash',            apiKey: '' },
  { id: 'kimi',      name: 'Kimi',          baseUrl: 'https://api.moonshot.cn/v1',                  model: 'moonshot-v1-8k',         apiKey: '' },
  { id: 'openai',    name: 'OpenAI',        baseUrl: 'https://api.openai.com/v1',                   model: 'gpt-4o-mini',            apiKey: '' },
  { id: 'anthropic', name: 'Anthropic',     baseUrl: 'https://api.anthropic.com/v1',                model: 'claude-sonnet-4-20250514',       apiKey: '' },
  { id: 'minimax',   name: 'MiniMax',       baseUrl: 'https://api.minimax.chat/v1',                 model: 'abab6.5s-chat',          apiKey: '' },
]

const DEFAULT_FMT: FmtConfig = {
  // Per-cue line wrap (acts as a safety fuse; won't trigger when resegment is on
  // and maxCharsPerLine ≥ resegmentMaxChars).
  maxCharsPerLine: 120,
  maxLines: 1,
  lineBreakMethod: 'nlp',
  textCase: 'original',
  removePunctuation: false,
  keepEllipsis: true,
  removeFillers: false,
  censorEnabled: false,
  censorWords: [],
  censorChar: '****',
  censorCaseInsensitive: true,
  // Udemy-style re-segmentation ON by default: Whisper's long segments get
  // re-cut into ~45 char single-line cues (hard cap 70) with their own
  // time ranges.
  resegmentEnabled: true,
  resegmentTargetChars: 45,
  resegmentMaxChars: 70,
  resegmentMinDuration: 0.8,
  resegmentMaxDuration: 6.0,
  resegmentMaxCps: 17,
}

// ── Store ─────────────────────────────────────────────────────────

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // theme & locale
      theme: 'system',
      setTheme: (t) => set({ theme: t }),
      locale: 'zh',
      setLocale: (l) => set({ locale: l }),

      // queue
      files: [],
      rootDir: null,
      taskFileLoaded: false,
      taskFileSummary: null,
      setRootDir: (dir) => set({ rootDir: dir }),
      addFiles: (newFiles) => set((s) => {
        const existing = new Set(s.files.map((f) => f.id))
        return { files: [...s.files, ...newFiles.filter((f) => !existing.has(f.id))] }
      }),
      clearFiles: () => set({ files: [], rootDir: null, taskFileLoaded: false, taskFileSummary: null }),
      updateFileStatus: (id, patch) => set((s) => ({
        files: s.files.map((f) => f.id === id ? { ...f, ...patch } : f),
      })),
      setTaskFile: (summary) => set({ taskFileLoaded: true, taskFileSummary: summary }),
      dismissTaskFile: () => set({ taskFileLoaded: false, taskFileSummary: null }),

      // running
      isRunning: false,
      currentFileId: null,
      startRun: () => set({ isRunning: true }),
      stopRun: () => set({ isRunning: false, currentFileId: null }),

      // model
      selectedModel: 'base',
      modelDir: '~/autosubs/models',
      setModel: (m) => set({ selectedModel: m }),
      setModelDir: (d) => set({ modelDir: d }),

      // language
      sourceLanguage: 'auto',
      generateCn: false,
      activeLLMId: 'deepseek',
      setSourceLanguage: (l) => set({ sourceLanguage: l }),
      setGenerateCn: (v) => set({ generateCn: v }),

      // LLM
      providers: DEFAULT_PROVIDERS,
      setActiveLLM: (id) => set({ activeLLMId: id }),
      updateProvider: (id, patch) => set((s) => ({
        providers: s.providers.map((p) => p.id === id ? { ...p, ...patch } : p),
      })),
      batchSize: 80,
      setBatchSize: (n) => set({ batchSize: n }),

      // proxy
      proxy: {
        enabled: false,
        mode: 'system',
        protocol: 'SOCKS5',
        host: '127.0.0.1',
        port: '7890',
      },
      updateProxy: (patch) => set((s) => ({ proxy: { ...s.proxy, ...patch } })),

      // fmt
      fmt: DEFAULT_FMT,
      updateFmt: (patch) => set((s) => ({ fmt: { ...s.fmt, ...patch } })),

      // task options
      autoDetectTask: true,
      skipExistingSrt: true,
      autoSaveTask: true,
      setTaskOption: (key, v) => set({ [key]: v }),

      // prefs
      prefOpen: false,
      prefTab: 0,
      openPrefs: (tab = 0) => set({ prefOpen: true, prefTab: tab }),
      closePrefs: () => set({ prefOpen: false }),
    }),
    {
      name: 'autosubs-lite-config',
      version: 8,
      // v1→v2: bump chars/lines to 42×2 (standard subtitle).
      // v2→v3: switch to Udemy-style 200 × unlimited.
      // v3→v4: add Anthropic (Claude) provider.
      // v4→v5: revert to standard streaming-subtitle 60×2.
      // v5→v6: add Udemy-style re-segmentation (word-timestamp based cue re-cut).
      // v6→v7: move modelDir out of hidden ~/.autosubs/models → ~/autosubs/models
      //        (visible in Finder). Only rewrites if the user still has the old default.
      // v7→v8: tune resegment defaults (target 42→45, max 60→70) and line-wrap
      //        defaults (60×2 → 120×1) so the safety-fuse wrap never triggers
      //        under the default resegment caps.
      migrate: (persisted: any, fromVersion: number) => {
        if (!persisted) return persisted
        if (fromVersion < 4) {
          // Merge new providers
          const existing = persisted.providers ?? []
          const existingIds = new Set(existing.map((p: any) => p.id))
          for (const dp of DEFAULT_PROVIDERS) {
            if (!existingIds.has(dp.id)) {
              existing.push(dp)
            }
          }
          persisted.providers = existing
        }
        if (fromVersion < 5) {
          persisted.fmt = { ...DEFAULT_FMT, ...(persisted.fmt ?? {}),
                            maxCharsPerLine: DEFAULT_FMT.maxCharsPerLine,
                            maxLines: DEFAULT_FMT.maxLines,
                            lineBreakMethod: 'nlp' }
        }
        if (fromVersion < 6) {
          // Ensure new resegment fields are populated from DEFAULT_FMT
          persisted.fmt = {
            ...DEFAULT_FMT,
            ...(persisted.fmt ?? {}),
            resegmentEnabled:     DEFAULT_FMT.resegmentEnabled,
            resegmentTargetChars: DEFAULT_FMT.resegmentTargetChars,
            resegmentMaxChars:    DEFAULT_FMT.resegmentMaxChars,
            resegmentMinDuration: DEFAULT_FMT.resegmentMinDuration,
            resegmentMaxDuration: DEFAULT_FMT.resegmentMaxDuration,
            resegmentMaxCps:      DEFAULT_FMT.resegmentMaxCps,
          }
        }
        if (fromVersion < 7) {
          // Only rewrite if user still has the old hidden default — preserve
          // any custom path the user set themselves.
          if (persisted.modelDir === '~/.autosubs/models') {
            persisted.modelDir = '~/autosubs/models'
          }
        }
        if (fromVersion < 8) {
          // Only rewrite fields that still hold prior defaults — preserve
          // any custom values the user set. New defaults match the
          // recommended Udemy-single-line profile (45/70/120/1).
          const f = persisted.fmt ?? {}
          if (f.resegmentTargetChars === 42) f.resegmentTargetChars = 45
          if (f.resegmentMaxChars    === 60) f.resegmentMaxChars    = 70
          if (f.maxCharsPerLine      === 60) f.maxCharsPerLine      = 120
          if (f.maxLines             === 2)  f.maxLines             = 1
          persisted.fmt = f
        }
        return persisted
      },
      // Persist everything except ephemeral queue/running state
      partialize: (s) => ({
        theme: s.theme,
        locale: s.locale,
        selectedModel: s.selectedModel,
        modelDir: s.modelDir,
        sourceLanguage: s.sourceLanguage,
        generateCn: s.generateCn,
        activeLLMId: s.activeLLMId,
        providers: s.providers,
        batchSize: s.batchSize,
        proxy: s.proxy,
        fmt: s.fmt,
        autoDetectTask: s.autoDetectTask,
        skipExistingSrt: s.skipExistingSrt,
        autoSaveTask: s.autoSaveTask,
      }),
    }
  )
)
