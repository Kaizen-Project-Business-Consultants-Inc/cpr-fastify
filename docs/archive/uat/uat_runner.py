#!/usr/bin/env python3
"""CPR Training System - Automated UAT Runner
Runs API-level tests against cpr.kpbc.ca for all 8 portals.
Respects rate limits: 100 req/min global, 10 req/min auth.
"""
import json, time, sys, urllib.request, urllib.error, ssl, re

BASE = "https://cpr.kpbc.ca"
API = f"{BASE}/api/v1"
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

results = []
tokens = {}
pass_count = 0
fail_count = 0
api_calls = 0

def raw_api(method, url, data=None, token=None):
    global api_calls
    api_calls += 1
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps(data).encode() if data else None
    r = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(r, context=ctx, timeout=15)
        ct = resp.headers.get("Content-Type", "")
        raw = resp.read().decode()
        j = json.loads(raw) if "json" in ct else None
        return resp.getcode(), j, raw, ct
    except urllib.error.HTTPError as e:
        raw = e.read().decode() if e.fp else ""
        try:
            j = json.loads(raw)
        except Exception:
            j = None
        return e.code, j, raw, e.headers.get("Content-Type", "")
    except Exception as e:
        return 0, None, str(e), ""

def record(tid, portal, name, ok, detail=""):
    global pass_count, fail_count
    if ok:
        pass_count += 1
    else:
        fail_count += 1
    results.append({"id": tid, "portal": portal, "name": name,
                     "status": "PASS" if ok else "FAIL", "detail": str(detail)[:200]})
    mark = "PASS" if ok else "FAIL"
    sys.stdout.write(f"  [{mark}] {tid} {name}")
    if not ok:
        sys.stdout.write(f"  ({detail[:60]})")
    sys.stdout.write("\n")
    sys.stdout.flush()

def do_login(username, password="test123"):
    code, j, raw, ct = raw_api("POST", f"{API}/auth/login", {"username": username, "password": password})
    if code == 200 and j and j.get("data", {}).get("accessToken"):
        tokens[username] = j["data"]["accessToken"]
        return j["data"]
    return None

def GET(path, token=None):
    url = path if path.startswith("http") else f"{API}{path}"
    return raw_api("GET", url, token=token)

def rate_pause(label=""):
    sys.stdout.write(f"  ... rate limit pause 62s {label}...\n")
    sys.stdout.flush()
    time.sleep(62)

# ==============================================================
print("\n" + "=" * 60)
print("  CPR TRAINING SYSTEM - UAT TEST RUN")
print("  " + time.strftime("%Y-%m-%d %H:%M:%S"))
print("  Target: " + BASE)
print("=" * 60)

# ==============================================================
# 1. AUTHENTICATION (10 req/min limit on auth endpoints)
# ==============================================================
print("\n--- 1. AUTHENTICATION ---")

# Login all 8 users (8 auth requests)
user_list = ["instructor", "orguser", "courseadmin", "accountant", "admin", "sysadmin", "hruser", "vendoruser"]
for u in user_list:
    data = do_login(u)
    record(f"1.1-{u}", "Auth", f"Login {u}", data is not None,
           f"role={data['user']['role']}" if data else "login failed")

# Wrong password (9th auth request)
code, j, raw, ct = raw_api("POST", f"{API}/auth/login", {"username": "admin", "password": "wrong"})
record("1.2", "Auth", "Wrong password rejected", code == 401, f"http={code}")

# /auth/me (10th auth request - at limit)
code, j, raw, ct = GET("/auth/me", tokens.get("sysadmin"))
record("1.3", "Auth", "GET /auth/me",
       code == 200 and j and j.get("data", {}).get("user", {}).get("username") == "sysadmin",
       f"user={j.get('data',{}).get('user',{}).get('username') if j else 'none'}")

# SPA routes (not auth-rate-limited, just global)
spa_routes = ["/instructor/dashboard", "/organization/dashboard", "/admin/dashboard",
              "/accounting/dashboard", "/superadmin/dashboard", "/sysadmin", "/hr", "/vendor/dashboard"]
