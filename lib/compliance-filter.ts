/**
 * compliance-filter.ts
 *
 * Phase 2 Output Compliance Filter.
 *
 * Scans every AI physician persona response against active rules in
 * SYNTHETIC_COMPLIANCE_RULES before it is delivered to the client.
 *
 * Three outcomes:
 *   clean        — response passes all rules; deliver as-is
 *   blocked      — a block-severity rule fired; substitute redirect message
 *   rewrite_needed — a fair_balance rule fired without the required safety
 *                    balance; caller must re-generate with balance injected
 */

export interface ComplianceRule {
  RULE_ID: string;
  RULE_CODE: string;
  RULE_NAME: string;
  RULE_TYPE: string;  // fair_balance | off_label | superlative | ood | pii | injection | safety_minimization
  SEVERITY: string;   // block | warning | info
  DESCRIPTION: string; // JSON with triggers, required_balance, redirect_message, etc.
  ACTIVE: boolean;
}

interface ParsedDesc {
  triggers?: string[];
  trigger_keywords?: string[];
  trigger_patterns?: string[];
  required_balance?: string;
  redirect_message?: string;
  fallback?: string;
  balance_indicators?: string[];
}

export interface ComplianceViolation {
  rule_code: string;
  rule_name: string;
  rule_type: string;
  severity: string;
  action: 'blocked' | 'rewrite_needed' | 'flagged';
  redirect_message?: string;
  required_balance?: string;
  fallback?: string;
}

export type FilterStatus = 'clean' | 'blocked' | 'rewrite_needed' | 'flagged';

export interface FilterResult {
  status: FilterStatus;
  violations: ComplianceViolation[];
  /** First block redirect message, or first rewrite's required balance */
  primaryViolation?: ComplianceViolation;
}

// ── Efficacy claim detection ─────────────────────────────────────────────────
//
// Fair-balance rules should only fire when the physician is making an actual
// clinical efficacy assertion — not when they merely mention the drug name
// in a question, greeting, or neutral bridging statement.
//
// If none of these markers are present the physician isn't claiming anything
// clinical, so there is nothing to balance.
//
const EFFICACY_CLAIM_MARKERS = [
  // Clinical outcome language
  'response rate', 'remission', 'progression-free', 'overall survival',
  'pfs', 'os ', 'hazard ratio', 'hr ', 'median', 'months',
  'cr rate', 'orr', 'mrd', 'minimal residual',
  // Comparative / superiority language
  'superior', 'better than', 'compared to', 'vs ', 'versus',
  'outperform', 'more effective', 'higher rate', 'lower rate',
  'significant', 'statistically',
  // Trial / data language
  'trial', 'study', 'data show', 'data suggest', 'evidence',
  'murano', 'cll14', 'viale', 'glow', 'bellwave', 'captivate',
  // Benefit language
  'benefit', 'efficac', 'effective', 'works well', 'good result',
  'positive result', 'demonstrated', 'shown to',
  // Fixed-duration / convenience claims
  'fixed duration', 'time-limited', 'no continuous', 'stop therapy',
  'finite treatment', 'treatment-free',
  // Combination regimen claims
  'obinutuzumab', 'rituximab', 'azacitidine', 'g-ven', 'r-ven',
];

function hasEfficacyClaim(lowerText: string): boolean {
  return EFFICACY_CLAIM_MARKERS.some(m => lowerText.includes(m));
}

// ── Balance presence detection ───────────────────────────────────────────────
//
// For each fair_balance rule, we define short key phrases that confirm the
// safety balance is actually present in the AI response.  We require at least
// MIN_BALANCE_HITS of these to consider the balance "included".
//
const MIN_BALANCE_HITS = 2;

