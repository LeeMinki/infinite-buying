import React, { useEffect, useState } from 'react';
import { deleteKisSettings, getKisSettings, saveKisSettings, testKisSettings } from '../api/client.js';

export function KisSetupPage({ onBack }) {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState({ appKey: '', appSecret: '' });
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
      setForm((current) => ({ ...current, appKey: '', appSecret: '' }));
      setMessage('KIS App Key와 App Secret을 저장했습니다.');
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
            현재 기능은 종목 가격 조회와 백테스트입니다. 실주문과 예약주문은 지원하지 않습니다.
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
              <h3>저장 후 연결 테스트</h3>
              <p>연결 테스트는 저장된 App Key와 App Secret으로 KIS access token 발급 가능 여부만 확인합니다.</p>
            </div>
          </div>
        </div>

        <div className="settings-summary">
          <span>상태: <b>{settings?.status || '미설정'}</b></span>
          <span>App Key: <b>{settings?.appKeyMasked || '미등록'}</b></span>
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
