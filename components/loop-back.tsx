'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  ArrowDown, ArrowUp, ArrowUpDown, CheckSquare, ChevronDown, ChevronUp,
  Circle, Clock, Plus, Search, Square, Trash2, X,
} from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Task {
  TASK_ID: string;
  PHYSICIAN_ID: string;
  SOURCE_NOTE_ID: string | null;
  TASK_TEXT: string;
  COMPLETED: boolean;
  CREATED_AT: string;        // ISO string from Snowflake
}

interface Physician {
  PHYSICIAN_ID: string;
  FIRST_NAME: string;
  LAST_NAME: string;
  SPECIALTY: string | null;
  SEGMENT_NAME: string | null;
  STATE: string | null;
  OVERALL_SCORE: number | null;
  FIELD_READINESS: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysSince(isoDate: string): number {
  const ms = Date.now() - new Date(isoDate).getTime();
  return Math.floor(ms / 86_400_000);
}

function fmtDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function AgeBadge({ days }: { days: number }) {
  if (days < 5)  return <span className="text-xs text-slate-400">{days}d ago</span>;
  if (days < 10) return (
    <span className="inline-flex items-center gap-0.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
      <Clock className="w-3 h-3" />{days}d ago
    </span>
  );
  return (
    <span className="inline-flex items-center gap-0.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full">
      <Clock className="w-3 h-3" />{days}d ago
    </span>
  );
}


// ── Task row ──────────────────────────────────────────────────────────────────

function TaskItem({ task, onToggle, onDelete }: {
  task: Task;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const days = daysSince(task.CREATED_AT);
  const done = task.COMPLETED;

  return (
    <div className={`flex items-start gap-3 py-2.5 px-3 rounded-lg group/task transition-colors ${done ? 'opacity-50' : 'hover:bg-white/60'}`}>
      <button onClick={onToggle} className={`mt-0.5 shrink-0 transition-colors ${done ? 'text-emerald-500' : 'text-slate-300 hover:text-emerald-400'}`}>
        {done ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
      </button>
      <div className="flex-1 min-w-0">
        <p className={`text-sm leading-snug ${done ? 'line-through text-slate-400' : 'text-slate-700'}`}>
          {task.TASK_TEXT}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-slate-400">{fmtDate(task.CREATED_AT)}</span>
          {!done && <AgeBadge days={days} />}
        </div>
      </div>
      <button
        onClick={onDelete}
        className="shrink-0 opacity-0 group-hover/task:opacity-100 transition-opacity text-slate-300 hover:text-red-400 mt-0.5"
        title="Delete task"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Add task input ────────────────────────────────────────────────────────────

function AddTaskInput({ onAdd }: { onAdd: (text: string) => Promise<void> }) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleAdd = async () => {
    const t = text.trim(); if (!t) return;
    setSaving(true);
    try {
      await onAdd(t);
      setText('');
    } finally { setSaving(false); }
  };

  return (
    <div className="flex items-center gap-2 pt-2 border-t border-slate-200/60 mt-1">
      <Plus className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
        placeholder="Add a task…"
        className="flex-1 text-sm text-slate-700 placeholder:text-slate-400 bg-transparent border-none outline-none"
      />
      {text.trim() && (
        <button
          onClick={handleAdd}
          disabled={saving}
          className="h-7 px-3 rounded-full text-xs font-medium text-white disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg,#FF6B00,#00C8FF)' }}
        >
          {saving ? '…' : 'Add'}
        </button>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface LoopBackProps {
  username: string;
  onBack: () => void;
}

type SortField = 'name' | 'specialty' | 'segment' | 'state' | 'overallScore' | 'fieldReadiness' | 'taskCount';
type SortDir = 'asc' | 'desc';

export default function LoopBack({ username: _username, onBack }: LoopBackProps) {
  const [physicians, setPhysicians]     = useState<Physician[]>([]);
  const [physLoading, setPhysLoading]   = useState(true);
  const [tasks, setTasks]               = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [expandedId, setExpandedId]     = useState<string | null>(null);
  const [search, setSearch]             = useState('');
  const [sortConfig, setSortConfig]     = useState<{ field: SortField; dir: SortDir } | null>(null);

  // Load physicians
  useEffect(() => {
    fetch('/api/physicians?scores=true')
      .then(r => r.json())
      .then(d => setPhysicians(d.physicians ?? d ?? []))
      .catch(console.error)
      .finally(() => setPhysLoading(false));
  }, []);

  // Load tasks
  const loadTasks = useCallback(() => {
    setTasksLoading(true);
    fetch('/api/loopback/tasks')
      .then(r => r.json())
      .then(d => {
        const raw: any[] = d.tasks ?? [];
        // Normalise Snowflake quirks: booleans come back as strings, timestamps may lack 'Z'
        const normalised: Task[] = raw.map(t => ({
          ...t,
          COMPLETED: t.COMPLETED === true || t.COMPLETED === 'true' || t.COMPLETED === 'TRUE',
          CREATED_AT: (() => {
            const v = t.CREATED_AT;
            if (!v) return new Date().toISOString();
            const s = String(v);
            // Snowflake sometimes returns Unix epoch seconds as a decimal string
            if (/^\d{9,11}(\.\d+)?$/.test(s)) return new Date(parseFloat(s) * 1000).toISOString();
            // Or a timestamp with space separator and no Z
            if (s.includes(' ')) return s.replace(' ', 'T') + 'Z';
            // Already ISO
            return s.endsWith('Z') ? s : s + 'Z';
          })(),
        }));
        setTasks(normalised);
      })
      .catch(console.error)
      .finally(() => setTasksLoading(false));
  }, []);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  // Group tasks by physician
  const tasksByPhysician = tasks.reduce<Record<string, Task[]>>((acc, t) => {
    if (!acc[t.PHYSICIAN_ID]) acc[t.PHYSICIAN_ID] = [];
    acc[t.PHYSICIAN_ID].push(t);
    return acc;
  }, {});

  const taskCount = (pid: string) => (tasksByPhysician[pid] ?? []).filter(t => !t.COMPLETED).length;

  // Sorting
  const handleSort = (field: SortField) => {
    setSortConfig(prev =>
      prev?.field === field
        ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'asc' }
    );
  };

  const sortedPhysicians = [...physicians]
    .filter(p => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        p.FIRST_NAME?.toLowerCase().includes(q) ||
        p.LAST_NAME?.toLowerCase().includes(q) ||
        p.SPECIALTY?.toLowerCase().includes(q) ||
        p.SEGMENT_NAME?.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (!sortConfig) return 0;
      const dir = sortConfig.dir === 'asc' ? 1 : -1;
      switch (sortConfig.field) {
        case 'name':         return dir * (`${a.LAST_NAME}${a.FIRST_NAME}`).localeCompare(`${b.LAST_NAME}${b.FIRST_NAME}`);
        case 'specialty':    return dir * (a.SPECIALTY ?? '').localeCompare(b.SPECIALTY ?? '');
        case 'segment':      return dir * (a.SEGMENT_NAME ?? '').localeCompare(b.SEGMENT_NAME ?? '');
        case 'state':        return dir * (a.STATE ?? '').localeCompare(b.STATE ?? '');
        case 'overallScore': return dir * ((a.OVERALL_SCORE ?? 0) - (b.OVERALL_SCORE ?? 0));
        case 'fieldReadiness': return dir * (a.FIELD_READINESS ?? '').localeCompare(b.FIELD_READINESS ?? '');
        case 'taskCount':    return dir * (taskCount(a.PHYSICIAN_ID) - taskCount(b.PHYSICIAN_ID));
        default:             return 0;
      }
    });

  // Task actions
  const handleToggle = async (task: Task) => {
    // Optimistic update
    setTasks(prev => prev.map(t => t.TASK_ID === task.TASK_ID ? { ...t, COMPLETED: !t.COMPLETED } : t));
    try {
      await fetch('/api/loopback/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.TASK_ID, completed: !task.COMPLETED }),
      });
    } catch { loadTasks(); }
  };

  const handleDelete = async (taskId: string) => {
    setTasks(prev => prev.filter(t => t.TASK_ID !== taskId));
    try {
      await fetch('/api/loopback/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, deleted: true }),
      });
    } catch { loadTasks(); }
  };

  const handleAddTask = async (physicianId: string, taskText: string) => {
    const res = await fetch('/api/loopback/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ physicianId, taskText }),
    });
    const data = await res.json();
    if (data.taskId) {
      setTasks(prev => [
        ...prev,
        {
          TASK_ID: data.taskId,
          PHYSICIAN_ID: physicianId,
          SOURCE_NOTE_ID: null,
          TASK_TEXT: taskText,
          COMPLETED: false,
          CREATED_AT: new Date().toISOString(),
        },
      ]);
    }
  };

  // Sort indicator helper
  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortConfig?.field !== field) return <ArrowUpDown className="w-3 h-3 opacity-0 group-hover/th:opacity-40 transition-opacity" />;
    return sortConfig.dir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />;
  };

  const loading = physLoading || tasksLoading;

  return (
    <div className="flex flex-col h-full min-h-0 bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-slate-100 bg-white shrink-0">
        <div>
          <p className="text-lg font-semibold text-slate-900">Loop Back</p>
          <p className="text-sm text-slate-400">Track commitments and follow-up actions from your calls</p>
        </div>
        <button
          onClick={onBack}
          className="text-sm text-slate-400 hover:text-slate-700 px-3 py-1 rounded-full hover:bg-slate-100 transition-colors"
        >
          Back
        </button>
      </div>

      {/* Search bar */}
      <div className="shrink-0 px-4 py-2.5 border-b border-slate-100 bg-slate-50/60">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search physicians…"
              className="w-full pl-8 pr-3 py-1.5 rounded-full border border-slate-200 bg-white text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-300"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <p className="text-xs text-slate-400">
            {sortedPhysicians.length} of {physicians.length} physician{physicians.length !== 1 ? 's' : ''}
          </p>
          {/* Legend */}
          <div className="ml-auto flex items-center gap-3 text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> 5–9 days
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> 10+ days
            </span>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40 gap-2 text-slate-400">
            <Spinner className="w-4 h-4" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : (
          <table className="w-full text-base border-collapse min-w-[700px]">
            <thead className="sticky top-0 bg-white z-10 shadow-[0_1px_0_0_#e2e8f0]">
              <tr>
                {([
                  { label: 'Physician',   field: 'name'      as SortField, align: 'left' },
                  { label: 'Specialty',   field: 'specialty' as SortField, align: 'left' },
                  { label: 'Segment',     field: 'segment'   as SortField, align: 'left' },
                  { label: 'State',       field: 'state'     as SortField, align: 'left' },
                ]).map(({ label, field, align }) => (
                  <th
                    key={field}
                    onClick={() => handleSort(field)}
                    className="group/th px-4 py-2.5 text-sm font-semibold uppercase tracking-wide cursor-pointer select-none transition-colors"
                    style={{ textAlign: align as any }}
                  >
                    <span
                      className={`inline-flex items-center gap-1 group-hover/th:text-slate-600 ${align === 'center' ? 'justify-center w-full' : ''}`}
                      style={{ color: sortConfig?.field === field ? '#3b82f6' : '#94a3b8' }}
                    >
                      {label}
                      <SortIcon field={field} />
                    </span>
                  </th>
                ))}
                {/* Tasks column */}
                <th
                  onClick={() => handleSort('taskCount')}
                  className="group/th sticky right-0 bg-white px-4 py-2.5 text-sm font-semibold uppercase tracking-wide cursor-pointer select-none shadow-[-1px_0_0_0_#e2e8f0]"
                  style={{ textAlign: 'center' }}
                >
                  <span
                    className="inline-flex items-center justify-center gap-1 group-hover/th:text-slate-600"
                    style={{ color: sortConfig?.field === 'taskCount' ? '#3b82f6' : '#94a3b8' }}
                  >
                    Tasks
                    <SortIcon field="taskCount" />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedPhysicians.map(p => {
                const pTasks    = tasksByPhysician[p.PHYSICIAN_ID] ?? [];
                const openTasks = pTasks.filter(t => !t.COMPLETED).sort((a, b) => new Date(b.CREATED_AT).getTime() - new Date(a.CREATED_AT).getTime());
                const doneTasks = pTasks.filter(t => t.COMPLETED).sort((a, b) => new Date(b.CREATED_AT).getTime() - new Date(a.CREATED_AT).getTime());
                const open      = expandedId === p.PHYSICIAN_ID;
                const count     = openTasks.length;
                const amber     = openTasks.filter(t => { const d = daysSince(t.CREATED_AT); return d >= 5 && d < 10; }).length;
                const red       = openTasks.filter(t => daysSince(t.CREATED_AT) >= 10).length;

                return (
                  <React.Fragment key={p.PHYSICIAN_ID}>
                    <tr
                      className="group border-b border-slate-100 hover:bg-slate-100/70 transition-colors cursor-pointer"
                      onClick={() => setExpandedId(prev => prev === p.PHYSICIAN_ID ? null : p.PHYSICIAN_ID)}
                    >
                      {/* Name */}
                      <td className="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">
                        <span className="flex items-center gap-2">
                          {open ? <ChevronUp className="w-3.5 h-3.5 text-slate-400 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                          Dr. {p.FIRST_NAME} {p.LAST_NAME}
                        </span>
                      </td>
                      {/* Specialty */}
                      <td className="px-4 py-3 text-slate-600">{p.SPECIALTY ?? <span className="text-slate-300">—</span>}</td>
                      {/* Segment */}
                      <td className="px-4 py-3 text-slate-600">{p.SEGMENT_NAME ?? <span className="text-slate-300">—</span>}</td>
                      {/* State */}
                      <td className="px-4 py-3 text-slate-600">{p.STATE ?? <span className="text-slate-300">—</span>}</td>
                      {/* Task count */}
                      <td className="sticky right-0 bg-white group-hover:bg-slate-100/70 px-4 py-3 shadow-[-1px_0_0_0_#e2e8f0] transition-colors">
                        {count === 0 ? (
                          <Circle className="w-4 h-4 text-slate-200 mx-auto" />
                        ) : (
                          <div className="flex items-center gap-1.5 justify-center">
                            <span className="text-sm font-semibold text-slate-700">{count}</span>
                            {amber > 0 && (
                              <>
                                <span className="text-slate-300">|</span>
                                <span className="text-sm font-semibold text-amber-600">{amber}</span>
                              </>
                            )}
                            {red > 0 && (
                              <>
                                <span className="text-slate-300">|</span>
                                <span className="text-sm font-semibold text-red-600">{red}</span>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>

                    {/* Expanded task panel */}
                    {open && (
                      <tr className="border-b border-slate-200">
                        <td colSpan={5} className="p-0">
                          <div className="bg-slate-50 px-6 py-4 space-y-1">
                            {/* Open tasks */}
                            {openTasks.length === 0 && doneTasks.length === 0 && (
                              <p className="text-sm text-slate-400 py-2">No tasks yet. Add one below.</p>
                            )}
                            {openTasks.map(t => (
                              <TaskItem key={t.TASK_ID} task={t} onToggle={() => handleToggle(t)} onDelete={() => handleDelete(t.TASK_ID)} />
                            ))}
                            {/* Divider before completed */}
                            {doneTasks.length > 0 && (
                              <>
                                {openTasks.length > 0 && <div className="border-t border-slate-200 my-2" />}
                                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest px-3 pb-1">Completed</p>
                                {doneTasks.map(t => (
                                  <TaskItem key={t.TASK_ID} task={t} onToggle={() => handleToggle(t)} onDelete={() => handleDelete(t.TASK_ID)} />
                                ))}
                              </>
                            )}
                            {/* Add task */}
                            <AddTaskInput onAdd={(text) => handleAddTask(p.PHYSICIAN_ID, text)} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
