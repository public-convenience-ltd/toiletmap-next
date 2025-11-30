const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Toilet Map Client</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0d1117; color: #f0f6fc; }
      main { text-align: center; padding: 2rem; }
      h1 { font-size: clamp(2rem, 5vw, 3rem); margin-bottom: 0.5rem; }
      p { margin: 0.5rem 0; color: rgba(240, 246, 252, 0.8); }
      code { background: rgba(240, 246, 252, 0.1); padding: 0.2rem 0.4rem; border-radius: 4px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Toilet Map Client</h1>
      <p>Frontend worker placeholder is live on Cloudflare.</p>
      <p>Update <code>apps/toiletmap-client/src/index.ts</code> to render your UI.</p>
    </main>
  </body>
</html>`;

export default {
  fetch() {
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=UTF-8",
        "cache-control": "no-store",
      },
    });
  },
};
