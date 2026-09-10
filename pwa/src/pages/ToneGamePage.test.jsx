import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ROUND_LENGTH } from '../constants/toneGameWords.js';
import { fetchGameMe, saveGameMe } from '../api/gameApi.js';
import { loginMember } from '../game/gameStore.js';

// Keep the real page, game rules, achievement checks and local stores. Only the
// remote word source, audio and visual screens are replaced with deterministic controls.
vi.mock('../api/gameApi.js', () => ({
  fetchToneWords: vi.fn(async () => Array.from({ length: 20 }, (_, i) => ({
    hanzi: `字${i}`, pinyin: ['zì'], tones: [4], meaning: '테스트 단어',
  }))),
  takeLoginFromHash: () => null,
  exchangeGameLogin: vi.fn(),
  fetchGameMe: vi.fn(), saveGameMe: vi.fn(), deleteGameMe: vi.fn(),
}));
vi.mock('../game/gameAnalytics.js', () => ({ track: vi.fn() }));
vi.mock('../game/tgTts.js', () => ({ initTts: vi.fn(), speakWord: vi.fn(), preloadTts: vi.fn() }));
vi.mock('../game/tgSfx.js', () => ({ initSfx: vi.fn(), play: vi.fn() }));
vi.mock('../game/tgBgm.js', () => ({ initBgm: vi.fn(), startBgm: vi.fn(), stopBgm: vi.fn() }));
vi.mock('../game/gameAds.js', () => ({ initGameAds: vi.fn(), onRoundEnd: vi.fn() }));
vi.mock('../game/screens/shared.jsx', () => ({
  FigmaScreen: ({ children }) => <>{children}</>,
  GameStage: ({ children }) => <>{children}</>,
  TxLayer: ({ children }) => <>{children}</>,
  CountdownVisual: () => null, GameToast: () => null, BeatDim: () => null,
}));
vi.mock('../game/screens/SplashScreen.jsx', () => ({ SplashScreen: () => null }));
vi.mock('../game/screens/LoadingScreen.jsx', () => ({ LoadingTip: () => null }));
vi.mock('../game/screens/TitleScreen.jsx', () => ({ TitleScreen: ({ onStart }) => <button onClick={onStart}>시작하기</button> }));
vi.mock('../game/screens/HomeScreen.jsx', () => ({ HomeScreen: ({ onPlay, syncStatus, onSyncRetry }) => <>
  <button onClick={onPlay}>게임하기</button><output data-testid="save-status">{syncStatus}</output>
  <button onClick={onSyncRetry}>저장 재시도</button>
</> }));
vi.mock('../game/screens/ModeScreen.jsx', () => ({ ModeScreen: ({ onTraining, onDifficulty }) => <>
  <button onClick={onTraining}>트레이닝</button><button onClick={onDifficulty}>스테이지</button>
</> }));
vi.mock('../game/screens/DifficultyScreen.jsx', () => ({ DifficultyScreen: ({ selected, onStart }) => <button onClick={() => onStart(selected)}>스테이지 시작</button> }));
vi.mock('../game/screens/GameScreen.jsx', () => ({ GameScreen: ({ word, wordIndex, completed, paused, onTone, onReveal, onPause, onEndTraining, practice }) => <>
  <output data-testid="word-index">{wordIndex}</output>
  <output data-testid="current-word">{word?.hanzi}</output>
  <button disabled={completed || paused} onClick={() => onTone(4)}>4성</button>
  <button disabled={completed || paused} onClick={() => onTone(3)}>3성</button>
  <button disabled={completed || paused} onClick={onReveal}>정답보기</button>
  <button onClick={onPause}>일시정지</button>
  {practice && <button onClick={onEndTraining}>트레이닝 종료</button>}
</> }));
vi.mock('../game/screens/PauseModal.jsx', () => ({ PauseModal: ({ onResume, onRestart, onQuit }) => <>
  <button onClick={onResume}>계속하기</button><button onClick={onRestart}>다시하기</button><button onClick={onQuit}>그만두기</button>
</> }));
vi.mock('../game/screens/NewRecordBeat.jsx', () => ({ NewRecordBeat: ({ onDone }) => <button onClick={onDone}>종료 연출 완료</button> }));
vi.mock('../game/screens/GameOverBeat.jsx', () => ({ GameOverBeat: ({ onDone }) => <button onClick={onDone}>종료 연출 완료</button> }));
vi.mock('../game/screens/XpGainReveal.jsx', () => ({ XpGainReveal: ({ gained, onDone }) => <button onClick={onDone}>XP {gained} 획득 완료</button> }));
vi.mock('../game/screens/ResultScreen.jsx', () => ({
  ResultScreen: ({ coachReady, toneSummary, onTraining, onChooseMode }) => <>
    <output data-testid="result">{coachReady ? '후속 안내 가능' : '업적 확인 대기'}</output>
    <output data-testid="tone-summary">{JSON.stringify(toneSummary)}</output>
    <button onClick={onTraining}>요약 트레이닝</button><button onClick={onChooseMode}>요약 모드 선택</button>
  </>,
  ExamResultScreen: () => null,
}));
vi.mock('../game/screens/CelebrationOverlay.jsx', () => ({ CelebrationOverlay: ({ achievement, onNext }) => <button onClick={onNext}>업적 확인: {achievement.label}</button> }));
vi.mock('../game/screens/LoginScreen.jsx', () => ({ LoginScreen: () => null }));
vi.mock('../game/screens/NicknameScreen.jsx', () => ({ NicknameScreen: () => null }));
vi.mock('../game/screens/NicknameEditModal.jsx', () => ({ NicknameEditModal: () => null }));
vi.mock('../game/screens/_ParticleLab.jsx', () => ({ ParticleLab: () => null }));
vi.mock('../game/screens/_SfxLab.jsx', () => ({ SfxLab: () => null }));
vi.mock('../game/screens/ThemeScreen.jsx', () => ({ ThemeScreen: () => null }));
vi.mock('../game/screens/MasteryScreen.jsx', () => ({ MasteryScreen: () => null }));
vi.mock('../game/screens/AchievementsScreen.jsx', () => ({ AchievementsScreen: () => null }));
vi.mock('../game/screens/PlayScreen.jsx', () => ({ PlayScreen: () => null }));
vi.mock('../game/screens/LinkHubScreen.jsx', () => ({ LinkHubScreen: () => null }));
vi.mock('../game/screens/RankUpReveal.jsx', () => ({ RankUpReveal: () => null }));
vi.mock('../game/screens/ExamIntroReveal.jsx', () => ({ ExamIntroReveal: () => null }));
vi.mock('../game/screens/TutorialDoneBeat.jsx', () => ({ TutorialDoneBeat: () => null }));
vi.mock('../game/screens/ModeUnlockReveal.jsx', () => ({ ModeUnlockReveal: () => null }));
vi.mock('../game/screens/IntroScreen.jsx', () => ({ IntroScreen: () => null }));
vi.mock('../game/screens/TutorialScreen.jsx', () => ({ TutorialScreen: () => null }));
vi.mock('../game/screens/gameModals.jsx', () => ({ HelpStartModal: () => null, TrainingNudgeModal: () => null, ExamPromptModal: () => null }));

