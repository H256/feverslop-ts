/** Verbatim intent; bindings are generated when a scoped rule is saved, never inferred from reused IDs. */
export type DirectionScope = {
    kind: 'global';
} | {
    kind: 'character' | 'beat' | 'scene' | 'shot';
    id: string;
} | {
    kind: 'time';
    start: number;
    end: number;
};
export type DirectionRule = {
    id: string;
    text: string;
    scope: DirectionScope;
    characterId?: string;
    binding?: string;
};
export type DirectionShot = {
    id: string;
    groupId: string;
    characters: string[];
    start?: number;
    end?: number;
    data: Record<string, unknown>;
};
export type DirectionChange = {
    shotId: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
};
export type DirectionProposal = {
    id: string;
    sourceFingerprint: string;
    rulesFingerprint: string;
    changes: DirectionChange[];
    conflicts: string[];
};
export type DirectionVersion = DirectionProposal & {
    createdAt: string;
};
export type DirectionView = {
    rules: DirectionRule[];
    shots: DirectionShot[];
    characters: {
        id: string;
        name: string;
    }[];
    groups: {
        id: string;
        label: string;
    }[];
    unresolved: {
        ruleId: string;
        message: string;
    }[];
    proposal?: DirectionProposal;
    versions: DirectionVersion[];
    activeVersion?: string;
    pending: boolean;
    restored: boolean;
    proposalStale?: boolean;
};
