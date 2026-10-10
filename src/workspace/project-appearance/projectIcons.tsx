import { Component as ReactComponent, lazy, Suspense, type ReactNode } from 'react';
import { softProjectIcons } from '@/components/ui/SoftIcons';
import { Icon } from '../ui';
import { DEFAULT_PROJECT_APPEARANCE, type ProjectAppearance } from './projectAppearance';
import { projectIconIds } from './projectIconIds';

const RadixProjectIcon = lazy(() => import('./RadixProjectIcon'));
const extendedIds = new Set<string>(projectIconIds);

// A missing cached chunk must not take the workspace down. The stored icon
// stays intact; the next page load can try the extended catalog again.
class IconLoadBoundary extends ReactComponent<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

const labels: Record<string, [string, string?]> = {
  planner: ['Plano', 'projeto estrutura árvore organizacao estrategia plan'],
  GearIcon: ['Engrenagem', 'engenharia mecanica robotica motor configuracao'],
  RocketIcon: ['Foguete', 'espaco astronomia lancamento startup'],
  CubeIcon: ['Cubo', '3d modelo montagem engenharia geometria'],
  Component1Icon: ['Componente', 'peca eletronica robotica modulo'],
  Component2Icon: ['Módulos', 'pecas eletronica robotica conjunto'],
  CodeIcon: ['Código', 'programacao software desenvolvimento'],
  CodesandboxLogoIcon: ['Sandbox', 'programacao codigo software'],
  LayersIcon: ['Camadas', 'estrutura arquitetura montagem'],
  StackIcon: ['Pilha', 'camadas estrutura arquitetura'],
  RulerSquareIcon: ['Esquadro', 'engenharia medidas desenho arquitetura'],
  RulerHorizontalIcon: ['Régua', 'engenharia medidas dimensoes desenho'],
  DimensionsIcon: ['Dimensões', 'engenharia medida escala'],
  LightningBoltIcon: ['Energia', 'eletrica eletricidade raio potencia'],
  BarChartIcon: ['Gráfico de barras', 'dados analise estatistica pesquisa'],
  PieChartIcon: ['Gráfico circular', 'dados analise estatistica pesquisa pizza'],
  ActivityLogIcon: ['Atividade', 'dados analise historico registro'],
  TableIcon: ['Tabela', 'dados analise planilha'],
  ReaderIcon: ['Livro', 'leitura estudo pesquisa educacao conhecimento'],
  BackpackIcon: ['Mochila', 'estudo escola educacao viagem'],
  BookmarkIcon: ['Marcador', 'livro leitura estudo referencia'],
  FileTextIcon: ['Documento', 'texto estudo artigo pesquisa referencia'],
  FileIcon: ['Arquivo', 'documento anexo'],
  Pencil1Icon: ['Lápis', 'escrever desenho arte rascunho notas'],
  Pencil2Icon: ['Desenho', 'lapis escrever arte rascunho'],
  GlobeIcon: ['Globo', 'mundo planeta geografia web internet'],
  TargetIcon: ['Alvo', 'objetivo estrategia foco meta'],
  DashboardIcon: ['Painel', 'gestao negocio indicadores'],
  CalendarIcon: ['Calendário', 'agenda tempo planejamento'],
  ClockIcon: ['Relógio', 'tempo agenda horario'],
  StopwatchIcon: ['Cronômetro', 'tempo ensaio teste'],
  TimerIcon: ['Temporizador', 'tempo ensaio teste'],
  LapTimerIcon: ['Tempo de volta', 'corrida esporte ensaio teste'],
  HomeIcon: ['Casa', 'arquitetura construcao lar'],
  BoxIcon: ['Caixa', 'produto pacote estoque'],
  ArchiveIcon: ['Arquivo guardado', 'caixa documentos historico'],
  PersonIcon: ['Pessoa', 'psicologia pessoas humano usuario'],
  AvatarIcon: ['Perfil', 'pessoa psicologia humano usuario'],
  FaceIcon: ['Rosto', 'psicologia pessoas humor humano'],
  HeartIcon: ['Coração', 'saude psicologia bem estar'],
  HeartFilledIcon: ['Coração preenchido', 'saude psicologia bem estar'],
  HandIcon: ['Mão', 'humano trabalho manual'],
  AccessibilityIcon: ['Acessibilidade', 'pessoa inclusao humano'],
  IdCardIcon: ['Identidade', 'pessoa perfil documento'],
  CameraIcon: ['Câmera', 'fotografia foto imagem'],
  ImageIcon: ['Imagem', 'fotografia foto paisagem'],
  VideoIcon: ['Vídeo', 'filme cinema midia'],
  SpeakerLoudIcon: ['Som', 'audio musica midia'],
  HeadphonesIcon: ['Fones', 'audio musica som'],
  DesktopIcon: ['Computador', 'software tecnologia hardware'],
  LaptopIcon: ['Notebook', 'computador software tecnologia'],
  MobileIcon: ['Celular', 'telefone aplicativo tecnologia'],
  KeyboardIcon: ['Teclado', 'computador tecnologia digitar'],
  MagicWandIcon: ['Varinha', 'ideia criatividade ia inteligencia artificial'],
  StarIcon: ['Estrela', 'ideia espaco destaque astronomia'],
  StarFilledIcon: ['Estrela preenchida', 'espaco destaque astronomia'],
  SunIcon: ['Sol', 'espaco astronomia clima energia'],
  MoonIcon: ['Lua', 'espaco astronomia noite'],
  CloudIcon: ['Nuvem', 'clima armazenamento web'],
  ChatBubbleIcon: ['Conversa', 'chat comunicacao mensagem'],
  EnvelopeClosedIcon: ['Carta', 'email mensagem comunicacao'],
  PaperPlaneIcon: ['Avião de papel', 'mensagem comunicacao enviar'],
  Link1Icon: ['Vínculo', 'conexao ligar link'],
  Link2Icon: ['Conexão', 'vinculo ligar link'],
  Share1Icon: ['Compartilhar', 'conexao rede'],
  Share2Icon: ['Rede', 'compartilhar conexao'],
  SewingPinIcon: ['Localização', 'mapa lugar viagem'],
  CompassIcon: ['Bússola', 'viagem mapa navegacao'],
  LockClosedIcon: ['Cadeado', 'privacidade seguranca protecao'],
  ShieldIcon: ['Escudo', 'seguranca protecao'],
  CheckCircledIcon: ['Concluído', 'confirmado tarefa verificacao'],
  ListBulletIcon: ['Lista', 'tarefas roteiro passos'],
  GridIcon: ['Grade', 'organizar estrutura quadro'],
  LoopIcon: ['Ciclo', 'processo repetir revisao'],
  MixIcon: ['Mistura', 'composicao arte'],
  HobbyKnifeIcon: ['Estilete', 'ferramenta arte cortar fabricar'],
  ScissorsIcon: ['Tesoura', 'ferramenta arte cortar fabricar'],
  TokensIcon: ['Peças', 'composicao componentes conjunto'],
  BadgeIcon: ['Selo', 'premio conquista certificado'],
};
const preferred = ['planner','GearIcon','CubeIcon','RocketIcon','CodeIcon','Component1Icon','LayersIcon','RulerSquareIcon','LightningBoltIcon','BarChartIcon','ReaderIcon','GlobeIcon','TargetIcon','Pencil1Icon','HeartIcon','PersonIcon','HomeIcon','CameraIcon','CalendarIcon','DesktopIcon','StarIcon','BackpackIcon','FileTextIcon','ChatBubbleIcon'];
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const humanize = (name: string) => name.replace(/Icon$/, '').replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
const registry = softProjectIcons as Record<string, typeof softProjectIcons.GearIcon>;

