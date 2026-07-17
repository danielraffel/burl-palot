import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';

type Atomicity = {
    preSettleSha256: string;
    preScreenshotSha256: string;
    postScreenshotSha256: string;
    stableBeforeScreenshot: boolean;
    stableAfterScreenshot: boolean;
};

type TargetObservation = {
    sourceId: string;
    captureInstanceId: string;
    normalizedText: string;
    ariaExpandedBefore: string | null;
    events: Array<{
        type: string;
        isTrusted: boolean;
        targetSourceId: string;
        intendedTargetCaptureInstanceId: string;
        intendedTargetInComposedPath: boolean;
    }>;
};

type EvidenceRecord = {
    state: string;
    directory: string;
    atomicity: Atomicity;
    targetObservation?: TargetObservation;
};

type CaptureElement = {
    sourceId: string;
    captureInstanceId?: string;
    tagName?: string;
    dataSlot?: string | null;
    normalizedText?: string;
    id?: string | null;
    ariaExpanded?: string | null;
    ariaControls?: string | null;
    hidden: boolean;
    rect: { width: number; height: number };
};

const evidenceRoot = join(import.meta.dirname, '..', 'evidence', 'phase-b',
    'source-interaction-states', 'disclosure-reversibility');

const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const loadJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

describe('captured disclosure reversibility evidence', () => {
    for (const name of ['thought', 'read', 'edit']) {
        test(`${name} has an atomic trusted closed-open-closed cohort`, () => {
            const evidence = loadJson<{ records: EvidenceRecord[] }>(
                join(evidenceRoot, name, 'evidence.json'));
            expect(evidence.records.map((record) => record.state))
                .toEqual(['closed', 'open', 'closed-again']);

            const [closed, open, closedAgain] = evidence.records;
            for (const record of evidence.records) {
                expect(record.atomicity.stableBeforeScreenshot).toBe(true);
                expect(record.atomicity.stableAfterScreenshot).toBe(true);
                expect(record.atomicity.preSettleSha256)
                    .toBe(record.atomicity.preScreenshotSha256);
                expect(record.atomicity.preScreenshotSha256)
                    .toBe(record.atomicity.postScreenshotSha256);
            }
            expect(closed.atomicity.postScreenshotSha256)
                .toBe(closedAgain.atomicity.postScreenshotSha256);
            expect(sha256(join(closed.directory, 'source.png')))
                .toBe(sha256(join(closedAgain.directory, 'source.png')));

            expect(open.targetObservation).toBeDefined();
            expect(closedAgain.targetObservation).toBeDefined();
            expect(open.targetObservation!.sourceId)
                .toBe(closedAgain.targetObservation!.sourceId);
            expect(open.targetObservation!.ariaExpandedBefore).toBe('false');
            expect(closedAgain.targetObservation!.ariaExpandedBefore).toBe('true');
            for (const observation of [open.targetObservation!, closedAgain.targetObservation!]) {
                expect(observation.events.map((event) => event.type))
                    .toEqual(['pointerdown', 'pointerup', 'click']);
                expect(observation.events.every((event) => event.isTrusted)).toBe(true);
                expect(observation.events.every((event) =>
                    event.intendedTargetCaptureInstanceId === observation.captureInstanceId &&
                    event.intendedTargetInComposedPath)).toBe(true);
                expect(observation.events.every((event) =>
                    event.targetSourceId === observation.sourceId)).toBe(true);
            }

            const openCapture = loadJson<{ elements: CaptureElement[] }>(
                join(open.directory, 'source.json'));
            const closedCapture = loadJson<{ elements: CaptureElement[] }>(
                join(closedAgain.directory, 'source.json'));
            const openTrigger = openCapture.elements.find((element) =>
                element.sourceId === open.targetObservation!.sourceId);
            const closedTrigger = closedCapture.elements.find((element) =>
                element.sourceId === closedAgain.targetObservation!.sourceId);
            expect(openTrigger?.ariaExpanded).toBe('true');
            expect(openTrigger?.ariaControls).toBeTruthy();
            expect(closedTrigger?.ariaExpanded).toBe('false');
            const openContent = openCapture.elements.find((element) =>
                element.id === openTrigger?.ariaControls);
            expect(openContent).toBeDefined();
            expect(openContent?.hidden).toBe(false);
            expect((openContent?.rect.width ?? 0) * (openContent?.rect.height ?? 0))
                .toBeGreaterThan(0);
        });
    }

    test('show steps has an atomic trusted collapsed-expanded-collapsed cohort', () => {
        const evidence = loadJson<{ records: EvidenceRecord[] }>(
            join(evidenceRoot, 'show-steps', 'evidence.json'));
        expect(evidence.records.map((record) => record.state))
            .toEqual(['collapsed', 'expanded', 'collapsed-again']);

        const [collapsed, expanded, collapsedAgain] = evidence.records;
        for (const record of evidence.records) {
            expect(record.atomicity.stableBeforeScreenshot).toBe(true);
            expect(record.atomicity.stableAfterScreenshot).toBe(true);
            expect(record.atomicity.preSettleSha256)
                .toBe(record.atomicity.preScreenshotSha256);
            expect(record.atomicity.preScreenshotSha256)
                .toBe(record.atomicity.postScreenshotSha256);
        }
        // The source remounts this trigger, so structural receipts legitimately
        // differ even though the user-visible resting state is restored.
        expect(sha256(join(collapsed.directory, 'source.png')))
            .toBe(sha256(join(collapsedAgain.directory, 'source.png')));
        expect(sha256(join(collapsed.directory, 'source.png')))
            .not.toBe(sha256(join(expanded.directory, 'source.png')));

        expect(expanded.targetObservation).toBeDefined();
        expect(collapsedAgain.targetObservation).toBeDefined();
        const openTarget = expanded.targetObservation!;
        const closeTarget = collapsedAgain.targetObservation!;
        expect(openTarget.sourceId).toBe(closeTarget.sourceId);
        expect(openTarget.captureInstanceId).not.toBe(closeTarget.captureInstanceId);
        expect(openTarget.normalizedText).toMatch(/^Show 3 steps/);
        expect(closeTarget.normalizedText).toMatch(/^Hide 3 steps/);
        expect(openTarget.ariaExpandedBefore).toBeNull();
        expect(closeTarget.ariaExpandedBefore).toBeNull();
        for (const observation of [openTarget, closeTarget]) {
            expect(observation.events.map((event) => event.type))
                .toEqual(['pointerdown', 'pointerup', 'click']);
            expect(observation.events.every((event) => event.isTrusted)).toBe(true);
            expect(observation.events.every((event) =>
                event.intendedTargetCaptureInstanceId === observation.captureInstanceId &&
                event.intendedTargetInComposedPath)).toBe(true);
        }

        const captures = evidence.records.map((record) => loadJson<{ elements: CaptureElement[] }>(
            join(record.directory, 'source.json')));
        const toolCards = (capture: { elements: CaptureElement[] }) => capture.elements.filter((element) =>
            element.tagName === 'button' &&
            (/^Read/.test(element.normalizedText ?? '') || /^Edit/.test(element.normalizedText ?? '')) &&
            !element.hidden && element.rect.width * element.rect.height > 0);
        expect(toolCards(captures[0])).toHaveLength(0);
        expect(toolCards(captures[1]).map((element) => element.normalizedText)).toEqual([
            'Readcomponents/settings.tsx3s',
            'Editlib/theme.ts3s',
            'Editcomponents/settings.tsx3s',
        ]);
        expect(toolCards(captures[2])).toHaveLength(0);
    });
});
