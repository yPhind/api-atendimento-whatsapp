const crypto = require('crypto');
const webhookService = require('../services/whatsappWebhookService');

function verificarAssinatura(req) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  const assinatura = req.headers['x-hub-signature-256'];

  if (!appSecret || !assinatura || !req.rawBody) {
    return false;
  }

  const assinaturaEsperada =
    'sha256=' +
    crypto
      .createHmac('sha256', appSecret)
      .update(req.rawBody)
      .digest('hex');

  const recebidaBuffer = Buffer.from(assinatura);
  const esperadaBuffer = Buffer.from(assinaturaEsperada);

  if (recebidaBuffer.length !== esperadaBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    recebidaBuffer,
    esperadaBuffer
  );
}

async function verificarWebhook(req, res) {
  const modo = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const desafio = req.query['hub.challenge'];

  if (
    modo === 'subscribe' &&
    token === process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    return res.status(200).send(desafio);
  }

  return res.sendStatus(403);
}

async function receberWebhook(req, res) {
  if (!verificarAssinatura(req)) {
    return res.sendStatus(401);
  }

  if (req.body?.object !== 'whatsapp_business_account') {
    return res.sendStatus(404);
  }

  try {
    await webhookService.processarWebhook(req.body, req.app.get("io"));
    return res.sendStatus(200);
  } catch (error) {
    // Não registrar tokens, cabeçalhos de autorização ou dados secretos.
    console.error('Erro ao processar webhook do WhatsApp:', error.message);
    return res.sendStatus(500);
  }
}

module.exports = {
  verificarWebhook,
  receberWebhook
};