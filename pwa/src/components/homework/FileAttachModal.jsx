import { Button, Modal } from 'antd';
import { CaretLeftIcon } from '@phosphor-icons/react';
import AudioRecorder from '../ui/AudioRecorder.jsx';
import {
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_INACTIVE, TEXT_DISABLED,
  BORDER_NEUTRAL, STATUS_SUCCESS_BG,
} from '../../constants/theme.js';
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

  const modalTitle = (() => {
    if (modalView === 'record') return '음성 녹음';
    if (modalView === 'naming') return '파일 이름 입력';
    if (modalKind === 'audio') return titles.audio;
    if (modalKind === 'document') return titles.document;
    return titles.fallback;
  })();

  return (
    <Modal
      open={modalKind !== null}
      onCancel={closeModal}
      footer={null}
      closable={false}
      mask={{ closable: false }}
      keyboard={false}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {modalView !== 'list' && (
            <button
              type="button"
              onClick={backToList}
              className="transition-[color] duration-150 ease-out"
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: TEXT_SECONDARY, padding: '0 4px 0 0', display: 'flex', alignItems: 'center' }}
              aria-label="뒤로"
            >
              <CaretLeftIcon size={18} weight="bold" />
            </button>
          )}
          <span style={{ fontSize: 16, fontWeight: 700 }}>{modalTitle}</span>
        </div>
      }
      centered
      destroyOnHidden
      styles={{ body: { paddingTop: 8, paddingBottom: 4 } }}
    >
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
                  padding: '8px 12px', background: STATUS_SUCCESS_BG, border: '1px solid #b7eb8f',
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
              padding: '14px 0 16px', margin: 0, lineHeight: 1.6,
            }}>
              {modalKind === 'audio' ? hints.audio : hints.document}
            </p>
          )}

          {modalKind === 'audio' ? (
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <button
                type="button"
                onClick={tryOpenAudioPicker}
                className="transition-[background-color] duration-150 ease-out"
                style={{ flex: 1, height: 44, borderRadius: 12, background: 'white', border: `1.5px solid ${BORDER_NEUTRAL}`, color: TEXT_SECONDARY, fontSize: 14, fontWeight: 600, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
              >
                파일 추가
              </button>
              <button
                type="button"
                onClick={tryOpenRecord}
                className="transition-[background-color] duration-150 ease-out"
                style={{ flex: 1, height: 44, borderRadius: 12, background: 'white', border: `1.5px solid ${BORDER_NEUTRAL}`, color: TEXT_SECONDARY, fontSize: 14, fontWeight: 600, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
              >
                바로 녹음
              </button>
            </div>
          ) : (
            <div style={{ marginBottom: 10 }}>
              {/* 고른 사진을 줄이는 동안(여러 장이면 몇 초) 버튼을 잠그고 상태를 보여준다 —
                  아무 반응이 없으면 학생이 같은 버튼을 다시 누르게 된다 */}
              <button
                type="button"
                onClick={tryOpenDocPicker}
                disabled={preparing}
                className="transition-[background-color] duration-150 ease-out"
                style={{ width: '100%', height: 44, borderRadius: 12, background: 'white', border: `1.5px solid ${BORDER_NEUTRAL}`, color: preparing ? TEXT_INACTIVE : TEXT_SECONDARY, fontSize: 14, fontWeight: 600, cursor: preparing ? 'progress' : 'pointer', WebkitTapHighlightColor: 'transparent' }}
              >
                {preparing ? '사진 준비 중…' : '파일 추가'}
              </button>
            </div>
          )}

          <Button
            type="primary"
            block
            onClick={handleSessionConfirm}
            disabled={preparing}
            style={{ height: 48, borderRadius: 12, fontWeight: 700, fontSize: 15 }}
          >
            확인{sessionFiles.length > 0 ? ` (${sessionFiles.length}개 추가)` : ''}
          </Button>
        </div>
      )}

      {modalView === 'record' && modalKind === 'audio' && (
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
            <input
              type="text"
              value={namingInput}
              onChange={(e) => setNamingInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleNamingConfirm()}
              maxLength={50}
              autoFocus
              style={{
                width: '100%', height: 44, borderRadius: 12,
                border: `1.5px solid ${BORDER_NEUTRAL}`,
                padding: namingFile.ext ? '0 56px 0 14px' : '0 14px',
                fontSize: 15, color: TEXT_PRIMARY, boxSizing: 'border-box', outline: 'none',
              }}
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
            type="primary"
            block
            onClick={handleNamingConfirm}
            disabled={!namingInput.trim()}
            style={{ height: 48, borderRadius: 12, fontWeight: 700, fontSize: 15 }}
          >
            추가
          </Button>
        </div>
      )}
    </Modal>
  );
}
