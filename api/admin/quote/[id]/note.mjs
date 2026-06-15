import { requireAuth } from '../../_session.mjs';
import { appendNote } from '../../_db.mjs';

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  let id = req.query.id;
  if (typeof id === 'string') id = id.replace(/\.html$/, '');

  try {
    const { text } = req.body || {};
    if (!text || !text.trim()) return res.status(400).json({ error: 'empty note' });
    const quote = await appendNote(id, text.trim());
    return res.status(200).json({ quote });
  } catch (e) {
    console.error('quote/[id]/note.js', e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}
