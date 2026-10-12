import { Euler, Quaternion, Vector3 } from 'three';
import type { CustomVisualGeometry, SceneV1 } from '@/visuals/types';

type Vec3 = [number, number, number];
type Point = [number, number];
type ModelObject = SceneV1['objects'][number];
const ZERO: Vec3 = [0, 0, 0], ONE: Vec3 = [1, 1, 1];

// Euler calculations can produce -0, which JSON restores as 0. Keep authored
// scenes canonical before they enter the seed, revisions or portable backups.
const canonicalNumbers = <T extends number[]>(values: T): T => values.map(value => value === 0 ? 0 : value) as T;
function canonicalGeometry(geometry: CustomVisualGeometry): CustomVisualGeometry {
  switch (geometry.kind) {
    case 'extrude': return { ...geometry, points: geometry.points.map(canonicalNumbers), holes: geometry.holes.map(hole => hole.map(canonicalNumbers)) };
    case 'lathe': return { ...geometry, points: geometry.points.map(canonicalNumbers) };
    case 'tube': return { ...geometry, points: geometry.points.map(canonicalNumbers) };
    case 'buffer': return { ...geometry, vertices: geometry.vertices.map(canonicalNumbers), indices: canonicalNumbers(geometry.indices) };
  }
}

function builder(prefix: string, label: string) {
  const objects: ModelObject[] = [];
  const add = (id: string, type: ModelObject['type'], position: Vec3, scale: Vec3, color: string,
    rotation: Vec3 = ZERO, geometry?: CustomVisualGeometry) => {
    objects.push({ id: `${prefix}:${id}`, type, position: canonicalNumbers(position), rotation: canonicalNumbers(rotation), scale: canonicalNumbers(scale), color,
      ...(geometry ? { geometry: canonicalGeometry(geometry) } : {}) });
  };
  const custom = (id: string, geometry: CustomVisualGeometry, color: string, position: Vec3 = ZERO,
    rotation: Vec3 = ZERO, scale: Vec3 = ONE) => add(id, 'custom', position, scale, color, rotation, geometry);
  const rod = (id: string, start: Vec3, end: Vec3, diameter: number, color: string) => {
    const direction = new Vector3(...end).sub(new Vector3(...start));
    const length = direction.length();
    const rotation = new Euler().setFromQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize()));
    add(id, 'cylinder', start.map((value, axis) => (value + end[axis]) / 2) as Vec3,
      [diameter, length, diameter], color, [rotation.x, rotation.y, rotation.z]);
  };
  const tube = (id: string, points: Vec3[], radius: number, color: string, segments = 24) => custom(id,
    { kind: 'tube', points, radius, segments, radialSegments: 8, closed: false }, color);
  return { add, custom, rod, tube, scene: (): SceneV1 => ({ version: 1, label, objects }) };
}

const chamfered = (width: number, height: number, corner: number): Point[] => [
  [-width / 2 + corner, -height / 2], [width / 2 - corner, -height / 2], [width / 2, -height / 2 + corner],
  [width / 2, height / 2 - corner], [width / 2 - corner, height / 2], [-width / 2 + corner, height / 2],
  [-width / 2, height / 2 - corner], [-width / 2, -height / 2 + corner],
];
const extrude = (points: Point[], depth: number, bevel = 0, holes: Point[][] = []): CustomVisualGeometry =>
  ({ kind: 'extrude', points, holes, depth, bevel });

