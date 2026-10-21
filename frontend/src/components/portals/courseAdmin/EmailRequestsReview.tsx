import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  Chip,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  MenuItem,
  Tabs,
  Tab,
} from '@mui/material';
import api from '../../../services/api';
import DataTable, { DataTableRow } from '../../gtacpr/DataTable';
import { LinkButton } from '../../gtacpr';
import { getErrorMessage } from '../../../utils/errorMessage';

const columns = [
  { key: 'received', label: 'RECEIVED', width: '0.8fr' },
  { key: 'from', label: 'FROM', width: '1.1fr' },
  { key: 'subject', label: 'SUBJECT', width: '1.2fr' },
  { key: 'status', label: 'STATUS', width: '0.9fr' },
  { key: 'guess', label: 'BEST GUESS', width: '1.5fr' },
  { key: 'reason', label: 'WHY IT WASN\'T CREATED', width: '1.5fr' },
  { key: 'actions', label: '', width: '1.3fr', align: 'right' as const },
];

interface Extracted {
  courseTypeText?: string | null;
  scheduledDate?: string | null;
  location?: string | null;
  registeredStudents?: number | null;
  matchedCourseType?: { id: number; name: string; confidence: number } | null;
}

interface InboundEmailRow {
  id: number;
  from_address: string;
  subject: string | null;
  body_text: string | null;
  status: 'unmatched_sender' | 'needs_review';
  extracted: Extracted | null;
  matched_organization_id: number | null;
  reject_reason: string | null;
  created_at: string;
}

interface HandledRow {
  id: number;
  from_address: string;
  subject: string | null;
  body_text: string | null;
  status: 'created_request' | 'rejected';
  course_request_id: number | null;
  reject_reason: string | null;
  created_at: string;
  handled_at: string | null;
  handled_by_name: string | null;
}

const handledColumns = [
  { key: 'received', label: 'RECEIVED', width: '0.8fr' },
  { key: 'from', label: 'FROM', width: '1.1fr' },
  { key: 'subject', label: 'SUBJECT', width: '1.2fr' },
  { key: 'outcome', label: 'OUTCOME', width: '1.5fr' },
  { key: 'handled', label: 'HANDLED', width: '1.1fr' },
  { key: 'actions', label: '', width: '0.7fr', align: 'right' as const },
];

function outcomeText(row: HandledRow): string {
  if (row.status === 'created_request') {
    const req = row.course_request_id ? `Course request #${row.course_request_id}` : 'Course request created';
    // Auto-booked emails never went to review, so they have no reason saved.
    return !row.handled_by_name && !row.reject_reason ? `${req} (booked automatically)` : req;
  }
  return row.reject_reason || 'Dismissed';
}

const RETENTION_DAYS = 90;

/** True once the nightly clean-up would have removed this email's text. */
function textRemovedByRetention(row: InboundEmailRow | HandledRow): boolean {
  if (row.status !== 'created_request' && row.status !== 'rejected') return false;
  const handledAt = 'handled_at' in row && row.handled_at ? new Date(row.handled_at).getTime() : NaN;
  return !Number.isNaN(handledAt) && Date.now() - handledAt > RETENTION_DAYS * 24 * 60 * 60 * 1000;
}

interface Option {
  id: number;
  name: string;
  is_active?: number | boolean | null;
}

interface RequestForm {
  organizationId: number | '';
  courseTypeId: number | '';
  scheduledDate: string;
  location: string;
  registeredStudents: string;
}

const STATUS_LABEL: Record<string, string> = {
  unmatched_sender: 'Unrecognized sender',
  needs_review: 'Needs review',
};

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Owner 2026-10-19: when the course wasn't recognized, say what to do about it. */
const COURSE_HINT = 'Pick the matching course, or Dismiss if we don\'t offer it.';
function courseNotMatched(row: InboundEmailRow): boolean {
  return /isn't a clear match|Course type missing/.test(row.reject_reason ?? '');
}

function reasonText(row: InboundEmailRow): string {
  if (row.status === 'unmatched_sender') return 'Sender email isn\'t linked to an organization account';
  return row.reject_reason || 'Some details couldn\'t be read with confidence';
}

