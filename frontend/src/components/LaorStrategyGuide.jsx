import React from 'react';

export function LaorStrategyGuide({ mode = 'backtest' }) {
  const isAuto = mode === 'auto';

  return (
    <section className="laor-guide">
      <header>
        <h3>적용 알고리즘: LAOR_INFINITE_V2</h3>
        <p>
          내 돈을 정해 둔 회차 수만큼 나누고, 하루에 한 회차 예산만 사용합니다.
          보유 평단가보다 싸게 사는 주문과 전일 종가보다 조금 높게 잡는 큰수 매수 주문을 함께 계산합니다.
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
        <p>매수는 종가가 매수 기준가 이하일 때 종가로 체결된 것으로 계산합니다. 매도는 장중 고가가 목표가에 닿으면 목표가에 전량 매도한 것으로 계산합니다.</p>
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
          절반은 종가가 내 평단가 이하로 내려오면 매수합니다.
          나머지 절반은 큰수 매수입니다. 큰수 매수는 전일 종가에 사용자가 정한 여유율을 더한 가격까지 매수를 허용합니다.
        </p>
        <p className="laor-example">
          예) 회차 예산 100 USD, 평단가 70 USD, 전일 종가 68 USD, 큰수 매수 여유율 10%라면
          50 USD는 종가가 70 USD 이하일 때 쓰고, 나머지 50 USD는 종가가 74.8 USD 이하일 때 씁니다.
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
          회차 예산을 절반씩 나눠 두 매수 조건을 독립적으로 봅니다.
          현재가가 평단가 이하이면 첫 번째 절반(<b>평단가 매수</b>)을 매수 대상으로 잡고,
          현재가가 전일 종가 또는 기준가에 큰수 매수 여유율을 더한 가격 이하이면 두 번째 절반(<b>큰수 매수</b>)도 매수 대상으로 잡습니다.
        </p>
        <p className="laor-example">예) 큰수 매수 여유율 10%이고 기준가가 68 USD면, 큰수 매수는 74.8 USD 이하에서만 검토합니다.</p>
        <p className="helper">
          두 조건 모두 맞으면 회차 예산을 전부 매수합니다. 한쪽만 맞으면 그 절반만 매수하고 나머지 절반은 그대로 현금으로 남습니다(다음 회차 매수가능금액에 자동 합산). 둘 다 안 맞으면 관망입니다.
        </p>
      </GuideStep>

      <GuideStep number="3" title="회차 예산 매수 수량 계산">
        <p>조건에 맞은 예산으로 살 수 있는 수량을 계산합니다. 국내 종목은 정수 주, 해외 종목은 소수점 6자리까지 판단 기록에 남깁니다.</p>
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
