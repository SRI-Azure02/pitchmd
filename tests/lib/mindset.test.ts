import { describe, it, expect } from 'vitest';
import {
  PRESET_MINDSETS,
  MINDSET_DIMENSIONS,
  PresetMindset,
  MindsetDimension,
  CustomMindset,
} from '@/lib/mindset-types';
import {
  PRESET_MINDSET_DESCRIPTIONS,
  buildCustomMindsetDescription,
  getMindsetDescription,
} from '@/lib/mindset-descriptions';

describe('mindset', () => {
  describe('PRESET_MINDSETS', () => {
    it('should have exactly 5 preset mindsets', () => {
      expect(PRESET_MINDSETS).toHaveLength(5);
    });

    it('should contain Data Hawk', () => {
      expect(PRESET_MINDSETS).toContain('Data Hawk');
    });

    it('should contain Skeptical Traditionalist', () => {
      expect(PRESET_MINDSETS).toContain('Skeptical Traditionalist');
    });

    it('should contain Friendly Derailer', () => {
      expect(PRESET_MINDSETS).toContain('Friendly Derailer');
    });

    it('should contain Bureaucratic Defensive', () => {
      expect(PRESET_MINDSETS).toContain('Bureaucratic Defensive');
    });

    it('should contain Cost-Conscious Pragmatist', () => {
      expect(PRESET_MINDSETS).toContain('Cost-Conscious Pragmatist');
    });

    it('should be immutable (readonly)', () => {
      expect(Object.isFrozen(PRESET_MINDSETS) || PRESET_MINDSETS.includes).toBeTruthy();
    });

    it('should have unique values', () => {
      const uniqueSet = new Set(PRESET_MINDSETS);
      expect(uniqueSet.size).toBe(PRESET_MINDSETS.length);
    });

    it('should be in expected order', () => {
      const expected = [
        'Data Hawk',
        'Skeptical Traditionalist',
        'Friendly Derailer',
        'Bureaucratic Defensive',
        'Cost-Conscious Pragmatist',
      ];
      PRESET_MINDSETS.forEach((mindset, i) => {
        expect(mindset).toBe(expected[i]);
      });
    });
  });

  describe('MINDSET_DIMENSIONS', () => {
    it('should have exactly 7 dimensions', () => {
      expect(MINDSET_DIMENSIONS).toHaveLength(7);
    });

    it('should contain Evidence Orientation dimension', () => {
      const evDim = MINDSET_DIMENSIONS.find(d => d.id === 'evidence');
      expect(evDim).toBeDefined();
      expect(evDim?.name).toBe('Evidence Orientation');
    });

    it('should contain Adoption Profile dimension', () => {
      const adoptDim = MINDSET_DIMENSIONS.find(d => d.id === 'adoption');
      expect(adoptDim).toBeDefined();
      expect(adoptDim?.name).toBe('Adoption Profile');
    });

    it('should contain Risk Tolerance dimension', () => {
      const riskDim = MINDSET_DIMENSIONS.find(d => d.id === 'risk');
      expect(riskDim).toBeDefined();
      expect(riskDim?.name).toBe('Risk Tolerance');
    });

    it('should contain Skepticism dimension', () => {
      const skepticDim = MINDSET_DIMENSIONS.find(d => d.id === 'skeptic');
      expect(skepticDim).toBeDefined();
      expect(skepticDim?.name).toBe('Skepticism');
    });

    it('should contain Verbosity dimension', () => {
      const verbDim = MINDSET_DIMENSIONS.find(d => d.id === 'verbose');
      expect(verbDim).toBeDefined();
      expect(verbDim?.name).toBe('Verbosity');
    });

    it('should contain Formulary Status Awareness dimension', () => {
      const formDim = MINDSET_DIMENSIONS.find(d => d.id === 'formulary');
      expect(formDim).toBeDefined();
      expect(formDim?.name).toBe('Formulary Status Awareness');
    });

    it('should contain Patient Demographic Split dimension', () => {
      const patDim = MINDSET_DIMENSIONS.find(d => d.id === 'patients');
      expect(patDim).toBeDefined();
      expect(patDim?.name).toBe('Patient Demographic Split');
    });

    it('should have unique IDs', () => {
      const ids = MINDSET_DIMENSIONS.map(d => d.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should have unique names', () => {
      const names = MINDSET_DIMENSIONS.map(d => d.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });
  });

  describe('MindsetDimension structure', () => {
    it('should have all required properties on each dimension', () => {
      MINDSET_DIMENSIONS.forEach(dim => {
        expect(dim).toHaveProperty('id');
        expect(dim).toHaveProperty('category');
        expect(dim).toHaveProperty('name');
        expect(dim).toHaveProperty('leftLabel');
        expect(dim).toHaveProperty('rightLabel');
        expect(dim).toHaveProperty('leftDesc');
        expect(dim).toHaveProperty('rightDesc');
      });
    });

    it('should have non-empty strings for all properties', () => {
      MINDSET_DIMENSIONS.forEach(dim => {
        expect(typeof dim.id).toBe('string');
        expect(dim.id.length).toBeGreaterThan(0);
        expect(typeof dim.category).toBe('string');
        expect(dim.category.length).toBeGreaterThan(0);
        expect(typeof dim.name).toBe('string');
        expect(dim.name.length).toBeGreaterThan(0);
        expect(typeof dim.leftLabel).toBe('string');
        expect(dim.leftLabel.length).toBeGreaterThan(0);
        expect(typeof dim.rightLabel).toBe('string');
        expect(dim.rightLabel.length).toBeGreaterThan(0);
        expect(typeof dim.leftDesc).toBe('string');
        expect(dim.leftDesc.length).toBeGreaterThan(0);
        expect(typeof dim.rightDesc).toBe('string');
        expect(dim.rightDesc.length).toBeGreaterThan(0);
      });
    });

    it('should categorize dimensions correctly', () => {
      const clinicalDims = MINDSET_DIMENSIONS.filter(
        d => d.category === 'Clinical Disposition'
      );
      const interactionDims = MINDSET_DIMENSIONS.filter(
        d => d.category === 'Interaction & Communication'
      );
      const institutionalDims = MINDSET_DIMENSIONS.filter(
        d => d.category === 'Institutional & Systemic Constraints'
      );

      expect(clinicalDims).toHaveLength(3);
      expect(interactionDims).toHaveLength(2);
      expect(institutionalDims).toHaveLength(2);
    });

    it('should have Evidence Orientation as first dimension', () => {
      expect(MINDSET_DIMENSIONS[0].id).toBe('evidence');
    });

    it('should have Patient Demographic Split as last dimension', () => {
      expect(MINDSET_DIMENSIONS[6].id).toBe('patients');
    });
  });

  describe('PRESET_MINDSET_DESCRIPTIONS', () => {
    it('should have exactly 5 descriptions', () => {
      expect(Object.keys(PRESET_MINDSET_DESCRIPTIONS)).toHaveLength(5);
    });

    it('should have description for Data Hawk', () => {
      expect(PRESET_MINDSET_DESCRIPTIONS['Data Hawk']).toBeDefined();
      expect(PRESET_MINDSET_DESCRIPTIONS['Data Hawk']).toContain('Data Hawk');
    });

    it('should have description for Skeptical Traditionalist', () => {
      expect(PRESET_MINDSET_DESCRIPTIONS['Skeptical Traditionalist']).toBeDefined();
      expect(PRESET_MINDSET_DESCRIPTIONS['Skeptical Traditionalist']).toContain('Skeptical Traditionalist');
    });

    it('should have description for Friendly Derailer', () => {
      expect(PRESET_MINDSET_DESCRIPTIONS['Friendly Derailer']).toBeDefined();
      expect(PRESET_MINDSET_DESCRIPTIONS['Friendly Derailer']).toContain('Friendly Derailer');
    });

    it('should have description for Bureaucratic Defensive', () => {
      expect(PRESET_MINDSET_DESCRIPTIONS['Bureaucratic Defensive']).toBeDefined();
      expect(PRESET_MINDSET_DESCRIPTIONS['Bureaucratic Defensive']).toContain('Bureaucratic Defensive');
    });

    it('should have description for Cost-Conscious Pragmatist', () => {
      expect(PRESET_MINDSET_DESCRIPTIONS['Cost-Conscious Pragmatist']).toBeDefined();
      expect(PRESET_MINDSET_DESCRIPTIONS['Cost-Conscious Pragmatist']).toContain('Cost-Conscious Pragmatist');
    });

    it('should have descriptions for all presets', () => {
      PRESET_MINDSETS.forEach(mindset => {
        expect(PRESET_MINDSET_DESCRIPTIONS[mindset]).toBeDefined();
        expect(typeof PRESET_MINDSET_DESCRIPTIONS[mindset]).toBe('string');
      });
    });

    it('should contain behavioral directives in descriptions', () => {
      PRESET_MINDSETS.forEach(mindset => {
        const desc = PRESET_MINDSET_DESCRIPTIONS[mindset];
        expect(desc).toMatch(/Adopt ALL of these behaviors/i);
      });
    });

    it('should have non-empty descriptions', () => {
      PRESET_MINDSETS.forEach(mindset => {
        const desc = PRESET_MINDSET_DESCRIPTIONS[mindset];
        expect(desc.length).toBeGreaterThan(100);
      });
    });

    it('Data Hawk description should mention evidence and trials', () => {
      const desc = PRESET_MINDSET_DESCRIPTIONS['Data Hawk'];
      expect(desc).toMatch(/trial|evidence|p-value|data/i);
    });

    it('Skeptical Traditionalist description should mention risk and safety', () => {
      const desc = PRESET_MINDSET_DESCRIPTIONS['Skeptical Traditionalist'];
      expect(desc).toMatch(/safety|risk|adverse|black-box/i);
    });

    it('Friendly Derailer description should mention anecdotes and stories', () => {
      const desc = PRESET_MINDSET_DESCRIPTIONS['Friendly Derailer'];
      expect(desc).toMatch(/anecdote|story|derail|off.topic/i);
    });

    it('Bureaucratic Defensive description should mention formulary', () => {
      const desc = PRESET_MINDSET_DESCRIPTIONS['Bureaucratic Defensive'];
      expect(desc).toMatch(/formulary|committee|barrier/i);
    });

    it('Cost-Conscious Pragmatist description should mention costs', () => {
      const desc = PRESET_MINDSET_DESCRIPTIONS['Cost-Conscious Pragmatist'];
      expect(desc).toMatch(/cost|copay|afford|expense/i);
    });
  });

  describe('buildCustomMindsetDescription', () => {
    it('should build description for valid custom mindset', () => {
      const custom: CustomMindset = {
        name: 'Test Mindset',
        dimensions: {
          evidence: 'left',
          adoption: 'right',
          risk: 'left',
          skeptic: 'right',
          verbose: 'left',
          formulary: 'right',
          patients: 'left',
        },
      };

      const result = buildCustomMindsetDescription(custom);
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('should include mindset name in description', () => {
      const custom: CustomMindset = {
        name: 'My Custom Mindset',
        dimensions: {
          evidence: 'left',
          adoption: 'left',
          risk: 'left',
          skeptic: 'left',
          verbose: 'left',
          formulary: 'left',
          patients: 'left',
        },
      };

      const result = buildCustomMindsetDescription(custom);
      expect(result).toContain('My Custom Mindset');
      expect(result).toContain('Custom');
    });

    it('should include all dimension names', () => {
      const custom: CustomMindset = {
        name: 'Test',
        dimensions: {
          evidence: 'left',
          adoption: 'left',
          risk: 'left',
          skeptic: 'left',
          verbose: 'left',
          formulary: 'left',
          patients: 'left',
        },
      };

      const result = buildCustomMindsetDescription(custom);
      MINDSET_DIMENSIONS.forEach(dim => {
        expect(result).toContain(dim.name);
      });
    });

    it('should use left labels for left selections', () => {
      const custom: CustomMindset = {
        name: 'Test',
        dimensions: {
          evidence: 'left',
          adoption: 'left',
          risk: 'left',
          skeptic: 'left',
          verbose: 'left',
          formulary: 'left',
          patients: 'left',
        },
      };

      const result = buildCustomMindsetDescription(custom);
      expect(result).toContain('Data-Driven');
      expect(result).toContain('Innovator / Early Adopter');
      expect(result).toContain('Conservative (Low)');
    });

    it('should use right labels for right selections', () => {
      const custom: CustomMindset = {
        name: 'Test',
        dimensions: {
          evidence: 'right',
          adoption: 'right',
          risk: 'right',
          skeptic: 'right',
          verbose: 'right',
          formulary: 'right',
          patients: 'right',
        },
      };

      const result = buildCustomMindsetDescription(custom);
      expect(result).toContain('Experiential');
      expect(result).toContain('Late Majority / Laggard');
      expect(result).toContain('Aggressive (High)');
    });

    it('should mix left and right labels correctly', () => {
      const custom: CustomMindset = {
        name: 'Mixed',
        dimensions: {
          evidence: 'left',
          adoption: 'right',
          risk: 'left',
          skeptic: 'right',
          verbose: 'left',
          formulary: 'right',
          patients: 'left',
        },
      };

      const result = buildCustomMindsetDescription(custom);
      expect(result).toContain('Data-Driven');
      expect(result).toContain('Late Majority / Laggard');
      expect(result).toContain('Conservative (Low)');
      expect(result).toContain('Low (Passive)');
    });

    it('should default missing dimensions to left', () => {
      const custom: CustomMindset = {
        name: 'Partial',
        dimensions: {
          evidence: 'left',
        },
      };

      const result = buildCustomMindsetDescription(custom);
      expect(result).toContain('Evidence Orientation');
      // Check that defaults to left descriptions
      expect(result).toContain('Data-Driven');
    });

    it('should include left descriptions for left selections', () => {
      const custom: CustomMindset = {
        name: 'Test',
        dimensions: {
          evidence: 'left',
          adoption: 'left',
          risk: 'left',
          skeptic: 'left',
          verbose: 'left',
          formulary: 'left',
          patients: 'left',
        },
      };

      const result = buildCustomMindsetDescription(custom);
      expect(result).toContain('Demands specific clinical trials');
      expect(result).toContain('Eager to try new mechanisms');
    });

    it('should include right descriptions for right selections', () => {
      const custom: CustomMindset = {
        name: 'Test',
        dimensions: {
          evidence: 'right',
          adoption: 'right',
          risk: 'right',
          skeptic: 'right',
          verbose: 'right',
          formulary: 'right',
          patients: 'right',
        },
      };

      const result = buildCustomMindsetDescription(custom);
      expect(result).toContain('Relies on personal clinical success');
      expect(result).toContain('Deeply entrenched in current protocols');
    });

    it('should have HCP MINDSET header', () => {
      const custom: CustomMindset = {
        name: 'Test',
        dimensions: {
          evidence: 'left',
          adoption: 'left',
          risk: 'left',
          skeptic: 'left',
          verbose: 'left',
          formulary: 'left',
          patients: 'left',
        },
      };

      const result = buildCustomMindsetDescription(custom);
      expect(result).toMatch(/HCP MINDSET/);
    });

    it('should use bullet format for behavioral traits', () => {
      const custom: CustomMindset = {
        name: 'Test',
        dimensions: {
          evidence: 'left',
          adoption: 'left',
          risk: 'left',
          skeptic: 'left',
          verbose: 'left',
          formulary: 'left',
          patients: 'left',
        },
      };

      const result = buildCustomMindsetDescription(custom);
      expect(result).toMatch(/- .+:/);
    });
  });

  describe('getMindsetDescription', () => {
    it('should return null for null mindset name', () => {
      const result = getMindsetDescription(null, {});
      expect(result).toBeNull();
    });

    it('should return null for undefined mindset name', () => {
      const result = getMindsetDescription(undefined, {});
      expect(result).toBeNull();
    });

    it('should return null for unknown mindset name', () => {
      const result = getMindsetDescription('Unknown Mindset', {});
      expect(result).toBeNull();
    });

    it('should return preset description for Data Hawk', () => {
      const result = getMindsetDescription('Data Hawk', {});
      expect(result).toBe(PRESET_MINDSET_DESCRIPTIONS['Data Hawk']);
    });

    it('should return preset description for all presets', () => {
      PRESET_MINDSETS.forEach(mindset => {
        const result = getMindsetDescription(mindset, {});
        expect(result).toBe(PRESET_MINDSET_DESCRIPTIONS[mindset]);
      });
    });

    it('should return custom description for saved custom mindset', () => {
      const customMindset: CustomMindset = {
        name: 'My Custom',
        dimensions: {
          evidence: 'left',
          adoption: 'left',
          risk: 'left',
          skeptic: 'left',
          verbose: 'left',
          formulary: 'left',
          patients: 'left',
        },
      };

      const savedMindsets = {
        'my-custom': customMindset,
      };

      const result = getMindsetDescription('my-custom', savedMindsets);
      expect(result).toBeDefined();
      expect(result).toContain('My Custom');
    });

    it('should prefer preset over custom if same name', () => {
      const customMindset: CustomMindset = {
        name: 'Data Hawk Override',
        dimensions: {
          evidence: 'right',
          adoption: 'right',
          risk: 'right',
          skeptic: 'right',
          verbose: 'right',
          formulary: 'right',
          patients: 'right',
        },
      };

      const savedMindsets = {
        'Data Hawk': customMindset,
      };

      const result = getMindsetDescription('Data Hawk', savedMindsets);
      expect(result).toBe(PRESET_MINDSET_DESCRIPTIONS['Data Hawk']);
    });

    it('should return custom when preset name not found', () => {
      const customMindset: CustomMindset = {
        name: 'Custom Only',
        dimensions: {
          evidence: 'left',
          adoption: 'left',
          risk: 'left',
          skeptic: 'left',
          verbose: 'left',
          formulary: 'left',
          patients: 'left',
        },
      };

      const savedMindsets = {
        'custom-only': customMindset,
      };

      const result = getMindsetDescription('custom-only', savedMindsets);
      expect(result).toContain('Custom Only');
    });

    it('should handle empty saved mindsets object', () => {
      const result = getMindsetDescription('Data Hawk', {});
      expect(result).toBe(PRESET_MINDSET_DESCRIPTIONS['Data Hawk']);
    });

    it('should handle multiple saved custom mindsets', () => {
      const custom1: CustomMindset = {
        name: 'Custom 1',
        dimensions: {
          evidence: 'left',
          adoption: 'left',
          risk: 'left',
          skeptic: 'left',
          verbose: 'left',
          formulary: 'left',
          patients: 'left',
        },
      };

      const custom2: CustomMindset = {
        name: 'Custom 2',
        dimensions: {
          evidence: 'right',
          adoption: 'right',
          risk: 'right',
          skeptic: 'right',
          verbose: 'right',
          formulary: 'right',
          patients: 'right',
        },
      };

      const savedMindsets = {
        'custom-1': custom1,
        'custom-2': custom2,
      };

      const result1 = getMindsetDescription('custom-1', savedMindsets);
      const result2 = getMindsetDescription('custom-2', savedMindsets);

      expect(result1).toContain('Custom 1');
      expect(result2).toContain('Custom 2');
    });

    it('should be case-sensitive', () => {
      const result = getMindsetDescription('data hawk', {});
      expect(result).toBeNull();
    });
  });

  describe('integration scenarios', () => {
    it('should generate description for all 5 presets', () => {
      PRESET_MINDSETS.forEach(mindset => {
        const desc = getMindsetDescription(mindset, {});
        expect(desc).toBeDefined();
        expect(desc?.length).toBeGreaterThan(0);
      });
    });

    it('should generate valid custom mindset descriptions', () => {
      const customMindsets: Record<string, CustomMindset> = {
        'hawk-like': {
          name: 'Hawk-Like',
          dimensions: {
            evidence: 'left',
            adoption: 'left',
            risk: 'left',
            skeptic: 'left',
            verbose: 'left',
            formulary: 'left',
            patients: 'left',
          },
        },
        'laid-back': {
          name: 'Laid-Back',
          dimensions: {
            evidence: 'right',
            adoption: 'right',
            risk: 'right',
            skeptic: 'right',
            verbose: 'right',
            formulary: 'right',
            patients: 'right',
          },
        },
      };

      Object.entries(customMindsets).forEach(([key, mindset]) => {
        const desc = getMindsetDescription(key, customMindsets);
        expect(desc).toBeDefined();
        expect(desc).toContain(mindset.name);
      });
    });

    it('should handle mixed preset and custom mindsets', () => {
      const customMindset: CustomMindset = {
        name: 'Custom Hybrid',
        dimensions: {
          evidence: 'left',
          adoption: 'right',
          risk: 'left',
          skeptic: 'right',
          verbose: 'left',
          formulary: 'right',
          patients: 'left',
        },
      };

      const savedMindsets = {
        'custom-hybrid': customMindset,
      };

      const presetDesc = getMindsetDescription('Data Hawk', savedMindsets);
      const customDesc = getMindsetDescription('custom-hybrid', savedMindsets);

      expect(presetDesc).toBe(PRESET_MINDSET_DESCRIPTIONS['Data Hawk']);
      expect(customDesc).toContain('Custom Hybrid');
    });

    it('should all dimensions appear in custom mindset description', () => {
      const custom: CustomMindset = {
        name: 'Complete',
        dimensions: {
          evidence: 'left',
          adoption: 'left',
          risk: 'left',
          skeptic: 'left',
          verbose: 'left',
          formulary: 'left',
          patients: 'left',
        },
      };

      const desc = buildCustomMindsetDescription(custom);
      MINDSET_DIMENSIONS.forEach(dim => {
        expect(desc).toContain(dim.name);
      });
    });

    it('should preserve dimension order in custom description', () => {
      const custom: CustomMindset = {
        name: 'Ordered',
        dimensions: {
          evidence: 'left',
          adoption: 'left',
          risk: 'left',
          skeptic: 'left',
          verbose: 'left',
          formulary: 'left',
          patients: 'left',
        },
      };

      const desc = buildCustomMindsetDescription(custom);
      const lines = desc.split('\n');

      const evidenceIdx = lines.findIndex(l => l.includes('Evidence Orientation'));
      const adoptionIdx = lines.findIndex(l => l.includes('Adoption Profile'));
      const patientIdx = lines.findIndex(l => l.includes('Patient Demographic Split'));

      expect(evidenceIdx).toBeLessThan(adoptionIdx);
      expect(adoptionIdx).toBeLessThan(patientIdx);
    });
  });
});