function formFromEmail(row: InboundEmailRow, courseTypes: Option[]): RequestForm {
  const x = row.extracted ?? {};
  const byName = x.courseTypeText
    ? courseTypes.find((c) => c.name.toLowerCase() === x.courseTypeText!.trim().toLowerCase())
    : undefined;
  const courseTypeId = x.matchedCourseType && x.matchedCourseType.confidence >= 0.6
    ? x.matchedCourseType.id
    : byName?.id;
  return {
    organizationId: row.matched_organization_id ?? '',
    courseTypeId: courseTypeId ?? '',
    scheduledDate: x.scheduledDate ?? '',
    location: x.location ?? '',
    registeredStudents: x.registeredStudents ? String(x.registeredStudents) : '',
  };
}

const EmailBody: React.FC<{ text: string | null; removed?: boolean }> = ({ text, removed }) => (
  <Box
    sx={{
      whiteSpace: 'pre-wrap', fontSize: 13, p: 1.5, borderRadius: '8px', maxHeight: 220, overflowY: 'auto',
      bgcolor: (theme) => theme.palette.action.hover, color: (theme) => theme.palette.text.primary,
    }}
  >
    {text?.trim() || (removed ? 'The email text was removed 90 days after it was handled.' : 'The email text is not available.')}
  </Box>
);

/**
 * Course-request emails that didn't become a request on their own. Staff can
 * read the email, create the request from it (after fixing what was wrong),
 * or dismiss it.
 */
