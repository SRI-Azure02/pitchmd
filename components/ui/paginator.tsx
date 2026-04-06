'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginatorProps {
  page:         number;
  pageSize:     number;
  total:        number;
  onPageChange: (page: number) => void;
  className?:   string;
}

/**
 * Simple prev / next paginator with a "Showing X–Y of Z" label.
 * Returns null when the total fits on a single page.
 */
export function Paginator({ page, pageSize, total, onPageChange, className = '' }: PaginatorProps) {
  if (total <= pageSize) return null;

  const totalPages = Math.ceil(total / pageSize);
  const start      = (page - 1) * pageSize + 1;
  const end        = Math.min(page * pageSize, total);

  return (
    <div className={`flex items-center justify-between px-4 py-2 border-t border-slate-100 bg-white text-sm shrink-0 ${className}`}>
      <span className="text-xs text-slate-400">
        Showing {start.toLocaleString()}–{end.toLocaleString()} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="p-1 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed text-slate-500 hover:text-slate-700 transition-colors"
          aria-label="Previous page"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-xs text-slate-500 px-1 tabular-nums">
          {page} / {totalPages}
        </span>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="p-1 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed text-slate-500 hover:text-slate-700 transition-colors"
          aria-label="Next page"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
