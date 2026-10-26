import { useState, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { validateFile, splitFileName } from '../utils/audioFile.js';
import { compressImage } from '../utils/imageCompress.js';
import { compressExternalFile } from '../utils/fileCompression.js';
import { ensureCompleteFile, truncatedFileMessage } from '../utils/audioIntegrity.js';
import { MAX_FILES, homeworkFileSize, homeworkFileUsage, validateHomeworkFiles } from '../utils/homeworkLimits.js';

export { MAX_FILES } from '../utils/homeworkLimits.js';

/** 선택은 원본을 목록에 담기만 하고, 읽기·압축·최종 용량 검증은 제출 시 한 번에 수행한다. */
export default function useFileAttach({ genName, fixedFiles = [], maxFiles = MAX_FILES, loadFileSizes, attachmentScope = '', directSelection = false, onConfirm }) {
  const [modalKind, setModalKind] = useState(null);
  const [modalView, setModalView] = useState('list');
  const [sessionFiles, setSessionFiles] = useState([]);
  const [namingFile, setNamingFile] = useState(null);
  const [namingInput, setNamingInput] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [preparation, setPreparation] = useState({ stage: null, message: '', detail: '' });
  const [sizeError, setSizeError] = useState(false);
  const [fileSizes, setFileSizes] = useState({});
  const audioInputRef = useRef(null);
  const docInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const busyRef = useRef(false);
  const epochRef = useRef(0);
  const preparationIdRef = useRef(0);
  const sizesRef = useRef({});
  const preparedFilesRef = useRef(new WeakMap());
  const prepareController = useRef(null);
  useEffect(() => () => {
    epochRef.current += 1;
    preparationIdRef.current += 1;
    prepareController.current?.abort();
  }, []);

  const resetPreparation = () => {
    preparationIdRef.current += 1;
    setPreparation({ stage: null, message: '', detail: '' });
  };
  const cancelPreparation = () => {
    // 이전 작업의 finally/Worker 응답보다 먼저 무효화해 새 제출 준비를 즉시 시작할 수 있게 한다.
    epochRef.current += 1;
    preparationIdRef.current += 1;
    prepareController.current?.abort();
    prepareController.current = null;
    busyRef.current = false;
    setPreparing(false);
    setSizeError(false);
    resetPreparation();
  };
  const sizeCacheKey = (item) => JSON.stringify([attachmentScope, item.name, item.url ?? null]);
  const resolveFixedFiles = (sizes = sizesRef.current, files = fixedFiles) => files.map((item) => (
    homeworkFileSize(item) === null && sizes[sizeCacheKey(item)] !== undefined
      ? { ...item, size: sizes[sizeCacheKey(item)] } : item
  ));
  const totalUsage = homeworkFileUsage([...resolveFixedFiles(fileSizes), ...sessionFiles]);
  const totalCount = totalUsage.count;

  const refreshFileSizes = async (existingFiles) => {
    const epoch = epochRef.current;
    if (!resolveFixedFiles(sizesRef.current, existingFiles).some((item) => homeworkFileSize(item) === null)) return sizesRef.current;
    if (!loadFileSizes) throw new Error('기존 파일 용량을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
    const result = await loadFileSizes();
    const sizes = Object.fromEntries((result.files ?? []).filter((item) => homeworkFileSize(item) !== null).map((item) => [
      sizeCacheKey(existingFiles.find((fixed) => fixed.name === item.name) ?? item), homeworkFileSize(item),
    ]));
    const merged = { ...sizesRef.current, ...sizes };
    if (resolveFixedFiles(merged, existingFiles).some((item) => homeworkFileSize(item) === null)) {
      throw new Error('기존 파일 용량을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
    if (epoch === epochRef.current) {
      sizesRef.current = merged;
      setFileSizes(merged);
    }
    return merged;
  };

  const guardLimit = (count = 1) => {
    if (busyRef.current) return false;
    if (totalCount + count > maxFiles) { toast.error(`파일은 최대 ${maxFiles}개까지 첨부할 수 있어요`); return false; }
    return true;
  };
  const checkSelection = (files, category) => {
    if (!files.length || !guardLimit(files.length)) return false;
    for (const file of files) {
      const check = validateFile(file, { expectedCategory: category, skipSizeCheck: true });
      if (!check.ok) { toast.error(check.error); return false; }
    }
    return true;
  };
  const openModal = (kind) => {
    if (busyRef.current) return;
    epochRef.current += 1;
    resetPreparation();
    setSessionFiles([]);
    setNamingFile(null);
    setModalView('list');
    setModalKind(kind);
    setSizeError(false);
  };
  const closeModal = () => {
    if (busyRef.current) return;
    epochRef.current += 1;
    resetPreparation();
    setModalKind(null);
    setModalView('list');
    setSessionFiles([]);
    setNamingFile(null);
  };
  const backToList = () => { if (!busyRef.current) setModalView('list'); };
  const removeSessionFile = (tempId) => {
    if (!busyRef.current) setSessionFiles((prev) => prev.filter((item) => item.tempId !== tempId));
  };
  const addToSession = (file, baseName, ext, { category = 'audio', source = 'external' } = {}) => {
    if (!checkSelection([file], category)) return;
    setSessionFiles((prev) => [...prev, {
      tempId: Date.now() + Math.random(), file, baseName: (baseName || '').trim(), ext: ext || '', category, source,
    }]);
    setModalView('list');
    setNamingFile(null);
  };
  const tryOpenAudioPicker = () => { if (guardLimit()) audioInputRef.current?.click(); };
  const tryOpenDocPicker = () => { if (guardLimit()) docInputRef.current?.click(); };
  const tryOpenFilePicker = () => { if (guardLimit()) fileInputRef.current?.click(); };
  const tryOpenRecord = () => {
    if (!guardLimit()) return;
    if (directSelection) openModal('audio');
    setModalView('record');
  };

  const handleAudioPickChange = (event) => {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!checkSelection(picked, 'audio')) return;
    if (directSelection) {
      onConfirm('audio', picked.map((file, index) => {
        const { base, ext } = splitFileName(file.name);
        return { tempId: Date.now() + Math.random() + index, file, baseName: base || `file_${totalCount + index + 1}`, ext, category: 'audio', source: 'external' };
      }));
      return;
    }
    if (picked.length === 1) {
      const file = picked[0];
      setNamingInput(genName(totalCount + 1));
      setNamingFile({ file, ext: splitFileName(file.name).ext });
      setModalView('naming');
      return;
    }
    setSessionFiles((prev) => [...prev, ...picked.map((file, index) => ({
      tempId: Date.now() + Math.random() + index, file, baseName: genName(totalCount + index + 1),
      ext: splitFileName(file.name).ext, category: 'audio', source: 'external',
    }))]);
  };
  const handleDocPickChange = (event) => {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!checkSelection(picked, 'document')) return;
    const entries = picked.map((file, index) => {
      const { base, ext } = splitFileName(file.name);
      return { tempId: Date.now() + Math.random() + index, file, baseName: base || `file_${totalCount + index + 1}`, ext, category: 'document', source: 'external' };
    });
    if (directSelection) {
      onConfirm('document', entries);
      return;
    }
    setSessionFiles((prev) => [...prev, ...entries]);
  };
  // 통합 선택기는 파일 종류를 미리 고르게 하지 않는다. 전체를 검증한 뒤에만
  // 기존 페이지의 카테고리별 초안으로 전달해 잘못된 파일이 섞여도 일부만 추가되지 않는다.
  const handleFilePickChange = (event) => {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!picked.length || !guardLimit(picked.length)) return;
    const entries = [];
    for (const [index, file] of picked.entries()) {
      const check = validateFile(file, { skipSizeCheck: true });
      if (!check.ok) { toast.error(check.error); return; }
      const { base, ext } = splitFileName(file.name);
      entries.push({
        tempId: Date.now() + Math.random() + index,
        file,
        baseName: base || `file_${totalCount + index + 1}`,
        ext,
        category: check.category,
        source: 'external',
      });
    }
    const audio = entries.filter(entry => entry.category === 'audio');
    const documents = entries.filter(entry => entry.category === 'document');
    if (audio.length) onConfirm('audio', audio);
    if (documents.length) onConfirm('document', documents);
  };
  const handleNamingConfirm = () => {
    if (namingInput.trim() && namingFile) addToSession(namingFile.file, namingInput, namingFile.ext);
  };
  const handleRecorderFile = (file) => {
    const { base, ext } = splitFileName(file?.name);
    if (directSelection) {
      if (!checkSelection([file], 'audio')) return;
      onConfirm('audio', [{ tempId: Date.now() + Math.random(), file, baseName: base, ext, category: 'audio', source: 'recording' }]);
      closeModal();
      return;
    }
    addToSession(file, base, ext, { category: 'audio', source: 'recording' });
  };
  const handleSessionConfirm = () => {
    if (busyRef.current) return;
    if (sessionFiles.length > 0) {
      if (totalCount > maxFiles || !sessionFiles.every((item) => validateFile(item.file, { expectedCategory: item.category, skipSizeCheck: true }).ok)) return;
      onConfirm(modalKind, sessionFiles);
    }
    closeModal();
  };

  const prepareForSubmit = async (pendingFiles = [], { onStage } = {}) => {
    if (busyRef.current) return null;
    const epoch = ++epochRef.current;
    const id = ++preparationIdRef.current;
    const current = () => epoch === epochRef.current && id === preparationIdRef.current;
    const update = (stage, message = '', detail = '') => {
      if (!current()) return;
      const next = { stage, message, detail };
      setPreparation(next);
      if (stage) {
        try { onStage?.(next); } catch { /* 표시 콜백이 파일 준비를 실패시키지 않는다. */ }
      }
    };
    const controller = new AbortController();
    prepareController.current = controller;
    const startedAt = Date.now();
    const budgetTimer = setTimeout(() => controller.abort(), 30_000);
    const pendingIds = new Set(pendingFiles.map((item) => item.tempId).filter((tempId) => tempId !== undefined && tempId !== null));
    const existingFiles = fixedFiles.filter((item) => !pendingIds.has(item.tempId));
    let activeFileIndex = -1;
    busyRef.current = true;
    setPreparing(true);
    setSizeError(false);
    update('checking', '첨부파일을 확인하고 있어요');
    try {
      if (existingFiles.length + pendingFiles.length > maxFiles) throw new Error(`파일은 최대 ${maxFiles}개까지 첨부할 수 있어요`);
      // 크기 제한은 실제 압축 후 적용하지만, 지원하지 않는 타입과 빈 파일은 즉시 거절한다.
      const categories = pendingFiles.map((item) => {
        const check = validateFile(item.file, { expectedCategory: item.category, skipSizeCheck: true });
        if (!check.ok) throw new Error(check.error);
        return check.category;
      });
      if (resolveFixedFiles(sizesRef.current, existingFiles).some((item) => homeworkFileSize(item) === null)) {
        update('checking', '기존 파일 용량을 확인하고 있어요');
      }
      let sizes;
      try {
        sizes = await refreshFileSizes(existingFiles);
      } catch (error) {
        if (current()) setSizeError(true);
        throw error;
      }
      if (!current()) return null;
      const prepared = [];
      // 여러 파일의 디코딩이 겹치지 않게 처리하며, 제출 재시도에는 같은 원본의 준비 결과를 재사용한다.
      for (const [index, item] of pendingFiles.entries()) {
        activeFileIndex = index;
        const detail = `${index + 1}/${pendingFiles.length}개 파일 준비 중`;
        update('checking', '첨부파일을 확인하고 있어요', detail);
        const category = categories[index];
        const source = item.source === 'recording' ? 'recording' : 'external';
        const cacheKey = `${category}:${source}`;
        const cached = preparedFilesRef.current.get(item.file)?.get(cacheKey);
        let file = cached ?? item.file;
        if (!cached) {
          if (category === 'audio') {
            const checked = await ensureCompleteFile(file);
            if (!current()) return null;
            if (!checked.ok) {
              toast.error(truncatedFileMessage(file.name, checked.actual, checked.expected), { duration: 8000 });
              return null;
            }
            if (checked.recovered) toast.success(`"${file.name}" 녹음을 온전한 상태로 복구했어요`);
            file = checked.file;
          } else {
            update('preparing', '파일을 준비하고 있어요', detail);
            file = await compressImage(file);
            if (!current()) return null;
          }
          // 직접 녹음은 기존 32kbps와 File을 유지한다. 외부 압축에만 전체 30초 예산을 공유한다.
          if (source !== 'recording' && Date.now() - startedAt < 30_000) file = await compressExternalFile(file, {
            signal: controller.signal,
            onStage: (stage) => {
              if (activeFileIndex !== index) return;
              if (stage === 'compressing') update('compressing', '파일 용량을 줄이고 있어요', detail);
              else if (stage === 'checking') update('checking', '첨부파일을 확인하고 있어요', detail);
              else update('preparing', '파일을 준비하고 있어요', detail);
            },
          });
          if (!current()) return null;
          const check = validateFile(file, { expectedCategory: category });
          if (!check.ok) throw new Error(check.error);
          const cachedCategories = preparedFilesRef.current.get(item.file) ?? new Map();
          cachedCategories.set(cacheKey, file);
          preparedFilesRef.current.set(item.file, cachedCategories);
        }
        activeFileIndex = -1;
        update('preparing', '파일을 준비하고 있어요', detail);
        prepared.push({ ...item, file, ext: splitFileName(file.name).ext, category, source });
      }
      const check = validateHomeworkFiles([...resolveFixedFiles(sizes, existingFiles), ...prepared], { maxFiles });
      if (!check.ok) throw new Error(check.error);
      return prepared;
    } catch (error) {
      if (current()) toast.error(error.message || '파일을 준비하지 못했어요. 다시 시도해 주세요.');
      return null;
    } finally {
      activeFileIndex = -1;
      clearTimeout(budgetTimer);
      update(null);
      if (current()) { busyRef.current = false; setPreparing(false); prepareController.current = null; }
    }
  };

  return {
    modalKind, modalView, sessionFiles, namingFile, namingInput, setNamingInput, directSelection,
    audioInputRef, docInputRef, fileInputRef, totalCount, totalBytes: totalUsage.bytes,
    unknownSizeCount: totalUsage.unknownCount, maxFiles, preparing, sizeError,
    preparationStage: preparation.stage, preparationMessage: preparation.message, preparationDetail: preparation.detail,
    recorderDefaultName: genName(totalCount + 1), handleRecorderFile,
    openModal, closeModal, backToList, removeSessionFile,
    tryOpenAudioPicker, tryOpenDocPicker, tryOpenFilePicker, tryOpenRecord,
    handleAudioPickChange, handleDocPickChange, handleFilePickChange, handleNamingConfirm, handleSessionConfirm,
    prepareForSubmit, cancelPreparation,
  };
}
