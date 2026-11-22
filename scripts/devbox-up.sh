#!/usr/bin/env bash
# Restores Jude's dev tools after a reset and starts T3 + ngrok. Safe to re-run.
set -u
export PATH="$HOME/.local/bin:$PATH"
mkdir -p "$HOME/.local/bin"
URL="https://donation-certify-siding.ngrok-free.dev"

command -v t3 >/dev/null && command -v codex >/dev/null || \
  npm install -g --prefix "$HOME/.local" t3 @openai/codex
if ! command -v ngrok >/dev/null; then
  curl -sSL https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz -o /tmp/ngrok.tgz \
    && tar -xzf /tmp/ngrok.tgz -C "$HOME/.local/bin"
fi
CA=$(ls -d "$HOME"/.local/share/cursor-agent/versions/*/ 2>/dev/null | sort | tail -1)
[ -n "$CA" ] && ln -sf "${CA}cursor-agent" "$HOME/.local/bin/cursor-agent" && ln -sf "$HOME/.local/bin/cursor-agent" "$HOME/.local/bin/agent"
grep -q 'local/bin' "$HOME/.bashrc" || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"

if ! curl -s -o /dev/null --max-time 5 http://127.0.0.1:3773/; then
  tmux kill-session -t t3code 2>/dev/null
  setsid tmux new -d -s t3code -n serve "export PATH=$HOME/.local/bin:\$PATH; cd /workspace; t3 serve /workspace 2>&1 | tee /workspace/t3-serve.log; sleep 3600"
  sleep 6
fi
if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$URL/")" != "200" ]; then
  tmux kill-window -t t3code:ngrok 2>/dev/null
  setsid tmux new-window -t t3code -n ngrok "export PATH=$HOME/.local/bin:\$PATH; ngrok http 127.0.0.1:3773 --url $URL --log /workspace/ngrok.log; sleep 3600"
  sleep 8
fi
echo "t3: $(t3 --version 2>&1) | codex: $(codex --version 2>&1) | ngrok: $(ngrok version 2>&1)"
echo "local: $(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3773/)  public: $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 $URL/)"