let ToneGamePage;
beforeAll(async () => {
  ({ default: ToneGamePage } = await import('./ToneGamePage.jsx'));
}, 60000);
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem('tg_onboarded', '1');
  localStorage.setItem('tg_intro_seen', '1');
  fetchGameMe.mockReset(); saveGameMe.mockReset();
  fetchGameMe.mockResolvedValue({ user: { id: 'member-test', gameData: {} } });
  saveGameMe.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

async function advance(ms) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}
const click = name => fireEvent.click(screen.getByRole('button', { name }));
async function countdown() {
  for (const ms of [420, 850, 850, 850, 420]) await advance(ms);
}
async function startGame(training = true) {
  await act(async () => { render(<MemoryRouter><ToneGamePage /></MemoryRouter>); });
  await advance(2700);
  click('시작하기');
  for (const ms of [420, 2600, 420]) await advance(ms);
  click('게임하기');
  click(training ? '트레이닝' : '스테이지');
  if (!training) click('스테이지 시작');
  await countdown();
  expect(screen.getByTestId('word-index').textContent).toBe('0');
}

const memberLogin = () => {
  const token = btoa(JSON.stringify({ v: 2, iss: 'tutor-manager', aud: 'tutor-manager:game', purpose: 'game', sub: 'member-test',
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600 })) + '.test-signature';
  loginMember(token, { id: 'member-test', nickname: '테스트 회원' });
};
async function startHome() {
  await act(async () => { render(<MemoryRouter><ToneGamePage /></MemoryRouter>); });
  await advance(2700);
  click('시작하기');
  for (const ms of [420, 2600, 420]) await advance(ms);
}

describe('게임 화면의 회원 저장 복구', () => {
  it('첫 조회 실패 안내에서 수동 재시도하면 서버 저장 완료로 바뀐다', async () => {
    memberLogin();
    fetchGameMe.mockRejectedValueOnce(new Error('offline'));
    await startHome();
    expect(screen.getByTestId('save-status').textContent).toBe('read-error');
    expect(saveGameMe).not.toHaveBeenCalled();
    await act(async () => { click('저장 재시도'); });
    expect(screen.getByTestId('save-status').textContent).toBe('saved');
    expect(saveGameMe).toHaveBeenCalledTimes(1);
  });
  it('연결 회복 이벤트로 보류한 첫 저장을 복구한다', async () => {
    memberLogin();
    fetchGameMe.mockRejectedValueOnce(new Error('offline'));
    await startHome();
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(screen.getByTestId('save-status').textContent).toBe('saved');
    expect(fetchGameMe).toHaveBeenCalledTimes(2);
    expect(saveGameMe).toHaveBeenCalledTimes(1);
  });
  it('트레이닝에서 홈으로 나올 때 저장 실패를 표시하고 재시도를 연결한다', async () => {
    memberLogin();
    await startGame();
    const answeredWord = screen.getByTestId('current-word').textContent;
    saveGameMe.mockRejectedValueOnce(new Error('offline'));
    click('4성');
    click('트레이닝 종료');
    await advance(420);
    expect(screen.getByTestId('save-status').textContent).toBe('save-error');
    await act(async () => { click('저장 재시도'); });
    expect(screen.getByTestId('save-status').textContent).toBe('saved');
    expect(saveGameMe.mock.calls.at(-1)[1].words).toHaveProperty(answeredWord);
  });
});
async function queueNextWord() {
  click('정답보기');
  click('일시정지');
  await advance(1500);
  expect(screen.getByTestId('word-index').textContent).toBe('0');
  click('계속하기');
}

