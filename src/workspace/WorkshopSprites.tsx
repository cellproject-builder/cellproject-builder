export type WorkshopSpriteKind = 'engineering' | 'plans' | 'blueprints' | 'ideas' | 'math' | 'robot';

type PixelBlock = readonly [x: number, y: number, width: number, height: number, color: string];

const ink = '#101a32';
const navy = '#263957';
const steel = '#657d9d';
const silver = '#b9d2df';
const cream = '#fff1ba';
const gold = '#f5bc44';
const amber = '#c77b28';
const blue = '#418fdf';
const cyan = '#76dce3';
const violet = '#a68aef';
const purple = '#655099';
const green = '#70d79c';

function Blocks({ blocks }: { blocks: readonly PixelBlock[] }) {
    return <>{blocks.map(([x, y, width, height, fill], index) => (
        <rect key={index} x={x} y={y} width={width} height={height} fill={fill} />
    ))}</>;
}

const glyphs: Record<string, readonly string[]> = {
    y: ['101', '101', '111', '001', '110'],
    x: ['000', '101', '010', '101', '000'],
    '=': ['000', '111', '000', '111', '000'],
    '2': ['110', '001', '010', '100', '111'],
};

function PixelEquation() {
    return <g fill={cream}>{[...'y=2x'].flatMap((glyph, letter) => (
        glyphs[glyph].flatMap((row, y) => [...row].flatMap((pixel, x) => (
            pixel === '1' ? <rect key={`${letter}-${x}-${y}`} x={22 + letter * 8 + x * 2} y={20 + y * 2} width={2} height={2} /> : []
        )))
    ))}</g>;
}

function Engineering() {
    return <>
        <Blocks blocks={[
            [12, 70, 72, 4, ink], [10, 62, 76, 6, steel], [10, 62, 76, 2, silver],
            [16, 68, 6, 6, navy], [74, 68, 6, 6, navy], [18, 56, 28, 6, ink],
            [22, 54, 20, 8, blue], [22, 54, 20, 2, cyan], [26, 58, 4, 2, cream],
            [26, 46, 12, 8, amber], [24, 44, 16, 12, ink], [26, 44, 12, 10, gold],
            [24, 46, 16, 6, gold], [28, 46, 8, 6, amber], [30, 46, 4, 4, cream],
            [32, 38, 12, 8, ink], [38, 32, 12, 10, ink], [42, 28, 10, 8, ink],
            [34, 38, 10, 6, amber], [38, 34, 10, 8, gold], [42, 30, 8, 8, gold],
            [36, 38, 4, 4, cream], [40, 34, 4, 4, cream],
            [44, 22, 16, 14, ink], [46, 22, 12, 14, amber], [44, 24, 16, 10, gold],
            [48, 24, 8, 8, amber], [50, 26, 4, 4, cream],
            [58, 24, 16, 10, ink], [58, 24, 16, 6, gold], [58, 24, 12, 2, cream],
            [70, 28, 10, 14, ink], [72, 30, 6, 10, steel], [72, 30, 6, 2, silver],
            [68, 40, 16, 6, ink], [68, 40, 16, 4, steel], [66, 44, 6, 10, silver],
            [80, 44, 6, 10, silver], [68, 52, 6, 4, steel], [78, 52, 6, 4, steel],
            [74, 48, 4, 8, cyan], [72, 50, 8, 4, blue],
            [12, 26, 4, 4, gold], [14, 22, 2, 12, gold], [10, 26, 10, 2, cream],
            [20, 18, 2, 4, cyan], [68, 58, 14, 2, amber], [74, 56, 4, 6, gold],
        ]} />
    </>;
}

function Plans() {
    return <Blocks blocks={[
        [16, 72, 64, 2, ink], [12, 12, 72, 48, ink], [14, 10, 68, 48, purple],
        [16, 10, 64, 2, violet], [14, 14, 2, 40, violet], [18, 16, 60, 36, ink],
        [18, 16, 60, 2, navy], [20, 18, 2, 2, violet], [24, 18, 2, 2, blue],
        [42, 22, 14, 10, purple], [42, 22, 14, 2, violet], [46, 26, 6, 2, cream],
        [48, 32, 2, 8, violet], [28, 38, 40, 2, violet], [28, 38, 2, 6, violet],
        [48, 38, 2, 6, violet], [66, 38, 2, 6, violet],
        [22, 44, 14, 8, blue], [22, 44, 14, 2, cyan], [26, 48, 6, 2, silver],
        [42, 44, 14, 8, amber], [42, 44, 14, 2, gold], [46, 48, 6, 2, cream],
        [62, 44, 12, 8, '#397763'], [62, 44, 12, 2, green], [66, 48, 4, 2, cream],
        [18, 54, 54, 2, '#4a3c73'], [74, 54, 4, 2, green], [40, 58, 16, 8, ink],
        [42, 58, 12, 8, purple], [42, 58, 12, 2, '#4a3c73'], [30, 66, 36, 4, purple],
        [30, 66, 36, 2, violet], [8, 30, 2, 8, violet], [4, 32, 10, 2, violet],
        [86, 20, 2, 6, gold], [84, 22, 6, 2, cream],
    ]} />;
}

