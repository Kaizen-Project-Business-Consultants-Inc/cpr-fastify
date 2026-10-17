# Coding standards

The rules every change to the CPR Training Portal is reviewed against. Short on
purpose: each rule comes from something that went wrong or nearly did.

## 1. Stack in one paragraph

Fastify 5 + TypeScript backend (`backend/src`: `routes/`, `services/`,
`repositories/`, `plugins/`), MariaDB 11.4 through `mysql2/promise` with
parameterised SQL, zod for input, bcryptjs for passwords, Resend for email.
React 18 + MUI v5 + TanStack Query + Vite frontend (`frontend/src`). Vitest for
unit tests, Playwright (`tests/e2e`) against staging. One schema, one database
per environment; migrations are the versioned list in
`backend/src/config/migrations.ts`, run once each at startup.

## 2. Hosting limits shape the code

The app runs on shared cPanel hosting (LiteSpeed lsnode) with a hard cap of
100 processes/threads for the whole account, shared with other sites.

- No background timers, intervals or long-lived connections that keep the
  process from idling, unless there is no alternative.
- No new worker threads, child processes or native modules.
- Memory is shared too: never load a whole growing table into memory.

## 3. Security and permissions

- Every route has a gate: `requireAuth` and `requireRole(...)` from
  `backend/src/plugins/auth.ts`. A public route says why in a comment.
- Organization users see only their own organization's data. Every query a
  non-admin can reach filters by `request.userOrgId` (or the instructor's or
  vendor's own id). Check this on every new or changed query.
- Login, reset and other abuse-prone routes have a `rateLimit` config.
- SQL is always parameterised (`?`). Never build SQL from request input.
- Never log or return passwords, hashes, tokens or keys. Secrets come from env
  vars, never from code.
- Every write to money, users or permissions adds an audit entry, from
  `backend/src/utils/auditLog.ts`: `logAudit` (fire-and-forget) after the
  change succeeds, or `await writeAudit(conn, …)` before `commit()` inside a
  transaction, so the entry rolls back with the change.

## 4. Database

- Every query that runs on a request is bounded: `LIMIT`/pagination on lists,
  and no `SELECT *` in list queries on growing tables (students, invoices,
  audit, emails). A single-row lookup by key may use `SELECT *`.
- No query inside a loop over rows (N+1); join or use `IN (...)`.
- New filters and joins have an index. Look in `migrations.ts`, and for the
  core tables created before migrations (users, organizations, invoices,
  payments, course_requests, timesheets, pricing) in
  `docs/Program Documentation/Database_Schema_Reference.md`. If neither shows
  one, call it unconfirmed, not missing.
- Schema changes are a new migration at the end of the list, written to be
  safe to re-run (`addColumnIfMissing`, `addIndexIfMissing`, ...). Never edit an
  old migration.
- Money is stored as DECIMAL, never float. Multi-step money changes run in a
  transaction.

## 5. API behaviour

- Bad input gets a 400 with a plain-English message, not a 500.
- Not found is 404; not allowed is 403.
- Response shapes match what the frontend already expects (check the caller).

## 6. Frontend

- Use the shared components (`components/common`, e.g. `PasswordField`) before
  writing a new one.
- Every new button or icon button has an accessible name (`aria-label` if it
  has no text). Forms mark only the field that is wrong.
- Errors shown to users are plain English; no raw server errors or stack
  traces.
- Server data goes through TanStack Query, not ad-hoc `useEffect` fetches,
  where the surrounding code already does.

## 7. Simplicity

- The simplest design that is correct. No abstraction with one user.
- Match the surrounding code's naming, comments and style.
- What a change makes unused is removed in the same change.
- No debug logging left behind (e.g. `[DEEP TRACE]`).

## 8. Tests and docs

- A change in behaviour comes with a test of the real path: a Vitest test for
  a service or component, and a Playwright test in `tests/e2e` when it is a
  user-visible flow.
- E2E tests are read-only against staging, or clean up after themselves, and
  log in through `loginAs` (it spaces logins for the rate limit).
- `docs/` and `TODO.md` are updated when what they describe changes.

## 9. The review before every commit

Before every commit, the working Claude session runs the **Code Reviewer**
subagent (`.claude/agents/code-reviewer.md`) on `git diff --staged`, fixes
every must-fix, and re-runs it until the verdict is `PASS`. The reviewer
answers six questions with file:line evidence:

1. **Algorithm:** what is the largest realistic input (thousands of students,
   years of invoices and courses), and what does the change cost on it?
2. **Database:** every query added or touched, how often it runs, its index,
   and whether it is bounded and free of N+1.
3. **Who can call it:** the route's gate, organization scoping, and rate limit.
4. **Replacement:** what does it make unused, and is that removed?
5. **Simplicity:** is this the simplest correct design, matching the code
   around it?
6. **Tests and docs:** does a test cover the real path and the edge cases, and
   are the docs updated?

Every commit message records the review, next to `Co-Authored-By`, with one of:

```
Review: passed (code reviewer)
Review: passed after fixes (code reviewer)
Review: not needed (docs only | tests only | <other reason>)
```

The bracket is required on every form.

The `.husky/commit-msg` hook rejects a commit without one of these lines. The
hook only proves the line is there; the review itself is the session's
responsibility.
