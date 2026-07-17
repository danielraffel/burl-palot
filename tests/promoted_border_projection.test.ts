import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const native = JSON.parse(readFileSync('apps/desktop-burl/resources/import/main-chat.observed.design-ir.v1.json', 'utf8'));

test('promoted buttons preserve captured zero borders instead of widget defaults', () => {
    let promoted = 0;
    let explicitZero = 0;
    const visit = (node: any): void => {
        if (node.type === 'button') {
            ++promoted;
            const raw = JSON.parse(node.raw_source);
            const style = raw.computedStyle ?? {};
            const zero = ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth']
                .every((key) => style[key] === '0px');
            if (zero) {
                ++explicitZero;
                expect(node.visualSkin?.states?.rest?.borderWidth).toBe(0);
            }
        }
        node.children?.forEach(visit);
    };
    visit(native.root);
    expect(promoted).toBeGreaterThan(40);
    expect(explicitZero).toBeGreaterThan(40);
});
