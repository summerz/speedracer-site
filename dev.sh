#!/usr/bin/env bash
# speedracer 단일 개발 진입점 — dev 서버(HMR)는 5678, 프로덕션 preview(npm run preview)는 5679 로 분리.
#
# 사용:
#   ./dev.sh            # 메뉴에서 골라 실행
#   ./dev.sh up         # 의존성 확인 → dev 서버를 백그라운드로 기동 (http://127.0.0.1:5678/)
#   ./dev.sh down       # 5678(dev)·5679(preview) 리스너 종료
#   ./dev.sh restart    # down → up
#   ./dev.sh status     # 5678(dev)·5679(preview) 상태
#   ./dev.sh logs       # dev 서버 로그 tail -f

set -euo pipefail

cd "$(dirname "$0")"

# ===== 색상 (TTY 아닐 때는 비활성) =====
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_OK=$'\033[32m'; C_ERR=$'\033[31m'
else
  C_RESET=''; C_BOLD=''; C_DIM=''; C_OK=''; C_ERR=''
fi

PORT=5678
PREVIEW_PORT=5679
URL="http://127.0.0.1:${PORT}/"
PID_FILE=".dev/vite.pid"
LOG_FILE=".dev/vite.log"

say() { printf '%s[dev]%s %s\n' "$C_BOLD" "$C_RESET" "$*"; }
die() { printf '%s[dev]%s %s%s%s\n' "$C_BOLD" "$C_RESET" "$C_ERR" "$*" "$C_RESET" >&2; exit 1; }
listeners() { lsof -ti "tcp:$1" -sTCP:LISTEN 2>/dev/null || true; }
is_up() { curl -sf "http://127.0.0.1:$PORT/" >/dev/null 2>&1; }
# Vite dev 서버만 /@vite/client 를 제공한다 (preview 는 SPA 폴백 html 이라 본문으로 구분)
is_dev() { curl -sf "http://127.0.0.1:$PORT/@vite/client" 2>/dev/null | grep createHotContext >/dev/null; }

# 해당 포트 리스너(+pid 파일)를 TERM → 3초 후 KILL. 종료한 pid 가 있으면 0.
stop_port() {
  local pids; pids="$(listeners "$1")"
  [ -n "$pids" ] || return 1
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  for _ in 1 2 3 4 5 6; do
    [ -z "$(listeners "$1")" ] && return 0
    sleep 0.5
  done
  # shellcheck disable=SC2086
  kill -9 $(listeners "$1") 2>/dev/null || true
  return 0
}

cmd_up() {
  if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
    say "의존성 설치 중 (npm install)"
    npm install
  fi
  if is_dev; then
    say "이미 실행 중: $URL"
    return 0
  fi
  if stop_port "$PORT"; then
    say "${PORT} 을 쓰던 다른 서버 종료"
  fi
  mkdir -p .dev
  nohup npm run dev >"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  say "dev 서버 기동 중..."
  for _ in $(seq 1 40); do
    if is_dev; then
      say "${C_OK}실행 중${C_RESET}: $URL"
      say "주행 화면: ${URL}#drive"
      say "${C_DIM}중지: ./dev.sh down · 로그: ./dev.sh logs${C_RESET}"
      return 0
    fi
    sleep 0.5
  done
  tail -n 20 "$LOG_FILE" >&2 || true
  die "dev 서버가 20초 안에 응답하지 않습니다"
}

cmd_down() {
  local stopped=0
  if stop_port "$PORT"; then say "포트 ${PORT} (dev) 서버 종료"; stopped=1; fi
  if stop_port "$PREVIEW_PORT"; then say "포트 ${PREVIEW_PORT} (preview) 서버 종료"; stopped=1; fi
  if [ -f "$PID_FILE" ]; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    rm -f "$PID_FILE"
  fi
  [ "$stopped" = 1 ] || say "실행 중인 서버 없음"
}

cmd_status() {
  if is_dev; then say "${PORT}: ${C_OK}running${C_RESET} (dev) $URL"
  elif is_up; then say "${PORT}: running (다른 서버, dev 아님) $URL"
  else say "${PORT}: not running"; fi
  if [ -n "$(listeners "$PREVIEW_PORT")" ]; then say "${PREVIEW_PORT}: ${C_OK}running${C_RESET} (preview) http://127.0.0.1:${PREVIEW_PORT}/"
  else say "${PREVIEW_PORT}: not running (preview)"; fi
}

cmd_logs() {
  [ -f "$LOG_FILE" ] || die "로그 파일이 없습니다 ($LOG_FILE) — 먼저 ./dev.sh up"
  exec tail -f "$LOG_FILE"
}

print_menu() {
  cat <<MENU
${C_BOLD}speedracer 개발 환경${C_RESET}
  1) up       dev 서버 기동 (백그라운드)
  2) down     서버 중지 (5678 dev · 5679 preview)
  3) restart  재시작
  4) status   상태 확인 (5678 · 5679)
  5) logs     로그 보기
  q) 나가기
MENU
}

dispatch() {
  case "${1:-}" in
    up|1) cmd_up ;;
    down|2) cmd_down ;;
    restart|3) cmd_down; cmd_up ;;
    status|4) cmd_status ;;
    logs|5) cmd_logs ;;
    -h|--help|help) print_menu ;;
    q|Q|'') echo "[dev] 종료" ;;
    *) print_menu >&2; die "알 수 없는 명령: $1" ;;
  esac
}

if [ $# -eq 0 ]; then
  print_menu
  read -r -p "번호 입력: " choice
  dispatch "$choice"
else
  dispatch "$1"
fi
