import type { BiosGuidancePlan } from '../types';
export type BiosNote = { status: string; previousValue: string };
export type BiosNotes = Record<string, BiosNote>;
export const BIOS_NOTE_STATUSES: string[];
export function parseBiosNotes(serialized: string | null, ids: string[]): BiosNotes;
export function formatBiosPlan(plan: BiosGuidancePlan, notes?: BiosNotes): string;
