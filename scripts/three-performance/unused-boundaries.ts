// Only unused image/decomposition boundaries are replaced in this fixture.
// Their real imports hydrate account stores. The compositor/modelItem/WebGL
// remain unmodified; synthetic artifacts contain no media or decomposition.
export function readVisualMedia(): never { throw new Error('Image storage is outside this synthetic renderer fixture.'); }
export function decompositionAssemblyCurrent(): never { throw new Error('Documentary decomposition is outside this synthetic renderer fixture.'); }
