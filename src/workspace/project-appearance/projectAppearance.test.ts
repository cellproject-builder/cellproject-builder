import { describe, expect, it } from 'vitest';
import { DEFAULT_PROJECT_APPEARANCE, projectAppearanceSchema } from './projectAppearance';

describe('project appearance data contract', () => {
  it('accepts the original symbol and future library export names without loading icon components', () => {
    expect(projectAppearanceSchema.parse(DEFAULT_PROJECT_APPEARANCE)).toEqual({ icon: 'planner', color: '#60a5fa' });
    expect(projectAppearanceSchema.parse({ icon: 'FutureRobotIcon', color: '#A1b2C3' })).toEqual({ icon: 'FutureRobotIcon', color: '#A1b2C3' });
  });

  it.each([
    { icon: '🚀', color: '#60a5fa' },
    { icon: '../GearIcon', color: '#60a5fa' },
    { icon: 'Gear', color: '#60a5fa' },
    { icon: `${'A'.repeat(65)}Icon`, color: '#60a5fa' },
    { icon: 'GearIcon', color: 'red' },
    { icon: 'GearIcon', color: '#fff' },
    { icon: 'GearIcon', color: '#12345678' },
    { icon: 'GearIcon', color: '#123456', html: '<svg />' },
  ])('rejects non-icon IDs, arbitrary CSS and extra fields: %j', input => {
    expect(projectAppearanceSchema.safeParse(input).success).toBe(false);
  });
});
