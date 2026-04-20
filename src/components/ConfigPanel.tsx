// src/components/ConfigPanel.tsx

import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useAppStore } from '../stores/appStore'
import { useLocale } from '../i18n/useLocale'

function buildProxyString(p: ReturnType<typeof useAppStore.getState>['proxy']): string | null {
  if (!p.enabled) return null
  if (p.mode === 'system') return 'system'
  return `${p.protocol.toLowerCase()}://${p.host}:${p.port}`
}

const MODELS = [
  { name: 'tiny',           size: '~39 MB',  tagKey: 'fastest'     },
  { name: 'base',           size: '~74 MB',  tagKey: 'balanced'    },
  { name: 'small',          size: '~244 MB', tagKey: 'accurate'    },
  { name: 'medium',         size: '~769 MB', tagKey: 'highQuality' },
  { name: 'large-v3-turbo', size: '~1.5 GB', tagKey: 'recommended' },
  { name: 'large-v3',       size: '~3 GB',   tagKey: 'bestQuality' },
]

const LANG_OPTIONS = ['auto','en','zh','ja','ko','fr','de'] as const

export function ConfigPanel() {
  const [tab, setTab] = useState(0)
  const { t } = useLocale()
  const tabs = [t.tabModelLang, t.tabFormat, t.tabTask]

  return (
    <div className="right-panel">
      <div className="tab-bar">
        {tabs.map((label, i) => (
          <div key={i} className={`tab ${tab === i ? 'active' : ''}`} onClick={() => setTab(i)}>
            {label}
          </div>
        ))}
      </div>
      <div className="tab-content">
        {tab === 0 && <ModelLanguageTab />}
        {tab === 1 && <TextFormattingTab />}
        {tab === 2 && <TaskFileTab />}
      </div>
    </div>
  )
}

// ── Tab 0: Model & Language ───────────────────────────────────────

