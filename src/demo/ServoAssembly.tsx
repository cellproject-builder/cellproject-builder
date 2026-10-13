import { useId, type ReactNode } from 'react';

export const servoParts = [
  { id: 'horn', pt: 'Braço de saída', en: 'Output horn', tag: '01', color: '#e9eef2', question: ['Como o alcance altera o esforço?', 'How does reach change the load?'], description: ['Conecta o eixo à carga. A distância até a peça muda o momento exigido do servo.', 'Connects the shaft to the load. Distance to the object changes the required moment.'] },
  { id: 'cover', pt: 'Tampa e eixo', en: 'Cover & shaft', tag: '02', color: '#86abcf', question: ['Onde aparecem folgas e atrito?', 'Where do play and friction appear?'], description: ['Apoia e protege a saída. Encaixes, alinhamento e folgas precisam ser conferidos na peça real.', 'Supports and protects the output. Fit, alignment and play need checking on the real part.'] },
  { id: 'gears', pt: 'Trem de engrenagens', en: 'Gear train', tag: '03', color: '#f6cb78', question: ['O que se ganha ao reduzir a velocidade?', 'What do we gain by reducing speed?'], description: ['Representa a redução mecânica: troca velocidade por torque. A geometria e a relação desenhadas são ilustrativas.', 'Represents mechanical reduction: trades speed for torque. The drawn geometry and ratio are illustrative.'] },
  { id: 'motor', pt: 'Motor DC', en: 'DC motor', tag: '04', color: '#79dfd0', question: ['Como o comando vira movimento?', 'How does a command become motion?'], description: ['Converte energia elétrica em rotação. Corrente, aquecimento e resposta sob carga exigem observação física.', 'Converts electrical energy into rotation. Current, heat and response under load require physical observation.'] },
  { id: 'case', pt: 'Carcaça e fixação', en: 'Housing & mount', tag: '05', color: '#88a9d9', question: ['A fixação suporta a reação da carga?', 'Can the mount withstand the load reaction?'], description: ['Mantém o conjunto alinhado e transfere a reação para o suporte. Este desenho não fornece cotas para fabricação.', 'Keeps the assembly aligned and transfers reaction to the mount. This drawing provides no manufacturing dimensions.'] },
  { id: 'board', pt: 'Controle e realimentação', en: 'Control & feedback', tag: '06', color: '#a9d782', question: ['Como o servo percebe a posição?', 'How does the servo sense its position?'], description: ['Circuito e sensor de posição formam uma malha de controle. A placa simplificada não é um esquema elétrico de montagem.', 'Circuit and position sensor form a control loop. The simplified board is not a wiring schematic.'] },
] as const;
export type ServoPartId = typeof servoParts[number]['id'];

function Box({ x = 0, y = 0, w, d, h, top, side, front }: { x?: number; y?: number; w: number; d: number; h: number; top: string; side: string; front: string }) {
  return <g transform={`translate(${x} ${y})`} stroke="#cce7ff" strokeOpacity=".23" strokeWidth=".8" strokeLinejoin="round">
    <path d={`M0 ${d / 2} ${w / 2} 0 V${h} L0 ${h + d / 2}Z`} fill={side}/>
    <path d={`M${-w / 2} 0 0 ${d / 2} V${h + d / 2} L${-w / 2} ${h}Z`} fill={front}/>
    <path d={`M0 ${-d / 2} ${w / 2} 0 0 ${d / 2} ${-w / 2} 0Z`} fill={top}/>
  </g>;
}

