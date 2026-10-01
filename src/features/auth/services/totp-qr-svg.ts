const MAX_TOTP_QR_SVG_BYTES = 512 * 1024;
const MAX_TOTP_QR_SVG_ELEMENTS = 12_000;
const MAX_TOTP_QR_LEADING_COMMENTS = 4;
const MAX_TOTP_QR_COMMENT_BYTES = 512;
const MAX_TOTP_QR_COMMENTS_TOTAL_BYTES = 1024;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';
const SVG_ROOT_ATTRIBUTES = new Set(['height', 'width', 'xmlns', 'xmlns:xlink']);
const SVG_RECT_ATTRIBUTES = new Set(['height', 'style', 'width', 'x', 'y']);
const SVG_RECT_STYLE_PROPERTIES = new Set([
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-opacity',
  'stroke-width',
]);

function boundedSvgNumber(value: string, minimum: number): boolean {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?(?:px)?$/.test(value)) return false;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= 4096;
}

function safeSvgColor(value: string): boolean {
  if (/^(?:black|white|none|#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8})$/i.test(value)) {
    return true;
  }

  const rgb = /^rgb\(([^)]+)\)$/i.exec(value);
  if (!rgb?.[1]) return false;
  const components = rgb[1].split(',').map((component) => component.trim());
  if (components.length !== 3) return false;
  return components.every((component) => {
    const percentage = component.endsWith('%');
    const number = percentage ? component.slice(0, -1) : component;
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(number)) return false;
    const parsed = Number.parseFloat(number);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= (percentage ? 100 : 255);
  });
}

function safeSvgOpacity(value: string): boolean {
  if (!/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(value)) return false;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1;
}

function safeSvgRectStyle(value: string): boolean {
  if (value.length < 1 || value.length > 256) return false;
  const declarations = value
    .split(';')
    .map((declaration) => declaration.trim())
    .filter(Boolean);
  if (declarations.length < 1 || declarations.length > SVG_RECT_STYLE_PROPERTIES.size) {
    return false;
  }

  const properties = new Set<string>();
  for (const declaration of declarations) {
    const separator = declaration.indexOf(':');
    if (separator <= 0 || declaration.indexOf(':', separator + 1) !== -1) return false;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const propertyValue = declaration.slice(separator + 1).trim();
    if (!SVG_RECT_STYLE_PROPERTIES.has(property) || properties.has(property) || !propertyValue) {
      return false;
    }
    properties.add(property);

    if (
      ((property === 'fill' || property === 'stroke') && !safeSvgColor(propertyValue)) ||
      ((property === 'fill-opacity' || property === 'stroke-opacity') &&
        !safeSvgOpacity(propertyValue)) ||
      (property === 'stroke-width' && !boundedSvgNumber(propertyValue, 0))
    ) {
      return false;
    }
  }

  return properties.has('fill');
}

function safeSvgElementAttributes(element: Element, isRoot: boolean): boolean {
  const attributes = new Map(
    Array.from(element.attributes).map((attribute) => [
      attribute.name.toLowerCase(),
      attribute.value.trim(),
    ]),
  );
  const allowed = isRoot ? SVG_ROOT_ATTRIBUTES : SVG_RECT_ATTRIBUTES;
  if (
    attributes.size !== element.attributes.length ||
    [...attributes.keys()].some((name) => !allowed.has(name))
  ) {
    return false;
  }

  if (isRoot) {
    return (
      attributes.get('xmlns') === SVG_NAMESPACE &&
      (!attributes.has('xmlns:xlink') || attributes.get('xmlns:xlink') === XLINK_NAMESPACE) &&
      boundedSvgNumber(attributes.get('width') ?? '', 1) &&
      boundedSvgNumber(attributes.get('height') ?? '', 1)
    );
  }

  return (
    boundedSvgNumber(attributes.get('x') ?? '', 0) &&
    boundedSvgNumber(attributes.get('y') ?? '', 0) &&
    boundedSvgNumber(attributes.get('width') ?? '', 1) &&
    boundedSvgNumber(attributes.get('height') ?? '', 1) &&
    safeSvgRectStyle(attributes.get('style') ?? '')
  );
}

function readProviderSvg(input: string): string | undefined {
  const providerValue = input.trim();
  const wrapper = /^data:image\/svg\+xml;utf-8,/i.exec(providerValue);
  if (!wrapper || new TextEncoder().encode(providerValue).byteLength > MAX_TOTP_QR_SVG_BYTES) {
    return undefined;
  }

  const svg = providerValue.slice(wrapper[0].length).trim();
  if (
    svg.length < 32 ||
    new TextEncoder().encode(svg).byteLength > MAX_TOTP_QR_SVG_BYTES ||
    Array.from(svg).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (
        codePoint !== 9 &&
        codePoint !== 10 &&
        codePoint !== 13 &&
        (codePoint < 32 || codePoint > 126)
      );
    }) ||
    /<!doctype|<!entity|<!\[cdata\[|<\?(?!xml\b)|<script\b|<foreignobject\b/i.test(svg)
  ) {
    return undefined;
  }

  return svg;
}

