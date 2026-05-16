import React, { useEffect, useState } from 'react';
import { deleteKisSettings, getKisSettings, saveKisSettings, testKisSettings } from '../api/client.js';

export function KisSetupPage({ onBack }) {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState({ appKey: '', appSecret: '', accountNumber: '', accountProductCode: '01' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setSettings(await getKisSettings());
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function save(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      const result = await saveKisSettings(form);
      setSettings(result);
      setForm((current) => ({
        ...current,
        appKey: '',
        appSecret: '',
        // 계좌번호/상품코드는 비밀번호 수준이 아니므로 굳이 폼에서 지우지 않음.
      }));
      setMessage('KIS 설정을 저장했습니다.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function test() {
    setError('');
    setMessage('');
    const result = await testKisSettings();
    setSettings((prev) => ({ ...(prev || {}), status: result.status }));
    result.ok ? setMessage(result.message) : setError(result.message);
  }

  async function remove() {
    await deleteKisSettings();
    await load();
    setMessage('KIS 설정을 삭제했습니다.');
  }

  return (
    <section className="content setup-page">
      <section className="panel section">
        <div className="panel-heading">
          <div>
            <h2>KIS Open API 설정</h2>
            <p>한국투자증권(Korea Investment & Securities Co., Ltd., 이하 KIS) Open API로 국내/해외 종목 가격과 일봉 데이터를 조회합니다.</p>
          </div>
          <button type="button" className="ghost" onClick={onBack}>전략으로</button>
        </div>

        <div className="setup-guidance" role="note">
          <h3>설정 전에 준비할 것</h3>
          <p>
            KIS Developers에서 Open API 사용 신청을 완료하고 App Key와 App Secret을 발급받아야 합니다.
            이 앱은 저장된 키를 backend 서버에서만 사용하며, App Secret과 access token을 화면에 다시 표시하지 않습니다.
          </p>
          <p>
            이 앱은 종목 시세 조회, 백테스트, 자동매매를 지원합니다. 자동매매는 기록 모드와 실주문 모드로 나뉘며,
            실주문 모드를 켜면 안전 검증을 통과한 주문이 실제로 KIS에 전송됩니다.
          </p>
        </div>

        <div className="setup-steps" aria-label="KIS Open API 설정 순서">
          <div className="setup-step">
            <span className="step-badge">1</span>
            <div>
              <h3>KIS Developers에서 앱 생성</h3>
              <p>한국투자증권 계좌와 KIS Developers 계정이 필요합니다. 앱을 생성한 뒤 App Key와 App Secret을 확인합니다.</p>
              <a className="external-link" href="https://apiportal.koreainvestment.com/" target="_blank" rel="noreferrer">
                KIS Developers 열기
              </a>
            </div>
          </div>
          <div className="setup-step">
            <span className="step-badge">2</span>
            <div>
              <h3>App Key / App Secret 입력</h3>
              <p>KIS Developers에서 발급받은 값을 그대로 입력합니다. 이 앱은 실제 KIS Open API 서버로 시세를 조회합니다.</p>
            </div>
          </div>
          <div className="setup-step">
            <span className="step-badge">3</span>
            <div>
              <h3>계좌번호 입력 (자동매매 사용 시 필수)</h3>
              <p>
                <b>계좌번호</b>는 앞 8자리, <b>계좌상품코드</b>는 뒤 2자리입니다 (예: <code>12345678-01</code>이면 계좌번호 <code>12345678</code>, 상품코드 <code>01</code>).
                백테스트만 사용하면 이 값은 비워둬도 되지만, <b>자동매매</b>는 잔고/주문 API 호출에 계좌번호와 상품코드가 필수입니다.
              </p>
              <p className="helper">
                일반 위탁계좌의 상품코드는 보통 <code>01</code>입니다. KIS HTS [0301] 계좌조회 화면에서 정확한 값을 확인할 수 있습니다.
              </p>
            </div>
          </div>
          <div className="setup-step">
            <span className="step-badge">4</span>
            <div>
              <h3>저장 후 연결 테스트</h3>
              <p>연결 테스트는 저장된 App Key와 App Secret으로 KIS access token 발급 가능 여부만 확인합니다.</p>
            </div>
          </div>
        </div>

        <div className="setup-guidance" role="note" style={{ background: '#fffbeb', border: '1px solid #fde68a' }}>
          <h3>해외 종목(TQQQ, SOXL 등)을 자동매매하려면</h3>
          <p>
            한국투자증권은 주문이 나갈 때 원화를 자동으로 외화로 바꿔주지 않습니다. 해외 종목을 사려면 미리 준비가 필요하고, 방법은 두 가지입니다.
          </p>
          <ol>
            <li>
              <b>통합증거금 신청 (권장)</b> — 한국투자증권에 통합증거금을 신청하면 계좌의 원화가 환율로 계산되어 해외 매수가능금액에 더해집니다.
              따로 환전하지 않아도 자동매매가 그 금액으로 해외 종목을 살 수 있습니다. HTS <code>[0867] 통합증거금조회</code> 화면이나 영업점에서 신청할 수 있습니다.
            </li>
            <li>
              <b>직접 환전</b> — 또는 HTS·MTS에서 원화를 미리 외화로 환전해 두세요.
              통합증거금을 신청하지 않은 계좌는 환전해 둔 외화 잔고로만 매수가 됩니다.
            </li>
          </ol>
          <p className="helper">
            전략의 총 예산은 종목 통화 기준으로 입력합니다. 예를 들어 TQQQ 전략의 총 예산 1,000은 <b>1,000 USD</b>이고, 백테스트·자동매매 결과도 USD로 표시됩니다. 원화로 환산한 금액은 따로 보여주지 않습니다.
          </p>
        </div>

        <div className="settings-summary">
          <span>상태: <b>{settings?.status || '미설정'}</b></span>
          <span>App Key: <b>{settings?.appKeyMasked || '미등록'}</b></span>
          <span>계좌: <b>{settings?.accountConfigured ? '등록됨' : '미등록'}</b></span>
        </div>

        <form className="setup-form" onSubmit={save}>
          <label>
            <span>App Key</span>
            <input
              value={form.appKey}
              onChange={(e) => update('appKey', e.target.value)}
              autoComplete="off"
              placeholder="KIS Developers에서 발급받은 App Key"
              required
            />
          </label>
          <label>
            <span>App Secret</span>
            <input
              type="password"
              value={form.appSecret}
              onChange={(e) => update('appSecret', e.target.value)}
              autoComplete="off"
              placeholder="KIS Developers에서 발급받은 App Secret"
              required
            />
            <small className="helper">저장 후에는 보안을 위해 App Secret 원문을 다시 보여주지 않습니다.</small>
          </label>
          <label>
            <span>계좌번호 (CANO, 앞 8자리) <small className="helper" style={{ fontWeight: 'normal' }}>자동매매 사용 시 필수</small></span>
            <input
              value={form.accountNumber}
              onChange={(e) => update('accountNumber', e.target.value.replace(/[^0-9]/g, ''))}
              autoComplete="off"
              placeholder="예: 12345678"
              maxLength={8}
              inputMode="numeric"
            />
            <small className="helper">백테스트만 사용하면 비워둬도 됩니다. 저장 후 화면에 다시 표시되지 않으며 암호화되어 저장됩니다.</small>
          </label>
          <label>
            <span>계좌상품코드 (ACNT_PRDT_CD, 뒤 2자리)</span>
            <input
              value={form.accountProductCode}
              onChange={(e) => update('accountProductCode', e.target.value.replace(/[^0-9]/g, ''))}
              autoComplete="off"
              placeholder="예: 01"
              maxLength={2}
              inputMode="numeric"
            />
            <small className="helper">일반 위탁계좌는 보통 <code>01</code>. KIS HTS [0301] 화면에서 확인 가능.</small>
          </label>
          <div className="button-row">
            <button className="primary" type="submit">저장</button>
            <button type="button" onClick={test} disabled={!settings?.configured}>연결 테스트</button>
            <button type="button" className="ghost danger-button" onClick={remove} disabled={!settings?.configured}>삭제</button>
          </div>
        </form>

        {message && <div className="note success-note">{message}</div>}
        {error && <div className="note error-note">{error}</div>}
      </section>
    </section>
  );
}
