const express = require('express');
const https = require('https');

const app = express();
app.use(express.json());

const API_KEY = process.env.PROXY_API_KEY;
const INTER_HOST = 'cdpj.partners.bancointer.com.br';

// Rota pública de teste
app.get('/ping', (req, res) => res.send('pong'));

// Middleware de autenticação simples
app.use((req, res, next) => {
  if (req.headers['x-api-key'] !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

function interRequest(path, method, headers, body) {
  return new Promise((resolve, reject) => {
    const certPem = Buffer.from(process.env.INTER_CERT_CRT_B64, 'base64').toString('utf8');
    const keyPem  = Buffer.from(process.env.INTER_CERT_KEY_B64, 'base64').toString('utf8');

    const options = {
      hostname: INTER_HOST,
      port: 443,
      path,
      method,
      headers,
      cert: certPem,
      key: keyPem,
      rejectUnauthorized: true,
    };

    const req = https.request(options, (res2) => {
      let data = '';
      res2.on('data', (chunk) => { data += chunk; });
      res2.on('end', () => resolve({ status: res2.statusCode, body: data }));
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Rota: gerar token
app.post('/token', async (req, res) => {
  const { clientId, clientSecret, scope } = req.body;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    ...(scope ? { scope } : {}),
  }).toString();

  const result = await interRequest('/oauth/v2/token', 'POST', {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(body).toString(),
  }, body);

  res.status(result.status).send(result.body);
});

// Rota: saldo
app.post('/saldo', async (req, res) => {
  const { token, data } = req.body;
  const result = await interRequest(
    `/banking/v3/saldo?dataSaldo=${data}`, 'GET',
    { 'Authorization': `Bearer ${token}` }, null
  );
  res.status(result.status).send(result.body);
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Proxy rodando');
  console.log('Rotas registradas:');
  app._router.stack
    .filter(r => r.route)
    .forEach(r => console.log(Object.keys(r.route.methods).join(',').toUpperCase(), r.route.path));
});