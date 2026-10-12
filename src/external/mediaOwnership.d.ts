export interface MediaOwnershipSnapshot { documents: readonly { key: string; value: string }[] }
export interface MediaOwnershipMetadata { id: string; projectId?: string | null }
export function createMediaScopeResolver(snapshot: MediaOwnershipSnapshot): (metadata: MediaOwnershipMetadata, projectId: string | null) => boolean;
export function mediaBelongsToScope(snapshot: MediaOwnershipSnapshot, metadata: MediaOwnershipMetadata, projectId: string | null): boolean;
