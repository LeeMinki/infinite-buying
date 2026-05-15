import React from 'react';

export function LaorStrategyGuide({ mode = 'backtest' }) {
  const isAuto = mode === 'auto';

  return (
    <section className="laor-guide">
      <header>
        <h3>적용 알고리즘: LAOR_INFINITE_V2</h3>
        <p>
          내 돈을 정해 둔 회차 수만큼 나누고, 한 평가에서는 한 회차 예산만 사용합니다.
          보유 평단가 지정가와 전일 종가 기준 큰수 지정가를 나눠 걸고, 목표 수익률에 닿으면 장중 매도로 정리합니다.
        </p>
      </header>

      {isAuto ? <AutoTradingRules /> : <BacktestRules />}

      <footer className="laor-foot">
        {isAuto
          ? '자동매매는 KIS에서 조회한 현재가와 계좌 잔고를 기준으로 판단합니다. 실주문 설정이 꺼져 있으면 주문은 전송하지 않고 기록만 남깁니다.'
          : '매수·매도는 모두 백테스트 계산용 가상 체결입니다. 실제 주문은 발생하지 않습니다. 수수료·세금·환율·슬리피지는 0으로 가정합니다.'}
      </footer>
    </section>
  );
}

function BacktestRules() {
  return (
    <>
      <div className="laor-loc-box">
        <p><b>백테스트 체결 기준</b></p>
        <p>매수는 일봉 저가가 지정가에 닿으면 체결된 것으로 계산합니다. 체결가는 시가와 지정가 중 더 낮은 값입니다. 매도는 장중 고가가 목표가에 닿으면 목표가에 전량 매도한 것으로 계산합니다.</p>
      </div>

      <GuideStep number="1" title="분할 회차">
        <p>사이클 시작 시점의 총 시드를 분할 회차로 나눕니다. 40분할이면 매 회차 예산은 <b>현재 사이클 시드 ÷ 40</b>입니다.</p>
        <p className="laor-example">예) 총 시드 4,000 USD, 40분할이면 회차당 예산은 100 USD입니다.</p>
      </GuideStep>

      <GuideStep number="2" title="첫 매수">
        <p>보유 수량이 없으면 그날 시가로 첫 회차 예산만큼 매수합니다. 소수점 매수가 가능한 종목은 소수점 수량까지 계산합니다.</p>
        <p className="laor-example">예) 회차 예산 100 USD, 시가 42 USD면 2.380952주를 매수합니다.</p>
      </GuideStep>

      <GuideStep number="3" title="평단가 매수와 큰수 매수">
        <p>
          첫 매수 이후에는 회차 예산을 절반씩 나눕니다.
          절반은 평단가 지정가에 걸고, 나머지 절반은 큰수 지정가에 겁니다.
          큰수 지정가는 기본적으로 전일 종가 × (1 + 0.1 ÷ 분할 회차)입니다. 직접 여유율을 입력하면 그 값을 우선합니다.
        </p>
        <p className="laor-example">
          예) 40분할이면 큰수 여유율 자동값은 0.25%입니다. 전일 종가가 68 USD라면 큰수 지정가는 약 68.17 USD입니다.
          회차 예산 100 USD 중 50 USD는 평단가 지정가, 50 USD는 큰수 지정가에 배정됩니다.
        </p>
      </GuideStep>

      <GuideStep number="4" title="목표 수익률 매도">
        <p>보유 중인 종목의 장중 고가가 평단가 × (1 + 목표 수익률) 이상이면 목표가에 전량 매도한 것으로 계산합니다. 매도한 날에는 다시 매수하지 않고, 다음 거래일부터 새 판단을 시작합니다.</p>
      </GuideStep>

      <GuideStep number="5" title="회차 소진">
        <p>분할 회차를 모두 쓰고 현금이 다음 회차 예산보다 적으면, 보유 수량의 4분의 1을 종가에 매도해 다음 매수 자금을 확보합니다. 해외 종목은 소수점 6자리까지, 국내 종목은 최소 1주 단위로 계산합니다.</p>
        <p className="helper">매도 후 새 사이클 시작을 켜면 목표 매도 이후 늘거나 줄어든 총자산을 다시 분할해 다음 사이클을 시작합니다. 끄면 첫 목표 매도에서 종료합니다.</p>
      </GuideStep>
    </>
  );
}

