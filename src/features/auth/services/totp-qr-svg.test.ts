import { describe, expect, it } from 'vitest';

import { normalizeTotpQrSvg } from './totp-qr-svg';

const wrapper = 'data:image/svg+xml;utf-8,';
const root = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2">';
const rect = '<rect x="0" y="0" width="1" height="1" style="fill:black"/>';
const svg = `${root}${rect}</svg>`;
const comment = (length: number) => `<!--${'x'.repeat(length)}-->`;

describe('TOTP QR SVG provider contract', () => {
  it.each([
    ['', svg],
    ['<?xml version="1.0"?>\n', svg],
    ["<?xml version='1.0' encoding='UTF-8' standalone='no'?>\n", svg],
    [comment(512) + comment(512), svg],
    [comment(256).repeat(4), svg],
    ['', svg.replace('width="2"', 'width="4096px"')],
    [
      '',
      svg.replace(
        'fill:black',
        'fill:rgb(100%,0%,0%);fill-opacity:0.5;stroke:#fff;stroke-opacity:1;stroke-width:0',
      ),
    ],
  ])('normalizes an allowed provider value %# without rewriting its SVG', (prefix, expected) => {
    expect(normalizeTotpQrSvg(` \n${wrapper}${prefix}${expected}\n `)).toBe(expected);
  });

  it.each([
    ['unwrapped SVG', svg],
    ['encoded wrapper', `data:image/svg+xml,${encodeURIComponent(svg)}`],
    ['base64 wrapper', `data:image/svg+xml;base64,${btoa(svg)}`],
    ['extra wrapper parameter', `data:image/svg+xml;charset=utf-8,${svg}`],
  ])('rejects %s', (_label, input) => {
    expect(normalizeTotpQrSvg(input)).toBeUndefined();
  });

  it.each([
    ['wrong XML version', '<?xml version="1.1"?>'],
    ['wrong XML encoding', '<?xml version="1.0" encoding="UTF-16"?>'],
    ['standalone declaration', '<?xml version="1.0" standalone="yes"?>'],
    ['unknown declaration attribute', '<?xml version="1.0" extra="x"?>'],
    ['duplicate declaration attribute', '<?xml version="1.0" VERSION="1.0"?>'],
    ['declaration residue', '<?xml version="1.0" garbage?>'],
    ['repeated declaration', '<?xml version="1.0"?><?xml version="1.0"?>'],
    ['declaration after comment', '<!--x--><?xml version="1.0"?>'],
    ['oversized single comment', comment(513)],
    ['oversized aggregate comments', comment(512) + comment(512) + comment(1)],
    ['too many comments', comment(1).repeat(5)],
    ['invalid comment delimiter', '<!--a--b-->'],
    ['unterminated comment', '<!--x'],
    ['doctype', '<!DOCTYPE svg>'],
    ['entity declaration', '<!ENTITY x "x">'],
    ['processing instruction', '<?external x?>'],
  ])('rejects %s before a valid QR', (_label, prefix) => {
    expect(normalizeTotpQrSvg(wrapper + prefix + svg)).toBeUndefined();
  });

  it.each([
    ['script', svg.replace(rect, rect + '<script/>')],
    ['foreign object', svg.replace(rect, rect + '<foreignObject/>')],
    ['image', svg.replace(rect, rect + '<image href="https://example.test/image"/>')],
    ['use reference', svg.replace(rect, rect + '<use href="#x"/>')],
    ['path', svg.replace(rect, '<path d="M0 0"/>')],
    ['root event handler', svg.replace('width="2"', 'onload="alert(1)" width="2"')],
    ['rectangle link', svg.replace('<rect ', '<rect href="https://example.test/x" ')],
    ['CSS URL', svg.replace('fill:black', 'fill:url(https://example.test/x)')],
    ['unknown style property', svg.replace('fill:black', 'fill:black;filter:none')],
    ['duplicate style property', svg.replace('fill:black', 'fill:black;FILL:white')],
    ['missing fill', svg.replace('fill:black', 'stroke:black')],
    ['invalid color', svg.replace('fill:black', 'fill:rgb(256,0,0)')],
    ['invalid opacity', svg.replace('fill:black', 'fill:black;fill-opacity:1.01')],
    ['negative coordinate', svg.replace('x="0"', 'x="-1"')],
    ['oversized dimension', svg.replace('width="2"', 'width="4097"')],
    ['zero dimension', svg.replace('width="2"', 'width="0"')],
    ['wrong namespace', svg.replace('http://www.w3.org/2000/svg', 'https://example.test/svg')],
    ['empty root', `${root}</svg>`],
    ['nested rectangle', `${root}${rect.replace('/>', `>${rect}</rect>`)}</svg>`],
    ['in-document comment', `${root}<!--x-->${rect}</svg>`],
    ['text node', `${root}text${rect}</svg>`],
    ['CDATA', `${root}<![CDATA[x]]>${rect}</svg>`],
    ['malformed XML', `${root}${rect}`],
    ['non-ASCII content', svg.replace('fill:black', 'fill:bläck')],
    ['control character', `${root}\u0001${rect}</svg>`],
  ])('rejects %s in an otherwise valid provider wrapper', (_label, input) => {
    expect(normalizeTotpQrSvg(wrapper + input)).toBeUndefined();
  });

  it('enforces the byte limit including the wrapper', () => {
    const padding = ' '.repeat(512 * 1024 - wrapper.length - svg.length);
    const atLimit = `${wrapper}${root}${padding}${rect}</svg>`;
    expect(normalizeTotpQrSvg(atLimit)).toBe(atLimit.slice(wrapper.length));
    expect(normalizeTotpQrSvg(atLimit.replace(root, `${root} `))).toBeUndefined();
  });
});