for route in spa_routes:
    code, j, raw, ct = GET(f"{BASE}{route}")
    record(f"1.5{route}", "Auth", f"SPA {route}", code == 200, f"http={code}")

# ==============================================================
# 2. INSTRUCTOR PORTAL
# ==============================================================
print("\n--- 2. INSTRUCTOR PORTAL ---")
IT = tokens.get("instructor")

endpoints = [
    ("2.1", "Dashboard stats", "/instructor/dashboard/stats"),
    ("2.3", "Availability", "/instructor/availability"),
    ("2.6", "My classes", "/instructor/classes"),
    ("2.8", "Archive (completed)", "/instructor/classes/completed"),
    ("2.11", "Timesheet list", "/timesheet/"),
    ("2.17", "Profile", "/instructor/profile"),
]
for tid, name, path in endpoints:
    code, j, raw, ct = GET(path, IT)
    record(tid, "Instructor", name, code == 200, f"http={code}")

# ==============================================================
# 3. ORGANIZATION PORTAL
# ==============================================================
print("\n--- 3. ORGANIZATION PORTAL ---")
OT = tokens.get("orguser")

code, j, raw, ct = GET("/organization/dashboard", OT)
record("3.1", "Org", "Dashboard", code == 200 and j and "data" in j,
       json.dumps(j.get("data", {}))[:100] if j else f"http={code}")

# Check org name from /auth/me -- but we already used auth budget, so check from login data
# Use the token we already have
code, j, raw, ct = GET("/auth/me", OT)
org_name = j.get("data", {}).get("user", {}).get("organization_name") if j else None
record("3.2", "Org", "Org name in auth", org_name is not None, f"org={org_name}")

endpoints = [
    ("3.3", "Courses", "/organization/courses"),
    ("3.6", "Course types", "/course-types"),
    ("3.9", "Invoices", "/organization/invoices"),
    ("3.14", "Paid invoices", "/organization/paid-invoices"),
    ("3.15", "Pricing", "/organization-pricing/organization/1"),
    ("3.17", "Archive", "/organization/archive"),
    ("3.18", "Profile", "/organization/profile"),
]
for tid, name, path in endpoints:
    code, j, raw, ct = GET(path, OT)
    record(tid, "Org", name, code == 200, f"http={code}")

org_pages = ["dashboard", "courses", "billing", "schedule", "pricing", "archive", "paid-invoices", "profile"]
all_ok = True
for p in org_pages:
    c, _, _, _ = GET(f"{BASE}/organization/{p}")
    if c != 200:
        all_ok = False
record("3.21", "Org", "All 8 SPA routes", all_ok, "all 200" if all_ok else "some failed")

# Pause for rate limit
rate_pause("(after ~45 requests)")

# ==============================================================
# 4. COURSE ADMIN PORTAL
# ==============================================================
print("\n--- 4. COURSE ADMIN PORTAL ---")
CA = tokens.get("courseadmin")

endpoints = [
    ("4.1", "Dashboard", "/sysadmin/dashboard"),
    ("4.3", "Instructors", "/courseadmin/instructors"),
    ("4.4a", "Pending courses", "/courses/pending"),
    ("4.4b", "Confirmed courses", "/courses/confirmed"),
    ("4.11", "Email templates", "/email-templates/"),
    ("4.18", "Cancelled courses", "/courses/cancelled"),
]
for tid, name, path in endpoints:
    code, j, raw, ct = GET(path, CA)
    record(tid, "CourseAdmin", name, code == 200, f"http={code}")

code, j, raw, ct = GET("/admin/vendor-invoices", CA)
record("4.19", "CourseAdmin", "Vendor invoices", code in (200, 403), f"http={code}")

# ==============================================================
# 5. ACCOUNTING PORTAL
# ==============================================================
print("\n--- 5. ACCOUNTING PORTAL ---")
AT = tokens.get("accountant")

