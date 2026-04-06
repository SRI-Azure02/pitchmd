'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const PAGE_SIZE = 25;

export interface PhysicianFilterOptions {
  segments:        string[];
  specialties:     string[];
  readinessValues: string[];
}

export interface UsePhysicianListReturn {
  // Data
  physicians:    any[];
  totalCount:    number;
  page:          number;
  pageSize:      number;
  loading:       boolean;
  error:         string | null;

  // Filter options for dropdowns (loaded once from /api/physicians/options)
  filterOptions: PhysicianFilterOptions;

  // Param setters — all reset page to 1 except setPage itself
  setPage:          (page: number) => void;
  search:           string;
  setSearch:        (s: string) => void;
  sortBy:           string;
  sortDir:          'asc' | 'desc';
  setSort:          (by: string, dir: 'asc' | 'desc') => void;
  filterSegment:    string | null;
  setFilterSegment: (v: string | null) => void;
  filterSpecialty:  string | null;
  setFilterSpecialty: (v: string | null) => void;

  /** Manually trigger the first fetch (use when lazy=true). */
  load: () => void;
  /** Re-fetch the current page (e.g. after a mutation). */
  reload: () => void;
}

/**
 * Paginated, server-side-filtered physician list hook.
 *
 * @param lazy  When true, no fetch happens until `load()` is called.
 *              Useful for components that only show the list on demand
 *              (e.g. the Practice Your Pitch physician picker).
 */
export function usePhysicianList({ lazy = false }: { lazy?: boolean } = {}): UsePhysicianListReturn {
  // ── Data state ───────────────────────────────────────────────────────────
  const [physicians, setPhysicians] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [filterOptions, setFilterOptions] = useState<PhysicianFilterOptions>({
    segments: [], specialties: [], readinessValues: [],
  });

  // ── Query params ─────────────────────────────────────────────────────────
  const [page, setPageState]         = useState(1);
  const [search, setSearchState]     = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortBy, setSortByState]     = useState('name');
  const [sortDir, setSortDirState]   = useState<'asc' | 'desc'>('asc');
  const [filterSegment, setFilterSegmentState]     = useState<string | null>(null);
  const [filterSpecialty, setFilterSpecialtyState] = useState<string | null>(null);

  // ── Lazy trigger ─────────────────────────────────────────────────────────
  const [triggered, setTriggered] = useState(!lazy);

  // ── Search debounce (300 ms) — resets page ───────────────────────────────
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setSearch = useCallback((s: string) => {
    setSearchState(s);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPageState(1);
      setDebouncedSearch(s);
    }, 300);
  }, []);

  // ── Param setters that reset page ────────────────────────────────────────
  const setPage = useCallback((p: number) => setPageState(p), []);

  const setSort = useCallback((by: string, dir: 'asc' | 'desc') => {
    setSortByState(by);
    setSortDirState(dir);
    setPageState(1);
  }, []);

  const setFilterSegment = useCallback((v: string | null) => {
    setFilterSegmentState(v);
    setPageState(1);
  }, []);

  const setFilterSpecialty = useCallback((v: string | null) => {
    setFilterSpecialtyState(v);
    setPageState(1);
  }, []);

  // ── Load trigger (for lazy mode) ──────────────────────────────────────────
  const load = useCallback(() => setTriggered(true), []);

  // ── Reload counter (incremented to re-fetch same page) ───────────────────
  const [reloadCounter, setReloadCounter] = useState(0);
  const reload = useCallback(() => setReloadCounter(c => c + 1), []);

  // ── Fetch filter options once on first trigger ────────────────────────────
  useEffect(() => {
    if (!triggered) return;
    fetch('/api/physicians/options')
      .then(r => r.json())
      .then((d: PhysicianFilterOptions) => setFilterOptions(d))
      .catch(() => {}); // non-fatal — dropdowns just stay empty
  }, [triggered]);

  // ── Main paginated fetch ──────────────────────────────────────────────────
  useEffect(() => {
    if (!triggered) return;

    const params = new URLSearchParams({
      page:     String(page),
      pageSize: String(PAGE_SIZE),
      sortBy,
      sortDir,
    });
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (filterSegment)   params.set('segment', filterSegment);
    if (filterSpecialty) params.set('specialty', filterSpecialty);

    let cancelled = false;
    setLoading(true);

    fetch(`/api/physicians?${params}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        setPhysicians(d.physicians ?? []);
        setTotalCount(d.totalCount ?? 0);
        setError(null);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load physicians');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [triggered, page, debouncedSearch, sortBy, sortDir, filterSegment, filterSpecialty, reloadCounter]);

  return {
    physicians, totalCount, page, pageSize: PAGE_SIZE, loading, error,
    filterOptions,
    setPage, search, setSearch,
    sortBy, sortDir, setSort,
    filterSegment, setFilterSegment,
    filterSpecialty, setFilterSpecialty,
    load, reload,
  };
}
