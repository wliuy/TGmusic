#!/usr/bin/env bash
# 删除 Pages 项目的所有 preview 部署，只保留 production。
# 当部署数超过 100 时，Cloudflare 控制台会拒绝删除整个项目，必须先清理部署。
#
# 用法：
#   ./scripts/delete-pages-deployments.sh <项目名> [并行数]
#
# 例：
#   ./scripts/delete-pages-deployments.sh tgmusic
#   ./scripts/delete-pages-deployments.sh tgmusic 10
set -euo pipefail

project="${1:?用法: $0 <项目名> [并行数]}"
parallel="${2:-5}"

command -v jq >/dev/null || { echo "缺少 jq，请先安装：brew install jq / apt install jq" >&2; exit 1; }

echo "读取 $project 的部署列表..."
deployments=$(npx --no-install wrangler pages deployment list --project-name "$project" --json)

total=$(jq 'length' <<<"$deployments")
prod_id=$(jq -r '[.[] | select(.Environment == "Production")][0].Id // empty' <<<"$deployments")

if [ -z "$prod_id" ]; then
    echo "没有找到 production 部署，已中止。" >&2
    echo "本脚本会保留 production 部署，因此需要它存在才能运行。" >&2
    exit 1
fi

to_delete=$(jq -r '.[] | select(.Environment != "Production") | .Id' <<<"$deployments")
count=$(printf '%s\n' "$to_delete" | grep -c . || true)

echo "共 $total 个部署，保留 production: $prod_id"

if [ "$count" -eq 0 ]; then
    echo "没有需要删除的 preview 部署，直接去控制台删项目即可。"
    exit 0
fi

echo "开始删除 $count 个 preview 部署（并行 $parallel）..."
failed=$(printf '%s\n' "$to_delete" | xargs -n1 -P "$parallel" -I{} \
    sh -c 'npx --no-install wrangler pages deployment delete "$1" --project-name "$2" --force >/dev/null 2>&1 || echo "$1"' _ {} "$project")

if [ -n "$failed" ]; then
    echo "以下部署删除失败，可重跑本脚本：" >&2
    printf '%s\n' "$failed" >&2
    exit 1
fi

echo "完成。现在去控制台删除 Pages 项目即可。"
