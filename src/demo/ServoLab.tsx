import { useId, useState } from 'react';
import { ArrowUpRight, Layers3, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { ServoAssembly, servoParts, type ServoPartId } from './ServoAssembly';
import { ServoSignal } from './ServoSignal';
import { ServoTorque } from './ServoTorque';
import { servoScenario } from './servoMath';
import './servo.css';

type View = 'assembly' | 'signal' | 'load';
function Slider({ label, value, min, max, step = 1, unit, onChange }: { label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (value: number) => void }) {
  return <label className="servo-slider"><span>{label}<output>{Number(value.toFixed(2))}<small>{unit}</small></output></span>
    <input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))}/>
    <span className="servo-slider-bounds"><small>{min} {unit}</small><small>{max} {unit}</small></span>
  </label>;
}

/** Hand-authored SVG investigations. State lives only in this demo component. */
export function ServoLab({ english = false, onOpenPlan }: { english?: boolean; onOpenPlan?: () => void }) {
  const id = useId();
  const [view, setView] = useState<View>('assembly');
  const [spread, setSpread] = useState(85);
  const [angle, setAngle] = useState(90);
  const [selected, setSelected] = useState<ServoPartId>('gears');
  const [mass, setMass] = useState(120), [reach, setReach] = useState(12), [inclination, setInclination] = useState(0), [reference, setReference] = useState(.18);
  const scenario = { mass, reach, angle: inclination, reference };
  const result = servoScenario(scenario);
  const part = servoParts.find(item => item.id === selected)!;
  const choose = (pt: string, en: string) => english ? en : pt;
  const tabs: Array<{ id: View; title: string; detail: string }> = [
    { id: 'assembly', title: choose('Visão explodida', 'Exploded view'), detail: choose('Entenda as peças', 'Understand the parts') },
    { id: 'signal', title: choose('Sinal e controle', 'Signal & control'), detail: choose('Siga o comando', 'Follow the command') },
    { id: 'load', title: choose('Carga e alcance', 'Load & reach'), detail: choose('Questione a premissa', 'Question the premise') },
  ];
  const reset = () => { setSpread(85); setAngle(90); setSelected('gears'); setMass(120); setReach(12); setInclination(0); setReference(.18); };
  return <section className="servo-lab" aria-label={choose('Laboratório interativo do servomotor', 'Interactive servo laboratory')}>
    <header className="servo-lab-heading">
      <div><p className="servo-eyebrow"><span className="servo-live-dot"/>{choose('CADERNO DE ENGENHARIA', 'ENGINEERING NOTEBOOK')}<span className="servo-edition">01 / MG90S</span></p>
        <h2>{choose('Por dentro do movimento.', 'Inside the movement.')}</h2>
        <p className="servo-intro">{choose('Desmonte a ideia. Explore as relações. Descubra o que precisa ser testado.', 'Take the idea apart. Explore the relationships. Discover what needs testing.')}</p>
      </div>
      <div className="servo-lab-tools"><span className="servo-local">{choose('EXPERIMENTO LOCAL', 'LOCAL EXPERIMENT')}</span><button type="button" onClick={reset} title={choose('Restaurar todos os parâmetros', 'Reset all parameters')}><RotateCcw size={14}/>{choose('Reiniciar', 'Reset')}</button></div>
    </header>
    <div className="servo-tabs" role="tablist" aria-label={choose('Investigações do servo', 'Servo investigations')}>
      {tabs.map((tab, index) => <button key={tab.id} type="button" role="tab" id={`${id}-${tab.id}`} aria-controls={`${id}-panel`} aria-selected={view === tab.id} tabIndex={view === tab.id ? 0 : -1}
        onClick={() => setView(tab.id)} onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
          if (next >= 0) { event.preventDefault(); setView(tabs[next].id); document.getElementById(`${id}-${tabs[next].id}`)?.focus(); }
        }}><span className="servo-tab-number">0{index + 1}</span><span><strong>{tab.title}</strong><small>{tab.detail}</small></span><ArrowUpRight size={16}/></button>)}
    </div>
    <div className="servo-lab-body" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${view}`}>
      <div className="servo-stage">
        <div className="servo-stage-caption"><span><Layers3 size={13}/>{view === 'assembly' ? choose('ANATOMIA DO SERVOMOTOR', 'SERVO ANATOMY') : view === 'signal' ? choose('MALHA FECHADA', 'CLOSED LOOP') : choose('ENSAIO DE UMA HIPÓTESE', 'HYPOTHESIS EXPLORATION')}</span><span>{view === 'assembly' ? `${spread}% ${choose('SEPARAÇÃO', 'SEPARATION')}` : 'REACT / SVG'}</span></div>
        {view === 'assembly' ? <ServoAssembly spread={spread} angle={angle} selected={selected} onSelect={setSelected} english={english}/>
          : view === 'signal' ? <ServoSignal angle={angle} english={english}/>
            : <ServoTorque scenario={scenario} english={english}/>}
        <div className="servo-stage-bottom"><span className="servo-crosshair">+</span><p>{view === 'assembly' ? choose('Selecione uma peça no desenho ou na lista para investigar.', 'Select a part in the drawing or list to investigate.') : view === 'signal' ? choose('Mude a posição e acompanhe a largura do pulso.', 'Change position and follow the pulse width.') : choose('Varie uma condição por vez e observe a previsão.', 'Vary one condition at a time and observe the prediction.')}</p><span>FIG. 0{tabs.findIndex(t => t.id === view) + 1}</span></div>
      </div>
      <aside className="servo-inspector" aria-label={choose('Controles da investigação', 'Investigation controls')}>
        {view === 'assembly' ? <>
          <div className="servo-inspector-title"><span className="servo-eyebrow">{choose('INSPECIONAR COMPONENTE', 'INSPECT COMPONENT')}</span><span className="servo-part-index">{part.tag}<small> / 06</small></span></div>
          <div data-servo-inspector className="servo-part-detail"><span className="servo-part-mark" style={{ color: part.color }}>◈</span><h3>{english ? part.en : part.pt}</h3><p>{part.description[english ? 1 : 0]}</p></div>
          <div className="servo-part-list" role="group" aria-label={choose('Peças do servomotor', 'Servo parts')}>{servoParts.map(item => <button key={item.id} type="button" aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}><span style={{ color: item.color }}>{item.tag}</span><span>{english ? item.en : item.pt}</span><span aria-hidden="true">↗</span></button>)}</div>
          <div className="servo-question"><small>{choose('PERGUNTA PARA O PLANO', 'QUESTION FOR THE PLAN')}</small><p>{part.question[english ? 1 : 0]}</p></div>
        </> : view === 'signal' ? <>
          <span className="servo-eyebrow">{choose('COMANDO → RESPOSTA', 'COMMAND → RESPONSE')}</span><h3>{choose('Uma intenção vira posição.', 'Intent becomes position.')}</h3>
          <p className="servo-detail-copy">{choose('O sinal informa uma posição desejada. A malha interna compara a posição percebida e corrige o acionamento.', 'The signal requests a target position. The internal loop compares the sensed position and corrects actuation.')}</p>
          <div className="servo-big-value">{angle}<span>°</span></div>
          <Slider label={choose('Posição solicitada', 'Requested position')} value={angle} min={0} max={180} unit="°" onChange={setAngle}/>
          <dl className="servo-readings"><div><dt>{choose('Pulso ilustrativo', 'Illustrative pulse')}</dt><dd>{(1 + angle / 180).toFixed(2)} ms</dd></div><div><dt>{choose('Período ilustrativo', 'Illustrative period')}</dt><dd>20 ms</dd></div><div><dt>{choose('Saída desenhada', 'Drawn output')}</dt><dd>{choose('Idealizada', 'Idealised')}</dd></div></dl>
          <div className="servo-question"><small>{choose('PERGUNTA PARA O PLANO', 'QUESTION FOR THE PLAN')}</small><p>{choose('A posição real acompanha o comando quando existe carga?', 'Does the real position follow the command under load?')}</p></div>
          <p className="servo-limit">{choose('Mapeamento hipotético, sem atraso ou erro. Limites de pulso e curso precisam de calibração real.', 'Hypothetical mapping with no delay or error. Pulse and travel limits require real calibration.')}</p>
        </> : <>
          <span className="servo-eyebrow">{choose('CONDIÇÕES DO CENÁRIO', 'SCENARIO CONDITIONS')}</span><h3>{choose('E se a carga mudar?', 'What if the load changes?')}</h3>
          <p className="servo-detail-copy">{choose('Compare o momento previsto com uma referência que você escolhe. Ela não é uma especificação do MG90S.', 'Compare the predicted moment with a reference you choose. It is not an MG90S specification.')}</p>
          <Slider label={choose('Massa da carga', 'Payload mass')} value={mass} min={0} max={400} step={10} unit="g" onChange={setMass}/>
          <Slider label={choose('Alcance do braço', 'Arm reach')} value={reach} min={3} max={30} unit="cm" onChange={setReach}/>
          <Slider label={choose('Inclinação do braço', 'Arm inclination')} value={inclination} min={0} max={90} unit="°" onChange={setInclination}/>
          <Slider label={choose('Referência hipotética', 'Hypothetical reference')} value={reference} min={.05} max={.6} step={.01} unit="N·m" onChange={setReference}/>
          <div className="servo-accessible-result"><span>{choose('Momento estimado', 'Estimated moment')}</span><output aria-label={choose('Momento estimado', 'Estimated moment')} aria-live="polite">{result.torque.toFixed(3)} N·m</output></div>
          <div className="servo-load-status" data-load-status data-exceeds={result.exceedsReference}><span>{result.exceedsReference ? '↗' : '↘'}</span><div><strong>{choose(result.exceedsReference ? 'Acima da referência' : 'Abaixo da referência', result.exceedsReference ? 'Above the reference' : 'Below the reference')}</strong><small>{Math.round(result.utilization * 100)}% {choose('da referência escolhida', 'of the chosen reference')}</small></div></div>
          <p className="servo-limit">{choose('Estar abaixo da referência não confirma capacidade, precisão ou segurança.', 'Being below the reference does not confirm capacity, precision or safety.')}</p>
        </>}
      </aside>
    </div>
    {view === 'assembly' && <div className="servo-assembly-controls">
      <div className="servo-view-toggle" role="group" aria-label={choose('Montagem', 'Assembly')}><button type="button" aria-pressed={spread === 0} onClick={() => setSpread(0)}>{choose('Montado', 'Assembled')}</button><button type="button" aria-pressed={spread > 0} onClick={() => setSpread(85)}>{choose('Explodido', 'Exploded')}</button></div>
      <Slider label={choose('Separação das peças', 'Part separation')} value={spread} min={0} max={100} unit="%" onChange={setSpread}/>
      <Slider label={choose('Rotação da saída', 'Output rotation')} value={angle} min={0} max={180} unit="°" onChange={setAngle}/>
      <SlidersHorizontal className="servo-controls-icon" size={18}/>
    </div>}
    <footer className="servo-lab-footer"><p><span aria-hidden="true">◇</span>{choose('Ilustração conceitual e valores fictícios. Explore uma previsão; valide no mundo real.', 'Conceptual illustration and fictional values. Explore a prediction; validate in the real world.')}</p>
      {onOpenPlan && <button type="button" onClick={onOpenPlan}>{choose('Ver premissa no plano', 'View premise in plan')}<ArrowUpRight size={14}/></button>}
    </footer>
  </section>;
}
