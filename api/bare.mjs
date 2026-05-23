export default async function handler(req, res) {
  try {
    const bareUrl = req.headers['x-bare-url'];
    const bareMethod = req.headers['x-bare-method'] || req.method;
    
    let bareHeaders = {};
    try {
        bareHeaders = JSON.parse(req.headers['x-bare-headers'] || '{}');
    } catch (e) {
        console.warn(e);
    }

    if (!bareUrl) {
      return res.status(200).json({
        versions: ['v1'],
        language: 'Node.js',
        maintainer: 'Velium'
      });
    }

    const outboundHeaders = new Headers();
    for (const key in bareHeaders) {
        if (['host', 'connection', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())) continue;
        outboundHeaders.set(key, bareHeaders[key]);
    }

    let requestBody = null;
    if (['POST', 'PUT', 'PATCH'].includes(bareMethod.toUpperCase())) {
        const chunks = [];
        for await (const chunk of req) {
            chunks.push(chunk);
        }
        requestBody = Buffer.concat(chunks);
    }

    const response = await fetch(bareUrl, {
      method: bareMethod,
      headers: outboundHeaders,
      body: requestBody,
      redirect: 'manual',
    });

    res.status(response.status);

    for (const [key, value] of response.headers.entries()) {
        if (!['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'content-encoding'].includes(key.toLowerCase())) {
            res.setHeader(key, value);
        }
    }

    const reader = response.body.getReader();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
        }
    } finally {
        res.end();
    }

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
}