/** A stylized study scene, not CAD, a measured robot or a fabrication specification. */
export function createDemoRobotScene(): SceneV1 {
  const b = builder('demo-robot', 'Robô de dois braços — exemplo ilustrativo');
  const white = '#E9F1F6', blue = '#347FC4', navy = '#18334F', metal = '#A5BACB', black = '#253544';
  b.add('plinth', 'box', [0, .16, 0], [5.2, .24, 3.15], navy);
  b.add('base-shell', 'box', [0, .35, 0], [4.95, .18, 2.95], white);
  b.add('base-inset', 'box', [0, .46, 0], [4.45, .05, 2.45], blue);
  for (const x of [-2.12, 2.12]) for (const z of [-1.13, 1.13]) {
    const id = `foot:${x}:${z}`;
    b.add(id, 'cylinder', [x, .06, z], [.35, .13, .35], black);
    b.add(`${id}:bolt`, 'cylinder', [x, .46, z], [.10, .04, .10], metal);
  }
  b.custom('controller-shell', extrude(chamfered(1.24, .95, .12), .62, .025), white, [0, 1.05, -.68]);
  b.add('controller-face', 'box', [0, 1.08, -.345], [.98, .69, .055], navy);
  b.add('controller-screen', 'box', [0, 1.19, -.31], [.70, .23, .035], '#62C9DD');
  b.add('controller-screen-line', 'box', [-.1, 1.20, -.286], [.39, .027, .01], '#D8FAFF');
  for (let i = 0; i < 3; i++) b.add(`controller-key:${i}`, 'cylinder', [-.27 + i * .27, .93, -.29], [.11, .04, .11],
    i === 2 ? '#E8A95F' : blue, [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 5; i++) b.add(`controller-vent:${i}`, 'box', [.655, .82 + i * .105, -.68], [.025, .043, .33], navy);
  b.add('emergency-stop-seat', 'cylinder', [.82, .55, .90], [.31, .09, .31], '#D9B453');
  b.add('emergency-stop', 'cylinder', [.82, .64, .90], [.22, .13, .22], '#D55A54');
  b.add('workpiece-pad', 'cylinder', [0, .53, .65], [.85, .11, .85], black);
  b.add('workpiece', 'box', [0, .77, .65], [.38, .38, .38], '#E6B263', [0, .25, 0]);

  const arm = (side: 'left' | 'right', shoulder: Vec3, elbow: Vec3, wrist: Vec3, opening: number) => {
    const [x, , z] = shoulder;
    b.add(`${side}:turntable`, 'cylinder', [x, .59, z], [.96, .20, .96], navy);
    b.add(`${side}:turntable-ring`, 'cylinder', [x, .72, z], [.83, .08, .83], metal);
    b.add(`${side}:pedestal`, 'cylinder', [x, .92, z], [.58, .35, .58], white);
    b.add(`${side}:pedestal-stripe`, 'cylinder', [x, .87, z], [.60, .10, .60], blue);
    const joint = (name: string, at: Vec3, diameter: number) => {
      b.add(`${side}:${name}:servo`, 'box', at, [diameter * .93, diameter * .78, .50], navy);
      b.add(`${side}:${name}:pivot`, 'cylinder', [at[0], at[1], at[2] + .29], [diameter, .16, diameter], blue, [Math.PI / 2, 0, 0]);
      b.add(`${side}:${name}:cap`, 'cylinder', [at[0], at[1], at[2] + .39], [diameter * .66, .055, diameter * .66], white, [Math.PI / 2, 0, 0]);
      b.add(`${side}:${name}:axle`, 'cylinder', [at[0], at[1], at[2] + .43], [.11, .035, .11], metal, [Math.PI / 2, 0, 0]);
      for (const direction of [-1, 1]) b.add(`${side}:${name}:fastener:${direction}`, 'cylinder',
        [at[0] + direction * diameter * .22, at[1], at[2] + .43], [.055, .035, .055], navy, [Math.PI / 2, 0, 0]);
    };
    const link = (name: string, from: Vec3, to: Vec3) => {
      const dx = to[0] - from[0], dy = to[1] - from[1], length = Math.hypot(dx, dy);
      const center: Vec3 = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, from[2]];
      const rotation: Vec3 = [0, 0, -Math.atan2(dx, dy)];
      const slot = chamfered(.14, length * .46, .04);
      b.custom(`${side}:link:${name}:shell`, extrude(chamfered(.46, length, .10), .30, .025, [slot]), white, center, rotation);
      b.custom(`${side}:link:${name}:stripe`, extrude(chamfered(.065, length * .65, .025), .025, .008), blue,
        [center[0] - .15 * Math.cos(rotation[2]), center[1] - .15 * Math.sin(rotation[2]), center[2] + .18], rotation);
    };
    link('upper', shoulder, elbow); link('forearm', elbow, wrist);
    joint('shoulder', shoulder, .67); joint('elbow', elbow, .58); joint('wrist', wrist, .42);
    b.tube(`${side}:cable:upper`, [[x, .70, z - .28], [x - .15, 1.35, z - .34],
      [elbow[0] - .15, elbow[1] - .30, z - .34], [elbow[0], elbow[1], z - .27]], .045, black);
    b.tube(`${side}:cable:forearm`, [[elbow[0], elbow[1], z - .30],
      [(elbow[0] + wrist[0]) / 2, (elbow[1] + wrist[1]) / 2 + .16, z - .39], [wrist[0], wrist[1], z - .22]], .035, '#E8AE58');
    const palm: Vec3 = [wrist[0], wrist[1] + .11, z + .63];
    b.rod(`${side}:tool-shaft`, [wrist[0], wrist[1], z + .28], palm, .18, metal);
    b.add(`${side}:gripper-palm`, 'box', palm, [.57, .30, .30], navy);
    b.add(`${side}:gripper-cover`, 'box', [palm[0], palm[1] + .17, palm[2]], [.47, .06, .24], blue);
    for (const direction of [-1, 1]) {
      const fingerX = palm[0] + direction * opening;
      b.add(`${side}:finger:${direction}:knuckle`, 'cylinder', [fingerX, palm[1], palm[2] + .21], [.13, .09, .13], metal, [Math.PI / 2, 0, 0]);
      b.custom(`${side}:finger:${direction}:jaw`, extrude([
        [-.055, 0], [.055, 0], [.055, .32], [direction === 1 ? -.10 : .12, .44],
        [direction === 1 ? -.19 : .03, .39], [-.055, .28],
      ], .09, .008), white, [fingerX, palm[1] + .05, palm[2] + .27]);
      b.add(`${side}:finger:${direction}:pad`, 'box', [fingerX - direction * .10, palm[1] + .43, palm[2] + .27], [.11, .12, .12], black);
    }
  };
  arm('left', [-1.25, 1.16, .05], [-2.22, 2.56, .05], [-1.53, 3.48, .05], .23);
  arm('right', [1.25, 1.16, -.12], [2.30, 2.18, -.12], [1.86, 3.27, -.12], .27);
  return b.scene();
}

