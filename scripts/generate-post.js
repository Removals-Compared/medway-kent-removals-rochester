// ══════════════════════════════════════════════════════
//  MKR Blog + Social Auto-Poster
//  Runs daily via GitHub Actions at 6am UK time
//
//  What this script does:
//  1. Reads today's day number from state.json
//  2. Gets today's post data from blog-calendar.js
//  3. Checks if today should post (first 30 days = every day,
//     after day 30 = Mon/Wed/Fri only)
//  4. Calls Claude API to write the full blog post HTML
//  5. Saves the HTML file to blog/posts/
//  6. Calls Make.com webhook to trigger social posting
//  7. Updates state.json with the new day number
// ══════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const https = require('https');

const CALENDAR = require('./blog-calendar.js');

// ── Load or initialise state ──
const STATE_FILE = path.join(__dirname, 'state.json');
let state = { currentDay: 0, lastRun: null };

if (fs.existsSync(STATE_FILE)) {
  try {
    state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch(e) {
    console.log('State file unreadable, starting fresh');
  }
}

// ── Determine today's day number ──
const dayOverride = process.env.DAY_OVERRIDE;
let todayDay = dayOverride ? parseInt(dayOverride) : state.currentDay + 1;

// Cap at 30 for the blog calendar
const calendarDay = Math.min(todayDay, 30);

console.log(`\n══════════════════════════════════`);
console.log(`MKR Blog Automation — Day ${todayDay}`);
console.log(`══════════════════════════════════`);

// ── Check if we should post today ──
// Days 1-30: every day
// After day 30: Monday (1), Wednesday (3), Friday (5) only
const today = new Date();
const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat

if (todayDay > 30) {
  const postDays = [1, 3, 5]; // Mon, Wed, Fri
  if (!postDays.includes(dayOfWeek)) {
    console.log(`Day ${todayDay} — Today is not Mon/Wed/Fri. Skipping.`);
    process.exit(0);
  }
}

// ── Get today's post from calendar ──
const post = CALENDAR[calendarDay - 1];
if (!post) {
  console.log(`No post found for day ${calendarDay}. Exiting.`);
  process.exit(0);
}

console.log(`Title: ${post.title}`);
console.log(`Slug:  ${post.slug}`);
console.log(`Category: ${post.category}`);

// ── Pick a random social image ──
const imageCount = 17;
const imageNum = Math.floor(Math.random() * imageCount) + 1;
const imagePath = `images/social/blog-social-${imageNum}.jpg`;
const imageUrl  = `https://raw.githubusercontent.com/Removals-Compared/medway-kent-removals-rochester/main/${imagePath}`;

console.log(`Image: ${imagePath}`);

// ── Helper: HTTPS fetch ──
function httpsPost(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path:     urlObj.pathname + urlObj.search,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers
      }
    };
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { resolve(raw); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ══════════════════════════════════════════════════════
//  STEP 1 — Call Claude API to write the blog post HTML
// ══════════════════════════════════════════════════════
async function generateBlogPost(post) {
  console.log('\n[1/3] Calling Claude API to write blog post...');

  const prompt = `You are writing a fully SEO-optimised blog post for Medway & Kent Removals (medwaykentremovals.co.uk), a professional removal company based at 47 Knight Templar Way, Rochester, Kent, ME2 2ZE. Phone: 01634 971005.

Write a complete, detailed blog post for this topic:

Title: ${post.title}
Category: ${post.category}
Target keywords: ${post.keywords.join(', ')}

Requirements:
- Minimum 1,500 words of genuinely useful, detailed content
- Write in a professional but warm and human tone
- Include specific references to Rochester, Medway, Kent and relevant local towns throughout
- Structure with clear H2 and H3 subheadings
- Include practical, actionable advice throughout
- Do NOT use em dashes (—), use hyphens or rewrite the sentence instead
- Do NOT mention competitors by name
- End with a clear call to action to call 01634 971005 or visit medwaykentremovals.co.uk/contact

Return ONLY the inner HTML content that goes inside the <article> tag.
Start with a <p> opening paragraph.
Use <h2>, <h3>, <p>, <ul>, <li>, <strong> tags only.
Do NOT include DOCTYPE, html, head, body, article tags or any wrapper.
Do NOT include markdown, code blocks or backticks.`;

  const response = await httpsPost(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    },
    {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    }
  );

  if (!response.content || !response.content[0]) {
    throw new Error('Claude API returned no content: ' + JSON.stringify(response));
  }

  return response.content[0].text;
}