function AutoTradingRules() {
  return (
    <>
      <GuideStep number="1" title="현재가와 계좌 확인">
        <p>자동매매는 평가할 때마다 KIS에서 현재가, 전일 종가 또는 기준가, 보유 수량, 평단가, 매수가능금액, 미체결 주문을 조회합니다.</p>
      </GuideStep>

      <GuideStep number="2" title="평단가 매수와 큰수 매수">
        <p>
          회차 예산을 절반씩 나눠 두 지정가 주문을 독립적으로 봅니다.
          평단가 매수는 평단가에, 큰수 매수는 전일 종가 또는 기준가 × (1 + 큰수 매수 여유율)에 주문을 준비합니다.
          큰수 매수 여유율은 비워두면 0.1 ÷ 분할 회차로 자동 계산합니다.
        </p>
        <p className="laor-example">예) 40분할이면 자동 여유율은 0.25%입니다. 기준가가 68 USD면 큰수 지정가는 약 68.17 USD입니다.</p>
        <p className="helper">
          두 주문이 모두 체결될 수도 있고, 한쪽만 체결될 수도 있습니다. 체결되지 않은 주문은 다음 평가 직전에 자동 취소 대상이 됩니다. 쓰지 않은 돈은 계좌 현금으로 남아 다음 평가의 매수가능금액에 포함됩니다.
        </p>
      </GuideStep>

      <GuideStep number="3" title="회차 예산 매수 수량 계산 + carryover">
        <p>조건에 맞은 절반 예산으로 살 수 있는 수량을 계산합니다. KIS Open API의 일반 해외주식 주문은 <b>1주 단위</b>만 받습니다. 회차 절반 예산이 1주 가격보다 작으면 매수를 보내지 않고 그 절반을 다음 사이클로 누적(carryover)해서 합산 후 매수합니다.</p>
        <p className="helper">예) 회차 예산이 100 USD, 절반 50 USD인데 평단가가 80 USD면 이번 사이클은 평단가 매수를 보내지 않고 50 USD를 다음 사이클로 이월합니다. 다음 사이클에 100 USD가 모이면 1주 매수, 잔액 20 USD는 다시 이월합니다. 새 사이클(목표 매도 후)이 시작되면 누적은 0으로 초기화됩니다.</p>
      </GuideStep>

      <GuideStep number="4" title="목표 수익률 매도">
        <p>보유 수량이 있고 현재가가 평단가 × (1 + 목표 수익률) 이상이면 매수 조건보다 먼저 평가되어 보유 수량 전량 매도를 판단합니다. 매도 판단이 나온 평가에서는 같은 평가 안에서 다시 매수하지 않습니다.</p>
      </GuideStep>

      <GuideStep number="5" title="실주문 전 확인 + 미체결 자동 취소">
        <p>실주문 모드에서는 미체결 주문, 중복 주문, 주문 수량, 매수가능금액, 보유 수량을 확인한 뒤 통과한 주문만 KIS로 전송합니다.</p>
        <p className="helper">
          이전 평가에서 우리가 KIS에 접수했던 주문이 미체결로 남아 신규 주문을 막고 있으면, 자동매매가 그 주문을 먼저 KIS 정정취소 API로 자동 취소한 뒤 진행합니다. 사용자가 KIS HTS/MTS에서 직접 만든 주문은 절대 건드리지 않고, 그 경우는 그대로 SKIP으로 기록합니다. DRY_RUN(기록) 모드에서는 어떤 주문도 취소하지 않습니다.
        </p>
      </GuideStep>
    </>
  );
}

function GuideStep({ number, title, children }) {
  return (
    <div className="laor-step">
      <span className="step-num">{number}</span>
      <div>
        <h4>{title}</h4>
        {children}
      </div>
    </div>
  );
}
