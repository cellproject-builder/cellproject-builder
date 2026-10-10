/** Small, transparent pixel props. Their shared three-tone palette is set by the scene. */
export function WorkshopSceneProps() {
    return <>
        <div className="ws-scene-starlight">
            {[[8, 10], [19, 23], [30, 7], [43, 18], [57, 8], [67, 25], [78, 12], [91, 30]].map(([x, y], index) =>
                <span key={index} className={`ws-scene-star${index % 3 === 0 ? ' is-spark' : ''}`} style={{ left: `${x}%`, top: y }} />)}
        </div>
        <div className="ws-scene-ground" />
        {[15, 48, 82].map(left => <span key={left} className="ws-scene-ground-mark" style={{ left: `${left}%` }} />)}
        <svg className="ws-scene-cloud ws-scene-cloud-a" viewBox="0 0 64 20" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
            <path className="ws-drift-ink-b" d="M3 14h6v-5h8V4h12V1h12v4h8v5h8v4h4v5H3z" />
            <path className="ws-drift-ink-a" d="M17 8V4h12V1h12v3H30v3H20v3h-6V8z" />
        </svg>
        <svg className="ws-scene-cloud ws-scene-cloud-b" viewBox="0 0 64 20" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
            <path className="ws-drift-ink-b" d="M5 14h7v-4h9V5h11V2h10v4h8v7h9v6H5z" />
            <path className="ws-drift-ink-a" d="M21 9V5h11V2h10v3h-9v3h-9v3h-8V9z" />
        </svg>
        <svg className="ws-scene-desk" viewBox="0 0 112 64" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
            <g className="ws-drift-ink-a">
                <rect x="6" y="31" width="100" height="6" />
                <rect x="12" y="37" width="6" height="25" />
                <rect x="92" y="37" width="6" height="25" />
                <rect x="18" y="53" width="74" height="3" />
                <rect x="72" y="38" width="20" height="12" />
                <rect x="10" y="60" width="12" height="3" />
                <rect x="88" y="60" width="14" height="3" />
            </g>
            <g className="ws-drift-ink-b">
                <rect x="6" y="31" width="100" height="2" />
                <rect x="14" y="38" width="2" height="20" />
                <rect x="80" y="43" width="5" height="2" />
                <rect x="23" y="27" width="30" height="3" />
                <rect x="27" y="23" width="28" height="4" />
                <rect x="31" y="20" width="23" height="3" />
                <rect x="65" y="19" width="11" height="12" />
                <rect x="76" y="21" width="5" height="2" />
                <rect x="79" y="23" width="2" height="5" />
                <rect x="76" y="28" width="5" height="2" />
            </g>
            <g className="ws-drift-ink-c">
                <rect x="34" y="20" width="18" height="2" />
                <rect x="29" y="25" width="18" height="1" />
                <rect x="66" y="19" width="9" height="2" />
                <rect x="68" y="14" width="2" height="3" />
                <rect x="71" y="10" width="2" height="3" />
            </g>
        </svg>

        <svg className="ws-scene-bench" viewBox="0 0 112 80" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
            <g className="ws-drift-ink-a">
                <rect x="6" y="44" width="100" height="4" />
                <rect x="12" y="48" width="6" height="30" />
                <rect x="94" y="48" width="6" height="30" />
                <rect x="10" y="78" width="12" height="2" />
                <rect x="90" y="78" width="14" height="2" />
                <rect x="18" y="65" width="76" height="3" />
            </g>
            <g className="ws-drift-ink-b">
                <rect x="6" y="44" width="100" height="2" />
                <rect x="14" y="49" width="2" height="25" />
                <rect x="18" y="51" width="14" height="9" />
                <rect x="18" y="41" width="8" height="3" />
                <rect x="73" y="40" width="17" height="3" />
                <rect x="88" y="37" width="3" height="3" />
                <rect x="91" y="38" width="3" height="2" />
            </g>
            <g className="ws-drift-ink-c">
                <rect x="22" y="54" width="5" height="2" />
                <rect x="19" y="39" width="5" height="2" />
                <rect x="68" y="41" width="3" height="2" />
                <rect x="94" y="41" width="3" height="2" />
                <rect x="75" y="40" width="9" height="1" />
            </g>
            <g className="ws-scene-robot-base">
                <g className="ws-drift-ink-a">
                    <rect x="38" y="26" width="16" height="12" />
                    <rect x="39" y="38" width="5" height="6" />
                    <rect x="49" y="38" width="5" height="6" />
                </g>
                <g className="ws-drift-ink-b">
                    <rect x="41" y="29" width="10" height="6" />
                    <rect x="36" y="42" width="8" height="2" />
                    <rect x="49" y="42" width="8" height="2" />
                    <rect x="43" y="24" width="6" height="2" />
                </g>
                <g className="ws-drift-ink-c">
                    <rect x="40" y="26" width="12" height="2" />
                    <rect x="43" y="31" width="2" height="2" />
                    <rect x="47" y="31" width="2" height="2" />
                </g>
            </g>
            <g className="ws-scene-robot-finish">
                <g className="ws-drift-ink-a">
                    <rect x="38" y="15" width="16" height="9" />
                    <rect x="35" y="18" width="3" height="4" />
                    <rect x="54" y="18" width="3" height="4" />
                    <rect x="32" y="28" width="6" height="5" />
                    <rect x="29" y="32" width="4" height="7" />
                    <rect x="54" y="28" width="7" height="5" />
                    <rect x="60" y="32" width="4" height="7" />
                    <rect x="45" y="12" width="2" height="3" />
                </g>
                <g className="ws-drift-ink-b">
                    <rect x="40" y="18" width="12" height="4" />
                    <rect x="32" y="30" width="3" height="3" />
                    <rect x="57" y="30" width="3" height="3" />
                    <rect x="44" y="10" width="4" height="2" />
                </g>
                <g className="ws-drift-ink-c">
                    <rect x="40" y="15" width="12" height="2" />
                    <rect x="42" y="19" width="2" height="2" />
                    <rect x="48" y="19" width="2" height="2" />
                    <rect x="27" y="38" width="6" height="3" />
                    <rect x="59" y="38" width="6" height="3" />
                </g>
            </g>
            <g className="ws-scene-sparks ws-drift-ink-c">
                <rect x="29" y="14" width="2" height="3" />
                <rect x="33" y="9" width="3" height="2" />
                <rect x="26" y="21" width="3" height="2" />
            </g>
        </svg>

        <svg className="ws-scene-board" viewBox="0 0 100 92" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
            <g className="ws-drift-ink-a">
                <rect x="11" y="8" width="78" height="4" />
                <rect x="11" y="12" width="4" height="49" />
                <rect x="85" y="12" width="4" height="49" />
                <rect x="11" y="61" width="78" height="4" />
                <rect x="7" y="65" width="86" height="3" />
                <path d="M25 68h6v8h-3v8h-3v7h-7v-4h3v-9h3v-10zm44 0h6v10h3v9h3v4h-7v-7h-3v-8h-2z" />
                <rect x="29" y="82" width="42" height="3" />
            </g>
            <g className="ws-drift-ink-b">
                <rect x="15" y="8" width="70" height="2" />
                <rect x="11" y="12" width="2" height="47" />
                <rect x="50" y="3" width="4" height="5" />
                <rect x="65" y="63" width="13" height="3" />
            </g>
            <g className="ws-scene-chalk ws-drift-ink-c">
                <rect x="24" y="22" width="18" height="2" />
                <rect x="24" y="27" width="27" height="2" />
                <rect x="24" y="32" width="12" height="2" />
                <rect x="40" y="32" width="7" height="2" />
                <path d="M57 27h8v3h6v8h-3v6h-10v-3h-5v-8h4zm2 3v3h-3v6h4v2h6v-5h2v-4h-5v-2z" fillRule="evenodd" />
                <rect x="25" y="43" width="2" height="9" />
                <rect x="27" y="50" width="19" height="2" />
                <rect x="29" y="46" width="5" height="2" />
                <rect x="34" y="42" width="5" height="2" />
                <rect x="39" y="38" width="6" height="2" />
                <rect x="55" y="51" width="16" height="2" />
            </g>
        </svg>

        <svg className="ws-scene-telescope" viewBox="0 0 80 100" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
            <g className="ws-drift-ink-a">
                <path d="M20 43h7v-7h8v-7h8v-7h9v-7h8v3h7v8h-7v7h-8v7h-8v7h-8v7H25v-5h-5z" />
                <rect x="12" y="45" width="10" height="6" />
                <rect x="8" y="44" width="4" height="8" />
                <rect x="38" y="48" width="10" height="12" />
                <rect x="34" y="59" width="18" height="5" />
                <rect x="41" y="64" width="4" height="30" />
                <path d="M35 64h5v8h-4v8h-4v8h-4v8H18v-3h6v-8h4v-8h4v-8h3zm11 0h5v5h3v8h4v8h4v8h6v3H58v-8h-4v-8h-4v-8h-4z" />
            </g>
            <g className="ws-drift-ink-b">
                <path d="M25 42h6v-6h8v-7h8v-7h9v-3h4v5h-8v7h-8v7h-8v7H25z" />
                <path d="M58 13h5v4h4v4h4v6h-5v-4h-4v-4h-4z" />
                <rect x="40" y="50" width="3" height="8" />
                <rect x="41" y="94" width="4" height="3" />
            </g>
            <g className="ws-drift-ink-c">
                <rect x="60" y="14" width="3" height="3" />
                <rect x="64" y="18" width="3" height="3" />
                <rect x="68" y="22" width="3" height="3" />
                <rect x="8" y="45" width="2" height="6" />
                <rect x="44" y="54" width="5" height="3" />
            </g>
        </svg>

        <svg className="ws-scene-sky" viewBox="0 0 160 100" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
            <g className="ws-drift-ink-b">
                <path d="M126 8h13v3h-11v3h-6v4h-4v6h-3v12h3v6h4v4h6v3h11v3h-13v-3h-7v-4h-5v-5h-3v-20h3v-5h5v-4h7z" />
            </g>
            <g className="ws-scene-star ws-drift-ink-c">
                <rect x="88" y="41" width="2" height="8" />
                <rect x="85" y="44" width="8" height="2" />
            </g>
        </svg>
    </>;
}
