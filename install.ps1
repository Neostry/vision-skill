# install.ps1 —— 把 vision skill 安装到本机检测到的工具目录
# 只复制文件，不修改任何现有配置。用法: ./install.ps1
$ErrorActionPreference = "Stop"

$src = $PSScriptRoot
$targets = @()

# Reasonix（全局）
$rx = Join-Path $env:APPDATA "reasonix\skills\vision"
if ($env:APPDATA) { $targets += $rx }

# opencode（全局）
$oc = Join-Path $env:USERPROFILE ".config\opencode\skills\vision"
if ($env:USERPROFILE) { $targets += $oc }

# Codex 用户级（~/.agents/skills）
$cx = Join-Path $env:USERPROFILE ".agents\skills\vision"
if ($env:USERPROFILE) { $targets += $cx }

$installed = 0
foreach ($t in $targets) {
  New-Item -ItemType Directory -Path $t -Force | Out-Null
  Copy-Item (Join-Path $src "SKILL.md")   (Join-Path $t "SKILL.md")   -Force
  Copy-Item (Join-Path $src "vision.mjs") (Join-Path $t "vision.mjs") -Force
  Write-Host "[OK] installed -> $t"
  $installed++
}

if ($installed -eq 0) {
  Write-Host "[!] 未找到可安装的目标目录，请手动复制 SKILL.md + vision.mjs 到工具的 skills 目录"
} else {
  Write-Host "完成：共安装到 $installed 个位置。重启对应工具后生效。"
}
