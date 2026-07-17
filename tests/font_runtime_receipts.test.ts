import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const native = JSON.parse(readFileSync('apps/desktop-burl/resources/import/main-chat.observed.design-ir.v1.json', 'utf8'));
const source = JSON.parse(readFileSync('evidence/oracle-inputs/source-font-receipt.json', 'utf8'));
const candidate = JSON.parse(readFileSync('evidence/oracle-inputs/candidate-font-receipt.json', 'utf8'));

test('NativeIR uses the source runtime SF and Menlo faces instead of generic assumptions', () => {
    expect(new Set(source.usedFaces.map((face: any) => face.family))).toEqual(new Set(['.SF NS', 'Menlo']));
    const styles: any[] = [];
    const visit = (node: any): void => {
        if (node.style?.fontFamily) styles.push(node.style);
        node.children?.forEach(visit);
    };
    visit(native.root);
    expect(styles.some((style) => style.fontFamily === '.SF NS')).toBe(true);
    expect(styles.some((style) => style.fontFamily === 'Menlo')).toBe(true);
    expect(styles.some((style) => String(style.fontFamily).includes('AppleSystemUIFont'))).toBe(false);
    const faces = native.fontFamilyAssets;
    expect(new Set(faces.map((face: any) => face.family))).toEqual(new Set(['.SF NS', 'Menlo']));
    expect(faces.every((face: any) => face.provenance?.runtime === 'cdp-platform-fonts')).toBe(true);
    expect(faces.some((face: any) => face.platform_face === 'Menlo-Bold')).toBe(true);
    expect(faces.some((face: any) => face.platform_face === 'Menlo-Regular')).toBe(true);
    expect(native.diagnostics).toEqual([]);
});

test('launched Skia app receipt has no source-face substitution', () => {
    expect(candidate.records.length).toBeGreaterThan(100);
    expect(candidate.records.some((record: any) => record.selected_family === '.SF NS')).toBe(true);
    expect(candidate.records.some((record: any) => record.selected_family === 'Menlo')).toBe(true);
    expect(candidate.records.some((record: any) => record.selected_family === 'Helvetica')).toBe(false);
    expect(candidate.records.some((record: any) => record.selected_family === '.AppleSystemUIFontMonospaced')).toBe(false);
});