export const projectIconCatalog = ['planner', ...projectIconIds]
  .map(id => ({id, label: labels[id]?.[0] ?? humanize(id), english: id === 'planner' ? 'Plan' : humanize(id), keywords: normalize(`${id} ${labels[id]?.join(' ') ?? ''} ${humanize(id)}`)}))
  .sort((a, b) => {
    const first = preferred.indexOf(a.id), second = preferred.indexOf(b.id);
    return (first < 0 ? 999 : first) - (second < 0 ? 999 : second) || a.english.localeCompare(b.english);
  });

export function searchProjectIcons(query: string) {
  const words = normalize(query.trim()).split(/\s+/).filter(Boolean);
  return projectIconCatalog.filter(icon => words.every(word => icon.keywords.includes(word)));
}

/** Unknown IDs from a newer client remain stored and fall back to the plan glyph. */
export function ProjectIcon({appearance, size = 20, decorated = false}: {appearance?: ProjectAppearance; size?: number; decorated?: boolean}) {
  const color = typeof appearance?.color === 'string' && /^#[0-9a-f]{6}$/i.test(appearance.color) ? appearance.color : DEFAULT_PROJECT_APPEARANCE.color;
  const Component = appearance?.icon && Object.hasOwn(registry, appearance.icon) ? registry[appearance.icon] : null;
  const extended = appearance?.icon && extendedIds.has(appearance.icon) ? appearance.icon : null;
  return <span data-project-icon={Component || extended ? appearance!.icon : 'planner'} className={decorated ? 'ws-project-glyph is-decorated' : 'ws-project-glyph'} style={{color, ...(decorated ? {backgroundColor:`${color}14`} : {})}} aria-hidden="true">
    {Component ? <Component width={size} height={size}/> : extended ? <IconLoadBoundary fallback={<Icon name="planner" size={size}/>}><Suspense fallback={<Icon name="planner" size={size}/>}><RadixProjectIcon id={extended} size={size}/></Suspense></IconLoadBoundary> : <Icon name="planner" size={size}/>}
  </span>;
}
