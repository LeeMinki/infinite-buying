import { parseArgs } from 'node:util';
import { reconcileKrUnknownOrder } from '../services/krOrderRecoveryService.js';
import { closeDb } from '../db/connection.js';

try {
  const { values } = parseArgs({ options: {
    'user-id': { type: 'string' }, 'order-id': { type: 'string' },
    apply: { type: 'boolean', default: false },
    'acknowledge-same-account': { type: 'boolean', default: false },
    'acknowledge-no-broker-order': { type: 'boolean', default: false }
  } });
  const userId = Number(values['user-id']);
  const orderId = Number(values['order-id']);
  if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(orderId) || orderId <= 0) {
    throw new Error('사용법: node src/operations/reconcileKrUnknownOrder.js --user-id ID --order-id ID [--apply --acknowledge-no-broker-order --acknowledge-same-account]');
  }
  const result = await reconcileKrUnknownOrder({ userId, orderId, apply: values.apply,
    acknowledgeNoBrokerOrder: values['acknowledge-no-broker-order'], acknowledgeSameAccount: values['acknowledge-same-account'] });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  // 외부 응답/인증정보/스택을 출력하지 않는다.
  console.error(error?.name === 'TypeError' || /KIS|HTTP|fetch/i.test(error.message)
    ? '증권사 대사 조회에 실패했습니다. 운영 로그와 연결 상태를 확인하세요.' : error.message);
  process.exitCode = 1;
} finally {
  closeDb();
}
