import { describe, expect, it } from 'vitest';
import { describeDevice } from '../src/lib/device';

describe('a session’s device, as its owner would name it', () => {
  it('reads the common browsers on the common systems', () => {
    expect(
      describeDevice(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      ),
    ).toBe('Chrome on macOS');
    expect(
      describeDevice(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
      ),
    ).toBe('Edge on Windows');
    expect(
      describeDevice(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari on iPhone');
    expect(
      describeDevice('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0'),
    ).toBe('Firefox on Linux');
    expect(
      describeDevice(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Teams/24295.605.3225.8804',
      ),
    ).toBe('Teams on Windows');
  });

  it('says so when there is nothing to go on', () => {
    expect(describeDevice('')).toBe('Unknown device');
    expect(describeDevice(null)).toBe('Unknown device');
    expect(describeDevice('curl/8.7.1')).toBe('Unknown device');
  });
});
