import { useLocaleStore } from '@/i18n';
import { Logo } from '@/components/Logo';
import { LanguageToggle } from '@/components/LanguageToggle';

const GITHUB_URL = 'https://github.com/cellproject-builder/cellproject-builder';

const COPY = {
  en: {
    nav: {
      openApp: 'Open the app →',
      github: 'GitHub',
    },
    hero: {
      kicker: '◆ Visual planning framework',
      title: 'Plan as a tree. Validate node by node.',
      sub: 'The AI proposes complete paths shaped as a tree. You pick one and ship it step by step — every node carries what it is, why, and how to confirm. Lives entirely in your browser.',
      cta: '▶ Open the app',
      ctaSecondary: 'See the code',
      tag: 'open-source · BYOK · no backend',
    },
    problem: {
      kicker: '◆ The problem',
      title: 'Planning stalls in two places.',
      a: {
        title: 'Cold-start paralysis',
        body: 'You don\'t know where to begin, what already exists, or what comes before what. A blank canvas isn\'t freedom — it\'s a wall.',
      },
      b: {
        title: 'Context loss while doing',
        body: 'The plan becomes an opaque to-do list, each item becomes a blind task, and the *why* behind every step disappears as you execute.',
      },
    },
    how: {
      kicker: '◆ How it works',
      title: 'Four moves, no chat.',
      steps: [
        {
          n: '01',
          title: 'Declare the goal',
          body: 'You write a concrete f(X) = ?. The goal is the root. Nothing starts without it.',
        },
        {
          n: '02',
          title: 'AI proposes plans',
          body: '1–3 alternative trees stream in live — from the simplest to the most ambitious. You pick one.',
        },
        {
          n: '03',
          title: 'Decompose any node',
          body: 'Resources, steps, decisions. Children come from the AI as suggestions that wait in staging until you accept.',
        },
        {
          n: '04',
          title: 'Validate against reality',
          body: 'Each node carries oQue / porQue / comoConfirmar. You confirm against real anchors — measurements, links, specs.',
        },
      ],
    },
    principles: {
      kicker: '◆ Principles',
      title: 'What it refuses to be.',
      items: [
        {
          title: 'Goal first, always.',
          body: 'No node exists without a root goal. The tree is rooted in a concrete objective, not an open mood.',
        },
        {
          title: 'Typed decomposition.',
          body: 'Every node has a kind: recurso, passo, decisao, categoria, concept. The kind decides how the AI breaks it down.',
        },
        {
          title: 'Every node validatable on its own.',
          body: 'oQue, porQue, comoConfirmar. If you can confirm, you advance. If not, you decompose further.',
        },
        {
          title: 'AI is co-author, not owner.',
          body: 'Suggestions sit in staging until you accept. Streaming, validated by schemas, mapped through temp ids — never your domain.',
        },
        {
          title: 'The loop never closes inside AI.',
          body: 'User-written criterion locked before seeing the AI\'s. Adversarial critique. Replan from real failure. Verifiable anchors. Pick at least one.',
        },
        {
          title: 'Same structure, two views.',
          body: 'Graph to see the whole and connect pieces. Tutor to dive into a node and execute it. Keys 1–5 for lenses.',
        },
      ],
    },
    truth: {
      kicker: '◆ Ground truth',
      title: 'Four ways to anchor outside the AI.',
      sub: 'The biggest risk in any AI-assisted planner is the closed AI→AI loop: the same model writes the plan and the confirmation criterion, the user confirms, and no signal from reality enters. Four orthogonal mechanisms break that loop.',
      items: [
        {
          tag: '(a)',
          title: 'User criterion, locked',
          body: 'You write how you\'d know the node is done — before the UI reveals the AI\'s answer. After writing, the field is locked. No retroactive copying.',
        },
        {
          tag: '(b)',
          title: 'Adversarial critique',
          body: 'A distinct skeptic persona returns weaknesses, hidden premises, and an alternative criterion. Convergence = robust. Divergence = signal.',
        },
        {
          tag: '(c)',
          title: 'Replan from real failure',
          body: 'When execution breaks, you report what actually happened. The AI re-decomposes knowing the failure — not pretending it didn\'t exist.',
        },
        {
          tag: '(d)',
          title: 'Verifiable real-world anchors',
          body: 'Specs with units, measurements, links. AI suggests with verificado=false. Only your real-world check turns a hint into truth.',
        },
      ],
    },
    stack: {
      kicker: '◆ Stack',
      title: 'Pure frontend. Your key, your data.',
      items: [
        { label: 'BYOK', body: 'Bring Your Own Key. OpenAI, Anthropic, or OpenRouter — your choice, your bill.' },
        { label: 'No backend', body: 'No proprietary server. Your projects live in your browser\'s IndexedDB. Clear site data and they\'re gone.' },
        { label: 'Open-source', body: 'MIT. Self-host, fork, or just read the source. Nothing is locked away.' },
        { label: 'React + Vite', body: 'Zustand + persist for state. @xyflow/react for the graph. Vercel AI SDK with Zod schemas for typed AI responses.' },
      ],
    },
    finalCta: {
      kicker: '◆ Try it',
      title: 'No signup. No friction.',
      sub: 'Open the app and try the live demo without any key. Configure a provider when you\'re ready to plan something of your own.',
      cta: '▶ Open the app',
      ctaSecondary: 'Star on GitHub',
    },
    footer: {
      tagline: '◆ open-source · BYOK · no backend · your projects live in your browser',
    },
  },
  'pt-BR': {
    nav: {
      openApp: 'Abrir o app →',
      github: 'GitHub',
    },
    hero: {
      kicker: '◆ Framework visual de planejamento',
      title: 'Planeje em árvore. Valide nó por nó.',
      sub: 'A IA propõe caminhos completos no formato de árvore. Você escolhe um e executa passo a passo — cada nó carrega o que é, por quê, e como confirmar. Vive inteiro no seu navegador.',
      cta: '▶ Abrir o app',
      ctaSecondary: 'Ver o código',
      tag: 'open-source · BYOK · sem backend',
    },
    problem: {
      kicker: '◆ O problema',
      title: 'Planejamento trava em dois pontos.',
      a: {
        title: 'Paralisia de início',
        body: 'Você não sabe por onde começar, o que já existe, ou o que vem antes do quê. Tela em branco não é liberdade — é parede.',
      },
      b: {
        title: 'Perda de contexto na execução',
        body: 'O plano vira lista opaca, cada item vira tarefa cega, e o *porquê* de cada passo some no meio do caminho.',
      },
    },
    how: {
      kicker: '◆ Como funciona',
      title: 'Quatro movimentos, sem chat.',
      steps: [
        {
          n: '01',
          title: 'Declare o objetivo',
          body: 'Você escreve um f(X) = ? concreto. O objetivo é a raiz. Nada começa sem isso.',
        },
        {
          n: '02',
          title: 'IA propõe planos',
          body: '1 a 3 árvores alternativas chegam em streaming — do mais simples ao mais ambicioso. Você escolhe uma.',
        },
        {
          n: '03',
          title: 'Decomponha qualquer nó',
          body: 'Recursos, passos, decisões. Filhos vêm da IA como sugestões que ficam em staging até você aceitar.',
        },
        {
          n: '04',
          title: 'Valide contra a realidade',
          body: 'Cada nó traz oQue / porQue / comoConfirmar. Você confirma contra âncoras reais — medidas, links, specs.',
        },
      ],
    },
    principles: {
      kicker: '◆ Princípios',
      title: 'O que ele se recusa a ser.',
      items: [
        {
          title: 'Objetivo primeiro, sempre.',
          body: 'Nenhum nó existe sem uma raiz. A árvore se enraíza num objetivo concreto, não num clima aberto.',
        },
        {
          title: 'Decomposição tipada.',
          body: 'Cada nó tem um tipo: recurso, passo, decisao, categoria, concept. O tipo decide como a IA quebra ele.',
        },
        {
          title: 'Cada nó é validável sozinho.',
          body: 'oQue, porQue, comoConfirmar. Se você consegue confirmar, avança. Se não, decompõe mais.',
        },
        {
          title: 'IA é co-autora, não dona.',
          body: 'Sugestões ficam em staging até você aceitar. Streaming, validado por schemas, mapeado por temp ids — nunca toca seu domínio direto.',
        },
        {
          title: 'O loop nunca fecha só dentro da IA.',
          body: 'Critério do usuário travado antes de ver o da IA. Crítica adversarial. Replan a partir de falha real. Âncoras verificáveis. Escolha pelo menos uma.',
        },
        {
          title: 'Mesma estrutura, duas vistas.',
          body: 'Grafo pra ver o todo e conectar peças. Tutor pra mergulhar num nó e executar. Teclas 1–5 trocam as lentes.',
        },
      ],
    },
    truth: {
      kicker: '◆ Ground truth',
      title: 'Quatro formas de ancorar fora da IA.',
      sub: 'O maior risco em qualquer planejador com IA é o loop fechado IA→IA: o mesmo modelo escreve o plano e o critério de confirmação, o usuário confirma, e nenhum sinal da realidade entra. Quatro mecanismos ortogonais quebram esse loop.',
      items: [
        {
          tag: '(a)',
          title: 'Critério do usuário, travado',
          body: 'Você escreve como saberia que o nó tá pronto — antes da UI revelar o da IA. Depois de escrever, o campo trava. Sem cópia retroativa.',
        },
        {
          tag: '(b)',
          title: 'Crítica adversarial',
          body: 'Uma persona cética distinta devolve fraquezas, premissas ocultas, e um critério alternativo. Convergência = robusto. Divergência = sinal.',
        },
        {
          tag: '(c)',
          title: 'Replan a partir de falha real',
          body: 'Quando a execução quebra, você reporta o que aconteceu de verdade. A IA re-decompõe sabendo da falha — não fingindo que não existiu.',
        },
        {
          tag: '(d)',
          title: 'Âncoras verificáveis do mundo real',
          body: 'Specs com unidade, medidas, links. IA sugere com verificado=false. Só sua checagem na realidade transforma uma sugestão em verdade.',
        },
      ],
    },
    stack: {
      kicker: '◆ Stack',
      title: 'Frontend puro. Sua chave, seus dados.',
      items: [
        { label: 'BYOK', body: 'Bring Your Own Key. OpenAI, Anthropic ou OpenRouter — sua escolha, sua conta.' },
        { label: 'Sem backend', body: 'Nenhum servidor proprietário. Seus projetos vivem no IndexedDB do navegador. Limpou o site, sumiu.' },
        { label: 'Open-source', body: 'MIT. Self-host, fork, ou só leia o código. Nada fica trancado.' },
        { label: 'React + Vite', body: 'Zustand + persist pro estado. @xyflow/react pro grafo. Vercel AI SDK com schemas Zod pra respostas tipadas.' },
      ],
    },
    finalCta: {
      kicker: '◆ Testa aí',
      title: 'Sem signup. Sem atrito.',
      sub: 'Abra o app e veja a demo sem precisar de chave. Configure um provider quando quiser planejar algo seu de verdade.',
      cta: '▶ Abrir o app',
      ctaSecondary: 'Dar uma estrela no GitHub',
    },
    footer: {
      tagline: '◆ open-source · BYOK · sem backend · seus projetos vivem no seu navegador',
    },
  },
} as const;

