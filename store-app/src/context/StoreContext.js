import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as api from '../api';
import { useAuth } from './AuthContext';

const StoreContext = createContext(null);

export function StoreProvider({ children }) {
  const { storeId: scopedStoreId } = useAuth();
  const [store, setStore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (scopedStoreId) {
        const res = await api.getStore(scopedStoreId);
        setStore(res.data?.store || null);
      } else {
        // Admin/superadmin (not scoped): fall back to first store in the list.
        const res = await api.getStores();
        const list = res.data?.stores || [];
        setStore(list[0] || null);
      }
    } catch (e) {
      setError(e.message || 'Failed to load store');
      setStore(null);
    } finally {
      setLoading(false);
    }
  }, [scopedStoreId]);

  useEffect(() => {
    load();
  }, [load]);

  const value = useMemo(
    () => ({
      store,
      storeId: store ? String(store.id) : scopedStoreId || null,
      loading,
      error,
      reload: load,
      setStore,
    }),
    [store, scopedStoreId, loading, error, load],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