// ══════════════════════════════════════════════════════
//  STEP 2 — Build and save the HTML page
// ══════════════════════════════════════════════════════
function buildHtmlPage(post, articleContent) {
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric'
  });
  const dateISO = today.toISOString().split('T')[0];

  const schema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "headline": post.title,
    "description": `${post.title} — expert advice from Medway and Kent Removals, Rochester.`,
    "author": { "@type": "Organization", "name": "Medway and Kent Removals" },
    "publisher": {
      "@type": "Organization",
      "name": "Medway and Kent Removals",
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "47 Knight Templar Way",
        "addressLocality": "Rochester",
        "addressRegion": "Kent",
        "postalCode": "ME2 2ZE",
        "addressCountry": "GB"
      }
    },
    "datePublished": dateISO,
    "dateModified": dateISO,
    "keywords": post.keywords.join(', '),
    "mainEntityOfPage": `https://www.medwaykentremovals.co.uk/blog/posts/${post.slug}`
  });

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${post.title} | Medway &amp; Kent Removals Rochester</title>
<meta name="description" content="${post.title} — expert moving advice from Medway and Kent Removals, Rochester ME2 2ZE. Call 01634 971005 for a free quote.">
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
<link rel="canonical" href="https://www.medwaykentremovals.co.uk/blog/posts/${post.slug}">
<meta property="og:type" content="article">
<meta property="og:title" content="${post.title} | Medway &amp; Kent Removals">
<meta property="og:url" content="https://www.medwaykentremovals.co.uk/blog/posts/${post.slug}">
<meta property="og:site_name" content="Medway and Kent Removals">
<script type="application/ld+json">${schema}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"https://www.medwaykentremovals.co.uk/"},{"@type":"ListItem","position":2,"name":"Blog","item":"https://www.medwaykentremovals.co.uk/blog"},{"@type":"ListItem","position":3,"name":"${post.title}","item":"https://www.medwaykentremovals.co.uk/blog/posts/${post.slug}"}]}</script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css">
<style>
.post-hero{background:var(--navy);padding:56px 0 48px}
.post-hero h1{font-size:clamp(26px,3.5vw,42px);color:#fff;letter-spacing:-0.5px;max-width:780px;line-height:1.25;margin-bottom:14px}
.post-meta{display:flex;gap:20px;flex-wrap:wrap;font-size:13px;color:rgba(255,255,255,0.5);margin-top:16px}
.post-layout{display:grid;grid-template-columns:1fr 300px;gap:56px;align-items:start;margin-top:48px}
@media(max-width:900px){.post-layout{grid-template-columns:1fr}}
.post-body{font-size:16px;color:#333;line-height:1.9}
.post-body h2{font-size:24px;color:var(--navy);font-family:var(--ff-display);margin:40px 0 14px;letter-spacing:-0.3px}
.post-body h3{font-size:19px;color:var(--navy);font-family:var(--ff-display);margin:28px 0 10px}
.post-body p{margin-bottom:18px}
.post-body ul,.post-body ol{margin:0 0 18px 22px;display:flex;flex-direction:column;gap:8px}
.post-body ul li,.post-body ol li{font-size:15px;color:#444;line-height:1.7}
.post-body strong{color:#111;font-weight:600}
.post-body a{color:var(--accent)}
.post-cta-box{background:var(--navy);border-radius:12px;padding:32px;margin:40px 0;text-align:center}
.post-cta-box h3{color:#fff;font-size:20px;margin-bottom:10px}
.post-cta-box p{color:rgba(255,255,255,0.65);font-size:15px;margin-bottom:20px}
.tag-cat{display:inline-block;background:var(--accent);color:#fff;font-size:11px;font-weight:700;padding:4px 12px;border-radius:4px;text-transform:uppercase;letter-spacing:0.5px;font-family:var(--ff-body);margin-bottom:16px}
.side-card{background:#fff;border:1px solid var(--border);border-radius:12px;padding:24px;margin-bottom:20px}
.side-card h4{font-family:var(--ff-display);font-size:16px;color:var(--navy);margin-bottom:12px}
</style>
</head>
<body>
<nav id="site-nav" role="navigation" aria-label="Main navigation">
  <div class="nav-inner">
    <a class="nav-logo" href="/" aria-label="Medway and Kent Removals Home">Medway &amp; Kent <span>Removals</span></a>
    <ul class="nav-links" role="list">
      <li><a href="/">Home</a></li>
      <li><a href="/services">Services</a></li>
      <li><a href="/areas">Areas We Cover</a></li>
      <li><a href="/about">About Us</a></li>
      <li><a href="/blog" class="active">Blog</a></li>
      <li><a href="/contact" class="nav-cta btn">Get a Free Quote</a></li>
    </ul>
    <button class="hamburger" onclick="toggleMobile()" aria-label="Open menu"><span></span><span></span><span></span></button>
  </div>
</nav>
<div id="mobile-overlay" role="dialog" aria-modal="true"><button class="mob-close" onclick="toggleMobile()">&#10005;</button>
  <a class="mob-nav-link" href="/">Home</a><a class="mob-nav-link" href="/services">Services</a>
  <a class="mob-nav-link" href="/blog">Blog</a>
  <a class="mob-nav-link" href="/contact" style="color:var(--accent)">Get a Free Quote &#8594;</a>
</div>

<div class="post-hero">
  <div class="container">
    <nav aria-label="Breadcrumb" style="margin-bottom:16px"><ol style="list-style:none;display:flex;gap:8px;font-size:13px;color:rgba(255,255,255,0.5)"><li><a href="/" style="color:rgba(255,255,255,0.5)">Home</a></li><li style="color:rgba(255,255,255,0.3)">&#8250;</li><li><a href="/blog" style="color:rgba(255,255,255,0.5)">Blog</a></li><li style="color:rgba(255,255,255,0.3)">&#8250;</li><li style="color:rgba(255,255,255,0.8)">${post.category}</li></ol></nav>
    <span class="tag-cat">${post.category}</span>
    <h1>${post.title}</h1>
    <div class="post-meta">
      <span>&#128197; ${dateStr}</span>
      <span>&#128336; 6 min read</span>
      <span>&#128101; Medway &amp; Kent Removals Team</span>
    </div>
  </div>
</div>

<section style="padding:56px 0">
  <div class="container">
    <div class="post-layout">
      <article class="post-body">
        ${articleContent}

        <div class="post-cta-box">
          <h3>Planning a move in Medway or Kent?</h3>
          <p>Get a free, no-obligation quote from our Rochester team. Fully insured, fixed-price and ready to help.</p>
          <a href="/contact" class="btn btn-primary" style="margin-right:12px">Get a Free Quote</a>
          <a href="tel:01634971005" class="btn btn-secondary">&#128222; 01634 971005</a>
        </div>
      </article>

      <aside>
        <div class="side-card">
          <h4>Get a free quote</h4>
          <p style="font-size:13px;color:var(--muted);margin-bottom:16px;line-height:1.6">Fully insured. Fixed price. Rochester based. We respond within 60 minutes.</p>
          <a href="/contact" class="btn btn-primary" style="width:100%;justify-content:center;font-size:14px;margin-bottom:10px">Get a Free Quote</a>
          <a href="tel:01634971005" style="display:block;text-align:center;font-size:14px;color:var(--accent);font-weight:700">&#128222; 01634 971005</a>
        </div>
        <div class="side-card">
          <h4>Browse all articles</h4>
          <a href="/blog" style="font-size:14px;color:var(--accent);font-weight:600">&#8592; Back to Blog</a>
        </div>
        <div class="side-card" style="background:var(--navy);border-color:var(--navy)">
          <h4 style="color:#fff">Our services</h4>
          <ul style="list-style:none;display:flex;flex-direction:column;gap:10px">
            <li><a href="/services#house" style="font-size:14px;color:rgba(255,255,255,0.7);text-decoration:none">House Removals Rochester</a></li>
            <li><a href="/services#packing" style="font-size:14px;color:rgba(255,255,255,0.7);text-decoration:none">Packing Services</a></li>
            <li><a href="/services#office" style="font-size:14px;color:rgba(255,255,255,0.7);text-decoration:none">Office Removals</a></li>
            <li><a href="/services#manvan" style="font-size:14px;color:rgba(255,255,255,0.7);text-decoration:none">Man and Van</a></li>
            <li><a href="/services#storage" style="font-size:14px;color:rgba(255,255,255,0.7);text-decoration:none">Storage Solutions</a></li>
          </ul>
        </div>
      </aside>
    </div>
  </div>
</section>

<div class="cta-band">
  <div class="container">
    <h2>Ready to book your removal in Medway or Kent?</h2>
    <p>Get a free, no-obligation quote from our Rochester team. We respond within 60 minutes during business hours.</p>
    <div class="cta-actions"><a href="/contact" class="btn btn-primary">Get a Free Quote</a><a href="tel:01634971005" class="btn btn-secondary">&#128222; 01634 971005</a></div>
  </div>
</div>

<footer id="site-footer" role="contentinfo">
  <div class="footer-grid">
    <div class="footer-brand"><a class="nav-logo" href="/">Medway &amp; Kent <span>Removals</span></a>
      <p>Professional, fully insured removal company based in Rochester, Kent. Serving Medway and all of Kent since 2020.</p>
      <div class="footer-contact-item">&#128205; <span>47 Knight Templar Way, Rochester, Kent, ME2 2ZE</span></div>
      <div class="footer-contact-item">&#128222; <a href="tel:01634971005">01634 971005</a></div>
    </div>
    <div class="footer-col"><h4>Services</h4><ul><li><a href="/services#house">House Removals</a></li><li><a href="/services#packing">Packing Services</a></li><li><a href="/services#office">Office Removals</a></li><li><a href="/services#manvan">Man and Van</a></li></ul></div>
    <div class="footer-col"><h4>Blog</h4><ul><li><a href="/blog">All Articles</a></li></ul></div>
    <div class="footer-col"><h4>Company</h4><ul><li><a href="/about">About Us</a></li><li><a href="/contact">Get a Quote</a></li><li><a href="/privacy-policy">Privacy Policy</a></li></ul></div>
  </div>
  <div style="border-top:1px solid rgba(255,255,255,0.08);padding:20px 5%;max-width:1120px;margin:0 auto">
    <p style="font-size:12px;color:rgba(255,255,255,0.35)">&copy; 2025 Medway &amp; Kent Removals. All rights reserved.</p>
  </div>
</footer>
<script src="/script.js"></script>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════
//  STEP 3 — Send to Make.com webhook
// ══════════════════════════════════════════════════════
async function triggerMakeWebhook(post, imageUrl) {
  console.log('\n[3/3] Triggering Make.com webhook for social posting...');

  const webhookUrl = process.env.MAKE_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log('No MAKE_WEBHOOK_URL set — skipping social posting');
    return;
  }

  const blogUrl = `https://www.medwaykentremovals.co.uk/blog/posts/${post.slug}`;

  const payload = {
    title:      post.title,
    slug:       post.slug,
    category:   post.category,
    blog_url:   blogUrl,
    caption:    post.caption + `\n\n🔗 Read the full article: ${blogUrl}`,
    image_url:  imageUrl,
    day:        todayDay
  };

  const result = await httpsPost(webhookUrl, payload);
  console.log('Make.com response:', JSON.stringify(result));
  console.log('Social post triggered successfully');
}

// ══════════════════════════════════════════════════════
//  MAIN — Run everything
// ══════════════════════════════════════════════════════
async function main() {
  try {
    // Step 1 — Generate blog content via Claude
    const articleContent = await generateBlogPost(post);
    console.log(`Blog content generated — approx ${articleContent.split(' ').length} words`);

    // Step 2 — Build and save HTML file
    console.log('\n[2/3] Building and saving HTML file...');
    const html = buildHtmlPage(post, articleContent);
    const outputPath = path.join(__dirname, '..', 'blog', 'posts', `${post.slug}.html`);

    // Ensure directory exists
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, html, 'utf8');
    console.log(`Saved: blog/posts/${post.slug}.html`);

    // Save current day for git commit message
    fs.writeFileSync(path.join(__dirname, 'current-day.txt'), String(todayDay));

    // Step 3 — Trigger Make.com webhook
    await triggerMakeWebhook(post, imageUrl);

    // Update state
    state.currentDay = todayDay;
    state.lastRun    = new Date().toISOString();
    state.lastPost   = post.slug;
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

    console.log('\n══════════════════════════════════');
    console.log(`Day ${todayDay} complete`);
    console.log(`Post: ${post.slug}`);
    console.log(`Image used: blog-social-${imageNum}.jpg`);
    console.log('══════════════════════════════════\n');

  } catch(err) {
    console.error('\nERROR:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
