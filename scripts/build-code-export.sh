#!/usr/bin/env bash
# Build a single Markdown export for code review.
# Output: $OUT (passed as $1) — defaults to /c/Users/aksha/OneDrive/Desktop/CT-HUB-CODE-EXPORT.md
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-/c/Users/aksha/OneDrive/Desktop/CT-HUB-CODE-EXPORT.md}"

# Directories we never descend into
EXCLUDE_DIRS=(node_modules .next .git .vercel .turbo dist build coverage out .cache .vscode .idea)

# Files we never include (lock files, env, binaries, secrets)
EXCLUDE_PATTERNS=(
  '*/package-lock.json' '*/pnpm-lock.yaml' '*/yarn.lock' '*/bun.lockb'
  '*/.env' '*/.env.*'
  '*/next-env.d.ts'
)

# Extensions we consider "source" — everything else (images, fonts, binaries) is skipped
SOURCE_EXTS_RE='\.(ts|tsx|js|jsx|mjs|cjs|json|md|mdx|css|scss|sql|html|yml|yaml|toml|sh|ps1|env\.example)$'

# Build the find prune expression
prune_expr=()
for d in "${EXCLUDE_DIRS[@]}"; do
  prune_expr+=( -name "$d" -o )
done
# strip trailing -o
unset 'prune_expr[${#prune_expr[@]}-1]'

# ───────────────────────────────────────────────────────────────────────────────
# Step 1 — Project tree
# ───────────────────────────────────────────────────────────────────────────────
tree_block() {
  # POSIX-friendly tree using find + indentation. Skips excluded dirs +
  # any path matching the per-file exclude patterns (lock files, .env*).
  ( cd "$ROOT" && find . \( "${prune_expr[@]}" \) -prune -o -print | sort \
    | while IFS= read -r p; do
        skip=0
        case "$p" in
          ./.env|./.env.*|*/.env|*/.env.*) skip=1 ;;
          ./package-lock.json|./pnpm-lock.yaml|./yarn.lock|./bun.lockb) skip=1 ;;
          */package-lock.json|*/pnpm-lock.yaml|*/yarn.lock|*/bun.lockb) skip=1 ;;
        esac
        [ $skip -eq 0 ] && echo "$p"
      done \
    | awk '
      BEGIN { FS="/" }
      {
        if ($0 == ".") next
        depth = NF - 1
        name = $NF
        indent = ""
        for (i = 0; i < depth - 1; i++) indent = indent "  "
        if (depth == 1) print name
        else            print indent "└─ " name
      }
    '
  )
}

# ───────────────────────────────────────────────────────────────────────────────
# Step 2 — Collect source files
# ───────────────────────────────────────────────────────────────────────────────
collect_files() {
  ( cd "$ROOT" && find . \( "${prune_expr[@]}" \) -prune -o -type f -print \
    | grep -Ei "$SOURCE_EXTS_RE" \
    | while read -r f; do
        skip=0
        for pat in "${EXCLUDE_PATTERNS[@]}"; do
          case "$f" in $pat) skip=1; break;; esac
        done
        [ $skip -eq 0 ] && echo "$f"
      done \
    | sort
  )
}

# ───────────────────────────────────────────────────────────────────────────────
# Step 3 — Redaction filter
# Looks for likely secret patterns and replaces the value (not the key) with REDACTED.
# ───────────────────────────────────────────────────────────────────────────────
redact() {
  # Read the file, redact, write to stdout.
  # We use perl for multi-pattern in-line subs (works on git-bash).
  perl -pe '
    # 1) JWTs (eyJ...) — common Supabase anon/service keys
    s/eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}/REDACTED/g;

    # 2) sk_/rk_/re_/whsec_/ghp_/SG\. prefixed keys (Stripe, Resend, GitHub, SendGrid, etc.)
    s/\b(sk|rk|re|whsec|ghp|gho|ghu|ghs|pk_live|sk_live|sk_test)_[A-Za-z0-9_\-]{16,}/REDACTED/g;
    s/\bSG\.[A-Za-z0-9_\-]{20,}/REDACTED/g;

    # 3) Generic high-entropy assignments: API_KEY = "...", SECRET = "...", TOKEN = "..."
    s/((?:api[_-]?key|secret|token|password|passwd|client[_-]?secret|service[_-]?role[_-]?key|anon[_-]?key|vapid[_-]?private[_-]?key)\s*[:=]\s*)(["\x27])([^"\x27]{8,})\2/$1$2REDACTED$2/gi;
  '
}

# ───────────────────────────────────────────────────────────────────────────────
# Build the output
# ───────────────────────────────────────────────────────────────────────────────
mkdir -p "$(dirname "$OUT")"
{
  echo "# CT HUB — Code Export"
  echo ""
  echo "_Generated: $(date '+%Y-%m-%d %H:%M:%S %Z')_  "
  echo "_Repo: srmd-hub_  "
  echo "_Live: https://ct-hub.vercel.app_"
  echo ""
  echo "Excludes: \`node_modules\`, \`.next\`, \`.git\`, \`.vercel\`, lock files, \`.env*\`, images, build artifacts."
  echo "Any matched secret patterns have been replaced with \`REDACTED\`."
  echo ""
  echo "---"
  echo ""
  echo "## Project tree"
  echo ""
  echo '```'
  tree_block
  echo '```'
  echo ""
  echo "---"
  echo ""
  echo "## Files"
  echo ""
  # Iterate files
  while IFS= read -r f; do
    rel="${f#./}"
    ext="${rel##*.}"
    # Tag the code fence with the language so syntax highlighting works
    case "$ext" in
      ts|tsx|js|jsx|mjs|cjs) lang="ts" ;;
      json)                  lang="json" ;;
      md|mdx)                lang="md" ;;
      css|scss)              lang="css" ;;
      sql)                   lang="sql" ;;
      html)                  lang="html" ;;
      yml|yaml)              lang="yaml" ;;
      toml)                  lang="toml" ;;
      sh)                    lang="bash" ;;
      ps1)                   lang="powershell" ;;
      *)                     lang="" ;;
    esac
    echo "### \`$rel\`"
    echo ""
    echo "\`\`\`$lang"
    redact < "$ROOT/$f"
    # Trailing newline guarantee before closing fence
    echo ""
    echo "\`\`\`"
    echo ""
  done < <(collect_files)

  echo "---"
  echo ""
  echo "_End of export._"
} > "$OUT"

echo "Wrote $OUT"
echo "Size: $(wc -c < "$OUT") bytes, $(grep -c '^### `' "$OUT") files included"
