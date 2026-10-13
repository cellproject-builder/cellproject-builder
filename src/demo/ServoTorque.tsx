import { useId } from 'react';
import { servoScenario, type ServoScenario } from './servoMath';

export function ServoTorque({ scenario, english }: { scenario: ServoScenario; english: boolean }) {
  const id = useId().replaceAll(':', '');
  const { mass, reach, angle, reference } = scenario;
  const result = servoScenario(scenario);
  const radians = angle * Math.PI / 180;
  const length = reach * 7;
  const x = 185 + Math.cos(radians) * length, y = 290 - Math.sin(radians) * length;
  const curve = Array.from({ length: 31 }, (_, r) => `${r ? 'L' : 'M'}${470 + r * 7.2} ${340 - servoScenario({ ...scenario, reach: r }).torque / 1.2 * 210}`).join(' ');
  const referenceY = 340 - reference / 1.2 * 210;
  const color = result.exceedsReference ? '#efb47d' : '#96e3cd';
  return <svg viewBox="0 0 760 540" className="servo-torque-svg" role="img" aria-label={english ? 'Arm load investigation and torque versus reach graph' : 'Investigação de carga no braço e gráfico de torque por alcance'}>
    <defs>
      <pattern id={`${id}-grid`} width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="#4d6b7b" strokeOpacity=".18"/></pattern>
      <linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1"><stop stopColor={color} stopOpacity=".28"/><stop offset="1" stopColor={color} stopOpacity=".01"/></linearGradient>
      <marker id={`${id}-arrow`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="m1 1 7 4-7 4Z" fill="#f3ce8b"/></marker>
    </defs>
    <g fill="#92aab7" fontSize="10" letterSpacing="2"><text x="36" y="36">{english ? 'A PREMISE YOU CAN EXPLORE' : 'UMA PREMISSA QUE VOCÊ PODE EXPLORAR'}</text></g>
    <text x="36" y="65" fill="#e4efed" fontSize="18">{english ? 'The same load. A different moment.' : 'A mesma carga. Outro esforço.'}</text>
    <rect x="36" y="90" width="377" height="280" fill={`url(#${id}-grid)`}/>
    <path d="M54 343H412" stroke="#3d5969"/>
    <path d="M185 290H410" stroke="#456777" strokeDasharray="4 5"/>
    <ellipse cx="185" cy="342" rx="76" ry="12" fill="#000" opacity=".2"/>
    <path d="M153 339V292L185 277 217 292V339Z" fill="#253d53" stroke="#5d7e94"/>
    <path d="M185 277V337M153 292 185 309 217 292" fill="none" stroke="#607c8e"/>
    <path d={`M185 290L${x} ${y}`} stroke="#355364" strokeWidth="24" strokeLinecap="round"/>
    <path d={`M185 290L${x} ${y}`} stroke="#92c4c8" strokeWidth="12" strokeLinecap="round"/>
    <path d={`M185 287L${x} ${y - 3}`} stroke="#d2e6dd" strokeWidth="2" strokeLinecap="round"/>
    <circle cx="185" cy="290" r="22" fill="#192f3f" stroke="#b1d6d2" strokeWidth="2"/>
    <circle cx="185" cy="290" r="11" fill="#668e98"/><path d="M180 290H190M185 285V295" stroke="#d4e9e1"/>
    <path d={`M${x} ${y}V${y + 26}`} stroke="#a4babd" strokeWidth="2"/>
    <rect x={x - 17} y={y + 26} width="34" height="31" rx="5" fill="#cfa36c" stroke="#ffe0a1"/>
    <path d={`M${x - 10} ${y + 30}H${x + 10}`} stroke="#f4d5a0"/>
    <path d={`M${x} ${y + 64}v34`} stroke="#f3ce8b" strokeWidth="1.5" markerEnd={`url(#${id}-arrow)`}/>
    <text x={Math.min(x + 24, 376)} y={y + 46} fill="#f3ce8b" fontSize="12">{mass} g</text>
    <path d={`M185 355V363M${x} 355V363M185 360H${x}`} stroke="#8eb8c1" strokeWidth="1"/>
    <text x="226" y="384" fill="#97b7c0" fontSize="11" textAnchor="middle">{english ? 'Horizontal projection' : 'Projeção horizontal'} / {(reach * Math.cos(radians)).toFixed(1)} cm</text>
    <text x="71" y="127" fill="#92aab7" fontSize="11">θ = {angle}°</text>
    {angle > 0 && <path data-inclination-arc d={`M212 290A27 27 0 0 0 ${185 + 27 * Math.cos(radians)} ${290 - 27 * Math.sin(radians)}`} fill="none" stroke="#86baad" strokeDasharray="3 3"/>}
    <g fill="#98b2be" fontSize="10"><text x="470" y="108">{english ? 'TORQUE × REACH' : 'TORQUE × ALCANCE'}</text><text x="470" y="126">N·m</text></g>
    <rect x="470" y="130" width="216" height="210" fill={`url(#${id}-grid)`}/>
    <rect x="470" y="130" width="216" height={Math.max(0, referenceY - 130)} fill="#eab37d" opacity=".045"/>
    {[0, .3, .6, .9, 1.2].map(v => <g key={v}><path d={`M470 ${340 - v / 1.2 * 210}H686`} stroke="#4a6875" strokeOpacity=".35"/><text x="458" y={344 - v / 1.2 * 210} fill="#8da5b3" fontSize="10" textAnchor="end">{v.toFixed(1)}</text></g>)}
    <path d={`${curve}L686 340H470Z`} fill={`url(#${id}-area)`}/>
    <path d={curve} fill="none" stroke={color} strokeWidth="2.5"/>
    <path d={`M470 ${referenceY}H686`} stroke="#f3ce8b" strokeDasharray="4 4"/>
    <text x="686" y={referenceY - 9} textAnchor="end" fill="#f3ce8b" fontSize="10">{english ? 'Scenario reference' : 'Referência do cenário'}</text>
    <path d={`M${470 + reach * 7.2} 340V${340 - result.torque / 1.2 * 210}`} stroke={color} strokeDasharray="3 4"/>
    <circle cx={470 + reach * 7.2} cy={340 - result.torque / 1.2 * 210} r="6" fill="#0c1d25" stroke={color} strokeWidth="2"/>
    {[0, 10, 20, 30].map(r => <text key={r} x={470 + r * 7.2} y="357" fill="#8da5b3" fontSize="10" textAnchor="middle">{r}</text>)}
    <text x="686" y="378" fill="#8da5b3" fontSize="10" textAnchor="end">{english ? 'Reach (cm)' : 'Alcance (cm)'}</text>
    <rect x="36" y="418" width="688" height="78" rx="8" fill="#142630" stroke="#334c59"/>
    <text x="54" y="443" fill="#9bb5bf" fontSize="10" letterSpacing="1.5">{english ? 'STATIC MODEL' : 'MODELO ESTÁTICO'}</text>
    <text x="54" y="475" fill="#e3efeb" fontSize="23">τ = m · g · r · cos(θ)</text>
    <text x="703" y="443" fill="#9bb5bf" textAnchor="end" fontSize="10">{english ? 'ESTIMATED MOMENT' : 'MOMENTO ESTIMADO'}</text>
    <text data-torque-result x="703" y="478" fill={color} textAnchor="end" fontSize="30" fontWeight="500">{result.torque.toFixed(3)} <tspan fontSize="14">N·m</tspan></text>
    <text x="36" y="523" fill="#819eac" fontSize="10">{english ? 'Arm mass, friction and acceleration not included. No physical validation.' : 'Massa do braço, atrito e aceleração não incluídos. Sem validação física.'}</text>
  </svg>;
}
