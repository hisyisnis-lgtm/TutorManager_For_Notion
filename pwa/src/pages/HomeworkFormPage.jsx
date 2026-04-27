import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Input, Select } from 'antd';
import PageHeader from '../components/layout/PageHeader.jsx';
import { createHomework, notifyHomework } from '../api/homework.js';
import { queryAll } from '../api/notionClient.js';
import { parseStudent } from '../api/students.js';

const STUDENT_DB = '314838fa-f2a6-8143-a6c7-e59c50f3bbdb';

const LABEL = { fontSize: 14, color: '#595959', display: 'block', marginBottom: 6, fontWeight: 600 };

export default function HomeworkFormPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const presetStudentId = searchParams.get('studentId');

  const [students, setStudents] = useState([]);
  const [studentId, setStudentId] = useState(presetStudentId || '');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    // 학생 목록 로드
    queryAll(STUDENT_DB, { property: '상태', select: { equals: '🟢 수강중' } }, [
      { property: '이름', direction: 'ascending' },
    ]).then((pages) => {
      setStudents(pages.map(parseStudent));
    }).catch(() => {});
  }, []);

  const handleSubmit = async () => {
    if (!studentId) { setError('학생을 선택해주세요.'); return; }
    if (!title.trim()) { setError('숙제 제목을 입력해주세요.'); return; }

    setSaving(true);
    setError(null);
    try {
      const created = await createHomework({ studentPageId: studentId, title: title.trim(), content: content.trim() });
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

  return (
    <>
      <PageHeader title="숙제 등록" back />

      <div className="px-4 pt-4 pb-24 space-y-5">
        {/* 학생 선택 */}
        <div>
          <label style={LABEL}>학생</label>
          {presetStudentId ? (
            <div style={{ fontSize: 15, fontWeight: 600, color: '#1d1d1f', padding: '8px 0' }}>
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

        {/* 과제 내용 */}
        <div>
          <label htmlFor="hw-content" style={LABEL}>과제 내용</label>
          <Input.TextArea
            id="hw-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="학생에게 전달할 과제 내용을 입력하세요"
            rows={5}
            maxLength={1000}
            showCount
            style={{ borderRadius: 12 }}
          />
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
          등록하기
        </Button>
      </div>
    </>
  );
}