const EmailRequestsReview: React.FC = () => {
  const [rows, setRows] = useState<InboundEmailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [tab, setTab] = useState<'review' | 'handled'>('review');
  const [handled, setHandled] = useState<HandledRow[] | null>(null);
  const [handledError, setHandledError] = useState(false);
  const [viewing, setViewing] = useState<InboundEmailRow | HandledRow | null>(null);
  const [creating, setCreating] = useState<InboundEmailRow | null>(null);
  const [dismissing, setDismissing] = useState<InboundEmailRow | null>(null);

  const [courseTypes, setCourseTypes] = useState<Option[] | null>(null);
  const [organizations, setOrganizations] = useState<Option[] | null>(null);
  const [form, setForm] = useState<RequestForm | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // The email whose Create dialog is open, so a slow first load can't fill
  // the form with a different email's details.
  const creatingId = useRef<number | null>(null);

  // Refresh after an action. A failed refresh keeps the list as it was.
  const load = useCallback(async () => {
    try {
      const r = await api.get('/inbound-email/needs-review');
      setRows(r.data.data ?? []);
    } catch {
      // the action itself succeeded and its notice is showing
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.get('/inbound-email/needs-review')
      .then((r) => { if (!cancelled) setRows(r.data.data ?? []); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const loadHandled = useCallback(async () => {
    try {
      const r = await api.get('/inbound-email/handled');
      setHandled(r.data.data ?? []);
      setHandledError(false);
    } catch {
      setHandledError(true);
    }
  }, []);

  const showTab = (next: 'review' | 'handled') => {
    setTab(next);
    if (next === 'handled') loadHandled();
  };

  const openCreate = async (row: InboundEmailRow) => {
    setNotice(null);
    setFormError(null);
    setCreating(row);
    setForm(null);
    creatingId.current = row.id;
    try {
      const [types, orgs] = await Promise.all([
        courseTypes ?? api.get('/course-types').then((r) =>
          (r.data.data as Option[]).filter((c) => c.is_active === undefined || c.is_active === null || !!c.is_active)),
        organizations ?? api.get('/inbound-email/organizations').then((r) => r.data.data as Option[]),
      ]);
      setCourseTypes(types);
      setOrganizations(orgs);
      if (creatingId.current === row.id) setForm(formFromEmail(row, types));
    } catch (err) {
      if (creatingId.current === row.id) setFormError(getErrorMessage(err, 'Failed to load courses and organizations'));
    }
  };

  const closeCreate = () => {
    if (saving) return;
    creatingId.current = null;
    setCreating(null);
    setForm(null);
  };

  // Blank = not known yet: booked as 0 and shown as TBC.
  const students = form && form.registeredStudents.trim() !== '' ? Number(form.registeredStudents) : 0;
  const datePassed = !!form?.scheduledDate && form.scheduledDate < todayLocal();
  const formReady = !!form && form.organizationId !== '' && form.courseTypeId !== '' && !!form.scheduledDate
    && !datePassed && !!form.location.trim() && Number.isInteger(students) && students >= 0;

  const handleCreate = async () => {
    if (!creating || !form || !formReady) return;
    setSaving(true);
    setFormError(null);
    try {
      const r = await api.post(`/inbound-email/${creating.id}/create-request`, {
        organizationId: form.organizationId,
        courseTypeId: form.courseTypeId,
        scheduledDate: form.scheduledDate,
        location: form.location.trim(),
        registeredStudents: students,
      });
      setNotice(r.data.message ?? 'Course request created.');
      setHandled(null);
      creatingId.current = null;
      setCreating(null);
      setForm(null);
      await load();
    } catch (err) {
      setFormError(getErrorMessage(err, 'Failed to create the course request'));
    } finally {
      setSaving(false);
    }
  };

  const openDismiss = (row: InboundEmailRow) => {
    setNotice(null);
    setFormError(null);
    setNote('');
    setDismissing(row);
  };

  const handleDismiss = async () => {
    if (!dismissing) return;
    setSaving(true);
    setFormError(null);
    try {
      await api.post(`/inbound-email/${dismissing.id}/dismiss`, note.trim() ? { note: note.trim() } : {});
      setNotice('Email dismissed.');
      setHandled(null);
      setDismissing(null);
      await load();
    } catch (err) {
      setFormError(getErrorMessage(err, 'Failed to dismiss the email'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress size={24} /></Box>;
  }
  if (error) {
    return <Typography sx={{ fontSize: 14, color: '#CC1F1F' }}>Error loading email requests</Typography>;
  }

  const setField = <K extends keyof RequestForm>(key: K, value: RequestForm[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
        Course-request emails that didn&apos;t create a request automatically — either the sender
        wasn&apos;t recognized, or a required detail (course, date, location, or student count)
        couldn&apos;t be confidently read. Use <strong>Create request</strong> to fix the details and
        book it, or <strong>Dismiss</strong> once you&apos;ve dealt with it another way.
      </Typography>
      {notice && <Alert severity="success" onClose={() => setNotice(null)}>{notice}</Alert>}
      <Tabs value={tab} onChange={(_e, v) => showTab(v)} sx={{ minHeight: 36 }}>
        <Tab value="review" label={`Needs review (${rows.length})`} sx={{ minHeight: 36 }} />
        <Tab value="handled" label="Handled" sx={{ minHeight: 36 }} />
      </Tabs>
      {tab === 'handled' ? (
        <>
          <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
            Emails that became a course request or were dismissed. The email text is removed 90 days
            after it was handled; dismissed emails are then deleted.
          </Typography>
          {handledError ? (
            <Typography sx={{ fontSize: 14, color: '#CC1F1F' }}>Error loading handled emails</Typography>
          ) : handled === null ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress size={24} /></Box>
          ) : (
            <DataTable columns={handledColumns} shownCount={handled.length} totalCount={handled.length} emptyMessage="No handled emails yet">
              {handled.map((row) => (
                <DataTableRow key={row.id} columns={handledColumns}>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                    {new Date(row.created_at).toLocaleString()}
                  </Typography>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{row.from_address}</Typography>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{row.subject || '-'}</Typography>
                  <Typography sx={{ fontSize: 12.5, color: (theme) => theme.palette.text.secondary }}>{outcomeText(row)}</Typography>
                  <Typography sx={{ fontSize: 12.5, color: (theme) => theme.palette.text.secondary }}>
                    {row.handled_at ? new Date(row.handled_at).toLocaleDateString() : '-'}
                    {row.handled_by_name ? ` by ${row.handled_by_name}` : ''}
                  </Typography>
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <LinkButton tone="neutral" onClick={() => setViewing(row)} aria-label={`Read handled email ${row.id}`}>Read email</LinkButton>
                  </Box>
                </DataTableRow>
              ))}
            </DataTable>
          )}
        </>
      ) : rows.length === 0 ? (
        <Box sx={{ bgcolor: (theme) => theme.palette.background.paper, border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 6, textAlign: 'center' }}>
          <Typography sx={{ fontSize: 14, fontWeight: 600, color: (theme) => theme.palette.text.secondary }}>Nothing needs review</Typography>
        </Box>
      ) : (
        <DataTable columns={columns} shownCount={rows.length} totalCount={rows.length}>
          {rows.map((row) => {
            const guess = row.extracted
              ? [row.extracted.courseTypeText, row.extracted.scheduledDate, row.extracted.location,
                  row.extracted.registeredStudents != null ? `${row.extracted.registeredStudents} students` : null]
                  .filter(Boolean).join(' · ')
              : '-';
            return (
              <DataTableRow key={row.id} columns={columns}>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                  {new Date(row.created_at).toLocaleString()}
                </Typography>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{row.from_address}</Typography>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{row.subject || '-'}</Typography>
                <Chip
                  label={STATUS_LABEL[row.status] ?? row.status}
                  size="small"
                  color={row.status === 'unmatched_sender' ? 'warning' : 'default'}
                  variant="outlined"
                />
                <Typography sx={{ fontSize: 12.5, color: (theme) => theme.palette.text.secondary }}>{guess || '-'}</Typography>
                <Box>
                  <Typography sx={{ fontSize: 12.5, color: (theme) => theme.palette.text.secondary }}>{reasonText(row)}</Typography>
                  {courseNotMatched(row) && (
                    <Typography sx={{ fontSize: 12, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{COURSE_HINT}</Typography>
                  )}
                </Box>
                <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <LinkButton tone="neutral" onClick={() => setViewing(row)} aria-label={`Read email ${row.id}`}>Read email</LinkButton>
                  <LinkButton onClick={() => openCreate(row)} aria-label={`Create request from email ${row.id}`}>Create request</LinkButton>
                  <LinkButton tone="danger" onClick={() => openDismiss(row)} aria-label={`Dismiss email ${row.id}`}>Dismiss</LinkButton>
                </Box>
              </DataTableRow>
            );
          })}
        </DataTable>
      )}

      <Dialog open={viewing !== null} onClose={() => setViewing(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{viewing?.subject || 'Email'}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, mb: 1.5, color: (theme) => theme.palette.text.secondary }}>
            From {viewing?.from_address}
          </Typography>
          <EmailBody text={viewing?.body_text ?? null} removed={!!viewing && textRemovedByRetention(viewing)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewing(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={creating !== null} onClose={closeCreate} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Create a course request from this email</DialogTitle>
        <DialogContent>
          {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
          {creating && (
            <>
              <Alert severity="info" sx={{ mb: 2 }}>{reasonText(creating)}</Alert>
              <EmailBody text={creating.body_text} />
            </>
          )}
          {!form && !formError && <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}><CircularProgress size={22} /></Box>}
          {form && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
              <TextField
                id="email-request-org"
                select
                label="Organization"
                value={form.organizationId}
                onChange={(e) => setField('organizationId', Number(e.target.value))}
                helperText={creating?.matched_organization_id ? undefined : 'The sender wasn\'t recognized. Pick the organization this request is for.'}
                disabled={saving}
              >
                {(organizations ?? []).map((o) => <MenuItem key={o.id} value={o.id}>{o.name}</MenuItem>)}
              </TextField>
              <TextField
                id="email-request-course"
                select
                label="Course"
                value={form.courseTypeId}
                onChange={(e) => setField('courseTypeId', Number(e.target.value))}
                helperText={creating && courseNotMatched(creating) ? COURSE_HINT : undefined}
                disabled={saving}
              >
                {(courseTypes ?? []).map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
              </TextField>
              <TextField
                id="email-request-date"
                type="date"
                label="Date"
                value={form.scheduledDate}
                onChange={(e) => setField('scheduledDate', e.target.value)}
                InputLabelProps={{ shrink: true }}
                inputProps={{ min: todayLocal() }}
                error={datePassed}
                helperText={datePassed ? 'This date has passed. Pick a date from today on.' : undefined}
                disabled={saving}
              />
              <TextField
                id="email-request-location"
                label="Location"
                value={form.location}
                onChange={(e) => setField('location', e.target.value)}
                inputProps={{ maxLength: 500 }}
                disabled={saving}
              />
              <TextField
                id="email-request-students"
                type="number"
                label="Number of students"
                value={form.registeredStudents}
                onChange={(e) => setField('registeredStudents', e.target.value)}
                inputProps={{ min: 0, max: 1000 }}
                helperText="Leave blank if not known yet. It shows as TBC."
                disabled={saving}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeCreate} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={saving || !formReady}>
            {saving ? 'Creating…' : 'Create request'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dismissing !== null} onClose={() => !saving && setDismissing(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Dismiss this email?</DialogTitle>
        <DialogContent>
          {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
          <Typography sx={{ fontSize: 13.5, mb: 2 }}>
            It leaves this list and no course request is created. Use this for spam, or once
            you&apos;ve handled the request another way.
          </Typography>
          <TextField
            id="email-request-dismiss-note"
            label="Note (optional)"
            placeholder="e.g. Called the client, booked by phone"
            fullWidth
            value={note}
            onChange={(e) => setNote(e.target.value)}
            inputProps={{ maxLength: 500 }}
            disabled={saving}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDismissing(null)} disabled={saving}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleDismiss} disabled={saving}>
            {saving ? 'Dismissing…' : 'Dismiss'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default EmailRequestsReview;
