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
    { note_id: '6a4312310000000008002661', label: 'tt-agent', expected: 8 },
    { note_id: '6a424250000000001101eb0d', label: 'java-1mian', expected: 3 },
    { note_id: '6a28ff15000000002003b5f4', label: 'agent-3skill', expected: 1 },
  ];

  for (const post of posts) {
    // Extract image URLs from HTML + token
    const html = fs.readFileSync(`/tmp/xhs-post-${post.note_id}.html`, 'utf-8');
    const tokenMatch = html.match(/xsec_token=([^&"']+)/);
    const token = tokenMatch ? tokenMatch[1] : '';
    
    // Get unique image URLs from HTML (the SSR-rendered ones)
    const allUrls = html.match(/https?:\/\/sns-webpic-qc\.xhscdn\.com[^"'\s\\]+/g) || [];
    // Dedup by fileId (1040g... pattern)
    const dedupMap = new Map();
    for (const u of allUrls) {
      const fileMatch = u.match(/1040g[a-z0-9]+/i);
      const fileId = fileMatch ? fileMatch[0] : u;
      // Prefer URLs with !nd_dft_wlteh or similar full-size suffix
      if (!dedupMap.has(fileId) || u.includes('!nd') || u.includes('!n_')) {
        dedupMap.set(fileId, u);
      }
    }
    const uniqueUrls = [...dedupMap.values()];
    
    console.log(`\n${post.label}: ${uniqueUrls.length} unique URLs (expected ${post.expected})`);

    const fetchUrl = `https://www.xiaohongshu.com/explore/${post.note_id}?xsec_token=${token}&xsec_source=app_share`;

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      extraHTTPHeaders: {
        'Referer': 'https://www.xiaohongshu.com/',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      }
    });
    const page = await context.newPage();

    // First navigate to the page to establish cookies/session
    await page.goto(fetchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);

    // Now try to fetch each image URL via page.evaluate (browser context)
    let saved = 0;
    for (let i = 0; i < uniqueUrls.length; i++) {
      const imgUrl = uniqueUrls[i].replace(/\\u002F/g, '/');
      try {
        // Use page context to fetch
        const result = await page.evaluate(async (url) => {
          try {
            const resp = await fetch(url, { credentials: 'include' });
            if (!resp.ok) return null;
            const blob = await resp.blob();
            const reader = new FileReader();
            return new Promise((resolve) => {
              reader.onloadend = () => resolve(reader.result);
              reader.readAsDataURL(blob);
            });
          } catch(e) {
            return null;
          }
        }, imgUrl);

        if (result) {
          const base64Data = result.split(',')[1];
          const buffer = Buffer.from(base64Data, 'base64');
          if (buffer.length > 5000) {
            const ext = imgUrl.includes('png') ? 'webp' : 'webp';
            const fname = `${post.label}-${saved}.${ext}`;
            fs.writeFileSync(path.join(outputDir, fname), buffer);
            console.log(`  Saved: ${fname} (${buffer.length} bytes)`);
            saved++;
          }
        }
      } catch(e) {
        console.log(`  Failed [${i}]: ${e.message.substring(0, 60)}`);
      }
    }

    await context.close();
    console.log(`  Total: ${saved} images`);
  }

  await browser.close();
  console.log('\nDone!');
}

downloadImages().catch(console.error);
