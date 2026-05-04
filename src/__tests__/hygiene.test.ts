import { describe, it, expect } from 'vitest';
import { normalizeParentCardByMode } from '../app/actions/data-hygiene/parent-pattern';

describe('Data Hygiene: Parent Card Pattern Logic', () => {
  describe('all_to_numbered mode', () => {
    it('should convert plain suffix to numbered (W -> W1)', async () => {
      const result = await normalizeParentCardByMode('WAB2025123W', 'all_to_numbered');
      expect(result.changed).toBe(true);
      expect(result.nextCard).toBe('WAB2025123W1');
    });

    it('should keep already numbered suffix (W1 -> W1)', async () => {
      const result = await normalizeParentCardByMode('WAB2025123W1', 'all_to_numbered');
      expect(result.changed).toBe(false);
      expect(result.nextCard).toBe('WAB2025123W1');
    });

    it('should convert H2 to H1', async () => {
      const result = await normalizeParentCardByMode('WAB2025123H2', 'all_to_numbered');
      expect(result.changed).toBe(true);
      expect(result.nextCard).toBe('WAB2025123H1');
    });

    it('should convert plain H to H1', async () => {
      const result = await normalizeParentCardByMode('WAB2025123H', 'all_to_numbered');
      expect(result.changed).toBe(true);
      expect(result.nextCard).toBe('WAB2025123H1');
    });
  });

  describe('all_to_plain mode', () => {
    it('should convert numbered suffix to plain (W1 -> W)', async () => {
      const result = await normalizeParentCardByMode('WAB2025123W1', 'all_to_plain');
      expect(result.changed).toBe(true);
      expect(result.nextCard).toBe('WAB2025123W');
    });

    it('should keep W2 as W2 (not W)', async () => {
      const result = await normalizeParentCardByMode('WAB2025123W2', 'all_to_plain');
      expect(result.changed).toBe(false);
      expect(result.nextCard).toBe('WAB2025123W2');
    });
  });
});
