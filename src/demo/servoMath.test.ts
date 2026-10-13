import { describe, expect, it } from 'vitest';
import { servoScenario } from './servoMath';

describe('servo investigation scenarios', () => {
  it('compares the gravitational moment with an explicitly supplied reference', () => {
    const result = servoScenario({ mass: 200, reach: 15, angle: 0, reference: .15 });
    expect(result.torque).toBeCloseTo(.2943, 4);
    expect(result.utilization).toBeCloseTo(1.962, 3);
    expect(result.exceedsReference).toBe(true);
  });
  it('uses horizontal distance, so the vertical arm has no static gravitational moment', () => {
    expect(servoScenario({ mass: 200, reach: 15, angle: 90, reference: .15 }).torque).toBeCloseTo(0, 8);
    expect(servoScenario({ mass: 0, reach: 30, angle: 0, reference: .15 }).torque).toBe(0);
  });
  it('rejects invalid physical inputs instead of displaying a false prediction', () => {
    for (const patch of [{ mass: -1 }, { reach: NaN }, { reference: 0 }, { angle: Infinity }]) {
      expect(() => servoScenario({ mass: 200, reach: 15, angle: 0, reference: .15, ...patch })).toThrow();
    }
  });
});
