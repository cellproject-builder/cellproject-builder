export interface ServoScenario { mass: number; reach: number; angle: number; reference: number }

/** A deliberately limited static model: grams, centimetres, degrees and N·m. */
export function servoScenario({ mass, reach, angle, reference }: ServoScenario) {
  if (![mass, reach, angle, reference].every(Number.isFinite) || mass < 0 || reach < 0 || reference <= 0) throw new Error('Invalid scenario');
  const torque = mass / 1000 * 9.81 * reach / 100 * Math.abs(Math.cos(angle * Math.PI / 180));
  const utilization = torque / reference;
  return { torque, utilization, exceedsReference: utilization > 1 };
}
