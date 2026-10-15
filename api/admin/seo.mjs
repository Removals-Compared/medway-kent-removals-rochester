// ════════════════════════════════════════════════════════════
//  SEO module API: one function, routed by ?action=.
//  ADMIN ONLY. Staff sessions get 403 on everything here.
//
//   GET  status        which parts are set up (never returns secrets)
//   GET  overview      counts for the Overview tab
//   GET  pages         page inventory with open issue counts
//   GET  issues        ?status=open|ignored|resolved|all &severity= &type=
//   GET  jobs          recent background jobs
//   GET  articles      content queue (empty until drafting is built)
//   POST issue         {id, status: "open" | "ignored"}
//   POST run_audit     queue a site audit (and start the GitHub workflow if configured)
//
//  Nothing here publishes, approves or edits website content.
// ════════════════════════════════════════════════════════════
import { requireAuth } from './_session.mjs';
import {
  tablesReady, overview, listPages, listIssues, setIssueStatus, listJobs, enqueueAudit,
  listArticles, brightlocalBudget, dispatchAuditWorkflow, logSeo,
} from './_seo.mjs';

export default async function handler(req, res) {
  try {
    const role = requireAuth(req, res);
    if (!role) return;
    if (role !== 'admin') return res.status(403).json({ error: 'admin only' });

    const action = String(req.query.action || '');
    const actor = 'Admin';

    if (req.method === 'GET' && action === 'status') {
      let ready = false;
      try { ready = await tablesReady(); } catch (e) { return res.status(200).json({ database: false, error: 'database not reachable' }); }
      return res.status(200).json({
        database: true,
        tables_ready: ready,
        integrations: {
          search_console: !!process.env.GSC_REFRESH_TOKEN,
          brightlocal: !!process.env.BRIGHTLOCAL_API_KEY,
          audit_button_dispatch: !!process.env.GITHUB_DISPATCH_TOKEN,
        },
        brightlocal_budget: ready ? await brightlocalBudget() : null,
      });
    }

    // Everything below needs the tables.
    if (!(await tablesReady())) {
      return res.status(503).json({ error: 'seo_tables_missing', message: 'Run admin/SEO-SCHEMA.sql in the Neon SQL editor first.' });
    }

    if (req.method === 'GET') {
      switch (action) {
        case 'overview': return res.status(200).json(await overview());
        case 'pages': return res.status(200).json({ pages: await listPages() });
        case 'issues': return res.status(200).json({
          issues: await listIssues({ status: req.query.status || 'open', severity: req.query.severity, type: req.query.type }),
        });
        case 'jobs': return res.status(200).json({ jobs: await listJobs() });
        case 'articles': return res.status(200).json({ articles: await listArticles() });
        default: return res.status(400).json({ error: 'unknown action' });
      }
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      if (action === 'issue') {
        const id = Number(body.id);
        if (!Number.isInteger(id)) return res.status(400).json({ error: 'id required' });
        if (!['open', 'ignored'].includes(String(body.status))) return res.status(400).json({ error: 'status must be open or ignored' });
        const row = await setIssueStatus(id, String(body.status));
        if (!row) return res.status(404).json({ error: 'issue not found' });
        await logSeo(actor, 'issue_' + row.status, `issue ${id}`);
        return res.status(200).json({ issue: row });
      }
      if (action === 'run_audit') {
        const { job, created } = await enqueueAudit(actor);
        let dispatch = { dispatched: false, reason: 'already queued' };
        if (created) {
          dispatch = await dispatchAuditWorkflow(job.id);
          await logSeo(actor, 'audit_queued', `job ${job.id}${dispatch.dispatched ? ' (workflow started)' : ''}`);
        }
        return res.status(200).json({ job, created, ...dispatch });
      }
      return res.status(400).json({ error: 'unknown action' });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error('seo', e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}
