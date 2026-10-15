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
//   GET  article        one article with every version and decision
//   POST draft          queue an AI draft for a search or topic
//   POST redraft        queue a fresh AI draft for an existing article
//   POST save_revision  save an edit as a NEW version (needs approval again)
//   POST acknowledge    owner confirms a flagged price or claim is true
//   POST decide         approve / reject / request_changes on the CURRENT version
//   POST archive        archive an article
//
//  Nothing here publishes, approves or edits website content.
// ════════════════════════════════════════════════════════════
import { requireAuth } from './_session.mjs';
import {
  tablesReady, overview, listPages, listIssues, setIssueStatus, listJobs, enqueueJob,
  listArticles, brightlocalBudget, dispatchWorkflow, logSeo, searchConsoleStatus,
  opportunityData, setQueryStatus, reportData,
  getArticle, createDraftRequest, redraft, saveRevision, acknowledge, decide, archiveArticle,
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
      const gsc = ready ? await searchConsoleStatus() : { connected: false, last_import: null };
      return res.status(200).json({
        database: true,
        tables_ready: ready,
        integrations: {
          search_console: gsc.connected,
          search_console_last_import: gsc.last_import,
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
        case 'article': {
          const a = await getArticle(Number(req.query.id));
          return a ? res.status(200).json(a) : res.status(404).json({ error: 'article not found' });
        }
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
        const { job, created } = await enqueueJob(type, actor);
        let dispatch = { dispatched: false, reason: 'already queued' };
        if (created) {
          dispatch = await dispatchWorkflow(type, job.id);
          await logSeo(actor, type + '_queued', `job ${job.id}${dispatch.dispatched ? ' (workflow started)' : ''}`);
        }
        return res.status(200).json({ job, created, ...dispatch });
      }
      const articleActions = {
        draft: async () => {
          const r = await createDraftRequest({ keyword: body.keyword, notes: body.notes, evidence: body.evidence || null }, actor);
          return { ...r, ...(await dispatchWorkflow('draft', r.job.id)) };
        },
        redraft: async () => { const r = await redraft(Number(body.article_id), actor); return { ...r, ...(await dispatchWorkflow('draft', r.job.id)) }; },
        save_revision: () => saveRevision(Number(body.article_id), body, actor),
        acknowledge: () => acknowledge(Number(body.article_id), String(body.key || ''), actor),
        decide: () => decide(Number(body.article_id), Number(body.revision_id), String(body.decision), body.reason, actor),
        archive: () => archiveArticle(Number(body.article_id), actor),
      };
      if (articleActions[action]) {
        try { return res.status(200).json(await articleActions[action]()); }
        catch (e) { if (e.status) return res.status(e.status).json({ error: e.message, findings: e.findings }); throw e; }
      }
      return res.status(400).json({ error: 'unknown action' });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error('seo', e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}
