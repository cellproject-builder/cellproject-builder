type PixelBlock = readonly [x: number, y: number, width: number, height: number];
type EngineerPose = 'idle' | 'walk' | 'write' | 'observe' | 'hammer';

function Pixels({ blocks, ink }: { blocks: readonly PixelBlock[]; ink: 'a' | 'b' | 'c' }) {
  return <g className={`ws-drift-ink-${ink}`}>
    {blocks.map(([x, y, width, height], index) => <rect key={index} x={x} y={y} width={width} height={height} />)}
  </g>;
}

/** Original, slender platform-game engineer; two drawing pixels make one CSS pixel. */
export function PixelEngineer({ pose = 'idle' }: { pose?: EngineerPose }) {
  return <svg className={`ws-engineer-sprite ws-engineer-pose-${pose}`} viewBox="0 0 40 64" width="20" height="32" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
    <g className="ws-engineer-leg-back">
      <Pixels ink="b" blocks={[[14, 50, 6, 12], [12, 60, 8, 4], [10, 62, 2, 2]]} />
      <Pixels ink="a" blocks={[[14, 52, 2, 7], [12, 60, 4, 1], [11, 62, 2, 1]]} />
      <Pixels ink="c" blocks={[[15, 51, 1, 4]]} />
    </g>
    <g className="ws-engineer-leg-front">
      <Pixels ink="b" blocks={[[22, 50, 6, 12], [24, 60, 8, 4], [32, 62, 2, 2]]} />
      <Pixels ink="a" blocks={[[24, 52, 2, 7], [28, 60, 4, 1], [25, 63, 8, 1]]} />
      <Pixels ink="c" blocks={[[25, 51, 1, 4], [28, 61, 2, 1]]} />
    </g>

    <g className="ws-engineer-body">
      {/* A neat work shirt, stitched overalls, and a small breast pocket. */}
      <Pixels ink="a" blocks={[[12, 34, 16, 16], [8, 36, 6, 8], [28, 36, 4, 8]]} />
      <Pixels ink="c" blocks={[[18, 32, 6, 4], [12, 36, 1, 4]]} />
      <Pixels ink="b" blocks={[[14, 34, 2, 10], [24, 34, 2, 10], [14, 42, 12, 8], [14, 48, 14, 4]]} />
      <Pixels ink="c" blocks={[[14, 40, 2, 2], [24, 40, 2, 2], [18, 44, 4, 1]]} />
      <Pixels ink="a" blocks={[[18, 45, 4, 2], [19, 47, 2, 1], [16, 49, 8, 1], [20, 50, 2, 2]]} />

      <g className="ws-engineer-arm-back">
        <Pixels ink="a" blocks={pose === 'walk' ? [[8, 40, 4, 10]] : [[8, 38, 4, 8]]} />
        <Pixels ink="b" blocks={pose === 'walk' ? [[8, 47, 4, 1]] : [[8, 45, 4, 1]]} />
        <Pixels ink="c" blocks={pose === 'walk' ? [[8, 48, 4, 4]] : [[8, 46, 6, 4]]} />
      </g>

      <g className="ws-engineer-head">
        {/* A small side profile: ear, cheek, projecting nose, and bright gaze. */}
        <Pixels ink="b" blocks={[[12, 18, 6, 10], [14, 26, 4, 4]]} />
        <Pixels ink="c" blocks={[[18, 20, 14, 10], [30, 24, 6, 4], [18, 30, 12, 2], [12, 24, 6, 4]]} />
        <Pixels ink="a" blocks={[[14, 24, 2, 4], [30, 28, 2, 2], [18, 30, 2, 2], [31, 26, 4, 1]]} />
        <Pixels ink="b" blocks={[[27, 21, 4, 1], [28, 22, 2, 4], [26, 28, 4, 1]]} />
        <Pixels ink="c" blocks={[[29, 22, 1, 1]]} />

        {/* A rounded, stepped helmet with a narrow safety brim. */}
        <Pixels ink="a" blocks={[[16, 4, 10, 2], [12, 6, 18, 4], [10, 10, 22, 8], [8, 18, 28, 2]]} />
        <Pixels ink="c" blocks={[[14, 8, 2, 6], [20, 6, 2, 10], [10, 18, 22, 1], [25, 12, 4, 4]]} />
        <Pixels ink="b" blocks={[[10, 20, 22, 2], [30, 10, 2, 8], [17, 13, 2, 1], [17, 16, 2, 1]]} />
        <Pixels ink="a" blocks={[[26, 13, 2, 2]]} />
      </g>

      <g className={`ws-engineer-arm-front${pose === 'write' ? ' ws-engineer-writing-arm' : ''}`}>
        {pose === 'walk' ? <>
          <Pixels ink="a" blocks={[[28, 40, 4, 8]]} />
          <Pixels ink="b" blocks={[[28, 45, 4, 1]]} />
          <Pixels ink="c" blocks={[[30, 46, 4, 4]]} />
        </> : pose === 'write' ? <>
          <Pixels ink="a" blocks={[[28, 38, 4, 6]]} />
          <Pixels ink="c" blocks={[[32, 38, 10, 4], [40, 36, 4, 4]]} />
          <Pixels ink="b" blocks={[[43, 30, 2, 12], [31, 39, 1, 3]]} />
          <Pixels ink="c" blocks={[[43, 32, 1, 4]]} />
        </> : pose === 'observe' ? <>
          <Pixels ink="a" blocks={[[28, 36, 4, 6], [30, 34, 4, 4]]} />
          <Pixels ink="c" blocks={[[32, 30, 4, 6]]} />
          <Pixels ink="b" blocks={[[32, 35, 3, 1]]} />
        </> : pose === 'hammer' ? <g className="ws-engineer-hammer-arm">
          {/* Rotate this whole arm around the shoulder at SVG coordinate (28, 38). */}
          <Pixels ink="a" blocks={[[28, 36, 4, 8], [31, 34, 4, 7], [34, 28, 3, 8]]} />
          <Pixels ink="b" blocks={[[34, 33, 3, 1], [36, 20, 2, 13]]} />
          <Pixels ink="c" blocks={[[34, 30, 5, 5], [37, 23, 1, 7]]} />
          <Pixels ink="b" blocks={[[32, 15, 10, 6], [40, 14, 2, 8]]} />
          <Pixels ink="a" blocks={[[33, 16, 7, 4]]} />
          <Pixels ink="c" blocks={[[33, 16, 6, 1], [40, 16, 1, 3]]} />
        </g> : <>
          <Pixels ink="a" blocks={[[28, 38, 4, 6]]} />
          <Pixels ink="c" blocks={[[32, 40, 6, 4]]} />
          <Pixels ink="b" blocks={[[31, 41, 1, 3]]} />
        </>}
      </g>
    </g>
  </svg>;
}
