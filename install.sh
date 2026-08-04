#!/usr/bin/env bash
# install.sh —— 把 vision skill 安装到本机检测到的工具目录（macOS/Linux）
# 只复制文件，不修改任何现有配置。用法: ./install.sh
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
HOME_DIR="${HOME:-$HOME}"

install_to() {
  local dir="$1"
  mkdir -p "$dir"
  cp "$SRC/SKILL.md"   "$dir/SKILL.md"
  cp "$SRC/vision.mjs" "$dir/vision.mjs"
  echo "[OK] installed -> $dir"
}

count=0

# Reasonix 全局（常见位置：~/.config/reasonix/skills 或 ~/.local/share/reasonix/skills）
for base in "$HOME_DIR/.config/reasonix/skills" "$HOME_DIR/.local/share/reasonix/skills" "$HOME_DIR/.reasonix/skills"; do
  if [ -d "$base" ]; then install_to "$base/vision"; count=$((count+1)); fi
done

# opencode 全局
if [ -d "$HOME_DIR/.config/opencode" ]; then install_to "$HOME_DIR/.config/opencode/skills/vision"; count=$((count+1)); fi

# Codex 用户级
install_to "$HOME_DIR/.agents/skills/vision"; count=$((count+1))

if [ "$count" -eq 0 ]; then
  echo "[!] 未找到可安装的目标目录，请手动复制 SKILL.md + vision.mjs 到工具的 skills 目录"
else
  echo "完成：共安装到 $count 个位置。重启对应工具后生效。"
fi