describe('성조게임 일시정지와 종료 연출 회귀', () => {
  it('실제 정오답 누적을 결과 요약에 전달하고 기존 트레이닝으로 이어간다', async () => {
    await startGame(false);
    for (let i = 0; i < ROUND_LENGTH; i++) {
      click('3성'); await advance(450);
      click('4성'); await advance(1500);
    }
    click('종료 연출 완료');
    fireEvent.click(screen.getByRole('button', { name: /XP \d+ 획득 완료/ }));
    const summary = JSON.parse(screen.getByTestId('tone-summary').textContent);
    expect(summary).toMatchObject({ state: 'practice', suggestedTone: 4 });
    expect(summary.rows.find(row => row.tone === 4)).toMatchObject({ correct: ROUND_LENGTH, attempts: ROUND_LENGTH * 2, accuracy: 0.5 });
    click('요약 트레이닝'); await countdown();
    expect(screen.getByRole('button', { name: '트레이닝 종료' })).not.toBeNull();
    expect(screen.getByTestId('word-index').textContent).toBe('0');
  });

  it('다음 문제 대기 중 정상 재개하면 350ms 후 정확히 한 번 진행한다', async () => {
    await startGame();
    await queueNextWord();
    await advance(349);
    expect(screen.getByTestId('word-index').textContent).toBe('0');
    await advance(1);
    expect(screen.getByTestId('word-index').textContent).toBe('1');
    expect(screen.getByRole('button', { name: '4성' }).disabled).toBe(false);
    await advance(500);
    expect(screen.getByTestId('word-index').textContent).toBe('1');
  });

  it('재개 직후 다시 일시정지해도 보류한 문제 전환을 잃지 않는다', async () => {
    await startGame();
    await queueNextWord();
    await advance(80);
    click('일시정지');
    await advance(500);
    expect(screen.getByTestId('word-index').textContent).toBe('0');
    click('계속하기');
    await advance(350);
    expect(screen.getByTestId('word-index').textContent).toBe('1');
    expect(screen.getByRole('button', { name: '4성' }).disabled).toBe(false);
  });

  it('재개 대기 중 트레이닝을 끝내면 이전 문제 콜백이 다시 실행되지 않는다', async () => {
    await startGame();
    await queueNextWord();
    await advance(80);
    click('트레이닝 종료');
    await advance(350);
    // 홈을 덮는 420ms 전환 동안 이전 게임의 진행도도 바뀌면 안 된다.
    expect(screen.getByTestId('word-index').textContent).toBe('0');
    await advance(70);
    expect(screen.queryByTestId('word-index')).toBeNull();
    expect(screen.getByRole('button', { name: '게임하기' })).toBeTruthy();
  });

  it('일시정지에서 다시 시작하면 보류한 이전 문제를 버리고 새 판을 시작한다', async () => {
    await startGame();
    await queueNextWord();
    await advance(80);
    click('일시정지');
    click('다시하기');
    await countdown();
    expect(screen.getByTestId('word-index').textContent).toBe('0');
    expect(screen.getByRole('button', { name: '4성' }).disabled).toBe(false);
  });

  it('일반 판의 XP 연출이 끝나면 업적 큐를 표시하고 모두 확인 후 후속 안내를 허용한다', async () => {
    await startGame(false);
    for (let i = 0; i < ROUND_LENGTH; i++) {
      click('4성');
      await advance(1500);
    }
    click('종료 연출 완료');
    const xpDone = screen.getByRole('button', { name: /XP \d+ 획득 완료/ });
    expect(xpDone.textContent).not.toBe('XP 0 획득 완료');
    fireEvent.click(xpDone);
    expect(screen.getByTestId('result').textContent).toBe('업적 확인 대기');
    expect(screen.queryByRole('button', { name: /업적 확인/ })).toBeNull();
    await advance(2000);
    expect(screen.getByRole('button', { name: '업적 확인: 첫걸음' })).toBeTruthy();
    let shown = 0;
    while (screen.queryByRole('button', { name: /업적 확인/ })) {
      click(/업적 확인/);
      shown++;
      expect(shown).toBeLessThan(20);
    }
    expect(shown).toBeGreaterThan(0);
    expect(screen.getByTestId('result').textContent).toBe('후속 안내 가능');
  });
});