export function LandingPage() {
  const locale = useLocaleStore((s) => s.locale);
  const t = COPY[locale];

  return (
    <div className="min-h-screen w-full bg-bg-primary text-text-primary overflow-x-hidden">
      {/* Top bar */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-bg-primary/80 border-b border-border-base">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <a href="/" className="flex items-center gap-2.5 min-w-0">
            <Logo size={22} className="text-text-primary shrink-0" />
            <span className="font-semibold tracking-tight text-sm sm:text-base text-text-primary truncate">
              CellProject Builder
            </span>
          </a>
          <div className="flex items-center gap-3 sm:gap-4">
            <LanguageToggle />
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:inline text-[11px] font-mono uppercase tracking-wider text-text-muted hover:text-text-primary transition-colors"
            >
              {t.nav.github}
            </a>
            <a
              href="/"
              className="text-[11px] sm:text-xs font-mono uppercase tracking-wider px-3 py-1.5 bg-ai-accent/15 hover:bg-ai-accent/30 text-ai-accent border border-ai-accent/40 rounded-sm transition-colors whitespace-nowrap"
            >
              {t.nav.openApp}
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="border-b border-border-base">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24 lg:py-32">
          <div className="grid lg:grid-cols-[1.2fr_1fr] gap-12 lg:gap-16 items-center">
            <div>
              <div className="text-ai-accent text-xs font-mono uppercase tracking-widest mb-4">
                {t.hero.kicker}
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.05] mb-6">
                {t.hero.title}
              </h1>
              <p className="text-base sm:text-lg text-text-secondary leading-relaxed max-w-xl mb-8">
                {t.hero.sub}
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <a
                  href="/"
                  className="text-center px-6 py-3 min-h-[48px] inline-flex items-center justify-center bg-ai-accent/20 hover:bg-ai-accent/35 text-ai-accent border border-ai-accent/50 rounded-sm text-sm font-semibold transition-colors"
                >
                  {t.hero.cta}
                </a>
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-center px-6 py-3 min-h-[48px] inline-flex items-center justify-center bg-bg-secondary hover:bg-bg-elevated text-text-primary border border-border-base hover:border-text-muted rounded-sm text-sm font-medium transition-colors"
                >
                  {t.hero.ctaSecondary}
                </a>
              </div>
              <div className="mt-6 text-[11px] font-mono text-text-muted">
                {t.hero.tag}
              </div>
            </div>

            {/* Visual: stylized tree diagram */}
            <div className="hidden lg:block">
              <TreeVisual />
            </div>
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="border-b border-border-base">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <SectionHeading kicker={t.problem.kicker} title={t.problem.title} />
          <div className="grid md:grid-cols-2 gap-4 sm:gap-6 mt-10">
            <ProblemCard num="01" title={t.problem.a.title} body={t.problem.a.body} />
            <ProblemCard num="02" title={t.problem.b.title} body={t.problem.b.body} />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-b border-border-base bg-bg-secondary/30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <SectionHeading kicker={t.how.kicker} title={t.how.title} />
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mt-10">
            {t.how.steps.map((s) => (
              <div
                key={s.n}
                className="border border-border-base bg-bg-secondary rounded-sm p-5 hover:border-ai-accent/40 transition-colors"
              >
                <div className="text-ai-accent font-mono text-xs tracking-widest mb-3">{s.n}</div>
                <div className="font-semibold text-text-primary mb-2">{s.title}</div>
                <div className="text-sm text-text-secondary leading-relaxed">{s.body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Principles */}
      <section className="border-b border-border-base">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <SectionHeading kicker={t.principles.kicker} title={t.principles.title} />
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-px bg-border-base border border-border-base rounded-sm mt-10 overflow-hidden">
            {t.principles.items.map((p, i) => (
              <div key={i} className="bg-bg-primary p-5 hover:bg-bg-secondary/50 transition-colors">
                <div className="text-ai-accent font-mono text-[10px] tracking-widest mb-2">
                  ◆ {String(i + 1).padStart(2, '0')}
                </div>
                <div className="font-semibold text-text-primary mb-2">{p.title}</div>
                <div className="text-sm text-text-secondary leading-relaxed">{p.body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Ground truth */}
      <section className="border-b border-border-base bg-bg-secondary/30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <SectionHeading kicker={t.truth.kicker} title={t.truth.title} />
          <p className="text-sm sm:text-base text-text-secondary leading-relaxed max-w-3xl mt-4">
            {t.truth.sub}
          </p>
          <div className="grid md:grid-cols-2 gap-4 sm:gap-6 mt-10">
            {t.truth.items.map((m) => (
              <div
                key={m.tag}
                className="border border-border-base bg-bg-secondary rounded-sm p-5 hover:border-ai-accent/40 transition-colors"
              >
                <div className="flex items-baseline gap-3 mb-2">
                  <span className="text-ai-accent font-mono text-xs">{m.tag}</span>
                  <span className="font-semibold text-text-primary">{m.title}</span>
                </div>
                <div className="text-sm text-text-secondary leading-relaxed">{m.body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stack */}
      <section className="border-b border-border-base">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <SectionHeading kicker={t.stack.kicker} title={t.stack.title} />
          <div className="mt-10 space-y-px bg-border-base border border-border-base rounded-sm overflow-hidden">
            {t.stack.items.map((s) => (
              <div
                key={s.label}
                className="bg-bg-primary p-5 grid sm:grid-cols-[180px_1fr] gap-3 sm:gap-6 hover:bg-bg-secondary/50 transition-colors"
              >
                <div className="text-ai-accent font-mono text-xs uppercase tracking-widest sm:pt-1">
                  ◆ {s.label}
                </div>
                <div className="text-sm text-text-secondary leading-relaxed">{s.body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-b border-border-base bg-gradient-to-b from-ai-accent/[0.04] to-transparent">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-20 sm:py-28 text-center">
          <div className="text-ai-accent text-xs font-mono uppercase tracking-widest mb-4">
            {t.finalCta.kicker}
          </div>
          <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-4">
            {t.finalCta.title}
          </h2>
          <p className="text-text-secondary leading-relaxed mb-8 max-w-xl mx-auto">
            {t.finalCta.sub}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <a
              href="/"
              className="px-6 py-3 min-h-[48px] inline-flex items-center justify-center bg-ai-accent/20 hover:bg-ai-accent/35 text-ai-accent border border-ai-accent/50 rounded-sm text-sm font-semibold transition-colors"
            >
              {t.finalCta.cta}
            </a>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-3 min-h-[48px] inline-flex items-center justify-center bg-bg-secondary hover:bg-bg-elevated text-text-primary border border-border-base hover:border-text-muted rounded-sm text-sm font-medium transition-colors"
            >
              ★ {t.finalCta.ctaSecondary}
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Logo size={18} className="text-text-muted" />
            <span className="font-mono text-[11px] text-text-muted">CellProject Builder</span>
          </div>
          <div className="font-mono text-[11px] text-text-muted text-center">
            {t.footer.tagline}
          </div>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[11px] uppercase tracking-wider text-text-muted hover:text-text-primary transition-colors"
          >
            {t.nav.github} →
          </a>
        </div>
      </footer>
    </div>
  );
}

function SectionHeading({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div>
      <div className="text-ai-accent text-xs font-mono uppercase tracking-widest mb-3">
        {kicker}
      </div>
      <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight max-w-3xl">
        {title}
      </h2>
    </div>
  );
}

function ProblemCard({ num, title, body }: { num: string; title: string; body: string }) {
  return (
    <div className="border border-border-base bg-bg-secondary rounded-sm p-6 sm:p-8 hover:border-state-problem/40 transition-colors">
      <div className="text-state-problem font-mono text-xs tracking-widest mb-3">✕ {num}</div>
      <div className="text-lg font-semibold text-text-primary mb-3">{title}</div>
      <div className="text-sm text-text-secondary leading-relaxed">{body}</div>
    </div>
  );
}

// Decorative tree SVG echoing the planner's mental model: root + children
// with three categorias (resources / steps / decisions).
function TreeVisual() {
  return (
    <div className="relative aspect-square w-full max-w-md mx-auto">
      <svg viewBox="0 0 400 400" className="w-full h-full" aria-hidden="true">
        <defs>
          <linearGradient id="lg-edge" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#8b5cf6" stopOpacity="0.6" />
            <stop offset="1" stopColor="#8b5cf6" stopOpacity="0.15" />
          </linearGradient>
        </defs>

        {/* Edges: root → 3 categories → leaves */}
        <g stroke="url(#lg-edge)" strokeWidth="1.5" fill="none">
          {/* root to categories */}
          <path d="M 200 70 L 90 170" />
          <path d="M 200 70 L 200 170" />
          <path d="M 200 70 L 310 170" />
          {/* category 1 leaves */}
          <path d="M 90 200 L 50 300" />
          <path d="M 90 200 L 130 300" />
          {/* category 2 leaves */}
          <path d="M 200 200 L 170 300" />
          <path d="M 200 200 L 230 300" />
          <path d="M 200 200 L 200 320" />
          {/* category 3 leaves */}
          <path d="M 310 200 L 270 300" />
          <path d="M 310 200 L 350 300" />
        </g>

        {/* root */}
        <g>
          <circle cx="200" cy="60" r="14" fill="#8b5cf6" />
          <circle cx="200" cy="60" r="22" fill="none" stroke="#8b5cf6" strokeOpacity="0.3" strokeWidth="1" />
          <text x="200" y="36" textAnchor="middle" fontSize="9" fill="#a1a1aa" fontFamily="monospace">
            f(X) = ?
          </text>
        </g>

        {/* categories */}
        <g>
          <rect x="68" y="172" width="44" height="22" rx="2" fill="#18181b" stroke="#3f3f46" />
          <text x="90" y="187" textAnchor="middle" fontSize="8" fill="#a1a1aa" fontFamily="monospace">RES</text>

          <rect x="178" y="172" width="44" height="22" rx="2" fill="#18181b" stroke="#3f3f46" />
          <text x="200" y="187" textAnchor="middle" fontSize="8" fill="#a1a1aa" fontFamily="monospace">EXEC</text>

          <rect x="288" y="172" width="44" height="22" rx="2" fill="#18181b" stroke="#3f3f46" />
          <text x="310" y="187" textAnchor="middle" fontSize="8" fill="#a1a1aa" fontFamily="monospace">DEC</text>
        </g>

        {/* leaves */}
        <g>
          {[
            [50, 310], [130, 310],
            [170, 310], [230, 310], [200, 330],
            [270, 310], [350, 310],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="6" fill="#27272a" stroke="#3f3f46" />
          ))}
          {/* one validated */}
          <circle cx="130" cy="310" r="6" fill="#22c55e" />
          {/* one executing */}
          <circle cx="200" cy="330" r="6" fill="#3b82f6" />
          {/* one problem */}
          <circle cx="270" cy="310" r="6" fill="#ef4444" />
        </g>
      </svg>
    </div>
  );
}
