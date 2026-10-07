# Google Analytics 관리 API 연결

게임의 GA4 방문 분석과 개발자가 Google 설정을 관리하는 OAuth 연결은 별개다. 게임 이용자는 메뉴에서 분석 참여를 선택한다. 관리용 OAuth는 개발자의 Mac에서만 사용하며 게임·Git·배포 파일에 인증 토큰을 넣지 않는다.

## 준비된 연결

- Codex MCP 이름: `speedracer-analytics-admin`.
- 실행 코드: `tools/analytics-admin/`, `uv.lock`으로 전용 Python 의존성을 고정한다.
- 기존 MCP 서버 설정은 유지하고 새로운 stdio 서버만 추가했다.
- 도구: 연결 상태, 계정 목록, 속성 조회, Speedracer 속성·웹 스트림·맞춤 정의 생성/재사용, 실시간 이벤트 조회.
- 인증 파일: `~/.config/speedracer-analytics/credentials.json`, 권한 `0600`. 토큰은 출력하지 않는다.
- 계정 생성·약관 동의·권한 부여·Google Ads 연결·삭제 도구는 제공하지 않는다.

서버 설치·등록, Google Cloud 인증 앱 구성과 사용자 OAuth 인증을 완료했다. MCP를 통해 실제 계정 조회와 Speedracer 속성·스트림·맞춤 정의 설정을 완료했다. 새 MCP 서버가 Codex 도구 목록에 바로 나타나지 않으면 새 세션을 열거나 앱을 재시작한다. 이 세션에서는 stdio MCP 클라이언트로 검증했다.

### Speedracer 연결 현황 (2026-10-07)

- 사용자의 선택에 따라 기존 개인 계정 `158565`의 표시 이름을 `summerz.pe.kr`에서 `summerz.net`으로 변경했다. 계정 ID와 기존 사이트 설정은 유지했다.
- GA4 속성: `Speedracer`, ID `557928325`, 시간대 `Asia/Seoul`, 통화 `KRW`.
- 웹 스트림: `Speedracer web`, ID `16058182051`, 주소 `https://speedracer.summerz.net`.
- 공개 측정 ID: `G-86SQDL5ZDS`. `summerz/speedracer-site`의 Actions 변수 `GA_MEASUREMENT_ID`에 등록하고 조회로 확인했다.
- 맞춤 측정기준 10개·측정항목 5개를 등록하고 MCP 속성 조회로 확인했다. 이 스트림의 향상된 측정과 이 속성의 Google Signals를 껐다.
- Data API 실시간 보고서 호출에 성공했다. 이벤트별 횟수와 전체 활성 사용자 수는 API 호환성을 위해 별도 조회한다. 아직 실제 게임 이벤트가 없어 결과는 비어 있다. 관리 도구 자동 테스트 9개도 통과했다.
- 분석 코드의 배포와 실제 게임 이벤트 수신 확인은 아직 남아 있다. GitHub 변수 등록만으로 이미 배포된 게임이 변경되지는 않는다.

### Google Cloud 준비 현황 (2026-10-07)

- 전용 프로젝트 `Speedracer Analytics` (`speedracer-analytics`)를 생성했다. 기존 프로젝트의 설정은 변경하지 않았다.
- OAuth 앱: `Speedracer Analytics Admin`, 외부 사용자·테스트 상태, 지원·연락 이메일 `summerz@gmail.com`. 사용자가 User Data Policy에 직접 동의한 뒤 생성 완료를 확인했다.
- 테스트 사용자 `summerz@gmail.com`과 `analytics.readonly`, `analytics.edit` 범위를 등록·저장했다.
- Admin API와 Data API 모두 사용 설정 완료를 확인했다. Admin API의 실제 계정 목록 조회에 성공했으며, Data API 실시간 보고서는 속성 연결 이후 검증한다.
- 데스크톱 OAuth 클라이언트 `Speedracer Analytics MCP`를 생성하고 **Use this client for an AI-powered agent**로 지정했다. JSON은 `~/.config/speedracer-analytics/oauth-client.json`에 권한 `0600`으로 보관한다. Git과 배포에는 포함하지 않는다.
- 사용자가 테스트 앱 안내와 Analytics 권한 승인을 직접 완료했다. 인증 토큰은 `~/.config/speedracer-analytics/credentials.json`에 권한 `0600`, 상위 디렉터리는 `0700`으로 저장했다. 비밀값은 출력하지 않았다.
- MCP 계정 목록 조회 후 사용자가 기존 개인 계정의 이름 변경과 재사용을 선택했다. 해당 계정 아래 Speedracer 전용 속성을 생성했으며 다른 사이트 설정은 변경하지 않았다.

## 사용자가 한 번 준비할 것

