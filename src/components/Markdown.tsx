// Renderizador leve do markdown que a IA produz (tutor, pesquisa web):
// títulos em **CAIXA ALTA**, bullets, listas numeradas, negrito e links
// [texto](url) clicáveis. Sem dependência externa de markdown.

export function ExplanationContent({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="text-sm text-text-secondary leading-relaxed space-y-1">
      {lines.map((line, i) => {
        if (line.trim() === '') return <div key={i} className="h-2" />;
        const boldMatch = line.match(/^\*\*(.+?)\*\*$/);
        if (boldMatch) {
          return (
            <div
              key={i}
              className="text-[10px] font-mono uppercase tracking-widest text-ai-accent pt-2 first:pt-0"
            >
              {boldMatch[1]}
            </div>
          );
        }
        if (line.startsWith('- ')) {
          return (
            <div key={i} className="pl-4 relative">
              <span className="absolute left-0 text-text-muted">•</span>
              {renderInline(line.slice(2))}
            </div>
          );
        }
        const numMatch = line.match(/^(\d+)\.\s(.*)$/);
        if (numMatch) {
          return (
            <div key={i} className="pl-6 relative">
              <span className="absolute left-0 text-text-muted font-mono text-xs">
                {numMatch[1]}.
              </span>
              {renderInline(numMatch[2])}
            </div>
          );
        }
        return <div key={i}>{renderInline(line)}</div>;
      })}
    </div>
  );
}

export function renderInline(text: string): React.ReactNode {
  // Negrito e links markdown [texto](url) — conteúdo com pesquisa web cita
  // fontes inline; precisam ser clicáveis.
  const parts = text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g);
  return parts.map((p, i) => {
    const bold = p.match(/^\*\*(.+?)\*\*$/);
    if (bold) {
      return (
        <strong key={i} className="text-text-primary font-semibold">
          {bold[1]}
        </strong>
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
