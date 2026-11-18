const axios = require('axios');

function obterApiUrl() {
  const versao = process.env.WHATSAPP_GRAPH_VERSION;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!versao || !/^v\d+\.\d+$/.test(versao) || !phoneNumberId) {
    throw new Error('Configuração da WhatsApp Cloud API incompleta: confira WHATSAPP_GRAPH_VERSION e WHATSAPP_PHONE_NUMBER_ID.');
  }
  return `https://graph.facebook.com/${versao}/${phoneNumberId}/messages`;
}

async function enviar(payload) {
  if (!process.env.WHATSAPP_ACCESS_TOKEN) {
    throw new Error('WHATSAPP_ACCESS_TOKEN não está configurado no arquivo .env.');
  }
  const response = await axios.post(obterApiUrl(), payload, {
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    timeout: 15000
  });

  return response.data;
}

async function enviarTexto(telefone, texto) {
  return enviar({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: telefone,
    type: 'text',
    text: {
      preview_url: false,
      body: texto
    }
  });
}

async function enviarMenuSetores(telefone) {
  return enviar({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: telefone,
    type: 'interactive',
    interactive: {
      type: 'list',
      header: {
        type: 'text',
        text: 'Atendimento'
      },
      body: {
        text: 'Olá! Selecione o setor para o qual deseja atendimento.'
      },
      footer: {
        text: 'Escolha uma das opções abaixo.'
      },
      action: {
        button: 'Ver setores',
        sections: [
          {
            title: 'Setores disponíveis',
            rows: [
              {
                id: 'setor_1',
                title: 'Suporte expresso',
                description: 'Emissão de NF-e, NFC-e, Cadastros e uso diário.'
              },
              {
                id: 'setor_2',
                title: 'Suporte técnico',
                description: 'Instalação de sistema, '
              },
              {
                id: 'setor_3',
                title: 'Treinamento',
                description: 'Treinamento de uso de sistema.'
              },
              {
                id: 'setor_4',
                title: 'Financeiro',
                description: '2ª Via de fatura/Pagamentos.'
              }
            ]
          }
        ]
      }
    }
  });
}

module.exports = {
  enviarTexto,
  enviarMenuSetores
};