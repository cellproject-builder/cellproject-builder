// Renderizador leve do markdown que a IA produz (tutor, pesquisa web):
// títulos em **CAIXA ALTA** ou #/##/###, bullets (com sub-níveis), listas
// numeradas, tabelas simples, negrito, *itálico*, `código` inline, blocos ```
// e links [texto](url) clicáveis. Sem dependência externa de markdown.
//
// `variant`: 'panel' (compacto, dentro da sidebar) · 'reading' (tipografia
// confortável pro modo leitura em tela cheia).
// `idPrefix`: quando presente, cada título ganha id `${idPrefix}-h-${n}` — o
// índice do modo leitura rola até eles (ver extractHeadings).

type Variant = 'panel' | 'reading';

// Título de seção: linha inteira em **negrito** (formato pedido ao tutor) ou
// heading markdown #/##/### que modelos emitem por conta própria.
function headingText(line: string): string | null {
  const boldMatch = line.match(/^\*\*(.+?)\*\*:?\s*$/);
  const hashMatch = line.match(/^#{1,4}\s+(.*)$/);
  if (!boldMatch && !hashMatch) return null;
  // Tira o negrito (o estilo do título já é destaque) mas mantém links e
  // `código` formatados via renderInline.
  return (boldMatch ? boldMatch[1] : hashMatch![1]).replace(/\*\*/g, '').trim();
}

const isFence = (line: string) => line.trimStart().startsWith('```');
const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const isTableSeparator = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

// Nível de indentação (2 espaços ou 1 tab = 1 nível), limitado a 4.
const indentLevel = (line: string) => {
  const lead = line.match(/^[\t ]*/)?.[0] ?? '';
  const spaces = lead.replace(/\t/g, '  ').length;
  return Math.min(4, Math.floor(spaces / 2));
};

/** Textos dos títulos, na mesma ordem/numeração dos ids gerados. */
export function extractHeadings(text: string): string[] {
  const out: string[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (isFence(lines[i])) {
      i++;
      while (i < lines.length && !isFence(lines[i])) i++;
      continue;
    }
    const h = headingText(lines[i]);
    if (h) out.push(h.replace(/`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'));
  }
  return out;
}

export function ExplanationContent({
  text,
  variant = 'panel',
  idPrefix,
}: {
  text: string;
  variant?: Variant;
  idPrefix?: string;
}) {
  const reading = variant === 'reading';
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let headingIdx = 0;

  const headingCls = reading
    ? 'text-base font-semibold text-text-primary pt-5 first:pt-0 scroll-mt-4'
    : 'text-sm font-semibold text-text-primary pt-2 first:pt-0';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Bloco de código cercado — acumula até a cerca de fechamento (ou EOF).
    if (isFence(line)) {
      const code: string[] = [];
      let j = i + 1;
      while (j < lines.length && !isFence(lines[j])) {
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

    // Tabela simples: cabeçalho | separador |---| e linhas seguintes.
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const head = splitRow(line);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j])) {
        rows.push(splitRow(lines[j]));
        j++;
      }
      const cell = reading ? 'px-2.5 py-1.5' : 'px-2 py-1';
      blocks.push(
        <div key={i} className="overflow-x-auto my-1.5">
          <table className={`border-collapse ${reading ? 'text-sm' : 'text-xs'}`}>
            <thead>
              <tr>
                {head.map((h, k) => (
                  <th
                    key={k}
                    className={`${cell} text-left font-semibold text-text-primary border border-border-base bg-bg-elevated`}
                  >
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {head.map((_, k) => (
                    <td key={k} className={`${cell} align-top border border-border-base`}>
                      {renderInline(r[k] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      i = j - 1;
      continue;
    }

    const heading = headingText(line);
    if (heading !== null) {
      const id = idPrefix ? `${idPrefix}-h-${headingIdx}` : undefined;
      headingIdx++;
      blocks.push(
        <div key={i} id={id} className={headingCls}>
          {renderInline(heading)}
        </div>,
      );
      continue;
    }

    // Sub-bullets preservam a indentação do modelo (2 espaços = 1 nível).
    const bulletMatch = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bulletMatch) {
      const level = indentLevel(line);
      blocks.push(
        <div key={i} className="pl-4 relative" style={level ? { marginLeft: level * 16 } : undefined}>
          <span className="absolute left-0 text-text-muted">{level > 0 ? '◦' : '•'}</span>
          {renderInline(bulletMatch[1])}
        </div>,
      );
      continue;
    }

    const numMatch = line.match(/^\s*(\d+)[.)]\s(.*)$/);
    if (numMatch) {
      const level = indentLevel(line);
      blocks.push(
        <div key={i} className="pl-6 relative" style={level ? { marginLeft: level * 16 } : undefined}>
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
  // Negrito, *itálico*, `código` e links markdown [texto](url) — conteúdo com
  // pesquisa web cita fontes inline; precisam ser clicáveis. O negrito vem
  // antes na alternância, então `**x**` nunca vira itálico.
  const parts = text.split(
    /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|\*(?![\s*])[^*\n]*[^\s*]\*)/g,
  );
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
    const italic = p.match(/^\*([^*]+)\*$/);
    if (italic) {
      return (
        <em key={i} className="italic">
          {italic[1]}
        </em>
      );
    }
    return <span key={i}>{p}</span>;
  });
}
