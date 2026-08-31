import { useRef } from 'react';
import { Button } from '../shadcn/button';
import { Input } from '../shadcn/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../shadcn/dialog';
import { CaretLeftIcon } from '@phosphor-icons/react';
import AudioRecorder from '../ui/AudioRecorder.jsx';
import {
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_INACTIVE,
  TEXT_DISABLED,
  STATUS_SUCCESS_BG,
  STATUS_SUCCESS_BORDER } from '../../constants/theme.js';
import { ACCEPT_AUDIO, ACCEPT_DOCUMENT } from '../../utils/audioFile.js';

/**
 * 숙제 파일 첨부 모달 — useFileAttach 훅과 짝으로 쓴다.
 * list(파일 목록·picker 진입) / record(음성 녹음) / naming(단일 파일 이름 입력) 3개 뷰.
 *
 * @param {Object} props
 * @param {Object} props.attach - useFileAttach() 반환값 전체
 * @param {{ audio: string, document: string, fallback: string }} props.titles - list 뷰 모달 제목 (페이지별 문구)
 * @param {{ audio: string, document: string }} props.hints - 빈 목록 안내 문구 (페이지별 문구)
 */
export default function FileAttachModal({ attach, titles, hints }) {
  const {
    modalKind, modalView, sessionFiles, namingFile, namingInput, setNamingInput,
    audioInputRef, docInputRef, recorderDefaultName, handleRecorderFile, preparing,
    closeModal, backToList, removeSessionFile,
    tryOpenAudioPicker, tryOpenDocPicker, tryOpenRecord,
    handleAudioPickChange, handleDocPickChange,
    handleNamingConfirm, handleSessionConfirm,
  } = attach;

  // 닫힘 애니메이션 동안 modalKind는 이미 null인데 Dialog는 화면에 남아 있어
  // 제목·버튼이 fallback으로 번쩍 바뀌었다("파일 제출" 플래시, 2026-08-31).
  // 렌더링용 kind는 마지막 값을 유지한다 — 로직 판정은 여전히 modalKind 기준.
  const lastKindRef = useRef(null);
  if (modalKind !== null) lastKindRef.current = modalKind;
  const displayKind = modalKind ?? lastKindRef.current;

  const modalTitle = (() => {
    if (modalView === 'record') return '음성 녹음';
    if (modalView === 'naming') return '파일 이름 입력';
    if (displayKind === 'audio') return titles.audio;
    if (displayKind === 'document') return titles.document;
    return titles.fallback;
  })();

  return (
    <Dialog open={modalKind !== null} onOpenChange={(next) => { if (!next) closeModal(); }}>
      {/* antd의 closable=false·mask.closable=false·keyboard=false를 그대로 옮긴 것:
          업로드 중 실수로 닫혀 파일이 날아가지 않도록 **명시적 동작으로만** 닫는다. */}
      {/* pt-4: 헤더가 컴팩트해 위만 살짝 줄임. 아래는 기본 p-6(24px) 유지 —
          antd 시절 잔재 pb-1(4px) 때문에 확인 버튼이 모달 바닥에 붙어 보였다(2026-08-30) */}
      <DialogContent
        showClose={false}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="pt-4"
      >
      <DialogHeader>
        <DialogTitle asChild>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {modalView !== 'list' && (
            <button
              type="button"
              onClick={backToList}
              className="transition-[color] duration-150 ease-out"
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: TEXT_SECONDARY, padding: '0 4px 0 0', display: 'flex', alignItems: 'center' }}
              aria-label="뒤로"
            >
              <CaretLeftIcon size={20} weight="bold" />
            </button>
          )}
          <span style={{ fontSize: 16, fontWeight: 700 }}>{modalTitle}</span>
          </div>
        </DialogTitle>
        <DialogDescription className="sr-only">숙제에 첨부할 파일을 고르세요.</DialogDescription>
      </DialogHeader>
      {/* 카테고리별 input — accept 속성으로 OS picker 단계에서 필터 */}
      <input
        ref={audioInputRef}
        type="file"
        accept={ACCEPT_AUDIO}
        multiple
        style={{ display: 'none' }}
        onChange={handleAudioPickChange}
      />
      <input
        ref={docInputRef}
        type="file"
        accept={ACCEPT_DOCUMENT}
        multiple
        style={{ display: 'none' }}
        onChange={handleDocPickChange}
      />

      {modalView === 'list' && (
        <div>
          {sessionFiles.length > 0 ? (
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: TEXT_SECONDARY, margin: '0 0 6px' }}>
                추가된 파일 ({sessionFiles.length}개)
              </p>
              {sessionFiles.map((pf) => (
                <div key={pf.tempId} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 12px', background: STATUS_SUCCESS_BG, border: `1px solid ${STATUS_SUCCESS_BORDER}`,
                  borderRadius: 12, marginBottom: 6,
                }}>
                  <span style={{ fontSize: 13, color: TEXT_PRIMARY, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {pf.baseName + pf.ext}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeSessionFile(pf.tempId)}
                    style={{ marginLeft: 10, background: 'none', border: 'none', cursor: 'pointer', color: TEXT_DISABLED, fontSize: 18, flexShrink: 0, padding: 0, lineHeight: 1 }}
                    aria-label="삭제"
                  >×</button>
                </div>
              ))}
            </div>
          ) : (
            <p style={{
              fontSize: 13, color: TEXT_INACTIVE, textAlign: 'center',
              // DialogContent 그리드 gap(16px)이 제목과의 간격을 이미 주므로 위 패딩은 살짝만.
              // 아래는 버튼 간격(12px 리듬)과 맞춘다 — 14/16/10으로 제각각이던 여백 통일(2026-08-30)
              padding: '4px 0 12px', margin: 0, lineHeight: 1.6,
            }}>
              {displayKind === 'audio' ? hints.audio : hints.document}
            </p>
          )}

          {displayKind === 'audio' ? (
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <Button type="button" variant="outline" onClick={tryOpenAudioPicker} className="flex-1 text-muted-foreground">
                파일 추가
              </Button>
              <Button type="button" variant="outline" onClick={tryOpenRecord} className="flex-1 text-muted-foreground">
                바로 녹음
              </Button>
            </div>
          ) : (
            <div style={{ marginBottom: 12 }}>
              {/* 고른 사진을 줄이는 동안(여러 장이면 몇 초) 버튼을 잠그고 상태를 보여준다 —
                  아무 반응이 없으면 학생이 같은 버튼을 다시 누르게 된다 */}
              <Button
                type="button"
                variant="outline"
                block
                onClick={tryOpenDocPicker}
                disabled={preparing}
                className="text-muted-foreground"
              >
                {preparing ? '사진 준비 중…' : '파일 추가'}
              </Button>
            </div>
          )}

          <Button
            block
            onClick={handleSessionConfirm}
            disabled={preparing}
            style={{ height: 48, borderRadius: 12, fontWeight: 700, fontSize: 15 }}
          >
            확인{sessionFiles.length > 0 ? ` (${sessionFiles.length}개 추가)` : ''}
          </Button>
        </div>
      )}

      {modalView === 'record' && displayKind === 'audio' && (
        <AudioRecorder
          defaultName={recorderDefaultName}
          onFile={handleRecorderFile}
          onCancel={backToList}
          hideCancel
        />
      )}

      {modalView === 'naming' && namingFile && (
        <div>
          <p style={{ fontSize: 13, color: TEXT_SECONDARY, margin: '0 0 8px' }}>파일 이름을 입력하세요</p>
          <div style={{ position: 'relative', marginBottom: 8 }}>
            <Input
              type="text"
              value={namingInput}
              onChange={(e) => setNamingInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleNamingConfirm()}
              maxLength={50}
              autoFocus
              style={{ fontSize: 15, padding: namingFile.ext ? '0 56px 0 14px' : '0 14px' }}
              onFocus={(e) => e.target.select()}
            />
            {namingFile.ext && (
              <span style={{
                position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
                fontSize: 13, color: TEXT_INACTIVE, pointerEvents: 'none',
              }}>
                {namingFile.ext}
              </span>
            )}
          </div>
          <Button
            block
            onClick={handleNamingConfirm}
            disabled={!namingInput.trim()}
            style={{ height: 48, borderRadius: 12, fontWeight: 700, fontSize: 15 }}
          >
            추가
          </Button>
        </div>
      )}
      </DialogContent>
    </Dialog>
  );
}
