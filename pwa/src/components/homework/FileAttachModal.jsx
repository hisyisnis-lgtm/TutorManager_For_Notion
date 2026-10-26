import { useRef } from 'react';
import { Button } from '../shadcn/button';
import { Input } from '../shadcn/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../shadcn/dialog';
import { CaretLeftIcon, PlusIcon } from '@phosphor-icons/react';
import AudioRecorder from '../ui/AudioRecorder.jsx';
import {
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_INACTIVE,
  TEXT_DISABLED,
  STATUS_SUCCESS_BG,
  STATUS_SUCCESS_BORDER } from '../../constants/theme.js';
import { ACCEPT_AUDIO, ACCEPT_DOCUMENT } from '../../utils/audioFile.js';
import { MAX_FILE_MB } from '../../utils/audioFile.js';
import { MAX_TOTAL_FILE_MB, formatHomeworkBytes } from '../../utils/homeworkLimits.js';

/**
 * 숙제 파일 첨부 모달 — useFileAttach 훅과 짝으로 쓴다.
 * list(파일 목록·picker 진입) / record(음성 녹음) / naming(단일 파일 이름 입력) 3개 뷰.
 *
 * @param {Object} props
 * @param {Object} props.attach - useFileAttach() 반환값 전체
 * @param {{ audio: string, document: string, fallback: string }} props.titles - list 뷰 모달 제목 (페이지별 문구)
 * @param {{ audio: string, document: string }} props.hints - 빈 목록 안내 문구 (페이지별 문구)
 * @param {boolean} [props.compact=false] - 학생용 간단한 첨부 안내
 */
