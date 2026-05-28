import React, { useState } from 'react';
import { useAuth } from './AuthContext.jsx';

export function RegisterPage({ onSwitch }) {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('비밀번호 확인이 일치하지 않습니다.');
      return;
    }
    setSubmitting(true);
    try {
      await auth.register({ email, password });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="auth-screen">
      <form className="auth-panel" onSubmit={submit}>
        <div className="brand compact">
          <div className="brand-logo" aria-hidden="true">∞</div>
          <div className="brand-text">
            <h1>무한매수 해죠</h1>
            <span>전략 운용 대시보드</span>
          </div>
        </div>
        <label>
          <span>이메일</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </label>
        <label>
          <span>비밀번호</span>
          <input type="password" minLength="8" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
          <small className="helper">8자 이상</small>
        </label>
        <label>
          <span>비밀번호 확인</span>
          <input
            type="password"
            minLength="8"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button className="primary wide" type="submit" disabled={submitting}>{submitting ? '가입 중...' : '회원가입'}</button>
        <button className="ghost wide" type="button" onClick={onSwitch}>로그인으로 돌아가기</button>
      </form>
    </section>
  );
}
