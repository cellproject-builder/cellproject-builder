import { load } from 'cheerio';

export function plainMetadata(value, max = 1200) {
  if (typeof value !== 'string') return '';
  return load(value, null, false).text().replace(/\s+/g, ' ').trim().slice(0, max);
}
/** Optional object aliases, not instructions or an unrestricted query expansion. */
export function parseTargetTerms(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length < 1 || value.length > 8 || value.some(term => typeof term !== 'string' || !term.trim() || term.length > 120) || value.reduce((size, term) => size + term.length, 0) > 600) throw new Error('Invalid image target terms');
  return value.map(term => term.trim());
}

/** Alternatives are grouped so a requested model cannot match another object's alias. */
export function parseTargets(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) throw new Error('Invalid image targets');
  let aliasSize = 0, identifierSize = 0;
  return value.map(group => {
    if (!group || typeof group !== 'object' || Array.isArray(group)) throw new Error('Invalid image target');
    const aliases = parseTargetTerms(group.aliases);
    if (!aliases.length || !Array.isArray(group.identifiers) || group.identifiers.length > 8 || group.identifiers.some(identifier => typeof identifier !== 'string' || !identifier.trim() || identifier.length > 80)) throw new Error('Invalid image target identifiers');
    if (group.query !== undefined && (typeof group.query !== 'string' || !group.query.trim() || group.query.length > 500)) throw new Error('Invalid image target query');
    aliasSize += group.aliases.reduce((size, alias) => size + alias.length, 0);
    identifierSize += group.identifiers.reduce((size, identifier) => size + identifier.length, 0);
    if (aliasSize > 600 || identifierSize > 300) throw new Error('Invalid image target size');
    return { aliases, identifiers: group.identifiers.map(identifier => identifier.trim()), ...(group.query === undefined ? {} : { query: group.query.trim() }) };
  });
}

