'use client';

// ── useAvatarProvider() ─────────────────────────────────────────────────────
//
// Manages the active avatar provider (Tavus | Anam) and persists the user's
// choice to localStorage so it survives reloads. The toggle affects NEW
// sessions only — switching mid-session is intentionally not wired here.

import { useCallback, useEffect, useState } from 'react';
import {
  AvatarProvider,
  DEFAULT_AVATAR_PROVIDER,
  isAvatarProvider,
} from '@/lib/avatar/types';

const STORAGE_KEY = 'pitchmd.avatarProvider';

export function useAvatarProvider() {
  // Start from the default for a stable SSR render, then hydrate from
  // localStorage on mount to avoid a hydration mismatch.
  const [avatarProvider, setProviderState] = useState<AvatarProvider>(DEFAULT_AVATAR_PROVIDER);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (isAvatarProvider(saved)) setProviderState(saved);
    } catch {
      /* localStorage unavailable (private mode / SSR) — keep default */
    }
  }, []);

  const setAvatarProvider = useCallback((provider: AvatarProvider) => {
    setProviderState(provider);
    try {
      localStorage.setItem(STORAGE_KEY, provider);
    } catch {
      /* ignore persistence failures */
    }
  }, []);

  return { avatarProvider, setAvatarProvider };
}