function Blueprints() {
    return <>
        <Blocks blocks={[
            [20, 72, 58, 2, ink], [16, 12, 64, 58, ink], [18, 10, 60, 58, navy],
            [18, 10, 60, 2, steel], [22, 16, 52, 46, '#1d4264'],
            [22, 16, 52, 2, blue], [22, 16, 2, 46, blue],
            [30, 18, 2, 42, '#285374'], [42, 18, 2, 42, '#285374'],
            [54, 18, 2, 42, '#285374'], [66, 18, 2, 42, '#285374'],
            [24, 28, 48, 2, '#285374'], [24, 40, 48, 2, '#285374'], [24, 52, 48, 2, '#285374'],
            [38, 6, 20, 10, ink], [40, 6, 16, 10, steel], [40, 6, 16, 2, silver],
            [44, 8, 8, 4, navy],
        ]} />
        <g stroke={cyan} strokeWidth={2} fill="none" strokeLinejoin="miter">
            <path d="M 32 30 L 48 22 L 64 30 L 48 38 Z M 32 30 V 48 L 48 56 L 64 48 V 30 M 48 38 V 56" />
        </g>
        <Blocks blocks={[
            [46, 24, 4, 2, cream], [48, 26, 4, 2, cream], [52, 28, 4, 2, cream],
            [28, 32, 2, 18, blue], [26, 32, 6, 2, blue], [26, 48, 6, 2, blue],
            [32, 58, 32, 2, blue], [32, 56, 2, 6, blue], [62, 56, 2, 6, blue],
            [78, 32, 4, 26, amber], [78, 30, 4, 4, gold], [78, 56, 4, 4, gold],
            [78, 60, 4, 2, silver], [80, 62, 2, 2, ink], [8, 20, 4, 4, cyan],
            [10, 18, 2, 8, cyan], [6, 20, 10, 2, cream],
        ]} />
    </>;
}

function Ideas() {
    return <Blocks blocks={[
        [26, 72, 44, 2, ink], [22, 68, 52, 4, purple], [22, 66, 52, 2, violet],
        [28, 68, 6, 4, '#493761'], [62, 68, 6, 4, '#493761'],
        [36, 12, 24, 4, ink], [28, 16, 40, 4, ink], [24, 20, 48, 20, ink],
        [28, 40, 40, 8, ink], [34, 48, 28, 6, ink],
        [36, 14, 24, 4, gold], [30, 18, 36, 4, gold], [26, 22, 44, 16, gold],
        [30, 38, 36, 8, gold], [36, 46, 24, 6, gold],
        [30, 22, 6, 16, cream], [34, 18, 12, 4, cream], [30, 38, 6, 4, cream],
        [62, 22, 8, 16, amber], [56, 38, 10, 8, amber], [52, 46, 8, 6, amber],
        [38, 32, 4, 4, cream], [54, 32, 4, 4, cream], [40, 36, 4, 4, cream],
        [52, 36, 4, 4, cream], [44, 38, 8, 4, cream], [46, 42, 4, 12, cream],
        [36, 52, 24, 10, ink], [38, 52, 20, 4, silver], [38, 56, 20, 4, steel],
        [38, 58, 20, 2, silver], [42, 62, 12, 4, steel],
        [46, 2, 4, 6, gold], [10, 28, 8, 4, gold], [78, 28, 8, 4, gold],
        [18, 10, 4, 4, gold], [22, 14, 4, 4, gold], [74, 10, 4, 4, gold],
        [70, 14, 4, 4, gold], [16, 46, 4, 4, gold], [20, 42, 4, 4, gold],
        [76, 46, 4, 4, gold], [72, 42, 4, 4, gold],
    ]} />;
}

