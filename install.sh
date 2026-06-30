#!/bin/bash
# 高管职业照生成器 - Skill 安装脚本
# 从本地仓库目录复制安装（在仓库根目录运行 ./install.sh）

set -e

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"

# 自动检测安装平台
PLATFORM=""
if [ -d "$HOME/.claude/skills" ]; then
  SKILL_DIR="$HOME/.claude/skills/exec-headshot"
  PLATFORM="Claude Code"
elif [ -d "$HOME/.codex" ] || command -v codex &> /dev/null; then
  SKILL_DIR="$HOME/.codex/skills/exec-headshot-skill"
  PLATFORM="Codex"
elif [ -d "$HOME/.openclaw/skills" ]; then
  SKILL_DIR="$HOME/.openclaw/skills/exec-headshot"
  PLATFORM="OpenClaw"
else
  read -r -p "未检测到已知平台，请输入完整安装路径: " SKILL_DIR
  PLATFORM="Custom"
fi
echo "📍 安装到 $SKILL_DIR（$PLATFORM）"

# 检查 Node.js >= 18
if ! command -v node &> /dev/null; then
  echo "❌ 未检测到 Node.js（需要 >= v18）：https://nodejs.org/"
  exit 1
fi
NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "❌ Node.js 版本过低（当前 $(node -v)，需要 >= v18）"
  exit 1
fi
echo "✓ Node.js $(node -v)"

# 复制文件（排除 node_modules 和 git）
if [ -d "$SKILL_DIR" ]; then
  read -r -p "⚠️  Skill 已存在，是否覆盖更新？[y/N] " confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || { echo "已取消。"; exit 0; }
fi
mkdir -p "$SKILL_DIR"
rsync -a --delete \
  --exclude node_modules --exclude .git --exclude .DS_Store \
  "$SRC_DIR/" "$SKILL_DIR/"

# 安装依赖
echo "📦 安装依赖（sharp）..."
cd "$SKILL_DIR"
npm install --omit=dev --silent 2>/dev/null || npm install --production --silent || {
  echo "❌ 依赖安装失败。如果是 sharp 编译错误，尝试："
  echo "   cd $SKILL_DIR && npm install --omit=dev --ignore-scripts && npm rebuild sharp"
  exit 1
}
echo "✓ 依赖安装完成"

echo ""
echo "✅ 安装完成！重启 $PLATFORM 后，发一张照片并说「生成职业照」即可使用。"
echo "   已配置过 xhs-cover 的用户无需重新配置 API。"
