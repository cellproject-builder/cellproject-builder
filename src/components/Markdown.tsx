// Renderizador leve do markdown que a IA produz (tutor, pesquisa web):
// títulos em **CAIXA ALTA** ou #/##/###, bullets, listas numeradas, negrito,
// `código` inline, blocos ``` e links [texto](url) clicáveis. Sem dependência
// externa de markdown.
//
// `variant`: 'panel' (compacto, dentro da sidebar) · 'reading' (tipografia
// confortável pro modo leitura em tela cheia).

type Variant = 'panel' | 'reading';

export function ExplanationContent({
  text,
  variant = 'panel',
}: {
  text: string;
  variant?: Variant;
}) {
  const reading = variant === 'reading';
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];

  const headingCls = reading
    ? 'text-[11px] font-mono uppercase tracking-widest text-ai-accent pt-5 first:pt-0'
    : 'text-[10px] font-mono uppercase tracking-widest text-ai-accent pt-2 first:pt-0';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Bloco de código cercado — acumula até a cerca de fechamento (ou EOF).
    if (line.trimStart().startsWith('```')) {
      const code: string[] = [];
      let j = i + 1;
      while (j < lines.length && !lines[j].trimStart().startsWith('```')) {
        code.push(lines[j]);
        j++;
      }
      blocks.push(
        <pre
          key={i}
          className={`font-mono bg-bg-elevated border border-border-base rounded-sm px-3 py-2 overflow-x-auto whitespace-pre text-text-primary ${
            reading ? 'text-[13px] leading-relaxed my-2' : 'text-[11px] leading-snug my-1'
          }`}
        >
          {code.join('\n')}
        </pre>,
      );
      i = j; // pula a cerca de fechamento
      continue;
    }

    if (line.trim() === '') {
      blocks.push(<div key={i} className={reading ? 'h-3' : 'h-2'} />);
      continue;
    }

    // Título de seção: linha inteira em **negrito** (formato pedido ao tutor)
    // ou heading markdown #/##/### que modelos emitem por conta própria.
    const boldMatch = line.match(/^\*\*(.+?)\*\*:?\s*$/);
    const hashMatch = line.match(/^#{1,4}\s+(.*)$/);
    if (boldMatch || hashMatch) {
      // Tira o negrito (o estilo do título já é destaque) mas mantém links e
      // `código` clicáveis/formatados via renderInline.
      const content = (boldMatch ? boldMatch[1] : hashMatch![1]).replace(/\*\*/g, '');
      blocks.push(
        <div key={i} className={headingCls}>
          {renderInline(content)}
        </div>,
      );
      continue;
    }

    const bulletMatch = line.match(/^\s*[-*]\s+(.*)$/);
    if (bulletMatch) {
      blocks.push(
        <div key={i} className="pl-4 relative">
          <span className="absolute left-0 text-text-muted">•</span>
          {renderInline(bulletMatch[1])}
        </div>,
      );
      continue;
    }

    const numMatch = line.match(/^\s*(\d+)[.)]\s(.*)$/);
    if (numMatch) {
      blocks.push(
        <div key={i} className="pl-6 relative">
          <span className="absolute left-0 text-text-muted font-mono text-xs">{numMatch[1]}.</span>
          {renderInline(numMatch[2])}
        </div>,
      );
      continue;
    }

    blocks.push(<div key={i}>{renderInline(line)}</div>);
  }

  return (
    <div
      className={
        reading
          ? 'text-[15px] sm:text-base text-text-secondary leading-relaxed space-y-1.5'
          : 'text-sm text-text-secondary leading-relaxed space-y-1'
      }
    >
      {blocks}
    </div>
  );
}

export function renderInline(text: string): React.ReactNode {
  // Negrito, `código` e links markdown [texto](url) — conteúdo com pesquisa
  // web cita fontes inline; precisam ser clicáveis.
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g);
  return parts.map((p, i) => {
    const bold = p.match(/^\*\*(.+?)\*\*$/);
    if (bold) {
      return (
        <strong key={i} className="text-text-primary font-semibold">
          {bold[1]}
        </strong>
      );
    }
    const code = p.match(/^`([^`]+)`$/);
    if (code) {
      return (
        <code
          key={i}
          className="font-mono text-[0.85em] bg-bg-elevated border border-border-base rounded-sm px-1 py-px text-text-primary"
        >
          {code[1]}
        </code>
      );
    }
    const link = p.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (link) {
      return (
        <a
          key={i}
          href={link[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-ai-accent underline decoration-ai-accent/40 hover:decoration-ai-accent transition-colors break-all"
        >
          {link[1]}
        </a>
      );
    }
    return <span key={i}>{p}</span>;
  });
}