function Math() {
    return <>
        <Blocks blocks={[
            [18, 72, 60, 2, ink], [14, 10, 68, 54, ink], [16, 10, 64, 52, '#9c7147'],
            [16, 10, 64, 2, '#d2a46b'], [16, 12, 2, 48, '#d2a46b'],
            [20, 16, 56, 42, '#1e4b45'], [20, 16, 56, 2, '#153b38'],
            [26, 34, 2, 22, green], [26, 54, 42, 2, green], [24, 34, 6, 2, green],
            [64, 52, 2, 2, green], [64, 56, 2, 2, green],
            [32, 50, 4, 4, cream], [36, 46, 4, 4, cream], [40, 42, 4, 4, cream],
            [44, 38, 4, 4, cream], [48, 34, 4, 4, cream], [52, 30, 4, 4, cream],
            [34, 54, 2, 4, green], [42, 54, 2, 4, green], [50, 54, 2, 4, green],
            [58, 54, 2, 4, green], [26, 38, 4, 2, green], [26, 46, 4, 2, green],
            [62, 20, 8, 2, '#3e7760'], [64, 18, 4, 6, '#3e7760'],
            [12, 62, 72, 4, '#9c7147'], [12, 62, 72, 2, '#d2a46b'],
            [20, 66, 6, 8, '#714e38'], [70, 66, 6, 8, '#714e38'],
            [58, 60, 10, 2, silver], [34, 60, 8, 2, cream],
            [6, 24, 4, 4, green], [8, 20, 2, 12, green], [4, 24, 10, 2, cream],
        ]} />
        <PixelEquation />
    </>;
}

function Robot() {
    return <>
        <rect x={26} y={74} width={44} height={2} fill={ink} />
        <g className="pixel-robot-legs">
            <Blocks blocks={[
                [34, 60, 10, 10, ink], [52, 60, 10, 10, ink],
                [36, 60, 6, 8, steel], [54, 60, 6, 8, steel],
                [32, 68, 14, 6, ink], [50, 68, 14, 6, ink],
                [32, 68, 12, 4, blue], [52, 68, 12, 4, blue],
                [32, 68, 12, 2, cyan], [52, 68, 12, 2, cyan],
            ]} />
        </g>
        <g className="pixel-robot-body">
            <Blocks blocks={[
                [32, 40, 32, 24, ink], [34, 42, 28, 20, blue], [34, 42, 28, 2, cyan],
                [56, 46, 6, 16, '#2d66ac'], [40, 48, 16, 10, navy],
                [42, 50, 4, 4, green], [50, 50, 4, 2, silver], [50, 54, 4, 2, silver],
                [34, 58, 22, 4, '#2d66ac'], [38, 60, 4, 2, gold],
                [24, 44, 10, 16, ink], [24, 44, 8, 12, steel], [24, 44, 8, 2, silver],
                [22, 54, 10, 8, ink], [22, 54, 8, 6, gold], [24, 56, 4, 2, amber],
                [64, 44, 10, 10, ink], [64, 44, 8, 8, steel], [64, 44, 8, 2, silver],
                [70, 38, 8, 14, ink], [70, 38, 6, 12, steel],
                [70, 34, 10, 8, ink], [70, 34, 8, 6, gold], [72, 36, 4, 2, cream],
                [74, 22, 4, 14, steel], [70, 20, 12, 4, silver], [70, 16, 4, 6, silver],
                [78, 16, 4, 6, silver], [44, 36, 8, 8, steel],
                [28, 14, 40, 24, ink], [30, 14, 36, 22, blue], [30, 14, 36, 2, cyan],
                [34, 20, 28, 12, ink], [34, 20, 28, 2, navy],
                [38, 24, 6, 6, cyan], [52, 24, 6, 6, cyan],
                [38, 24, 4, 2, cream], [52, 24, 4, 2, cream],
                [44, 34, 8, 2, silver], [24, 22, 6, 8, steel], [66, 22, 6, 8, steel],
                [34, 4, 28, 4, ink], [30, 8, 36, 8, ink],
                [34, 6, 28, 4, gold], [32, 10, 32, 6, gold], [34, 10, 6, 6, cream],
                [46, 4, 6, 12, amber], [46, 4, 4, 12, cream],
                [26, 16, 44, 4, amber], [26, 14, 44, 4, gold], [28, 14, 38, 2, cream],
            ]} />
        </g>
    </>;
}

const sprites = { engineering: Engineering, plans: Plans, blueprints: Blueprints, ideas: Ideas, math: Math, robot: Robot };

export function WorkshopSprite({ kind, className }: { kind: WorkshopSpriteKind; className?: string }) {
    const Sprite = sprites[kind];
    return <svg aria-hidden="true" focusable="false" viewBox="0 0 96 80" shapeRendering="crispEdges" className={className}>
        <Sprite />
    </svg>;
}
