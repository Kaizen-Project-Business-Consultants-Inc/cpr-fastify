import { useEffect, useState } from 'react';
import { Alert, Button, Snackbar } from '@mui/material';

const CHECK_EVERY_MS = 5 * 60 * 1000;
const BUNDLE_PATTERN = /\/assets\/index-[^"'\s]+\.js/;

/** The hashed entry script named in an index.html, or null (dev server, unexpected page). */
function findBundle(html: string): string | null {
  return html.match(BUNDLE_PATTERN)?.[0] ?? null;
}

function loadedBundle(): string | null {
  const src = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')?.getAttribute('src');
  return src ? findBundle(src) : null;
}

/**
 * A page that stays open keeps the code it loaded. Every few minutes (and when the tab
 * comes back into view) compare its entry script with the one the server now serves, and
 * offer a reload when they differ. Never reloads by itself: a form may be half filled in.
 */
export default function UpdateNotice() {
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    const current = loadedBundle();
    if (!current) return; // dev server: nothing hashed to compare
    let stopped = false;

    const check = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const res = await fetch('/', { cache: 'no-store' });
        if (!res.ok) return;
        const latest = findBundle(await res.text());
        if (!stopped && latest && latest !== current) setUpdateReady(true);
      } catch {
        // offline or mid-deploy: try again next time
      }
    };

    const timer = window.setInterval(check, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', check);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  return (
    <Snackbar open={updateReady} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
      <Alert
        severity="info"
        variant="filled"
        action={<Button color="inherit" size="small" onClick={() => window.location.reload()}>Refresh</Button>}
      >
        A new version is available. Save your work, then refresh.
      </Alert>
    </Snackbar>
  );
}
