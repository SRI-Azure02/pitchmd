'use client';

import { useCallback, useEffect, useState } from 'react';

export interface Account {
  accountId: string;
  accountName: string;
  city: string;
  state: string;
  accountType: string;
  hcpCount: number;
  specialtyMix: string;
}

export interface UseAccountListReturn {
  accounts: Account[];
  loading: boolean;
  error: string | null;
  load: () => void;
}

export function useAccountList({ lazy = false }: { lazy?: boolean } = {}): UseAccountListReturn {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [triggered, setTriggered] = useState(!lazy);

  const load = useCallback(() => setTriggered(true), []);

  useEffect(() => {
    if (!triggered) return;
    let cancelled = false;
    setLoading(true);
    fetch('/api/accounts')
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        setAccounts(d.accounts ?? []);
        setError(null);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load accounts');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [triggered]);

  return { accounts, loading, error, load };
}
