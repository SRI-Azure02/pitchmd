'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Play, Lock, ZoomIn, ZoomOut, Maximize2, Save, Eye, Route, RotateCcw, Shield, ChevronDown, Trash2, Undo2, Redo2 } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AccountPhysician {
  physicianId: string;
  firstName: string;
  lastName: string;
  specialty: string;
  city: string;
  state: string;
  segment: string;
  fieldReadiness?: string | null;
  overallScore?: number | null;
}

interface Pt { x: number; y: number }

interface FlowEdge {
  id: string;
  from: string;
  to: string;
  propOnly?: boolean;
}

interface FlowData {
  nodePos: Record<string, Pt>;
  gatePos: Record<string, Pt>;
  edges: FlowEdge[];
  gateTypes: Record<string, 'AND' | 'OR'>;
  prop: Record<string, number>;
}

interface Version {
  version: number;
  savedAt: string;
  notes: string;
  data: FlowData;
}

interface Props {
  accountId: string;
  accountName: string;
  isAdmin?: boolean;
  onBack: () => void;
  onStartPitch: (
    physician: AccountPhysician,
    context: Array<{ fromPhysicianId: string; propagationIndex: number }>
  ) => void;
}

type ConnectType = 'flow' | 'prop';
type ShowLines = 'both' | 'flow' | 'prop';

// ── Constants ─────────────────────────────────────────────────────────────────

const NW = 210, NH = 100;
const GD = 44;
const CW = 2400, CH = 1600;
// Each node has two distinct ports per side — flow (upper) and prop (lower)
const FLOW_PORT_Y = NH / 2 - 14;  // 36px from top
const PROP_PORT_Y = NH / 2 + 14;  // 64px from top
const DEFAULT_PROP = 6;
const MAX_VERSIONS = 10;

// ── Storage keys ──────────────────────────────────────────────────────────────

const WORK_STOR     = (id: string) => `pitchmd_flow_${id}`;
const VERSIONS_STOR = (id: string) => `pitchmd_versions_${id}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

const bz = (x1: number, y1: number, x2: number, y2: number) => {
  const cx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${cx} ${y1} ${cx} ${y2} ${x2} ${y2}`;
};

const mid = (x1: number, y1: number, x2: number, y2: number): Pt => ({
  x: (x1 + x2) / 2, y: (y1 + y2) / 2,
});

const diamondHalf = (p: number) => 7 + (p / 10) * 10;
const propColor   = (p: number) => p <= 3 ? '#94a3b8' : p <= 6 ? '#f59e0b' : '#10b981';

const gridPt = (i: number, cols: number): Pt => ({
  x: 80 + (i % cols) * 300,
  y: 80 + Math.floor(i / cols) * 220,
});

