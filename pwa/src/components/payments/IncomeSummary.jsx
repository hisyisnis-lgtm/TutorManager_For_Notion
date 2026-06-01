import { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Card, Modal } from 'antd';
import { CaretRightIcon } from '@phosphor-icons/react';
import { useData } from '../../context/DataContext.jsx';
import { queryPage } from '../../api/notionClient.js';
import { CLASSES_DB, parseClass } from '../../api/classes.js';
import { PAYMENTS_DB, parsePayment } from '../../api/payments.js';
import { formatKRW, getMonthStart, getMonthEnd, getTodayStart } from '../../utils/dateUtils.js';
import SectionHeading from '../ui/SectionHeading.jsx';
import {
  PRIMARY, PRIMARY_BG,
  TEXT_PRIMARY, TEXT_TERTIARY, TEXT_DISABLED } from '../../constants/theme.js';

const KST = 'Asia/Seoul';

const DAY_MS = 24 * 60 * 60 * 1000;
// 예상 결제 간격 산정 기준: 1시간 50,000원, 주 1회 1.5시간 = 주당 75,000원
const HOURLY_RATE = 50000;
const WEEKLY_HOURS = 1.5;
const WEEKLY_COST = HOURLY_RATE * WEEKLY_HOURS; // 75,000원/주
// 미리 결제(짧은 간격)는 평균에서 제외하는 기준 — 20일 이하 간격은 미리결제로 보고 제외
const MIN_INTERVAL_DAYS = 20;

// 결제 금액으로 다음 결제까지의 간격(ms) 추정 — 결제액만큼 수업기간이 늘어난다는 가정
function estimateIntervalByAmount(amount) {
  const weeks = amount / WEEKLY_COST;
  return weeks * 7 * DAY_MS;
}

/**
 * 수입 현황 카드 + 예상 결제 수익 상세 모달.
 * 결제 탭(PaymentsPage)에서 사용. 마운트 시 자체적으로 데이터를 로드하고,
 * ref.reload()로 외부(PullToRefresh)에서 새로고침을 트리거할 수 있다.
 */