endpoints = [
    ("5.1", "Dashboard", "/accounting/dashboard"),
    ("5.2", "Aging report", "/accounting/aging-report"),
    ("5.4", "Revenue report", "/accounting/reports/revenue?year=2026"),
    ("5.5", "Billing queue", "/accounting/billing-queue"),
    ("5.7", "Pending approvals", "/accounting/invoices/pending-approval"),
    ("5.11", "Rejected invoices", "/accounting/invoices/rejected"),
    ("5.13", "All invoices", "/accounting/invoices"),
    ("5.19", "Payment verifications", "/accounting/payment-verifications"),
    ("5.22", "Verified payments", "/accounting/verified-payments"),
    ("5.25", "Vendor invoices", "/accounting/vendor-invoices"),
    ("5.26", "Vendor payments", "/accounting/vendor-payments"),
    ("5.28", "Course pricing", "/accounting/course-pricing"),
]
for tid, name, path in endpoints:
    code, j, raw, ct = GET(path, AT)
    record(tid, "Accounting", name, code == 200, f"http={code}")

acct_pages = ["dashboard", "aging", "financial-summary", "billing", "pending-approvals",
              "rejected-invoices", "receivables", "history", "payment-requests",
              "verification", "reversal", "vendor-invoices", "paid-vendor-invoices"]
all_ok = all(GET(f"{BASE}/accounting/{p}")[0] == 200 for p in acct_pages)
record("5.29", "Accounting", "All 13 SPA routes", all_ok, "all 200" if all_ok else "some failed")

# Pause for rate limit
rate_pause("(after ~80 requests)")

# ==============================================================
# 6/7. SYSADMIN PORTAL
# ==============================================================
print("\n--- 6/7. SYSADMIN PORTAL ---")
SY = tokens.get("sysadmin")

endpoints = [
    ("7.1", "Dashboard", "/sysadmin/dashboard"),
    ("7.2", "Course types", "/sysadmin/courses"),
    ("7.4", "Organizations", "/sysadmin/organizations"),
    ("7.6", "Org pricing", "/organization-pricing/admin"),
    ("7.8", "Users", "/sysadmin/users?limit=5"),
    ("7.13", "Vendors", "/sysadmin/vendors"),
    ("7.15", "Students", "/sysadmin/students"),
    ("7.19", "Cert stats", "/sysadmin/certifications/stats"),
    ("7.20", "Expiring certs", "/sysadmin/certifications/expiring?days=90"),
    ("7.22", "System config", "/sysadmin/configurations"),
]
for tid, name, path in endpoints:
    code, j, raw, ct = GET(path, SY)
    record(tid, "SysAdmin", name, code == 200, f"http={code}")

sa_pages = ["", "courses", "organizations", "pricing", "users", "vendors", "students", "certifications", "configuration"]
all_ok = all(GET(f"{BASE}/sysadmin/{p}")[0] == 200 for p in sa_pages)
record("7.25", "SysAdmin", "All 9 SPA routes", all_ok, "all 200" if all_ok else "some failed")

# ==============================================================
# 8. HR PORTAL
# ==============================================================
print("\n--- 8. HR PORTAL ---")
HT = tokens.get("hruser")

endpoints = [
    ("8.1", "Dashboard", "/hr/dashboard"),
    ("8.2", "Instructors", "/hr/instructors"),
    ("8.3", "Organizations", "/hr/organizations"),
    ("8.4", "Profile changes", "/hr/profile-changes"),
    ("8.7", "Timesheets", "/timesheet/"),
    ("8.7b", "Timesheet stats", "/timesheet/stats"),
    ("8.13", "Pay rate tiers", "/pay-rates/tiers"),
    ("8.16", "Instructor rates", "/pay-rates/instructors"),
    ("8.19", "Payroll stats", "/payroll/stats"),
    ("8.20", "Payroll payments", "/payroll/payments"),
    ("8.24", "Returned payments", "/hr/returned-payment-requests"),
    ("8.27", "Notifications", "/notifications/"),
    ("8.27b", "Unread count", "/notifications/unread-count"),
]
for tid, name, path in endpoints:
    code, j, raw, ct = GET(path, HT)
    record(tid, "HR", name, code == 200, f"http={code}")

# Pause for rate limit
rate_pause("(after ~115 requests)")

# ==============================================================
# 9. VENDOR PORTAL
# ==============================================================
print("\n--- 9. VENDOR PORTAL ---")
VT = tokens.get("vendoruser")