/** An illustrative planting/irrigation arrangement with no agronomic or plumbing claim. */
export function createDemoGardenScene(): SceneV1 {
  const b = builder('demo-garden', 'Horta elevada com irrigação — exemplo ilustrativo');
  const timber = '#B68052', timberLight = '#D2A775', frame = '#37564C', pipe = '#303E45';
  b.add('ground-plinth', 'box', [0, .04, 0], [6.0, .08, 4.15], '#DCE4D9');
  for (const x of [-1.8, 1.8]) for (const z of [-.95, .95]) {
    b.add(`frame:leg:${x}:${z}`, 'box', [x, .77, z], [.18, 1.47, .18], frame);
    b.add(`frame:foot:${x}:${z}`, 'box', [x, .12, z], [.34, .12, .34], '#263F38');
  }
  for (const z of [-.95, .95]) {
    b.add(`frame:rail:${z}`, 'box', [0, .39, z], [3.65, .12, .13], frame);
    b.rod(`frame:brace:${z}`, [-1.8, .43, z], [1.8, 1.26, z], .07, '#5C7D6D');
  }
  for (let i = 0; i < 3; i++) {
    for (const z of [-1.06, 1.06]) b.add(`planter:long-slat:${i}:${z}`, 'box', [0, 1.39 + i * .19, z], [4.05, .17, .12], i === 1 ? timberLight : timber);
    for (const x of [-1.98, 1.98]) b.add(`planter:end-slat:${i}:${x}`, 'box', [x, 1.39 + i * .19, 0], [.12, .17, 2.02], i === 1 ? timberLight : timber);
  }
  b.add('planter:bottom', 'box', [0, 1.30, 0], [3.90, .12, 2.02], timber);
  b.add('soil', 'box', [0, 1.76, 0], [3.80, .18, 1.92], '#564332');
  for (const z of [-1.08, 1.08]) b.add(`planter:rim-long:${z}`, 'box', [0, 1.96, z], [4.18, .10, .21], timberLight);
  for (const x of [-2, 2]) b.add(`planter:rim-end:${x}`, 'box', [x, 1.96, 0], [.20, .10, 2.00], timberLight);
  for (const x of [-1.78, 1.78]) for (const z of [-1.135, 1.135]) {
    b.add(`planter:corner:${x}:${z}`, 'box', [x, 1.63, z], [.13, .65, .055], frame);
    for (const y of [1.42, 1.83]) b.add(`planter:bolt:${x}:${z}:${y}`, 'sphere', [x, y, z * 1.025], [.07, .07, .045], '#BAC8B9');
  }

  // Folded, slightly cupped leaves are double-sided native buffer geometry.
  const leaf: CustomVisualGeometry = { kind: 'buffer', vertices: [
    [0, 0, 0], [-.17, .11, .16], [-.19, .18, .37], [0, .10, .68],
    [.19, .18, .37], [.17, .11, .16], [0, .21, .30],
  ], indices: [0, 6, 1, 1, 6, 2, 2, 6, 3, 3, 6, 4, 4, 6, 5, 5, 6, 0] };
  for (let plant = 0; plant < 6; plant++) {
    const x = -1.25 + (plant % 3) * 1.25, z = plant < 3 ? -.49 : .48;
    const height = .32 + (plant % 3) * .055;
    b.rod(`plant:${plant}:stem`, [x, 1.81, z], [x, 1.81 + height, z], .06, '#52794D');
    for (let petal = 0; petal < 5; petal++) {
      const angle = petal * Math.PI * 2 / 5 + plant * .31, scale = .72 + ((plant + petal) % 3) * .12;
      b.custom(`plant:${plant}:leaf:${petal}`, leaf, petal % 2 ? '#61934E' : '#3F734A',
        [x, 1.85 + height * .48, z], [-.15 - petal * .035, angle, 0], [scale, scale, scale]);
    }
    b.add(`plant:${plant}:heart`, 'sphere', [x, 1.89 + height, z], [.18, .24, .18], '#8BBE63');
  }

  b.custom('reservoir:body', { kind: 'lathe', segments: 32, points: [
    [0, 0], [.40, 0], [.49, .08], [.51, .18], [.51, 1.40], [.47, 1.52], [.40, 1.56], [0, 1.56],
  ] }, '#548E9D', [2.62, .12, -.51]);
  for (const y of [.44, 1.40]) b.custom(`reservoir:band:${y}`, { kind: 'lathe', segments: 32,
    points: [[.50, -.05], [.535, -.03], [.535, .03], [.50, .05]] }, '#8CB7B9', [2.62, y, -.51]);
  b.add('reservoir:lid', 'cylinder', [2.62, 1.75, -.51], [.91, .11, .91], '#2D5965');
  b.add('reservoir:handle', 'box', [2.62, 1.86, -.51], [.33, .11, .10], '#213F48');
  b.add('reservoir:level-gauge', 'box', [2.62, .95, .014], [.11, .88, .035], '#BADDE0');
  b.add('reservoir:water-mark', 'box', [2.62, .80, .037], [.065, .53, .016], '#55BBCD');
  b.rod('reservoir:outlet', [2.62, .34, -.10], [2.62, .34, .28], .16, '#BEBE9A');
  b.add('reservoir:valve', 'box', [2.62, .44, .22], [.29, .06, .08], '#E9B157');
  b.tube('irrigation:supply', [[2.62, .34, .28], [2.35, .34, .55], [2.20, 1.08, .64], [2.16, 2.07, .65], [1.77, 2.09, .65]], .055, pipe, 32);
  b.tube('irrigation:header', [[1.79, 2.09, -.73], [1.79, 2.09, 0], [1.79, 2.09, .73]], .052, pipe);
  for (const z of [-.49, .48]) {
    b.tube(`irrigation:row:${z}`, [[1.79, 2.09, z], [.80, 2.03, z], [-.4, 2.03, z], [-1.62, 2.03, z]], .034, pipe);
    for (let plant = 0; plant < 3; plant++) {
      const x = -1.25 + plant * 1.25;
      b.tube(`irrigation:dripper:${z}:${plant}`, [[x + .23, 2.03, z], [x + .23, 1.96, z + .14], [x + .16, 1.87, z + .16]], .018, '#586452', 10);
    }
  }
  b.custom('controller:case', extrude(chamfered(.67, .78, .07), .18, .02), '#E9EEE3', [1.24, 1.48, 1.20]);
  b.add('controller:face', 'box', [1.24, 1.52, 1.305], [.53, .60, .035], frame);
  b.add('controller:screen', 'box', [1.24, 1.64, 1.333], [.38, .20, .024], '#92C6B7');
  for (let i = 0; i < 2; i++) b.add(`controller:button:${i}`, 'cylinder', [1.12 + i * .24, 1.37, 1.34], [.10, .025, .10], i ? '#D9A556' : '#9BBDA5', [Math.PI / 2, 0, 0]);
  b.tube('controller:sensor-cable', [[1.24, 1.12, 1.20], [1.24, .97, 1.32], [.48, 1.06, 1.29], [.42, 1.83, .76]], .022, '#667365');
  b.rod('controller:soil-probe', [.42, 1.93, .76], [.42, 1.63, .76], .065, '#C9C9A9');
  return b.scene();
}
