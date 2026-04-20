// src/App.tsx
// Root: theme, layout, Tauri event wiring, resize handles

import { useEffect, useRef, useState, useCallback } from 'react'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useAppStore } from './stores/appStore'
import { useLocale } from './i18n/useLocale'
import { QueuePanel } from './components/QueuePanel'
import { ConfigPanel } from './components/ConfigPanel'
import { BottomBar, LogEntry } from './components/BottomBar'
import { PrefsPanel } from './components/PrefsPanel'
import './styles/theme.css'

const MIN_BOTTOM_H = 90
const MAX_BOTTOM_H = 320
const MIN_LEFT_W   = 240

export default function App() {
  const { theme, files, updateFileStatus, addFiles, setTaskFile, stopRun, prefOpen } = useAppStore()

  // ── Apply theme ────────────────────────────────────────────────
  useEffect(() => {
    function apply() {
      const el = document.documentElement
      if (theme === 'system') {
        el.setAttribute('data-theme',
          window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      } else {
        el.setAttribute('data-theme', theme)
      }
    }
    apply()
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])

  // ── Log ────────────────────────────────────────────────────────
  const [logs, setLogs] = useState<LogEntry[]>([])
  const addLog = useCallback((msg: string, type: LogEntry['type'] = 'info') => {
    const time = new Date().toLocaleTimeString('zh', { hour12: false })
    setLogs(l => [...l.slice(-300), { time, msg, type }])
  }, [])

  // ── Tauri event listeners ──────────────────────────────────────
  useEffect(() => {
    const offs: Array<() => void> = []

    // transcription/translation progress for a file
    listen<any>('python:progress', e => {
      const d = e.payload
      const file = useAppStore.getState().files.find(f => f.path === d.file || f.relPath === d.file || f.name === d.file)
      if (file) updateFileStatus(file.id, { status: 'processing', progress: d.pct, progressMsg: d.msg })
      addLog(`  ${d.msg}`, 'info')
    }).then(u => offs.push(u))

    // one file completed
    listen<any>('python:file_done', e => {
      const d = e.payload
      const file = useAppStore.getState().files.find(f => f.path === d.file || f.relPath === d.file || f.name === d.file)
      if (file) updateFileStatus(file.id, { status: 'done', progress: 1, srtEn: d.srt_en, srtCn: d.srt_cn, language: d.language })
      const cn = d.srt_cn ? ` + ${d.srt_cn}` : ''
      addLog(`✓ ${d.srt_en}${cn}`, 'ok')
    }).then(u => offs.push(u))

    // one file error
    listen<any>('python:file_error', e => {
      const d = e.payload
      const file = useAppStore.getState().files.find(f => f.path === d.file || f.relPath === d.file || f.name === d.file)
      if (file) updateFileStatus(file.id, { status: 'error', error: d.error })
      addLog(`✕ ${d.file}: ${d.error}`, 'error')
    }).then(u => offs.push(u))

    // all files done
    listen<any>('python:queue_done', e => {
      const d = e.payload
      stopRun()
      addLog(
        d.stopped
          ? `Stopped · ${d.done}/${d.total} done, ${d.errors} errors`
          : `All done · ${d.done}/${d.total}, ${d.errors} errors`,
        d.errors > 0 ? 'warn' : 'ok'
      )
    }).then(u => offs.push(u))

    // folder scanned → populate queue + check task file
    listen<any>('python:folder_scanned', e => {
      const d = e.payload
      if (d.resumed && d.summary) {
        setTaskFile(d.summary)
        addLog(`↺ Task file found: ${d.summary.done}/${d.summary.total} done`, 'info')
      }
      const incoming = (d.task?.files ?? d.files ?? []).map((f: any) => ({
        id:          f.path,
        path:        f.path,
        relPath:     f.path,
        name:        f.path.split('/').pop() ?? f.path,
        dir:         f.path.split('/').slice(0, -1).join('/'),
        duration:    f.duration ?? null,
        status:      f.status ?? 'pending',
        srtEn:       f.srt_en ?? null,
        srtCn:       f.srt_cn ?? null,
        isSubtitle:  false,
        language:    f.language ?? null,
        error:       f.error ?? null,
        progress:    f.status === 'done' ? 1 : 0,
        progressMsg: '',
      }))
      if (incoming.length) addFiles(incoming)
      addLog(`Scanned folder: ${incoming.length} videos`, 'info')
    }).then(u => offs.push(u))

    // subtitle folder scanned → add subtitle files to queue
    listen<any>('python:subtitle_folder_scanned', e => {
      const d = e.payload
      const rootDir: string = d.root_dir ?? ''
      const incoming = (d.files ?? []).map((f: any) => {
        const absPath = rootDir ? `${rootDir}/${f.path}` : f.path
        return {
          id:          absPath,
          path:        absPath,
          relPath:     f.path,
          name:        f.path.split('/').pop() ?? f.path,
          dir:         absPath.split('/').slice(0, -1).join('/'),
          duration:    null,
          status:      'pending' as const,
          srtEn:       null,
          srtCn:       f.srt_cn ?? null,
          isSubtitle:  true,
          language:    null,
          error:       null,
          progress:    0,
          progressMsg: '',
        }
      })
      if (incoming.length) addFiles(incoming)
      else addLog('字幕文件夹中未找到字幕文件（已跳过 .cn.* 文件）', 'warn')
      addLog(`Scanned subtitle folder: ${incoming.length} files`, 'info')
    }).then(u => offs.push(u))

    // LLM test result
    listen<any>('python:test_result', e => {
      const d = e.payload
      if (d.ok) addLog(`Connection OK · ${d.model} · ${d.latency_ms}ms`, 'ok')
      else      addLog(`Connection failed: ${d.error}`, 'error')
    }).then(u => offs.push(u))

    // Generic Python log lines (sidecar startup, missing deps, stderr, etc.)
    // Filter out HuggingFace tqdm progress chatter — it's redundant with our
    // own download_progress events (which we already throttle to once/min).
    const TQDM_NOISE = /Fetching\s+\d+\s+files|^\s*\d+%\|.*\|\s*\d+\/\d+|it\/s\]|HF_TOKEN/i
    listen<any>('python:log', e => {
      const d = e.payload
      const msg = String(d.msg ?? '')
      if (TQDM_NOISE.test(msg)) return  // suppress download progress chatter
      const lvl = d.level === 'error' ? 'error' : d.level === 'warn' ? 'warn' : 'info'
      addLog(msg, lvl as LogEntry['type'])
    }).then(u => offs.push(u))

    // Sidecar exit
    listen<any>('python:exited', () => {
      addLog('Python sidecar exited', 'warn')
    }).then(u => offs.push(u))

    // Standalone proxy connectivity test
    listen<any>('python:proxy_test_result', e => {
      const d = e.payload
      if (d.ok) addLog(`Proxy OK · ${d.url} · HTTP ${d.status} · ${d.latency_ms}ms`, 'ok')
      else      addLog(`Proxy failed (${d.url}): ${d.error}`, 'error')
    }).then(u => offs.push(u))

    // Model download progress / done / error
    // Throttle progress log lines to once per 60s per model — the underlying
    // poller fires every ~0.7s which floods the log. The first progress event
    // for each model is always shown so the user sees the download started;
    // afterwards we only emit a heartbeat once a minute.
    const lastDlLogAt: Record<string, number> = {}
    listen<any>('python:download_progress', e => {
      const d = e.payload
      const now = Date.now()
      const last = lastDlLogAt[d.model] ?? 0
      if (now - last >= 60_000) {
        addLog(`  ${d.model}: ${d.msg}`, 'info')
        lastDlLogAt[d.model] = now
      }
    }).then(u => offs.push(u))

    listen<any>('python:download_done', e => {
      delete lastDlLogAt[e.payload.model]
      addLog(`✓ Model downloaded: ${e.payload.model} → ${e.payload.path}`, 'ok')
    }).then(u => offs.push(u))

    listen<any>('python:download_error', e => {
      delete lastDlLogAt[e.payload.model]
      addLog(`✕ Download failed (${e.payload.model}): ${e.payload.error}`, 'error')
    }).then(u => offs.push(u))

    return () => offs.forEach(u => u())
  }, [addLog, updateFileStatus, addFiles, setTaskFile, stopRun])

  // ── Resize: bottom bar ─────────────────────────────────────────
  const [bottomH, setBottomH] = useState(155)
  const hDrag = useRef<{ startY: number; startH: number } | null>(null)

  const onHDown = useCallback((e: React.MouseEvent) => {
    hDrag.current = { startY: e.clientY, startH: bottomH }
    e.preventDefault()
  }, [bottomH])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!hDrag.current) return
      const dy  = hDrag.current.startY - e.clientY
      setBottomH(Math.max(MIN_BOTTOM_H, Math.min(hDrag.current.startH + dy, MAX_BOTTOM_H)))
    }
    const onUp = () => { hDrag.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  // ── Resize: left panel width ───────────────────────────────────
  const [leftW, setLeftW] = useState<number | null>(null)
  const vDrag  = useRef<{ startX: number; startW: number } | null>(null)
  const leftRef = useRef<HTMLDivElement>(null)

  const onVDown = useCallback((e: React.MouseEvent) => {
    const w = leftRef.current?.getBoundingClientRect().width ?? 400
    vDrag.current = { startX: e.clientX, startW: w }
    e.preventDefault()
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!vDrag.current) return
      const dx = e.clientX - vDrag.current.startX
      setLeftW(Math.max(MIN_LEFT_W, vDrag.current.startW + dx))
    }
    const onUp = () => { vDrag.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  return (
    <div className="window">
      <TitleBar />
      <div className="app-body">
        <div className="main-split">
          {/* Left: queue (resizable) */}
          <div
            ref={leftRef}
            className="left-panel-wrap"
            style={leftW ? { flex: 'none', width: leftW } : { flex: 1 }}
          >
            <QueuePanel />
          </div>

          {/* Vertical resize handle */}
          <div className="vresize" onMouseDown={onVDown} />

          {/* Right: config (fixed 280px) */}
          <div className="right-panel-wrap">
            <ConfigPanel />
          </div>
        </div>

        {/* Horizontal resize handle */}
        <div className="hresize" onMouseDown={onHDown} />

        {/* Bottom: progress + log */}
        <BottomBar logs={logs} height={bottomH} />
      </div>

      {/* Prefs overlay */}
      {prefOpen && <PrefsPanel />}
    </div>
  )
}

// ── TitleBar ──────────────────────────────────────────────────────

function TitleBar() {
  const { openPrefs } = useAppStore()
  const { t } = useLocale()
  const titleRef = useRef<HTMLDivElement>(null)

  // Native DOM mousedown listener — more reliable than React synthetic events
  // and Tauri's auto-injected data-tauri-drag-region in production builds.
  useEffect(() => {
    const el = titleRef.current
    if (!el) return

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      const tgt = e.target as HTMLElement
      if (tgt.closest('button, input, select, textarea, a, [data-no-drag]')) return
      e.preventDefault()
      getCurrentWindow().startDragging().catch(() => {})
    }

    const onDoubleClick = (e: MouseEvent) => {
      const tgt = e.target as HTMLElement
      if (tgt.closest('button, input, select, textarea, a')) return
      e.preventDefault()
      const win = getCurrentWindow()
      win.isMaximized().then(max => max ? win.unmaximize() : win.maximize()).catch(() => {})
    }

    el.addEventListener('mousedown', onMouseDown)
    el.addEventListener('dblclick', onDoubleClick)
    return () => {
      el.removeEventListener('mousedown', onMouseDown)
      el.removeEventListener('dblclick', onDoubleClick)
    }
  }, [])

  return (
    <div ref={titleRef} className="titlebar">
      <div className="title-center">
        <div className="logo-mark">
          <svg viewBox="0 0 12 12" fill="none" width="11" height="11">
            <rect x="1" y="2" width="10" height="1.5" rx=".5" fill="#fff"/>
            <rect x="1" y="5" width="7"   height="1.5" rx=".5" fill="#fff"/>
            <rect x="1" y="8" width="8.5" height="1.5" rx=".5" fill="#fff"/>
          </svg>
        </div>
        <span className="app-title">{t.appTitle}</span>
        <span className="app-version">v0.1.2</span>
      </div>

      <div className="titlebar-right">
        <button className="btn" onClick={() => openPrefs(0)}>{t.prefs}</button>
      </div>
    </div>
  )
}
