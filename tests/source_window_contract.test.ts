import { expect, test } from 'bun:test';
import contract from '../apps/desktop-burl/contracts/source-window.browser-window.v1.json';
import proof from '../evidence/oracle-inputs/native-window-contract-proof.json';

test('BrowserWindow observations project without product-specific chrome', () => {
    expect(contract.observations).toEqual(expect.objectContaining({
        titleBarStyle: 'hiddenInset', transparent: true, vibrancy: 'menu', resizable: true,
        trafficLightPosition: { x: 15, y: 15 }, contentFillsWindowBounds: true,
    }));
    expect(contract.projection).toEqual({
        titleBarStyle: 'hidden_inset', backdropEffect: 'liquid_glass', appearance: 'dark',
        transparent: true, trafficLightX: 15, trafficLightY: 15,
        minimumContentSize: {
            width: 280, height: 421,
            derivation: 'complete 280x420 source chat frame plus one logical pixel projection boundary guard; native Yoga preserves the source fractional geometry',
            sourceRevision: 'fd63a75dad3d0e8555ba22a47e720d285889fbf0',
            evidence: 'evidence/oracle-inputs/responsive/source-minimum-content-size.v1.json',
        },
    });
});

test('launched Skia captures fill each requested window back buffer', () => {
    expect(proof.backend).toBe('skia-dawn-metal');
    expect(proof.captures.map((capture) => capture.logicalWidth)).toEqual([599, 768, 1200]);
    for (const capture of proof.captures) {
        expect(capture.pixelWidth).toBe(capture.logicalWidth * 2);
        expect(capture.pixelHeight).toBe(capture.logicalHeight * 2);
        expect(capture.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(proof.assertions).toEqual(expect.objectContaining({
        fullBackBufferNoCrop: true, contentTracksWindowBounds: true,
        duplicateInContentTrafficLights: false,
    }));
});
