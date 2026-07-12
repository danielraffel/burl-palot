import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const native = JSON.parse(readFileSync(
    'apps/desktop-burl/resources/import/main-chat.observed.design-ir.v1.json', 'utf8'));

test('composite interactive controls retain captured text as native children', () => {
    const expected = ['New Session', 'Automations', 'This Mac', 'Settings'];
    const found = new Map<string, { node: any, button: any }>();
    const visit = (node: any, ancestors: any[]): void => {
        if (expected.includes(node.content)) {
            found.set(node.content, {
                node,
                button: [...ancestors].reverse().find((ancestor) => ancestor.type === 'button'),
            });
        }
        node.children?.forEach((child: any) => visit(child, [...ancestors, node]));
    };
    visit(native.root, []);
    expect([...found.keys()].sort()).toEqual([...expected].sort());
    for (const label of expected) {
        expect(found.get(label)?.node.type).toBe('text');
        expect(found.get(label)?.button?.type).toBe('button');
    }
    expect(found.get('New Session')?.button.attributes).toMatchObject({
        pulpHostAction: 'session.create', pulpRouteId: 'session.create',
        pulpBindingPolicyRule: 'session-create',
    });
});