function cardColors(p: AccountPhysician, isFrom: boolean) {
  if (isFrom) return { border: '2px solid #3b82f6', background: '#fff', shadow: '0 0 0 4px rgba(59,130,246,0.18), 0 4px 16px rgba(0,0,0,0.1)' };
  if (p.fieldReadiness === 'Ready')
    return { border: '2px solid #10b981', background: '#f0fdf4', shadow: '0 2px 10px rgba(0,0,0,0.07)' };
  const score = p.overallScore ?? 0;
  if (score >= 60)
    return { border: '2px solid #f59e0b', background: '#fffbeb', shadow: '0 2px 10px rgba(0,0,0,0.07)' };
  return { border: '2px solid #ef4444', background: '#fef2f2', shadow: '0 2px 10px rgba(0,0,0,0.07)' };
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function generateNotes(prev: FlowData | null, next: FlowData, physicians: AccountPhysician[], isDefault?: boolean): string {
  const getName = (id: string) => {
    const p = physicians.find(q => q.physicianId === id);
    return p ? `Dr. ${p.lastName}` : id;
  };

  if (!prev) {
    const flowCount = next.edges.filter(e => !e.propOnly).length;
    const propCount = next.edges.filter(e => e.propOnly).length;
    const parts: string[] = [];
    if (flowCount) parts.push(`${flowCount} flow connection${flowCount > 1 ? 's' : ''}`);
    if (propCount) parts.push(`${propCount} propagation-only line${propCount > 1 ? 's' : ''}`);
    return isDefault
      ? `Default set: ${parts.length ? parts.join(' and ') : 'empty canvas'}.`
      : `Initial save: ${parts.length ? parts.join(' and ') : 'empty canvas'}.`;
  }

  const changes: string[] = [];

  const prevKeys = new Set(prev.edges.map(e => `${e.from}>${e.to}:${e.propOnly ? 'p' : 'f'}`));
  const nextKeys = new Set(next.edges.map(e => `${e.from}>${e.to}:${e.propOnly ? 'p' : 'f'}`));
  next.edges.filter(e => !prevKeys.has(`${e.from}>${e.to}:${e.propOnly ? 'p' : 'f'}`))
    .forEach(e => changes.push(`Added ${e.propOnly ? 'propagation' : 'flow'}: ${getName(e.from)} → ${getName(e.to)}`));
  prev.edges.filter(e => !nextKeys.has(`${e.from}>${e.to}:${e.propOnly ? 'p' : 'f'}`))
    .forEach(e => changes.push(`Removed ${e.propOnly ? 'propagation' : 'flow'}: ${getName(e.from)} → ${getName(e.to)}`));

  next.edges.forEach(e => {
    const pv = prev.prop[e.id], nv = next.prop[e.id];
    if (pv !== undefined && nv !== undefined && pv !== nv)
      changes.push(`Propagation ${getName(e.from)}→${getName(e.to)}: ${pv}→${nv}`);
  });

  Object.keys(next.gateTypes).forEach(id => {
    if (prev.gateTypes[id] && prev.gateTypes[id] !== next.gateTypes[id])
      changes.push(`Gate at ${getName(id)}: ${prev.gateTypes[id]}→${next.gateTypes[id]}`);
  });

  return changes.length ? changes.join('. ') + '.' : 'Layout adjustments.';
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AccountFlowEditor({ accountId, accountName, isAdmin = false, onBack, onStartPitch }: Props) {
  const [physicians, setPhysicians] = useState<AccountPhysician[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchErr, setFetchErr] = useState<string | null>(null);

  // Flow data
  const [nodePos, setNodePos] = useState<Record<string, Pt>>({});
  const [gatePos, setGatePos] = useState<Record<string, Pt>>({});
  const [edges, setEdges] = useState<FlowEdge[]>([]);
  const [gateTypes, setGateTypes] = useState<Record<string, 'AND' | 'OR'>>({});
  const [prop, setProp] = useState<Record<string, number>>({});

  // Versions and defaults
  const [versions, setVersions] = useState<Version[]>([]);
  const [adminDefault, setAdminDefault] = useState<FlowData | null>(null);

  // Version slider
  const [sliderIdx, setSliderIdx] = useState<number>(0);
  const [hoveredSliderDot, setHoveredSliderDot] = useState<number | null>(null);

  // Delete modal (shown when trying to save the 11th version)
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteSelection, setDeleteSelection] = useState<Set<number>>(new Set());

  // Undo / redo stacks
  const [undoStack, setUndoStack] = useState<FlowData[]>([]);
  const [redoStack, setRedoStack] = useState<FlowData[]>([]);

  // Interaction
  const [connectMode, setConnectMode] = useState(false);
  const [connectType, setConnectType] = useState<ConnectType>('flow');
  const [pendingFrom, setPendingFrom] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ kind: 'node' | 'gate'; id: string; ox: number; oy: number } | null>(null);
  const [propDrag, setPropDrag] = useState<{ eid: string; sy: number; sv: number } | null>(null);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const [hoverProp, setHoverProp] = useState<string | null>(null);
  const [ghost, setGhost] = useState<Pt | null>(null);

  // Visibility
  const [showLines, setShowLines] = useState<ShowLines>('both');

  // Zoom
  const [zoom, setZoom] = useState(1.0);

  // Panels
  const [savePanelOpen, setSavePanelOpen] = useState(false);
  const [resetPanelOpen, setResetPanelOpen] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const colsRef   = useRef<number>(1);
  // Stable ref to current flow state — lets pushUndo avoid stale closures
  const flowRef   = useRef<FlowData>({ nodePos: {}, gatePos: {}, edges: [], gateTypes: {}, prop: {} });

  // ── applyFlow (stable — used by both load and slider) ────────────────────

  const applyFlow = useCallback((f: FlowData, phys?: AccountPhysician[], cols?: number) => {
    const ph   = phys ?? physicians;
    const ncols = cols ?? colsRef.current;
    const pos = { ...f.nodePos };
    ph.forEach((p, i) => { if (!pos[p.physicianId]) pos[p.physicianId] = gridPt(i, ncols); });
    setNodePos(pos);
    setGatePos(f.gatePos ?? {});
    setEdges(f.edges ?? []);
    setGateTypes(f.gateTypes ?? {});
    setProp(f.prop ?? {});
  }, [physicians]);

  // Keep flowRef in sync so pushUndo always captures the latest state without deps
  useEffect(() => {
    flowRef.current = { nodePos, gatePos, edges, gateTypes, prop };
  }, [nodePos, gatePos, edges, gateTypes, prop]);

  // ── Undo / redo ───────────────────────────────────────────────────────────

  const pushUndo = useCallback(() => {
    const snapshot = { ...flowRef.current, edges: [...flowRef.current.edges] };
    setUndoStack(s => [...s, snapshot].slice(-10));
    setRedoStack([]);
  }, []);

  const doUndo = useCallback(() => {
    setUndoStack(s => {
      if (!s.length) return s;
      const prev = s[s.length - 1];
      setRedoStack(r => [...r, { ...flowRef.current, edges: [...flowRef.current.edges] }].slice(-10));
      setNodePos(prev.nodePos); setGatePos(prev.gatePos); setEdges(prev.edges);
      setGateTypes(prev.gateTypes); setProp(prev.prop);
      return s.slice(0, -1);
    });
  }, []);

  const doRedo = useCallback(() => {
    setRedoStack(s => {
      if (!s.length) return s;
      const next = s[s.length - 1];
      setUndoStack(r => [...r, { ...flowRef.current, edges: [...flowRef.current.edges] }].slice(-10));
      setNodePos(next.nodePos); setGatePos(next.gatePos); setEdges(next.edges);
      setGateTypes(next.gateTypes); setProp(next.prop);
      return s.slice(0, -1);
    });
  }, []);

  // Keyboard shortcuts: Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
      if ((e.key === 'y') || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); doRedo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [doUndo, doRedo]);

  // ── Slider items: [default, ...versionsOldestFirst] ──────────────────────

  const sliderItems = useMemo(() => {
    const items: Array<{ label: string; data: FlowData | null; notes: string; versionNum?: number }> = [
      { label: 'Default', data: adminDefault, notes: 'Account default set by admin.' },
    ];
    [...versions].reverse().forEach(v => {
      items.push({ label: `v${v.version}`, data: v.data, notes: v.notes, versionNum: v.version });
    });
    return items;
  }, [adminDefault, versions]);

  // ── Load ─────────────────────────────────────────────────────────────────────

  useEffect(() => {
    setLoading(true);

    function initGrid(phys: AccountPhysician[], cols: number) {
      const pos: Record<string, Pt> = {};
      phys.forEach((p, i) => { pos[p.physicianId] = gridPt(i, cols); });
      setNodePos(pos);
    }

    Promise.all([
      fetch(`/api/accounts/${encodeURIComponent(accountId)}/physicians`).then(r => r.json()),
      fetch(`/api/accounts/${encodeURIComponent(accountId)}/dynamic/default`).then(r => r.json()),
    ])
      .then(([physData, defaultData]: [{ physicians?: AccountPhysician[] }, { default?: FlowData | null }]) => {
        const phys = Array.from(
          new Map((physData.physicians ?? []).map((p: AccountPhysician) => [p.physicianId, p])).values()
        );
        setPhysicians(phys);
        const cols = Math.max(1, Math.ceil(Math.sqrt(phys.length)));
        colsRef.current = cols;

        const snowflakeDefault = defaultData.default ?? null;
        if (snowflakeDefault) setAdminDefault(snowflakeDefault);

        const saved = localStorage.getItem(WORK_STOR(accountId));
        let usedLocal = false;
        if (saved) {
          try {
            const parsed = JSON.parse(saved) as FlowData;
            if ((parsed.edges ?? []).length > 0) {
              applyFlow(parsed, phys, cols);
              usedLocal = true;
            }
          } catch { /* fall through */ }
        }
        if (!usedLocal) {
          if (snowflakeDefault) applyFlow(snowflakeDefault, phys, cols);
          else initGrid(phys, cols);
        }

        let loadedVersions: Version[] = [];
        try {
          const vraw = localStorage.getItem(VERSIONS_STOR(accountId));
          if (vraw) loadedVersions = JSON.parse(vraw);
        } catch { /* ignore */ }
        setVersions(loadedVersions);
        // Start at the latest (rightmost) position
        setSliderIdx(1 + loadedVersions.length - 1 < 0 ? 0 : loadedVersions.length);

        setFetchErr(null);
      })
      .catch((e: Error) => setFetchErr(e.message))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  // ── Auto-persist working state ────────────────────────────────────────────

  useEffect(() => {
    if (!physicians.length) return;
    localStorage.setItem(WORK_STOR(accountId), JSON.stringify({ nodePos, gatePos, edges, gateTypes, prop }));
  }, [nodePos, gatePos, edges, gateTypes, prop, accountId, physicians.length]);

  // ── Slider change ────────────────────────────────────────────────────────

  const onSliderChange = useCallback((idx: number) => {
    pushUndo();
    setSliderIdx(idx);
    const item = sliderItems[idx];
    if (item?.data) applyFlow(item.data);
  }, [sliderItems, applyFlow, pushUndo]);

  // ── Save / Reset / Default ────────────────────────────────────────────────

  const currentData = useCallback((): FlowData =>
    ({ nodePos, gatePos, edges, gateTypes, prop }), [nodePos, gatePos, edges, gateTypes, prop]);

  const commitSave = useCallback((baseVersions: Version[]) => {
    const prev = baseVersions.length > 0 ? baseVersions[0].data : adminDefault ?? null;
    const data = currentData();
    const notes = generateNotes(prev, data, physicians, false);
    const newVer: Version = {
      version: (baseVersions[0]?.version ?? 0) + 1,
      savedAt: new Date().toISOString(),
      notes,
      data,
    };
    const updated = [newVer, ...baseVersions];
    setVersions(updated);
    localStorage.setItem(VERSIONS_STOR(accountId), JSON.stringify(updated));
    // Jump to the new latest position: 1 (default) + updated.length - 1 = updated.length
    setSliderIdx(updated.length);
    setSavePanelOpen(false);
  }, [adminDefault, currentData, physicians, accountId]);

  const doSave = useCallback(() => {
    if (versions.length >= MAX_VERSIONS) {
      setShowDeleteModal(true);
      setDeleteSelection(new Set());
      return;
    }
    commitSave(versions);
  }, [versions, commitSave]);

  const doConfirmDeleteAndSave = useCallback(() => {
    if (deleteSelection.size === 0) return;
    const remaining = versions.filter(v => !deleteSelection.has(v.version));
    setDeleteSelection(new Set());
    setShowDeleteModal(false);
    commitSave(remaining);
  }, [versions, deleteSelection, commitSave]);

  const doDeleteVersion = useCallback((versionNum: number) => {
    const remaining = versions.filter(v => v.version !== versionNum);
    setVersions(remaining);
    localStorage.setItem(VERSIONS_STOR(accountId), JSON.stringify(remaining));
    // Clamp sliderIdx so it doesn't point past the new end
    setSliderIdx(prev => Math.min(prev, remaining.length));
  }, [versions, accountId]);

  const doRestore = useCallback((ver: Version) => {
    pushUndo();
    applyFlow(ver.data);
    setSavePanelOpen(false);
  }, [applyFlow, pushUndo]);

  const doSetDefault = useCallback(() => {
    const data = currentData();
    const prev = adminDefault;
    const notes = generateNotes(prev, data, physicians, true);
    const newVer: Version = {
      version: (versions[0]?.version ?? 0) + 1,
      savedAt: new Date().toISOString(),
      notes: `[Admin default] ${notes}`,
      data,
    };
    const updated = [newVer, ...versions].slice(0, 20);
    setAdminDefault(data);
    setVersions(updated);
    localStorage.setItem(VERSIONS_STOR(accountId), JSON.stringify(updated));
    setSliderIdx(updated.length);
    fetch(`/api/accounts/${encodeURIComponent(accountId)}/dynamic/default`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flowData: data }),
    }).catch(err => console.error('[doSetDefault]', err));
  }, [currentData, adminDefault, physicians, versions, accountId]);

  const doResetToDefault = useCallback(() => {
    pushUndo();
    if (adminDefault) applyFlow(adminDefault);
    else { setEdges([]); setGateTypes({}); setProp({}); setGatePos({}); }
    setSliderIdx(0);
    setResetPanelOpen(false);
  }, [adminDefault, applyFlow, pushUndo]);

  const doClearAll = useCallback(() => {
    pushUndo();
    setEdges([]); setGateTypes({}); setProp({}); setGatePos({});
    setResetPanelOpen(false);
  }, [pushUndo]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const flowEdges = useMemo(() => edges.filter(e => !e.propOnly), [edges]);

  const incoming = useMemo(() => {
    const m: Record<string, FlowEdge[]> = {};
    flowEdges.forEach(e => { (m[e.to] ??= []).push(e); });
    return m;
  }, [flowEdges]);

  const needsGate = useMemo(() =>
    new Set(Object.entries(incoming).filter(([, es]) => es.length >= 2).map(([id]) => id)),
    [incoming]);

  const eligibility = useMemo(() => {
    const res: Record<string, boolean> = {};
    const ready = (id: string) =>
      physicians.find(p => p.physicianId === id)?.fieldReadiness === 'Ready';
    physicians.forEach(p => {
      const inc = incoming[p.physicianId] ?? [];
      if (!inc.length) { res[p.physicianId] = true; return; }
      const g = gateTypes[p.physicianId] ?? 'AND';
      res[p.physicianId] = g === 'AND' ? inc.every(e => ready(e.from)) : inc.some(e => ready(e.from));
    });
    return res;
  }, [physicians, incoming, gateTypes]);

  // ── Port helpers ──────────────────────────────────────────────────────────

  const nRightFlow = (id: string): Pt => { const p = nodePos[id] ?? { x: 0, y: 0 }; return { x: p.x + NW, y: p.y + FLOW_PORT_Y }; };
  const nLeftFlow  = (id: string): Pt => { const p = nodePos[id] ?? { x: 0, y: 0 }; return { x: p.x,      y: p.y + FLOW_PORT_Y }; };
  const nRightProp = (id: string): Pt => { const p = nodePos[id] ?? { x: 0, y: 0 }; return { x: p.x + NW, y: p.y + PROP_PORT_Y }; };
  const nLeftProp  = (id: string): Pt => { const p = nodePos[id] ?? { x: 0, y: 0 }; return { x: p.x,      y: p.y + PROP_PORT_Y }; };

  const defGatePos = useCallback((tid: string): Pt => {
    const tp = nodePos[tid] ?? { x: 0, y: 0 };
    const inEdges = incoming[tid] ?? [];
    if (inEdges.length > 0) {
      const avgSrcX = inEdges.reduce((s, e) => s + ((nodePos[e.from]?.x ?? 0) + NW), 0) / inEdges.length;
      return { x: (avgSrcX + tp.x) / 2 - GD / 2, y: tp.y + FLOW_PORT_Y - GD / 2 };
    }
    return { x: tp.x - 150, y: tp.y + FLOW_PORT_Y - GD / 2 };
  }, [nodePos, incoming]);

  const getGatePos = useCallback((tid: string): Pt => gatePos[tid] ?? defGatePos(tid), [gatePos, defGatePos]);
  const gCenter    = useCallback((tid: string): Pt => { const p = getGatePos(tid); return { x: p.x + GD / 2, y: p.y + GD / 2 }; }, [getGatePos]);
  const tgtPort    = useCallback((tid: string): Pt => needsGate.has(tid) ? gCenter(tid) : nLeftFlow(tid), [needsGate, gCenter, nLeftFlow]);

  // ── Canvas / zoom ─────────────────────────────────────────────────────────

  const getPos = useCallback((e: React.MouseEvent): Pt => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom };
  }, [zoom]);

  const zoomBy = (delta: number) => setZoom(z => Math.max(0.25, Math.min(2, Math.round((z + delta) * 100) / 100)));

  const fitToScreen = useCallback(() => {
    if (!scrollRef.current || !physicians.length) return;
    const xs = physicians.map(p => nodePos[p.physicianId]?.x ?? 80);
    const ys = physicians.map(p => nodePos[p.physicianId]?.y ?? 80);
    const minX = Math.min(...xs) - 40, minY = Math.min(...ys) - 40;
    const maxX = Math.max(...xs) + NW + 40, maxY = Math.max(...ys) + NH + 40;
    const { clientWidth, clientHeight } = scrollRef.current;
    const newZoom = Math.max(0.25, Math.min(2, Math.min(clientWidth / (maxX - minX), clientHeight / (maxY - minY))));
    setZoom(newZoom);
    setTimeout(() => scrollRef.current?.scrollTo({ left: minX * newZoom, top: minY * newZoom }), 0);
  }, [physicians, nodePos]);

  // ── Mouse handlers ────────────────────────────────────────────────────────

  const onMove = useCallback((e: React.MouseEvent) => {
    const pos = getPos(e);
    if (dragging?.kind === 'node')
      setNodePos(p => ({ ...p, [dragging.id]: { x: pos.x - dragging.ox, y: pos.y - dragging.oy } }));
    else if (dragging?.kind === 'gate')
      setGatePos(p => ({ ...p, [dragging.id]: { x: pos.x - dragging.ox, y: pos.y - dragging.oy } }));
    if (propDrag) {
      const dy = propDrag.sy - pos.y;
      setProp(p => ({ ...p, [propDrag.eid]: Math.max(0, Math.min(10, Math.round(propDrag.sv + dy / 8))) }));
    }
    if (connectMode && pendingFrom) setGhost(pos);
  }, [dragging, propDrag, connectMode, pendingFrom, getPos]);

  const onUp = useCallback(() => { setDragging(null); setPropDrag(null); }, []);

  const onCanvasClick = useCallback(() => {
    if (connectMode && pendingFrom) { setPendingFrom(null); setGhost(null); }
    setSavePanelOpen(false); setResetPanelOpen(false);
  }, [connectMode, pendingFrom]);

  const onNodeDown = useCallback((e: React.MouseEvent, id: string) => {
    if (connectMode) return;
    e.stopPropagation();
    pushUndo();
    const pos = getPos(e);
    const np = nodePos[id] ?? { x: 0, y: 0 };
    setDragging({ kind: 'node', id, ox: pos.x - np.x, oy: pos.y - np.y });
  }, [connectMode, nodePos, getPos, pushUndo]);

  const onGateDown = useCallback((e: React.MouseEvent, tid: string) => {
    if (connectMode) return;
    e.stopPropagation();
    pushUndo();
    const pos = getPos(e);
    const gp = getGatePos(tid);
    setDragging({ kind: 'gate', id: tid, ox: pos.x - gp.x, oy: pos.y - gp.y });
  }, [connectMode, getGatePos, getPos, pushUndo]);

  const onNodeClick = useCallback((e: React.MouseEvent, id: string) => {
    if (!connectMode) return;
    e.stopPropagation();
    if (!pendingFrom) { setPendingFrom(id); return; }
    if (pendingFrom === id) return;
    const existing = edges.some(ed =>
      ed.from === pendingFrom && ed.to === id &&
      (connectType === 'prop' ? ed.propOnly === true : !ed.propOnly)
    );
    if (!existing) {
      pushUndo();
      const eid = `${pendingFrom}->${id}-${Date.now()}`;
      setEdges(p => [...p, { id: eid, from: pendingFrom, to: id, ...(connectType === 'prop' ? { propOnly: true } : {}) }]);
      setProp(p => ({ ...p, [eid]: DEFAULT_PROP }));
    }
    setPendingFrom(null); setGhost(null);
  }, [connectMode, connectType, pendingFrom, edges]);

  const delEdge = useCallback((eid: string, e: React.MouseEvent) => {
    e.stopPropagation();
    pushUndo();
    setEdges(p => p.filter(ed => ed.id !== eid));
  }, [pushUndo]);

  const toggleGate = useCallback((tid: string) => {
    pushUndo();
    setGateTypes(p => ({ ...p, [tid]: p[tid] === 'OR' ? 'AND' : 'OR' }));
  }, [pushUndo]);

  const prereqHint = useCallback((pid: string): string => {
    const inc = incoming[pid] ?? [];
    if (!inc.length) return '';
    const g = gateTypes[pid] ?? 'AND';
    const getName = (id: string) => { const p = physicians.find(q => q.physicianId === id); return p ? `Dr. ${p.lastName}` : id; };
    if (g === 'AND') {
      const unmet = inc.filter(e => physicians.find(p => p.physicianId === e.from)?.fieldReadiness !== 'Ready');
      return unmet.length ? `Complete ${unmet.map(e => getName(e.from)).join(' and ')} first` : '';
    }
    return `Complete ${inc.map(e => getName(e.from)).join(' or ')} first (any one)`;
  }, [incoming, gateTypes, physicians]);

  // ── Derived slider state ──────────────────────────────────────────────────

  const safeSliderIdx = Math.min(sliderIdx, sliderItems.length - 1);
  const isViewingHistory = safeSliderIdx > 0 && safeSliderIdx < sliderItems.length - 1;
  const viewingItem = sliderItems[safeSliderIdx];

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex items-center justify-center h-full gap-2 text-slate-400">
      <Spinner className="w-4 h-4" /><span className="text-sm">Loading account dynamic…</span>
    </div>
  );
  if (fetchErr) return (
    <div className="flex flex-col items-center justify-center h-full gap-2">
      <p className="text-sm text-red-500">{fetchErr}</p>
      <button onClick={onBack} className="text-xs text-blue-500 underline">← Back</button>
    </div>
  );

  const pendingPhys = physicians.find(p => p.physicianId === pendingFrom);
  const showFlow    = showLines === 'both' || showLines === 'flow';
  const showProp    = showLines === 'both' || showLines === 'prop';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, position: 'relative' }}>

      {/* ── Delete-to-save modal ── */}
      {showDeleteModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.45)' }}
          onClick={() => setShowDeleteModal(false)}>
          <div style={{ background: '#fff', borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', padding: 24, width: 420, maxWidth: '90vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 14 }}
            onClick={e => e.stopPropagation()}>
            <div>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: '#0f172a' }}>Version limit reached</p>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
                You have {MAX_VERSIONS} saved versions. Delete one or more older versions to save a new one.
              </p>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
              {[...versions].reverse().slice(0, -1).map(v => (
                <label key={v.version} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', background: deleteSelection.has(v.version) ? '#fef2f2' : 'transparent', border: `1px solid ${deleteSelection.has(v.version) ? '#fca5a5' : '#f1f5f9'}` }}>
                  <input type="checkbox" checked={deleteSelection.has(v.version)}
                    onChange={ev => {
                      setDeleteSelection(prev => {
                        const next = new Set(prev);
                        ev.target.checked ? next.add(v.version) : next.delete(v.version);
                        return next;
                      });
                    }}
                    style={{ marginTop: 2, accentColor: '#ef4444', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>v{v.version}</span>
                      <span style={{ fontSize: 10, color: '#94a3b8', flexShrink: 0 }}>{fmtDate(v.savedAt)}</span>
                    </div>
                    <p style={{ margin: '2px 0 0', fontSize: 11, color: '#64748b', lineHeight: 1.4 }}>{v.notes}</p>
                  </div>
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={doConfirmDeleteAndSave}
                disabled={deleteSelection.size === 0}
                style={{ flex: 1, padding: '9px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: deleteSelection.size > 0 ? '#0f172a' : '#e2e8f0', color: deleteSelection.size > 0 ? '#fff' : '#94a3b8', border: 'none', cursor: deleteSelection.size > 0 ? 'pointer' : 'not-allowed' }}>
                Delete {deleteSelection.size > 0 ? `${deleteSelection.size} version${deleteSelection.size > 1 ? 's' : ''} and ` : ''}save
              </button>
              <button onClick={() => setShowDeleteModal(false)}
                style={{ padding: '9px 14px', borderRadius: 8, fontSize: 12, border: '1px solid #e2e8f0', background: 'transparent', cursor: 'pointer', color: '#64748b' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Title bar ── */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px', borderBottom: '1px solid #e2e8f0', background: '#fff' }}>
        <div>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#94a3b8' }}>Account Dynamic</p>
          <h2 style={{ margin: '2px 0 0', fontSize: 18, fontWeight: 800, color: '#0f172a' }}>{accountName}</h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {adminDefault && (
            <span style={{ fontSize: 10, color: '#64748b', background: '#f1f5f9', borderRadius: 5, padding: '2px 7px', border: '1px solid #e2e8f0' }}>
              Default set
            </span>
          )}
          {versions.length > 0 && (
            <span style={{ fontSize: 10, color: '#64748b', background: '#f1f5f9', borderRadius: 5, padding: '2px 7px', border: '1px solid #e2e8f0' }}>
              v{versions[0].version}
            </span>
          )}
          <button onClick={onBack} style={btn}><X style={{ width: 13, height: 13 }} /> Back</button>
        </div>
      </div>

      {/* ── Edit toolbar (row 1) ── */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5, padding: '6px 16px', borderBottom: '1px solid #e2e8f0', background: '#fff' }}>

        {/* Connect toggle */}
        <Route style={{ width: 13, height: 13, color: '#94a3b8', flexShrink: 0 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', background: '#f8fafc' }}>
          <button
            onClick={() => { const on = !connectMode || connectType !== 'flow'; setConnectMode(on); setConnectType('flow'); setPendingFrom(null); setGhost(null); }}
            title="Draw flow connections (solid arrow)"
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', fontSize: 11, fontWeight: 600, border: 'none', borderRight: '1px solid #e2e8f0', cursor: 'pointer', background: connectMode && connectType === 'flow' ? '#2563eb' : 'transparent', color: connectMode && connectType === 'flow' ? '#fff' : '#64748b', transition: 'background 150ms' }}>
            <svg width={14} height={10} style={{ flexShrink: 0 }}>
              <defs><marker id="fl-arr" markerWidth="4" markerHeight="3" refX="3" refY="1.5" orient="auto">
                <path d="M0,0 L0,3 L4,1.5 z" fill={connectMode && connectType === 'flow' ? '#fff' : '#475569'} />
              </marker></defs>
              <line x1={0} y1={5} x2={10} y2={5} stroke={connectMode && connectType === 'flow' ? '#fff' : '#475569'} strokeWidth={2} markerEnd="url(#fl-arr)" />
            </svg>
            {connectMode && connectType === 'flow'
              ? (pendingFrom ? `From ${pendingPhys?.lastName}…` : 'Pick source…')
              : 'Flow'}
          </button>
          <button
            onClick={() => { const on = !connectMode || connectType !== 'prop'; setConnectMode(on); setConnectType('prop'); setPendingFrom(null); setGhost(null); }}
            title="Draw propagation-only connections (dashed)"
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer', background: connectMode && connectType === 'prop' ? '#7c3aed' : 'transparent', color: connectMode && connectType === 'prop' ? '#fff' : '#64748b', transition: 'background 150ms' }}>
            <svg width={20} height={10} style={{ flexShrink: 0 }}>
              <line x1={0} y1={4} x2={14} y2={4} stroke={connectMode && connectType === 'prop' ? '#e9d5ff' : '#f59e0b'} strokeWidth={1.5} strokeDasharray="4 3" />
              <rect x={12} y={1} width={6} height={6} rx={1} transform="rotate(45 15 4)" fill="transparent" stroke={connectMode && connectType === 'prop' ? '#e9d5ff' : '#f59e0b'} strokeWidth={1.5} />
            </svg>
            {connectMode && connectType === 'prop'
              ? (pendingFrom ? `From ${pendingPhys?.lastName}…` : 'Pick source…')
              : 'Prop'}
          </button>
        </div>

        <div style={divider} />

        {/* Undo / Redo */}
        <button onClick={doUndo} disabled={!undoStack.length} title="Undo (Ctrl+Z)"
          style={{ ...btnIcon, color: undoStack.length ? '#475569' : '#cbd5e1', borderColor: undoStack.length ? '#e2e8f0' : '#f1f5f9', cursor: undoStack.length ? 'pointer' : 'not-allowed' }}>
          <Undo2 style={{ width: 13, height: 13 }} />
        </button>
        <button onClick={doRedo} disabled={!redoStack.length} title="Redo (Ctrl+Y)"
          style={{ ...btnIcon, color: redoStack.length ? '#475569' : '#cbd5e1', borderColor: redoStack.length ? '#e2e8f0' : '#f1f5f9', cursor: redoStack.length ? 'pointer' : 'not-allowed' }}>
          <Redo2 style={{ width: 13, height: 13 }} />
        </button>

        <div style={divider} />

        {/* Save */}
        <div style={{ position: 'relative' }}>
          <button onClick={() => { setSavePanelOpen(v => !v); setResetPanelOpen(false); }} style={btn}>
            <Save style={{ width: 13, height: 13 }} />
            Save{versions.length > 0 ? ` (v${versions[0].version + 1})` : ''}
          </button>
          {savePanelOpen && (
            <div style={{ position: 'absolute', top: '110%', left: 0, zIndex: 200, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.13)', padding: 14, width: 300 }}
              onClick={e => e.stopPropagation()}>
              <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: '#0f172a' }}>
                Save version {(versions[0]?.version ?? 0) + 1}
                {versions.length >= MAX_VERSIONS && (
                  <span style={{ marginLeft: 6, fontSize: 10, color: '#f59e0b', fontWeight: 600 }}>({MAX_VERSIONS}/{MAX_VERSIONS} — will prompt to delete)</span>
                )}
              </p>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={doSave} style={{ flex: 1, padding: '7px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: '#0f172a', color: '#fff', border: 'none', cursor: 'pointer' }}>
                  Save snapshot
                </button>
                <button onClick={() => setSavePanelOpen(false)} style={{ padding: '7px 12px', borderRadius: 6, fontSize: 12, border: '1px solid #e2e8f0', background: 'transparent', cursor: 'pointer', color: '#64748b' }}>Cancel</button>
              </div>
              {isAdmin && (
                <button onClick={() => { doSetDefault(); setSavePanelOpen(false); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '7px 10px', marginTop: 10, borderRadius: 6, fontSize: 12, fontWeight: 600, background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', cursor: 'pointer' }}>
                  <Shield style={{ width: 12, height: 12 }} /> Set as account default
                </button>
              )}
            </div>
          )}
        </div>

        {/* Reset */}
        <div style={{ position: 'relative' }}>
          <button onClick={() => { setResetPanelOpen(v => !v); setSavePanelOpen(false); }} style={btn}>
            <RotateCcw style={{ width: 13, height: 13 }} /> Reset <ChevronDown style={{ width: 11, height: 11, marginLeft: 1 }} />
          </button>
          {resetPanelOpen && (
            <div style={{ position: 'absolute', top: '110%', left: 0, zIndex: 200, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 8, minWidth: 200 }}
              onClick={e => e.stopPropagation()}>
              {adminDefault && (
                <button onClick={doResetToDefault}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: 'transparent', color: '#0f172a', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                  <RotateCcw style={{ width: 13, height: 13, color: '#10b981' }} />
                  Reset to account default
                </button>
              )}
              <button onClick={doClearAll}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: 'transparent', color: '#ef4444', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                <X style={{ width: 13, height: 13 }} />
                Clear all connections
              </button>
              {!adminDefault && (
                <p style={{ margin: '4px 12px 4px', fontSize: 10, color: '#94a3b8' }}>No account default set yet.</p>
              )}
            </div>
          )}
        </div>

        {/* ── Version slider (right-aligned) ── */}
        {versions.length > 0 && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.07em', textTransform: 'uppercase', flexShrink: 0 }}>History</span>
            <div style={{ display: 'flex', alignItems: 'center', position: 'relative', paddingBottom: 14 }}>
              {sliderItems.map((item, i) => {
                const isActive   = safeSliderIdx === i;
                const isPast     = safeSliderIdx > i;
                const isDefault  = i === 0;
                const isLatest   = i === sliderItems.length - 1;
                const canDelete  = !isDefault && !isLatest;
                const isHovered  = hoveredSliderDot === i;
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    {/* Connector line before this dot (except first) */}
                    {i > 0 && (
                      <div style={{ width: 20, height: 2, background: isPast || isActive ? '#3b82f6' : '#e2e8f0', flexShrink: 0 }} />
                    )}
                    {/* Dot + label */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}
                      onMouseEnter={() => setHoveredSliderDot(i)}
                      onMouseLeave={() => setHoveredSliderDot(null)}>
                      <button
                        onClick={() => onSliderChange(i)}
                        title={item.notes}
                        style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${isActive ? '#3b82f6' : isPast ? '#93c5fd' : '#cbd5e1'}`, background: isActive ? '#3b82f6' : isPast ? '#dbeafe' : '#fff', cursor: 'pointer', padding: 0, flexShrink: 0, position: 'relative', zIndex: 2, transition: 'all 120ms' }}
                      />
                      {/* Delete X — shown on hover for intermediate dots */}
                      {canDelete && isHovered && (
                        <button
                          onClick={e => { e.stopPropagation(); doDeleteVersion(item.versionNum!); }}
                          title={`Delete ${item.label}`}
                          style={{ position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)', width: 14, height: 14, borderRadius: '50%', background: '#ef4444', border: '1.5px solid #fff', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0, zIndex: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.2)' }}>
                          <X style={{ width: 8, height: 8 }} />
                        </button>
                      )}
                      {/* Label below dot */}
                      <span style={{ position: 'absolute', top: 16, fontSize: 8, fontWeight: isActive ? 700 : 400, color: isActive ? '#2563eb' : '#94a3b8', whiteSpace: 'nowrap', letterSpacing: '0.01em' }}>
                        {isDefault ? 'Default' : isLatest ? `v${item.versionNum} ★` : item.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>

      {/* ── View toolbar (row 2) ── */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5, padding: '6px 16px', borderBottom: '1px solid #e2e8f0', background: '#fafafa' }}>

        <Eye style={{ width: 13, height: 13, color: '#94a3b8', flexShrink: 0 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
          <button onClick={() => setShowLines('both')} title="Show flow lines and propagation lines"
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', fontSize: 11, fontWeight: 600, border: 'none', borderRight: '1px solid #e2e8f0', cursor: 'pointer', background: showLines === 'both' ? '#0f172a' : 'transparent', color: showLines === 'both' ? '#fff' : '#64748b', transition: 'background 150ms' }}>
            <svg width={28} height={12} style={{ flexShrink: 0 }}>
              <line x1={0} y1={4} x2={28} y2={4} stroke={showLines === 'both' ? '#93c5fd' : '#475569'} strokeWidth={2} />
              <line x1={0} y1={9} x2={28} y2={9} stroke={showLines === 'both' ? '#fcd34d' : '#f59e0b'} strokeWidth={1.5} strokeDasharray="4 3" />
            </svg>
            Both
          </button>
          <button onClick={() => setShowLines('flow')} title="Show solid flow lines only"
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', fontSize: 11, fontWeight: 600, border: 'none', borderRight: '1px solid #e2e8f0', cursor: 'pointer', background: showLines === 'flow' ? '#1e3a5f' : 'transparent', color: showLines === 'flow' ? '#fff' : '#64748b', transition: 'background 150ms' }}>
            <svg width={28} height={12} style={{ flexShrink: 0 }}>
              <defs><marker id="tb-arr" markerWidth="4" markerHeight="3" refX="3" refY="1.5" orient="auto"><path d="M0,0 L0,3 L4,1.5 z" fill={showLines === 'flow' ? '#93c5fd' : '#475569'} /></marker></defs>
              <line x1={0} y1={6} x2={24} y2={6} stroke={showLines === 'flow' ? '#93c5fd' : '#475569'} strokeWidth={2} markerEnd="url(#tb-arr)" />
            </svg>
            Flow
          </button>
          <button onClick={() => setShowLines('prop')} title="Show propagation lines only"
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer', background: showLines === 'prop' ? '#78350f' : 'transparent', color: showLines === 'prop' ? '#fff' : '#64748b', transition: 'background 150ms' }}>
            <svg width={28} height={12} style={{ flexShrink: 0 }}>
              <line x1={0} y1={5} x2={20} y2={5} stroke={showLines === 'prop' ? '#fcd34d' : '#f59e0b'} strokeWidth={1.5} strokeDasharray="4 3" />
              <rect x={20} y={2} width={6} height={6} rx={1} transform="rotate(45 23 5)" fill="#fff" stroke={showLines === 'prop' ? '#fcd34d' : '#f59e0b'} strokeWidth={1.5} />
            </svg>
            Prop
          </button>
        </div>

        <div style={divider} />

        <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
          <button onClick={() => zoomBy(-0.1)} style={btnIcon} title="Zoom out"><ZoomOut style={{ width: 13, height: 13 }} /></button>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', minWidth: 34, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
          <button onClick={() => zoomBy(0.1)} style={btnIcon} title="Zoom in"><ZoomIn style={{ width: 13, height: 13 }} /></button>
          <button onClick={fitToScreen} style={btnIcon} title="Fit all nodes on screen"><Maximize2 style={{ width: 13, height: 13 }} /></button>
        </div>

      </div>

      {/* ── Connect hint ── */}
      {connectMode && (
        <div style={{ flexShrink: 0, padding: '6px 20px', background: connectType === 'prop' ? '#f5f3ff' : '#eff6ff', borderBottom: `1px solid ${connectType === 'prop' ? '#ddd6fe' : '#bfdbfe'}`, fontSize: 12, color: connectType === 'prop' ? '#6d28d9' : '#1d4ed8' }}>
          {connectType === 'prop' ? '⟿ Propagation-only' : '→ Flow'} —{' '}
          {pendingFrom
            ? `Source: Dr. ${pendingPhys?.lastName}. Click a target physician to connect, or click the canvas to cancel.`
            : 'Click a physician to set as source, then click another to draw the connection.'}
        </div>
      )}

      {/* ── Legend ── */}
      {edges.length > 0 && (
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 18, padding: '5px 20px', background: '#f8f7f5', borderBottom: '1px solid #e7e5e4', fontSize: 11, color: '#64748b', flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width={36} height={10}><line x1={0} y1={5} x2={36} y2={5} stroke="#475569" strokeWidth={2} /></svg>
            Flow line (hover to delete)
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width={36} height={10}><line x1={0} y1={5} x2={36} y2={5} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 4" /></svg>
            Propagation (drag ↑↓ to adjust, hover to delete)
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#f0fdf4', border: '2px solid #10b981' }} /> Ready
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#fffbeb', border: '2px solid #f59e0b' }} /> Almost ready
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#fef2f2', border: '2px solid #ef4444' }} /> Not ready
          </span>
        </div>
      )}

      {/* ── Version history amber banner ── */}
      {isViewingHistory && viewingItem && (
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 20px', background: '#fffbeb', borderBottom: '1px solid #fde68a', fontSize: 11, color: '#92400e' }}>
          <span style={{ fontWeight: 700, flexShrink: 0 }}>Viewing {viewingItem.label}</span>
          <span style={{ color: '#b45309' }}>·</span>
          <span style={{ lineHeight: 1.5 }}>{viewingItem.notes}</span>
          <button
            onClick={() => onSliderChange(sliderItems.length - 1)}
            style={{ marginLeft: 'auto', flexShrink: 0, padding: '2px 10px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: '#fef3c7', color: '#92400e', border: '1px solid #fbbf24', cursor: 'pointer' }}>
            Jump to latest
          </button>
        </div>
      )}

      {/* ── Canvas ── */}
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', background: '#f6f4f0', backgroundImage: 'radial-gradient(circle, #c8c3ba 1px, transparent 1px)', backgroundSize: '24px 24px' }}>
        <div style={{ width: CW * zoom, height: CH * zoom, position: 'relative' }}>
          <div
            ref={canvasRef}
            style={{ width: CW, height: CH, position: 'absolute', top: 0, left: 0, transformOrigin: '0 0', transform: `scale(${zoom})`, cursor: connectMode ? 'crosshair' : 'default' }}
            onMouseMove={onMove} onMouseUp={onUp} onClick={onCanvasClick}
          >
            {/* ── SVG layer ── */}
            <svg style={{ position: 'absolute', inset: 0, width: CW, height: CH, overflow: 'visible', pointerEvents: 'none' }}>
              <defs>
                <marker id="arr"      markerWidth="5" markerHeight="4" refX="4" refY="2" orient="auto"><path d="M0,0 L0,4 L5,2 z" fill="#475569" /></marker>
                <marker id="arr-del"  markerWidth="5" markerHeight="4" refX="4" refY="2" orient="auto"><path d="M0,0 L0,4 L5,2 z" fill="#ef4444" /></marker>
                <marker id="arr-gate" markerWidth="5" markerHeight="4" refX="4" refY="2" orient="auto"><path d="M0,0 L0,4 L5,2 z" fill="#64748b" /></marker>
              </defs>

              {edges.map(edge => {
                const src = edge.propOnly ? nRightProp(edge.from) : nRightFlow(edge.from);
                const pv  = prop[edge.id] ?? DEFAULT_PROP;
                const hov = hoverEdge === edge.id;
                const pc  = propColor(pv);
                const dh  = diamondHalf(pv);
                const tgt     = edge.propOnly ? nLeftProp(edge.to) : tgtPort(edge.to);
                const propTgt = nLeftProp(edge.to);
                const pm      = mid(src.x, src.y, propTgt.x, propTgt.y);
                const hovFlow     = hov && hoverProp !== edge.id;
                const hovPropLine = hoverProp === edge.id;

                return (
                  <g key={edge.id}>
                    {!edge.propOnly && showFlow && (
                      <>
                        <path d={bz(src.x, src.y, tgt.x, tgt.y)} fill="none" stroke="transparent" strokeWidth={18}
                          style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                          onMouseEnter={() => { setHoverEdge(edge.id); setHoverProp(null); }}
                          onMouseLeave={() => { setHoverEdge(null); setHoverProp(null); }}
                          onClick={e => delEdge(edge.id, e as unknown as React.MouseEvent)} />
                        <path d={bz(src.x, src.y, tgt.x, tgt.y)} fill="none"
                          stroke={hovFlow ? '#ef4444' : '#475569'} strokeWidth={hovFlow ? 3 : 2}
                          strokeDasharray={hovFlow ? '8 4' : undefined}
                          markerEnd={hovFlow ? 'url(#arr-del)' : 'url(#arr)'}
                          style={{ pointerEvents: 'none' }} />
                      </>
                    )}

                    {showProp && (
                      <>
                        <path d={bz(src.x, src.y, propTgt.x, propTgt.y)} fill="none" stroke="transparent" strokeWidth={18}
                          style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                          onMouseEnter={() => { setHoverEdge(edge.id); setHoverProp(edge.id); }}
                          onMouseLeave={() => { setHoverEdge(null); setHoverProp(null); }}
                          onClick={e => delEdge(edge.id, e as unknown as React.MouseEvent)}
                          onMouseDown={e => {
                            e.stopPropagation();
                            pushUndo();
                            const pos = getPos(e as unknown as React.MouseEvent);
                            setPropDrag({ eid: edge.id, sy: pos.y, sv: pv });
                          }} />
                        <path d={bz(src.x, src.y, propTgt.x, propTgt.y)} fill="none"
                          stroke={hovPropLine ? '#ef4444' : pc}
                          strokeWidth={hovPropLine ? 2.5 : 2}
                          strokeDasharray={hovPropLine ? '6 3' : '5 4'}
                          style={{ pointerEvents: 'none' }} />
                        <g transform={`translate(${pm.x} ${pm.y})`} style={{ pointerEvents: 'none' }}>
                          <rect x={-dh} y={-dh} width={dh * 2} height={dh * 2} rx={2} transform="rotate(45)"
                            fill="#fff" stroke={hovPropLine ? '#ef4444' : pc} strokeWidth={2} />
                          <text x={0} y={Math.round(dh * 0.42)} textAnchor="middle"
                            fontSize={Math.round(9 + (pv / 10) * 6)} fontWeight={800}
                            fill={hovPropLine ? '#ef4444' : pc}>{pv}</text>
                        </g>
                      </>
                    )}
                  </g>
                );
              })}

              {showFlow && [...needsGate].map(tid => {
                const gc = gCenter(tid), tl = nLeftFlow(tid);
                return <path key={`gt-${tid}`} d={bz(gc.x, gc.y, tl.x, tl.y)} fill="none" stroke="#64748b" strokeWidth={2} markerEnd="url(#arr-gate)" style={{ pointerEvents: 'none' }} />;
              })}

              {connectMode && pendingFrom && ghost && (
                <path d={bz(
                    connectType === 'prop' ? nRightProp(pendingFrom).x : nRightFlow(pendingFrom).x,
                    connectType === 'prop' ? nRightProp(pendingFrom).y : nRightFlow(pendingFrom).y,
                    ghost.x, ghost.y
                  )} fill="none"
                  stroke={connectType === 'prop' ? '#7c3aed' : '#3b82f6'} strokeWidth={1.5}
                  strokeDasharray={connectType === 'prop' ? '4 4' : '6 3'} style={{ pointerEvents: 'none' }} />
              )}
            </svg>

            {/* ── Gate circles ── */}
            {showFlow && [...needsGate].map(tid => {
              const gp = getGatePos(tid), gate = gateTypes[tid] ?? 'AND';
              return (
                <div key={`gate-${tid}`}
                  style={{ position: 'absolute', left: gp.x, top: gp.y, width: GD, height: GD, borderRadius: '50%', background: gate === 'AND' ? '#1d4ed8' : '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: connectMode ? 'default' : 'grab', userSelect: 'none', zIndex: 15, boxShadow: '0 2px 8px rgba(0,0,0,0.22)', border: '2px solid rgba(255,255,255,0.35)', transition: 'background 200ms' }}
                  onMouseDown={e => onGateDown(e, tid)}
                  onClick={e => { e.stopPropagation(); if (!connectMode) toggleGate(tid); }}>
                  <span style={{ color: '#fff', fontSize: 10, fontWeight: 800, letterSpacing: '0.08em' }}>{gate}</span>
                </div>
              );
            })}

            {/* ── Physician nodes ── */}
            {physicians.map(p => {
              const pos      = nodePos[p.physicianId] ?? { x: 80, y: 80 };
              const isFrom   = pendingFrom === p.physicianId;
              const eligible = eligibility[p.physicianId] ?? true;
              const hint     = eligible ? '' : prereqHint(p.physicianId);
              const cc       = cardColors(p, isFrom);
              return (
                <div key={p.physicianId}
                  style={{ position: 'absolute', left: pos.x, top: pos.y, width: NW, height: NH, userSelect: 'none', zIndex: dragging?.id === p.physicianId ? 20 : 10, cursor: connectMode ? 'pointer' : dragging?.id === p.physicianId ? 'grabbing' : 'grab' }}
                  onMouseDown={e => onNodeDown(e, p.physicianId)}
                  onClick={e => onNodeClick(e, p.physicianId)}>
                  <div style={{ width: '100%', height: '100%', background: eligible ? cc.background : '#f8fafc', border: eligible ? cc.border : '2px solid #cbd5e1', borderRadius: 12, boxShadow: cc.shadow, padding: '10px 12px 10px 14px', display: 'flex', flexDirection: 'column', gap: 3, position: 'relative', transition: 'border-color 120ms, box-shadow 120ms' }}>
                    <div style={{ position: 'absolute', top: 9, right: 10, width: 8, height: 8, borderRadius: '50%', background: p.fieldReadiness === 'Ready' ? '#10b981' : (p.overallScore ?? 0) >= 60 ? '#f59e0b' : '#ef4444', border: `1.5px solid ${p.fieldReadiness === 'Ready' ? '#059669' : (p.overallScore ?? 0) >= 60 ? '#d97706' : '#dc2626'}` }} />
                    <div style={{ fontSize: 13, fontWeight: 700, color: eligible ? '#0f172a' : '#94a3b8', lineHeight: 1.25, paddingRight: 16 }}>Dr. {p.firstName} {p.lastName}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{p.specialty || '—'}</div>
                    {p.segment && <div style={{ fontSize: 10, color: '#a8a29e' }}>{p.segment}</div>}
                    {!connectMode && (eligible ? (
                      <button title="Practice pitch" onClick={e => { e.stopPropagation(); onStartPitch(p, (incoming[p.physicianId] ?? []).map(ed => ({ fromPhysicianId: ed.from, propagationIndex: prop[ed.id] ?? DEFAULT_PROP }))); }}
                        style={{ position: 'absolute', bottom: 8, right: 8, background: '#0f172a', color: '#fff', border: 'none', borderRadius: 6, padding: '3px 9px', fontSize: 10, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Play style={{ width: 9, height: 9 }} /> Pitch
                      </button>
                    ) : (
                      <div title={hint} style={{ position: 'absolute', bottom: 8, right: 8, background: '#f1f5f9', color: '#94a3b8', border: '1px solid #e2e8f0', borderRadius: 6, padding: '3px 9px', fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, cursor: 'not-allowed' }}>
                        <Lock style={{ width: 9, height: 9 }} /> Locked
                      </div>
                    ))}
                    {/* Flow ports (upper) */}
                    <div style={{ position: 'absolute', left: -6,  top: FLOW_PORT_Y, transform: 'translateY(-50%)', width: 10, height: 10, borderRadius: '50%', background: '#f1f5f9', border: '2px solid #94a3b8' }} />
                    <div style={{ position: 'absolute', right: -6, top: FLOW_PORT_Y, transform: 'translateY(-50%)', width: 10, height: 10, borderRadius: '50%', background: '#f1f5f9', border: '2px solid #94a3b8' }} />
                    {/* Prop ports (lower) */}
                    <div style={{ position: 'absolute', left: -6,  top: PROP_PORT_Y, transform: 'translateY(-50%)', width: 10, height: 10, borderRadius: '50%', background: '#fffbeb', border: '2px solid #f59e0b' }} />
                    <div style={{ position: 'absolute', right: -6, top: PROP_PORT_Y, transform: 'translateY(-50%)', width: 10, height: 10, borderRadius: '50%', background: '#fffbeb', border: '2px solid #f59e0b' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 5,
  padding: '6px 11px', borderRadius: 8, fontSize: 12, fontWeight: 600,
  color: '#475569', background: 'transparent', border: '1px solid #e2e8f0', cursor: 'pointer', flexShrink: 0,
};

const btnIcon: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 28, height: 28, borderRadius: 6,
  color: '#475569', background: 'transparent', border: '1px solid #e2e8f0', cursor: 'pointer', flexShrink: 0,
};

const divider: React.CSSProperties = {
  width: 1, height: 20, background: '#e2e8f0', margin: '0 2px', flexShrink: 0,
};