const BALANCE_INDICATORS: Record<string, string[]> = {
  FAIR_BALANCE_CLL_EFFICACY:  ['tls', 'tumor lysis', 'boxed warning', 'neutropenia', 'ramp-up', 'ramp up', 'dose ramp'],
  FAIR_BALANCE_TLS_RAMPUP:    ['contraindicated', 'cyp3a', 'monitoring', 'blood chemistry'],
  FAIR_BALANCE_FIXED_DURATION:['monitoring', 'neutropenia', 'blood count', 'blood test'],
  FAIR_BALANCE_VEN_G_COMBO:   ['hbv', 'hepatitis b', 'pml', 'infusion-related', 'screen'],
  FAIR_BALANCE_VEN_R_COMBO:   ['fatal infusion', 'infusion-related', 'hbv', 'pml', 'mucocutaneous'],
  FAIR_BALANCE_VEN_ACA_COMBO: ['neutropenia', 'tls', 'headache', 'tumor lysis'],
  FAIR_BALANCE_CV_COMPARISON: ['tls', 'boxed warning', 'tumor lysis', 'warnings and precautions', 'section 5'],
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseDesc(raw: string): ParsedDesc {
  try { return JSON.parse(raw) as ParsedDesc; }
  catch { return {}; }
}

function getTriggers(desc: ParsedDesc): string[] {
  return desc.triggers ?? desc.trigger_keywords ?? desc.trigger_patterns ?? [];
}

function hasTrigger(lowerText: string, triggers: string[]): boolean {
  return triggers.some(t => lowerText.includes(t.toLowerCase()));
}

function hasBalancePresent(lowerText: string, ruleCode: string): boolean {
  const indicators = BALANCE_INDICATORS[ruleCode] ?? [];
  if (indicators.length === 0) return false;
  const hits = indicators.filter(ind => lowerText.includes(ind.toLowerCase())).length;
  return hits >= Math.min(MIN_BALANCE_HITS, indicators.length);
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Run all active compliance rules against a persona response.
 *
 * Processing order:
 *  1. Block rules fire immediately and short-circuit (first match wins).
 *  2. Fair-balance rules accumulate — all violations are returned so the
 *     caller can inject ALL required balance statements in one re-generation.
 *  3. Warning/info rules are logged but don't alter the response.
 */
export function checkOutput(
  text: string,
  rules: ComplianceRule[],
): FilterResult {
  const lowerText = text.toLowerCase();
  const violations: ComplianceViolation[] = [];

  for (const rule of rules) {
    if (!rule.ACTIVE) continue;

    const desc = parseDesc(rule.DESCRIPTION);
    const triggers = getTriggers(desc);
    if (triggers.length === 0) continue;

    if (!hasTrigger(lowerText, triggers)) continue;

    // ── BLOCK ──────────────────────────────────────────────────────────────
    if (rule.SEVERITY === 'block' && rule.RULE_TYPE !== 'fair_balance') {
      const v: ComplianceViolation = {
        rule_code:     rule.RULE_CODE,
        rule_name:     rule.RULE_NAME,
        rule_type:     rule.RULE_TYPE,
        severity:      rule.SEVERITY,
        action:        'blocked',
        redirect_message: desc.redirect_message ??
          "I'm not able to discuss that topic in this training session. Let's refocus on the approved clinical discussion.",
      };
      // Return immediately — first block wins
      return { status: 'blocked', violations: [v], primaryViolation: v };
    }

    // ── FAIR BALANCE ───────────────────────────────────────────────────────
    if (rule.RULE_TYPE === 'fair_balance') {
      // Only require balance when the physician is making an actual efficacy
      // assertion. A response that merely mentions the drug name in a question
      // or bridging statement ("What did you want to discuss about Venclexta?")
      // is not a promotional claim and must not trigger a rewrite.
      if (!hasEfficacyClaim(lowerText)) continue;
      if (!hasBalancePresent(lowerText, rule.RULE_CODE)) {
        violations.push({
          rule_code:      rule.RULE_CODE,
          rule_name:      rule.RULE_NAME,
          rule_type:      rule.RULE_TYPE,
          severity:       rule.SEVERITY,
          action:         'rewrite_needed',
          required_balance: desc.required_balance,
          fallback:        desc.fallback ??
            "I would recommend reviewing the full VENCLEXTA Prescribing Information for the complete benefit-risk profile, including the Boxed Warning for Tumor Lysis Syndrome.",
        });
      }
      continue; // don't fall through to warning/info
    }

    // ── WARNING / INFO ────────────────────────────────────────────────────
    violations.push({
      rule_code: rule.RULE_CODE,
      rule_name: rule.RULE_NAME,
      rule_type: rule.RULE_TYPE,
      severity:  rule.SEVERITY,
      action:    'flagged',
      redirect_message: desc.redirect_message,
    });
  }

  const hasRewrite  = violations.some(v => v.action === 'rewrite_needed');
  const hasFlagged  = violations.some(v => v.action === 'flagged');

  const status: FilterStatus = hasRewrite ? 'rewrite_needed'
               : hasFlagged  ? 'flagged'
               : 'clean';

  return {
    status,
    violations,
    primaryViolation: violations[0],
  };
}

// ── Input firewall (Phase 3) ──────────────────────────────────────────────────
//
// Rules that apply to REP INPUTS.  Fair-balance rules are output-only
// (the physician makes efficacy claims, not the rep scanning trigger).
// Everything else — off-label, superlative, ODD, PHI, injection,
// safety_minimization — applies to what the rep types.
//
const INPUT_RULE_TYPES = new Set([
  'off_label',
  'superlative',
  'ood',
  'pii',
  'injection',
  'safety_minimization',
  'competitor_disparagement',
]);

/**
 * Scan a sales rep's input text against active compliance rules.
 * Returns immediately on the first BLOCK-severity match.
 * Warning/info violations are accumulated without blocking.
 */
export function checkInput(
  text: string,
  rules: ComplianceRule[],
): FilterResult {
  const lowerText = text.toLowerCase();
  const violations: ComplianceViolation[] = [];

  for (const rule of rules) {
    if (!rule.ACTIVE) continue;
    if (!INPUT_RULE_TYPES.has(rule.RULE_TYPE)) continue;

    const desc = parseDesc(rule.DESCRIPTION);
    const triggers = getTriggers(desc);
    if (triggers.length === 0) continue;

    if (!hasTrigger(lowerText, triggers)) continue;

    if (rule.SEVERITY === 'block') {
      const v: ComplianceViolation = {
        rule_code:    rule.RULE_CODE,
        rule_name:    rule.RULE_NAME,
        rule_type:    rule.RULE_TYPE,
        severity:     rule.SEVERITY,
        action:       'blocked',
        redirect_message: desc.redirect_message ??
          "That topic is outside the scope of this training session. Please focus on approved CLL/SLL clinical topics.",
      };
      return { status: 'blocked', violations: [v], primaryViolation: v };
    }

    violations.push({
      rule_code: rule.RULE_CODE,
      rule_name: rule.RULE_NAME,
      rule_type: rule.RULE_TYPE,
      severity:  rule.SEVERITY,
      action:    'flagged',
      redirect_message: desc.redirect_message,
    });
  }

  const hasFlagged = violations.some(v => v.action === 'flagged');
  return {
    status: hasFlagged ? 'flagged' : 'clean',
    violations,
    primaryViolation: violations[0],
  };
}

/**
 * Build a compliance-injection system prompt suffix.
 * Appended to the original system prompt for re-generation calls so the
 * model is forced to include the missing safety balance statements.
 */
export function buildBalanceInjection(violations: ComplianceViolation[]): string {
  const rewriteViolations = violations.filter(v => v.action === 'rewrite_needed');
  if (rewriteViolations.length === 0) return '';

  const balanceItems = rewriteViolations
    .filter(v => v.required_balance)
    .map((v, i) => `${i + 1}. ${v.required_balance}`)
    .join('\n');

  return `

COMPLIANCE REQUIREMENT — MANDATORY SAFETY BALANCE:
Your response MUST include the following safety information. This is required by FDA promotional regulations (21 CFR Part 202) and cannot be omitted:
${balanceItems}

Keep your total response to 2-3 sentences. Begin with the emotion tag. Include the required safety information naturally within your response.`;
}
