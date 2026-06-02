import React, { useState } from 'react';
import { useAuth } from './AuthContext.jsx';

export function LoginPage({ onSwitch }) {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await auth.login({ email, password });
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
            <span>티끌모아 태산</span>
          </div>
        </div>
        <label>
          <span>이메일</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </label>
        <label>
          <span>비밀번호</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button className="primary wide" type="submit" disabled={submitting}>{submitting ? '로그인 중...' : '로그인'}</button>
        <button className="ghost wide" type="button" onClick={onSwitch}>회원가입</button>
      </form>
    </section>
  );
}
