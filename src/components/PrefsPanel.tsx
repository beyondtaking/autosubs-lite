// src/components/PrefsPanel.tsx

import { useState, useRef, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useAppStore, LLMProvider } from '../stores/appStore'
import { useLocale } from '../i18n/useLocale'

const PROVIDER_META: Record<string, { logo: string; color: string }> = {
  deepseek:  { logo:'DS', color:'#1a6bff' },
  glm:       { logo:'GL', color:'#6b3fa0' },
  kimi:      { logo:'Ki', color:'#0d9488' },
  openai:    { logo:'AI', color:'#19c37d' },
  anthropic: { logo:'CL', color:'#d97757' },
  minimax:   { logo:'Mx', color:'#e05c2a' },
}

export function PrefsPanel() {
  const { t } = useLocale()
  const { prefTab, closePrefs } = useAppStore()
  const [tab, setTab] = useState(prefTab)

  const tabs = [t.prefTabLLM, t.prefTabWhisper, t.prefTabProxy, t.prefTabAppearance]

  // Track where the mousedown originated. Only close on a pure click that
  // *both* started and ended on the overlay — prevents accidental close when
  // the user drags a text selection out of an input and releases on the
  // backdrop (mousedown inside input, mouseup on overlay would otherwise
  // fire a click event on the overlay with target===currentTarget).
  const downOnOverlayRef = useRef(false)

  return (
    <div
      className="pref-overlay open"
      onMouseDown={e => { downOnOverlayRef.current = e.target === e.currentTarget }}
      onClick={e => {
        if (downOnOverlayRef.current && e.target === e.currentTarget) {
          closePrefs()
        }
        downOnOverlayRef.current = false
      }}
    >
      <div className="pref-panel">
        <div className="pref-header">
          <span className="pref-title">{t.prefTitle}</span>
          <button className="pref-close" onClick={closePrefs}>×</button>
        </div>
        <div className="pref-tabs">
          {tabs.map((label, i) => (
            <div key={i} className={`pref-tab ${tab===i?'active':''}`} onClick={() => setTab(i)}>
              {label}
            </div>
          ))}
        </div>
        <div className="pref-body">
          {tab===0 && <LLMTab />}
          {tab===1 && <WhisperTab />}
          {tab===2 && <ProxyTab />}
          {tab===3 && <AppearanceTab />}
        </div>
        <div className="pref-footer">
          <button className="cancel-btn" onClick={closePrefs}>{t.cancel}</button>
          <button className="save-btn" onClick={closePrefs}>{t.save}</button>
        </div>
      </div>
    </div>
  )
}

// ── LLM Tab ───────────────────────────────────────────────────────

type LLMStatus = { kind: 'ok'; latency: number } | { kind: 'error'; msg: string }

