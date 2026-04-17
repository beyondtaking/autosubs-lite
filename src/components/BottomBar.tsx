// src/components/BottomBar.tsx

import { useRef, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useAppStore } from '../stores/appStore'
import { useLocale } from '../i18n/useLocale'

export interface LogEntry {
  time: string
  msg: string
  type: 'info' | 'ok' | 'warn' | 'error'
}

interface Props { logs: LogEntry[]; height: number }

export function BottomBar({ logs, height }: Props) {
  const { t } = useLocale()
  const { files, isRunning, selectedModel, generateCn, activeLLMId, providers, startRun, stopRun } = useAppStore()
  const logRef = useRef<HTMLDivElement>(null)

  const done  = files.filter(f => f.status === 'done').length
  const total = files.length
  const processing = files.find(f => f.status === 'processing')
  const pct = total > 0 ? done / total : 0
  const activeProvider = providers.find(p => p.id === activeLLMId)
  const hasSubtitleFiles = files.some(f => f.isSubtitle)
  // If subtitle files are in queue, generateCn must be checked to start
  const subtitleBlocked = hasSubtitleFiles && !generateCn

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  async function handleStart() {
    const store = useAppStore.getState()
    startRun()
    await invoke('send_to_python', { cmd: { cmd: 'start', config: buildConfig(store) } })
  }
  async function handleStop() {
    await invoke('send_to_python', { cmd: { cmd: 'stop' } })
    stopRun()
  }

  return (
    <div className="bottom-bar" style={{ height }}>
      <div className="progress-header">
        <div className="progress-status">
          {isRunning && processing ? (
            <>{t.processing} <b>{processing.name}</b> · {done+1}/{total} · {t.remaining} {total-done-1}</>
          ) : isRunning ? (
            <>{t.ready}…</>
          ) : total > 0 ? (
            <>{t.ready} · {total} · {done > 0 ? t.filesDone(done) : ''}</>
          ) : (
            <>{t.addFilesHint}</>
          )}
        </div>
        {total > 0 && (
          isRunning
            ? <button className="run-btn stop" onClick={handleStop}>{t.stop}</button>
            : <button
                className="run-btn"
                onClick={handleStart}
                disabled={done === total || subtitleBlocked}
                title={subtitleBlocked ? t.subtitleScanHint : undefined}
              >{t.startProcessing}</button>
        )}
      </div>

      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct*100}%` }} />
      </div>

      <div className="log-area" ref={logRef}>
        {logs.map((e, i) => (
          <div key={i} className="log-line">
            <span className="log-time">{e.time}</span>
            <span className={`log-msg ${e.type==='ok'?'ok':e.type==='warn'?'warn':e.type==='error'?'err':'info'}`}>
              {e.msg}
            </span>
          </div>
        ))}
      </div>

      {subtitleBlocked && (
        <div style={{ padding: '2px 10px', fontSize: 10, color: 'var(--warn)', background: 'var(--warn-bg, rgba(255,180,0,.08))' }}>
          ⚠ {t.subtitleScanHint}
        </div>
      )}
      <div className="stat-row">
        <div className="stat">{t.statQueue}<b>{total}</b></div>
        <div className="stat">{t.statDuration}<b>{calcDuration(files)}</b></div>
        {!hasSubtitleFiles && <div className="stat">{t.statModel}<b>{selectedModel}</b></div>}
        {generateCn && activeProvider && <div className="stat">{t.statTranslation}<b>{activeProvider.name}</b></div>}
        <div className="stat">{t.statOutput}<b>{hasSubtitleFiles ? '.cn' : generateCn ? '.en + .cn' : '.en'}</b></div>
      </div>
    </div>
  )
}

function buildConfig(s: ReturnType<typeof useAppStore.getState>) {
  const p = s.providers.find(x => x.id === s.activeLLMId)
  const proxy = s.proxy.enabled
    ? s.proxy.mode==='system' ? 'system'
    : `${s.proxy.protocol.toLowerCase()}://${s.proxy.host}:${s.proxy.port}`
    : null

  const hasSubtitleFiles = s.files.some(f => f.isSubtitle)
  const subtitleFiles = s.files.filter(f => f.isSubtitle)
  const videoFiles    = s.files.filter(f => !f.isSubtitle)

  // Subtitle files always use absolute paths and are sent as explicit file list.
  // Non-subtitle files are sent via root_dir (task file) when available, or
  // as explicit absolute paths when added individually.
  const explicitFiles = [
    ...(!s.rootDir ? videoFiles.map(f => ({ path: f.path, is_subtitle: false })) : []),
    ...subtitleFiles.map(f => ({ path: f.path, is_subtitle: true })),
  ]

  return {
    root_dir: s.rootDir,
    files: explicitFiles,
    model: s.selectedModel,
    model_dir: s.modelDir,
    language: s.sourceLanguage==='auto' ? null : s.sourceLanguage,
    generate_cn: s.generateCn,
    llm_provider: p ? { base_url:p.baseUrl, api_key:p.apiKey, model:p.model } : null,
    batch_size: s.batchSize,
    proxy,
    fmt: {
      max_chars_per_line: s.fmt.maxCharsPerLine,
      max_lines: s.fmt.maxLines,
      line_break_method: s.fmt.lineBreakMethod,
      text_case: s.fmt.textCase,
      remove_punctuation: s.fmt.removePunctuation,
      keep_ellipsis: s.fmt.keepEllipsis,
      remove_fillers: s.fmt.removeFillers,
      censor_enabled: s.fmt.censorEnabled,
      censor_words: s.fmt.censorWords,
      censor_char: s.fmt.censorChar,
      censor_case_insensitive: s.fmt.censorCaseInsensitive,
      resegment_enabled:      s.fmt.resegmentEnabled,
      resegment_target_chars: s.fmt.resegmentTargetChars,
      resegment_max_chars:    s.fmt.resegmentMaxChars,
      resegment_min_duration: s.fmt.resegmentMinDuration,
      resegment_max_duration: s.fmt.resegmentMaxDuration,
      resegment_max_cps:      s.fmt.resegmentMaxCps,
    },
    skip_existing_srt: s.skipExistingSrt,
    auto_save_task: s.autoSaveTask,
  }
}

function calcDuration(files: any[]) {
  const total = files.reduce((a, f) => a + (f.duration ?? 0), 0)
  if (!total) return '—'
  const h = Math.floor(total/3600), m = Math.floor((total%3600)/60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
