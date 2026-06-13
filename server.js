const express = require('express');
const https = require('https');

const app = express();
app.use(express.json());

const API_KEY    = process.env.PROXY_API_KEY;
const INTER_HOST = 'cdpj.partners.bancointer.com.br';
const CONTA      = process.env.INTER_CONTA_CORRENTE || '239864107';

app.get('/ping', (req, res) => res.send('pong'));

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
    const options = { hostname: INTER_HOST, port: 443, path, method, headers, cert: certPem, key: keyPem, rejectUnauthorized: true };
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

function qs(params) {
  const q = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return q ? `?${q}` : '';
}

async function proxy(res, fn) {
  try {
    const result = await fn();
    res.status(result.status).send(result.body);
  } catch (err) {
    console.error('Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
}

function cobHeaders(token, extra = {}) {
  return { 'Authorization': `Bearer ${token}`, 'x-conta-corrente': CONTA, ...extra };
}

app.post('/token', async (req, res) => {
  const { clientId, clientSecret, scope } = req.body;
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials', ...(scope ? { scope } : {}) }).toString();
  await proxy(res, () => interRequest('/oauth/v2/token', 'POST', { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body).toString() }, body));
});

app.post('/saldo', async (req, res) => {
  const { token, dataSaldo } = req.body;
  await proxy(res, () => interRequest(`/banking/v3/saldo${qs({ dataSaldo })}`, 'GET', cobHeaders(token), null));
});

app.post('/cobranca/emitir', async (req, res) => {
  const { token, ...boleto } = req.body;
  const bodyStr = JSON.stringify(boleto);
  await proxy(res, () => interRequest('/cobranca/v3/cobrancas', 'POST', { ...cobHeaders(token, { 'Content-Type': 'application/json' }), 'Content-Length': Buffer.byteLength(bodyStr).toString() }, bodyStr));
});

app.post('/cobranca/listar', async (req, res) => {
  const { token, dataInicial, dataFinal, situacao, nome, cpfCnpjDevedor, itensPorPagina, paginaAtual } = req.body;
  await proxy(res, () => interRequest(`/cobranca/v3/cobrancas${qs({ dataInicial, dataFinal, situacao, nome, cpfCnpjDevedor, itensPorPagina, paginaAtual })}`, 'GET', cobHeaders(token), null));
});

app.post('/cobranca/sumario', async (req, res) => {
  const { token, dataInicial, dataFinal, situacao } = req.body;
  await proxy(res, () => interRequest(`/cobranca/v3/cobrancas/sumario${qs({ dataInicial, dataFinal, situacao })}`, 'GET', cobHeaders(token), null));
});

app.post('/cobranca/consultar', async (req, res) => {
  const { token, nossoNumero } = req.body;
  await proxy(res, () => interRequest(`/cobranca/v3/cobrancas/${nossoNumero}`, 'GET', cobHeaders(token), null));
});

app.post('/cobranca/cancelar', async (req, res) => {
  const { token, nossoNumero, motivoCancelamento } = req.body;
  const bodyStr = JSON.stringify({ motivoCancelamento: motivoCancelamento || 'ACERTO_DE_LANCAMENTO' });
  await proxy(res, () => interRequest(`/cobranca/v3/cobrancas/${nossoNumero}/cancelar`, 'POST', { ...cobHeaders(token, { 'Content-Type': 'application/json' }), 'Content-Length': Buffer.byteLength(bodyStr).toString() }, bodyStr));
});

app.post('/cobranca/pdf', async (req, res) => {
  const { token, nossoNumero } = req.body;
  await proxy(res, () => interRequest(`/cobranca/v3/cobrancas/${nossoNumero}/pdf`, 'GET', cobHeaders(token), null));
});

app.post('/cobranca/webhook/criar', async (req, res) => {
  const { token, webhookUrl } = req.body;
  const bodyStr = JSON.stringify({ webhookUrl });
  await proxy(res, () => interRequest('/cobranca/v3/cobrancas/webhook', 'PUT', { ...cobHeaders(token, { 'Content-Type': 'application/json' }), 'Content-Length': Buffer.byteLength(bodyStr).toString() }, bodyStr));
});

app.post('/cobranca/webhook/consultar', async (req, res) => {
  const { token } = req.body;
  await proxy(res, () => interRequest('/cobranca/v3/cobrancas/webhook', 'GET', cobHeaders(token), null));
});

app.post('/cobranca/webhook/excluir', async (req, res) => {
  const { token } = req.body;
  await proxy(res, () => interRequest('/cobranca/v3/cobrancas/webhook', 'DELETE', cobHeaders(token), null));
});

app.post('/cobranca/callback', async (req, res) => {
  const { token, dataHoraInicio, dataHoraFim, itensPorPagina, paginaAtual } = req.body;
  await proxy(res, () => interRequest(`/cobranca/v3/cobrancas/webhook/callbacks${qs({ dataHoraInicio, dataHoraFim, itensPorPagina, paginaAtual })}`, 'GET', cobHeaders(token), null));
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Proxy Inter rodando na porta ${process.env.PORT || 3000}`);
});
