# GitHub Pages 배포

- 저장소: https://github.com/summerz/speedracer-site
- 사이트: https://speedracer.summerz.net
- 배포 설정: `.github/workflows/pages.yml`

main에 푸시하면 `npm ci` → `npm test` → `npm run build` 후 dist를 GitHub Pages에 배포한다. 동일한 코드를 다시 배포하려면 Actions의 Deploy GitHub Pages에서 Run workflow를 실행한다.

GitHub 작업은 프로젝트 계정을 선택하는 `gh-project`로 실행한다.

```sh
npm test
npm run build
git add src tests docs README.md .github public
git commit -m "Describe the change"
gh-project git push origin main
gh-project run list --workflow pages.yml --limit 3
```

Pages의 Source는 GitHub Actions이고 Custom domain은 speedracer.summerz.net이다. DNS는 summerz.github.io를 가리킨다. CNAME은 public에도 보관하되 Actions 배포의 도메인 연결은 저장소 Pages 설정으로 관리한다. Vite의 루트 경로를 사용하므로 사용자 도메인으로 접속한다.

배포 후 격납고와 `/#drive` 진입, 시점 버튼, Bloom, 모바일 화면에서 메뉴와 PIP를 확인한다. 모바일은 자동 가속·감속 버튼과 양손 터치 주행을 지원한다. 지원 기기에서는 부스트 진동과 진동 토글도 확인한다. HTTPS를 강제하며 진동 API가 없는 브라우저에서는 진동 버튼을 숨긴다. 실제 휴대폰의 진동 체감·발열·프레임 성능은 사용자 기기로 확인해야 한다. 키 변경 설정은 후속 계획이다.

2026-10-04 첫 배포 완료: Actions build/deploy 성공, 사용자 도메인 HTTPS 200 응답, 격납고→주행과 데스크톱 C/X, 390×844 모바일 터치·고도·PIP 확인. 실행 오류와 리소스 요청 실패 없음. 이후 main 푸시에도 같은 워크플로를 사용한다.