function ModelLanguageTab() {
  const { t } = useLocale()
  const {
    selectedModel, setModel,
    sourceLanguage, setSourceLanguage,
    generateCn, modelDir,
  } = useAppStore()

  // Local model detection: ask Python which models are on disk
  const [localModels, setLocalModels] = useState<Set<string>>(new Set())

  async function refreshModels() {
    try {
      await invoke('send_to_python', { cmd: { cmd: 'list_models', model_dir: modelDir } })
    } catch {}
  }

  useEffect(() => {
    let unlisten: (() => void) | undefined
    listen<any>('python:models_listed', e => {
      const list: string[] = e.payload?.models ?? []
      setLocalModels(new Set(list))
    }).then(u => { unlisten = u })
    refreshModels()
    // refresh whenever a download finishes
    let unlistenDone: (() => void) | undefined
    listen<any>('python:download_done', () => { refreshModels() }).then(u => { unlistenDone = u })
    return () => { unlisten?.(); unlistenDone?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelDir])

  const langLabel: Record<string, string> = {
    auto: t.langAuto, en: t.langEn, zh: t.langZh,
    ja: t.langJa, ko: t.langKo, fr: t.langFr, de: t.langDe,
  }
  const modelTag: Record<string, string> = {
    fastest: t.fastest, balanced: t.balanced, accurate: t.accurate,
    highQuality: t.highQuality, recommended: t.recommended, bestQuality: t.bestQuality,
  }

  return (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      {/* Whisper model */}
      <div className="section">
        <div className="sec-title">{t.whisperModel}</div>
        <div className="hint" style={{ marginBottom: 8, marginTop: -4 }}>{t.modelDirHint}</div>
        {MODELS.map(m => {
          const isLocal = localModels.has(m.name)
          const isSel   = selectedModel === m.name
          return (
            <div
              key={m.name}
              className={`model-card ${isSel ? 'sel' : ''}`}
              onClick={() => isLocal && setModel(m.name)}
              style={{ opacity: !isLocal && !isSel ? 0.8 : 1 }}
            >
              <div>
                <div className="mc-name">{m.name}</div>
                <div className="mc-meta">{m.size} · {modelTag[m.tagKey]}</div>
              </div>
              <div className="mc-st">
                {isLocal
                  ? <><span className="mc-dot local" />{t.downloaded}</>
                  : <><span className="mc-dot dl" /><DownloadBtn model={m.name} t={t} /></>
                }
              </div>
            </div>
          )
        })}
      </div>

      {/* Language */}
      <div className="section">
        <div className="sec-title">{t.languageSection}</div>
        <div className="field">
          <label>{t.sourceLanguage}</label>
          <select value={sourceLanguage} onChange={e => setSourceLanguage(e.target.value)}>
            {LANG_OPTIONS.map(l => (
              <option key={l} value={l}>{langLabel[l]}</option>
            ))}
          </select>
          <div className="hint">{t.langHint}</div>
        </div>
        <CnCard />
      </div>

      {/* Output preview */}
      <div className="section">
        <div className="sec-title">{t.outputFiles}</div>
        <div className="output-rule">
          <div className="out-row">
            <div className="out-icon en" />
            <span className="out-name">
              video.en.srt <span style={{ color: 'var(--text3)', fontSize: 10 }}>{t.outputOriginal}</span>
            </span>
          </div>
          {generateCn && (
            <div className="out-row">
              <div className="out-icon cn" />
              <span className="out-name">
                video.zh-CN.srt <span style={{ color: 'var(--text3)', fontSize: 10 }}>{t.outputCn}</span>
              </span>
            </div>
          )}
        </div>
        <div className="hint">{t.outputHint}</div>
      </div>
    </div>
  )
}

function CnCard() {
  const { t } = useLocale()
  const { generateCn, setGenerateCn, activeLLMId, providers, openPrefs } = useAppStore()
  const active   = providers.find(p => p.id === activeLLMId)
  const hasKey   = !!active?.apiKey
  const configured = providers.filter(p => p.apiKey)

  return (
    <div className={`cn-card ${generateCn ? 'active' : ''}`}>
      <div className="cn-card-header" onClick={() => setGenerateCn(!generateCn)}>
        <div>
          <div className="cn-card-title">{t.generateCn}</div>
          <div className="cn-card-sub">{t.generateCnSub}</div>
        </div>
        <div className={`toggle ${generateCn ? 'on' : ''}`} />
      </div>
      {generateCn && (
        <div className="cn-card-body">
          <div className="field" style={{ marginTop: 0 }}>
            <label>{t.translationModel}</label>
            {hasKey ? (
              <select value={activeLLMId}
                onChange={e => useAppStore.getState().setActiveLLM(e.target.value)}>
                {configured.map(p => (
                  <option key={p.id} value={p.id}>{p.name} · {p.model}</option>
                ))}
              </select>
            ) : (
              <div style={{ fontSize: 11, color: 'var(--warn)', marginTop: 2 }}>
                {t.noModelConfigured}{' '}
                <span
                  style={{ color: 'var(--info)', cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={() => openPrefs(0)}
                >
                  {t.goToPrefs}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function DownloadBtn({ model, t }: { model: string; t: any }) {
  const [pct, setPct] = useState<number | null>(null)
  const { modelDir, proxy } = useAppStore()

  useEffect(() => {
    const offs: Array<() => void> = []
    listen<any>('python:download_progress', e => {
      if (e.payload?.model === model) setPct(e.payload.pct ?? 0)
    }).then(u => offs.push(u))
    listen<any>('python:download_done', e => {
      if (e.payload?.model === model) setPct(null)
    }).then(u => offs.push(u))
    listen<any>('python:download_error', e => {
      if (e.payload?.model === model) setPct(null)
    }).then(u => offs.push(u))
    return () => offs.forEach(u => u())
  }, [model])

  async function go(e: React.MouseEvent) {
    e.stopPropagation()
    setPct(0)
    await invoke('send_to_python', {
      cmd: {
        cmd: 'download_model',
        model,
        model_dir: modelDir,
        proxy: buildProxyString(proxy),
      },
    })
  }

  const busy = pct !== null
  return (
    <button className="dl-btn" onClick={go} disabled={busy}>
      {busy ? `${Math.round((pct ?? 0) * 100)}%` : t.download}
    </button>
  )
}

// ── Tab 1: Text Formatting ────────────────────────────────────────

function TextFormattingTab() {
  const { t } = useLocale()
  const { fmt, updateFmt } = useAppStore()
  const [newWord, setNewWord] = useState('')

  function addWord() {
    const w = newWord.trim()
    if (!w || fmt.censorWords.includes(w)) return
    updateFmt({ censorWords: [...fmt.censorWords, w] })
    setNewWord('')
  }

  const previewRaw = "you know, this is REALLY important stuff, and we should talk about it more!"
  const previewOut = applyPreview(previewRaw, fmt)

  const caseOptions = [
    { v: 'original',  l: t.caseOriginal  },
    { v: 'sentence',  l: t.caseSentence  },
    { v: 'upper',     l: t.caseUpper     },
    { v: 'lower',     l: t.caseLower     },
    { v: 'title',     l: t.caseTitle     },
  ]

  const censorChars = ['****', '####', '[bleep]', t.censorKeepEnds]

  return (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      {/* Re-segmentation (Udemy-style) — runs BEFORE line breaking */}
      <div className="section">
        <div className="sec-title">{t.resegSection}</div>
        <ToggleField
          label={t.resegEnable}
          hint={t.resegHint}
          value={fmt.resegmentEnabled}
          onChange={v => updateFmt({ resegmentEnabled: v })}
        />
        <div style={{ marginTop: 10, opacity: fmt.resegmentEnabled ? 1 : 0.4,
          pointerEvents: fmt.resegmentEnabled ? 'auto' : 'none' }}>
          <div className="field">
            <label>{t.resegTargetChars}</label>
            <div className="slider-row">
              <input type="range" min={20} max={80} step={1}
                value={fmt.resegmentTargetChars}
                onChange={e => updateFmt({ resegmentTargetChars: +e.target.value })} />
              <span className="slider-val">{fmt.resegmentTargetChars}</span>
            </div>
          </div>
          <div className="field">
            <label>{t.resegMaxChars}</label>
            <div className="slider-row">
              <input type="range" min={30} max={100} step={1}
                value={fmt.resegmentMaxChars}
                onChange={e => updateFmt({ resegmentMaxChars: +e.target.value })} />
              <span className="slider-val">{fmt.resegmentMaxChars}</span>
            </div>
          </div>
          <div className="field">
            <label>{t.resegMinDuration}</label>
            <input type="number" step={0.1} min={0.3} max={3}
              style={{ width: 80 }}
              value={fmt.resegmentMinDuration}
              onChange={e => updateFmt({ resegmentMinDuration: +e.target.value })} />
          </div>
          <div className="field">
            <label>{t.resegMaxDuration}</label>
            <input type="number" step={0.5} min={2} max={12}
              style={{ width: 80 }}
              value={fmt.resegmentMaxDuration}
              onChange={e => updateFmt({ resegmentMaxDuration: +e.target.value })} />
          </div>
          <div className="field">
            <label>{t.resegMaxCps}</label>
            <input type="number" step={1} min={10} max={25}
              style={{ width: 80 }}
              value={fmt.resegmentMaxCps}
              onChange={e => updateFmt({ resegmentMaxCps: +e.target.value })} />
          </div>
        </div>
      </div>

      {/* Line rules */}
      <div className="section">
        <div className="sec-title">{t.lineRules}</div>
        <div className="field">
          <label>{t.maxCharsPerLine}</label>
          <div className="slider-row">
            <input type="range" min={20} max={200} step={1} value={fmt.maxCharsPerLine}
              onChange={e => updateFmt({ maxCharsPerLine: +e.target.value })} />
            <span className="slider-val">{fmt.maxCharsPerLine}</span>
          </div>
        </div>
        <div className="field">
          <label>{t.maxLines}</label>
          <div className="chip-row">
            {[1, 2, 3].map(n => (
              <div key={n} className={`chip ${fmt.maxLines === n ? 'sel' : ''}`}
                onClick={() => updateFmt({ maxLines: n })}>
                {t.lineN(n)}
              </div>
            ))}
            <div className={`chip ${fmt.maxLines === 0 ? 'sel' : ''}`}
              onClick={() => updateFmt({ maxLines: 0 })}>
              {t.lineUnlimited}
            </div>
          </div>
        </div>
        <div className="field">
          <label>{t.lineBreakMethod}</label>
          <select value={fmt.lineBreakMethod}
            onChange={e => updateFmt({ lineBreakMethod: e.target.value as any })}>
            <option value="nlp">{t.breakNlp}</option>
            <option value="word">{t.breakWord}</option>
            <option value="char">{t.breakChar}</option>
          </select>
        </div>
      </div>

      {/* Text case */}
      <div className="section">
        <div className="sec-title">{t.textCase}</div>
        <div className="chip-row">
          {caseOptions.map(({ v, l }) => (
            <div key={v} className={`chip ${fmt.textCase === v ? 'sel' : ''}`}
              onClick={() => updateFmt({ textCase: v as any })}>
              {l}
            </div>
          ))}
        </div>
      </div>

      {/* Punctuation */}
      <div className="section">
        <div className="sec-title">{t.punctuation}</div>
        <ToggleField
          label={t.removePunct}
          hint={t.removePunctHint}
          value={fmt.removePunctuation}
          onChange={v => updateFmt({ removePunctuation: v })}
        />
        <div style={{ marginTop: 8, opacity: fmt.removePunctuation ? 1 : 0.4,
          pointerEvents: fmt.removePunctuation ? 'auto' : 'none' }}>
          <ToggleField
            label={t.keepEllipsis}
            value={fmt.keepEllipsis}
            onChange={v => updateFmt({ keepEllipsis: v })}
          />
        </div>
        <div style={{ marginTop: 8 }}>
          <ToggleField
            label={t.removeFillers}
            hint={t.removeFillersHint}
            value={fmt.removeFillers}
            onChange={v => updateFmt({ removeFillers: v })}
          />
        </div>
      </div>

      {/* Censor */}
      <div className="section">
        <div className="sec-title">{t.censor}</div>
        <ToggleField
          label={t.censorEnable}
          hint={t.censorEnableHint}
          value={fmt.censorEnabled}
          onChange={v => updateFmt({ censorEnabled: v })}
        />
        <div style={{ marginTop: 8, opacity: fmt.censorEnabled ? 1 : 0.35,
          pointerEvents: fmt.censorEnabled ? 'auto' : 'none' }}>
          <div className="field">
            <label>{t.censorChar}</label>
            <div className="chip-row">
              {censorChars.map(c => (
                <div key={c} className={`chip ${fmt.censorChar === c ? 'sel' : ''}`}
                  onClick={() => updateFmt({ censorChar: c })}>
                  {c}
                </div>
              ))}
            </div>
          </div>
          <div className="field">
            <label>{t.censorWords}</label>
            <div className="word-list">
              {fmt.censorWords.map(w => (
                <div key={w} className="word-tag">
                  {w}
                  <span className="word-tag-x"
                    onClick={() => updateFmt({ censorWords: fmt.censorWords.filter(x => x !== w) })}>
                    ×
                  </span>
                </div>
              ))}
            </div>
            <div className="word-add-row">
              <input type="text" placeholder={t.censorInputPlaceholder}
                value={newWord}
                onChange={e => setNewWord(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addWord()} />
              <button className="btn btn-card" onClick={addWord}>{t.censorAdd}</button>
            </div>
          </div>
          <div className="field">
            <ToggleField
              label={t.censorCaseInsensitive}
              value={fmt.censorCaseInsensitive}
              onChange={v => updateFmt({ censorCaseInsensitive: v })}
            />
          </div>
        </div>
      </div>

      {/* Live preview */}
      <div className="section">
        <div className="sec-title">{t.previewSection}</div>
        <div className="preview-strip" style={{ marginBottom: 6 }}>
          <div className="ps-label">{t.previewInput}</div>
          <div className="ps-before">{previewRaw}</div>
        </div>
        <div style={{ textAlign: 'center', color: 'var(--accent)', margin: '5px 0', fontSize: 13 }}>↓</div>
        <div className="preview-strip">
          <div className="ps-label">{t.previewOutput}</div>
          <div className="ps-after">{previewOut}</div>
        </div>
      </div>
    </div>
  )
}

// ── Tab 2: Task File ──────────────────────────────────────────────

function TaskFileTab() {
  const { t } = useLocale()
  const {
    autoDetectTask, skipExistingSrt, autoSaveTask, setTaskOption,
    taskFileSummary, rootDir,
  } = useAppStore()

  return (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      {/* Current status */}
      <div className="section">
        <div className="sec-title">{t.currentTaskFile}</div>
        {taskFileSummary ? (
          <div className="taskfile-info">
            <TfiRow label={t.tfFileName} value=".autosubs_task.json" />
            <TfiRow label={t.tfRootDir}  value={rootDir ?? '—'} />
            <TfiRow label={t.tfStatus}   value={t.tfLoaded} ok />
            <TfiRow label={t.tfDone}     value={`${taskFileSummary.done} / ${taskFileSummary.total}`} ok />
            <TfiRow label={t.tfPending}  value={String(taskFileSummary.pending)} />
            <TfiRow label={t.tfUpdated}  value={taskFileSummary.updated} />
          </div>
        ) : (
          <div className="hint">{rootDir ? t.tfNotFound : t.tfNoFolder}</div>
        )}
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <button className="btn btn-card" style={{ fontSize: 10 }}>{t.tfExport}</button>
          {taskFileSummary && (
            <button className="btn btn-danger" style={{ fontSize: 10 }}>{t.tfReset}</button>
          )}
        </div>
      </div>

      {/* File format */}
      <div className="section">
        <div className="sec-title">{t.tfFormat}</div>
        <div className="code-block">
          <span style={{ color: 'var(--accent)' }}>{'{'}</span><br />
          &nbsp;&nbsp;<span style={{ color: 'var(--info)' }}>"version"</span>: <span style={{ color: 'var(--warn)' }}>"1"</span>,<br />
          &nbsp;&nbsp;<span style={{ color: 'var(--info)' }}>"model"</span>: <span style={{ color: 'var(--warn)' }}>"base"</span>,<br />
          &nbsp;&nbsp;<span style={{ color: 'var(--info)' }}>"files"</span>: [{'{'}<br />
          &nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: 'var(--info)' }}>"path"</span>: <span style={{ color: 'var(--warn)' }}>"ep01.mp4"</span>,<br />
          &nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: 'var(--info)' }}>"status"</span>: <span style={{ color: 'var(--warn)' }}>"done"</span>,<br />
          &nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: 'var(--info)' }}>"srt_en"</span>: <span style={{ color: 'var(--warn)' }}>"ep01.en.srt"</span><br />
          &nbsp;&nbsp;{'}'}]<br />
          <span style={{ color: 'var(--accent)' }}>{'}'}</span>
        </div>
      </div>

      {/* Auto behavior */}
      <div className="section">
        <div className="sec-title">{t.tfAutoSection}</div>
        <ToggleField label={t.tfAutoDetect} value={autoDetectTask}
          onChange={v => setTaskOption('autoDetectTask', v)} />
        <div style={{ marginTop: 8 }}>
          <ToggleField label={t.tfSkipSrt} value={skipExistingSrt}
            onChange={v => setTaskOption('skipExistingSrt', v)} />
        </div>
        <div style={{ marginTop: 8 }}>
          <ToggleField label={t.tfAutoSave} value={autoSaveTask}
            onChange={v => setTaskOption('autoSaveTask', v)} />
        </div>
      </div>
    </div>
  )
}

// ── Shared helpers ────────────────────────────────────────────────

function TfiRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="tfi-row">
      <span className="tfi-label">{label}</span>
      <span className={`tfi-val ${ok ? 'ok' : ''}`}>{value}</span>
    </div>
  )
}

function ToggleField({
  label, hint, value, onChange,
}: {
  label: string; hint?: string; value: boolean; onChange: (v: boolean) => void
}) {
  return (
    <div className="toggle-row">
      <div style={{ flex: 1 }}>
        <div className="toggle-label">{label}</div>
        {hint && <div className="hint" style={{ marginTop: 1 }}>{hint}</div>}
      </div>
      <div className={`toggle ${value ? 'on' : ''}`} onClick={() => onChange(!value)} />
    </div>
  )
}

// ── Live preview logic (mirrors Python srt_writer.py) ─────────────

function applyPreview(text: string, fmt: ReturnType<typeof useAppStore.getState>['fmt']): string {
  if (fmt.removeFillers) {
    text = text.replace(/\b(uh+|um+|you know|like|i mean|sort of|basically|literally|actually)\b,?\s*/gi, '')
    text = text.replace(/\s{2,}/g, ' ').trim().replace(/^[,\s]+/, '')
  }
  if (fmt.removePunctuation) {
    if (fmt.keepEllipsis) {
      text = text.replace(/\.\.\./g, '\x00')
      text = text.replace(/[,!?.;:]/g, '')
      text = text.replace(/\x00/g, '…')
    } else {
      text = text.replace(/[,!?.;:]/g, '')
    }
    text = text.replace(/\s{2,}/g, ' ').trim()
  }
  switch (fmt.textCase) {
    case 'upper':    text = text.toUpperCase(); break
    case 'lower':    text = text.toLowerCase(); break
    case 'sentence': text = text[0].toUpperCase() + text.slice(1).toLowerCase(); break
    case 'title':    text = text.replace(/\b\w/g, c => c.toUpperCase()); break
  }
  // simple word wrap
  const max = fmt.maxCharsPerLine
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const candidate = (line + ' ' + w).trim()
    if (candidate.length > max) { if (line) lines.push(line); line = w }
    else line = candidate
  }
  if (line) lines.push(line)
  // maxLines <= 0 means unlimited
  return (fmt.maxLines > 0 ? lines.slice(0, fmt.maxLines) : lines).join('\n')
}
