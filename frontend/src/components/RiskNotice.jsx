import React from 'react';

export function RiskNotice({ variant = 'default', children }) {
  const className = `risk-notice risk-notice-${variant}`;
  return (
    <div className={className} role="note">
      <strong>주의</strong>
      <p>{children || '본 서비스의 백테스트 결과는 실제 투자 수익을 보장하지 않습니다.'}</p>
    </div>
  );
}
