import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { getSnowflakeClient } from '@/lib/snowflake';

// ── Seed data ─────────────────────────────────────────────────────────────────
//
// Flow design principles:
//  • Clinical Innovators & Leukemia/Hem KOLs → source (left)
//  • Volume-Driven Pragmatists → mid-tier
//  • Patient-Centric Conservatives → end nodes (right)
//  • Pure Hematologists feed into Leukemia/Hem experts
//  • Propagation index: 8 = strong direct influence, 6 = peer, 4 = indirect

const SEEDS: Array<{ accountId: string; accountName: string; flowData: object }> = [

  // ── ACC004 — Southern Blood Disorders Clinic ──────────────────────────────
  // Hillmen (Clinical Hem) → Konopleva (Leukemia/Hem KOL) → Kay & Kipps (H&O) → Woyach (H&MO)
  {
    accountId: 'ACC004',
    accountName: 'Southern Blood Disorders Clinic',
    flowData: {
      nodePos: {
        PHY018: { x: 80,   y: 320 },  // Hillmen   — Clinical Hematology
        PHY017: { x: 420,  y: 320 },  // Konopleva — Leukemia & Hematology (KOL)
        PHY020: { x: 780,  y: 160 },  // Kay       — Hematology & Oncology
        PHY016: { x: 780,  y: 460 },  // Kipps     — Hematology & Oncology
        PHY019: { x: 1140, y: 300 },  // Woyach    — Hematology & Medical Oncology
      },
      gatePos: {},
      edges: [
        // Flow chain: Hillmen → Konopleva → Kay → Woyach
        { id: 'PHY018->PHY017-seed', from: 'PHY018', to: 'PHY017' },
        { id: 'PHY017->PHY020-seed', from: 'PHY017', to: 'PHY020' },
        { id: 'PHY017->PHY016-seed', from: 'PHY017', to: 'PHY016' },
        { id: 'PHY020->PHY019-seed', from: 'PHY020', to: 'PHY019' },
        { id: 'PHY016->PHY019-seed', from: 'PHY016', to: 'PHY019' },
        // Propagation only: Hillmen's clinical data reaches Kay & Kipps directly
        { id: 'PHY018->PHY020-prop-seed', from: 'PHY018', to: 'PHY020', propOnly: true },
        { id: 'PHY018->PHY016-prop-seed', from: 'PHY018', to: 'PHY016', propOnly: true },
      ],
      gateTypes: {
        PHY019: 'OR',  // Woyach unlocked if Kay OR Kipps visited
      },
      prop: {
        'PHY018->PHY017-seed':      8,  // Hillmen → Konopleva: strong clinical feed
        'PHY017->PHY020-seed':      8,  // Konopleva → Kay: KOL to peer
        'PHY017->PHY016-seed':      8,  // Konopleva → Kipps: KOL to peer
        'PHY020->PHY019-seed':      7,  // Kay → Woyach: oncology to broader onc
        'PHY016->PHY019-seed':      6,  // Kipps → Woyach
        'PHY018->PHY020-prop-seed': 5,  // Hillmen → Kay: indirect clinical data
        'PHY018->PHY016-prop-seed': 5,  // Hillmen → Kipps: indirect clinical data
      },
    },
  },

  // ── ACC003 — Pacific Cancer Center ───────────────────────────────────────
  // Kantarjian (Leukemia/Hem KOL) → DiNardo (Leukemia/Onc) + Wierda (Leukemia/Hem)
  // Wierda → Furman (H&MO); DiNardo + Furman → Byrd (H&MO, OR gate)
  {
    accountId: 'ACC003',
    accountName: 'Pacific Cancer Center',
    flowData: {
      nodePos: {
        PHY015: { x: 80,   y: 260 },  // Kantarjian — Leukemia & Hematology (KOL)
        PHY013: { x: 80,   y: 480 },  // Wierda     — Leukemia & Hematology
        PHY014: { x: 480,  y: 160 },  // DiNardo    — Leukemia & Oncology (KOL)
        PHY012: { x: 480,  y: 460 },  // Furman     — Hematology & Medical Oncology
        PHY011: { x: 900,  y: 310 },  // Byrd       — Hematology & Medical Oncology
      },
      gatePos: {},
      edges: [
        { id: 'PHY015->PHY014-seed', from: 'PHY015', to: 'PHY014' },
        { id: 'PHY015->PHY013-seed', from: 'PHY015', to: 'PHY013' },
        { id: 'PHY013->PHY012-seed', from: 'PHY013', to: 'PHY012' },
        { id: 'PHY014->PHY011-seed', from: 'PHY014', to: 'PHY011' },
        { id: 'PHY012->PHY011-seed', from: 'PHY012', to: 'PHY011' },
        // Peer propagation: Kantarjian context reaches Furman & Byrd directly
        { id: 'PHY015->PHY012-prop-seed', from: 'PHY015', to: 'PHY012', propOnly: true },
        { id: 'PHY014->PHY012-prop-seed', from: 'PHY014', to: 'PHY012', propOnly: true },
      ],
      gateTypes: {
        PHY011: 'OR',  // Byrd unlocked if DiNardo OR Furman visited
      },
      prop: {
        'PHY015->PHY014-seed':      9,  // Kantarjian → DiNardo: top KOL pair
        'PHY015->PHY013-seed':      8,  // Kantarjian → Wierda: KOL to KOL
        'PHY013->PHY012-seed':      7,  // Wierda → Furman
        'PHY014->PHY011-seed':      8,  // DiNardo → Byrd
        'PHY012->PHY011-seed':      6,  // Furman → Byrd
        'PHY015->PHY012-prop-seed': 6,  // Kantarjian → Furman: context propagation
        'PHY014->PHY012-prop-seed': 5,  // DiNardo → Furman: peer context
      },
    },
  },

  // ── ACC002 — Atlantic Hematology Group ───────────────────────────────────
  // Clinical Innovators (House, Grey) → Volume-Driven Pragmatists (Fries, Turk) → Conservative (Cameron)
  {
    accountId: 'ACC002',
    accountName: 'Atlantic Hematology Group',
    flowData: {
      nodePos: {
        PHY006: { x: 80,   y: 160 },  // House    — Oncologist, Clinical Innovator
        PHY009: { x: 80,   y: 400 },  // Grey     — Oncologist, Clinical Innovator
        PHY008: { x: 480,  y: 160 },  // Fries    — Oncologist, Volume-Driven Pragmatist
        PHY010: { x: 480,  y: 400 },  // Turk     — Oncologist, Volume-Driven Pragmatist
        PHY007: { x: 880,  y: 280 },  // Cameron  — Oncologist, Patient-Centric Conservative
      },
      gatePos: {},
      edges: [
        { id: 'PHY006->PHY008-seed', from: 'PHY006', to: 'PHY008' },
        { id: 'PHY009->PHY010-seed', from: 'PHY009', to: 'PHY010' },
        { id: 'PHY008->PHY007-seed', from: 'PHY008', to: 'PHY007' },
        { id: 'PHY010->PHY007-seed', from: 'PHY010', to: 'PHY007' },
        // Peer propagation between innovators, and cross-lane
        { id: 'PHY006->PHY009-prop-seed', from: 'PHY006', to: 'PHY009', propOnly: true },
        { id: 'PHY006->PHY010-prop-seed', from: 'PHY006', to: 'PHY010', propOnly: true },
        { id: 'PHY009->PHY008-prop-seed', from: 'PHY009', to: 'PHY008', propOnly: true },
      ],
      gateTypes: {
        PHY007: 'OR',  // Cameron unlocked if Fries OR Turk visited
      },
      prop: {
        'PHY006->PHY008-seed':      8,  // House → Fries: innovator primes pragmatist
        'PHY009->PHY010-seed':      8,  // Grey → Turk
        'PHY008->PHY007-seed':      7,  // Fries → Cameron: pragmatist validates for conservative
        'PHY010->PHY007-seed':      7,  // Turk → Cameron
        'PHY006->PHY009-prop-seed': 6,  // House → Grey: peer innovators
        'PHY006->PHY010-prop-seed': 5,  // House → Turk: cross-lane context
        'PHY009->PHY008-prop-seed': 5,  // Grey → Fries: cross-lane context
      },
    },
  },

  // ── ACC001 — Midwest Oncology Associates ─────────────────────────────────
  // Thorne (Hematologist, Innovator) → Vance (Oncologist, Innovator) → Koothrappali (Pragmatist) → Belcher (Conservative)
  // Thorne also feeds Jenkins (Hem-Onc, Conservative) via propagation
  {
    accountId: 'ACC001',
    accountName: 'Midwest Oncology Associates',
    flowData: {
      nodePos: {
        PHY002: { x: 80,   y: 300 },  // Thorne        — Hematologist, Clinical Innovator
        PHY001: { x: 460,  y: 150 },  // Vance         — Oncologist, Clinical Innovator
        PHY003: { x: 460,  y: 440 },  // Jenkins       — Hematologist-Oncologist, Patient-Centric Conservative
        PHY004: { x: 840,  y: 150 },  // Koothrappali  — Oncologist, Volume-Driven Pragmatist
        PHY005: { x: 840,  y: 420 },  // Belcher       — Oncologist, Patient-Centric Conservative
      },
      gatePos: {},
      edges: [
        { id: 'PHY002->PHY001-seed', from: 'PHY002', to: 'PHY001' },
        { id: 'PHY001->PHY004-seed', from: 'PHY001', to: 'PHY004' },
        { id: 'PHY004->PHY005-seed', from: 'PHY004', to: 'PHY005' },
        // Jenkins gated on Thorne flow (hematology cred) AND Vance prop (oncology context)
        { id: 'PHY002->PHY003-seed', from: 'PHY002', to: 'PHY003' },
        // Propagation
        { id: 'PHY001->PHY003-prop-seed', from: 'PHY001', to: 'PHY003', propOnly: true },
        { id: 'PHY001->PHY005-prop-seed', from: 'PHY001', to: 'PHY005', propOnly: true },
        { id: 'PHY004->PHY003-prop-seed', from: 'PHY004', to: 'PHY003', propOnly: true },
      ],
      gateTypes: {},
      prop: {
        'PHY002->PHY001-seed':      8,  // Thorne → Vance: hematology primes oncology innovator
        'PHY001->PHY004-seed':      7,  // Vance → Koothrappali: innovator to pragmatist
        'PHY004->PHY005-seed':      7,  // Koothrappali → Belcher: pragmatist validates for conservative
        'PHY002->PHY003-seed':      6,  // Thorne → Jenkins: hematology specialty cred
        'PHY001->PHY003-prop-seed': 6,  // Vance → Jenkins: oncology context
        'PHY001->PHY005-prop-seed': 5,  // Vance → Belcher: indirect innovator context
        'PHY004->PHY003-prop-seed': 5,  // Koothrappali → Jenkins: pragmatist volume context
      },
    },
  },
];

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sf = getSnowflakeClient();
    const results: Array<{ accountId: string; status: string }> = [];

    for (const seed of SEEDS) {
      try {
        await sf.executeQuery(
          `MERGE INTO CORTEX_TESTING.PUBLIC.SYNTHETIC_ACCOUNT_DYNAMIC_DEFAULT AS t
           USING (SELECT :1 AS ACCOUNT_ID) AS s ON t.ACCOUNT_ID = s.ACCOUNT_ID
           WHEN MATCHED THEN
             UPDATE SET FLOW_DATA = PARSE_JSON(:2), SET_BY = :3, SET_AT = CURRENT_TIMESTAMP()
           WHEN NOT MATCHED THEN
             INSERT (ACCOUNT_ID, FLOW_DATA, SET_BY, SET_AT)
             VALUES (:1, PARSE_JSON(:2), :3, CURRENT_TIMESTAMP())`,
          {
            '1': { type: 'TEXT', value: seed.accountId },
            '2': { type: 'TEXT', value: JSON.stringify(seed.flowData) },
            '3': { type: 'TEXT', value: 'seed' },
          }
        );
        results.push({ accountId: seed.accountId, status: 'ok' });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown';
        results.push({ accountId: seed.accountId, status: `error: ${msg}` });
      }
    }

    return NextResponse.json({ seeded: results });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