function stripXmlDeclaration(svg: string): string | undefined {
  let withoutDeclaration = svg;
  const declaration = /^<\?xml\s+([^?]+)\?>\s*/i.exec(svg);
  if (declaration) {
    const declarationText = declaration[1];
    if (!declarationText) return undefined;
    const declarationAttributes = [
      ...declarationText.matchAll(/([a-z]+)\s*=\s*(["'])([^"']+)\2/gi),
    ];
    if (
      declarationAttributes.some(
        (attribute) => !attribute[0] || !attribute[1] || attribute[3] === undefined,
      )
    ) {
      return undefined;
    }
    const residue = declarationAttributes.reduce(
      (value, attribute) => value.replace(attribute[0] ?? '', ''),
      declarationText,
    );
    const values = new Map(
      declarationAttributes.map((attribute) => [
        (attribute[1] ?? '').toLowerCase(),
        attribute[3] ?? '',
      ]),
    );
    if (
      residue.trim() ||
      values.size !== declarationAttributes.length ||
      values.get('version') !== '1.0' ||
      (values.has('encoding') && values.get('encoding')?.toUpperCase() !== 'UTF-8') ||
      (values.has('standalone') && values.get('standalone') !== 'no') ||
      [...values.keys()].some(
        (name) => name !== 'version' && name !== 'encoding' && name !== 'standalone',
      )
    ) {
      return undefined;
    }
    withoutDeclaration = svg.slice(declaration[0].length);
  }

  return withoutDeclaration;
}

function stripLeadingComments(svg: string): string | undefined {
  let normalizedSvg = svg;
  let commentCount = 0;
  let commentBytes = 0;
  while (normalizedSvg.startsWith('<!--')) {
    const comment = /^<!--([\s\S]*?)-->\s*/.exec(normalizedSvg);
    if (!comment?.[0] || comment[1] === undefined) return undefined;
    const currentCommentBytes = new TextEncoder().encode(comment[1]).byteLength;
    commentCount += 1;
    commentBytes += currentCommentBytes;
    if (
      commentCount > MAX_TOTP_QR_LEADING_COMMENTS ||
      currentCommentBytes > MAX_TOTP_QR_COMMENT_BYTES ||
      commentBytes > MAX_TOTP_QR_COMMENTS_TOTAL_BYTES ||
      comment[1].includes('--')
    ) {
      return undefined;
    }
    normalizedSvg = normalizedSvg.slice(comment[0].length);
  }

  return normalizedSvg;
}

function safeQrElement(element: Element, root: Element): boolean {
  const isRoot = element === root;
  return !(
    element.namespaceURI !== SVG_NAMESPACE ||
    (!isRoot && element.localName.toLowerCase() !== 'rect') ||
    (!isRoot && element.parentElement !== root) ||
    (!isRoot && element.childNodes.length !== 0) ||
    !safeSvgElementAttributes(element, isRoot)
  );
}

function validateQrElements(normalizedSvg: string): string | undefined {
  if (!normalizedSvg.startsWith('<svg') || /<\?/.test(normalizedSvg)) {
    return undefined;
  }

  const document = new DOMParser().parseFromString(normalizedSvg, 'image/svg+xml');
  if (document.getElementsByTagName('parsererror').length !== 0) {
    return undefined;
  }

  const root = document.documentElement;
  const elements = Array.from(document.getElementsByTagName('*'));
  if (
    root.localName.toLowerCase() !== 'svg' ||
    root.namespaceURI !== SVG_NAMESPACE ||
    elements.length < 2 ||
    elements.length > MAX_TOTP_QR_SVG_ELEMENTS
  ) {
    return undefined;
  }

  for (const element of elements) {
    if (!safeQrElement(element, root)) return undefined;
  }

  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === 1) continue;
    if (node.nodeType !== 3 || node.textContent?.trim()) return undefined;
  }

  return normalizedSvg;
}

// Accept only the provider QR shape; this is not a general-purpose SVG sanitizer.
export function normalizeTotpQrSvg(input: string): string | undefined {
  const svg = readProviderSvg(input);
  if (svg === undefined) return undefined;
  const withoutDeclaration = stripXmlDeclaration(svg);
  if (withoutDeclaration === undefined) return undefined;
  const normalizedSvg = stripLeadingComments(withoutDeclaration);
  if (normalizedSvg === undefined) return undefined;
  return validateQrElements(normalizedSvg);
}
