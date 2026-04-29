import React, { useEffect, useState } from 'react';
import { deleteKiwoomSettings, getKiwoomSettings, saveKiwoomSettings, testKiwoomSettings } from '../api/client.js';

export function KiwoomSetupPage({ onBack }) {
  const [settings, setSettings] = useState(null);
  const [appKey, setAppKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [environment, setEnvironment] = useState('production');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    const result = await getKiwoomSettings();
    setSettings(result);
    setEnvironment(result.environment || 'production');
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  async function save(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      const result = await saveKiwoomSettings({ appKey, secretKey, environment });
      setSettings(result);
      setAppKey('');
      setSecretKey('');
      setMessage('키움 App Key / Secret Key를 저장했습니다.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function test() {
    setError('');
    setMessage('');
    const result = await testKiwoomSettings();
    setSettings((prev) => ({ ...(prev || {}), status: result.status }));
    result.ok ? setMessage(result.message) : setError(result.message);
  }

  async function remove() {
    await deleteKiwoomSettings();
    await load();
    setMessage('키움 설정을 삭제했습니다.');
  }

  return (
    <section className="content setup-page">
      <section className="panel section">
        <div className="panel-heading">
          <div>
            <h2>키움 REST API 설정</h2>
            <p>사용자별 키움 인증정보를 backend에 암호화 저장합니다.</p>
          </div>
          <button type="button" className="ghost" onClick={onBack}>전략으로</button>
        </div>

        <div className="setup-guidance" role="note">
          <p>키움 REST API 사용을 위해 사용자는 키움증권 계좌와 REST API 사용 신청이 필요합니다.</p>
          <p>사용자는 키움 REST API 사이트에서 App Key / Secret Key를 직접 발급받아야 합니다.</p>
          <p>키움 REST API 사이트의 계좌 App Key 관리 화면에서 IP 등록이 필요합니다.</p>
          <p>등록할 IP는 브라우저를 여는 사용자 PC IP가 아니라, 이 웹앱 backend 서버의 outbound public IP입니다.</p>
          <p><b>현재 등록해야 할 서버 IP: {settings?.ec2ElasticIp || '(EC2_ELASTIC_IP 미설정)'}</b></p>
          <p>IP 등록을 하지 않으면 access token 발급이 실패할 수 있습니다.</p>
          <p>이 앱은 현재 실주문을 지원하지 않고, 시세/차트 조회와 가상 주문/백테스트만 지원합니다.</p>
        </div>

        <div className="settings-summary">
          <span>상태: <b>{settings?.status || '확인 전'}</b></span>
          <span>App Key: <b>{settings?.appKeyMasked || '미등록'}</b></span>
        </div>

        <form className="setup-form" onSubmit={save}>
          <label>
            <span>환경</span>
            <select value={environment} onChange={(e) => setEnvironment(e.target.value)}>
              <option value="production">운영 REST API</option>
              <option value="mock">키움 Mock API</option>
            </select>
          </label>
          <label>
            <span>App Key</span>
            <input value={appKey} onChange={(e) => setAppKey(e.target.value)} autoComplete="off" required />
          </label>
          <label>
            <span>Secret Key</span>
            <input type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} autoComplete="off" required />
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
