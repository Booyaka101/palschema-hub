#!/usr/bin/env bash
# publish.sh — one-shot publish of palschema-hub to GitHub (public) + enable Pages.
# Safe to re-run. Requires: gh (authenticated), git.
# Usage:  bash scripts/publish.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# Identity from the authenticated gh account, using a privacy-preserving noreply email.
read -r ID LOGIN < <(gh api user --jq '"\(.id) \(.login)"')
REPO="palschema-hub"
echo "Publishing $REPO as $LOGIN (id $ID)"

if [ ! -d .git ]; then
  git init -q
  git branch -M main
fi
git config user.name "$LOGIN"
git config user.email "${ID}+${LOGIN}@users.noreply.github.com"

git add -A
if ! git diff --cached --quiet; then
  git commit -q \
    -m "Initial commit: palschema-hub — Palworld PalSchema schema registry" \
    -m "Public registry of JSON Schemas for Palworld PalSchema mods, a GitHub Pages schema browser, and the palschema-validate CLI (ajv strict). 30 moddable DataTables (v1.0) derived from real game data (blaynem/paldex): field names authoritative, types inferred. Official PalSchema generator output can supersede in place." \
    -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
fi

# Create the repo if it doesn't exist yet, then push.
if gh repo view "$LOGIN/$REPO" >/dev/null 2>&1; then
  echo "Repo exists — pushing."
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$LOGIN/$REPO.git"
  git push -u origin main
else
  gh repo create "$REPO" --public --source=. --remote=origin --push \
    --description "Browsable JSON Schema registry + validator CLI for Palworld PalSchema mods."
fi

# Enable GitHub Pages from main / root (ignore error if already enabled).
gh api -X POST "repos/$LOGIN/$REPO/pages" \
  -f "source[branch]=main" -f "source[path]=/" >/dev/null 2>&1 \
  && echo "Pages enabled." || echo "Pages: already enabled or will need a moment (Settings → Pages)."

echo
echo "Done."
echo "  Repo:  https://github.com/$LOGIN/$REPO"
echo "  Pages: https://$LOGIN.github.io/$REPO/   (first build takes ~1 min)"
echo
echo "If your \$id URLs must match the repo owner and you used a different account,"
echo "run: PALSCHEMA_OWNER=$LOGIN npm run seed && git commit -am 'retarget \$id' && git push"
