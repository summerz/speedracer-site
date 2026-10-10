export type TutorialStepId = 'throttle' | 'steer' | 'altitude' | 'boost' | 'brake' | 'hazard' | 'near-miss';
export type TutorialDevice = 'touch' | 'keys';
export type TutorialTarget = 'joystick' | 'boost' | 'altitude' | 'height-guide' | 'boost-meter';
export interface TutorialCopy { name: string; title: string; body: string; checks: Record<string, string>; targets: TutorialTarget[] }

const HAZARD_BODY = '왼쪽 막대가 지금 고도로 지나갈 수 있는지 알려 줘요. <b class="ok">민트</b>는 통과, <b class="bad">빨강</b>은 막힘이에요. 빨강이면 고도를 바꾸세요.';
const COPY: Record<TutorialStepId, Record<TutorialDevice, TutorialCopy>> = {
  throttle: {
    touch: { name: '가속', title: '자동으로 달려요', body: '손을 떼도 기체가 스스로 가속해요. 조이스틱은 방향과 감속에만 써요.', checks: { auto: '자동 가속' }, targets: ['joystick'] },
    keys: { name: '가속', title: '자동으로 달려요', body: '기체가 스스로 가속해요. <kbd>S</kbd> 를 누를 때만 감속해요.', checks: { auto: '자동 가속' }, targets: [] },
  },
  steer: {
    touch: { name: '조향', title: '좌우로 방향 바꾸기', body: '왼쪽 원을 손가락으로 좌우로 밀어 보세요.', checks: { left: '왼쪽', right: '오른쪽' }, targets: ['joystick'] },
    keys: { name: '조향', title: '좌우로 방향 바꾸기', body: '<kbd>A</kbd> <kbd>D</kbd> 로 좌우로 방향을 바꿔요.', checks: { left: '왼쪽', right: '오른쪽' }, targets: [] },
  },
  altitude: {
    touch: { name: '고도', title: '고도 한 단계 바꾸기', body: '↑ ↓ 버튼을 누르면 고도가 한 단계씩 바뀌어요.', checks: { up: '올리기', down: '내리기' }, targets: ['altitude'] },
    keys: { name: '고도', title: '고도 한 단계 바꾸기', body: '<kbd>↑</kbd> <kbd>↓</kbd> 로 고도를 한 단계씩 바꿔요.', checks: { up: '올리기', down: '내리기' }, targets: ['height-guide'] },
  },
  boost: {
    touch: { name: '부스트', title: '누른 채 밀어서 고도 바꾸기', body: 'BOOST를 누르고 있으면 빨라져요. 누른 채 위아래로 밀면 고도를 고를 수 있어요. 끝 고도에서는 반대 방향으로 바꿔 보세요.', checks: { on: '부스트 켜기', 'alt-change': '누른 채 고도 바꾸기' }, targets: ['boost'] },
    keys: { name: '부스트', title: '누른 채 고도 바꾸기', body: '<kbd>Space</kbd> 를 누르고 있으면 빨라져요. 누른 채 <kbd>↑</kbd> <kbd>↓</kbd> 로 고도를 바꿔요. 끝 고도에서는 반대 방향으로 바꿔 보세요.', checks: { on: '부스트 켜기', 'alt-change': '누른 채 고도 바꾸기' }, targets: ['boost-meter'] },
  },
  brake: {
    touch: { name: '감속', title: '속도 줄이기', body: '조이스틱을 아래로 당기면 감속해요.', checks: { on: '감속하기' }, targets: ['joystick'] },
    keys: { name: '감속', title: '속도 줄이기', body: '<kbd>S</kbd> 를 누르고 있으면 감속해요.', checks: { on: '감속하기' }, targets: [] },
  },
  hazard: {
    touch: { name: '위험 표시', title: '빨간 칸을 피해 고도 맞추기', body: HAZARD_BODY, checks: { pass: '막힌 구간 피하기' }, targets: ['height-guide', 'altitude'] },
    keys: { name: '위험 표시', title: '빨간 칸을 피해 고도 맞추기', body: HAZARD_BODY, checks: { pass: '막힌 구간 피하기' }, targets: ['height-guide'] },
  },
  'near-miss': {
    touch: { name: '니어미스', title: '아슬아슬하게 스치기', body: '상대 기체나 장애물 옆을 아슬아슬하게 지나가면 부스트가 채워져요.', checks: { once: '니어미스 1회' }, targets: ['boost-meter'] },
    keys: { name: '니어미스', title: '아슬아슬하게 스치기', body: '상대 기체나 장애물 옆을 아슬아슬하게 지나가면 부스트가 채워져요.', checks: { once: '니어미스 1회' }, targets: ['boost-meter'] },
  },
};

export function tutorialCopy(step: TutorialStepId, device: TutorialDevice): TutorialCopy { return COPY[step][device]; }

const PROMPTS: Record<string, { title: string; keys: string; touch: string }> = {
  'steer/left': { title: '왼쪽으로 꺾기', keys: '<kbd>A</kbd> 를 눌러 보세요', touch: '왼쪽 원을 왼쪽으로 밀어 보세요' },
  'steer/right': { title: '오른쪽으로 꺾기', keys: '<kbd>D</kbd> 를 눌러 보세요', touch: '왼쪽 원을 오른쪽으로 밀어 보세요' },
  'altitude/up': { title: '고도 올리기', keys: '<kbd>↑</kbd> 를 눌러 보세요', touch: '↑ 버튼을 눌러 보세요' },
  'altitude/down': { title: '고도 내리기', keys: '<kbd>↓</kbd> 를 눌러 보세요', touch: '↓ 버튼을 눌러 보세요' },
  'boost/on': { title: 'BOOST 누르고 있기', keys: '<kbd>Space</kbd> 를 누른 채로 있어 보세요', touch: '오른쪽 아래 BOOST를 누른 채로 있어 보세요' },
  'boost/alt-change': { title: '부스트 중 고도 바꾸기', keys: '<kbd>Space</kbd> 를 누른 채 <kbd>↑</kbd> 나 <kbd>↓</kbd> 를 눌러 보세요', touch: 'BOOST를 누른 채 위나 아래로 밀어 보세요' },
  'brake/on': { title: '감속하기', keys: '<kbd>S</kbd> 를 누르고 있어 보세요', touch: '조이스틱을 아래로 당겨 보세요' },
  'hazard/pass': { title: '안전한 고도로 바꾸기', keys: '빨간 칸이에요. <kbd>↑</kbd> <kbd>↓</kbd> 로 민트색 고도로 바꿔 보세요', touch: '빨간 칸이에요. ↑ ↓ 버튼으로 민트색 고도로 바꿔 보세요' },
};
export function tutorialPrompt(step: TutorialStepId, check: string, device: TutorialDevice): { title: string; prompt: string } | null {
  const p = PROMPTS[`${step}/${check}`];
  return p ? { title: p.title, prompt: device === 'touch' ? p.touch : p.keys } : null;
}
export const NEAR_MISS_FREEZE = { title: '이렇게 스치면 니어미스', body: '상대 기체 옆을 아슬아슬하게 지나가면 부스트가 채워져요. 가까울수록 많이 채워져요.', tag: '가까울수록 부스트 +' };
export const STEP_NAMES: Record<TutorialStepId, string> = { throttle: '가속', steer: '조향', altitude: '고도', boost: '부스트', brake: '감속', hazard: '위험 표시', 'near-miss': '니어미스' };
