// Renderizador leve do markdown que a IA produz (tutor, pesquisa web):
// títulos em **CAIXA ALTA** ou #/##/###, bullets (com sub-níveis), listas
// numeradas, tabelas simples, negrito, *itálico*, `código` inline, blocos ```
// e links [texto](url) clicáveis. Sem dependência externa de markdown.
//
// `variant`: 'panel' (compacto, dentro da sidebar) ou 'reading' (tipografia
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

// Títulos em CAIXA ALTA (formato pedido ao tutor) viram sentence case na
// tela — sem mudar o prompt. Títulos com minúsculas ficam como vieram.
export function sentenceCase(text: string): string {
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length < 2 || letters !== letters.toUpperCase()) return text;
  const lower = text.toLocaleLowerCase();
  const i = lower.search(/\p{L}/u);
  return i < 0 ? lower : lower.slice(0, i) + lower.charAt(i).toLocaleUpperCase() + lower.slice(i + 1);
}

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
  preserveHeadingCase = false,
}: {
  text: string;
  variant?: Variant;
  idPrefix?: string;
  preserveHeadingCase?: boolean;
}) {
  const reading = variant === 'reading';
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let headingIdx = 0;

  const headingCls = reading
    ? 'text-title3 font-semibold text-text-primary pt-5 first:pt-0 scroll-mt-20'
    : 'text-control font-semibold text-text-primary pt-2 first:pt-0';

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
          className={`font-mono bg-bg-elevated/70 rounded-control px-3.5 py-2.5 overflow-x-auto whitespace-pre text-text-primary ${
            reading ? 'text-[13px] leading-relaxed my-3' : 'text-footnote my-1.5'
          }`}
        >
          {code.join('\n')}
        </pre>,
      );
      i = j; // pula a cerca de fechamento
      continue;
    }

    if (line.trim() === '') {
      blocks.push(<div key={i} aria-hidden className={reading ? 'h-2' : 'h-1'} />);
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
      const cell = reading ? 'px-3 py-2' : 'px-2.5 py-1.5';
      blocks.push(
        <div key={i} className="overflow-x-auto my-2 rounded-control ring-1 ring-inset ring-border-base/70">
          <table className={`w-full border-collapse ${reading ? 'text-control' : 'text-footnote'}`}>
            <thead>
              <tr>
                {head.map((h, k) => (
                  <th
                    key={k}
                    className={`${cell} text-left font-semibold text-text-primary bg-bg-elevated/60 border-b border-border-base/70`}
                  >
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-t border-border-base/50 first:border-t-0">
                  {head.map((_, k) => (
                    <td key={k} className={`${cell} align-top`}>
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
          {renderInline(preserveHeadingCase ? heading : sentenceCase(heading))}
        </div>,
      );
      continue;
    }

    // Sub-bullets preservam a indentação do modelo (2 espaços = 1 nível).
    const bulletMatch = line.match(/^\s*[-*+]\s+(.*)$/);
    // "- 1. Faça X" (bullet + número): vira item numerado, sem marcador duplo.
    const numInBullet = bulletMatch?.[1].match(/^(\*\*)?(\d+)[.)](\*\*)?\s+(.*)$/);
    if (bulletMatch && numInBullet) {
      const level = indentLevel(line);
      const rest = numInBullet[1] && !numInBullet[3] ? `**${numInBullet[4]}` : numInBullet[4];
      blocks.push(
        <div key={i} className="pl-6 relative" style={level ? { marginLeft: level * 16 } : undefined}>
          <span className="absolute left-0 w-5 text-right text-text-muted tabular-nums">{numInBullet[2]}.</span>
          {renderInline(rest)}
        </div>,
      );
      continue;
    }
    if (bulletMatch) {
      const level = indentLevel(line);
      blocks.push(
        <div
          key={i}
          className={`relative ${reading ? 'pl-5' : 'pl-4'}`}
          style={level ? { marginLeft: level * 16 } : undefined}
        >
          <span aria-hidden className="absolute left-1 text-text-faint">
            {level > 0 ? '◦' : '•'}
          </span>
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
          <span className="absolute left-0 w-5 text-right text-text-muted tabular-nums">{numMatch[1]}.</span>
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
          ? 'text-body text-text-secondary space-y-2'
          : 'text-control text-text-secondary leading-relaxed space-y-1.5'
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
          className="font-mono text-[0.85em] bg-bg-elevated rounded-chip px-1.5 py-px text-text-primary"
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
          className="text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent transition-colors duration-120 break-all"
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
