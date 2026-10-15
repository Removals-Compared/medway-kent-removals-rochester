// ════════════════════════════════════════════════════════════
//  SEO module API: one function, routed by ?action=.
//  ADMIN ONLY. Staff sessions get 403 on everything here.
//
//   GET  status         which parts are set up (never returns secrets)
//   GET  overview       counts for the Overview tab
//   GET  pages          page inventory with open issue counts
//   GET  issues         ?status=open|ignored|resolved|all &severity= &type=
//   GET  opportunities  ranked, evidence-based suggestions from Search Console data
//   GET  report         clicks / impressions / position, top queries and pages
//   GET  jobs           recent background jobs
//   GET  articles       content queue (empty until drafting is built)
//   POST issue          {id, status: "open" | "ignored"}
//   POST query_status   {query, status: "new" | "targeted" | "ignored"}
//   POST run_audit      queue a site audit (and start the GitHub workflow if configured)
//   POST run_import     queue a Search Console import (same)
//
//  Nothing here publishes, approves or edits website content.
// ════════════════════════════════════════════════════════════
import { requireAuth } from './_session.mjs';
import {
  tablesReady, overview, listPages, listIssues, setIssueStatus, listJobs, enqueueJob,
  listArticles, brightlocalBudget, dispatchWorkflow, logSeo,
  opportunityData, setQueryStatus, reportData,
} from './_seo.mjs';
import { buildOpportunities, TYPE_LABELS } from '../../scripts/seo-opportunities-lib.mjs';

const QUERY_STATUSES = ['new', 'targeted', 'ignored'];

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
          search_console: !!(process.env.GSC_SERVICE_ACCOUNT_JSON || (process.env.GSC_CLIENT_ID && process.env.GSC_CLIENT_SECRET && process.env.GSC_REFRESH_TOKEN)),
          search_console_mode: process.env.GSC_SERVICE_ACCOUNT_JSON ? 'service account' : process.env.GSC_REFRESH_TOKEN ? 'OAuth' : null,
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
        case 'opportunities': {
          const data = await opportunityData();
          if (!data) return res.status(200).json({ has_data: false, opportunities: [] });
          const opportunities = buildOpportunities(data);
          return res.status(200).json({ has_data: true, window_end: data.end, labels: TYPE_LABELS, opportunities });
        }
        case 'report': return res.status(200).json(await reportData());
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
      if (action === 'query_status') {
        const query = String(body.query || '').trim();
        if (!query) return res.status(400).json({ error: 'query required' });
        if (!QUERY_STATUSES.includes(String(body.status))) return res.status(400).json({ error: 'status must be new, targeted or ignored' });
        const row = await setQueryStatus(query, String(body.status));
        await logSeo(actor, 'query_' + row.status, row.query);
        return res.status(200).json({ keyword: row });
      }
      if (action === 'run_audit' || action === 'run_import') {
        const type = action === 'run_audit' ? 'audit' : 'gsc_import';
        if (type === 'gsc_import' && !(process.env.GSC_SERVICE_ACCOUNT_JSON || process.env.GSC_REFRESH_TOKEN)) {
          return res.status(409).json({ error: 'search_console_not_connected', message: 'Connect Search Console first (see Settings).' });
        }
        const { job, created } = await enqueueJob(type, actor);
        let dispatch = { dispatched: false, reason: 'already queued' };
        if (created) {
          dispatch = await dispatchWorkflow(type, job.id);
          await logSeo(actor, type + '_queued', `job ${job.id}${dispatch.dispatched ? ' (workflow started)' : ''}`);
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
