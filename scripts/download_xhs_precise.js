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
    { 
      note_id: '6a4312310000000008002661', label: 'tt-agent',
      fileIds: ['1040g2sg3221655jr7e5g5','1040g2sg3221655jr7e505','1040g2sg3221655jr7e1g5','1040g2sg3221655jr7e405','1040g2sg3221655jr7e205','1040g2sg3221655jr7e2g5','1040g2sg3221655jr7e305','1040g2sg3221655jr7e4g5']
    },
    { 
      note_id: '6a424250000000001101eb0d', label: 'java-1mian',
      fileIds: ['1040g0083220cqcnnn0005','1040g0083220cqcnnn00g5','1040g0083220cqcnnn0105']
    },
    { 
      note_id: '6a28ff15000000002003b5f4', label: 'agent-3skill',
      fileIds: ['1040g34o3217n6tt3n0105']
    },
  ];

  for (const post of posts) {
    const html = fs.readFileSync(`/tmp/xhs-post-${post.note_id}.html`, 'utf-8');
    const tokenMatch = html.match(/xsec_token=([^&"']+)/);
    const token = tokenMatch ? tokenMatch[1] : '';
    const fetchUrl = `https://www.xiaohongshu.com/explore/${post.note_id}?xsec_token=${token}&xsec_source=app_share`;

    console.log(`\n=== ${post.label} ===`);

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    // Capture responses matching our specific fileIds
    const captured = {};
    page.on('response', async (resp) => {
      const url = resp.url();
      for (const fid of post.fileIds) {
        if (url.includes(fid) && !captured[fid]) {
          const ct = resp.headers()['content-type'] || '';
          if (ct.includes('image') || url.includes('png') || url.includes('webp')) {
            try {
              const body = await resp.body();
              if (body.length > 5000) {
                captured[fid] = body;
                console.log(`  Captured: ${fid} (${body.length} bytes)`);
              }
            } catch(e) {}
          }
        }
      }
    });

    await page.goto(fetchUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Scroll to trigger lazy loading
    for (let i = 0; i < 8; i++) {
      await page.evaluate(() => window.scrollBy(0, 500));
      await page.waitForTimeout(800);
    }

    // Save captured images
    let saved = 0;
    for (const fid of post.fileIds) {
      if (captured[fid]) {
        const fname = `${post.label}-${saved}.webp`;
        fs.writeFileSync(path.join(outputDir, fname), captured[fid]);
        saved++;
      }
    }

    // For any missing, try direct navigation
    for (let i = 0; i < post.fileIds.length; i++) {
      const fid = post.fileIds[i];
      if (captured[fid]) continue;

      // Find the URL from HTML
      const urlMatch = html.match(new RegExp(`https?://sns-webpic-qc\\.xhscdn\\.com[^"'\\s\\\\]*${fid}[^"'\\s\\\\]*`));
      if (urlMatch) {
        const imgUrl = urlMatch[0].replace(/\\u002F/g, '/');
        try {
          const resp = await page.goto(imgUrl, { timeout: 10000, waitUntil: 'load' });
          if (resp && resp.ok()) {
            const body = await resp.body();
            if (body.length > 5000) {
              const fname = `${post.label}-${saved}.webp`;
              fs.writeFileSync(path.join(outputDir, fname), body);
              console.log(`  Direct: ${fname} (${body.length} bytes) [${fid}]`);
              saved++;
            }
          }
        } catch(e) {
          console.log(`  Direct failed: ${fid} - ${e.message.substring(0, 50)}`);
        }
      }
    }

    await context.close();
    console.log(`  Total: ${saved}/${post.fileIds.length}`);
  }

  await browser.close();
  console.log('\nDone!');
}

downloadImages().catch(console.error);
