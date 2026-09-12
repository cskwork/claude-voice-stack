#!/usr/bin/env bash
# claude-voice-stack macOS bootstrap: Python voice stack + Node workspace.
# Idempotent. Never prints secrets. Exit non-zero on a missing requirement.
set -euo pipefail

STACK_HOME="${CLAUDE_VOICE_STACK_HOME:-$HOME/.claude-voice-stack}"
VENV="$STACK_HOME/venv-s2s"
S2S_SPEC="${S2S_SPEC:-speech-to-speech[supertonic]==1.0.0}"
PARAKEET_MODEL="${PARAKEET_MODEL:-mlx-community/parakeet-tdt-0.6b-v3}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SKIP_MODELS=0
for arg in "$@"; do
  case "$arg" in
    --skip-models) SKIP_MODELS=1 ;;
  esac
done

ok()   { printf '✓ %s\n' "$*"; }
warn() { printf '! %s\n' "$*"; }
die()  { printf '✗ %s\n' "$*" >&2; exit 1; }

echo "Checking system..."
[[ "$(uname -s)" == "Darwin" ]] || die "macOS required"
[[ "$(uname -m)" == "arm64" ]] || die "Apple Silicon (arm64) required"
ok "Apple Silicon, macOS $(sw_vers -productVersion)"

command -v node >/dev/null || die "Node.js not found (need >= 22.22)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$NODE_MAJOR" -ge 22 ]] || die "Node $(node -v) too old; need >= 22.22"
ok "Node $(node -v)"

PYTHON=""
for candidate in python3.12 python3.11 /opt/homebrew/bin/python3.12 /opt/homebrew/bin/python3.11 python3; do
  if command -v "$candidate" >/dev/null 2>&1; then
    if "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)'; then
      PYTHON="$(command -v "$candidate")"; break
    fi
  fi
done
[[ -n "$PYTHON" ]] || die "Python >= 3.10 not found (brew install python@3.12)"
ok "Python $("$PYTHON" -c 'import platform; print(platform.python_version())') ($PYTHON)"

if command -v claude >/dev/null 2>&1; then
  ok "Claude Code $(claude --version 2>/dev/null | head -1)"
  if claude auth status 2>/dev/null | grep -q '"loggedIn": *true'; then
    ok "Claude Code authenticated"
  else
    warn "Claude Code not logged in; run: claude"
  fi
else
  warn "Claude Code not found; install it before voice-agent start"
fi

echo
echo "Installing voice components..."
mkdir -p "$STACK_HOME/logs" "$STACK_HOME/run"
chmod 700 "$STACK_HOME"
if [[ ! -x "$VENV/bin/python" ]]; then
  "$PYTHON" -m venv "$VENV"
  ok "created $VENV"
else
  ok "venv exists: $VENV"
fi
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet "$S2S_SPEC"
ok "speech-to-speech $("$VENV/bin/pip" show speech-to-speech 2>/dev/null | awk '/^Version/{print $2}')"
ok "supertonic $("$VENV/bin/pip" show supertonic 2>/dev/null | awk '/^Version/{print $2}')"
"$VENV/bin/python" -c 'import speech_to_speech, supertonic, mlx_audio, sounddevice' || die "voice imports failed"

if [[ "$SKIP_MODELS" -eq 0 ]]; then
  "$VENV/bin/python" - "$PARAKEET_MODEL" <<'PY'
import sys
from huggingface_hub import snapshot_download
path = snapshot_download(sys.argv[1])
print(f"✓ Parakeet assets: {path}")
PY
  "$VENV/bin/supertonic" download >/dev/null 2>&1 && ok "Supertonic assets" || warn "Supertonic assets download skipped (downloads on first start)"
fi

echo
echo "Preparing Node workspace..."
(cd "$REPO_ROOT" && npm install --no-audit --no-fund >/dev/null 2>&1) && ok "npm install" || die "npm install failed"
if (cd "$REPO_ROOT" && npm run build >/dev/null 2>&1); then ok "WebUI build"; else warn "WebUI build failed; TUI still works"; fi

echo
ok "Bootstrap complete. Stack home: $STACK_HOME"
