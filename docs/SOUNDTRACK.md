# 사운드트랙

`incoming-resources/ost/`에 제공한 완성 MP3의 음색과 편곡을 그대로 사용한다. 로비용 1곡과 경주용 8곡을 `public/music/ost/`에 압축해 보관한다. 기존 MIDI 합성 음악은 재생하지 않으며, MIDI 파서·신시사이저 검증용 원본은 `tests/fixtures/music/`에 남긴다.

## 재생 규칙

| 화면·상황 | 동작 |
| --- | --- |
| 격납고·상점·캠페인·경주 시작 전 대기 | Before The Real Dark 반복. 화면을 오가도 현재 위치 유지 |
| 카운트다운 시작 | 다음 경주 곡으로 0.6초 크로스페이드 |
| 경주 중 곡 종료 | 섞어 둔 목록의 다음 곡으로 0.6초 크로스페이드. 8곡을 모두 재생하면 다시 섞음 |
| 일시정지·결과 화면 | 경주 곡을 유지하고 음량을 낮춤 |
| 로비 복귀 | 로비 곡을 이전 위치에서 이어 재생 |
| 다음 도전·재도전 | 섞어 둔 목록에서 아직 재생하지 않은 다음 곡부터 시작 |
| 음악 끄기·앱 숨김 | 재생을 멈추고 위치 유지. 켜기·복귀 시 이어 재생 |

경주 8곡을 무작위로 섞어 한 묶음 안에서는 각 곡을 한 번씩 선택한다. 다음 묶음도 새로 섞고, 이전 묶음의 마지막 곡과 다음 묶음의 첫 곡이 겹치면 첫 곡을 교환해 연속 중복을 막는다. 곡 순서는 앱 세션 동안 유지하며 로비 복귀·재도전으로 초기화하지 않는다. 앱을 새로 열면 새 목록을 섞는다. 첫 사용자 입력으로 오디오를 활성화한다. 충돌·이탈·부스트·고도 경고는 곡을 재시작하지 않으며, 기존 효과음의 음악 음량 낮추기를 유지한다.

## 곡 목록

| 용도·순서 | 곡 | 배포 파일 | 크기 (MB, 10⁶ bytes) |
| --- | --- | --- | --- |
| 로비 | Before The Real Dark | `lobby-before-the-real-dark.mp3` | 2.12 |
| 경주 1 | Obsidian Horizon | `racing-1-obsidian-horizon.mp3` | 2.06 |
| 경주 2 | Beneath the Steel Canopy | `racing-2-beneath-the-steel-canopy.mp3` | 2.04 |
| 경주 3 | Steel Gemini | `racing-3-steel-gemini.mp3` | 2.07 |
| 경주 4 | Horizon Pursuit | `racing-4-horizon-pursuit.mp3` | 2.14 |
| 경주 5 | Midnight Apex | `racing-5-midnight-apex.mp3` | 2.08 |
| 경주 6 | Weight of the Machine | `racing-6-weight-of-the-machine.mp3` | 2.08 |
| 경주 7 | Iron Spires Falling | `racing-7-iron-spires-falling.mp3` | 2.11 |
| 경주 8 | Apex Monitor | `racing-8-apex-monitor.mp3` | 2.14 |

원본 합계 38.09MB에서 18.85MB로 약 51% 줄였다. 원본 192kbps 스테레오를 FFmpeg `libmp3lame -b:a 96k` 고정 비트레이트, 44.1kHz 스테레오로 변환하고 메타데이터를 제거했다. 두 번의 loudnorm 분석으로 -18 LUFS, true peak -1.5dB, LRA 11을 목표로 음량을 맞췄다. 멜로디·아르페지오·드럼의 파트나 곡 내부 브레이크는 변경하지 않는다.

시작·끝의 실제 무음만 -50dB/0.15초 기준으로 제거한다. 경주 2번은 시작 0.225초, 각 곡 끝은 0.354~2.521초를 제거했다. 로비에는 앞부분 제거가 없다. 곡 내부 무음은 보존한다.

다시 변환하려면 저장소 루트에서 `python3 scripts/encode-soundtrack.py`를 실행한다. FFmpeg와 ffprobe가 필요하다. 원본을 수정하지 않는다. 기본은 96kbps이며 `--bitrate 80k`처럼 인코딩 비트레이트를 지정할 수 있다. 파일명을 바꾸거나 곡을 추가할 때는 `src/game/audio/soundtrack.ts`의 목록도 수정한다.

## 메모리·캐시·실패 처리

두 개의 HTML 오디오 요소를 Web Audio의 게인에 연결한다. 전체 곡을 AudioBuffer로 디코딩해 RAM에 쌓지 않는다. 로비와 첫 경주 곡을 준비하고, 재생 중 다음 경주 곡을 미리 준비한다. 음량은 로비/대기/결과 0.40, 주행/카운트다운 0.55, 일시정지 0.22에 알림 ducking 배율을 곱한다.

[오디오 요소를 Web Audio에 연결하는 방식](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createMediaElementSource)으로 음악 게인과 효과음 게인을 분리한다. 첫 활성화에서 두 요소의 재생을 시도하고 대기 요소를 음량 0으로 즉시 정지해 모바일 사용자 입력 제한에 대응한다. 파일 재생 실패 시 이전 곡을 유지하며 다음 사용자 입력에서 다시 시도한다. 늦게 완료된 재생 요청은 취소된 화면의 음악을 다시 살리지 않는다.

9곡 모두 기존 SHA-256 사전 캐시에 포함한다. 첫 설치/이번 음악 교체에는 약 19MB 다운로드가 필요하고, 이후 변경되지 않은 곡은 이전 캐시를 재사용한다. 배포된 리소스를 모두 저장한 뒤 오프라인으로 재생할 수 있다. 서비스 워커는 저장된 파일의 [바이트 범위 요청](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests)에 206 응답과 Content-Range를 제공한다. 범위를 벗어나면 416 응답하며 전체 캐시 원본을 변경하지 않는다.

실제 iPhone 홈 설치 앱의 첫 활성화·배경 복귀·음량 균형은 기기 검증 항목으로 남긴다.
