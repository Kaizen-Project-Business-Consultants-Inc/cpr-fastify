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
});
