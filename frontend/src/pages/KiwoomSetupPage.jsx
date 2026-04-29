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
            <p>현재가와 일봉 차트를 키움에서 가져오기 위한 연결 설정입니다.</p>
          </div>
          <button type="button" className="ghost" onClick={onBack}>전략으로</button>
        </div>

        <div className="setup-guidance" role="note">
          <h3>키움 REST API 설정이 뭔가요?</h3>
          <p>
            키움 REST API는 이 앱이 키움 서버에 “이 종목 현재가 알려줘”, “일봉 차트 데이터 알려줘”라고
            요청할 수 있게 해주는 통로입니다.
          </p>
          <p>
            이 앱은 키움에 실주문을 보내지 않습니다. 저장한 키는 현재가/차트 조회에만 사용하고,
            App Key와 Secret Key는 서버에 암호화해서 저장합니다.
          </p>
        </div>

        <div className="setup-steps" aria-label="키움 REST API 설정 순서">
          <div className="setup-step">
            <span className="step-badge">1</span>
            <div>
              <h3>키움 사이트에서 먼저 할 일</h3>
              <p>
                아래 버튼으로 키움 REST API 사이트에 들어가 로그인합니다. 계좌가 없다면 키움 계좌 개설과
                REST API 사용 신청을 먼저 진행해야 합니다.
              </p>
              <a className="external-link" href="https://openapi.kiwoom.com/simpleAuthLoginView" target="_blank" rel="noreferrer">
                키움 REST API 사이트 열기
              </a>
            </div>
          </div>

          <div className="setup-step">
            <span className="step-badge">2</span>
            <div>
              <h3>키움에서 App Key / Secret Key 발급</h3>
              <p>
                키움 사이트 안의 App Key 관리 화면에서 REST API용 App Key와 Secret Key를 발급받습니다.
                이 두 값은 비밀번호처럼 다뤄야 하므로 다른 곳에 공개하지 마세요.
              </p>
            </div>
          </div>

          <div className="setup-step">
            <span className="step-badge">3</span>
            <div>
              <h3>키움 사이트에 이 앱 서버 IP 등록</h3>
              <p>
                키움은 등록된 IP에서 오는 요청만 허용합니다. 여기서 말하는 IP는 내 PC나 휴대폰 IP가 아니라,
                이 앱이 실행되는 서버 IP입니다.
              </p>
              <div className="server-ip-card">
                <span>키움 사이트에 등록할 서버 IP</span>
                <strong>{settings?.ec2ElasticIp || '(EC2_ELASTIC_IP 미설정)'}</strong>
              </div>
              <p>
                키움 사이트의 <b>계좌 App Key 관리</b> 화면에서 위 IP를 등록해 주세요. 이 IP가 빠지면
                연결 테스트나 현재가 조회가 실패할 수 있습니다.
              </p>
            </div>
          </div>

          <div className="setup-step">
            <span className="step-badge">4</span>
            <div>
              <h3>마지막으로 이 화면에 키 입력</h3>
              <p>
                키움에서 발급받은 App Key와 Secret Key를 아래 입력칸에 붙여넣고 저장합니다.
                저장 후에는 Secret Key 원문을 다시 보여주지 않습니다.
              </p>
            </div>
          </div>
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
            <small className="helper">
              운영 REST API는 실제 키움 token 발급을 확인합니다. Mock API는 개발 확인용이며 실제 키움 계정 연결을 검증하지 않습니다.
            </small>
          </label>
          <label>
            <span>App Key</span>
            <input
              value={appKey}
              onChange={(e) => setAppKey(e.target.value)}
              autoComplete="off"
              placeholder="키움 사이트에서 발급받은 App Key"
              required
            />
          </label>
          <label>
            <span>Secret Key</span>
            <input
              type="password"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              autoComplete="off"
              placeholder="키움 사이트에서 발급받은 Secret Key"
              required
            />
            <small className="helper">저장 후에는 보안을 위해 Secret Key를 다시 보여주지 않습니다.</small>
          </label>
          <div className="button-row">
            <button className="primary" type="submit">저장</button>
            <button type="button" onClick={test} disabled={!settings?.configured}>연결 테스트</button>
            <button type="button" className="ghost danger-button" onClick={remove} disabled={!settings?.configured}>삭제</button>
          </div>
          <p className="helper">
            연결 테스트는 현재 저장된 환경 기준으로 실행됩니다. 운영 REST API로 저장되어 있으면 키움 서버에 실제 access token 발급 요청을 보냅니다.
          </p>
        </form>

        {message && <div className="note success-note">{message}</div>}
        {error && <div className="note error-note">{error}</div>}
      </section>
    </section>
  );
}