export default function FileAttachModal({ attach, titles, hints, compact = false }) {
  const {
    modalKind, modalView, sessionFiles, namingFile, namingInput, setNamingInput, directSelection,
    audioInputRef, docInputRef, fileInputRef, recorderDefaultName, handleRecorderFile, preparing,
    closeModal, backToList, removeSessionFile,
    tryOpenAudioPicker, tryOpenDocPicker, tryOpenRecord,
    handleAudioPickChange, handleDocPickChange, handleFilePickChange,
    handleNamingConfirm, handleSessionConfirm,
    totalCount, totalBytes, unknownSizeCount, maxFiles,
  } = attach;

  // 닫힘 애니메이션 동안 modalKind는 이미 null인데 Dialog는 화면에 남아 있어
  // 제목·버튼이 fallback으로 번쩍 바뀌었다("파일 제출" 플래시, 2026-08-31).
  // 렌더링용 kind·view는 마지막 값을 유지한다 — 닫힘 중 목록 화면으로 바뀌지 않게 한다.
  const lastKindRef = useRef(null);
  const lastViewRef = useRef(modalView);
  if (modalKind !== null) {
    lastKindRef.current = modalKind;
    lastViewRef.current = modalView;
  }
  const displayKind = modalKind ?? lastKindRef.current;
  const displayView = modalKind !== null ? modalView : lastViewRef.current;
  const hasSessionFiles = sessionFiles.length > 0;

  const modalTitle = (() => {
    if (displayView === 'record') return '음성 녹음';
    if (displayView === 'naming') return compact ? '파일 이름' : '파일 이름 입력';
    if (displayKind === 'audio') return titles.audio;
    if (displayKind === 'document') return titles.document;
    return titles.fallback;
  })();

  return (
    <>
    {/* Dialog가 닫힌 상태에서도 직접 파일 선택 버튼의 ref를 유지한다. */}
    <input
      ref={fileInputRef}
      type="file"
      aria-label="첨부할 파일 선택"
      accept={`${ACCEPT_AUDIO},${ACCEPT_DOCUMENT}`}
      multiple
      style={{ display: 'none' }}
      onChange={handleFilePickChange}
    />
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
        className="max-h-[calc(100dvh-32px)] overflow-y-auto pt-4"
      >
      <DialogHeader>
        <DialogTitle asChild>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {displayView !== 'list' && (
            <button
              type="button"
              onClick={directSelection ? closeModal : backToList}
              disabled={preparing}
              className="h-11 w-11 shrink-0 justify-center rounded-xl transition-[color,transform] duration-150 ease-out active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: TEXT_SECONDARY, padding: 0, display: 'flex', alignItems: 'center' }}
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
      {displayView === 'list' && (
        <div>
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground" aria-live="polite">
            {compact ? (
              <>최대 {maxFiles}개 · 파일당 {MAX_FILE_MB}MB · 총 {MAX_TOTAL_FILE_MB}MB</>
            ) : (
              <>
                전체 {totalCount}/{maxFiles}개 · {unknownSizeCount ? '기존 파일 용량은 제출 시 확인' : `현재 ${formatHomeworkBytes(totalBytes)}`}
                <br />파일당 {MAX_FILE_MB}MB · 전체 {MAX_TOTAL_FILE_MB}MB · 최종 제출할 때 압축 후 용량 확인
              </>
            )}
          </p>
          {hasSessionFiles ? (
            <div style={{ marginBottom: 12, maxHeight: 'min(40dvh, 320px)', overflowY: 'auto' }}>
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
                    disabled={preparing}
                    className="h-11 w-11 rounded-xl transition-transform active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                    style={{ marginLeft: 10, background: 'none', border: 'none', cursor: 'pointer', color: TEXT_DISABLED, fontSize: 18, flexShrink: 0, padding: 0, lineHeight: 1 }}
                    aria-label={`${pf.baseName + pf.ext} 삭제`}
                  >×</button>
                </div>
              ))}
            </div>
          ) : !compact && (
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
              <Button type="button" variant="outline" onClick={tryOpenAudioPicker} disabled={preparing} className={compact ? 'flex-1' : 'flex-1 text-muted-foreground'}>
                {compact && hasSessionFiles && <PlusIcon size={20} aria-hidden />}
                {compact ? (hasSessionFiles ? '파일 더 고르기' : '녹음 파일 고르기') : '파일 추가'}
              </Button>
              <Button type="button" variant="outline" onClick={tryOpenRecord} disabled={preparing} className={compact ? 'flex-1' : 'flex-1 text-muted-foreground'}>
                녹음하기
              </Button>
            </div>
          ) : (
            <div style={{ marginBottom: 12 }}>
              <Button
                type="button"
                variant={compact && !hasSessionFiles ? 'default' : 'outline'}
                block
                onClick={tryOpenDocPicker}
                disabled={preparing}
                className={compact ? undefined : 'text-muted-foreground'}
              >
                {compact && hasSessionFiles && <PlusIcon size={20} aria-hidden />}
                {compact ? (hasSessionFiles ? '파일 더 고르기' : '파일 고르기') : '파일 추가'}
              </Button>
            </div>
          )}

          <Button
            block
            variant={compact && !hasSessionFiles ? 'ghost' : 'default'}
            onClick={compact && !hasSessionFiles ? closeModal : handleSessionConfirm}
            disabled={preparing}
            style={{ height: 48, borderRadius: 12, fontWeight: compact ? 600 : 700, fontSize: 15 }}
          >
            {compact
              ? (hasSessionFiles ? `선택 완료 · ${sessionFiles.length}개` : '닫기')
              : `확인${hasSessionFiles ? ` (${sessionFiles.length}개 추가)` : ''}`}
          </Button>
        </div>
      )}

      {displayView === 'record' && displayKind === 'audio' && (
        <AudioRecorder
          defaultName={recorderDefaultName}
          onFile={handleRecorderFile}
          onCancel={directSelection ? closeModal : backToList}
          previewConfirmLabel={directSelection ? '녹음 사용하기' : undefined}
          embedded={compact && directSelection}
          hideCancel
        />
      )}

      {displayView === 'naming' && namingFile && (
        <div>
          <p style={{ fontSize: 13, color: TEXT_SECONDARY, margin: '0 0 8px' }}>{compact ? '파일 이름' : '파일 이름을 입력하세요'}</p>
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
    </>
  );
}
