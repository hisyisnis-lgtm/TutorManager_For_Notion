import { useState, useEffect } from 'react';
import { Button, Card } from 'antd';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import PullToRefresh from '../components/ui/PullToRefresh.jsx';
import { queryAll, updatePage } from '../api/notionClient.js';
import { CONSULT_DB } from '../constants.js';

const KST = 'Asia/Seoul';

function formatKST(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: KST,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso));
  } catch { return ''; }
}

function parseConsult(page) {
  return {
    id: page.id,
    name: page.properties['이름']?.title?.[0]?.plain_text ?? '',
    phone: page.properties['전화번호']?.rich_text?.[0]?.plain_text ?? '',
    level: page.properties['수준']?.select?.name ?? '',
    days: (page.properties['희망 요일']?.multi_select ?? []).map(o => o.name),
    time: page.properties['희망 시간대']?.select?.name ?? '',
    content: page.properties['상담 내용']?.rich_text?.[0]?.plain_text ?? '',
    status: page.properties['상태']?.select?.name ?? '',
    appliedAt: page.properties['신청 일시']?.date?.start ?? page.created_time,
  };
}

const STATUS_STYLE = {
  '신청됨': { bg: '#fff1f0', color: '#cf1322' },
  '확인됨': { bg: '#f9f0ff', color: '#531dab' },
  '연락중': { bg: '#fffbe6', color: '#d48806' },
  '확정':   { bg: '#e6f4ff', color: '#0958d9' },
  '완료':   { bg: '#f5f5f5', color: '#8c8c8c' },
  '불발':   { bg: '#f5f5f5', color: '#8c8c8c' },
};

function ConsultCard({ consult: c, onConfirm, confirming }) {
  const style = STATUS_STYLE[c.status] ?? STATUS_STYLE['완료'];
  const isPending = c.status === '신청됨';
  const faded = c.status === '완료' || c.status === '불발';

  return (
    <Card
      variant="borderless"
      style={{ borderRadius: 16, boxShadow: 'var(--shadow-border)', opacity: faded ? 0.55 : 1 }}
      styles={{ body: { padding: '14px 16px' } }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <span className="text-base font-semibold text-gray-900">{c.name}</span>
          <span className="ml-2 text-sm text-gray-500">{c.phone}</span>
        </div>
        <span
          className="text-xs font-semibold px-2 py-0.5 rounded-full shrink-0"
          style={{ backgroundColor: style.bg, color: style.color }}
        >
          {c.status}
        </span>
      </div>

      <div className="space-y-0.5 text-sm text-gray-600">
        {c.level && <p>수준: {c.level}</p>}
        {c.days.length > 0 && <p>희망 요일: {c.days.join(', ')}</p>}
        {c.time && <p>희망 시간: {c.time}</p>}
        {c.content && (
          <p className="text-xs text-gray-500 leading-relaxed whitespace-pre-wrap pt-1">{c.content}</p>
        )}
      </div>

      <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-100">
        <span className="text-xs text-gray-400">{formatKST(c.appliedAt)}</span>
        {isPending && (
          <Button
            type="primary"
            size="small"
            loading={confirming}
            onClick={() => onConfirm(c.id)}
            style={{ borderRadius: 8, fontWeight: 600, minWidth: 64 }}
          >
            확인하기
          </Button>
        )}
      </div>
    </Card>
  );
}

export default function ConsultManagePage() {
  const [consults, setConsults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const results = await queryAll(
        CONSULT_DB,
        undefined,
        [{ timestamp: 'created_time', direction: 'descending' }]
      );
      setConsults(results.map(parseConsult));
    } catch (e) {
      console.error('[상담관리] 불러오기 오류', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleConfirm = async (id) => {
    setConfirming(id);
    try {
      await updatePage(id, { '상태': { select: { name: '확인됨' } } });
      setConsults(prev => prev.map(c => c.id === id ? { ...c, status: '확인됨' } : c));
    } finally {
      setConfirming(null);
    }
  };

  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const pending = consults.filter(c => c.status === '신청됨');
  const others = consults.filter(c => c.status !== '신청됨' && new Date(c.appliedAt).getTime() > oneDayAgo);

  return (
    <PullToRefresh onRefresh={load}>
      <PageHeader title="무료상담 신청" back />
      <div className="px-4 pt-4 pb-24">
        {loading ? (
          <LoadingSpinner />
        ) : consults.length === 0 ? (
          <div className="flex flex-col items-center gap-3 pt-20 text-center px-8">
            <span className="text-4xl opacity-30">📋</span>
            <p className="text-sm text-gray-400">아직 무료상담 신청이 없습니다</p>
          </div>
        ) : (
          <>
            {pending.length > 0 && (
              <section>
                <p className="text-xs font-semibold text-gray-500 tracking-wider mb-3">
                  미확인&nbsp;<span className="text-red-500">{pending.length}</span>건
                </p>
                <ul className="space-y-3">
                  {pending.map(c => (
                    <li key={c.id}>
                      <ConsultCard
                        consult={c}
                        onConfirm={handleConfirm}
                        confirming={confirming === c.id}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {others.length > 0 && (
              <section className={pending.length > 0 ? 'mt-6' : ''}>
                <p className="text-xs font-semibold text-gray-500 tracking-wider mb-3">이전 신청</p>
                <ul className="space-y-3">
                  {others.map(c => (
                    <li key={c.id}>
                      <ConsultCard
                        consult={c}
                        onConfirm={handleConfirm}
                        confirming={confirming === c.id}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </PullToRefresh>
  );
}