endpoints = [
    ("9.1", "Dashboard", "/vendor/dashboard"),
    ("9.2", "Vendor list", "/vendor/vendors"),
    ("9.5", "Invoices", "/vendor/invoices"),
    ("9.11", "Profile", "/vendor/profile"),
]
for tid, name, path in endpoints:
    code, j, raw, ct = GET(path, VT)
    record(tid, "Vendor", name, code in (200, 404), f"http={code}")

vendor_pages = ["dashboard", "upload", "history", "status", "paid-invoices", "profile"]
all_ok = all(GET(f"{BASE}/vendor/{p}")[0] == 200 for p in vendor_pages)
record("9.13", "Vendor", "All 6 SPA routes", all_ok, "all 200" if all_ok else "some failed")

# ==============================================================
# 10. CROSS-PORTAL & STATIC ASSETS
# ==============================================================
print("\n--- 10. CROSS-PORTAL & ASSETS ---")

code, j, raw, ct = GET("/health")
record("10.1", "Cross", "Health check",
       code == 200 and j and j.get("status") == "UP",
       f"status={j.get('status') if j else 'none'}, db={j.get('services',{}).get('database',{}).get('status') if j else 'none'}")

# Get current bundle filenames
code, j, raw, ct = GET(f"{BASE}/")
js_match = re.search(r'src="(/assets/index-[^"]+\.js)"', raw or "")
css_match = re.search(r'href="(/assets/index-[^"]+\.css)"', raw or "")

if js_match:
    c2, j2, r2, ct2 = GET(f"{BASE}{js_match.group(1)}")
    record("10.2", "Assets", "JS bundle", c2 == 200 and "javascript" in ct2, f"{js_match.group(1)}")
else:
    record("10.2", "Assets", "JS bundle", False, "bundle not found in HTML")

if css_match:
    c2, j2, r2, ct2 = GET(f"{BASE}{css_match.group(1)}")
    record("10.3", "Assets", "CSS bundle", c2 == 200 and "css" in ct2, f"{css_match.group(1)}")
else:
    record("10.3", "Assets", "CSS bundle", False, "CSS not found in HTML")

code, j, raw, ct = GET("/course-types", IT)
record("10.4", "Cross", "Shared course-types", code == 200, f"http={code}")

code, j, raw, ct = GET(f"{BASE}/login")
record("10.5", "Cross", "Login page SPA", code == 200, f"http={code}")

# ==============================================================
# REPORT
# ==============================================================
total = len(results)
pct = round(pass_count / total * 100, 1) if total else 0

print(f"\n{'=' * 60}")
print(f"  RESULTS: {pass_count} PASSED / {fail_count} FAILED / {total} TOTAL")
print(f"  PASS RATE: {pct}%")
print(f"  API CALLS: {api_calls}")
print(f"{'=' * 60}")

if fail_count > 0:
    print(f"\nFAILED TESTS ({fail_count}):")
    for r in results:
        if r["status"] == "FAIL":
            print(f"  [FAIL] {r['id']:12s} [{r['portal']:12s}] {r['name']}: {r['detail']}")

print("\nBY PORTAL:")
portals = {}
for r in results:
    p = r["portal"]
    if p not in portals:
        portals[p] = {"pass": 0, "fail": 0}
    portals[p]["pass" if r["status"] == "PASS" else "fail"] += 1
for p, c in portals.items():
    t = c["pass"] + c["fail"]
    s = "ALL PASS" if c["fail"] == 0 else f"{c['fail']} FAILED"
    print(f"  {p:15s} {c['pass']:2d}/{t:2d}  {s}")

report = {
    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
    "url": BASE,
    "summary": {"total": total, "passed": pass_count, "failed": fail_count, "pass_rate": pct, "api_calls": api_calls},
    "by_portal": portals,
    "results": results
}
with open("docs/UAT_Report.json", "w") as f:
    json.dump(report, f, indent=2)
print(f"\nJSON report: docs/UAT_Report.json")
print(f"Completed at: {time.strftime('%Y-%m-%d %H:%M:%S')}")
