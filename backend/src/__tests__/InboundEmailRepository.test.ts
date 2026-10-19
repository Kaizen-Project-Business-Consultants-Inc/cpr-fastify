import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('../config/database.js', () => ({ getPool: () => ({ query }) }));

import { InboundEmailRepository } from '../repositories/InboundEmailRepository.js';

describe('InboundEmailRepository.create', () => {
  beforeEach(() => {
    query.mockReset();
    query.mockResolvedValue([{ insertId: 7 }]);
  });

  it('stores extracted details as JSON text, not "[object Object]"', async () => {
    const extracted = { courseTypeText: 'CPR Basic', registeredStudents: 10 };
    const id = await new InboundEmailRepository().create({
      resend_email_id: 'em_1', from_address: 'a@b.com', status: 'created_request', extracted,
    });

    expect(id).toBe(7);
    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain('`extracted`');
    const stored = values[(sql as string).match(/\(([^)]*)\)/)![1].split(', ').indexOf('`extracted`')];
    expect(typeof stored).toBe('string');
    expect(JSON.parse(stored)).toEqual(extracted);
  });

  it('leaves rows without extracted details unchanged', async () => {
    await new InboundEmailRepository().create({ resend_email_id: 'em_2', from_address: 'a@b.com', status: 'unmatched_sender' });
    const [sql, values] = query.mock.calls[0];
    expect(sql).not.toContain('`extracted`');
    expect(values).toEqual(['em_2', 'a@b.com', 'unmatched_sender']);
  });

  it('findNeedsReview turns stored JSON text back into an object', async () => {
    query.mockResolvedValueOnce([[
      { id: 1, extracted: '{"location":"123 Main St"}' },
      { id: 2, extracted: null },
      { id: 3, extracted: 'not json' },
    ]]);
    const rows = await new InboundEmailRepository().findNeedsReview();
    expect(rows.map((r) => r.extracted)).toEqual([{ location: '123 Main St' }, null, null]);
  });

  it('keeps an explicit null as SQL NULL', async () => {
    await new InboundEmailRepository().create({ resend_email_id: 'em_3', from_address: 'a@b.com', status: 'needs_review', extracted: null });
    expect(query.mock.calls[0][1]).toContain(null);
  });

  it('stamps an auto-booked email as handled using the database clock', async () => {
    await new InboundEmailRepository().create({ resend_email_id: 'em_4', from_address: 'a@b.com', status: 'created_request', course_request_id: 40 });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).not.toContain('handled_at');
    expect(query.mock.calls[1]).toEqual(['UPDATE inbound_emails SET handled_at = NOW() WHERE id = ?', [7]]);
  });

  it('does not stamp an email that still needs review', async () => {
    await new InboundEmailRepository().create({ resend_email_id: 'em_5', from_address: 'a@b.com', status: 'needs_review' });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('stamps the handled time and staff member when an email is handled', async () => {
    query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    const ok = await new InboundEmailRepository().transition(5, 'received', 'created_request', { course_request_id: 40, handled_by: 2 });
    expect(ok).toBe(true);
    const [sql, values] = query.mock.calls[0];
    expect(sql).toBe('UPDATE inbound_emails SET status = ?, handled_at = NOW(), handled_by = ?, course_request_id = ? WHERE id = ? AND status = ?');
    expect(values).toEqual(['created_request', 2, 40, 5, 'received']);
  });

  it('does not stamp a handled time when an email is only claimed', async () => {
    query.mockResolvedValueOnce([{ affectedRows: 0 }]);
    const ok = await new InboundEmailRepository().transition(5, 'needs_review', 'received');
    expect(ok).toBe(false);
    expect(query.mock.calls[0][0]).not.toContain('handled_at');
  });

  it('blanks booked emails and deletes dismissed ones after 90 days, never waiting ones', async () => {
    query.mockResolvedValueOnce([{ affectedRows: 3 }]).mockResolvedValueOnce([{ affectedRows: 2 }]);
    const result = await new InboundEmailRepository().purgeHandled();
    expect(result).toEqual({ blanked: 3, deleted: 2 });
    const [[blankSql, blankArgs], [deleteSql, deleteArgs]] = query.mock.calls;
    expect(blankSql).toMatch(/UPDATE inbound_emails SET body_text = NULL[\s\S]*status = 'created_request'/);
    expect(deleteSql).toMatch(/DELETE FROM inbound_emails[\s\S]*status = 'rejected'/);
    for (const sql of [blankSql, deleteSql]) expect(sql).not.toMatch(/needs_review|unmatched_sender/);
    expect(blankArgs).toEqual([90]);
    expect(deleteArgs).toEqual([90]);
  });
});
