import { describe, expect, it } from 'vitest';
import { assessCandidate, candidates, reference, reviewInterfaces, reviewTopics, unresolved } from './benchmark';

describe('bounded scooter reference and coverage experiment (offline)', () => {
  it('distinguishes generic coverage from a reference-grounded review with questions', () => {
    expect(assessCandidate(candidates.generic).missingTopics).toEqual(expect.arrayContaining(['braking', 'control', 'charging', 'test']));
    expect(assessCandidate(candidates.generic).missingInterfaces).toHaveLength(6);
    const scoped = assessCandidate(candidates.scoped);
    expect(scoped.missingTopics).toEqual([]); expect(scoped.missingInterfaces).toEqual([]); expect(scoped.issues).toEqual([]);
    expect(candidates.scoped.questions).toEqual(expect.arrayContaining(reviewInterfaces.map(item => item.question)));
    expect(scoped.physicalCompatibility).toBe('unknown'); expect(scoped.physicalTestPassed).toBe(false);
  });
  it.each(reviewTopics)('detects omission of the review topic $id without inventing its component model', topic => {
    const result = assessCandidate({ ...candidates.scoped, topics: candidates.scoped.topics.filter(id => id !== topic.id) });
    expect(result.missingTopics).toEqual([topic.id]); expect(result.physicalCompatibility).toBe('unknown');
  });
  it.each(reviewInterfaces)('detects an unexamined interface $id', connection => {
    const result = assessCandidate({ ...candidates.scoped, interfaces: candidates.scoped.interfaces.filter(id => id !== connection.id) });
    expect(result.missingInterfaces).toEqual([connection.id]); expect(result.physicalTestPassed).toBe(false);
  });
  it('does not transfer a commercial rating into the homemade project', () => {
    expect(assessCandidate(candidates.unsupported).issues).toEqual(expect.arrayContaining(['reference_transferred_to_design', 'statement_needs_review']));
  });
  it('detects a source applied to another variant even when all review topics exist', () => {
    const result = assessCandidate(candidates.wrongVariant);
    expect(result.missingTopics).toEqual([]); expect(result.issues).toContain('variant_mismatch');
  });
  it('requires a registered source claim and refuses to turn an unrelated URL into documentation', () => {
    const result = assessCandidate({ ...candidates.scoped, statements: [{ text: 'Controlador modelo inventado', claimId: 'https://unrelated.test', appliesTo: 'reference', status: 'documented' }] });
    expect(result.issues).toContain('unsupported_source');
  });
  it('retains explicit uncertainty instead of counting an unknown as verified', () => {
    const result = assessCandidate({ ...candidates.scoped, statements: [{ text: 'Pinagem ainda não documentada', appliesTo: 'homemade', status: 'unknown' }] });
    expect(result.unknowns).toEqual(unresolved); expect(result.physicalCompatibility).toBe('unknown'); expect(result.physicalTestPassed).toBe(false);
  });
  it('reports invented topic/interface IDs and preserves the reference inputs', () => {
    const before = JSON.stringify({ reference, candidates });
    const result = assessCandidate({ ...candidates.scoped, topics: [...candidates.scoped.topics, 'imagined-part'], interfaces: ['invented-interface'] });
    expect(result.unknownTopicIds).toEqual(['imagined-part']); expect(result.unknownInterfaceIds).toEqual(['invented-interface']);
    expect(JSON.stringify({ reference, candidates })).toBe(before);
  });
});
