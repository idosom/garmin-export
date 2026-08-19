/**
 * A tiny pull/SAX XML scanner.
 *
 * `DOMParser` is a window API and is not available inside Web Workers, where
 * all parsing happens, so TCX/GPX are scanned with this instead. It is
 * deliberately forgiving: unknown namespaces, missing declarations and stray
 * whitespace are all fine, which matches the variety of files Garmin and
 * third-party tools produce.
 */

export interface SaxHandlers {
  onOpen?(name: string, attrs: Record<string, string>, selfClosing: boolean): void;
  onClose?(name: string): void;
  onText?(text: string): void;
}

/** Element/attribute names are reported without their namespace prefix. */
export function scanXml(source: string, handlers: SaxHandlers): void {
  const len = source.length;
  let i = 0;
  let textStart = 0;

  const flushText = () => {
    if (!handlers.onText) {
      textStart = i;
      return;
    }
    if (i > textStart) {
      const raw = source.slice(textStart, i);
      if (raw.trim()) handlers.onText(decodeEntities(raw));
    }
    textStart = i;
  };

  while (i < len) {
    const lt = source.indexOf('<', i);
    if (lt < 0) {
      i = len;
      flushText();
      break;
    }
    i = lt;
    flushText();

    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4);
      i = end < 0 ? len : end + 3;
      textStart = i;
      continue;
    }
    if (source.startsWith('<![CDATA[', i)) {
      const end = source.indexOf(']]>', i + 9);
      const content = source.slice(i + 9, end < 0 ? len : end);
      if (content.trim()) handlers.onText?.(content);
      i = end < 0 ? len : end + 3;
      textStart = i;
      continue;
    }
    if (source.startsWith('<?', i)) {
      const end = source.indexOf('?>', i + 2);
      i = end < 0 ? len : end + 2;
      textStart = i;
      continue;
    }
    if (source.startsWith('<!', i)) {
      const end = source.indexOf('>', i + 2);
      i = end < 0 ? len : end + 1;
      textStart = i;
      continue;
    }

    const gt = findTagEnd(source, i + 1);
    if (gt < 0) {
      i = len;
      break;
    }
    const inner = source.slice(i + 1, gt);
    i = gt + 1;
    textStart = i;

    if (inner.startsWith('/')) {
      handlers.onClose?.(localName(inner.slice(1).trim()));
      continue;
    }
    const selfClosing = inner.endsWith('/');
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const { name, attrs } = parseTag(body);
    if (!name) continue;
    handlers.onOpen?.(name, attrs, selfClosing);
    if (selfClosing) handlers.onClose?.(name);
  }
}

function findTagEnd(source: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return i;
    }
  }
  return -1;
}

function parseTag(body: string): { name: string; attrs: Record<string, string> } {
  let i = 0;
  while (i < body.length && !/\s/.test(body[i])) i++;
  const name = localName(body.slice(0, i));
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z_:][-\w.:]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  re.lastIndex = i;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const value = m[3] ?? m[4] ?? m[5] ?? '';
    attrs[localName(m[1])] = decodeEntities(value);
  }
  return { name, attrs };
}

function localName(qualified: string): string {
  const idx = qualified.indexOf(':');
  return idx < 0 ? qualified : qualified.slice(idx + 1);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (whole, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

/** Detects the root element name without parsing the whole document. */
export function xmlRootName(source: string): string | undefined {
  const head = source.slice(0, 4096);
  const m = /<\s*([A-Za-z_][-\w.:]*)/.exec(head.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<![^>]*>/g, ''));
  return m ? localName(m[1]) : undefined;
}
