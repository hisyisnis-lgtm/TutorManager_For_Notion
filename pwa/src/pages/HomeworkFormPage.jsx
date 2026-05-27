import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Input, Modal, Select, Spin, App } from 'antd';
import { ArrowLeftIcon, MicrophoneIcon, ImageSquareIcon } from '@phosphor-icons/react';
import PageHeader from '../components/layout/PageHeader.jsx';
import AudioRecorder from '../components/ui/AudioRecorder.jsx';
import { createHomework, notifyHomework, uploadTeacherFile } from '../api/homework.js';
import { queryAll } from '../api/notionClient.js';
import { parseStudent } from '../api/students.js';
import {
  PRIMARY, PRIMARY_BG,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_TERTIARY, TEXT_DISABLED,
  BORDER_NEUTRAL,
} from '../constants/theme.js';
import {
  validateFile,
  splitFileName,
  ACCEPT_AUDIO,
  ACCEPT_DOCUMENT,
} from '../utils/audioFile.js';

const STUDENT_DB = '314838fa-f2a6-8143-a6c7-e59c50f3bbdb';
const MAX_FILES = 5;

const LABEL = { fontSize: 14, color: TEXT_SECONDARY, display: 'block', marginBottom: 6, fontWeight: 600 };

function genAssignmentName(title, index) {
  const base = (title || '숙제').replace(/[^\w가-힣]/g, '').slice(0, 20) || '숙제';
  return `${base}_숙제_${String(index).padStart(2, '0')}`;
}

