#!/usr/bin/env bash
# Idempotent EC2 bootstrap: ensure ~/workspace exists and T3 Code runs with
# T3 Connect so the phone app / app.t3.codes can reach this host.
# Safe to re-run. Never deletes or overwrites existing repos/files.
#
# Optional: CW_REF (default main) — git ref for raw URL fetches and fresh clone.
#
# Usage (after GitHub SSH works):
#   CW_REF=main bash <(curl -fsSL "https://raw.githubusercontent.com/judigot/cloud-workspace/${CW_REF:-main}/scripts/ec2-t3-bootstrap.sh")
#   # or, from a checkout:
#   ~/workspace/scripts/ec2-t3-bootstrap.sh

set -euo pipefail

readonly CW_REF="${CW_REF:-main}"
readonly REPO_SSH="git@github.com:judigot/cloud-workspace.git"
readonly REPO_HTTPS="https://github.com/judigot/cloud-workspace.git"
readonly REPO_HTTPS_BARE="https://github.com/judigot/cloud-workspace"
readonly WORKSPACE_DIR="${HOME}/workspace"
readonly T3_UNIT="t3code.service"
readonly TMUX_SESSION="t3code"
readonly FALLBACK_UNIT_DIR="${HOME}/.config/systemd/user"
readonly FALLBACK_UNIT_PATH="${FALLBACK_UNIT_DIR}/t3code-fallback.service"

main() {
  printf '%s\n' "CW_REF=${CW_REF}"
  ensure_path
  ensure_workspace
  ensure_t3_cli
  enable_user_linger
  start_t3_access
  print_status
  print_next_steps
}

# Keep interactive prompts on the real terminal (curl|sh / process-sub callers
# may leave stdin closed or pointed at the script body).
run_with_tty() {
  if [[ -r /dev/tty ]]; then
    "$@" </dev/tty
  else
    "$@"
  fi
}

ensure_path() {
  mkdir -p "${HOME}/.local/bin"
  PATH="${HOME}/.local/bin:${PATH}"
  export PATH

  if [[ -f "${HOME}/.bashrc" ]]; then
    if ! awk '/\.local\/bin/ { found=1; exit } END { exit !found }' "${HOME}/.bashrc"; then
      printf '\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "${HOME}/.bashrc"
    fi
  fi
}

ensure_workspace() {
  if [[ -d "${WORKSPACE_DIR}/.git" ]]; then
    case "$(git -C "${WORKSPACE_DIR}" remote get-url origin 2>/dev/null || true)" in
      "${REPO_SSH}"|"${REPO_HTTPS}"|"${REPO_HTTPS_BARE}")
        printf '%s\n' "Existing cloud-workspace checkout preserved at ${WORKSPACE_DIR}."
        ;;
      *)
        printf '%s\n' "Existing ~/workspace points to another repository; stopping." >&2
        exit 1
        ;;
    esac
  elif [[ -e "${WORKSPACE_DIR}" ]]; then
    printf '%s\n' "Existing ~/workspace is not a Git checkout; stopping." >&2
    exit 1
  else
    printf '%s\n' "Checking GitHub SSH access..."
    git ls-remote "${REPO_SSH}" "refs/heads/${CW_REF}" "refs/tags/${CW_REF}" HEAD >/dev/null
    printf '%s\n' "Cloning cloud-workspace (${CW_REF}) into ${WORKSPACE_DIR}..."
    git clone --branch "${CW_REF}" "${REPO_SSH}" "${WORKSPACE_DIR}"
  fi

  cd "${WORKSPACE_DIR}" || exit 1
}