const IncomeSummary = forwardRef(function IncomeSummary(_props, ref) {
  const { studentNameMap, classTypeMap, students } = useData();

  const [monthPayments, setMonthPayments] = useState([]);
  const [monthLoading, setMonthLoading] = useState(true);
  const [forecastThisMonth, setForecastThisMonth] = useState(0);
  const [forecastNextMonth, setForecastNextMonth] = useState(0);
  const [forecastLoading, setForecastLoading] = useState(true);
  const [forecastBreakdown, setForecastBreakdown] = useState([]); // 학생별 예상 상세
  const [breakdownModalOpen, setBreakdownModalOpen] = useState(false);
  const [breakdownBucket, setBreakdownBucket] = useState(null); // 'thisMonth' | 'nextMonth'

  const loadMonthSummary = async () => {
    setMonthLoading(true);
    try {
      const monthStart = getMonthStart();
      const monthEnd = getMonthEnd();
      const paymentData = await queryPage(
        PAYMENTS_DB,
        {
          and: [
            { property: '결제일', date: { on_or_after: monthStart } },
            { property: '결제일', date: { on_or_before: monthEnd } },
          ] },
        undefined,
        undefined,
        100
      );
      setMonthPayments((paymentData?.results ?? []).map(parsePayment));
    } catch (e) {
      console.error('[결제] 이번 달 요약 오류', e);
    } finally {
      setMonthLoading(false);
    }
  };

  /**
   * 예상 결제 수익 계산 (이번 달·다음 달)
   * - 학생별 마지막 결제 금액을 다음 결제 금액으로 가정
   * - 반복 결제 간격(intervalMs) 추정:
   *   1) 결제 2건+ → 과거 결제 간격 중 20일 초과만 평균 (미리 몰아서 결제한 짧은 간격 제외)
   *      └ 20일 초과 간격이 하나도 없으면(항상 미리 몰아서 결제) 예상에서 제외 (회차부족 뱃지 있으면 예외)
   *   2) 결제 1건 → 금액 기반 간격 (주당 75,000원 기준, 결제액만큼 수업기간이 늘어난다는 가정)
   * - 첫 예상일: 회차부족(sessionShortage) 뱃지가 있으면 그 수업일, 없으면 마지막 결제일 + 간격
   * - 첫 예상일부터 intervalMs씩 반복(occurrence) 투영 → 이번 달·다음 달 구간에 떨어지는 결제를 모두 가산
   *   (월납 학생이 이번 달·다음 달 양쪽에 반영됨 — 학생당 한 주기만 보던 한계 해소)
   * - 이번 달에 이미 정기 결제한 학생은 이번 달 occurrence 제외 (confirmed와 이중 계산 방지)
   */
  const loadForecast = async () => {
    setForecastLoading(true);
    try {
      const activeStudents = students.filter((s) => s.status === '🟢 수강중');
      if (activeStudents.length === 0) {
        setForecastThisMonth(0);
        setForecastNextMonth(0);
        return;
      }

      const [paymentsData, futureClassData] = await Promise.all([
        // 최근 결제 100건 — 학생별 마지막 결제 + 평균 간격 산정용
        queryPage(
          PAYMENTS_DB,
          undefined,
          [{ property: '결제일', direction: 'descending' }],
          undefined,
          100
        ),
        // 오늘 이후 미래 수업 — sessionShortage 첫 발생 시점 산정용
        queryPage(
          CLASSES_DB,
          {
            and: [
              { property: '수업 일시', date: { on_or_after: getTodayStart() } },
              { property: '특이사항', select: { does_not_equal: '🚫 취소' } },
            ] },
          [{ property: '수업 일시', direction: 'ascending' }],
          undefined,
          100
        ),
      ]);

      const payments = (paymentsData?.results ?? []).map(parsePayment);
      const futureClasses = (futureClassData?.results ?? []).map(parseClass);

      // 학생별 결제 이력 (paymentDate desc 유지) — 원데이클래스 결제는 정기 결제 추정에서 제외
      const paymentsByStudent = new Map();
      for (const pmt of payments) {
        if (!pmt.paymentDate) continue;
        const ct = classTypeMap[pmt.classTypeId];
        if (ct?.title?.includes('원데이클래스')) continue; // 일회성 체험 결제 제외
        for (const sid of pmt.studentIds) {
          if (!paymentsByStudent.has(sid)) paymentsByStudent.set(sid, []);
          paymentsByStudent.get(sid).push(pmt);
        }
      }

      // 학생별 미래 수업 (datetime asc 유지)
      const futureClassesByStudent = new Map();
      for (const cls of futureClasses) {
        if (!cls.datetime) continue;
        for (const sid of cls.studentIds) {
          if (!futureClassesByStudent.has(sid)) futureClassesByStudent.set(sid, []);
          futureClassesByStudent.get(sid).push(cls);
        }
      }

      const todayKstStr = new Date().toLocaleDateString('en-CA', { timeZone: KST });
      const [tyStr, tmStr] = todayKstStr.split('-');
      const thisYear = parseInt(tyStr, 10);
      const thisMonth = parseInt(tmStr, 10) - 1; // 0-indexed

      // 이번 달에 이미 정기 결제한 학생 — 이번 달 예상(forecast)에서 제외 (원데이클래스 결제는 제외 판단에서 빼고 정기 결제만)
      const paidThisMonthIds = new Set();
      for (const pmt of payments) {
        if (!pmt.paymentDate) continue;
        const ct = classTypeMap[pmt.classTypeId];
        if (ct?.title?.includes('원데이클래스')) continue;
        const py = parseInt(new Date(pmt.paymentDate).toLocaleString('en-CA', { timeZone: KST, year: 'numeric' }), 10);
        const pm = parseInt(new Date(pmt.paymentDate).toLocaleString('en-CA', { timeZone: KST, month: '2-digit' }), 10) - 1;
        if (py === thisYear && pm === thisMonth) {
          pmt.studentIds.forEach((sid) => paidThisMonthIds.add(sid));
        }
      }

      let thisMonthTotal = 0;
      let nextMonthTotal = 0;

      // 디버깅용 학생별 상세
      const breakdown = [];
      // 모달용 학생별 상세 (이번 달/다음 달 카운트된 항목만, 예상일 asc)
      const breakdownEntries = [];

      for (const student of activeStudents) {
        const studentPayments = paymentsByStudent.get(student.id) ?? [];
        if (studentPayments.length === 0) {
          breakdown.push({ 학생: student.name, 결과: '제외(결제이력없음)' });
          continue;
        }
        const lastPayment = studentPayments[0];
        const expectedAmount = lastPayment.actualAmount || 0;
        if (expectedAmount <= 0) {
          breakdown.push({ 학생: student.name, 결과: '제외(마지막결제금액0)' });
          continue;
        }
        if (!lastPayment.paymentDate) {
          breakdown.push({ 학생: student.name, 결과: '제외(결제일없음)' });
          continue;
        }
        const lastPaymentDate = new Date(lastPayment.paymentDate);
        const lastPaymentStr = lastPaymentDate.toLocaleDateString('ko-KR', { timeZone: KST });

        const studentFuture = futureClassesByStudent.get(student.id) ?? [];
        const firstShortage = studentFuture.find((c) => c.sessionShortage);

        // 1) 반복 결제 간격(intervalMs) 추정
        let intervalMs = null;
        let basis;
        if (studentPayments.length >= 2) {
          // 연속 결제 간격 중 20일 초과만 모아서 평균 (미리 몰아서 결제한 짧은 간격 제외)
          const longIntervals = [];
          for (let i = 0; i < studentPayments.length - 1; i++) {
            const cur = studentPayments[i].paymentDate;
            const prev = studentPayments[i + 1].paymentDate;
            if (!cur || !prev) continue;
            const days = (new Date(cur).getTime() - new Date(prev).getTime()) / DAY_MS;
            if (days > MIN_INTERVAL_DAYS) longIntervals.push(days);
          }
          if (longIntervals.length > 0) {
            const avgDays = longIntervals.reduce((s, d) => s + d, 0) / longIntervals.length;
            intervalMs = avgDays * DAY_MS;
            basis = `평균간격(${Math.round(avgDays)}일·${longIntervals.length}건)`;
          }
        } else {
          // 결제 1건 → 금액 기반 간격 (결제액만큼 수업기간이 늘어난다는 가정)
          intervalMs = estimateIntervalByAmount(expectedAmount);
          basis = `금액기반(${Math.round(intervalMs / DAY_MS)}일)`;
        }

        // 추정 간격을 못 구함 (결제 2건+인데 20일 초과 간격이 하나도 없음 = 항상 미리 몰아서 결제)
        if (intervalMs == null) {
          if (firstShortage) {
            // 회차부족 날짜는 있으니 반복용 간격만 금액 기반으로 폴백
            intervalMs = estimateIntervalByAmount(expectedAmount);
            basis = `금액기반(간격부적합·${Math.round(intervalMs / DAY_MS)}일)`;
          } else {
            breakdown.push({
              학생: student.name,
              마지막결제: lastPaymentStr,
              예상금액: expectedAmount,
              결과: '제외(간격20일이하만)' });
            continue;
          }
        }

        // 안전장치: 간격 하한 7일 (러너웨이 루프 방지)
        if (intervalMs < 7 * DAY_MS) intervalMs = 7 * DAY_MS;

        // 첫 예상일: 회차부족 뱃지가 있으면 그 수업일, 없으면 마지막결제 + 간격
        let firstDate;
        if (firstShortage) {
          firstDate = new Date(firstShortage.datetime);
          basis = `회차부족(${firstShortage.datetime.slice(0, 10)})`;
        } else {
          firstDate = new Date(lastPaymentDate.getTime() + intervalMs);
        }

        // 2) 이번 달·다음 달 구간에 떨어지는 결제를 반복(occurrence)으로 모두 가산
        //    → 월납 학생이 이번 달·다음 달 양쪽에 반영됨 (한 주기만 보던 한계 해소)
        const thisMonthIdx = thisYear * 12 + thisMonth; // 다음 달 = thisMonthIdx + 1
        let occ = firstDate;
        for (let guard = 0; guard < 60; guard++) {
          const oy = parseInt(occ.toLocaleString('en-CA', { timeZone: KST, year: 'numeric' }), 10);
          const om = parseInt(occ.toLocaleString('en-CA', { timeZone: KST, month: '2-digit' }), 10) - 1;
          const occIdx = oy * 12 + om;

          if (occIdx > thisMonthIdx + 1) break; // 다음 달 이후 → 종료

          if (occIdx === thisMonthIdx || occIdx === thisMonthIdx + 1) {
            const occStr = occ.toLocaleDateString('ko-KR', { timeZone: KST });
            const isThisMonth = occIdx === thisMonthIdx;
            if (isThisMonth && paidThisMonthIds.has(student.id)) {
              // 이번 달에 이미 정기 결제함 → confirmed에 이미 포함 → forecast 이중 계산 방지
              breakdown.push({
                학생: student.name, 마지막결제: lastPaymentStr, 예상일: occStr,
                예상금액: expectedAmount, 산정방식: basis, 결과: '제외(이번달이미결제)' });
            } else {
              if (isThisMonth) thisMonthTotal += expectedAmount;
              else nextMonthTotal += expectedAmount;
              breakdown.push({
                학생: student.name, 마지막결제: lastPaymentStr, 예상일: occStr,
                예상금액: expectedAmount, 산정방식: basis, 결과: isThisMonth ? '이번 달' : '다음 달' });
              breakdownEntries.push({
                studentId: student.id,
                studentName: student.name,
                lastPaymentStr,
                expectedDateRaw: occ.toISOString(),
                expectedStr: occStr,
                expectedAmount,
                basis,
                bucket: isThisMonth ? 'thisMonth' : 'nextMonth' });
            }
          }
          occ = new Date(occ.getTime() + intervalMs);
        }
      }

      breakdownEntries.sort((a, b) => a.expectedDateRaw.localeCompare(b.expectedDateRaw));

      // 디버깅 출력
      console.group('[결제] 예상 결제 수익 학생별 상세');
      console.table(breakdown);
      console.log(`이번 달 가산 예상 합계: ${thisMonthTotal.toLocaleString('ko-KR')}원`);
      console.log(`다음 달 가산 예상 합계: ${nextMonthTotal.toLocaleString('ko-KR')}원`);
      console.groupEnd();

      setForecastThisMonth(thisMonthTotal);
      setForecastNextMonth(nextMonthTotal);
      setForecastBreakdown(breakdownEntries);
    } catch (e) {
      console.error('[결제] 예상 결제 수익 계산 오류', e);
    } finally {
      setForecastLoading(false);
    }
  };

  useEffect(() => {
    loadMonthSummary();
  }, []);

  // 학생 데이터가 로드된 후 예상 결제 수익 계산 (students 의존)
  useEffect(() => {
    if (students.length > 0) {
      loadForecast();
    }
  }, [students]); // eslint-disable-line react-hooks/exhaustive-deps

  // PullToRefresh 등 외부에서 새로고침 트리거
  useImperativeHandle(ref, () => ({
    reload: () => Promise.all([loadMonthSummary(), loadForecast()]),
  }));

  return (
    <>
      <div className="px-4 pt-3">
        <SectionHeading style={{ marginBottom: 12 }}>수입 현황</SectionHeading>
        <Card
          variant="borderless"
          style={{ borderRadius: 12, boxShadow: 'var(--shadow-border)' }}
          styles={{ body: { padding: '14px 16px' } }}
        >
          <button
            type="button"
            onClick={() => { setBreakdownBucket('thisMonth'); setBreakdownModalOpen(true); }}
            disabled={monthLoading}
            className="flex items-center justify-between w-full duration-150 ease-out"
            style={{
              background: 'none', border: 'none', textAlign: 'left', padding: 0,
              cursor: monthLoading ? 'default' : 'pointer' }}
          >
            <span className="text-sm flex items-center gap-1" style={{ color: TEXT_TERTIARY }}>
              이번 달 결제 수입
              <CaretRightIcon size={12} weight="bold" />
            </span>
            <span className="tabular-nums" style={{ fontSize: 14, fontWeight: 600, color: TEXT_PRIMARY }}>
              {formatKRW(monthPayments.reduce((s, p) => s + (p.actualAmount || 0), 0))}
            </span>
          </button>
          <button
            type="button"
            onClick={() => { setBreakdownBucket('thisMonth'); setBreakdownModalOpen(true); }}
            disabled={forecastLoading}
            className="flex items-center justify-between w-full duration-150 ease-out"
            style={{
              marginTop: 10, paddingTop: 10, borderTop: '1px solid #f5f5f5',
              background: 'none', border: 'none', textAlign: 'left', padding: '10px 0 0',
              cursor: forecastLoading ? 'default' : 'pointer' }}
          >
            <span className="text-sm flex items-center gap-1" style={{ color: TEXT_TERTIARY }}>
              예상 이번 달
              <CaretRightIcon size={12} weight="bold" />
            </span>
            {forecastLoading ? (
              <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
            ) : (() => {
              const confirmed = monthPayments.reduce((s, p) => s + (p.actualAmount || 0), 0);
              const totalThisMonth = confirmed + forecastThisMonth;
              return (
                <span className="tabular-nums" style={{ fontSize: 14, fontWeight: 600, color: PRIMARY }}>
                  {formatKRW(totalThisMonth) || '₩0'}
                </span>
              );
            })()}
          </button>
          <button
            type="button"
            onClick={() => { setBreakdownBucket('nextMonth'); setBreakdownModalOpen(true); }}
            disabled={forecastLoading}
            className="flex items-center justify-between w-full duration-150 ease-out"
            style={{
              marginTop: 6,
              background: 'none', border: 'none', textAlign: 'left', padding: 0,
              cursor: forecastLoading ? 'default' : 'pointer' }}
          >
            <span className="text-sm flex items-center gap-1" style={{ color: TEXT_TERTIARY }}>
              예상 다음 달
              <CaretRightIcon size={12} weight="bold" />
            </span>
            {forecastLoading ? (
              <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
            ) : (
              <span className="tabular-nums" style={{ fontSize: 14, fontWeight: 600, color: TEXT_TERTIARY }}>
                {formatKRW(forecastNextMonth) || '₩0'}
              </span>
            )}
          </button>
        </Card>
      </div>

      {/* 예상 결제 수익 상세 모달 */}
      <Modal
        open={breakdownModalOpen}
        onCancel={() => setBreakdownModalOpen(false)}
        footer={null}
        destroyOnHidden
        centered
        title={breakdownBucket === 'thisMonth' ? '예상 이번 달 상세' : '예상 다음 달 상세'}
        width="92vw"
        style={{ maxWidth: 480, paddingBottom: 0 }}
        styles={{
          body: {
            maxHeight: 'calc(85vh - 110px)',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            WebkitOverflowScrolling: 'touch',
            paddingRight: 4 } }}
      >
        {(() => {
          const entries = forecastBreakdown.filter((e) => e.bucket === breakdownBucket);
          const confirmedThisMonth = monthPayments.reduce((s, p) => s + (p.actualAmount || 0), 0);
          const forecastTotal = breakdownBucket === 'thisMonth' ? forecastThisMonth : forecastNextMonth;
          const grandTotal = breakdownBucket === 'thisMonth' ? confirmedThisMonth + forecastTotal : forecastTotal;

          return (
            <div>
              {/* 합계 헤더 */}
              <div style={{
                padding: '12px 14px', borderRadius: 12,
                background: PRIMARY_BG,
                marginBottom: 14 }}>
                <div className="flex items-center justify-between">
                  <span style={{ fontSize: 13, color: TEXT_PRIMARY }}>
                    {breakdownBucket === 'thisMonth' ? '이번 달 총 예상' : '다음 달 예상'}
                  </span>
                  <span className="tabular-nums" style={{ fontSize: 18, fontWeight: 700, color: PRIMARY }}>
                    {formatKRW(grandTotal)}
                  </span>
                </div>
                {breakdownBucket === 'thisMonth' && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(127,0,5,0.12)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div className="flex items-center justify-between">
                      <span style={{ fontSize: 12, color: TEXT_TERTIARY }}>확정 결제</span>
                      <span className="tabular-nums" style={{ fontSize: 12, color: TEXT_PRIMARY, fontWeight: 600 }}>
                        {formatKRW(confirmedThisMonth)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span style={{ fontSize: 12, color: TEXT_TERTIARY }}>예상 추가 ({entries.length}명)</span>
                      <span className="tabular-nums" style={{ fontSize: 12, color: TEXT_PRIMARY, fontWeight: 600 }}>
                        +{formatKRW(forecastTotal) || '₩0'}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* 이번 달: 확정 결제 섹션 */}
              {breakdownBucket === 'thisMonth' && (() => {
                const sortedPayments = [...monthPayments]
                  .filter((p) => p.paymentDate)
                  .sort((a, b) => (b.paymentDate || '').localeCompare(a.paymentDate || ''));
                return (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: TEXT_PRIMARY, marginBottom: 8 }}>
                      확정 결제 {sortedPayments.length > 0 && <span className="tabular-nums" style={{ color: TEXT_TERTIARY, fontWeight: 400 }}>· {sortedPayments.length}건</span>}
                    </div>
                    {sortedPayments.length === 0 ? (
                      <p style={{ fontSize: 13, color: TEXT_TERTIARY, textAlign: 'center', margin: '12px 0' }}>
                        이번 달 결제 내역이 없습니다.
                      </p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {sortedPayments.map((p) => {
                          const studentName = p.studentIds
                            .map((id) => studentNameMap[id])
                            .filter(Boolean)
                            .map((n) => n.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*/gu, '').trim())
                            .join(', ') || '—';
                          const ctTitle = classTypeMap[p.classTypeId]?.title || '';
                          const paymentDateStr = p.paymentDate
                            ? new Date(p.paymentDate).toLocaleDateString('ko-KR', { timeZone: KST })
                            : '';
                          return (
                            <div
                              key={p.id}
                              style={{
                                padding: '12px 14px', borderRadius: 12,
                                background: '#f9fafb', border: '1px solid #f0f0f0' }}
                            >
                              <div className="flex items-center justify-between">
                                <span style={{ fontSize: 14, fontWeight: 600, color: TEXT_PRIMARY }}>
                                  {studentName}
                                </span>
                                <span className="tabular-nums" style={{ fontSize: 14, fontWeight: 700, color: TEXT_PRIMARY }}>
                                  {formatKRW(p.actualAmount || 0)}
                                </span>
                              </div>
                              <div className="flex items-center justify-between" style={{ marginTop: 4 }}>
                                <span style={{ fontSize: 12, color: TEXT_TERTIARY }}>
                                  결제일 {paymentDateStr}
                                </span>
                                {ctTitle && (
                                  <span style={{ fontSize: 11, color: TEXT_DISABLED }}>
                                    {ctTitle}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* 예상 추가 섹션 */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: TEXT_PRIMARY, marginBottom: 8 }}>
                  예상 추가 {entries.length > 0 && <span className="tabular-nums" style={{ color: TEXT_TERTIARY, fontWeight: 400 }}>· {entries.length}명</span>}
                </div>
                {entries.length === 0 ? (
                  <p style={{ fontSize: 13, color: TEXT_TERTIARY, textAlign: 'center', margin: '12px 0' }}>
                    예상되는 학생이 없습니다.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {entries.map((e) => (
                      <div
                        key={`${e.studentId}-${e.expectedDateRaw}`}
                        style={{
                          padding: '12px 14px', borderRadius: 12,
                          background: '#f9fafb', border: '1px solid #f0f0f0' }}
                      >
                        <div className="flex items-center justify-between">
                          <span style={{ fontSize: 14, fontWeight: 600, color: TEXT_PRIMARY }}>
                            {e.studentName}
                          </span>
                          <span className="tabular-nums" style={{ fontSize: 14, fontWeight: 700, color: PRIMARY }}>
                            {formatKRW(e.expectedAmount)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between" style={{ marginTop: 4 }}>
                          <span style={{ fontSize: 12, color: TEXT_TERTIARY }}>
                            예상일 {e.expectedStr}
                          </span>
                          <span style={{ fontSize: 11, color: TEXT_DISABLED }}>
                            {e.basis}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </Modal>
    </>
  );
});

export default IncomeSummary;
