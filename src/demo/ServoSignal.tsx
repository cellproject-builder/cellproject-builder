import { useId } from 'react';

function CircuitBlock({ x, y, number, title, detail, accent = '#80daca' }: { x: number; y: number; number: string; title: string; detail: string; accent?: string }) {
  return <g transform={`translate(${x} ${y})`}>
    <rect width="142" height="83" rx="9" fill="#13242d" stroke="#37525d"/>
    <path d="M12 0H130" stroke={accent} strokeWidth="2"/>
    <text x="13" y="23" fontSize="10" letterSpacing="2" fill={accent}>{number}</text>
    <text x="13" y="45" fontSize="14" fill="#e8f3f2" fontWeight="600">{title}</text>
    <text x="13" y="65" fontSize="11" fill="#9bb1bc">{detail}</text>
  </g>;
}

export function ServoSignal({ angle, english }: { angle: number; english: boolean }) {
  const id = useId().replaceAll(':', '');
  const pulse = 1 + angle / 180;
  const pw = pulse * 30;
  const wave = `M54 469V412H${54 + pw}V469H654`;
  return <svg viewBox="0 0 760 540" className="servo-signal-svg" role="img" aria-label={english ? 'Conceptual servo feedback circuit and PWM waveform' : 'Circuito conceitual de realimentação e forma de onda PWM'}>
    <defs>
      <marker id={`${id}-arrow`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="m1 1 8 4-8 4" fill="none" stroke="#80daca" strokeWidth="1.5"/></marker>
      <pattern id={`${id}-grid`} width="30" height="24" patternUnits="userSpaceOnUse"><path d="M30 0H0V24" fill="none" stroke="#426170" strokeOpacity=".23"/></pattern>
      <linearGradient id={`${id}-scope`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#80daca" stopOpacity=".08"/><stop offset="1" stopColor="#80daca" stopOpacity="0"/></linearGradient>
    </defs>
    <g fill="#92aab7" fontSize="10" letterSpacing="2"><text x="36" y="36">{english ? 'FROM INTENT TO MOVEMENT' : 'DA INTENÇÃO AO MOVIMENTO'}</text><text x="36" y="58" letterSpacing="0" fontSize="12">{english ? 'An idealised control loop. Every connection has a role.' : 'Uma malha de controle idealizada. Cada conexão tem um papel.'}</text></g>
    <g fill="none" stroke="#80daca" strokeWidth="1.5" markerEnd={`url(#${id}-arrow)`}>
      <path className="servo-signal-line" d="M178 137H236"/>
      <path className="servo-signal-line" d="M276 137H321"/>
      <path className="servo-signal-line" d="M463 137H538"/>
      <path className="servo-signal-line" d="M609 178V229"/>
      <path className="servo-signal-line" d="M537 274H394"/>
      <path className="servo-signal-line" d="M251 274H256V157"/>
    </g>
    <CircuitBlock x={36} y={95} number="01 / INPUT" title={english ? 'Command' : 'Comando'} detail={`${angle}° / ${pulse.toFixed(2)} ms`}/>
    <circle cx="256" cy="137" r="20" fill="#122932" stroke="#80daca"/>
    <path d="M249 137H263M256 130V144" stroke="#e1f4ee" strokeWidth="1.5"/>
    <text x="242" y="188" fill="#9fb9c1" fontSize="11">{english ? 'error' : 'erro'}</text>
    <CircuitBlock x={321} y={95} number="02 / CONTROL" title={english ? 'Controller' : 'Controlador'} detail={english ? 'Compare & correct' : 'Comparar e corrigir'}/>
    <CircuitBlock x={538} y={95} number="03 / ACTUATION" title={english ? 'Motor + gears' : 'Motor + redução'} detail={english ? 'Electrical → mechanical' : 'Elétrico → mecânico'} accent="#f3ce8b"/>
    <CircuitBlock x={251} y={233} number="05 / FEEDBACK" title={english ? 'Position sensor' : 'Sensor de posição'} detail={english ? 'Measured angle returns' : 'O ângulo medido retorna'}/>
    <g transform="translate(609 274)">
      <circle r="42" fill="#13242d" stroke="#37525d"/>
      <circle r="29" fill="none" stroke="#496671" strokeDasharray="2 5"/>
      <path d="M-30 0H30M0-30V30" stroke="#37525d"/>
      <g transform={`rotate(${angle - 90})`}><path d="M0 0H31" stroke="#f3ce8b" strokeWidth="5" strokeLinecap="round"/><circle cx="31" r="4" fill="#ffdfa5"/></g>
      <circle r="7" fill="#a3e6d9"/>
      <text y="65" textAnchor="middle" fill="#9fb9c1" fontSize="11">{english ? '04 / IDEAL OUTPUT' : '04 / SAÍDA IDEAL'}</text>
    </g>
    <text x="431" y="263" fontSize="10" fill="#a5b8c4">{english ? 'position' : 'posição'}</text>
    <text x="200" y="229" fontSize="10" fill="#80daca">−</text>
    <g transform="translate(36 368)"><rect width="688" height="132" rx="8" fill="#0b1920" stroke="#2d4653"/><rect width="688" height="132" rx="8" fill={`url(#${id}-grid)`}/><rect width="688" height="132" rx="8" fill={`url(#${id}-scope)`}/></g>
    <text x="51" y="390" fill="#a6c7cd" fontSize="10" letterSpacing="1.5">PWM / {english ? 'CONCEPTUAL OSCILLOSCOPE' : 'OSCILOSCÓPIO CONCEITUAL'}</text>
    <text data-pulse-width x="698" y="390" textAnchor="end" fill="#e0f8ef" fontSize="12">{pulse.toFixed(2)} ms</text>
    <path d="M54 469H704" stroke="#426170" strokeWidth="1"/>
    <path d={wave} data-pwm-wave fill="none" stroke="#a5f0da" strokeWidth="2.5" strokeLinejoin="round"/>
    <path d={`M54 400V407M${54 + pw} 400V407M54 403H${54 + pw}`} fill="none" stroke="#f3ce8b" strokeWidth="1"/>
    <path d="M654 469V412H699" fill="none" stroke="#a5f0da" strokeWidth="2.5"/>
    <g fill="#819eac" fontSize="10"><text x="54" y="488">0</text><text x="204" y="488">5</text><text x="354" y="488">10</text><text x="504" y="488">15</text><text x="654" y="488">20 ms</text></g>
    <text x="36" y="523" fill="#819eac" fontSize="10">{english ? 'Illustrative mapping: 1–2 ms → 0–180°. Calibrate for the real servo.' : 'Mapeamento ilustrativo: 1–2 ms → 0–180°. Calibrar para o servo real.'}</text>
  </svg>;
}