function Gear({ x, y, radius, teeth, rotation = 0, gold = true }: { x: number; y: number; radius: number; teeth: number; rotation?: number; gold?: boolean }) {
  const points = Array.from({ length: teeth * 4 }, (_, i) => {
    const angle = i / (teeth * 4) * Math.PI * 2;
    const r = radius * (i % 4 < 2 ? 1 : .85);
    return `${Math.cos(angle) * r},${Math.sin(angle) * r}`;
  }).join(' ');
  return <g transform={`translate(${x} ${y}) scale(1 .55)`}>
    <g transform={`rotate(${rotation})`}>
      <polygon points={points} transform="translate(0 9)" fill={gold ? '#795625' : '#3c7a78'}/>
      <polygon points={points} fill={gold ? '#dcb467' : '#80d6cb'} stroke={gold ? '#ffe2a3' : '#b9fff2'} strokeWidth="1.4"/>
      <circle r={radius * .65} fill="none" stroke={gold ? '#a27b38' : '#4c9990'} strokeWidth="3"/>
      {[0, 120, 240].map(a => <circle key={a} cx={Math.cos(a * Math.PI / 180) * radius * .42} cy={Math.sin(a * Math.PI / 180) * radius * .42} r={radius * .13} fill="#0c1e24"/>) }
      <circle r={radius * .19} fill="#162a33" stroke="#fff0bd" strokeWidth="2"/>
    </g>
  </g>;
}

