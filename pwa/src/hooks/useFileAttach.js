import { useState, useRef } from 'react';
import { validateFile, splitFileName } from '../utils/audioFile.js';

/** 숙제 파일 첨부 공통 상한 — 세 페이지(피드백·학생 제출·숙제 출제) 동일 */
export const MAX_FILES = 5;

/**
 * 숙제 파일 첨부 모달 공용 훅 — FileAttachModal 과 짝으로 쓴다.
 *
 * 세 페이지(HomeworkDetailPage·PersonalHomeworkDetailPage·HomeworkFormPage)의
 * 파일 첨부 로직(모달 state·picker·검증·이름 짓기·카테고리별 확정)을 담는다.
 *
 * @param {Object} opts
 * @param {(index: number) => string} opts.genName - 자동 파일 이름 생성 (1-base index)
 * @param {number} opts.fixedCount - 기존 저장본 + 외부 pending 파일 수 (페이지마다 계산이 다름)
 * @param {number} [opts.maxFiles] - 첨부 상한 (기본 MAX_FILES)
 * @param {Object} opts.message - App.useApp() 의 message 인스턴스
 * @param {(kind: 'audio'|'document', files: Array) => void} opts.onConfirm
 *   - 모달 확인 시 sessionFiles 를 카테고리별 pending 으로 머지하는 콜백
 * @returns 훅 state·핸들러 묶음 — FileAttachModal 의 attach prop 으로 그대로 전달
 */
export default function useFileAttach({ genName, fixedCount, maxFiles = MAX_FILES, message, onConfirm }) {
  // 모달 — kind 가 null이면 닫힘. 'audio' 또는 'document'.
  // view: 'list' | 'record' | 'naming' (document 카테고리에선 record 없음)
  const [modalKind, setModalKind] = useState(null);
  const [modalView, setModalView] = useState('list');

  // sessionFiles: 모달이 열려 있는 동안만 누적되는 임시 목록. 확인 누르면 onConfirm 으로 머지.
  // 항목: { tempId, file, baseName, ext } — ext는 점 포함(`.mp3`) 또는 빈 문자열
  const [sessionFiles, setSessionFiles] = useState([]);
  // namingFile: { file, ext } — 원본 확장자를 보존해 업로드 시 다시 결합
  const [namingFile, setNamingFile] = useState(null);
  const [namingInput, setNamingInput] = useState('');
  const audioInputRef = useRef(null);
  const docInputRef = useRef(null);

  // 외부 페이지·기존 저장본·모달 임시 목록 합산 — 상한 판정에 쓰인다.
  const totalCount = fixedCount + sessionFiles.length;

  const openModal = (kind) => {
    setSessionFiles([]);
    setNamingFile(null);
    setModalView('list');
    setModalKind(kind);
  };
  const closeModal = () => {
    // antd v6 Modal 의 destroyOnHidden 가 children unmount 를 처리하므로 setTimeout 으로 미룰 필요 없음.
    // 옛 패턴(300ms 후 리셋)이 닫힘 애니메이션과 race 를 만들어 modalView='record' 잔존 버그를 만들었음.
    setModalKind(null);
    setModalView('list');
    setSessionFiles([]);
    setNamingFile(null);
  };
  const backToList = () => setModalView('list');

  const removeSessionFile = (tempId) => setSessionFiles((prev) => prev.filter((f) => f.tempId !== tempId));

  const addToSession = (file, baseName, ext) => {
    setSessionFiles((prev) => [
      ...prev,
      { tempId: Date.now() + Math.random(), file, baseName: (baseName || '').trim(), ext: ext || '' },
    ]);
    setModalView('list');
    setNamingFile(null);
  };

  const guardLimit = () => {
    if (totalCount >= maxFiles) {
      message.error(`파일은 최대 ${maxFiles}개까지 첨부할 수 있어요`);
      return false;
    }
    return true;
  };

  const tryOpenAudioPicker = () => {
    if (!guardLimit()) return;
    audioInputRef.current?.click();
  };
  const tryOpenDocPicker = () => {
    if (!guardLimit()) return;
    docInputRef.current?.click();
  };
  const tryOpenRecord = () => {
    if (!guardLimit()) return;
    setModalView('record');
  };

  // 녹음 파일 picker — 단일은 naming, 다중은 자동 이름.
  const handleAudioPickChange = (e) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;

    for (const f of files) {
      const v = validateFile(f, { expectedCategory: 'audio' });
      if (!v.ok) { message.error(v.error); return; }
    }
    if (totalCount + files.length > maxFiles) {
      message.error(`파일은 최대 ${maxFiles}개까지 첨부할 수 있어요`);
      return;
    }

    if (files.length === 1) {
      const file = files[0];
      const { ext } = splitFileName(file.name);
      setNamingInput(genName(totalCount + 1));
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
        baseName: genName(baseStart + i + 1),
        ext: ext || '',
      };
    });
    setSessionFiles((prev) => [...prev, ...newOnes]);
  };

  // 이미지·PDF picker — 원본 파일명 그대로 보존 (없으면 file_N 폴백).
  const handleDocPickChange = (e) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;

    for (const f of files) {
      const v = validateFile(f, { expectedCategory: 'document' });
      if (!v.ok) { message.error(v.error); return; }
    }
    if (totalCount + files.length > maxFiles) {
      message.error(`파일은 최대 ${maxFiles}개까지 첨부할 수 있어요`);
      return;
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

  // 직접 녹음도 picker와 동일하게 검증 — 장시간 녹음이 20MB를 넘으면
  // 제출 시점 서버 에러 대신 여기서 바로 안내
  const handleRecorderFile = (file) => {
    const check = validateFile(file);
    if (!check.ok) { message.error(check.error); return; }
    const { base, ext } = splitFileName(file.name);
    addToSession(file, base, ext);
  };

  // 모달 확인 — sessionFiles 를 해당 카테고리 pending 으로 머지(onConfirm).
  const handleSessionConfirm = () => {
    if (sessionFiles.length > 0) {
      onConfirm(modalKind, sessionFiles);
    }
    closeModal();
  };

  return {
    // state
    modalKind,
    modalView,
    sessionFiles,
    namingFile,
    namingInput,
    setNamingInput,
    audioInputRef,
    docInputRef,
    totalCount,
    // AudioRecorder 용
    recorderDefaultName: genName(totalCount + 1),
    handleRecorderFile,
    // 핸들러
    openModal,
    closeModal,
    backToList,
    removeSessionFile,
    tryOpenAudioPicker,
    tryOpenDocPicker,
    tryOpenRecord,
    handleAudioPickChange,
    handleDocPickChange,
    handleNamingConfirm,
    handleSessionConfirm,
  };
}
