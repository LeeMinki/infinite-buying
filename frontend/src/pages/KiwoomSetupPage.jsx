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
          <p>처음 설정하신다면 아래 순서대로 진행해 주세요.</p>
          <p>1) 키움 REST API 사이트에서 App Key / Secret Key를 발급받습니다.</p>
          <p>2) 키움 사이트의 <b>계좌 App Key 관리</b> 화면에 서버 IP를 등록합니다.</p>
          <p>3) 이 화면에서 App Key / Secret Key를 저장하고 <b>연결 테스트</b>를 누릅니다.</p>
          <p>중요: 등록해야 하는 IP는 내 PC IP가 아니라, 이 서비스 서버 IP입니다.</p>
          <p><b>지금 등록해야 할 서버 IP: {settings?.ec2ElasticIp || '(EC2_ELASTIC_IP 미설정)'}</b></p>
          <p>연결이 실패하면 키움 사이트에 위 서버 IP가 정확히 등록됐는지 먼저 확인해 주세요.</p>
          <p>이 앱은 실주문을 하지 않으며, 시세 조회와 가상 주문 기록만 제공합니다.</p>
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
