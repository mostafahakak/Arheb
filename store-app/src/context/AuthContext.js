import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as api from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async () => {
    const token = await api.getToken();
    if (!token) {
      setAdmin(null);
      setLoading(false);
      return;
    }
    try {
      const res = await api.getMe();
      setAdmin(res.data || res.admin || null);
    } catch (e) {
      await api.setToken(null);
      setAdmin(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const login = useCallback(async (email, password) => {
    const res = await api.login(email, password);
    if (res.token) {
      await api.setToken(res.token);
      setAdmin(res.admin || null);
      return res;
    }
    throw new Error(res.message || 'Login failed');
  }, []);

  const logout = useCallback(async () => {
    await api.setToken(null);
    setAdmin(null);
  }, []);

  /** Store id this admin is scoped to (store_admin), or null. */
  const storeId = useMemo(() => {
    if (!admin) return null;
    return admin.storeId != null ? String(admin.storeId) : null;
  }, [admin]);

  const value = useMemo(
    () => ({ admin, storeId, loading, login, logout, refresh: loadUser }),
    [admin, storeId, loading, login, logout, loadUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
