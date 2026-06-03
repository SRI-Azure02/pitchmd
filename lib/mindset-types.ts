/**
 * Shared HCP Mindset type definitions and dimension constants.
 * Imported by both the component (chat-interface.tsx) and the server
 * lib (mindset-descriptions.ts) to avoid circular dependencies.
 */

export const PRESET_MINDSETS = [
  'Data Hawk',
  'Skeptical Traditionalist',
  'Friendly Derailer',
  'Bureaucratic Defensive',
  'Cost-Conscious Pragmatist',
] as const;
export type PresetMindset = typeof PRESET_MINDSETS[number];

export interface MindsetDimension {
  id: string;
  category: string;
  name: string;
  leftLabel: string;
  rightLabel: string;
  leftDesc: string;
  rightDesc: string;
}

export interface CustomMindset {
  name: string;
  dimensions: Record<string, 'left' | 'right'>;
}

export const MINDSET_DIMENSIONS: MindsetDimension[] = [
  { id: 'evidence',  category: 'Clinical Disposition',                 name: 'Evidence Orientation',       leftLabel: 'Data-Driven',              rightLabel: 'Experiential',              leftDesc: 'Demands specific clinical trials, p-values, endpoints, and head-to-head data. Punishes marketing buzzwords.',             rightDesc: 'Relies on personal clinical success, peer opinions, and high-level guideline recommendations.' },
  { id: 'adoption',  category: 'Clinical Disposition',                 name: 'Adoption Profile',            leftLabel: 'Innovator / Early Adopter', rightLabel: 'Late Majority / Laggard',    leftDesc: 'Eager to try new mechanisms of action; willing to tolerate early operational friction for superior efficacy.',            rightDesc: 'Deeply entrenched in current protocols; heavily relies on old, proven generics or established blockbusters.' },
  { id: 'risk',      category: 'Clinical Disposition',                 name: 'Risk Tolerance',              leftLabel: 'Conservative (Low)',        rightLabel: 'Aggressive (High)',          leftDesc: 'Fixates on safety, adverse events, black-box warnings, and drug-to-drug interactions.',                                   rightDesc: 'Prioritizes absolute efficacy, speed of onset, or disease clearance; accepts standard class-effect risks.' },
  { id: 'skeptic',   category: 'Interaction & Communication',          name: 'Skepticism',                  leftLabel: 'High (Combative)',          rightLabel: 'Low (Passive)',              leftDesc: 'Actively interrupts, challenges data validity, brings up competitor advantages, and pushes back on claims.',              rightDesc: 'Polite, nods along, but hard to pin down for a concrete behavioral commitment or script change.' },
  { id: 'verbose',   category: 'Interaction & Communication',          name: 'Verbosity',                   leftLabel: 'Succinct (Low)',            rightLabel: 'Expressive (High)',          leftDesc: 'Gives 1-to-5 word answers. Forces the rep to ask tight, targeted questions or face awkward silence.',                    rightDesc: 'Tells long stories about specific patients, easily derails the timeline, requires the rep to aggressively control the room.' },
  { id: 'formulary', category: 'Institutional & Systemic Constraints', name: 'Formulary Status Awareness',  leftLabel: 'Restricted',                rightLabel: 'Flexible',                  leftDesc: 'Bound tightly by hospital or regional insurance tiering; refuses scripts that require heavy Prior Authorization paperwork.', rightDesc: 'Willing to navigate PA processes, call medical directors, or utilize co-pay cards if the clinical benefit justifies it.' },
  { id: 'patients',  category: 'Institutional & Systemic Constraints', name: 'Patient Demographic Split',   leftLabel: 'Fixed Income / Medicare',   rightLabel: 'Commercial / Premium',       leftDesc: 'Highly sensitive to out-of-pocket patient costs, tier-3 copays, and coverage gaps.',                                      rightDesc: 'Has patients with robust private insurance or employer-backed plans where specialty drug access is smoother.' },
];
