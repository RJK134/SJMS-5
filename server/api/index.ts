// Vercel serverless function entry for the SJMS 2.5 API server.
//
// Vercel's zero-config function detection treats every file under the
// project root's `api/` directory as a serverless function. The
// project root for the sjms-2-5-server Vercel project is `server/`, so
// this file at `server/api/index.ts` is detected automatically — no
// `functions` block is required in vercel.json.
//
// `server/vercel.json` adds a catch-all rewrite (`/(.*)` → `/api`) so
// every incoming path is forwarded to this handler. Express then sees
// the original URL on `req.url` and routes through its own mount tree
// (top-level `/health`, `/metrics`, then `/api/v1/*` via apiV1Router,
// plus `/api/health`, `/api/docs`, `/api/v1/diagnostics`).
//
// We re-export the existing Express app directly: Express's `app` is
// itself a `(req, res, next) => void` handler, which is exactly the
// shape Vercel expects for a Node serverless function default export.
// Importing the app does NOT open a TCP listener — `app.listen()` in
// `../src/index.ts` is gated on `require.main === module`, which is
// false when the module is imported from here.
import app from "../src/index";

export default app;
