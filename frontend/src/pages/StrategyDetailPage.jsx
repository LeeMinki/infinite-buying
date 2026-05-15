import React, { useEffect, useState } from 'react';
import {
  cancelOrder,
  evaluateStrategy,
  fillOrder,
  getCurrentPrice,
  getDailyPrices,
  getHolding,
  getStrategy,
  listLogs,
  listOrders
} from '../api/client.js';
import { DailyChart } from '../components/DailyChart.jsx';
import { EvaluationPanel } from '../components/EvaluationPanel.jsx';
import { HoldingPanel } from '../components/HoldingPanel.jsx';
import { OrdersTable } from '../components/OrdersTable.jsx';

const DECISION_LABEL = {
  BUY: '매수',
  SELL: '매도',
  HOLD: '관망',
  PAUSE: '일시정지'
};

export function StrategyDetailPage({ strategyId, onChanged, onOpenBacktest, onOpenAutoTrading }) {
  const [strategy, setStrategy] = useState(null);
  const [holding, setHolding] = useState(null);
  const [orders, setOrders] = useState([]);
  const [logs, setLogs] = useState([]);
  const [daily, setDaily] = useState([]);
  const [currentPrice, setCurrentPrice] = useState('');
  const [currentPriceSource, setCurrentPriceSource] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [decision, setDecision] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    if (!strategyId) return;
    const [nextStrategy, nextHolding, nextOrders, nextLogs] = await Promise.all([
      getStrategy(strategyId),
      getHolding(strategyId),
      listOrders(strategyId),
      listLogs(strategyId)
    ]);
    setStrategy(nextStrategy);
    setHolding(nextHolding);
    setOrders(nextOrders);
    setLogs(nextLogs);
    setCurrency(inferCurrency(nextStrategy.stockCode));
    getDailyPrices(nextStrategy.stockCode).then(setDaily).catch(() => setDaily([]));
  }

  useEffect(() => {
    setError('');
    setDecision(null);
    load().catch((err) => setError(err.message));
  }, [strategyId]);

  if (!strategyId) {
    return (
      <section className="content empty-state">
        <div className="empty-state-card">
          <div className="icon-circle" aria-hidden="true">∞</div>
          <h2>전략을 선택해 시작하세요</h2>
          <p>왼쪽에서 만든 전략은 백테스트와 자동매매를 시작하기 전의 공통 초안입니다. 종목, 예산, 분할 회차, 목표 수익률을 먼저 정하고 이곳에서 현재가 기준 단일 평가를 확인할 수 있습니다.</p>
          <ol>
            <li>전략을 만들고 종목·예산·분할 회차를 정합니다.</li>
            <li>백테스트로 과거 가격에서 결과를 검증합니다.</li>
            <li>자동매매로 같은 설정을 가져가 실행 전략을 만듭니다.</li>
            <li>필요하면 이 화면에서 현재가 기준 단일 평가를 확인합니다.</li>
          </ol>
        </div>
      </section>
    );
  }

  async function fetchPrice() {
    const result = await getCurrentPrice(strategy.stockCode);
    setCurrentPrice(result.price);
    setCurrency(result.currency || inferCurrency(strategy.stockCode));
    setCurrentPriceSource(`${result.source} ${new Date(result.fetchedAt).toLocaleString('ko-KR')}`);
  }

  async function evaluate() {
    const result = await evaluateStrategy(strategy.id, Number(currentPrice));
    setDecision(result);
    await load();
    await onChanged(strategy.id);
  }

  async function fill(id) {
    await fillOrder(id);
    await load();
    await onChanged(strategy.id);
  }

  async function cancel(id) {
    await cancelOrder(id);
    await load();
  }

  const isPaused = strategy?.status === 'PAUSED';
  const progressRatio = strategy ? Math.min(1, strategy.currentRound / strategy.splitCount) : 0;
  const displayCurrency = currency || inferCurrency(strategy?.stockCode);

  return (
    <section className="content">
      {error && (
        <div className="panel section" style={{ borderColor: '#fecaca', background: '#fef2f2', color: '#991b1b' }}>
          <strong style={{ display: 'block', marginBottom: 4 }}>요청을 처리하지 못했습니다</strong>
          <span style={{ fontSize: 13 }}>{error}</span>
        </div>
      )}

      {strategy && (
        <>
          <section className="panel section">
            <div className="detail-hero">
              <div>
                <span className="eyebrow">{strategy.stockCode} · {strategy.stockName}</span>
                <h2>{strategy.name}</h2>
                <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                  설정한 규칙을 기반으로 매 평가마다 매수 · 매도 · 관망 · 일시정지를 판단합니다.
                </p>
              </div>
              <span className={`badge ${isPaused ? 'warning' : 'active'}`}>
                {isPaused ? '⏸ 일시정지' : '● 진행 중'}
              </span>
            </div>

            <div className="metric-grid">
              <div className="metric">
                <span className="metric-label">총 투자금</span>
                <strong>{formatMoney(strategy.totalBudget, displayCurrency)}</strong>
                <span className="metric-hint">전략에 배정한 전체 예산</span>
              </div>
              <div className="metric">
                <span className="metric-label">1회 매수금</span>
                <strong>{formatMoney(strategy.buyAmountPerRound, displayCurrency)}</strong>
                <span className="metric-hint">총 투자금 ÷ 분할 회차</span>
              </div>
              <div className="metric">
                <span className="metric-label">진행 회차</span>
                <strong>{strategy.currentRound} / {strategy.splitCount}</strong>
                <span className="metric-hint">{Math.round(progressRatio * 100)}% 진행됨</span>
              </div>
              <div className="metric">
                <span className="metric-label">목표 수익률</span>
                <strong>+{Math.round(strategy.targetProfitRate * 100)}%</strong>
                <span className="metric-hint">평균단가 대비 도달 시 매도</span>
              </div>
              <div className="metric">
                <span className="metric-label">큰수 매수 여유율</span>
                <strong>+{((strategy.effectiveBigBuyPremiumRate ?? strategy.bigBuyPremiumRate ?? 0) * 100).toFixed(4)}%</strong>
                <span className="metric-hint">{strategy.bigBuyPremiumRate == null ? '분할 회차 기반 자동값' : '사용자 입력값'}</span>
              </div>
            </div>

            <div className="strategy-bridge">
              <div>
                <h3>이 전략을 다음 단계로 사용</h3>
                <p>여기서 만든 종목·예산·분할 회차·목표 수익률을 백테스트나 자동매매 입력값으로 가져갑니다.</p>
              </div>
              <div className="strategy-bridge-actions">
                <button type="button" className="subtle" onClick={() => onOpenBacktest?.(strategy)}>
                  백테스트로 검증
                </button>
                <button type="button" className="primary" onClick={() => onOpenAutoTrading?.(strategy)}>
                  자동매매 전략 만들기
                </button>
              </div>
            </div>
          </section>

          <HoldingPanel holding={holding} currency={displayCurrency} />

          <EvaluationPanel
            strategy={strategy}
            currentPrice={currentPrice}
            setCurrentPrice={setCurrentPrice}
            onFetchPrice={fetchPrice}
            onEvaluate={evaluate}
            decision={decision}
            priceSource={currentPriceSource}
            currency={displayCurrency}
          />

          <DailyChart data={daily} stockCode={strategy.stockCode} currency={displayCurrency} />

          <OrdersTable orders={orders} onFill={fill} onCancel={cancel} />

          <section className="panel section">
            <div className="panel-heading">
              <div>
                <h3>판단 로그</h3>
                <p>평가를 실행할 때마다 결과와 사유가 이곳에 기록됩니다.</p>
              </div>
              <span className="heading-meta">{logs.length}건</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>시간</th>
                    <th>결정</th>
                    <th>입력가</th>
                    <th>사유</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id}>
                      <td className="muted">{formatDate(log.createdAt)}</td>
                      <td>
                        <span className={`decision compact ${log.decision.toLowerCase()}`}>
                          {DECISION_LABEL[log.decision] || log.decision}
                        </span>
                      </td>
                      <td>{formatMoney(log.inputPrice, displayCurrency)}</td>
                      <td className="muted">{log.reason}</td>
                    </tr>
                  ))}
                  {logs.length === 0 && (
                    <tr>
                      <td className="empty-row" colSpan="4">
                        아직 판단 로그가 없습니다. 위에서 <b>평가 실행</b>을 눌러주세요.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </section>
  );
}

function inferCurrency(symbol) {
  return /^\d{6}$/.test(String(symbol || '')) ? 'KRW' : 'USD';
}

function formatMoney(value, currency) {
  const locale = currency === 'KRW' ? 'ko-KR' : 'en-US';
  const maximumFractionDigits = currency === 'KRW' ? 0 : 2;
  return `${Number(value || 0).toLocaleString(locale, { maximumFractionDigits })} ${currency}`;
}

function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