export function ServoAssembly({ spread, angle, selected, onSelect, english = false, compact = false }: {
  spread: number; angle: number; selected: ServoPartId; onSelect: (id: ServoPartId) => void; english?: boolean; compact?: boolean;
}) {
  const id = useId().replaceAll(':', '');
  const e = spread / 100;
  const positions: Record<ServoPartId, [number, number]> = {
    board: [335, 346 + e * 105], case: [335, 280 + e * 48], motor: [320 - e * 48, 264 - e * 21],
    gears: [335 + e * 12, 245 - e * 92], cover: [335, 222 - e * 126], horn: [335, 205 - e * 167],
  };
  const layer = (part: ServoPartId, children: ReactNode) => {
    const data = servoParts.find(item => item.id === part)!;
    return <g key={part} data-servo-part={part} transform={`translate(${positions[part].join(' ')})`} className={`servo-piece${selected === part ? ' is-selected' : ''}`}
      role={compact ? undefined : 'button'} tabIndex={compact ? undefined : 0} aria-label={compact ? undefined : english ? data.en : data.pt} aria-pressed={compact ? undefined : selected === part}
      onClick={compact ? undefined : () => onSelect(part)} onKeyDown={compact ? undefined : event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(part); } }}>
      <ellipse className="servo-piece-halo" cx="0" cy="12" rx="112" ry="43" fill="none" stroke={data.color} strokeDasharray="3 5" strokeWidth="1.5"/>
      {children}
    </g>;
  };
  return <svg viewBox="0 0 760 540" className="servo-assembly-svg" aria-label={english ? 'Interactive exploded servo illustration' : 'Ilustração interativa do servo em vista explodida'} role={compact ? 'img' : 'group'}>
    <defs>
      <pattern id={`${id}-grid`} width="36" height="36" patternUnits="userSpaceOnUse" patternTransform="matrix(1 .38 -1 .38 345 340)"><path d="M36 0H0V36" fill="none" stroke="#7194ad" strokeOpacity=".14" strokeWidth=".8"/></pattern>
      <linearGradient id={`${id}-case`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#344c69"/><stop offset="1" stopColor="#142337"/></linearGradient>
      <linearGradient id={`${id}-metal`}><stop stopColor="#83a5b3"/><stop offset=".4" stopColor="#e0f2ed"/><stop offset=".7" stopColor="#9cbbbc"/><stop offset="1" stopColor="#456776"/></linearGradient>
      <radialGradient id={`${id}-light`}><stop stopColor="#3d837b" stopOpacity=".18"/><stop offset="1" stopColor="#0b151e" stopOpacity="0"/></radialGradient>
      <filter id={`${id}-shadow`} x="-70%" y="-50%" width="240%" height="250%"><feGaussianBlur stdDeviation="14"/></filter>
    </defs>
    <rect width="760" height="540" fill={`url(#${id}-light)`}/>
    <rect x="70" y="250" width="630" height="290" fill={`url(#${id}-grid)`}/>
    <ellipse cx="340" cy="467" rx="132" ry="30" fill="#000" opacity=".45" filter={`url(#${id}-shadow)`}/>
    <g fill="none" stroke="#7b9aaa" strokeOpacity=".36" strokeDasharray="4 6"><path d="M335 20V474"/><path d="M260 72V427M414 72V427" opacity={e}/></g>
    {layer('board', <>
      <Box w={161} d={76} h={7} top="#245747" side="#14352e" front="#163e35"/>
      <g transform="matrix(.95 .42 -.95 .42 0 -9)">
        {[[-51, -19], [50, -19], [50, 19], [-51, 19]].map(([x, y]) => <circle key={`${x},${y}`} cx={x} cy={y} r="5" fill="#091d1c" stroke="#d0b47a" strokeWidth="2"/>)}
        <path d="M-48-5H-18V13H20M-45 8H-28V-12H10V10H47M-15-25V-14H33V2H56M-4 26V15H43" fill="none" stroke="#99c180" strokeWidth="2"/>
        <rect x="-18" y="-13" width="29" height="24" rx="2" fill="#102729" stroke="#86ae95"/>
        {Array.from({ length: 5 }, (_, i) => <path key={i} d={`M${-14 + i * 5}-18V-13M${-14 + i * 5} 11v6`} stroke="#dbd7a3" strokeWidth="2"/>)}
        <circle cx="31" cy="-8" r="10" fill="#d1aa63" stroke="#f5d894"/><circle cx="31" cy="-8" r="4" fill="#43533c"/>
        <rect x="-54" y="11" width="12" height="10" fill="#bcad83"/>
      </g>
      <path d="M-66 22C-126 30-128 70-181 60M-66 27C-120 38-131 76-181 65M-66 32C-119 47-135 83-181 70" fill="none" stroke="#cc945c" strokeWidth="3"/>
      <path d="M-66 27C-120 38-131 76-181 65" fill="none" stroke="#bd665c" strokeWidth="3"/>
      <path d="M-66 32C-119 47-135 83-181 70" fill="none" stroke="#ead396" strokeWidth="3"/>
      <rect x="-196" y="55" width="19" height="22" rx="3" fill="#213442" stroke="#678093"/>
    </>)}
    {layer('case', <>
      <Box w={174} d={85} h={85} top="#324d69" side={`url(#${id}-case)`} front="#1d344d"/>
      <path d="M-70-1 0-33 69-1 0 30Z" fill="#0b1d2e" stroke="#4d6d8a"/>
      <path d="M-74 7v65l64 31M74 7v65L10 103" fill="none" stroke="#4d6b89" strokeWidth="2"/>
      <Box x={-101} y={34} w={48} d={24} h={10} top="#3a5575" side="#213a55" front="#243d59"/>
      <Box x={101} y={34} w={48} d={24} h={10} top="#3a5575" side="#213a55" front="#243d59"/>
      <ellipse cx="-107" cy="34" rx="6" ry="3" fill="#0b1929" stroke="#91a6b8"/><ellipse cx="107" cy="34" rx="6" ry="3" fill="#0b1929" stroke="#91a6b8"/>
      <g transform="matrix(.9 .43 0 1 -64 28)"><rect width="52" height="38" rx="3" fill="#182e40" stroke="#637f94" strokeWidth=".5"/><text x="6" y="15" fill="#a1beca" fontSize="11" fontWeight="700">MG90S</text><text x="6" y="29" fill="#6c8f9e" fontSize="7">SERVO / DEMO</text></g>
    </>)}
    {layer('motor', <>
      <path d="M-34-8V57C-34 78 34 78 34 57V-8Z" fill={`url(#${id}-metal)`} stroke="#c2e2dd" strokeWidth="1"/>
      <ellipse rx="34" ry="16" cy="-8" fill="#d4e2d9" stroke="#ecf5e4"/>
      <ellipse rx="19" ry="9" cy="-9" fill="#486d73"/>
      <path d="M-5-9V-40C-5-44 5-44 5-40V-9Z" fill="#c7d3ca" stroke="#f3e8b5"/>
      <Gear x={0} y={-40} radius={15} teeth={10} rotation={angle * 3} gold={false}/>
      <path d="M-22 18V51M-17 20V52M22 18V51" stroke="#416775" strokeWidth="3" opacity=".65"/>
      <path d="M-15 70V86H10M15 70V94H35" fill="none" stroke="#c97963" strokeWidth="3"/>
    </>)}
    {layer('gears', <>
      <path d="M-53 19V50M3-12V42M48 7V45" stroke="#9aa7a5" strokeWidth="6"/>
      <Gear x={-53} y={8} radius={32} teeth={18} rotation={-angle * 2}/>
      <Gear x={3} y={-18} radius={40} teeth={24} rotation={angle}/>
      <Gear x={48} y={10} radius={32} teeth={18} rotation={-angle * 1.3}/>
      <Gear x={-52} y={-4} radius={15} teeth={10} rotation={-angle * 2}/>
      <path d="M44 6V-29Q49-34 54-29V6" fill="#ead29b" stroke="#fff2bc"/>
      <ellipse cx="49" cy="-29" rx="5" ry="2.7" fill="#fff0bd"/>
    </>)}
    {layer('cover', <>
      <Box w={178} d={87} h={16} top="#3f5975" side="#21364d" front="#2c435e"/>
      <path d="M-76-1 0-36 76-1M-70 4 0 37 70 4" stroke="#97acbb" strokeOpacity=".45" fill="none"/>
      <ellipse cx="43" cy="-2" rx="28" ry="15" fill="#263e53" stroke="#94a7a9"/>
      <path d="M28-3V-24C28-36 58-36 58-24V-3Z" fill={`url(#${id}-metal)`}/><ellipse cx="43" cy="-24" rx="15" ry="8" fill="#d2c9a4"/>
      <circle cx="43" cy="-25" r="4" fill="#314047"/>
      {[[-67, 1], [0, -31], [66, 1], [0, 31]].map(([x, y]) => <g key={`${x},${y}`} transform={`translate(${x} ${y})`}><ellipse rx="4.5" ry="2.5" fill="#a7b9bd"/><path d="M-2-1 2 1" stroke="#263e52"/></g>)}
    </>)}
    {layer('horn', <g transform={`translate(43 -9) scale(1 .5) rotate(${angle - 90})`}>
      <path d="M-78-11Q-93 0-78 11H-20Q0 27 20 11H78Q93 0 78-11H20Q0-27-20-11Z" transform="translate(0 6)" fill="#6e8794"/>
      <path d="M-78-11Q-93 0-78 11H-20Q0 27 20 11H78Q93 0 78-11H20Q0-27-20-11Z" fill="#dbe7e8" stroke="#f3f9f4" strokeWidth="1.5"/>
      {[-72, -56, -40, 40, 56, 72].map(x => <circle key={x} cx={x} r="4" fill="#344d5b" stroke="#8fa3ae"/>)}
      <circle r="13" fill="#89a1ac" stroke="#fbf5d7" strokeWidth="3"/><circle r="5" fill="#263d49"/>
      <path d="M-4 0H4M0-4V4" stroke="#a9c0c7" strokeWidth="1.5"/>
    </g>)}
    {!compact && e > .18 && servoParts.map((part, index) => {
      const [x, y] = positions[part.id]; const left = index === 1 || index === 3 || index === 5;
      const end = left ? 99 : 565; const start = left ? x - 76 : x + 83;
      return <g key={part.id} className="servo-callout" fill={selected === part.id ? part.color : '#a0b6c4'} pointerEvents="none">
        <path d={`M${start} ${y + 8}H${left ? 191 : 516}L${left ? 174 : 534} ${y - 8}H${end}`} fill="none" stroke={selected === part.id ? part.color : '#58717f'} strokeWidth="1"/>
        <circle cx={start} cy={y + 8} r="3" fill={part.color}/>
        <text x={left ? 99 : 566} y={y - 17} fontSize="10" letterSpacing="2" fill={part.color}>{part.tag} /</text>
        <text x={left ? 99 : 566} y={y + 9} fontSize="12">{english ? part.en : part.pt}</text>
      </g>;
    })}
    {!compact && <g fill="#8199a7" fontSize="10" letterSpacing="1.2"><text x="24" y="513">{english ? 'CONCEPTUAL ASSEMBLY' : 'MONTAGEM CONCEITUAL'}</text><text x="553" y="513">{english ? 'NOT TO SCALE' : 'SEM ESCALA DIMENSIONAL'}</text></g>}
  </svg>;
}
