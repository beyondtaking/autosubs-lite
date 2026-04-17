#!/usr/bin/env bash
# bump_version.sh — 一键更新所有文件中的版本号
#
# 用法：
#   ./scripts/bump_version.sh 0.1.2
#
# 修改 5 处：package.json / tauri.conf.json / Cargo.toml / App.tsx / README.md
# 完成后请手动更新 CHANGELOG.md，然后 commit + tag。

set -euo pipefail

NEW="${1:-}"
if [ -z "$NEW" ]; then
  echo "用法: $0 NEW_VERSION   (例: $0 0.1.2)"
  exit 1
fi

# 从 package.json 读取当前版本
OLD=$(grep -m1 '"version"' package.json | sed -E 's/.*"([0-9]+\.[0-9]+\.[0-9]+)".*/\1/')

if [ -z "$OLD" ]; then
  echo "错误：无法从 package.json 读取当前版本"
  exit 1
fi

if [ "$OLD" = "$NEW" ]; then
  echo "版本号已经是 $NEW，无需修改"
  exit 0
fi

echo "版本号：$OLD → $NEW"

# macOS sed 需要 -i ''；GNU sed 用 -i（用 OSTYPE 区分）
SED_INPLACE=(-i '')
if [[ "${OSTYPE:-}" == "linux"* ]]; then
  SED_INPLACE=(-i)
fi

sed "${SED_INPLACE[@]}" \
  "s/\"version\": \"${OLD}\"/\"version\": \"${NEW}\"/" package.json

sed "${SED_INPLACE[@]}" \
  "s/\"version\": \"${OLD}\"/\"version\": \"${NEW}\"/" src-tauri/tauri.conf.json

sed "${SED_INPLACE[@]}" \
  "s/^version = \"${OLD}\"/version = \"${NEW}\"/" src-tauri/Cargo.toml

sed "${SED_INPLACE[@]}" \
  "s/v${OLD}<\/span>/v${NEW}<\/span>/" src/App.tsx

sed "${SED_INPLACE[@]}" \
  "s/_${OLD}_aarch64/_${NEW}_aarch64/g" README.md

echo ""
echo "✅ 已更新 5 处文件中的版本号：$OLD → $NEW"
echo ""
echo "下一步："
echo "  1. 手动更新 CHANGELOG.md（把 [Unreleased] 下的内容移到 [${NEW}] 节）"
echo "  2. npm run tauri build"
echo "  3. git add -A && git commit -m \"chore: release v${NEW}\""
echo "  4. git tag v${NEW} && git push && git push --tags"
echo "  5. 在 GitHub 创建 Release，上传 DMG / MSI"
