import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { usePullToRefresh, PullIndicator } from '../hooks/usePullToRefresh.jsx';
import {
  fetchStudentByToken,
  fetchMyClasses,
} from '../api/bookingApi.js';
import { fetchMyHomework, parseHomework, submitHomework, uploadStudentFile, homeworkStatusColor } from '../api/homework.js';
import { Card, Button, Spin, Modal, message } from 'antd';
import HomeworkFilterBar from '../components/homework/HomeworkFilterBar.jsx';
import HomeworkSection from '../components/homework/HomeworkSection.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import AudioPlayer from '../components/ui/AudioPlayer.jsx';
import AudioRecorder from '../components/ui/AudioRecorder.jsx';
import { HomeOutlined, BookOutlined, FileTextOutlined, BellOutlined, SettingOutlined } from '@ant-design/icons';
import MonthCalendar from '../components/ui/MonthCalendar.jsx';
import PandaWidget from '../components/ui/PandaWidget.jsx';
import InstallBanner from '../components/ui/InstallBanner.jsx';
import { useInstallPrompt } from '../hooks/useInstallPrompt.js';

const SAVED_TOKEN_KEY = 'personal_student_token';

const DAY_KR = ['일', '월', '화', '수', '목', '금', '토'];
const LOCATION_LABEL = { '강남사무실': '강남', '온라인 (Zoom/화상)': 'Zoom' };

function timeToMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
function formatDuration(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}
function formatMonth(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return `${y}년 ${m}월`;
}
function shiftMonth(monthStr, delta) {
  const date = new Date(monthStr + '-01T00:00:00Z');
  date.setUTCMonth(date.getUTCMonth() + delta);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ===== 수업 카드 공통 컴포넌트 =====
const BADGE = { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20 };

function ClassCard({ cls, todayStr, nowMin }) {
  const d = new Date(cls.date + 'T00:00:00+09:00');
  const clsStartMin = timeToMin(cls.startTime);
  const clsEndMin = clsStartMin + cls.durationMin;
  const isToday = cls.date === todayStr;
  const isPast = cls.date < todayStr;
  const isOngoing = !cls.isCancelled && isToday && nowMin >= clsStartMin && nowMin < clsEndMin;
  const isDimmed = isPast || cls.isCancelled;

  return (
    <Card variant="borderless" style={{ borderRadius: 16, boxShadow: 'var(--shadow-border)', opacity: isDimmed ? 0.65 : 1, transition: 'opacity 0.2s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* 날짜 박스 */}
        <div style={{ minWidth: 52, textAlign: 'center', backgroundColor: isDimmed ? '#fafafa' : '#fff0f1', borderRadius: 12, padding: '8px 6px' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: isDimmed ? '#8c8c8c' : '#7f0005', lineHeight: 1.2 }} className="tabular-nums">
            {d.getDate()}
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: isDimmed ? '#bfbfbf' : '#a00008' }}>
            {DAY_KR[d.getDay()]}요일
          </div>
        </div>

        {/* 수업 정보 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
            {isOngoing && <span style={{ ...BADGE, backgroundColor: '#e6f4ff', color: '#0958d9' }}>수업중</span>}
            {isToday && !isOngoing && !cls.isCancelled && <span style={{ ...BADGE, backgroundColor: '#f6ffed', color: '#389e0d' }}>오늘</span>}
            {isPast && !cls.isCancelled && <span style={{ ...BADGE, backgroundColor: '#f5f5f5', color: '#595959' }}>완료</span>}
            {cls.isCancelled && <span style={{ ...BADGE, backgroundColor: '#f5f5f5', color: '#8c8c8c' }}>취소</span>}
            {cls.classType === '2:1' && <span style={{ ...BADGE, backgroundColor: '#fff7e6', color: '#d46b08' }}>2:1</span>}
            {cls.specialNote === '🟠 보강' && <span style={{ ...BADGE, backgroundColor: '#e6fffb', color: '#08979c' }}>보강</span>}
            {cls.specialNote === '🔴 결석' && <span style={{ ...BADGE, backgroundColor: '#fff2f0', color: '#cf1322' }}>결석</span>}
            <span style={{ fontSize: 14, fontWeight: 600, color: '#1d1d1f' }} className="tabular-nums">{cls.startTime}</span>
          </div>
          {cls.location && (
            <div style={{ fontSize: 12, color: '#767676' }}>{LOCATION_LABEL[cls.location] ?? cls.location}</div>
          )}
        </div>

        {/* 수업 시간 강조 */}
        <div style={{ flexShrink: 0, textAlign: 'right' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: isDimmed ? '#bfbfbf' : '#7f0005' }} className="tabular-nums">
            {formatDuration(cls.durationMin)}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ===== 숙제 탭 =====
function MyHomeworkTab({ studentToken }) {
  const [homeworkList, setHomeworkList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pages = await fetchMyHomework(studentToken);
      setHomeworkList(pages.map(parseHomework));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [studentToken]);

  useEffect(() => { load(); }, [load]);

  // 학생 앱은 JWT 없으므로 전체 숙제 목록을 다시 조회해서 해당 항목 반환
  const getFreshUrls = useCallback(async (hwId) => {
    const pages = await fetchMyHomework(studentToken);
    const list = pages.map(parseHomework);
    return list.find((h) => h.id === hwId) ?? null;
  }, [studentToken]);

  // 사용 가능한 월 목록 (내림차순)
  const availableMonths = [...new Set(
    homeworkList.map((h) => h.createdTime?.slice(0, 7)).filter(Boolean)
  )].sort().reverse();

  // 필터 적용
  const filteredList = homeworkList.filter((h) => {
    if (searchText && !h.title.toLowerCase().includes(searchText.toLowerCase())) return false;
    if (filterMonth && h.createdTime?.slice(0, 7) !== filterMonth) return false;
    if (filterStatus && h.status !== filterStatus) return false;
    return true;
  });

  const pending = filteredList.filter((h) => h.status === '미제출');
  const submitted = filteredList.filter((h) => h.status === '제출완료');
  const feedbacked = filteredList.filter((h) => h.status === '피드백완료');

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message={error} onRetry={load} />;

  if (homeworkList.length === 0) {
    return <EmptyState icon="📝" title="숙제가 없어요" description="선생님이 숙제를 등록하면 여기에 표시돼요" />;
  }

  return (
    <div style={{ padding: '16px 20px 0' }}>
      {/* 검색 + 필터 바 */}
      <div style={{ marginBottom: 16 }}>
        <HomeworkFilterBar
          searchText={searchText}
          onSearchChange={setSearchText}
          filterMonth={filterMonth}
          onMonthChange={setFilterMonth}
          filterStatus={filterStatus}
          onStatusChange={setFilterStatus}
          availableMonths={availableMonths}
        />
      </div>

      {pending.length > 0 && (
        <HomeworkSection title={`🔴 해야 할 숙제 (${pending.length})`}>
          {pending.map((hw) => (
            <HwCard
              key={hw.id}
              hw={hw}
              expanded={expandedId === hw.id}
              onToggle={() => setExpandedId(expandedId === hw.id ? null : hw.id)}
              studentToken={studentToken}
              onReload={load}
              getFreshUrls={getFreshUrls}
            />
          ))}
        </HomeworkSection>
      )}

      {submitted.length > 0 && (
        <HomeworkSection title={`🔵 검토 중 (${submitted.length})`}>
          {submitted.map((hw) => (
            <HwCard
              key={hw.id}
              hw={hw}
              expanded={expandedId === hw.id}
              onToggle={() => setExpandedId(expandedId === hw.id ? null : hw.id)}
              studentToken={studentToken}
              onReload={load}
              getFreshUrls={getFreshUrls}
            />
          ))}
        </HomeworkSection>
      )}

      {feedbacked.length > 0 && (
        <HomeworkSection title={`🟢 피드백 왔어요 (${feedbacked.length})`}>
          {feedbacked.map((hw) => (
            <HwCard
              key={hw.id}
              hw={hw}
              expanded={expandedId === hw.id}
              onToggle={() => setExpandedId(expandedId === hw.id ? null : hw.id)}
              studentToken={studentToken}
              onReload={load}
              getFreshUrls={getFreshUrls}
            />
          ))}
        </HomeworkSection>
      )}

      {filteredList.length === 0 && homeworkList.length > 0 && (
        <div style={{ textAlign: 'center', padding: '32px 0', color: '#bfbfbf', fontSize: 13 }}>
          검색 결과가 없어요
        </div>
      )}

      <p style={{ fontSize: 12, textAlign: 'center', color: '#767676', margin: '12px 0 24px' }}>
        숙제 관련 문의는 선생님께 해주세요
      </p>
    </div>
  );
}


const MAX_FILES = 5;

function genStudentName(title, index) {
  const base = title.replace(/[^\w가-힣]/g, '').slice(0, 20) || '숙제';
  return `${base}_${String(index).padStart(2, '0')}`;
}

function HwCard({ hw, expanded, onToggle, studentToken, onReload, getFreshUrls }) {
  const [freshHw, setFreshHw] = useState(null);
  // 모달 전체 상태
  const [modalOpen, setModalOpen] = useState(false);
  // list: 파일 목록+제출 | record: 녹음 | naming: 파일이름 입력
  const [modalView, setModalView] = useState('list');
  const [pendingFiles, setPendingFiles] = useState([]);
  const [deletingFileName, setDeletingFileName] = useState(null); // 개별 삭제 중인 파일명
  const [namingFile, setNamingFile] = useState(null);
  const [namingInput, setNamingInput] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const { bg, text } = homeworkStatusColor(hw.status);

  const canEdit = hw.status === '미제출' || hw.status === '제출완료';
  const totalFiles = (hw.submitFiles?.length ?? 0) + pendingFiles.length;
  const canAddMore = totalFiles < MAX_FILES;
  const nextIndex = pendingFiles.length + 1;

  const refreshFreshHw = async () => {
    const h = await getFreshUrls(hw.id);
    setFreshHw(h);
    return h;
  };

  const openModal = () => {
    setModalView('list');
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    // 애니메이션 후 뷰 초기화 (파일 목록은 유지)
    setTimeout(() => setModalView('list'), 300);
  };

  const addFile = (file, name) => {
    const safeName = (name || '').trim() || genStudentName(hw.title, nextIndex);
    setPendingFiles((prev) => [...prev, { tempId: Date.now() + Math.random(), file, name: safeName }]);
    setModalView('list');
  };

  const removeFile = (tempId) => setPendingFiles((prev) => prev.filter((f) => f.tempId !== tempId));

  const handleFilePickChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setNamingInput(genStudentName(hw.title, nextIndex));
    setNamingFile(file);
    setModalView('naming');
  };

  const handleNamingConfirm = () => {
    if (!namingInput.trim()) return;
    addFile(namingFile, namingInput);
    setNamingFile(null);
  };

  const handleSubmit = async () => {
    if (pendingFiles.length === 0) return;
    setUploading(true);
    try {
      const uploaded = [];
      for (const pf of pendingFiles) {
        const namedFile = new File([pf.file], pf.name, { type: pf.file.type });
        const { fileUploadId } = await uploadStudentFile(studentToken, namedFile);
        uploaded.push({ fileUploadId, fileName: pf.name });
      }
      await submitHomework(studentToken, hw.id, uploaded);
      setPendingFiles([]);
      closeModal();
      await onReload();
    } catch (err) {
      message.error(`제출 실패: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteFile = async (fileName) => {
    setDeletingFileName(fileName);
    try {
      await submitHomework(studentToken, hw.id, [], [fileName]);
      await onReload();
    } catch (err) {
      message.error(`삭제 실패: ${err.message}`);
    } finally {
      setDeletingFileName(null);
    }
  };

  // 모달 뷰 타이틀
  const modalTitle = (() => {
    if (modalView === 'record') return '🎤 음성 녹음';
    if (modalView === 'naming') return '📁 파일 이름 입력';
    return '📁 파일 관리';
  })();

  const displayHw = freshHw ?? hw;

  return (
    <>
      <Card
        variant="borderless"
        style={{ borderRadius: 12, boxShadow: 'var(--shadow-border)', overflow: 'hidden' }}
        styles={{ body: { padding: 0 } }}
      >
        {/* 헤더 */}
        <button
          type="button"
          onClick={onToggle}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 20px', border: 'none', background: 'none', cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent', textAlign: 'left',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#1d1d1f', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hw.title}</p>
            {hw.content && !expanded && (
              <p style={{ fontSize: 12, color: '#767676', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hw.content}</p>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: bg, color: text }}>{hw.status}</span>
            <span style={{ fontSize: 13, color: '#bfbfbf' }}>{expanded ? '▲' : '▼'}</span>
          </div>
        </button>

        {/* 펼쳐진 내용 */}
        {expanded && (
          <div style={{ padding: '0 20px 20px', borderTop: '1px solid rgba(0,0,0,0.06)' }}>
            {hw.content && (
              <p style={{ fontSize: 13, color: '#1d1d1f', lineHeight: 1.65, margin: '12px 0', whiteSpace: 'pre-wrap' }}>{hw.content}</p>
            )}

            {/* 제출된 파일들 */}
            {displayHw.submitFiles?.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 12, color: '#595959', margin: '0 0 6px', fontWeight: 600 }}>내 제출 파일</p>
                {displayHw.submitFiles.map((f, i) => (
                  <div key={i} style={{ marginBottom: 8 }}>
                    <AudioPlayer
                      url={f.url}
                      fileName={f.name}
                      onGetFreshUrl={async () => {
                        const h = await refreshFreshHw();
                        return h?.submitFiles?.[i]?.url ?? null;
                      }}
                      onDelete={canEdit ? () => handleDeleteFile(f.name) : undefined}
                      deleteDisabled={deletingFileName !== null}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* 피드백 */}
            {(displayHw.feedbackText || displayHw.feedbackFiles?.length > 0) && (
              <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 12, padding: '12px 16px', marginBottom: 12 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: '#389e0d', margin: '0 0 8px' }}>선생님 피드백</p>
                {displayHw.feedbackText && (
                  <p style={{ fontSize: 13, color: '#1d1d1f', lineHeight: 1.65, margin: '0 0 8px', whiteSpace: 'pre-wrap' }}>{displayHw.feedbackText}</p>
                )}
                {displayHw.feedbackFiles?.map((f, i) => (
                  <div key={i} style={{ marginBottom: i < displayHw.feedbackFiles.length - 1 ? 6 : 0 }}>
                    <AudioPlayer
                      url={f.url}
                      fileName={f.name}
                      onGetFreshUrl={async () => {
                        const h = await refreshFreshHw();
                        return h?.feedbackFiles?.[i]?.url ?? null;
                      }}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* 제출/수정 버튼 (팝업 오픈) */}
            {canEdit && (
              <button
                type="button"
                onClick={openModal}
                style={{
                  width: '100%', height: 44, borderRadius: 12,
                  background: '#fff0f1',
                  border: '1.5px solid rgba(127,0,5,0.2)',
                  color: '#7f0005',
                  fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                📁 파일 추가하기
              </button>
            )}
          </div>
        )}
      </Card>

      {/* ===== 제출 팝업 ===== */}
      <Modal
        open={modalOpen}
        onCancel={closeModal}
        footer={null}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {modalView !== 'list' && (
              <button
                type="button"
                onClick={() => setModalView('list')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#595959', padding: '0 4px 0 0', display: 'flex', alignItems: 'center' }}
                aria-label="뒤로"
              >
                ←
              </button>
            )}
            <span style={{ fontSize: 16, fontWeight: 700 }}>{modalTitle}</span>
          </div>
        }
        centered
        destroyOnHide
        styles={{ body: { paddingTop: 8, paddingBottom: 4 } }}
      >
        <input ref={fileInputRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={handleFilePickChange} />

        {/* ── list 뷰 ── */}
        {modalView === 'list' && (
          <div>
            {/* 새로 추가된 파일 목록 */}
            {pendingFiles.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: '#595959', margin: '0 0 6px' }}>
                  새로 추가할 파일 ({pendingFiles.length}개)
                </p>
                {pendingFiles.map((pf) => (
                  <div key={pf.tempId} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 12px', background: '#f6ffed', border: '1px solid #b7eb8f',
                    borderRadius: 12, marginBottom: 6,
                  }}>
                    <span style={{ fontSize: 13, color: '#1d1d1f', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      🎵 {pf.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFile(pf.tempId)}
                      style={{ marginLeft: 10, background: 'none', border: 'none', cursor: 'pointer', color: '#bfbfbf', fontSize: 18, flexShrink: 0, padding: 0, lineHeight: 1 }}
                      aria-label="삭제"
                    >×</button>
                  </div>
                ))}
              </div>
            )}

            {/* 빈 상태 안내 */}
            {pendingFiles.length === 0 && (
              <div style={{ textAlign: 'center', padding: '16px 0 12px', color: '#bfbfbf', fontSize: 13 }}>
                파일을 추가한 뒤 제출해주세요
              </div>
            )}

            {/* 파일 추가 버튼 */}
            {canAddMore && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    flex: 1, height: 44, borderRadius: 12,
                    background: 'white', border: '1.5px solid #d9d9d9', color: '#595959',
                    fontSize: 14, fontWeight: 600, cursor: 'pointer',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  📁 파일 추가
                </button>
                <button
                  type="button"
                  onClick={() => setModalView('record')}
                  style={{
                    flex: 1, height: 44, borderRadius: 12,
                    background: '#7f0005', border: 'none', color: 'white',
                    fontSize: 14, fontWeight: 600, cursor: 'pointer',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  🎤 바로 녹음
                </button>
              </div>
            )}

            {/* 제출 버튼 */}
            <Button
              type="primary"
              block
              onClick={handleSubmit}
              loading={uploading}
              disabled={pendingFiles.length === 0 || uploading}
              style={{ height: 48, borderRadius: 12, fontWeight: 700, fontSize: 15 }}
            >
              {uploading ? '업로드 중…' : `제출하기 (${pendingFiles.length}개)`}
            </Button>
          </div>
        )}

        {/* ── record 뷰 ── */}
        {modalView === 'record' && (
          <AudioRecorder
            defaultName={genStudentName(hw.title, nextIndex)}
            onFile={(file) => addFile(file, file.name.replace(/\.[^/.]+$/, ''))}
            onCancel={() => setModalView('list')}
            hideCancel
          />
        )}

        {/* ── naming 뷰 (파일 선택 후 이름 입력) ── */}
        {modalView === 'naming' && namingFile && (
          <div>
            <p style={{ fontSize: 13, color: '#595959', margin: '0 0 8px' }}>파일 이름을 입력하세요</p>
            <input
              type="text"
              value={namingInput}
              onChange={(e) => setNamingInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleNamingConfirm()}
              maxLength={50}
              autoFocus
              style={{
                width: '100%', height: 44, borderRadius: 12, border: '1.5px solid #d9d9d9',
                padding: '0 14px', fontSize: 15, color: '#1d1d1f',
                boxSizing: 'border-box', outline: 'none', marginBottom: 12,
              }}
              onFocus={(e) => e.target.select()}
            />
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
    </>
  );
}

// ===== 내 수업 탭 =====
function MyClassesTab({ studentToken, month, onMonthChange }) {
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMyClasses(studentToken, month);
      setClasses(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [studentToken, month]);

  useEffect(() => { load(); }, [load]);

  const _nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayStr = _nowKST.toISOString().slice(0, 10);
  const nowMin = _nowKST.getUTCHours() * 60 + _nowKST.getUTCMinutes();

  const upcomingClasses = classes
    .filter(c => !c.isCancelled && c.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  const pastClasses = classes
    .filter(c => c.isCancelled || c.date < todayStr)
    .sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime));

  return (
    <div>
      {/* 월 네비게이션 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px', borderBottom: '1px solid rgba(0,0,0,0.06)',
        backgroundColor: '#fff',
      }}>
        <button
          type="button"
          onClick={() => onMonthChange(shiftMonth(month, -1))}
          aria-label="이전 달"
          style={{
            width: 44, height: 44, borderRadius: 12,
            border: '1px solid rgba(0,0,0,0.06)', background: '#fafafa', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, color: '#595959',
          }}
        >‹</button>
        <span
          style={{ fontSize: 16, fontWeight: 700, color: '#1d1d1f' }}
          aria-live="polite"
          aria-atomic="true"
        >
          {formatMonth(month)}
        </span>
        <button
          type="button"
          onClick={() => onMonthChange(shiftMonth(month, 1))}
          aria-label="다음 달"
          style={{
            width: 44, height: 44, borderRadius: 12,
            border: '1px solid rgba(0,0,0,0.06)', background: '#fafafa', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, color: '#595959',
          }}
        >›</button>
      </div>

      {loading && <LoadingSpinner />}
      {error && <ErrorMessage message={error} onRetry={load} />}
      {!loading && !error && classes.length === 0 && (
        <EmptyState icon="📚" title="이 달에 수업이 없어요" description="다른 달을 선택해 보세요" />
      )}

      {!loading && !error && classes.length > 0 && (
        <>
          {upcomingClasses.length > 0 && (
            <div style={{ padding: '12px 20px 0' }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: '#767676', margin: '0 0 8px' }}>예정된 수업</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {upcomingClasses.map(cls => (
                  <ClassCard key={cls.id} cls={cls} todayStr={todayStr} nowMin={nowMin} />
                ))}
              </div>
            </div>
          )}

          {pastClasses.length > 0 && (
            <div style={{ padding: '12px 20px 0' }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: '#767676', margin: '0 0 8px' }}>지난 수업</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pastClasses.map(cls => (
                  <ClassCard key={cls.id} cls={cls} todayStr={todayStr} nowMin={nowMin} />
                ))}
              </div>
            </div>
          )}

          <p style={{ fontSize: 12, textAlign: 'center', color: '#767676', margin: '12px 20px 24px' }}>
            수업 변경·취소는 강사님께 문의해주세요
          </p>
        </>
      )}
    </div>
  );
}

// ===== 홈 탭 =====
function HomeTab({ studentToken, totalSessions, studentLoaded }) {
  const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  const todayStr = `${nowKST.getUTCFullYear()}-${pad(nowKST.getUTCMonth() + 1)}-${pad(nowKST.getUTCDate())}`;
  const nowMin = nowKST.getUTCHours() * 60 + nowKST.getUTCMinutes();

  const initMonth = () => {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}`;
  };
  const [calMonth, setCalMonth] = useState(initMonth);
  const [calClasses, setCalClasses] = useState([]);
  const [calLoading, setCalLoading] = useState(false);
  const [selectedDay, setSelectedDay] = useState(null);
  const [upcoming, setUpcoming] = useState([]);
  const [upcomingLoading, setUpcomingLoading] = useState(true);

  // 초기 로드: curr + next 2개 요청으로 캘린더와 다가오는 수업 모두 처리 (중복 제거)
  const loadInitialData = useCallback(async () => {
    setUpcomingLoading(true);
    setCalLoading(true);
    try {
      const thisMonth = initMonth();
      const [curr, next] = await Promise.all([
        fetchMyClasses(studentToken, thisMonth),
        fetchMyClasses(studentToken, shiftMonth(thisMonth, 1)),
      ]);
      setCalClasses(curr.filter(c => !c.isCancelled));
      const all = [...curr, ...next]
        .filter(c => !c.isCancelled && c.date >= todayStr)
        .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
      setUpcoming(all.slice(0, 5));
    } catch {
      setUpcoming([]);
      setCalClasses([]);
    } finally {
      setUpcomingLoading(false);
      setCalLoading(false);
    }
  }, [studentToken]);

  const loadCalendarMonth = useCallback(async (month) => {
    setCalLoading(true);
    setSelectedDay(null);
    try {
      const data = await fetchMyClasses(studentToken, month);
      setCalClasses(data.filter(c => !c.isCancelled));
    } catch {
      setCalClasses([]);
    } finally {
      setCalLoading(false);
    }
  }, [studentToken]);

  useEffect(() => { loadInitialData(); }, [loadInitialData]);

  const [calYear, calMonthNum] = calMonth.split('-').map(Number);

  const classCountMap = {};
  calClasses.forEach(c => {
    const day = parseInt(c.date.slice(8), 10);
    classCountMap[day] = (classCountMap[day] || 0) + 1;
  });

  const selectedDayClasses = selectedDay
    ? calClasses.filter(c => parseInt(c.date.slice(8), 10) === selectedDay)
        .sort((a, b) => a.startTime.localeCompare(b.startTime))
    : [];

  const handleDayClick = (day) => {
    if (!classCountMap[day]) return;
    setSelectedDay(prev => prev === day ? null : day);
  };

  return (
    <div style={{ paddingBottom: 8 }}>
      {/* 팬더 위젯 — student 로드 완료 후에만 표시 (로딩 중 알(0회) 깜빡임 방지) */}
      {studentLoaded && (
        <div style={{ padding: '16px 20px 8px' }}>
          <PandaWidget totalSessions={totalSessions} />
        </div>
      )}

      {/* 수업 캘린더 */}
      <div style={{ padding: '16px 20px 0' }}>
        <MonthCalendar
          year={calYear}
          month={calMonthNum}
          todayStr={todayStr}
          classCountMap={classCountMap}
          selectedDay={selectedDay}
          onDayClick={handleDayClick}
          onPrevMonth={() => { const m = shiftMonth(calMonth, -1); setCalMonth(m); loadCalendarMonth(m); }}
          onNextMonth={() => { const m = shiftMonth(calMonth, 1); setCalMonth(m); loadCalendarMonth(m); }}
          loading={calLoading}
          onDeselect={() => setSelectedDay(null)}
          footer={selectedDay !== null && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: '#767676', margin: '0 0 8px' }}>
                {calMonthNum}월 {selectedDay}일 수업
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {selectedDayClasses.map(cls => (
                  <div key={cls.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderRadius: 12, background: '#f9fafb' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#7f0005', flexShrink: 0 }} className="tabular-nums">
                      {cls.startTime}
                    </span>
                    <span style={{ fontSize: 14, color: '#1d1d1f' }}>
                      {formatDuration(cls.durationMin)}
                      {cls.location && ` · ${LOCATION_LABEL[cls.location] ?? cls.location}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        />
      </div>

      {/* 다가오는 수업 */}
      <div style={{ padding: '16px 20px 0' }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: '#767676', margin: '0 0 8px' }}>다가오는 수업</p>
        {upcomingLoading ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}><Spin size="small" /></div>
        ) : upcoming.length === 0 ? (
          <Card variant="borderless" style={{ borderRadius: 12, boxShadow: 'var(--shadow-border)' }}>
            <div style={{ textAlign: 'center', padding: '16px 0', color: '#767676', fontSize: 14 }}>
              다가오는 수업이 없어요
            </div>
          </Card>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {upcoming.map(cls => (
              <ClassCard key={cls.id} cls={cls} todayStr={todayStr} nowMin={nowMin} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ===== 메인 페이지 =====
export default function PersonalPage() {
  const navigate = useNavigate();
  const { studentToken } = useParams();
  const routerLocation = useLocation();

  const [student, setStudent] = useState(null);
  const [studentError, setStudentError] = useState(null);
  const [tab, setTab] = useState(routerLocation.state?.tab ?? '홈');

  const [classRefreshKey, setClassRefreshKey] = useState(0);
  const [myClassesMonth, setMyClassesMonth] = useState(() => {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}`;
  });

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const install = useInstallPrompt();
  const settingsRef = useRef(null);

  // 외부 클릭 or 탭 변경 시 설정 메뉴 닫기
  useEffect(() => {
    if (!settingsOpen) return;
    const handler = (e) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [settingsOpen]);

  useEffect(() => { setSettingsOpen(false); }, [tab]);

  const handleInstallAction = () => {
    if (install.isIOS) setShowIOSGuide(true);
    else install.promptInstall();
  };

  const loadStudent = useCallback(async () => {
    try {
      const data = await fetchStudentByToken(studentToken);
      localStorage.setItem(SAVED_TOKEN_KEY, studentToken);
      setStudent(data);
    } catch (e) {
      localStorage.removeItem(SAVED_TOKEN_KEY);
      setStudentError(e.status === 404 ? '등록된 학생 코드가 아닙니다.' : e.message);
    }
  }, [studentToken]);

  useEffect(() => {
    if (!studentToken) {
      navigate('/personal', { replace: true });
      return;
    }
    loadStudent();
  }, [studentToken, navigate, loadStudent]);

  const handlePullRefresh = useCallback(async () => {
    setClassRefreshKey(k => k + 1);
    await loadStudent();
  }, [loadStudent]);

  const { pullY, refreshing: pullRefreshing } = usePullToRefresh(handlePullRefresh);

  if (studentError) {
    return (
      <div className="min-h-dvh bg-gray-50 flex flex-col items-center justify-center px-4">
        <Card variant="borderless" style={{ borderRadius: 16, maxWidth: 360, width: '100%', textAlign: 'center', boxShadow: 'var(--shadow-card)' }}>
          <div style={{ fontSize: 36, marginBottom: 16 }}>⚠️</div>
          <p className="text-red-500 text-sm">{studentError}</p>
          <Button
            type="primary"
            block
            onClick={() => navigate('/personal')}
            style={{ borderRadius: 12, height: 44, fontWeight: 600, marginTop: 16 }}
          >
            다시 입력
          </Button>
        </Card>
      </div>
    );
  }

  if (!student) {
    return (
      <div style={{ minHeight: '100dvh', backgroundColor: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100dvh', backgroundColor: '#f9fafb' }}>
      <PullIndicator pullY={pullY} refreshing={pullRefreshing} />

      {/* 상단 헤더 */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
        backgroundColor: 'rgba(255,255,255,0.82)',
        backdropFilter: 'saturate(180%) blur(20px)',
        WebkitBackdropFilter: 'saturate(180%) blur(20px)',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
      }}>
        <div style={{
          maxWidth: 480, margin: '0 auto',
          height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 20px',
        }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1d1d1f', margin: 0 }}>
          {tab === '홈' ? `😊 ${student.name}` : tab === '내 수업' ? '예약 현황' : tab}
        </h1>

        <div ref={settingsRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setSettingsOpen(v => !v)}
            aria-label="설정"
            aria-expanded={settingsOpen}
            style={{
              width: 36, height: 36, padding: 0,
              border: 'none', background: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: '#595959', fontSize: 20,
              WebkitTapHighlightColor: 'transparent',
              outline: 'none',
            }}
          >
            <SettingOutlined />
          </button>

          {/* 플로팅 패널 */}
          <div style={{
            position: 'absolute', top: 44, right: 0,
            background: '#fff', borderRadius: 12,
            boxShadow: 'var(--shadow-card)',
            padding: '6px',
            minWidth: 140,
            transformOrigin: 'top right',
            transform: settingsOpen ? 'scale(1)' : 'scale(0.85)',
            opacity: settingsOpen ? 1 : 0,
            pointerEvents: settingsOpen ? 'auto' : 'none',
            transition: 'transform 0.18s cubic-bezier(0.34,1.56,0.64,1), opacity 0.15s ease',
          }}>
            {[
              ...(install.isInstallable ? [{ label: '홈 화면에 추가', onClick: handleInstallAction }] : []),
              { label: '문제 신고하기', onClick: () => window.open('https://forms.gle/dCwXvZAdfG12AxoJ9', '_blank', 'noopener,noreferrer') },
              { label: '로그아웃', onClick: () => { localStorage.removeItem('personal_student_token'); navigate('/personal'); } },
            ].map((item, i) => (
              <button
                key={item.label}
                onClick={() => { setSettingsOpen(false); item.onClick(); }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center',
                  padding: '10px 12px', borderRadius: 8,
                  border: 'none', background: 'none', cursor: 'pointer',
                  fontSize: 14, fontWeight: 500,
                  color: item.label === '로그아웃' ? '#cf1322' : '#1d1d1f',
                  borderTop: i > 0 ? '1px solid rgba(0,0,0,0.06)' : 'none',
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        </div>
      </div>

      {/* 콘텐츠 */}
      <div style={{ maxWidth: 480, margin: '0 auto', paddingTop: 56, paddingBottom: 80 }}>
        {tab === '홈' && (
          <HomeTab key={classRefreshKey} studentToken={studentToken} totalSessions={student?.totalSessions ?? 0} studentLoaded={student !== null} />
        )}
        {tab === '내 수업' && (
          <div role="tabpanel" id="tab-panel-1" aria-labelledby="nav-내 수업">
            <MyClassesTab
              key={classRefreshKey}
              studentToken={studentToken}
              month={myClassesMonth}
              onMonthChange={setMyClassesMonth}
            />
          </div>
        )}
        {tab === '숙제' && (
          <div role="tabpanel" id="tab-panel-2" aria-labelledby="nav-숙제">
            <MyHomeworkTab key={classRefreshKey} studentToken={studentToken} />
          </div>
        )}
        {tab === '공지' && (
          <div style={{ textAlign: 'center', padding: '72px 20px 48px' }}>
            <div style={{ fontSize: 44, marginBottom: 14 }}>📢</div>
            <p style={{ fontSize: 15, fontWeight: 600, color: '#595959', marginBottom: 4 }}>공지사항 준비 중이에요</p>
            <p style={{ fontSize: 13, color: '#bfbfbf' }}>선생님이 공지를 등록하면 여기에 표시돼요</p>
          </div>
        )}
      </div>

      <InstallBanner {...install} showIOSGuide={showIOSGuide} setShowIOSGuide={setShowIOSGuide} />

      {/* 하단 네비게이션 */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200,
        backgroundColor: 'rgba(255,255,255,0.82)',
        backdropFilter: 'saturate(180%) blur(20px)',
        WebkitBackdropFilter: 'saturate(180%) blur(20px)',
        boxShadow: '0px -1px 0px 0px rgba(0,0,0,0.06), 0px -2px 8px 0px rgba(0,0,0,0.04)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        <div style={{ maxWidth: 480, margin: '0 auto', display: 'flex' }}>
          {[
            { key: '홈', icon: <HomeOutlined />, label: '홈' },
            { key: '내 수업', icon: <BookOutlined />, label: '예약 현황' },
            { key: '숙제', icon: <FileTextOutlined />, label: '숙제' },
            { key: '공지', icon: <BellOutlined />, label: '공지' },
          ].map(item => {
            const isActive = tab === item.key;
            return (
              <button
                key={item.key}
                id={`nav-${item.key}`}
                type="button"
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => setTab(item.key)}
                style={{
                  flex: 1,
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  gap: 3, padding: '8px 0 10px',
                  border: 'none', background: 'none', cursor: 'pointer',
                  minHeight: 56,
                  color: isActive ? '#7f0005' : '#8c8c8c',
                  fontSize: 20,
                  transitionProperty: 'color, transform',
                  transitionDuration: '0.15s',
                  transitionTimingFunction: 'ease-out',
                  WebkitTapHighlightColor: 'transparent',
                  outline: 'none',
                }}
              >
                {item.icon}
                <span style={{ fontSize: 11, fontWeight: isActive ? 600 : 500 }}>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
