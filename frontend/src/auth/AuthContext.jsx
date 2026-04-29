import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getMe, login as loginRequest, logout as logoutRequest, register as registerRequest } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMe()
      .then((result) => setUser(result.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo(() => ({
    user,
    loading,
    async login(payload) {
      const result = await loginRequest(payload);
      setUser(result.user);
    },
    async register(payload) {
      const result = await registerRequest(payload);
      setUser(result.user);
    },
    async logout() {
      await logoutRequest();
      setUser(null);
    }
  }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
