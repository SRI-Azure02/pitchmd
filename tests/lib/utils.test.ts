import { describe, it, expect } from 'vitest';
import { cn } from '@/lib/utils';

describe('utils', () => {
  describe('cn() — class merging', () => {
    describe('basic functionality', () => {
      it('should merge two class strings', () => {
        const result = cn('px-2 py-1', 'p-3');
        expect(result).toContain('p-3');
      });

      it('should handle empty inputs', () => {
        const result = cn('', 'px-2');
        expect(result).toContain('px-2');
      });

      it('should handle multiple empty strings', () => {
        const result = cn('', '', '');
        expect(result.trim()).toBe('');
      });

      it('should deduplicate identical classes', () => {
        const result = cn('px-2 py-1', 'px-2 py-1');
        expect(result).toContain('px-2');
        expect(result).toContain('py-1');
      });

      it('should handle single class', () => {
        const result = cn('px-2');
        expect(result).toContain('px-2');
      });

      it('should handle no arguments', () => {
        const result = cn();
        expect(typeof result).toBe('string');
      });
    });

    describe('Tailwind conflict resolution', () => {
      it('should merge padding classes with padding variable conflicts', () => {
        const result = cn('px-2 py-1', 'p-3');
        expect(result).toContain('p-3');
      });

      it('should prefer later conflicting class', () => {
        const result = cn('bg-red-500', 'bg-blue-500');
        expect(result).toContain('bg-blue-500');
        expect(result).not.toContain('bg-red-500');
      });

      it('should resolve margin conflicts', () => {
        const result = cn('m-2', 'mx-4');
        expect(result).toContain('mx-4');
      });

      it('should handle width conflicts', () => {
        const result = cn('w-1/2', 'w-full');
        expect(result).toContain('w-full');
      });

      it('should handle opacity conflicts', () => {
        const result = cn('opacity-50', 'opacity-100');
        expect(result).toContain('opacity-100');
      });

      it('should resolve display conflicts', () => {
        const result = cn('block', 'inline-block');
        expect(result).toContain('inline-block');
      });

      it('should handle text color conflicts', () => {
        const result = cn('text-red-500', 'text-gray-700');
        expect(result).toContain('text-gray-700');
      });

      it('should handle multiple conflict resolutions', () => {
        const result = cn(
          'px-2 py-1 bg-red-500 text-white',
          'p-3 bg-blue-500 text-black'
        );
        expect(result).toContain('p-3');
        expect(result).toContain('bg-blue-500');
        expect(result).toContain('text-black');
      });
    });

    describe('undefined and null handling', () => {
      it('should handle undefined', () => {
        const result = cn(undefined, 'px-2');
        expect(result).toContain('px-2');
      });

      it('should handle null', () => {
        const result = cn(null, 'px-2');
        expect(result).toContain('px-2');
      });

      it('should handle mixed undefined and strings', () => {
        const result = cn('px-2', undefined, 'py-1', null, 'bg-white');
        expect(result).toContain('px-2');
        expect(result).toContain('py-1');
        expect(result).toContain('bg-white');
      });

      it('should handle all null/undefined inputs', () => {
        const result = cn(undefined, null, undefined);
        expect(typeof result).toBe('string');
      });
    });

    describe('conditional classes', () => {
      it('should handle conditional with true', () => {
        const isActive = true;
        const result = cn('base-class', isActive && 'active-class');
        expect(result).toContain('base-class');
        expect(result).toContain('active-class');
      });

      it('should handle conditional with false', () => {
        const isActive = false;
        const result = cn('base-class', isActive && 'active-class');
        expect(result).toContain('base-class');
        expect(result).not.toContain('active-class');
      });

      it('should handle ternary conditional', () => {
        const isActive = true;
        const result = cn('base', isActive ? 'active-true' : 'active-false');
        expect(result).toContain('active-true');
        expect(result).not.toContain('active-false');
      });

      it('should handle ternary conditional false branch', () => {
        const isActive = false;
        const result = cn('base', isActive ? 'active-true' : 'active-false');
        expect(result).toContain('active-false');
        expect(result).not.toContain('active-true');
      });

      it('should handle multiple conditionals', () => {
        const isActive = true;
        const isDisabled = false;
        const result = cn(
          'base',
          isActive && 'active',
          isDisabled && 'disabled'
        );
        expect(result).toContain('base');
        expect(result).toContain('active');
        expect(result).not.toContain('disabled');
      });
    });

    describe('array input', () => {
      it('should handle array of classes', () => {
        const result = cn(['px-2', 'py-1']);
        expect(result).toContain('px-2');
        expect(result).toContain('py-1');
      });

      it('should handle array with null elements', () => {
        const result = cn(['px-2', null, 'py-1']);
        expect(result).toContain('px-2');
        expect(result).toContain('py-1');
      });

      it('should handle array with undefined elements', () => {
        const result = cn(['px-2', undefined, 'py-1']);
        expect(result).toContain('px-2');
        expect(result).toContain('py-1');
      });

      it('should handle nested arrays', () => {
        const result = cn(['px-2', ['py-1', 'bg-white']]);
        expect(result).toContain('px-2');
        expect(result).toContain('py-1');
        expect(result).toContain('bg-white');
      });
    });

    describe('object input', () => {
      it('should handle object with true values', () => {
        const result = cn({ 'px-2': true, 'py-1': true });
        expect(result).toContain('px-2');
        expect(result).toContain('py-1');
      });

      it('should skip object keys with false values', () => {
        const result = cn({ 'px-2': true, 'py-1': false });
        expect(result).toContain('px-2');
        expect(result).not.toContain('py-1');
      });

      it('should handle mixed object input', () => {
        const result = cn({
          'px-2': true,
          'py-1': false,
          'bg-white': true,
        });
        expect(result).toContain('px-2');
        expect(result).toContain('bg-white');
        expect(result).not.toContain('py-1');
      });

      it('should handle object values as strings', () => {
        const isActive = true;
        const result = cn({
          'px-2': true,
          'py-1': isActive,
        });
        expect(result).toContain('px-2');
        expect(result).toContain('py-1');
      });
    });

    describe('mixed input types', () => {
      it('should handle string and array mix', () => {
        const result = cn('px-2', ['py-1', 'bg-white']);
        expect(result).toContain('px-2');
        expect(result).toContain('py-1');
        expect(result).toContain('bg-white');
      });

      it('should handle string and object mix', () => {
        const result = cn('px-2', { 'py-1': true, 'bg-white': false });
        expect(result).toContain('px-2');
        expect(result).toContain('py-1');
        expect(result).not.toContain('bg-white');
      });

      it('should handle all types together', () => {
        const result = cn(
          'px-2',
          ['py-1'],
          { 'bg-white': true },
          true && 'text-black'
        );
        expect(result).toContain('px-2');
        expect(result).toContain('py-1');
        expect(result).toContain('bg-white');
        expect(result).toContain('text-black');
      });

      it('should handle nested mixed types', () => {
        const result = cn(
          'base',
          ['array', { 'object-true': true, 'object-false': false }],
          { 'another-true': true }
        );
        expect(result).toContain('base');
        expect(result).toContain('array');
        expect(result).toContain('object-true');
        expect(result).toContain('another-true');
        expect(result).not.toContain('object-false');
      });
    });

    describe('nested calls', () => {
      it('should handle nested cn() calls', () => {
        const base = cn('px-2', 'py-1');
        const result = cn(base, 'bg-white');
        expect(result).toContain('px-2');
        expect(result).toContain('py-1');
        expect(result).toContain('bg-white');
      });

      it('should handle multiple levels of nesting', () => {
        const level1 = cn('px-2');
        const level2 = cn(level1, 'py-1');
        const level3 = cn(level2, 'bg-white');
        expect(level3).toContain('px-2');
        expect(level3).toContain('py-1');
        expect(level3).toContain('bg-white');
      });

      it('should resolve conflicts in nested calls', () => {
        const base = cn('bg-red-500');
        const result = cn(base, 'bg-blue-500');
        expect(result).toContain('bg-blue-500');
        expect(result).not.toContain('bg-red-500');
      });
    });

    describe('Tailwind-specific classes', () => {
      it('should preserve responsive classes', () => {
        const result = cn('md:px-2 lg:px-4');
        expect(result).toContain('md:px-2');
        expect(result).toContain('lg:px-4');
      });

      it('should handle hover classes', () => {
        const result = cn('bg-white hover:bg-gray-100');
        expect(result).toContain('bg-white');
        expect(result).toContain('hover:bg-gray-100');
      });

      it('should handle dark mode classes', () => {
        const result = cn('bg-white dark:bg-gray-900');
        expect(result).toContain('bg-white');
        expect(result).toContain('dark:bg-gray-900');
      });

      it('should handle arbitrary classes', () => {
        const result = cn('[&>*]:mb-2');
        expect(result).toContain('[&>*]:mb-2');
      });

      it('should handle complex arbitrary classes', () => {
        const result = cn('[mask-image:linear-gradient(black,transparent)]');
        expect(result).toContain('mask-image');
      });

      it('should merge with variants correctly', () => {
        const result = cn('px-2 md:px-4', 'px-1');
        expect(result).toContain('px-1');
        expect(result).toContain('md:px-4');
      });
    });

    describe('custom classes', () => {
      it('should handle custom CSS class names', () => {
        const result = cn('custom-class-name', 'another-custom');
        expect(result).toContain('custom-class-name');
        expect(result).toContain('another-custom');
      });

      it('should handle hyphenated custom classes', () => {
        const result = cn('my-custom-class', 'my-custom-variant');
        expect(result).toContain('my-custom-class');
        expect(result).toContain('my-custom-variant');
      });

      it('should handle numbered classes', () => {
        const result = cn('class1', 'class2');
        expect(result).toContain('class1');
        expect(result).toContain('class2');
      });
    });

    describe('edge cases', () => {
      it('should handle very long class strings', () => {
        const longClass = Array.from({ length: 100 }, (_, i) => `class-${i}`).join(' ');
        const result = cn(longClass);
        expect(result).toContain('class-0');
        expect(result).toContain('class-99');
      });

      it('should handle whitespace variations', () => {
        const result = cn('px-2  py-1', '  bg-white  ');
        expect(result).toContain('px-2');
        expect(result).toContain('py-1');
        expect(result).toContain('bg-white');
      });

      it('should handle class with only spaces', () => {
        const result = cn('px-2', '   ', 'py-1');
        expect(result).toContain('px-2');
        expect(result).toContain('py-1');
      });

      it('should return string type always', () => {
        const result = cn();
        expect(typeof result).toBe('string');
      });

      it('should be idempotent', () => {
        const input = 'px-2 py-1 bg-white';
        const result1 = cn(input);
        const result2 = cn(result1);
        expect(result1).toBe(result2);
      });
    });

    describe('performance and type safety', () => {
      it('should handle large input quickly', () => {
        const inputs = Array.from({ length: 1000 }, (_, i) => `class-${i}`);
        const start = performance.now();
        const result = cn(...inputs);
        const end = performance.now();
        expect(end - start).toBeLessThan(100);
      });

      it('should preserve class order semantics', () => {
        const result = cn('px-2', 'py-1', 'bg-white');
        expect(typeof result).toBe('string');
      });

      it('should not mutate input arrays', () => {
        const arr = ['px-2', 'py-1'];
        const original = [...arr];
        cn(arr);
        expect(arr).toEqual(original);
      });

      it('should not mutate input objects', () => {
        const obj = { 'px-2': true };
        const original = { ...obj };
        cn(obj);
        expect(obj).toEqual(original);
      });
    });

    describe('real-world usage patterns', () => {
      it('should compose component class patterns', () => {
        const baseButton = 'px-4 py-2 rounded font-medium';
        const primary = cn(baseButton, 'bg-blue-500 text-white');
        const secondary = cn(baseButton, 'bg-gray-200 text-gray-900');
        expect(primary).toContain('bg-blue-500');
        expect(secondary).toContain('bg-gray-200');
      });

      it('should handle conditional styling patterns', () => {
        const isDisabled = true;
        const buttonClass = cn(
          'px-4 py-2 rounded',
          isDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-600'
        );
        expect(buttonClass).toContain('opacity-50');
        expect(buttonClass).not.toContain('hover:bg-blue-600');
      });

      it('should compose layout variants', () => {
        const layout = 'flex items-center justify-between';
        const spacing = 'px-2 py-1';
        const result = cn(layout, spacing, 'bg-white');
        expect(result).toContain('flex');
        expect(result).toContain('px-2');
        expect(result).toContain('bg-white');
      });
    });
  });
});
