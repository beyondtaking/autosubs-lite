// retryConfig.ts — build a start config for retrying specific file IDs

import { AppState } from '../stores/appStore'

export function buildRetryConfig(
  s: ReturnType<typeof import('../stores/appStore').useAppStore.getState>,
  fileIds: string[],
) {
  const p = s.providers.find(x => x.id === s.activeLLMId)
  const proxy = s.proxy.enabled
    ? s.proxy.mode === 'system' ? 'system'
    : `${s.proxy.protocol.toLowerCase()}://${s.proxy.host}:${s.proxy.port}`
    : null

  const targetFiles = s.files.filter(f => fileIds.includes(f.id))
  const explicitFiles = targetFiles.map(f => ({ path: f.path, is_subtitle: f.isSubtitle }))

  return {
    root_dir: null,   // retry always uses explicit file list, never task file
    files: explicitFiles,
    model: s.selectedModel,
    model_dir: s.modelDir,
    language: s.sourceLanguage === 'auto' ? null : s.sourceLanguage,
    generate_cn: s.generateCn,
    llm_provider: p ? { base_url: p.baseUrl, api_key: p.apiKey, model: p.model } : null,
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
    skip_existing_srt: false,  // retry must always re-process
    auto_save_task: s.autoSaveTask,
  }
}