function normalizedWords(text) {
  return String(text ?? '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/(\p{L})(\p{N})/gu, '$1 $2').replace(/(\p{N})(\p{L})/gu, '$1 $2').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).map(word => {
    if (word === 'motores') return 'motor';
    // Common textual plurals only; model identifiers such as ESP32-S3 stay intact.
    return /^[a-z]{5,}s$/.test(word) && !/(?:ss|us|is)$/.test(word) ? word.slice(0, -1) : word;
  }).join(' ');
}
const phraseMatches = (text, term) => { const normalized = normalizedWords(term); return !!normalized && ` ${normalizedWords(text)} `.includes(` ${normalized} `); };
const canonicalText = text => String(text ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
function identifierMatches(text, identifier) {
  const chunks = canonicalText(identifier).match(/[\p{L}]+|\p{N}+|[^\s_-]/gu) ?? [];
  if (!chunks.length) return false;
  const pattern = chunks.map(chunk => chunk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s_-]*');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${pattern}(?=$|[^\\p{L}\\p{N}])`, 'u').test(canonicalText(text));
}
// Secondary contents and compatibility names do not identify the depicted product.
const primarySubject = text => String(text ?? '').split(/\b(?:equipped\s+with|with|using|featuring|containing|contains|compatible\s+with|for|com|contem|contém|usando|contendo|para)\b/iu, 1)[0];
const chromeTerms = ['logo', 'logotipo', 'banner', 'avatar', 'favicon', 'icon', 'icone', 'sprite', 'tracking pixel', 'placeholder'];
const accessoryTerms = ['driver', 'controller', 'controlador', 'controladora', 'adapter', 'adaptador', 'breakout', 'shield', 'hat', 'bracket', 'suporte', 'expansion board', 'interface board'];
const accessoryRequestTerms = [...accessoryTerms, 'board', 'placa'];
const cableTerms = ['cable', 'cabo', 'cord'];
const intentTexts = options => [options.query ?? '', ...(options.targets ? options.targets.flatMap(group => [...group.aliases, ...group.identifiers]) : options.targetTerms ?? [])];
const requestsAny = (options, terms) => intentTexts(options).some(text => terms.some(term => phraseMatches(text, term)));
const groupRequests = (group, terms) => [...group.aliases, ...group.identifiers].some(text => terms.some(term => phraseMatches(text, term)));
const isUSBDataCableAlias = alias => phraseMatches(alias, 'USB')
  && cableTerms.some(term => phraseMatches(alias, term)) && /\b(?:data|dados?)\b/.test(normalizedWords(alias));
function nominalCableAlias(alias) {
  // Omitted data capability is unknown, not a contradictory connector/model.
  // Remove this functional wording only; every other qualifier stays required.
  return isUSBDataCableAlias(alias) ? normalizedWords(alias).replace(/\b(?:de\s+)?dados?\b|\bdata\b/g, ' ').replace(/\s+/g, ' ').trim() : alias;
}
function contradictsDataCable(text) {
  const normalized = normalizedWords(text);
  const contradictions = /\b(?:charging only|charge only|power only|only charging|only charge|only power|somente carga|apenas carga|so carga|somente carregamento|apenas carregamento|sem dados?|no data|does not (?:support|transfer) data|nao (?:suporta|transfere) dados?)\b/g;
  for (const match of normalized.matchAll(contradictions)) {
    // "Not charging only" explicitly denies the contradiction.
    if (/\b(?:not|nao(?: e)?)\s*$/.test(normalized.slice(0, match.index))) continue;
    return true;
  }
  return false;
}
function aliasMatches(text, alias) {
  if (phraseMatches(text, alias)) return true;
  // Product titles commonly invert "USB cable" into "Cable USB". Keep this
  // exception local to cable aliases, rather than making all matching unordered.
  const nominal = nominalCableAlias(alias);
  return cableTerms.some(term => phraseMatches(nominal, term) && phraseMatches(text, term))
    && normalizedWords(nominal).split(' ').every(word => phraseMatches(text, word));
}
const isVideoText = text => /^(?:video\b|(?:thumbnail|preview) of (?:a )?video\b)/.test(normalizedWords(text));
function imageKey(raw) {
  const url = new URL(raw); url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^(?:utm_.+|fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.href;
}
function filename(raw) {
  try { return decodeURIComponent(new URL(raw).pathname.split('/').pop() || '').slice(0, 400); }
  catch { return ''; }
}
function scoreImage(metadata, options, signals) {
  const evidence = metadata.imageEvidence ?? [{ text: metadata.title, weight: 8 }, { text: metadata.description, weight: 5 }, { text: filename(metadata.remoteUrl), weight: 2 }];
  const chromeText = [metadata.title, filename(metadata.remoteUrl), metadata.chromeText].join(' ');
  if (!requestsAny(options, chromeTerms) && (signals.inSiteChrome || chromeTerms.some(term => phraseMatches(chromeText, term)) || (metadata.width && metadata.height && metadata.width <= 24 && metadata.height <= 24))) return null;
  if (!requestsAny(options, ['video']) && signals.videoThumbnail) return null;
  const groups = options.targets ?? (options.targetTerms.length ? [{ aliases: options.targetTerms, identifiers: [] }] : []);
  const primaryMatches = group => signals.primaryTexts.some(text => group.aliases.some(alias => aliasMatches(primarySubject(text), alias)));
  const namedPrimary = groups.some(primaryMatches);
  // A generic "product image" alt must not hide accessory evidence in the
  // filename. An actual object caption remains stronger than that filename.
  const accessoryTexts = namedPrimary ? signals.primaryTexts : [...signals.primaryTexts, metadata.title, filename(metadata.remoteUrl)];
  const hasAccessory = accessoryTexts.some(text => accessoryTerms.some(term => phraseMatches(primarySubject(text), term)));
  const hasCable = accessoryTexts.some(text => cableTerms.some(term => phraseMatches(primarySubject(text), term)));
  const passingGroups = groups.flatMap((group, index) => {
    if (namedPrimary && !primaryMatches(group)) return [];
    if ([...group.aliases, group.query ?? ''].some(isUSBDataCableAlias) && [...signals.primaryTexts, metadata.title, metadata.description, filename(metadata.remoteUrl)].some(contradictsDataCable)) return [];
    // A generic board name cannot authorize a different requested accessory.
    // Keep broad legacy "motor board" queries compatible when no object groups exist.
    const requestAccessory = options.targets ? groupRequests(group, accessoryTerms) : requestsAny(options, accessoryRequestTerms);
    const requestCable = options.targets ? groupRequests(group, cableTerms) : requestsAny(options, cableTerms);
    if ((hasAccessory && !requestAccessory) || (hasCable && !requestCable)) return [];
    // Asset-specific primary captions win over a conflicting product-card heading or OG filename.
    if (signals.primaryTexts.some(text => group.aliases.some(alias => aliasMatches(text, alias)) && !group.aliases.some(alias => aliasMatches(primarySubject(text), alias)))) return [];
    return group.aliases.some(alias => evidence.some(field => aliasMatches(primarySubject(field.text), alias))) && group.identifiers.every(identifier => evidence.some(field => identifierMatches(primarySubject(field.text), identifier))) ? [index] : [];
  });
  if (groups.length && !passingGroups.length) return null;
  const matches = groups.length ? evidence.filter(field => passingGroups.some(index => groups[index].aliases.some(alias => aliasMatches(primarySubject(field.text), alias)))) : evidence;
  const score = matches.reduce((total, field) => total + (field.text ? field.weight : 0), 0);
  if (!groups.length && ((hasAccessory && !requestsAny(options, accessoryRequestTerms)) || (hasCable && !requestsAny(options, cableTerms)))) return null;
  return { score, matchedTargetIndexes: passingGroups };
}

/** Keep scored candidates from different requested objects visible together. */
export function selectBalancedImages(items, { limit = 12, perSource = Infinity, getTargets = item => item.matchedTargetIndexes ?? [], getSource = item => item.sourcePageUrl } = {}) {
  const selected = [], picked = new Set(), sourceCounts = new Map(), targetCounts = new Map();
  const targetIndexes = [...new Set(items.flatMap(getTargets))].sort((a, b) => a - b);
  const add = item => {
    selected.push(item); picked.add(item);
    const source = getSource(item); sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
    for (const target of getTargets(item)) targetCounts.set(target, (targetCounts.get(target) ?? 0) + 1);
  };
  const allowed = (item, uncovered = false) => !picked.has(item) && (uncovered || (sourceCounts.get(getSource(item)) ?? 0) < perSource);
  if (targetIndexes.length > 1) {
    while (selected.length < limit) {
      let progress = false;
      for (const target of [...targetIndexes].sort((a, b) => (targetCounts.get(a) ?? 0) - (targetCounts.get(b) ?? 0) || a - b)) {
        const candidate = items.find(item => getTargets(item).includes(target) && allowed(item, !targetCounts.get(target)));
        if (!candidate) continue;
        add(candidate); progress = true;
        if (selected.length >= limit) return selected;
      }
      if (!progress) break;
    }
  }
  for (const item of items) {
    if (selected.length >= limit) break;
    if (allowed(item)) add(item);
  }
  return selected;
}

/** Filter by image-owned text, then rank/dedupe before applying gallery limits. */
export function rankImageMetadata(images, options = {}) {
  const targetTerms = parseTargetTerms(options.targetTerms), targets = parseTargets(options.targets), scoped = { ...options, targetTerms, targets };
  const signalsByAsset = new Map();
  for (const metadata of images) {
    const key = imageKey(metadata.remoteUrl), signals = signalsByAsset.get(key) ?? { inSiteChrome: false, videoThumbnail: false, primaryTexts: [] };
    signals.inSiteChrome ||= Boolean(metadata.inSiteChrome);
    signals.videoThumbnail ||= Boolean(metadata.videoThumbnail) || isVideoText(metadata.primaryText || metadata.title);
    const primaryTexts = metadata.imageEvidence ? metadata.imageEvidence.filter(field => field.primary).map(field => field.text) : [metadata.title, metadata.description];
    signals.primaryTexts.push(...primaryTexts.filter(Boolean));
    signalsByAsset.set(key, signals);
  }
  const best = new Map();
  for (const metadata of images) {
    const match = scoreImage(metadata, scoped, signalsByAsset.get(imageKey(metadata.remoteUrl)));
    if (match === null) continue;
    const key = imageKey(metadata.remoteUrl), previous = best.get(key);
    if (!previous || match.score > previous.score) best.set(key, { metadata: { ...metadata, matchedTargetIndexes: match.matchedTargetIndexes }, score: match.score });
  }
  const ranked = [...best.values()].sort((a, b) => b.score - a.score);
  const sourceCount = new Set(ranked.map(item => item.metadata.sourcePageUrl)).size;
  // A single useful page keeps the old 12-image gallery; diverse sources get room.
  const perSource = options.diversify === false || sourceCount <= 1 ? Infinity : 4;
  return selectBalancedImages(ranked.map(item => item.metadata), { limit: options.limit ?? 12, perSource });
}

export function extractImageMetadata(page, _source = {}, options = {}) {
  if (!['text/html', 'application/xhtml+xml'].includes(page.mime)) return [];
  const $ = load(page.bytes.toString('utf8'));
  const images = [];
  const add = (raw, evidence, width, height, chrome = {}) => {
    if (typeof raw !== 'string' || !raw.trim() || /[\x00-\x20\x7f]/.test(raw)) return;
    try {
      const url = new URL(raw, page.finalUrl);
      if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || /\.(svg|gif|ico)(?:$|[?#])/i.test(url.href)) return;
      const ownText = evidence.map(field => ({ ...field, text: plainMetadata(field.text, 800) })).filter(field => field.text);
      images.push({ remoteUrl: url.href, title: ownText[0]?.text.slice(0, 200) || filename(url.href).slice(0, 200) || 'Image reference', description: [...new Set(ownText.map(field => field.text))].join(' · ').slice(0, 1200), primaryText: ownText.find(field => field.primary)?.text ?? '', imageEvidence: [...ownText, { text: filename(url.href), weight: 2 }], ...chrome, sourcePageUrl: page.finalUrl, credit: null, license: null, width: dimension(width), height: dimension(height) });
    } catch { /* Unsupported/malformed URL is not an image candidate. */ }
  };
  // Image/figure/product text describes the asset; a page heading does not.
  $('img').slice(0, 256).each((_i, el) => {
    const image = $(el), figure = image.closest('figure');
    const product = image.closest('[itemtype*="schema.org/Product"],.product,.product-card,.product-item,.product-detail');
    const evidence = [
      { text: image.attr('alt'), weight: 8, primary: true },
      { text: figure.find('figcaption').first().text(), weight: 8, primary: true },
      { text: image.attr('title') || image.parent('a').attr('title'), weight: 6, primary: true },
      { text: product.find('[itemprop="name"],h1,h2,h3').first().text(), weight: 6 },
    ];
    add(image.attr('src') || image.attr('data-src'), evidence, image.attr('width'), image.attr('height'), {
      inSiteChrome: image.closest('header,nav,footer,[role="navigation"],[role="banner"]').length > 0,
      videoThumbnail: image.closest('[itemtype*="VideoObject"],video,[data-video],.video-thumbnail,.video-thumb,.video-preview,.video').length > 0 || /(?:^|\/\/)(?:www\.)?(?:youtube\.com|youtu\.be|vimeo\.com)\//i.test(image.closest('a[href]').attr('href') ?? ''),
      chromeText: [image.attr('class'), image.attr('id'), image.parent().attr('class'), image.parent().attr('id')].filter(Boolean).join(' '),
    });
  });
  // OG without asset-specific evidence can be useful generically, but does not
  // acquire the whole page's subject to pass a targeted component search.
  $('meta[property="og:image"],meta[name="twitter:image"],meta[property="twitter:image"]').each((_i, el) => add($(el).attr('content'), []));
  return rankImageMetadata(images, { ...options, limit: 256, diversify: false });
}
function dimension(value) { const n = Number(value); return Number.isInteger(n) && n > 0 && n <= 100_000 ? n : null; }

export function commonsMetadata(payload) {
  return Object.values(payload?.query?.pages ?? {}).flatMap(page => {
    const image = page.imageinfo?.[0];
    if (!image || !['image/png', 'image/jpeg', 'image/webp'].includes(image.mime)) return [];
    const remoteUrl = image.thumburl || image.url;
    if (typeof remoteUrl !== 'string' || !remoteUrl.startsWith('https://')) return [];
    const meta = image.extmetadata ?? {};
    return [{ remoteUrl, title: plainMetadata(page.title?.replace(/^File:/, ''), 200), description: plainMetadata(meta.ImageDescription?.value, 1200), sourcePageUrl: image.descriptionurl, credit: plainMetadata(meta.Artist?.value, 400) || null, license: plainMetadata(meta.LicenseShortName?.value, 200) || null, width: dimension(image.thumbwidth || image.width), height: dimension(image.thumbheight || image.height) }];
  }).slice(0, 12);
}
