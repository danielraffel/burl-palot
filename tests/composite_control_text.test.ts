import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const native = JSON.parse(readFileSync(
    'apps/desktop-burl/resources/import/main-chat.observed.design-ir.v1.json', 'utf8'));

test('composite interactive controls retain captured text as native children', () => {
    const expected = ['New Session', 'Automations', 'This Mac', 'Settings'];
    const found = new Map<string, Array<{ node: any, button: any }>>();
    const visit = (node: any, ancestors: any[]): void => {
        if (expected.includes(node.content)) {
            const matches = found.get(node.content) ?? [];
            matches.push({
                node,
                button: [...ancestors].reverse().find((ancestor) => ancestor.type === 'button'),
            });
            found.set(node.content, matches);
        }
        node.children?.forEach((child: any) => visit(child, [...ancestors, node]));
    };
    visit(native.root, []);
    expect([...found.keys()].sort()).toEqual([...expected].sort());
    for (const label of expected) {
        const matches = found.get(label) ?? [];
        expect(matches.every(({ node }) => node.type === 'text')).toBe(true);
        expect(matches.some(({ button }) => button?.type === 'button')).toBe(true);
    }
    const newSessionButton = found.get('New Session')?.find(({ button }) => button)?.button;
    expect(newSessionButton.attributes).toMatchObject({
        pulpHostAction: 'navigation.new-session', pulpRouteId: '/',
        pulpBindingPolicyRule: 'session-create',
    });
});
