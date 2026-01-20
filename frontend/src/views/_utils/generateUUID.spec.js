import { describe, it, expect } from 'vitest';
import generateUUID from './generateUUID';

describe('generateUUID', () => {
  it('should generate a valid UUID', () => {
    const uuid = generateUUID();
    
    // Check if the generated UUID matches the expected format
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('should generate unique UUIDs', () => {
    const uuid1 = generateUUID();
    const uuid2 = generateUUID();
    
    // Check that two generated UUIDs are different
    expect(uuid1).not.toBe(uuid2);
  });

  it('should always generate a UUID with "4" as the 13th character', () => {
    const uuid = generateUUID();
    
    // Check if the 13th character (index 14 due to hyphens) is always '4'
    expect(uuid.charAt(14)).toBe('4');
  });

  it('should always generate a UUID with "8", "9", "a", or "b" as the 17th character', () => {
    const uuid = generateUUID();
    
    // Check if the 17th character (index 19 due to hyphens) is '8', '9', 'a', or 'b'
    expect(['8', '9', 'a', 'b']).toContain(uuid.charAt(19).toLowerCase());
  });
});