ensure_t3_cli() {
  if ! command -v t3 >/dev/null 2>&1; then
    printf '%s\n' "Installing T3 Code CLI..."
    # Official installer is non-interactive; process substitution keeps stdin free.
    bash <(curl -fsSL https://t3.codes/install.sh)
  fi

  PATH="${HOME}/.local/bin:${PATH}"
  export PATH
  hash -r 2>/dev/null || true

  if ! command -v t3 >/dev/null 2>&1; then
    printf '%s\n' "t3 not found on PATH after install (expected ${HOME}/.local/bin)." >&2
    exit 1
  fi

  printf '%s\n' "t3: $(t3 --version 2>&1)"
}

enable_user_linger() {
  # User systemd units stop on logout unless linger is on. t3 up/service also
  # try this; do it early so fallback units survive SSH disconnect too.
  if ! command -v loginctl >/dev/null 2>&1; then
    return 0
  fi
  if ! loginctl show-user "${USER}" -p Linger >/dev/null 2>&1; then
    return 0
  fi

  local linger
  linger="$(loginctl show-user "${USER}" -p Linger 2>/dev/null | awk -F= 'NF==2 { print $2; exit }')"
  if [[ "${linger}" == "yes" ]]; then
    return 0
  fi

  if loginctl enable-linger "${USER}" 2>/dev/null; then
    printf '%s\n' "Enabled systemd linger for ${USER}."
    return 0
  fi

  if command -v sudo >/dev/null 2>&1 && sudo -n loginctl enable-linger "${USER}" 2>/dev/null; then
    printf '%s\n' "Enabled systemd linger for ${USER} (via sudo)."
    return 0
  fi

  printf '%s\n' "Could not enable linger; user services may stop on logout. Run: sudo loginctl enable-linger ${USER}" >&2
}

t3_supports() {
  # $1 = subcommand name shown in `t3 --help` (e.g. up, service, connect)
  t3 --help 2>/dev/null | awk -v cmd="$1" '
    $1 == cmd { found=1; exit }
    END { exit !found }
  '
}

start_t3_access() {
  cd "${WORKSPACE_DIR}" || exit 1

  printf '%s\n' ""
  printf '%s\n' ">>> INTERACTIVE (if prompted): T3 Connect sign-in / pairing"
  printf '%s\n' "    Open the URL or enter the code on any device, then continue in the T3 phone app / https://app.t3.codes"
  printf '%s\n' ""

  if t3_supports up; then
    # Verified on t3 v0.1.11: installs background service + T3 Connect, disables LAN.
    # --headless: URL/code sign-in (auto over SSH; explicit for clarity).
    run_with_tty t3 up --connect --no-lan --headless
    return 0
  fi

  if t3_supports service; then
    run_with_tty t3 service install
    if t3_supports connect; then
      run_with_tty t3 connect --headless
    fi
    return 0
  fi

  printf '%s\n' "This t3 build has no \`t3 up\` / \`t3 service\` (common on older Termux builds)." >&2
  printf '%s\n' "Falling back to tmux + a user systemd unit around \`t3 serve\`." >&2
  start_t3_fallback_serve
}

start_t3_fallback_serve() {
  if ! command -v tmux >/dev/null 2>&1; then
    if command -v sudo >/dev/null 2>&1; then
      sudo apt-get update -y
      sudo DEBIAN_FRONTEND=noninteractive apt-get install -y tmux
    else
      printf '%s\n' "tmux is required for the fallback serve path." >&2
      exit 1
    fi
  fi

  if ! tmux has-session -t "${TMUX_SESSION}" 2>/dev/null; then
    tmux new-session -d -s "${TMUX_SESSION}" -n serve \
      "export PATH=\"${HOME}/.local/bin:\$PATH\"; cd \"${WORKSPACE_DIR}\"; t3 serve \"${WORKSPACE_DIR}\"; sleep 3600"
    printf '%s\n' "Started tmux session '${TMUX_SESSION}' running t3 serve."
  else
    printf '%s\n' "tmux session '${TMUX_SESSION}' already exists; leaving it alone."
  fi

  if command -v systemctl >/dev/null 2>&1 && systemctl --user status >/dev/null 2>&1; then
    mkdir -p "${FALLBACK_UNIT_DIR}"
    if [[ ! -f "${FALLBACK_UNIT_PATH}" ]]; then
      cat > "${FALLBACK_UNIT_PATH}" <<EOF
[Unit]
Description=T3 Code fallback (t3 serve via tmux)
After=default.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'tmux has-session -t ${TMUX_SESSION} 2>/dev/null || tmux new-session -d -s ${TMUX_SESSION} -n serve "export PATH=${HOME}/.local/bin:\$PATH; cd ${WORKSPACE_DIR}; t3 serve ${WORKSPACE_DIR}; sleep 3600"'
ExecStop=/usr/bin/tmux kill-session -t ${TMUX_SESSION}

[Install]
WantedBy=default.target
EOF
      systemctl --user daemon-reload
      systemctl --user enable --now t3code-fallback.service
      printf '%s\n' "Installed user unit t3code-fallback.service (starts tmux t3 serve on login/boot when linger is on)."
    else
      printf '%s\n' "Existing ${FALLBACK_UNIT_PATH} preserved."
      systemctl --user enable --now t3code-fallback.service 2>/dev/null || true
    fi
  fi

  if t3_supports connect; then
    run_with_tty t3 connect --headless || true
  fi
}

print_status() {
  printf '%s\n' ""
  printf '%s\n' "── T3 status ──"
  if t3_supports status; then
    t3 status || true
  fi
  if t3_supports service; then
    t3 service status || true
  fi
  if t3_supports connect; then
    t3 connect status || true
  fi
}

print_next_steps() {
  cat <<EOF

════════════════════════════════════════════════════════════
Next steps
════════════════════════════════════════════════════════════

1. Finish T3 Connect sign-in if a URL/code is still waiting.
2. On your phone: open the T3 app or https://app.t3.codes and
   select this machine (pair if prompted).
3. Optional pairing QR (server must be running):
     t3 pair

Check / reattach
  t3 status
  t3 connect status
  t3 service status
  systemctl --user status ${T3_UNIT}

Restart
  t3 service restart
  # fallback only:
  tmux attach -t ${TMUX_SESSION}
  systemctl --user restart t3code-fallback.service

Logs
  journalctl --user -u ${T3_UNIT} -n 80 --no-pager
  t3 doctor
  # fallback tmux serve:
  tmux capture-pane -t ${TMUX_SESSION}:serve -p | tail -n 80

Workspace: ${WORKSPACE_DIR}
CW_REF: ${CW_REF}
════════════════════════════════════════════════════════════
EOF
}

main "$@"
