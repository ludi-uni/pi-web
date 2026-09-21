import { describe, it, expect } from 'vitest';
import {
  normalizeApproval,
  reduceApprovalEvent,
  pendingApprovals,
} from './approval-model.js';

describe('normalizeApproval', () => {
  it('maps snake_case payload fields', () => {
    const a = normalizeApproval({
      approval_id: 'ap1',
      session_id: 's1',
      kind: 'command',
      title: 'Deploy',
      description: 'Run npm publish',
      requested_action: 'npm publish',
      risk_level: 'high',
      created_at: 123,
    });
    expect(a.id).toBe('ap1');
    expect(a.requestedAction).toBe('npm publish');
    expect(a.risk).toBe('high');
    expect(a.status).toBe('pending');
  });

  it('never infers risk — unknown risk becomes null', () => {
    expect(normalizeApproval({ risk_level: 'scary' }).risk).toBeNull();
    expect(normalizeApproval({}).risk).toBeNull();
  });
});

describe('reduceApprovalEvent', () => {
  it('adds a pending approval on approval_required', () => {
    const next = reduceApprovalEvent(new Map(), {
      type: 'approval_required',
      approval: { approval_id: 'a1', requested_action: 'rm -rf' },
    });
    expect(next.get('a1').status).toBe('pending');
    expect(next.get('a1').requestedAction).toBe('rm -rf');
  });

  it('resolves and rejects by id', () => {
    let m = reduceApprovalEvent(new Map(), {
      type: 'approval_required',
      approval: { approval_id: 'a1' },
    });
    m = reduceApprovalEvent(m, { type: 'approval_resolved', approvalId: 'a1' });
    expect(m.get('a1').status).toBe('approved');
    m = reduceApprovalEvent(m, { type: 'approval_rejected', approvalId: 'a1' });
    expect(m.get('a1').status).toBe('rejected');
  });

  it('ignores unknown event types', () => {
    const m = new Map();
    const next = reduceApprovalEvent(m, { type: 'nope' });
    expect(next.size).toBe(0);
  });
});

describe('pendingApprovals', () => {
  it('returns only pending, oldest first', () => {
    let m = new Map();
    m = reduceApprovalEvent(m, {
      type: 'approval_required',
      approval: { approval_id: 'b', created_at: 2 },
    });
    m = reduceApprovalEvent(m, {
      type: 'approval_required',
      approval: { approval_id: 'a', created_at: 1 },
    });
    m = reduceApprovalEvent(m, { type: 'approval_resolved', approvalId: 'b' });
    const pending = pendingApprovals(m);
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe('a');
  });
});
