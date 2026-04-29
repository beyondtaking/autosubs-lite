// src/components/QueuePanel.tsx

import { useState, useRef, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useAppStore, QueueFile } from '../stores/appStore'
import { useLocale } from '../i18n/useLocale'
import { buildRetryConfig } from './retryConfig'

export function QueuePanel() {
  const { t } = useLocale()
  const {
    files, rootDir, taskFileLoaded, taskFileSummary,
    addFiles, clearFiles, setRootDir, setTaskFile, dismissTaskFile, resetFilesStatus, startRun,
  } = useAppStore()

  async function handleAddFiles() {
    const paths: string[] = await invoke('pick_files')
    if (!paths.length) return
    const newFiles: QueueFile[] = paths.map((p) => ({
      id: p, path: p, relPath: p,
      name: p.split('/').pop() ?? p,
      dir: p.split('/').slice(0, -1).join('/'),
      duration: null, status: 'pending',
      srtEn: null, srtCn: null,
      isSubtitle: false,
      language: null, error: null,
      progress: 0, progressMsg: '',
    }))
    addFiles(newFiles)
  }

  async function handleAddFolder() {
    const dir: string | null = await invoke('pick_folder')
    if (!dir) return
    setRootDir(dir)
    await invoke('send_to_python', { cmd: { cmd: 'scan_folder', root_dir: dir } })
  }

  async function handleAddSubtitleFiles() {
    const paths: string[] = await invoke('pick_subtitle_files')
    if (!paths.length) return
    const newFiles: QueueFile[] = paths.map((p) => ({
      id: p, path: p, relPath: p,
      name: p.split('/').pop() ?? p,
      dir: p.split('/').slice(0, -1).join('/'),
      duration: null, status: 'pending',
      srtEn: null, srtCn: null,
      isSubtitle: true,
      language: null, error: null,
      progress: 0, progressMsg: '',
    }))
    addFiles(newFiles)
  }

  async function handleAddSubtitleFolder() {
    const dir: string | null = await invoke('pick_folder')
    if (!dir) return
    await invoke('send_to_python', { cmd: { cmd: 'scan_subtitle_folder', root_dir: dir } })
  }

  async function handleRetryFile(file: QueueFile) {
    resetFilesStatus([file.id])
    startRun()
    const store = useAppStore.getState()
    await invoke('send_to_python', { cmd: { cmd: 'start', config: buildRetryConfig(store, [file.id]) } })
  }

  const doneCount = files.filter((f) => f.status === 'done').length
  const total = files.length

  return (
    <div className="left-panel">
      <div className="panel-header">
        <span className="panel-title">{t.queue}</span>
        <div className="header-actions">
          <button className="btn btn-card" onClick={handleAddFiles}>
            <IconPlus /> {t.addFile}
          </button>
          <button className="btn btn-card" onClick={handleAddFolder}>
            <IconFolder /> {t.addFolder}
          </button>
          <SubtitleDropdown
            t={t}
            onAddFiles={handleAddSubtitleFiles}
            onAddFolder={handleAddSubtitleFolder}
          />
          {files.length > 0 && (
            <button className="btn btn-danger" onClick={clearFiles}>{t.clearQueue}</button>
          )}
        </div>
      </div>

      {taskFileLoaded && taskFileSummary && (
        <TaskBanner summary={taskFileSummary} rootDir={rootDir} onDismiss={dismissTaskFile} t={t} />
      )}

      {files.length === 0 ? (
        <EmptyState t={t} />
      ) : (
        <div className="queue-list" style={{ marginTop: 8 }}>
          <div className="sort-row">
            <span style={{ color: 'var(--text3)' }}>{t.sortBy}</span>
            <span className="sort-chip active">{t.sortPath}</span>
            <span className="sort-chip">{t.sortName}</span>
            <span className="sort-chip">{t.sortDuration}</span>
            <span className="sort-chip">{t.sortStatus}</span>
            <span style={{ marginLeft: 'auto', color: 'var(--text3)', fontSize: 10 }}>
              {t.filesCount(total, doneCount)}
            </span>
          </div>
          {files.map((f, i) => (
            <FileItem key={f.id} file={f} index={i + 1} t={t} onRetry={handleRetryFile} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Subtitle dropdown button ──────────────────────────────────────

function SubtitleDropdown({ t, onAddFiles, onAddFolder }: {
  t: any
  onAddFiles: () => void
  onAddFolder: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOut(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOut)
    return () => document.removeEventListener('mousedown', onClickOut)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn btn-card" onClick={() => setOpen(o => !o)}>
        <IconSub /> {t.addSubFile} <span style={{ marginLeft: 2, opacity: 0.6, fontSize: 8 }}>▾</span>
      </button>
      {open && (
        <div className="dropdown-menu">
          <button className="dropdown-item" onClick={() => { onAddFiles(); setOpen(false) }}>
            📄 {t.addSubFilesSingle}
          </button>
          <button className="dropdown-item" onClick={() => { onAddFolder(); setOpen(false) }}>
            📁 {t.addSubFilesFolder}
          </button>
        </div>
      )}
    </div>
  )
}

// ── File item ─────────────────────────────────────────────────────

function FileItem({ file, index, t, onRetry }: {
  file: QueueFile; index: number; t: any
  onRetry: (f: QueueFile) => void
}) {
  const cls = { pending:'fi-pending', processing:'fi-processing', done:'fi-done', error:'fi-error' }[file.status]
  const dur = file.duration ? formatDuration(file.duration) : null
  return (
    <div className={`file-item ${cls}`}>
      <div className="fi-num">{String(index).padStart(2,'0')}</div>
      <div className="fi-info">
        <div className="fi-name">
          {file.name}
          {file.isSubtitle && <span className="badge badge-sub">{t.subtitleBadge}</span>}
          {file.status==='done'  && <span className="badge badge-done">✓ {t.done}</span>}
          {file.status==='error' && <span className="badge badge-error">✕ {t.failed}</span>}
        </div>
        <div className="fi-path">{file.dir}/</div>
        {file.status==='processing' && (
          <div className="fi-progress">
            <div className="fi-progress-fill" style={{ width:`${Math.round(file.progress*100)}%` }} />
          </div>
        )}
        {file.status==='error' && file.error && (
          <div className="fi-path" style={{ color:'var(--danger)', marginTop:2 }}>{file.error}</div>
        )}
      </div>
      <div className="fi-right">
        {dur && <span className="fi-dur">{dur}</span>}
        {file.status==='processing' && <div className="spin" />}
        {file.status==='error' && (
          <button
            className="retry-btn"
            title={t.retry}
            onClick={() => onRetry(file)}
          >↺</button>
        )}
      </div>
    </div>
  )
}

function TaskBanner({ summary, rootDir, onDismiss, t }: any) {
  return (
    <div className="task-banner">
      <div className="task-banner-icon" />
      <div className="task-banner-body">
        <div className="task-banner-title">{t.taskDetected} — {rootDir}/.autosubs_task.json</div>
        <div className="task-banner-sub">{t.taskSub(summary.done, summary.total, summary.pending)}</div>
        <div className="task-banner-actions">
          <button className="tbtn resume">{t.taskResume}</button>
          <button className="tbtn" onClick={onDismiss}>{t.taskIgnore}</button>
        </div>
      </div>
    </div>
  )
}

function EmptyState({ t }: { t: any }) {
  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:10, color:'var(--text3)' }}>
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
        <rect x="4" y="6" width="28" height="24" rx="3" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M14 13l8 5-8 5V13Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      </svg>
      <div style={{ fontSize:12, textAlign:'center', lineHeight:1.7 }}>
        {t.emptyTitle}<br/>{t.emptyHint}
      </div>
    </div>
  )
}

function IconPlus() {
  return <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><rect x="1" y="1" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1"/><line x1="5" y1="3" x2="5" y2="7" stroke="currentColor" strokeWidth="1"/><line x1="3" y1="5" x2="7" y2="5" stroke="currentColor" strokeWidth="1"/></svg>
}
function IconFolder() {
  return <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M1 3.5C1 2.67 1.67 2 2.5 2H4l1 1.5h2.5C8.33 3.5 9 4.17 9 5v2.5C9 8.33 8.33 9 7.5 9h-5C1.67 9 1 8.33 1 7.5V3.5Z" stroke="currentColor" strokeWidth="1"/><line x1="5" y1="5.5" x2="5" y2="7.5" stroke="currentColor" strokeWidth="1"/><line x1="4" y1="6.5" x2="6" y2="6.5" stroke="currentColor" strokeWidth="1"/></svg>
}
function IconSub() {
  return <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><rect x="1" y="2" width="8" height="6" rx="1.2" stroke="currentColor" strokeWidth="1"/><line x1="2.5" y1="4.5" x2="7.5" y2="4.5" stroke="currentColor" strokeWidth="1"/><line x1="2.5" y1="6" x2="5.5" y2="6" stroke="currentColor" strokeWidth="1"/></svg>
}

function formatDuration(s: number) {
  const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=Math.floor(s%60)
  if(h>0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
  return `${m}:${String(sec).padStart(2,'0')}`
}