1. [Google Cloud Console](https://console.cloud.google.com/)에서 본인이 관리하는 프로젝트를 선택하거나 만든다. Google Analytics의 계정·속성과 Google Cloud 프로젝트는 별개다.
2. API 및 서비스 → 라이브러리에서 **Google Analytics Admin API**와 **Google Analytics Data API**를 사용 설정한다. 전자는 속성 설정, 후자는 실시간 수신 확인에 사용한다.
3. Google Auth platform에서 OAuth 앱 정보를 설정한다. Data Access에서 `analytics.readonly`, `analytics.edit` 범위를 등록한다. 개인용으로 테스트한다면 본인 이메일을 테스트 사용자로 등록한다. 조직 내부 앱이라면 해당 조직 정책에 맞게 설정한다.
4. Google Auth platform → Clients → Create client에서 **Desktop app(데스크톱 앱)**을 선택한다. JSON을 다운로드해 저장소 밖의 경로에 보관하고 그 파일 경로를 Codex에 알려준다. 파일 내용이나 토큰을 채팅에 붙여 넣을 필요는 없다.
5. [Google Analytics](https://analytics.google.com/) 계정이 없다면 계정 생성과 약관 동의는 사용자가 직접 완료한다. 속성 생성에는 해당 계정의 편집 권한이 필요하다. 사용할 계정이 여러 개라면 Codex가 조회 후 선택을 요청한다.

OAuth 화면에서는 Analytics 조회·수정 권한을 요청한다. 요청 범위는 `analytics.readonly`와 `analytics.edit`이며, 범용 Google Cloud 권한은 요청하지 않는다. 로그인과 동의는 사용자가 직접 완료한다.

## 인증 실행

파일 경로를 받으면 Codex가 아래 명령으로 브라우저 로그인 화면을 열 수 있다. 사용자가 직접 실행해도 된다. 예시 파일 경로를 실제 다운로드 경로로 바꾼다.

```sh
uv run --frozen --project tools/analytics-admin python tools/analytics-admin/auth.py \
  --client-file /Users/summerz/Downloads/client_secret_example.json
```

로그인 후 로컬 루프백 주소로 인증 결과를 수신하며 최대 5분 기다린다. 비밀값을 출력하지 않고 개인 인증 파일에 저장한다. OAuth 테스트 상태나 사용자 철회 등으로 인증이 만료되면 같은 명령으로 다시 인증한다.

## 인증 이후 Codex가 처리할 것

1. 접근 가능한 Analytics 계정을 조회해 사용할 계정을 확정한다.
2. Speedracer 속성(대한민국 시간대·KRW)과 `https://speedracer.summerz.net` 웹 스트림을 생성하거나 재사용한다. 여러 후보·기존 정의 충돌이 있으면 결과를 보고하며 기존 리소스를 삭제하지 않는다.
3. 게임 코드의 화면 이벤트와 중복되지 않도록 해당 웹 스트림의 향상된 측정을 끄고, 해당 속성의 Google Signals를 끈다. 맞춤 측정기준 10개·맞춤 측정항목 5개를 추가한다. 기존 다른 스트림·정의는 보존한다.
4. 공개 측정 ID를 실제 빌드 저장소 `summerz/speedracer-site`의 Actions 변수 `GA_MEASUREMENT_ID`에 연결한다. OAuth 토큰은 GitHub로 보내지 않는다.
5. 빌드·배포 후 참여 동의 → 주행 → 완주를 테스트하고 Data API 실시간 수신을 확인한다. 실제 설치 앱 검증은 별도로 기록한다.

## 검증과 복구

```sh
uv run --frozen --project tools/analytics-admin python -m unittest discover \
  -s tools/analytics-admin -p 'test_*.py'
```

계정 선택 충돌, 다른 사이트 스트림 보존, 맞춤 정의 충돌, 중복 생성 방지, 페이지네이션을 모의 검증한다. Google 인증 없이 실제 계정이나 리소스를 변경하지 않는다. API 실패 후 다시 실행하면 이미 생성된 리소스를 재사용한다. 부분 실패가 의심되면 속성 조회 후 재실행한다.

다른 체크아웃이나 컴퓨터에서는 MCP 실행 경로를 다시 등록한다.

```sh
codex mcp add speedracer-analytics-admin -- /opt/homebrew/bin/uv run --frozen \
  --project /Users/summerz/Documents/speedracer/tools/analytics-admin python \
  /Users/summerz/Documents/speedracer/tools/analytics-admin/server.py
```

참고: [Google 관리 API 시작하기](https://developers.google.com/analytics/devguides/config/admin/v1/quickstart), [OAuth 클라이언트 만들기](https://developers.google.com/workspace/guides/create-credentials), [데스크톱 OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [속성 생성 권한](https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/properties/create), [Codex MCP 설정](https://developers.openai.com/codex/mcp/).
