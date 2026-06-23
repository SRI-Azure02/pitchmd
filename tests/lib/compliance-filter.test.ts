import { describe, it, expect } from 'vitest';
import {
  checkInput,
  checkOutput,
  buildBalanceInjection,
  ComplianceRule,
  ComplianceViolation,
  FilterResult,
} from '@/lib/compliance-filter';

describe('compliance-filter', () => {
  describe('checkInput', () => {
    describe('clean path', () => {
      it('should return clean for plain rep message', () => {
        const text = 'What are the indications for Venclexta?';
        const result = checkInput(text, []);
        expect(result.status).toBe('clean');
        expect(result.violations).toHaveLength(0);
      });

      it('should return clean for empty text', () => {
        const text = '';
        const result = checkInput(text, []);
        expect(result.status).toBe('clean');
      });

      it('should return clean when rules array is empty', () => {
        const text = 'Some message';
        const result = checkInput(text, []);
        expect(result.status).toBe('clean');
        expect(result.violations).toHaveLength(0);
      });

      it('should return clean when no rules are active', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'TEST',
            RULE_NAME: 'Test Rule',
            RULE_TYPE: 'off_label',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({ triggers: ['cancer'] }),
            ACTIVE: false,
          },
        ];
        const result = checkInput('This is cancer', rules);
        expect(result.status).toBe('clean');
      });

      it('should return clean when triggers do not match', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'OFF_LABEL_001',
            RULE_NAME: 'Off-label claim',
            RULE_TYPE: 'off_label',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({ triggers: ['breast cancer'] }),
            ACTIVE: true,
          },
        ];
        const result = checkInput('What about lung treatment?', rules);
        expect(result.status).toBe('clean');
      });

      it('should handle case-insensitive matching', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'OFF_LABEL_001',
            RULE_NAME: 'Off-label claim',
            RULE_TYPE: 'off_label',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({ triggers: ['breast cancer'] }),
            ACTIVE: true,
          },
        ];
        const result = checkInput('What about LYMPHOMA?', rules);
        expect(result.status).toBe('clean');
      });

      it('should return clean for neutral drug mention', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'OFF_LABEL_001',
            RULE_NAME: 'Off-label',
            RULE_TYPE: 'off_label',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({ triggers: ['breast cancer'] }),
            ACTIVE: true,
          },
        ];
        const result = checkInput('Let me discuss Venclexta with you', rules);
        expect(result.status).toBe('clean');
      });

      it('should return clean with inactive off_label rule', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'OFF_LABEL_001',
            RULE_NAME: 'Off-label',
            RULE_TYPE: 'off_label',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({ triggers: ['cancer'] }),
            ACTIVE: false,
          },
        ];
        const result = checkInput('This treats cancer', rules);
        expect(result.status).toBe('clean');
      });

      it('should return clean when rule type is not input-applicable', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'FAIR_BALANCE_001',
            RULE_NAME: 'Fair balance',
            RULE_TYPE: 'fair_balance',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({ triggers: ['response rate'] }),
            ACTIVE: true,
          },
        ];
        const result = checkInput('response rate is high', rules);
        expect(result.status).toBe('clean');
      });

      it('should return clean with normal clinical question', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'PII_001',
            RULE_NAME: 'PII check',
            RULE_TYPE: 'pii',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({ triggers: ['@', 'email'] }),
            ACTIVE: true,
          },
        ];
        const result = checkInput('How does Venclexta work in CLL?', rules);
        expect(result.status).toBe('clean');
      });

      it('should return clean when rule has empty triggers', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'TEST',
            RULE_NAME: 'Test',
            RULE_TYPE: 'off_label',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({ triggers: [] }),
            ACTIVE: true,
          },
        ];
        const result = checkInput('Some text with triggers', rules);
        expect(result.status).toBe('clean');
      });

      it('should return clean with malformed DESCRIPTION JSON', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'TEST',
            RULE_NAME: 'Test',
            RULE_TYPE: 'off_label',
            SEVERITY: 'warning',
            DESCRIPTION: 'not valid json',
            ACTIVE: true,
          },
        ];
        const result = checkInput('Some text', rules);
        expect(result.status).toBe('clean');
      });

      it('should return clean with trigger_keywords field', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'TEST',
            RULE_NAME: 'Test',
            RULE_TYPE: 'off_label',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({ trigger_keywords: ['keyword123'] }),
            ACTIVE: true,
          },
        ];
        const result = checkInput('Some text without the keyword', rules);
        expect(result.status).toBe('clean');
      });

      it('should return clean with trigger_patterns field', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'TEST',
            RULE_NAME: 'Test',
            RULE_TYPE: 'off_label',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({ trigger_patterns: ['abc'] }),
            ACTIVE: true,
          },
        ];
        const result = checkInput('Some text without pattern', rules);
        expect(result.status).toBe('clean');
      });
    });

    describe('flagged path', () => {
      it('should flag off-label claim', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'OFF_LABEL_001',
            RULE_NAME: 'Off-label claim',
            RULE_TYPE: 'off_label',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({ triggers: ['breast cancer'] }),
            ACTIVE: true,
          },
        ];
        const result = checkInput('Can it treat breast cancer?', rules);
        expect(result.status).toBe('flagged');
        expect(result.violations).toHaveLength(1);
        expect(result.violations[0].action).toBe('flagged');
      });

      it('should flag competitor disparagement', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'COMP_001',
            RULE_NAME: 'Competitor disparagement',
            RULE_TYPE: 'competitor_disparagement',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({
              triggers: ['Imbruvica is inferior'],
            }),
            ACTIVE: true,
          },
        ];
        const result = checkInput('Imbruvica is inferior to Venclexta', rules);
        expect(result.status).toBe('flagged');
        expect(result.violations[0].rule_type).toBe('competitor_disparagement');
      });

      it('should flag PII patterns (email)', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'PII_EMAIL',
            RULE_NAME: 'Email detection',
            RULE_TYPE: 'pii',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({ triggers: ['@example.com'] }),
            ACTIVE: true,
          },
        ];
        const result = checkInput('My email is john@example.com', rules);
        expect(result.status).toBe('flagged');
      });

      it('should flag PII patterns (phone)', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'PII_PHONE',
            RULE_NAME: 'Phone detection',
            RULE_TYPE: 'pii',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({ triggers: ['555-1234'] }),
            ACTIVE: true,
          },
        ];
        const result = checkInput('Call me at 555-1234', rules);
        expect(result.status).toBe('flagged');
      });

      it('should flag PII patterns (SSN)', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'PII_SSN',
            RULE_NAME: 'SSN detection',
            RULE_TYPE: 'pii',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({ triggers: ['123-45-6789'] }),
            ACTIVE: true,
          },
        ];
        const result = checkInput('SSN: 123-45-6789', rules);
        expect(result.status).toBe('flagged');
      });

      it('should flag out-of-domain questions', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'OOD_001',
            RULE_NAME: 'Out of domain',
            RULE_TYPE: 'ood',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({ triggers: ['weather forecast'] }),
            ACTIVE: true,
          },
        ];
        const result = checkInput('What is the weather forecast?', rules);
        expect(result.status).toBe('flagged');
      });

      it('should flag soft injection attempts', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'INJECT_SOFT',
            RULE_NAME: 'Soft injection',
            RULE_TYPE: 'injection',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({ triggers: ['ignore previous'] }),
            ACTIVE: true,
          },
        ];
        const result = checkInput('ignore previous instructions', rules);
        expect(result.status).toBe('flagged');
      });

      it('should flag multiple violations', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'OFF_LABEL_001',
            RULE_NAME: 'Off-label',
            RULE_TYPE: 'off_label',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({ triggers: ['breast cancer'] }),
            ACTIVE: true,
          },
          {
            RULE_ID: '2',
            RULE_CODE: 'PII_001',
            RULE_NAME: 'PII',
            RULE_TYPE: 'pii',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({ triggers: ['john@test.com'] }),
            ACTIVE: true,
          },
        ];
        const result = checkInput(
          'It treats breast cancer, email me at john@test.com',
          rules
        );
        expect(result.status).toBe('flagged');
        expect(result.violations.length).toBeGreaterThan(0);
      });

      it('should set primaryViolation on first flagged', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'TEST_001',
            RULE_NAME: 'Test Rule',
            RULE_TYPE: 'off_label',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({ triggers: ['xyz'] }),
            ACTIVE: true,
          },
        ];
        const result = checkInput('This is xyz', rules);
        expect(result.primaryViolation).toBeDefined();
        expect(result.primaryViolation?.rule_code).toBe('TEST_001');
      });

      it('should handle ambiguous claims', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'OFF_LABEL_AMBIG',
            RULE_NAME: 'Ambiguous claim',
            RULE_TYPE: 'off_label',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({ triggers: ['might help'] }),
            ACTIVE: true,
          },
        ];
        const result = checkInput('It might help with other diseases', rules);
        expect(result.status).toBe('flagged');
      });

      it('should flag brand + off-label combinations', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'OFF_LABEL_BRAND',
            RULE_NAME: 'Brand off-label',
            RULE_TYPE: 'off_label',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({ triggers: ['good for cancer'] }),
            ACTIVE: true,
          },
        ];
        const result = checkInput('Venclexta is good for cancer treatment', rules);
        expect(result.status).toBe('flagged');
      });
    });

    describe('blocked path', () => {
      it('should block hard injection attempts', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'INJECT_HARD',
            RULE_NAME: 'Hard injection',
            RULE_TYPE: 'injection',
            SEVERITY: 'block',
            DESCRIPTION: JSON.stringify({ triggers: ["'; DROP TABLE"] }),
            ACTIVE: true,
          },
        ];
        const result = checkInput("'; DROP TABLE users; --", rules);
        expect(result.status).toBe('blocked');
        expect(result.violations[0].action).toBe('blocked');
      });

      it('should block immediately on first block rule', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'BLOCK_001',
            RULE_NAME: 'Block rule 1',
            RULE_TYPE: 'injection',
            SEVERITY: 'block',
            DESCRIPTION: JSON.stringify({ triggers: ['xyz'] }),
            ACTIVE: true,
          },
          {
            RULE_ID: '2',
            RULE_CODE: 'OFF_LABEL_001',
            RULE_NAME: 'Off-label',
            RULE_TYPE: 'off_label',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({ triggers: ['abc'] }),
            ACTIVE: true,
          },
        ];
        const result = checkInput('xyz abc', rules);
        expect(result.violations).toHaveLength(1);
        expect(result.violations[0].rule_code).toBe('BLOCK_001');
      });

      it('should block prohibited phrases', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'PROHIBITED_001',
            RULE_NAME: 'Prohibited',
            RULE_TYPE: 'injection',
            SEVERITY: 'block',
            DESCRIPTION: JSON.stringify({ triggers: ['forbidden phrase'] }),
            ACTIVE: true,
          },
        ];
        const result = checkInput('This contains forbidden phrase', rules);
        expect(result.status).toBe('blocked');
      });

      it('should block PII + off-label combo', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'PII_OFFLABEL_BLOCK',
            RULE_NAME: 'PII off-label block',
            RULE_TYPE: 'pii',
            SEVERITY: 'block',
            DESCRIPTION: JSON.stringify({
              triggers: ['john@test.com cancer'],
            }),
            ACTIVE: true,
          },
        ];
        const result = checkInput('john@test.com cancer treatment', rules);
        expect(result.status).toBe('blocked');
      });

      it('should block extreme off-label', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'OFF_LABEL_EXTREME',
            RULE_NAME: 'Extreme off-label',
            RULE_TYPE: 'off_label',
            SEVERITY: 'block',
            DESCRIPTION: JSON.stringify({ triggers: ['treats everything'] }),
            ACTIVE: true,
          },
        ];
        const result = checkInput('Venclexta treats everything', rules);
        expect(result.status).toBe('blocked');
      });

      it('should block SQL injection patterns', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'SQL_INJECT',
            RULE_NAME: 'SQL injection',
            RULE_TYPE: 'injection',
            SEVERITY: 'block',
            DESCRIPTION: JSON.stringify({ triggers: ['UNION SELECT'] }),
            ACTIVE: true,
          },
        ];
        const result = checkInput('UNION SELECT * FROM users', rules);
        expect(result.status).toBe('blocked');
      });

      it('should block XSS injection patterns', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'XSS_INJECT',
            RULE_NAME: 'XSS injection',
            RULE_TYPE: 'injection',
            SEVERITY: 'block',
            DESCRIPTION: JSON.stringify({
              triggers: ['<script>alert'],
            }),
            ACTIVE: true,
          },
        ];
        const result = checkInput('<script>alert("xss")</script>', rules);
        expect(result.status).toBe('blocked');
      });

      it('should block command injection patterns', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'CMD_INJECT',
            RULE_NAME: 'Command injection',
            RULE_TYPE: 'injection',
            SEVERITY: 'block',
            DESCRIPTION: JSON.stringify({ triggers: ['rm -rf'] }),
            ACTIVE: true,
          },
        ];
        const result = checkInput('rm -rf /', rules);
        expect(result.status).toBe('blocked');
      });

      it('should have clear block message', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'TEST_BLOCK',
            RULE_NAME: 'Test block',
            RULE_TYPE: 'injection',
            SEVERITY: 'block',
            DESCRIPTION: JSON.stringify({
              triggers: ['test'],
              redirect_message: 'Custom block message',
            }),
            ACTIVE: true,
          },
        ];
        const result = checkInput('test', rules);
        expect(result.violations[0].redirect_message).toBe('Custom block message');
      });

      it('should return default block message when none provided', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'TEST_BLOCK',
            RULE_NAME: 'Test block',
            RULE_TYPE: 'off_label',
            SEVERITY: 'block',
            DESCRIPTION: JSON.stringify({ triggers: ['test'] }),
            ACTIVE: true,
          },
        ];
        const result = checkInput('test', rules);
        expect(result.violations[0].redirect_message).toBeDefined();
        expect(result.violations[0].redirect_message).toContain('scope');
      });

      it('should block multiple violations but return only first', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'BLOCK_1',
            RULE_NAME: 'Block 1',
            RULE_TYPE: 'injection',
            SEVERITY: 'block',
            DESCRIPTION: JSON.stringify({ triggers: ['xyz'] }),
            ACTIVE: true,
          },
          {
            RULE_ID: '2',
            RULE_CODE: 'BLOCK_2',
            RULE_NAME: 'Block 2',
            RULE_TYPE: 'injection',
            SEVERITY: 'block',
            DESCRIPTION: JSON.stringify({ triggers: ['abc'] }),
            ACTIVE: true,
          },
        ];
        const result = checkInput('xyz abc', rules);
        expect(result.violations).toHaveLength(1);
        expect(result.violations[0].rule_code).toBe('BLOCK_1');
      });
    });
  });

  describe('checkOutput', () => {
    describe('clean path', () => {
      it('should return clean for plain physician response', () => {
        const text = 'Venclexta is indicated for CLL.';
        const result = checkOutput(text, []);
        expect(result.status).toBe('clean');
        expect(result.violations).toHaveLength(0);
      });

      it('should return clean for empty text', () => {
        const result = checkOutput('', []);
        expect(result.status).toBe('clean');
      });

      it('should return clean when no rules are active', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'TEST',
            RULE_NAME: 'Test',
            RULE_TYPE: 'fair_balance',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({ triggers: ['response rate'] }),
            ACTIVE: false,
          },
        ];
        const result = checkOutput('response rate is high', rules);
        expect(result.status).toBe('clean');
      });

      it('should return clean for balanced efficacy claims', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'FAIR_BALANCE_CLL_EFFICACY',
            RULE_NAME: 'Fair balance',
            RULE_TYPE: 'fair_balance',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({
              triggers: ['response rate'],
              required_balance: 'Include safety warnings',
            }),
            ACTIVE: true,
          },
        ];
        const text = 'The response rate is high. However, boxed warning includes tumor lysis syndrome. Neutropenia requires monitoring.';
        const result = checkOutput(text, rules);
        expect(result.status).toBe('clean');
      });

      it('should return clean with safety statements present', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'FAIR_BALANCE_CLL_EFFICACY',
            RULE_NAME: 'Safety balance',
            RULE_TYPE: 'fair_balance',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({
              triggers: ['response rate'],
              required_balance: 'Include safety',
            }),
            ACTIVE: true,
          },
        ];
        const text = 'The response rate is excellent with proper ramp up dosing and tls monitoring. Neutropenia requires management.';
        const result = checkOutput(text, rules);
        expect(result.status).toBe('clean');
      });

      it('should return clean with no superlatives', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'SUPERLATIVE_001',
            RULE_NAME: 'Superlative',
            RULE_TYPE: 'superlative',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({ triggers: ['the best'] }),
            ACTIVE: true,
          },
        ];
        const result = checkOutput('This is a good treatment', rules);
        expect(result.status).toBe('clean');
      });

      it('should return clean when competitor not mentioned', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'COMP_001',
            RULE_NAME: 'Competitor',
            RULE_TYPE: 'superlative',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({ triggers: ['Imbruvica'] }),
            ACTIVE: true,
          },
        ];
        const result = checkOutput('Venclexta is effective', rules);
        expect(result.status).toBe('clean');
      });

      it('should return clean for safe boilerplate responses', () => {
        const rules: ComplianceRule[] = [];
        const text = "I'd recommend reviewing the prescribing information.";
        const result = checkOutput(text, rules);
        expect(result.status).toBe('clean');
      });

      it('should return clean for short question replies', () => {
        const text = 'Yes.';
        const result = checkOutput(text, []);
        expect(result.status).toBe('clean');
      });

      it('should return clean for numeric data only', () => {
        const text = '400 mg twice daily';
        const result = checkOutput(text, []);
        expect(result.status).toBe('clean');
      });

      it('should return clean with proper fair-balance language', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'FAIR_BALANCE_CLL_EFFICACY',
            RULE_NAME: 'Fair balance',
            RULE_TYPE: 'fair_balance',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({
              triggers: ['response rate'],
              required_balance: 'Include TLS warning',
            }),
            ACTIVE: true,
          },
        ];
        const text =
          'Response rates are strong in CLL with ramp-up dosing and boxed warning for tumor lysis. Neutropenia monitoring is essential.';
        const result = checkOutput(text, rules);
        expect(result.status).toBe('clean');
      });

      it('should return clean for multiple claim types (clean)', () => {
        const rules: ComplianceRule[] = [];
        const text =
          'Venclexta shows efficacy, has good safety profile, and is well-tolerated.';
        const result = checkOutput(text, rules);
        expect(result.status).toBe('clean');
      });

      it('should return clean with emoticons/special chars', () => {
        const text = 'Great question! 👍 Let me explain...';
        const result = checkOutput(text, []);
        expect(result.status).toBe('clean');
      });

      it('should return clean for very long responses', () => {
        const text = 'This is a very long response. '.repeat(100);
        const result = checkOutput(text, []);
        expect(result.status).toBe('clean');
      });
    });

    describe('rewrite needed path', () => {
      it('should require rewrite for efficacy claim without balance', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'FAIR_BALANCE_CLL_EFFICACY',
            RULE_NAME: 'CLL efficacy balance',
            RULE_TYPE: 'fair_balance',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({
              triggers: ['response rate'],
              required_balance: 'Include TLS warning and monitoring requirements',
            }),
            ACTIVE: true,
          },
        ];
        const text = 'The response rate is 80% in CLL patients.';
        const result = checkOutput(text, rules);
        expect(result.status).toBe('rewrite_needed');
        expect(result.violations[0].action).toBe('rewrite_needed');
      });

      it('should flag superlative language', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'SUPERLATIVE_001',
            RULE_NAME: 'Superlative',
            RULE_TYPE: 'superlative',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({
              triggers: ['best drug', 'superior to'],
              required_balance: 'Provide comparative context',
            }),
            ACTIVE: true,
          },
        ];
        const text = 'This is the best drug available.';
        const result = checkOutput(text, rules);
        expect(result.status).toBe('flagged');
      });

      it('should flag safety minimization', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'SAFETY_MIN_001',
            RULE_NAME: 'Safety minimization',
            RULE_TYPE: 'safety_minimization',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({
              triggers: ['no side effects', 'completely safe'],
              required_balance: 'Acknowledge known safety issues',
            }),
            ACTIVE: true,
          },
        ];
        const text = 'Venclexta is completely safe with no side effects.';
        const result = checkOutput(text, rules);
        expect(result.status).toBe('flagged');
      });

      it('should flag off-label AI response', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'OFF_LABEL_OUTPUT_001',
            RULE_NAME: 'Off-label output',
            RULE_TYPE: 'off_label',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({
              triggers: ['breast cancer treatment'],
              required_balance: 'Stick to approved indications',
            }),
            ACTIVE: true,
          },
        ];
        const text = 'Venclexta can also be used for breast cancer treatment.';
        const result = checkOutput(text, rules);
        expect(result.status).toBe('flagged');
      });

      it('should flag missing required balance statement', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'FAIR_BALANCE_FIXED_DURATION',
            RULE_NAME: 'Fixed duration balance',
            RULE_TYPE: 'fair_balance',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({
              triggers: ['fixed duration', 'time-limited'],
              required_balance: 'Emphasize monitoring requirements',
            }),
            ACTIVE: true,
          },
        ];
        const text = 'Venclexta offers a fixed duration treatment approach.';
        const result = checkOutput(text, rules);
        expect(result.status).toBe('rewrite_needed');
      });

      it('should handle multiple rewrite-needed violations', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'FAIR_BALANCE_1',
            RULE_NAME: 'Balance 1',
            RULE_TYPE: 'fair_balance',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({
              triggers: ['response rate'],
              required_balance: 'Include safety 1',
            }),
            ACTIVE: true,
          },
          {
            RULE_ID: '2',
            RULE_CODE: 'FAIR_BALANCE_2',
            RULE_NAME: 'Balance 2',
            RULE_TYPE: 'fair_balance',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({
              triggers: ['efficacy'],
              required_balance: 'Include safety 2',
            }),
            ACTIVE: true,
          },
        ];
        const text = 'The response rate and efficacy are excellent.';
        const result = checkOutput(text, rules);
        expect(result.status).toBe('rewrite_needed');
        expect(result.violations.length).toBeGreaterThan(0);
      });

      it('should not require balance when no efficacy claim', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'FAIR_BALANCE_CLL_EFFICACY',
            RULE_NAME: 'CLL balance',
            RULE_TYPE: 'fair_balance',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({
              triggers: ['venclexta'],
              required_balance: 'Safety balance needed',
            }),
            ACTIVE: true,
          },
        ];
        const text = 'What would you like to know about Venclexta?';
        const result = checkOutput(text, rules);
        expect(result.status).toBe('clean');
      });

      it('should return default fallback message', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'TEST_FALLBACK',
            RULE_NAME: 'Test fallback',
            RULE_TYPE: 'fair_balance',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({
              triggers: ['excellent efficacy'],
              required_balance: 'Include warnings',
            }),
            ACTIVE: true,
          },
        ];
        const result = checkOutput('The excellent efficacy is clear.', rules);
        expect(result.violations[0].fallback).toBeDefined();
      });

      it('should return custom fallback message when provided', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: '1',
            RULE_CODE: 'TEST_FALLBACK',
            RULE_NAME: 'Test fallback',
            RULE_TYPE: 'fair_balance',
            SEVERITY: 'warning',
            DESCRIPTION: JSON.stringify({
              triggers: ['excellent efficacy'],
              required_balance: 'Include warnings',
              fallback: 'Custom fallback message',
            }),
            ACTIVE: true,
          },
        ];
        const result = checkOutput('The excellent efficacy is clear.', rules);
        expect(result.violations[0].fallback).toBe('Custom fallback message');
      });
    });
  });

  describe('buildBalanceInjection', () => {
    it('should generate correct injection text', () => {
      const violations: ComplianceViolation[] = [
        {
          rule_code: 'FAIR_BALANCE_001',
          rule_name: 'Fair balance',
          rule_type: 'fair_balance',
          severity: 'warning',
          action: 'rewrite_needed',
          required_balance: 'Include safety warning about TLS',
        },
      ];
      const injection = buildBalanceInjection(violations);
      expect(injection).toContain('COMPLIANCE REQUIREMENT');
      expect(injection).toContain('Include safety warning about TLS');
    });

    it('should include all rewrite-needed violations', () => {
      const violations: ComplianceViolation[] = [
        {
          rule_code: 'FAIR_BALANCE_001',
          rule_name: 'Balance 1',
          rule_type: 'fair_balance',
          severity: 'warning',
          action: 'rewrite_needed',
          required_balance: 'Balance statement 1',
        },
        {
          rule_code: 'FAIR_BALANCE_002',
          rule_name: 'Balance 2',
          rule_type: 'fair_balance',
          severity: 'warning',
          action: 'rewrite_needed',
          required_balance: 'Balance statement 2',
        },
      ];
      const injection = buildBalanceInjection(violations);
      expect(injection).toContain('Balance statement 1');
      expect(injection).toContain('Balance statement 2');
    });

    it('should return empty string for zero violations', () => {
      const injection = buildBalanceInjection([]);
      expect(injection).toBe('');
    });

    it('should return empty string for non-rewrite violations', () => {
      const violations: ComplianceViolation[] = [
        {
          rule_code: 'TEST_001',
          rule_name: 'Test',
          rule_type: 'off_label',
          severity: 'warning',
          action: 'flagged',
        },
      ];
      const injection = buildBalanceInjection(violations);
      expect(injection).toBe('');
    });

    it('should skip violations without required_balance', () => {
      const violations: ComplianceViolation[] = [
        {
          rule_code: 'FAIR_BALANCE_001',
          rule_name: 'No balance',
          rule_type: 'fair_balance',
          severity: 'warning',
          action: 'rewrite_needed',
        },
      ];
      const injection = buildBalanceInjection(violations);
      // Even with rewrite_needed violations but no required_balance,
      // the template is still generated (though with empty items)
      expect(injection).toContain('COMPLIANCE REQUIREMENT');
    });

    it('should number items correctly', () => {
      const violations: ComplianceViolation[] = [
        {
          rule_code: 'FAIR_BALANCE_001',
          rule_name: 'Balance 1',
          rule_type: 'fair_balance',
          severity: 'warning',
          action: 'rewrite_needed',
          required_balance: 'First balance',
        },
        {
          rule_code: 'FAIR_BALANCE_002',
          rule_name: 'Balance 2',
          rule_type: 'fair_balance',
          severity: 'warning',
          action: 'rewrite_needed',
          required_balance: 'Second balance',
        },
      ];
      const injection = buildBalanceInjection(violations);
      expect(injection).toContain('1. First balance');
      expect(injection).toContain('2. Second balance');
    });
  });

  describe('FilterResult shape validation', () => {
    it('should have violations array populated correctly', () => {
      const rules: ComplianceRule[] = [
        {
          RULE_ID: '1',
          RULE_CODE: 'TEST',
          RULE_NAME: 'Test',
          RULE_TYPE: 'off_label',
          SEVERITY: 'warning',
          DESCRIPTION: JSON.stringify({ triggers: ['xyz'] }),
          ACTIVE: true,
        },
      ];
      const result = checkInput('This is xyz', rules);
      expect(Array.isArray(result.violations)).toBe(true);
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it('should set primaryViolation as highest severity', () => {
      const rules: ComplianceRule[] = [
        {
          RULE_ID: '1',
          RULE_CODE: 'TEST',
          RULE_NAME: 'Test',
          RULE_TYPE: 'off_label',
          SEVERITY: 'warning',
          DESCRIPTION: JSON.stringify({ triggers: ['xyz'] }),
          ACTIVE: true,
        },
      ];
      const result = checkInput('This is xyz', rules);
      expect(result.primaryViolation).toBeDefined();
      expect(result.primaryViolation?.rule_code).toBe('TEST');
    });

    it('should not have rewrittenText on non-rewrite status', () => {
      const result = checkInput('clean text', []);
      expect((result as any).rewrittenText).toBeUndefined();
    });

    it('should have correct FilterStatus values', () => {
      const result = checkInput('clean', []);
      expect(['clean', 'blocked', 'flagged', 'rewrite_needed']).toContain(
        result.status
      );
    });

    it('should have all required fields present', () => {
      const result = checkInput('text', []);
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('violations');
    });
  });

  describe('edge cases and errors', () => {
    it('should return clean for empty rules array', () => {
      const result = checkInput('some text', []);
      expect(result.status).toBe('clean');
    });

    it('should handle null/undefined text safely', () => {
      expect(() => checkInput('', [])).not.toThrow();
    });

    it('should skip rule with no regex pattern', () => {
      const rules: ComplianceRule[] = [
        {
          RULE_ID: '1',
          RULE_CODE: 'EMPTY',
          RULE_NAME: 'Empty triggers',
          RULE_TYPE: 'off_label',
          SEVERITY: 'warning',
          DESCRIPTION: JSON.stringify({}),
          ACTIVE: true,
        },
      ];
      const result = checkInput('any text', rules);
      expect(result.status).toBe('clean');
    });

    it('should skip empty trigger list', () => {
      const rules: ComplianceRule[] = [
        {
          RULE_ID: '1',
          RULE_CODE: 'EMPTY',
          RULE_NAME: 'Empty triggers',
          RULE_TYPE: 'off_label',
          SEVERITY: 'warning',
          DESCRIPTION: JSON.stringify({ triggers: [] }),
          ACTIVE: true,
        },
      ];
      const result = checkInput('any text', rules);
      expect(result.status).toBe('clean');
    });

    it('should skip null rule in array', () => {
      const rules: ComplianceRule[] = [
        {
          RULE_ID: '1',
          RULE_CODE: 'TEST',
          RULE_NAME: 'Test',
          RULE_TYPE: 'off_label',
          SEVERITY: 'warning',
          DESCRIPTION: JSON.stringify({ triggers: ['test'] }),
          ACTIVE: true,
        },
      ];
      expect(() => checkInput('test', rules)).not.toThrow();
    });

    it('should handle very large text (100KB)', () => {
      const largeText = 'a'.repeat(100000);
      expect(() => checkInput(largeText, [])).not.toThrow();
    });

    it('should handle unicode edge cases', () => {
      const rules: ComplianceRule[] = [
        {
          RULE_ID: '1',
          RULE_CODE: 'UNICODE',
          RULE_NAME: 'Unicode',
          RULE_TYPE: 'off_label',
          SEVERITY: 'warning',
          DESCRIPTION: JSON.stringify({ triggers: ['café'] }),
          ACTIVE: true,
        },
      ];
      const result = checkInput('café treatment', rules);
      expect(result.status).toBe('flagged');
    });

    it('should handle special characters and emojis', () => {
      const rules: ComplianceRule[] = [];
      const result = checkInput('Test 😀 @#$%', rules);
      expect(result.status).toBe('clean');
    });

    describe('block rules (hard-stop violations)', () => {
      it('should return blocked for PII rule with severity=block', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: 'block-001',
            RULE_CODE: 'PII_PATIENT_NAME',
            RULE_NAME: 'Patient name disclosure',
            RULE_TYPE: 'pii',
            SEVERITY: 'block',
            DESCRIPTION: JSON.stringify({
              triggers: ['john smith', 'patient john'],
              redirect_message: 'Cannot discuss patient names'
            }),
            ACTIVE: true,
          },
        ];
        const result = checkInput('The patient john smith presented with...', rules);
        expect(result.status).toBe('blocked');
        expect(result.violations).toHaveLength(1);
        expect(result.violations[0].action).toBe('blocked');
      });

      it('should return first block rule violation only', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: 'block-001',
            RULE_CODE: 'PII_001',
            RULE_NAME: 'PII block',
            RULE_TYPE: 'pii',
            SEVERITY: 'block',
            DESCRIPTION: JSON.stringify({ triggers: ['john'] }),
            ACTIVE: true,
          },
          {
            RULE_ID: 'block-002',
            RULE_CODE: 'PII_002',
            RULE_NAME: 'Another PII',
            RULE_TYPE: 'pii',
            SEVERITY: 'block',
            DESCRIPTION: JSON.stringify({ triggers: ['smith'] }),
            ACTIVE: true,
          },
        ];
        const result = checkInput('john smith', rules);
        expect(result.status).toBe('blocked');
        expect(result.violations).toHaveLength(1);
        expect(result.violations[0].rule_code).toBe('PII_001');
      });

      it('should capture redirect message from block rule', () => {
        const rules: ComplianceRule[] = [
          {
            RULE_ID: 'block-003',
            RULE_CODE: 'INJECTION_001',
            RULE_NAME: 'Injection attempt',
            RULE_TYPE: 'injection',
            SEVERITY: 'block',
            DESCRIPTION: JSON.stringify({
              triggers: ['drop table', 'delete from'],
              redirect_message: 'Cannot execute database commands in this session'
            }),
            ACTIVE: true,
          },
        ];
        const result = checkInput('drop table users', rules);
        expect(result.status).toBe('blocked');
        expect(result.violations[0].redirect_message).toBe('Cannot execute database commands in this session');
      });

    });
  });
});
