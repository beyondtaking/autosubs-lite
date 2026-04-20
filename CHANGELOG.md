# Changelog

All notable changes to this project will be documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/zh-CN/) — `Added / Changed / Fixed / Removed`

## [Unreleased]

## [0.1.2] - 2026-04-18
### Fixed
- 字幕文件队列中存在同名文件（不同子目录）时，进度事件匹配到错误条目，导致处理顺序混乱、已完成条目重复触发
  - Backend 改为以绝对路径作为文件唯一标识符（原为 basename）
  - Frontend 匹配逻辑补充 `f.path === d.file` 优先精确匹配

## [0.1.1] - 2026-04-17
### Changed
- 中文字幕按**中文语义**重新切分，不再强制与英文 cue 一一对齐
  - 连续英文 cue 先合并成完整句，整句翻译后按中文标点重新切分
  - 时间戳按字符数比例在原时间段内分配

### Fixed
- 相邻 cue 翻译内容互相借用导致的重复（如 "试着完成它" 出现两次）

## [0.1.0] - 2026-04-16
### Added
- 字幕文件直接翻译模式（跳过 Whisper，读 .srt / .vtt → 翻译 → 输出 .cn.srt / .cn.vtt）
- "添加字幕文件" 按钮，支持递归扫描子文件夹，自动跳过 `.cn.*` 文件
- 输出命名保留原格式与文件名（`foo.en.srt → foo.cn.srt`，`foo.vtt → foo.cn.vtt`）
- 字幕文件在队列时，若未勾选「生成中文字幕」则禁用开始按钮并提示

### Changed
- "添加文件" 改名为 "添加视频文件"
- "添加文件夹" 改名为 "添加视频文件夹"
- "同时生成中文字幕" 改名为 "生成中文字幕"
- Anthropic Claude 支持 Messages API 自动切换（按 base_url 判断）

### Fixed
- （首发版本）