export default function HomeworkFormPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const presetStudentId = searchParams.get('studentId');
  const { message } = App.useApp();

  const [students, setStudents] = useState([]);
  const [studentId, setStudentId] = useState(presetStudentId || '');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // 카테고리별 외부 pending
  const [pendingAudio, setPendingAudio] = useState([]);
  const [pendingDocs, setPendingDocs] = useState([]);

  // 모달
  const [modalKind, setModalKind] = useState(null); // 'audio' | 'document' | null
  const [modalView, setModalView] = useState('list'); // 'list' | 'record' | 'naming'
  const [sessionFiles, setSessionFiles] = useState([]);
  const [namingFile, setNamingFile] = useState(null);
  const [namingInput, setNamingInput] = useState('');
  const audioInputRef = useRef(null);
  const docInputRef = useRef(null);

  useEffect(() => {
    queryAll(STUDENT_DB, { property: '상태', select: { equals: '🟢 수강중' } }, [
      { property: '이름', direction: 'ascending' },
    ]).then((pages) => {
      setStudents(pages.map(parseStudent));
    }).catch(() => {});
  }, []);

  const pendingTotal = pendingAudio.length + pendingDocs.length;
  const fixedCount = pendingTotal; // 등록 단계라 "기존 저장본"이 없음
  const totalCount = fixedCount + sessionFiles.length;

  const openModal = (kind) => {
    setSessionFiles([]);
    setNamingFile(null);
    setModalView('list');
    setModalKind(kind);
  };
  const closeModal = () => {
    // antd v6 Modal 의 destroyOnHidden 가 children unmount 를 처리하므로 setTimeout 으로 미룰 필요 없음.
    setModalKind(null);
    setModalView('list');
    setSessionFiles([]);
    setNamingFile(null);
  };

  const removePendingAudio = (tempId) => setPendingAudio((prev) => prev.filter((f) => f.tempId !== tempId));
  const removePendingDoc = (tempId) => setPendingDocs((prev) => prev.filter((f) => f.tempId !== tempId));
  const removeSessionFile = (tempId) => setSessionFiles((prev) => prev.filter((f) => f.tempId !== tempId));

  const addToSession = (file, baseName, ext) => {
    setSessionFiles((prev) => [
      ...prev,
      { tempId: Date.now() + Math.random(), file, baseName: (baseName || '').trim(), ext: ext || '' },
    ]);
    setModalView('list');
    setNamingFile(null);
  };

  const tryOpenAudioPicker = () => {
    if (totalCount >= MAX_FILES) { message.error(`파일은 최대 ${MAX_FILES}개까지 첨부할 수 있어요`); return; }
    audioInputRef.current?.click();
  };
  const tryOpenDocPicker = () => {
    if (totalCount >= MAX_FILES) { message.error(`파일은 최대 ${MAX_FILES}개까지 첨부할 수 있어요`); return; }
    docInputRef.current?.click();
  };
  const tryOpenRecord = () => {
    if (totalCount >= MAX_FILES) { message.error(`파일은 최대 ${MAX_FILES}개까지 첨부할 수 있어요`); return; }
    setModalView('record');
  };

  const handleAudioPickChange = (e) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    for (const f of files) {
      const v = validateFile(f, { expectedCategory: 'audio' });
      if (!v.ok) { message.error(v.error); return; }
    }
    if (totalCount + files.length > MAX_FILES) {
      message.error(`파일은 최대 ${MAX_FILES}개까지 첨부할 수 있어요`); return;
    }
    if (files.length === 1) {
      const file = files[0];
      const { ext } = splitFileName(file.name);
      setNamingInput(genAssignmentName(title, totalCount + 1));
      setNamingFile({ file, ext });
      setModalView('naming');
      return;
    }
    const baseStart = totalCount;
    const newOnes = files.map((file, i) => {
      const { ext } = splitFileName(file.name);
      return {
        tempId: Date.now() + Math.random() + i,
        file,
        baseName: genAssignmentName(title, baseStart + i + 1),
        ext: ext || '',
      };
    });
    setSessionFiles((prev) => [...prev, ...newOnes]);
  };

  const handleDocPickChange = (e) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    for (const f of files) {
      const v = validateFile(f, { expectedCategory: 'document' });
      if (!v.ok) { message.error(v.error); return; }
    }
    if (totalCount + files.length > MAX_FILES) {
      message.error(`파일은 최대 ${MAX_FILES}개까지 첨부할 수 있어요`); return;
    }
    const newOnes = files.map((file, i) => {
      const { base, ext } = splitFileName(file.name);
      return {
        tempId: Date.now() + Math.random() + i,
        file,
        baseName: base || `file_${totalCount + i + 1}`,
        ext: ext || '',
      };
    });
    setSessionFiles((prev) => [...prev, ...newOnes]);
  };

  const handleNamingConfirm = () => {
    if (!namingInput.trim() || !namingFile) return;
    addToSession(namingFile.file, namingInput, namingFile.ext);
  };

  const handleSessionConfirm = () => {
    if (sessionFiles.length > 0) {
      if (modalKind === 'audio') setPendingAudio((prev) => [...prev, ...sessionFiles]);
      else if (modalKind === 'document') setPendingDocs((prev) => [...prev, ...sessionFiles]);
    }
    closeModal();
  };

  const handleSubmit = async () => {
    if (!studentId) { setError('학생을 선택해주세요.'); return; }
    if (!title.trim()) { setError('숙제 제목을 입력해주세요.'); return; }

    setSaving(true);
    setError(null);
    try {
      const all = [...pendingAudio, ...pendingDocs];
      const uploaded = [];
      for (const pf of all) {
        const fullName = pf.baseName + pf.ext;
        const namedFile = new File([pf.file], fullName, { type: pf.file.type });
        const { fileUploadId } = await uploadTeacherFile(namedFile);
        uploaded.push({ fileUploadId, fileName: fullName });
      }
      const created = await createHomework({
        studentPageId: studentId,
        title: title.trim(),
        content: content.trim(),
        files: uploaded.length > 0 ? uploaded : undefined,
      });
      if (created?.id) notifyHomework('assign', created.id);
      navigate(-1);
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  const studentOptions = students.map((s) => ({
    value: s.id,
    label: s.name.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*/gu, '').trim(),
  }));

  const modalTitle = (() => {
    if (modalView === 'record') return '음성 녹음';
    if (modalView === 'naming') return '파일 이름 입력';
    if (modalKind === 'audio') return '녹음 파일';
    if (modalKind === 'document') return '이미지·PDF';
    return '숙제 파일';
  })();

  return (
    <>
      <PageHeader title="숙제 등록" back />

      <div className="px-4 pt-4 pb-24 space-y-5">
        {/* 학생 선택 */}
        <div>
          <label style={LABEL}>학생</label>
          {presetStudentId ? (
            <div style={{ fontSize: 15, fontWeight: 600, color: TEXT_PRIMARY, padding: '8px 0' }}>
              {studentOptions.find((o) => o.value === presetStudentId)?.label ?? '…'}
            </div>
          ) : (
            <Select
              value={studentId || undefined}
              onChange={setStudentId}
              placeholder="학생 선택"
              style={{ width: '100%' }}
              showSearch
              filterOption={(input, option) => option.label.toLowerCase().includes(input.toLowerCase())}
              options={studentOptions}
              size="large"
            />
          )}
        </div>

        {/* 숙제 제목 */}
        <div>
          <label htmlFor="hw-title" style={LABEL}>숙제 제목</label>
          <Input
            id="hw-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예) 1과 본문 읽기"
            size="large"
            maxLength={100}
            style={{ borderRadius: 12 }}
          />
        </div>

        {/* 숙제 내용 */}
        <div>
          <label htmlFor="hw-content" style={LABEL}>숙제 내용</label>
          <Input.TextArea
            id="hw-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="학생에게 전달할 숙제 내용을 입력하세요"
            rows={5}
            maxLength={1000}
            showCount
            style={{ borderRadius: 12 }}
          />
        </div>

        {/* 숙제 파일 — 카테고리별 섹션 */}
        <div>
          <label style={LABEL}>숙제 파일 <span style={{ fontWeight: 400, color: TEXT_TERTIARY }}>(선택)</span></label>

          {pendingAudio.length > 0 && (
            <PendingCard
              label={`새 녹음 파일 (${pendingAudio.length}/${MAX_FILES})`}
              items={pendingAudio}
              onRemove={removePendingAudio}
            />
          )}
          {fixedCount < MAX_FILES && (
            <SectionEntryButton
              icon={<MicrophoneIcon size={18} weight="fill" />}
              label="녹음 파일 추가"
              onClick={() => openModal('audio')}
            />
          )}

          {pendingDocs.length > 0 && (
            <PendingCard
              label={`새 이미지·PDF (${pendingDocs.length}/${MAX_FILES})`}
              items={pendingDocs}
              onRemove={removePendingDoc}
            />
          )}
          {fixedCount < MAX_FILES && (
            <SectionEntryButton
              icon={<ImageSquareIcon size={18} weight="fill" />}
              label="이미지·PDF 추가"
              onClick={() => openModal('document')}
            />
          )}
        </div>

        {error && (
          <Alert type="error" message={error} showIcon style={{ borderRadius: 12 }} />
        )}

        <Button
          type="primary"
          block
          size="large"
          onClick={handleSubmit}
          loading={saving}
          style={{ borderRadius: 12, fontWeight: 600, height: 44 }}
        >
          등록하기{pendingTotal > 0 ? ` (${pendingTotal}개 파일)` : ''}
        </Button>
      </div>

      {/* ===== 파일 추가 팝업 — kind 분기 ===== */}
      <Modal
        open={modalKind !== null}
        onCancel={closeModal}
        footer={null}
        closable={false}
        maskClosable={false}
        keyboard={false}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {modalView !== 'list' && (
              <button
                type="button"
                onClick={() => setModalView('list')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: TEXT_SECONDARY, padding: '0 4px 0 0', display: 'flex', alignItems: 'center' }}
                aria-label="뒤로"
              ><ArrowLeftIcon size={18} weight="bold" /></button>
            )}
            <span style={{ fontSize: 16, fontWeight: 700 }}>{modalTitle}</span>
          </div>
        }
        centered
        destroyOnHidden
        styles={{ body: { paddingTop: 8, paddingBottom: 4 } }}
      >
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
                <p style={{ fontSize: 13, fontWeight: 600, color: TEXT_SECONDARY, margin: '0 0 6px' }}>
                  추가된 파일 ({sessionFiles.length}개)
                </p>
                {sessionFiles.map((pf) => (
                  <div key={pf.tempId} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 12px', background: '#f6ffed', border: '1px solid #b7eb8f',
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
                fontSize: 13, color: TEXT_TERTIARY, textAlign: 'center',
                padding: '14px 0 16px', margin: 0, lineHeight: 1.6,
              }}>
                {modalKind === 'audio'
                  ? '추가할 녹음 파일을 선택하거나 직접 녹음해주세요'
                  : '추가할 이미지 또는 PDF 파일을 선택해주세요'}
              </p>
            )}

            {modalKind === 'audio' ? (
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <button
                  type="button"
                  onClick={tryOpenAudioPicker}
                  style={{ flex: 1, height: 44, borderRadius: 12, background: 'white', border: `1.5px solid ${BORDER_NEUTRAL}`, color: TEXT_SECONDARY, fontSize: 14, fontWeight: 600, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
                >
                  파일 추가
                </button>
                <button
                  type="button"
                  onClick={tryOpenRecord}
                  style={{ flex: 1, height: 44, borderRadius: 12, background: 'white', border: `1.5px solid ${BORDER_NEUTRAL}`, color: TEXT_SECONDARY, fontSize: 14, fontWeight: 600, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
                >
                  바로 녹음
                </button>
              </div>
            ) : (
              <div style={{ marginBottom: 10 }}>
                <button
                  type="button"
                  onClick={tryOpenDocPicker}
                  style={{ width: '100%', height: 44, borderRadius: 12, background: 'white', border: `1.5px solid ${BORDER_NEUTRAL}`, color: TEXT_SECONDARY, fontSize: 14, fontWeight: 600, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
                >
                  파일 추가
                </button>
              </div>
            )}

            <Button
              type="primary"
              block
              onClick={handleSessionConfirm}
              style={{ borderRadius: 12, height: 48, fontWeight: 700, fontSize: 15 }}
            >
              확인{sessionFiles.length > 0 ? ` (${sessionFiles.length}개 추가)` : ''}
            </Button>
          </div>
        )}

        {modalView === 'record' && modalKind === 'audio' && (
          <AudioRecorder
            defaultName={genAssignmentName(title, totalCount + 1)}
            onFile={(file) => {
              const { base, ext } = splitFileName(file.name);
              addToSession(file, base, ext);
            }}
            onCancel={() => setModalView('list')}
            hideCancel
          />
        )}

        {modalView === 'naming' && namingFile && (
          <div>
            <p style={{ fontSize: 13, color: TEXT_SECONDARY, margin: '0 0 8px' }}>파일 이름을 입력하세요</p>
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <input
                type="text"
                value={namingInput}
                onChange={(e) => setNamingInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleNamingConfirm()}
                maxLength={50}
                autoFocus
                style={{
                  width: '100%', height: 44, borderRadius: 12, border: '1.5px solid #d9d9d9',
                  padding: namingFile.ext ? '0 56px 0 14px' : '0 14px',
                  fontSize: 15, color: TEXT_PRIMARY,
                  boxSizing: 'border-box', outline: 'none',
                }}
                onFocus={(e) => e.target.select()}
              />
              {namingFile.ext && (
                <span style={{
                  position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
                  fontSize: 13, color: TEXT_TERTIARY, pointerEvents: 'none',
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

      {/* 업로드 중 딤 오버레이 */}
      {saving && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <Spin size="large" />
        </div>
      )}
    </>
  );
}

// ===== 보조 컴포넌트 =====

function PendingCard({ label, items, onRemove }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <p style={{ fontSize: 13, fontWeight: 600, color: TEXT_SECONDARY, margin: '0 0 6px' }}>{label}</p>
      {items.map((pf) => (
        <div key={pf.tempId} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px', background: '#f6ffed', border: '1px solid #b7eb8f',
          borderRadius: 12, marginBottom: 6,
        }}>
          <span style={{ fontSize: 13, color: TEXT_PRIMARY, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {pf.baseName + pf.ext}
          </span>
          <button
            type="button"
            onClick={() => onRemove(pf.tempId)}
            style={{ marginLeft: 10, background: 'none', border: 'none', cursor: 'pointer', color: TEXT_DISABLED, fontSize: 18, flexShrink: 0, padding: 0, lineHeight: 1 }}
            aria-label="삭제"
          >×</button>
        </div>
      ))}
    </div>
  );
}

function SectionEntryButton({ icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%', height: 44, borderRadius: 12,
        background: PRIMARY_BG, border: '1.5px solid rgba(127,0,5,0.2)',
        color: PRIMARY, fontSize: 14, fontWeight: 600, cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent', marginBottom: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      }}
    >
      {icon}
      {label}
    </button>
  );
}
