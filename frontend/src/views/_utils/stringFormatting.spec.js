import { describe, it, expect } from 'vitest';
import {
  formatTextToDivId,
  unformatDivIdToText,
  capitalizeFirstLetter,
  camelCaseToTitleCase,
  toKebabCase
} from './stringFormatting';

describe('String Formatting Utils', () => {
  describe('formatTextToDivId', () => {
    it('converts text to a valid div ID', () => {
      expect(formatTextToDivId('Hello World!')).toBe('hello-world');
      expect(formatTextToDivId('  Multiple   Spaces  ')).toBe('multiple-spaces');
      expect(formatTextToDivId('Special@#$Characters')).toBe('specialcharacters');
    });
  });

  describe('unformatDivIdToText', () => {
    it('converts a div ID back to readable text', () => {
      expect(unformatDivIdToText('hello-world')).toBe('Hello World');
      expect(unformatDivIdToText('multiple--hyphens')).toBe('Multiple Hyphens');
    });
  });

  describe('capitalizeFirstLetter', () => {
    it('capitalizes the first letter of a string', () => {
      expect(capitalizeFirstLetter('hello')).toBe('Hello');
      expect(capitalizeFirstLetter('ALREADY CAPITALIZED')).toBe('ALREADY CAPITALIZED');
    });
  });

  describe('camelCaseToTitleCase', () => {
    it('converts camelCase to Title Case', () => {
      expect(camelCaseToTitleCase('helloWorld')).toBe('Hello World');
      expect(camelCaseToTitleCase('APIResponse')).toBe('API Response');
      expect(camelCaseToTitleCase('getHTTPResponse')).toBe('Get HTTP Response');
    });
  });

  describe('toKebabCase', () => {
    it('converts a string to kebab-case', () => {
      expect(toKebabCase('Hello World')).toBe('hello-world');
      expect(toKebabCase('camelCase')).toBe('camel-case');
      expect(toKebabCase('snake_case')).toBe('snake-case');
      expect(toKebabCase('Special@#$Characters')).toBe('special-characters');
    });
  });
});