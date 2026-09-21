import { describe, it, expect, beforeEach } from 'vitest';
import {
  dispatchApprovalEvent,
  approvalsForSession,
  subscribeApprovals,
  resetApprovals,
  handleApprovalSSE,
} from './approval-store.js';

const required = (id, sessionId = 's1') => ({
  type: 'approval_required',
  approval: { approval_id: id, session_id: sessionId, action_kind: 'shell_command', title: 'Run', requested_action: 'npm publish' },
});

describe('approval store pipeline', () => {
  beforeEach(() => resetApprovals());

  it('required → pending approval appears for the session', () => {
    dispatchApprovalEvent(required('a1'));
    const list = approvalsForSession('s1');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('a1');
    expect(list[0].status).toBe('pending');
    expect(list[0].requestedAction).toBe('npm publish');
  });

  it('resolved → approval leaves pending', () => {
    dispatchApprovalEvent(required('a1'));
    dispatchApprovalEvent({ type: 'approval_resolved', approvalId: 'a1' });
    expect(approvalsForSession('s1')).toHaveLength(0);
  });

  it('rejected → resolved state, not pending', () => {
    dispatchApprovalEvent(required('a1'));
    dispatchApprovalEvent({ type: 'approval_rejected', approvalId: 'a1' });
    expect(approvalsForSession('s1')).toHaveLength(0);
  });

  it('duplicate required does not duplicate', () => {
    dispatchApprovalEvent(required('a1'));
    dispatchApprovalEvent(required('a1'));
    expect(approvalsForSession('s1')).toHaveLength(1);
  });

  it('stale resolve on unknown id is ignored', () => {
    dispatchApprovalEvent({ type: 'approval_resolved', approvalId: 'ghost' });
    expect(approvalsForSession('s1')).toHaveLength(0);
  });

  it('notifies subscribers on change', () => {
    let calls = 0;
    const unsub = subscribeApprovals(() => calls++);
    dispatchApprovalEvent(required('a1'));
    expect(calls).toBe(1);
    unsub();
  });

  it('handleApprovalSSE parses snake_case wire format', () => {
    const ok = handleApprovalSSE({
      type: 'approval_required',
      approval_id: 'a9',
      session_id: 's1',
      action_kind: 'file_write',
      title: 'Write',
      path: 'src/x.ts',
      created_at: 1,
    });
    expect(ok).toBe(true);
    const list = approvalsForSession('s1');
    expect(list[0].id).toBe('a9');
    expect(list[0].kind).toBe('file_write');
  });
});