function LLMTab() {
  const { t } = useLocale()
  const { providers, activeLLMId, setActiveLLM, updateProvider, batchSize, setBatchSize, proxy } = useAppStore()
  const [openId, setOpenId] = useState<string|null>(activeLLMId)
  const [testing, setTesting] = useState<Record<string,'idle'|'testing'>>({})
  const [statuses, setStatuses] = useState<Record<string, LLMStatus | undefined>>({})

  // Subscribe to test_result events from Python; match by provider_id echoed back
  useEffect(() => {
    let unlisten: (() => void) | undefined
    listen<any>('python:test_result', e => {
      const pid: string | undefined = e.payload?.provider_id
      if (!pid) return
      setTesting(s => ({ ...s, [pid]: 'idle' }))
      if (e.payload?.ok) {
        setStatuses(s => ({ ...s, [pid]: { kind: 'ok', latency: e.payload.latency_ms ?? 0 } }))
      } else {
        const raw = String(e.payload?.error ?? '')
        // Trim noisy multi-line API error bodies for the inline badge
        const short = raw.replace(/\s+/g, ' ').slice(0, 80)
        setStatuses(s => ({ ...s, [pid]: { kind: 'error', msg: short || 'unknown error' } }))
      }
    }).then(u => { unlisten = u })
    return () => { unlisten?.() }
  }, [])

  function buildProxy(): string | null {
    if (!proxy.enabled) return null
    if (proxy.mode === 'system') return 'system'
    return `${proxy.protocol.toLowerCase()}://${proxy.host}:${proxy.port}`
  }

  async function handleTest(p: LLMProvider) {
    setTesting(s => ({ ...s, [p.id]:'testing' }))
    setStatuses(s => ({ ...s, [p.id]: undefined }))
    await invoke('send_to_python', {
      cmd: {
        cmd: 'test_llm',
        provider_id: p.id,
        provider: { base_url: p.baseUrl, api_key: p.apiKey, model: p.model },
        proxy: buildProxy(),
      },
    })
    // Safety: clear "testing" if Python never replies within 30s
    setTimeout(() => setTesting(s => s[p.id] === 'testing' ? { ...s, [p.id]: 'idle' } : s), 30000)
  }

  return (
    <div>
      <div className="pref-section">
        <div className="pref-sec-title">{t.llmConfig}</div>
        {providers.map(p => {
          const meta = PROVIDER_META[p.id] ?? { logo:'??', color:'#888' }
          const isOpen   = openId === p.id
          const isActive = activeLLMId === p.id
          const hasKey   = p.apiKey.length > 0
          return (
            <div key={p.id} className={`llm-card ${isActive?'sel':''}`}>
              <div className="llm-card-header" onClick={() => setOpenId(isOpen ? null : p.id)}>
                <div className="llm-left">
                  <div className="llm-logo" style={{ background:meta.color, color:'#fff' }}>{meta.logo}</div>
                  <span className="llm-name">{p.name}</span>
                </div>
                <div className="llm-right">
                  {isActive  && <span className="llm-badge using">{t.llmUsing}</span>}
                  {!isActive && hasKey  && <span className="llm-badge ok">{t.llmConfigured}</span>}
                  {!isActive && !hasKey && <span className="llm-badge">{t.llmNotConfigured}</span>}
                  <span className={`llm-chevron ${isOpen?'open':''}`}>▶</span>
                </div>
              </div>
              {isOpen && (
                <div className="llm-body open">
                  <div className="pfield">
                    <label>{t.llmBaseUrl}</label>
                    <input type="text" value={p.baseUrl}
                      onChange={e => updateProvider(p.id,{baseUrl:e.target.value})} />
                  </div>
                  <div className="pfield">
                    <label>{t.llmApiKey}</label>
                    <input type="password" value={p.apiKey} placeholder="sk-…"
                      onChange={e => updateProvider(p.id,{apiKey:e.target.value})} />
                  </div>
                  <div className="pfield">
                    <label>{t.llmModel}</label>
                    <input type="text" value={p.model}
                      onChange={e => updateProvider(p.id,{model:e.target.value})} />
                  </div>
                  <div className="llm-actions">
                    <button className="test-btn"
                      onClick={() => handleTest(p)}
                      disabled={!hasKey || testing[p.id]==='testing'}>
                      {testing[p.id]==='testing' ? t.llmTesting : t.llmTest}
                    </button>
                    {!isActive && (
                      <button className="use-btn" onClick={() => setActiveLLM(p.id)} disabled={!hasKey}>
                        {t.llmSetActive}
                      </button>
                    )}
                    {isActive && <button className="use-btn active">✓ {t.llmUsing}</button>}
                    {/* Inline connection status — flex-wraps onto a new line
                        when the row gets tight so the buttons never get squished. */}
                    {statuses[p.id]?.kind === 'ok' && (
                      <span className="conn-status ok"
                            title={t.llmConnOk((statuses[p.id] as any).latency)}>
                        <span className="dot" />
                        {t.llmConnOk((statuses[p.id] as any).latency)}
                      </span>
                    )}
                    {statuses[p.id]?.kind === 'error' && (
                      <span className="conn-status fail"
                            title={(statuses[p.id] as any).msg}>
                        <span className="dot" />
                        {t.llmConnError((statuses[p.id] as any).msg)}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="pref-section">
        <div className="pref-sec-title">{t.llmBatchSection}</div>
        <div className="pfield">
          <label>{t.llmBatchSize}</label>
          <input type="number" value={batchSize} min={20} max={300} style={{ width:80 }}
            onChange={e => setBatchSize(Math.max(20,Math.min(300,+e.target.value)))} />
        </div>
        <p style={{ fontSize:10, color:'var(--text3)', marginTop:4 }}>{t.llmBatchHint}</p>
      </div>
    </div>
  )
}

// ── Whisper Tab ───────────────────────────────────────────────────

function WhisperTab() {
  const { t } = useLocale()
  const { modelDir, setModelDir } = useAppStore()

  async function browse() {
    const dir: string|null = await invoke('pick_directory')
    if (dir) setModelDir(dir)
  }

  return (
    <div>
      <div className="pref-section">
        <div className="pref-sec-title">{t.whisperDirSection}</div>
        <p style={{ fontSize:11, color:'var(--text3)', lineHeight:1.7, marginBottom:10 }}>
          {t.whisperDirDesc}
        </p>
        <div className="pfield">
          <label>{t.whisperDirLabel}</label>
          <div className="path-row">
            <input type="text" value={modelDir} onChange={e => setModelDir(e.target.value)} />
            <button className="browse-btn" onClick={browse}>{t.browse}</button>
          </div>
        </div>
      </div>
      <div className="pref-section">
        <div className="pref-sec-title">{t.whisperDownloadSection}</div>
        <div className="pfield">
          <label>{t.whisperConcurrent}</label>
          <input type="number" defaultValue={1} min={1} max={4} style={{ width:60 }} />
        </div>
        <p style={{ fontSize:10, color:'var(--text3)', marginTop:4 }}>{t.whisperConcurrentHint}</p>
      </div>
    </div>
  )
}

// ── Proxy Tab ─────────────────────────────────────────────────────

type ProxyStatus = { kind: 'ok'; latency: number } | { kind: 'error'; msg: string }

function ProxyTab() {
  const { t } = useLocale()
  const { proxy, updateProxy } = useAppStore()
  const [testing, setTesting] = useState(false)
  const [status, setStatus]   = useState<ProxyStatus | null>(null)

  useEffect(() => {
    let unlisten: (() => void) | undefined
    listen<any>('python:proxy_test_result', e => {
      setTesting(false)
      if (e.payload?.ok) {
        setStatus({ kind: 'ok', latency: e.payload.latency_ms ?? 0 })
      } else {
        const raw = String(e.payload?.error ?? '')
        const short = raw.replace(/\s+/g, ' ').slice(0, 80)
        setStatus({ kind: 'error', msg: short || 'unknown error' })
      }
    }).then(u => { unlisten = u })
    return () => { unlisten?.() }
  }, [])

  async function handleProxyTest() {
    const proxyStr = !proxy.enabled
      ? null
      : proxy.mode === 'system'
        ? 'system'
        : `${proxy.protocol.toLowerCase()}://${proxy.host}:${proxy.port}`
    setTesting(true)
    setStatus(null)
    await invoke('send_to_python', {
      cmd: { cmd: 'test_proxy', proxy: proxyStr },
    })
    setTimeout(() => setTesting(t => t), 30000)  // safety: 30s timeout (no-op if already done)
  }

  return (
    <div>
      <div className="pref-section">
        <div className="pref-sec-title">{t.proxySection}</div>
        <p style={{ fontSize:11, color:'var(--text3)', lineHeight:1.7, marginBottom:10 }}>
          {t.proxyDesc}
        </p>
        <div style={{ marginBottom:10 }}>
          <div className="toggle-row">
            <span className="toggle-label">{t.proxyEnable}</span>
            <div className={`toggle ${proxy.enabled?'on':''}`}
              onClick={() => updateProxy({ enabled:!proxy.enabled })} />
          </div>
        </div>
        <div style={{ opacity:proxy.enabled?1:0.35, pointerEvents:proxy.enabled?'auto':'none' }}>
          <div className="proxy-chip-row">
            {(['system','custom'] as const).map(m => (
              <div key={m} className={`proxy-chip ${proxy.mode===m?'sel':''}`}
                onClick={() => updateProxy({ mode:m })}>
                {m==='system' ? t.proxyModeSystem : t.proxyModeCustom}
              </div>
            ))}
          </div>
          {proxy.mode==='custom' && (
            <div>
              <div className="pfield">
                <label>{t.proxyProtocol}</label>
                <select value={proxy.protocol}
                  style={{ width:'100%', background:'var(--app-bg)', border:'1px solid var(--border)', color:'var(--text1)', padding:'4px 8px', borderRadius:5, fontFamily:'inherit', fontSize:11, outline:'none' }}
                  onChange={e => updateProxy({ protocol:e.target.value as any })}>
                  <option>HTTP</option><option>HTTPS</option><option>SOCKS5</option>
                </select>
              </div>
              <div className="pfield">
                <label>{t.proxyHost}</label>
                <input type="text" value={proxy.host} placeholder="127.0.0.1"
                  onChange={e => updateProxy({ host:e.target.value })} />
              </div>
              <div className="pfield">
                <label>{t.proxyPort}</label>
                <input type="text" value={proxy.port} placeholder="7890"
                  onChange={e => updateProxy({ port:e.target.value })} />
              </div>
            </div>
          )}
          <div style={{ marginTop:10, display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <button className="test-btn"
              onClick={handleProxyTest} disabled={testing}>
              {testing ? t.proxyTesting : t.proxyTest}
            </button>
            {status?.kind === 'ok' && (
              <span className="conn-status ok" title={t.proxyOk(status.latency)}>
                <span className="dot" />
                {t.proxyOk(status.latency)}
              </span>
            )}
            {status?.kind === 'error' && (
              <span className="conn-status fail" title={status.msg}>
                <span className="dot" />
                {t.proxyFail(status.msg)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Appearance Tab ────────────────────────────────────────────────

function AppearanceTab() {
  const { t } = useLocale()
  const { theme, setTheme, locale, setLocale } = useAppStore()

  const themeHints: Record<string,string> = {
    dark: t.currentThemeDark,
    light: t.currentThemeLight,
    system: t.currentThemeSystem,
  }

  return (
    <div>
      {/* Theme */}
      <div className="pref-section">
        <div className="pref-sec-title">{t.appearanceTheme}</div>
        <p style={{ fontSize:11, color:'var(--text2)', marginBottom:8 }}>{t.appearanceThemeDesc}</p>
        <div className="theme-chips">
          {(['light','dark','system'] as const).map(th => (
            <div key={th} className={`theme-chip ${theme===th?'sel':''}`} onClick={() => setTheme(th)}>
              {th==='light' ? t.themeLight : th==='dark' ? t.themeDark : t.themeSystem}
            </div>
          ))}
        </div>
        <p style={{ fontSize:10, color:'var(--text3)', marginTop:8 }}>{themeHints[theme]}</p>
      </div>

      {/* Interface Language */}
      <div className="pref-section">
        <div className="pref-sec-title">{t.appearanceLanguage}</div>
        <div className="theme-chips" style={{ marginTop:8 }}>
          {(['zh','en'] as const).map(l => (
            <div key={l} className={`theme-chip ${locale===l?'sel':''}`} onClick={() => setLocale(l)}>
              {l==='zh' ? '中文' : 'English'}
            </div>
          ))}
        </div>
        <p style={{ fontSize:10, color:'var(--text3)', marginTop:8 }}>
          {locale==='zh' ? '当前：中文界面' : 'Current: English interface'}
        </p>
      </div>
    </div>
  )
}
