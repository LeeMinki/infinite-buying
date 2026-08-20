# Contract: KR Rank Shadow Experiment

## 내부 scheduler 입력

```json
{
  "userId": 13,
  "strategyId": 4,
  "tradeDate": "2026-08-20",
  "entryWindow": "MORNING",
  "observedAt": "ISO-8601",
  "ranking": "actual market-wide top 30",
  "quotes": "candidate quote map",
  "completedCandles": "candidate candle map"
}
```

`userId`와 secret-bearing KIS auth context는 저장 payload나 frontend response에 포함하지 않는다. 예시는 소유권 규칙 설명용이며 외부 public endpoint가 아니다.

## 후보 평가 결과

```json
{
  "experimentVersion": 1,
  "variant": "V3_COMPRESSION_BREAKOUT",
  "decision": "PASS",
  "candidate": {
    "symbol": "000000",
    "signalPrice": 10000
  },
  "reasonCodes": ["TOP10_PERSISTENT", "ABOVE_VWAP", "COMPRESSION", "BREAKOUT"],
  "liveOrderAllowed": false
}
```

`liveOrderAllowed`는 shadow/validation/final test에서 항상 false다.

## 승격 평가 결과

```json
{
  "variant": "V3_COMPRESSION_BREAKOUT",
  "sampleCount": 20,
  "winRate": 0.75,
  "netExpectancyRate": 0.001,
  "profitFactor": 1.1,
  "maxDrawdownRate": 0.08,
  "approved": true,
  "failedGates": []
}
```

승격 조건은 sampleCount ≥ 20, 비용 후 expectancy > 0, PF > 1, MDD ≤ 10%의 논리곱이다. 승인 결과만으로 사용자 live 설정을 자동 변경하지 않는다.
