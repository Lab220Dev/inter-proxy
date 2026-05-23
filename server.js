const express = require('express');
const https   = require('https');
const app     = express();

app.use(express.json());

const API_KEY    = process.env.PROXY_API_KEY;
const INTER_HOST = 'cdpj.partners.bancointer.com.br';

// ─── Rotas públicas ───────────────────────────────────────────────────────────

app.get('/ping',       (_req, res) => res.send('pong'));
app.get('/saldo-test', (_req, res) => res.send('saldo-test ok'));

// ─── Middleware de autenticação ───────────────────────────────────────────────

app.use((req, res, next) => {
  if (req.headers['x-api-key'] !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// ─── Helper: requisição mTLS para o Inter ────────────────────────────────────

function interRequest(path, method, token, body) {
  return new Promise((resolve, reject) => {
    const certPem = Buffer.from(process.env.INTER_CERT_CRT_B64, 'base64').toString('utf8');
    const keyPem  = Buffer.from(process.env.INTER_CERT_KEY_B64, 'base64').toString('utf8');

    const bodyStr = body ? JSON.stringify(body) : null;

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr).toString();

    const options = {
      hostname: INTER_HOST,
      port: 443,
      path,
      method,
      headers,
      cert: certPem,
      key:  keyPem,
      rejectUnauthorized: true,
    };

    const req = https.request(options, (res2) => {
      let data = '';
      res2.on('data', (chunk) => { data += chunk; });
      res2.on('end', () => resolve({ status: res2.statusCode, body: data }));
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function interFormRequest(path, formBody) {
  return new Promise((resolve, reject) => {
    const certPem = Buffer.from(process.env.INTER_CERT_CRT_B64, 'base64').toString('utf8');
    const keyPem  = Buffer.from(process.env.INTER_CERT_KEY_B64, 'base64').toString('utf8');

    const options = {
      hostname: INTER_HOST,
      port: 443,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(formBody).toString(),
      },
      cert: certPem,
      key:  keyPem,
      rejectUnauthorized: true,
    };

    const req = https.request(options, (res2) => {
      let data = '';
      res2.on('data', (chunk) => { data += chunk; });
      res2.on('end', () => resolve({ status: res2.statusCode, body: data }));
    });

    req.on('error', reject);
    req.write(formBody);
    req.end();
  });
}

// Helper para construir query string a partir de objeto (ignora undefined/null)
function qs(params) {
  const q = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return q ? `?${q}` : '';
}

// Helper genérico de resposta
async function proxy(res, fn) {
  try {
    const result = await fn();
    res.status(result.status).send(result.body);
  } catch (err) {
    console.error('[proxy error]', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOKEN
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/token', async (req, res) => {
  const { clientId, clientSecret, scope } = req.body;
  const body = new URLSearchParams({
    client_id:     clientId,
    client_secret: clientSecret,
    grant_type:    'client_credentials',
    ...(scope ? { scope } : {}),
  }).toString();
  await proxy(res, () => interFormRequest('/oauth/v2/token', body));
});

// ═══════════════════════════════════════════════════════════════════════════════
// BANKING — SALDO
// ═══════════════════════════════════════════════════════════════════════════════

// GET /banking/v2/saldo
app.post('/saldo', async (req, res) => {
  const { token, dataSaldo } = req.body;
  await proxy(res, () =>
    interRequest(`/banking/v2/saldo${qs({ dataSaldo })}`, 'GET', token)
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// BANKING — EXTRATO
// ═══════════════════════════════════════════════════════════════════════════════

// GET /banking/v2/extrato
app.post('/extrato', async (req, res) => {
  const { token, dataInicio, dataFim, tipo, tipoTransacao, pagina, tamanhoPagina } = req.body;
  await proxy(res, () =>
    interRequest(`/banking/v2/extrato${qs({ dataInicio, dataFim, tipo, tipoTransacao, pagina, tamanhoPagina })}`, 'GET', token)
  );
});

// GET /banking/v2/extrato/exportar  → retorna PDF base64
app.post('/extrato/exportar', async (req, res) => {
  const { token, dataInicio, dataFim } = req.body;
  await proxy(res, () =>
    interRequest(`/banking/v2/extrato/exportar${qs({ dataInicio, dataFim })}`, 'GET', token)
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// BANKING — PAGAMENTO (boleto / código de barras)
// ═══════════════════════════════════════════════════════════════════════════════

// POST /banking/v2/pagamento  — inclui pagamento imediato ou agendado
app.post('/pagamento', async (req, res) => {
  const { token, ...body } = req.body;
  await proxy(res, () => interRequest('/banking/v2/pagamento', 'POST', token, body));
});

// GET /banking/v2/pagamento  — lista pagamentos
app.post('/pagamento/listar', async (req, res) => {
  const { token, dataInicio, dataFim, tipo, situacao, pagina, tamanhoPagina } = req.body;
  await proxy(res, () =>
    interRequest(`/banking/v2/pagamento${qs({ dataInicio, dataFim, tipo, situacao, pagina, tamanhoPagina })}`, 'GET', token)
  );
});

// GET /banking/v2/pagamento/:codigoTransacao
app.post('/pagamento/consultar', async (req, res) => {
  const { token, codigoTransacao } = req.body;
  await proxy(res, () =>
    interRequest(`/banking/v2/pagamento/${codigoTransacao}`, 'GET', token)
  );
});

// POST /banking/v2/pagamento/lote — pagamento em lote
app.post('/pagamento/lote', async (req, res) => {
  const { token, ...body } = req.body;
  await proxy(res, () => interRequest('/banking/v2/pagamento/lote', 'POST', token, body));
});

// GET /banking/v2/pagamento/lote/:idLote — consulta lote
app.post('/pagamento/lote/consultar', async (req, res) => {
  const { token, idLote, situacao } = req.body;
  await proxy(res, () =>
    interRequest(`/banking/v2/pagamento/lote/${idLote}${qs({ situacao })}`, 'GET', token)
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// BANKING — PIX PAGAMENTO
// ═══════════════════════════════════════════════════════════════════════════════

// POST /banking/v2/pix — inclui pix pagamento
app.post('/pix-pagamento', async (req, res) => {
  const { token, ...body } = req.body;
  await proxy(res, () => interRequest('/banking/v2/pix', 'POST', token, body));
});

// GET /banking/v2/pix/:endToEndId — consulta pix pagamento
app.post('/pix-pagamento/consultar', async (req, res) => {
  const { token, endToEndId } = req.body;
  await proxy(res, () =>
    interRequest(`/banking/v2/pix/${endToEndId}`, 'GET', token)
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// COBRANÇA BOLEPIX v3
// ═══════════════════════════════════════════════════════════════════════════════

// POST /cobranca/v3/ — emitir cobrança
app.post('/cobranca/emitir', async (req, res) => {
  const { token, ...body } = req.body;
  await proxy(res, () => interRequest('/cobranca/v3/', 'POST', token, body));
});

// GET /cobranca/v3/ — listar cobranças
app.post('/cobranca/listar', async (req, res) => {
  const { token, dataInicial, dataFinal, situacao, pessoaPagadora, nossoNumero,
          tipoOrdenacao, ordenarPor, pagina, tamanhoPagina } = req.body;
  await proxy(res, () =>
    interRequest(`/cobranca/v3/${qs({ dataInicial, dataFinal, situacao, pessoaPagadora,
      nossoNumero, tipoOrdenacao, ordenarPor, pagina, tamanhoPagina })}`, 'GET', token)
  );
});

// GET /cobranca/v3/:nossoNumero — recuperar cobrança
app.post('/cobranca/consultar', async (req, res) => {
  const { token, nossoNumero } = req.body;
  await proxy(res, () =>
    interRequest(`/cobranca/v3/${nossoNumero}`, 'GET', token)
  );
});

// DELETE /cobranca/v3/:nossoNumero — cancelar cobrança
app.post('/cobranca/cancelar', async (req, res) => {
  const { token, nossoNumero, ...body } = req.body;
  await proxy(res, () =>
    interRequest(`/cobranca/v3/${nossoNumero}`, 'DELETE', token, body)
  );
});

// GET /cobranca/v3/:nossoNumero/pdf — baixar PDF
app.post('/cobranca/pdf', async (req, res) => {
  const { token, nossoNumero } = req.body;
  await proxy(res, () =>
    interRequest(`/cobranca/v3/${nossoNumero}/pdf`, 'GET', token)
  );
});

// GET /cobranca/v3/sumario — sumário de cobranças
app.post('/cobranca/sumario', async (req, res) => {
  const { token, dataInicial, dataFinal, situacao } = req.body;
  await proxy(res, () =>
    interRequest(`/cobranca/v3/sumario${qs({ dataInicial, dataFinal, situacao })}`, 'GET', token)
  );
});

// POST /cobranca/v3/webhook — criar ou atualizar webhook
app.post('/cobranca/webhook/criar', async (req, res) => {
  const { token, ...body } = req.body;
  await proxy(res, () => interRequest('/cobranca/v3/webhook', 'POST', token, body));
});

// GET /cobranca/v3/webhook — consultar webhook
app.post('/cobranca/webhook/consultar', async (req, res) => {
  const { token } = req.body;
  await proxy(res, () => interRequest('/cobranca/v3/webhook', 'GET', token));
});

// DELETE /cobranca/v3/webhook — excluir webhook
app.post('/cobranca/webhook/excluir', async (req, res) => {
  const { token } = req.body;
  await proxy(res, () => interRequest('/cobranca/v3/webhook', 'DELETE', token));
});

// GET /cobranca/v3/callback — listar callbacks recebidos
app.post('/cobranca/callback', async (req, res) => {
  const { token, dataHoraInicio, dataHoraFim, pagina, tamanhoPagina } = req.body;
  await proxy(res, () =>
    interRequest(`/cobranca/v3/callback${qs({ dataHoraInicio, dataHoraFim, pagina, tamanhoPagina })}`, 'GET', token)
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// PIX — RECEBIMENTOS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /pix/v2/:e2eid — consultar pix recebido por e2eid
app.post('/pix/consultar', async (req, res) => {
  const { token, e2eid } = req.body;
  await proxy(res, () => interRequest(`/pix/v2/${e2eid}`, 'GET', token));
});

// GET /pix/v2/ — consultar pix recebidos (lista)
app.post('/pix/listar', async (req, res) => {
  const { token, inicio, fim, txid, txidPresente, devolucaoPresente,
          cpf, cnpj, pagina, tamanhoPagina } = req.body;
  await proxy(res, () =>
    interRequest(`/pix/v2/${qs({ inicio, fim, txid, txidPresente, devolucaoPresente,
      cpf, cnpj, pagina, tamanhoPagina })}`, 'GET', token)
  );
});

// POST /pix/v2/:e2eid/devolucao/:id — solicitar devolução
app.post('/pix/devolucao/solicitar', async (req, res) => {
  const { token, e2eid, id, ...body } = req.body;
  await proxy(res, () =>
    interRequest(`/pix/v2/${e2eid}/devolucao/${id}`, 'POST', token, body)
  );
});

// GET /pix/v2/:e2eid/devolucao/:id — consultar devolução
app.post('/pix/devolucao/consultar', async (req, res) => {
  const { token, e2eid, id } = req.body;
  await proxy(res, () =>
    interRequest(`/pix/v2/${e2eid}/devolucao/${id}`, 'GET', token)
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// PIX — COBRANÇA IMEDIATA (cob)
// ═══════════════════════════════════════════════════════════════════════════════

// POST /pix/v2/cob — criar cobrança imediata (txid gerado pelo Inter)
app.post('/pix/cob/criar', async (req, res) => {
  const { token, ...body } = req.body;
  await proxy(res, () => interRequest('/pix/v2/cob', 'POST', token, body));
});

// PUT /pix/v2/cob/:txid — criar cobrança imediata com txid definido pelo cliente
app.post('/pix/cob/criar-com-txid', async (req, res) => {
  const { token, txid, ...body } = req.body;
  await proxy(res, () => interRequest(`/pix/v2/cob/${txid}`, 'PUT', token, body));
});

// PATCH /pix/v2/cob/:txid — editar cobrança imediata
app.post('/pix/cob/editar', async (req, res) => {
  const { token, txid, ...body } = req.body;
  await proxy(res, () => interRequest(`/pix/v2/cob/${txid}`, 'PATCH', token, body));
});

// GET /pix/v2/cob/:txid — consultar cobrança imediata
app.post('/pix/cob/consultar', async (req, res) => {
  const { token, txid } = req.body;
  await proxy(res, () => interRequest(`/pix/v2/cob/${txid}`, 'GET', token));
});

// GET /pix/v2/cob — listar cobranças imediatas
app.post('/pix/cob/listar', async (req, res) => {
  const { token, inicio, fim, cpf, cnpj, status, pagina, tamanhoPagina } = req.body;
  await proxy(res, () =>
    interRequest(`/pix/v2/cob${qs({ inicio, fim, cpf, cnpj, status, pagina, tamanhoPagina })}`, 'GET', token)
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// PIX — COBRANÇA COM VENCIMENTO (cobv)
// ═══════════════════════════════════════════════════════════════════════════════

// PUT /pix/v2/cobv/:txid — criar cobrança com vencimento
app.post('/pix/cobv/criar', async (req, res) => {
  const { token, txid, ...body } = req.body;
  await proxy(res, () => interRequest(`/pix/v2/cobv/${txid}`, 'PUT', token, body));
});

// PATCH /pix/v2/cobv/:txid — editar cobrança com vencimento
app.post('/pix/cobv/editar', async (req, res) => {
  const { token, txid, ...body } = req.body;
  await proxy(res, () => interRequest(`/pix/v2/cobv/${txid}`, 'PATCH', token, body));
});

// GET /pix/v2/cobv/:txid — consultar cobrança com vencimento
app.post('/pix/cobv/consultar', async (req, res) => {
  const { token, txid } = req.body;
  await proxy(res, () => interRequest(`/pix/v2/cobv/${txid}`, 'GET', token));
});

// GET /pix/v2/cobv — listar cobranças com vencimento
app.post('/pix/cobv/listar', async (req, res) => {
  const { token, inicio, fim, cpf, cnpj, status, pagina, tamanhoPagina } = req.body;
  await proxy(res, () =>
    interRequest(`/pix/v2/cobv${qs({ inicio, fim, cpf, cnpj, status, pagina, tamanhoPagina })}`, 'GET', token)
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// PIX — WEBHOOK
// ═══════════════════════════════════════════════════════════════════════════════

// POST /pix/v2/webhook/:chave — criar/editar webhook pix
app.post('/pix/webhook/criar', async (req, res) => {
  const { token, chave, ...body } = req.body;
  await proxy(res, () => interRequest(`/pix/v2/webhook/${chave}`, 'PUT', token, body));
});

// GET /pix/v2/webhook/:chave — consultar webhook pix
app.post('/pix/webhook/consultar', async (req, res) => {
  const { token, chave } = req.body;
  await proxy(res, () => interRequest(`/pix/v2/webhook/${chave}`, 'GET', token));
});

// DELETE /pix/v2/webhook/:chave — excluir webhook pix
app.post('/pix/webhook/excluir', async (req, res) => {
  const { token, chave } = req.body;
  await proxy(res, () => interRequest(`/pix/v2/webhook/${chave}`, 'DELETE', token));
});

// GET /pix/v2/webhook — listar webhooks pix
app.post('/pix/webhook/listar', async (req, res) => {
  const { token, inicio, fim, pagina, tamanhoPagina } = req.body;
  await proxy(res, () =>
    interRequest(`/pix/v2/webhook${qs({ inicio, fim, pagina, tamanhoPagina })}`, 'GET', token)
  );
});

// GET /pix/v2/payload/:chave/:txid — consultar payload (QR Code)
app.post('/pix/payload', async (req, res) => {
  const { token, chave, txid } = req.body;
  await proxy(res, () => interRequest(`/pix/v2/payload/${chave}/${txid}`, 'GET', token));
});

// ═══════════════════════════════════════════════════════════════════════════════
// SERVIDOR
// ═══════════════════════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy Inter rodando na porta ${PORT}`));
