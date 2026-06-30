const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const browserPath = '/opt/data/pw-browsers/chromium-1217/chrome-linux/chrome';
const outputDir = '/tmp/xhs-images';

async function downloadImages() {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch({
    executablePath: browserPath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  const posts = [
    { note_id: '6a4312310000000008002661', xsec_token: null, label: 'tt-agent' },
    { note_id: '6a424250000000001101eb0d', xsec_token: null, label: 'java-1mian' },
    { note_id: '6a28ff15000000002003b5f4', xsec_token: null, label: 'agent-3skill' },
  ];

  // Extract tokens from stored HTML
  for (const p of posts) {
    const html = fs.readFileSync(`/tmp/xhs-post-${p.note_id}.html`, 'utf-8');
    const tokenMatch = html.match(/xsec_token[=:]["']([^&"']+)/);
    p.xsec_token = tokenMatch ? tokenMatch[1] : '';
  }

  for (const post of posts) {
    const fetchUrl = `https://www.xiaohongshu.com/explore/${post.note_id}?xsec_token=${post.xsec_token}&xsec_source=app_share`;
    console.log(`Fetching: ${post.label}`);

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    const captured = [];
    page.on('response', async (resp) => {
      const url = resp.url();
      if (url.includes('xhscdn') && url.includes('1040g')) {
        const ct = resp.headers()['content-type'] || '';
        if (resp.status() === 200 && (ct.includes('image') || url.includes('png') || url.includes('webp') || url.includes('jpeg'))) {
          try {
            const body = await resp.body();
            if (body.length > 5000) {
              captured.push({ url, body, size: body.length });
            }
          } catch(e) {}
        }
      }
    });

    await page.goto(fetchUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(4000);

    // Sort by size descending
    captured.sort((a, b) => b.size - a.size);

    // Dedup by fileId in URL
    const seen = new Set();
    let saved = 0;
    for (const img of captured) {
      const fileIdMatch = img.url.match(/1040g[a-z0-9]+/i);
      const fileId = fileIdMatch ? fileIdMatch[0] : img.url;
      if (seen.has(fileId)) continue;
      seen.add(fileId);

      const ext = img.url.includes('png') ? 'webp' : (img.url.includes('jpeg') || img.url.includes('jpg') ? 'jpg' : 'webp');
      const fname = `${post.label}-${saved}.${ext}`;
      fs.writeFileSync(path.join(outputDir, fname), img.body);
      console.log(`  Saved: ${fname} (${img.size} bytes)`);
      saved++;
    }

    await context.close();
    console.log(`  Total saved: ${saved} images for ${post.label}`);
  }

  await browser.close();
  console.log('Done!');
}

downloadImages().catch(console.error);
