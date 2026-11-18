const sessaoRepository = require('../repositories/sessaoWhatsappRepository');
const setorRepository = require('../repositories/setorRepository');
const atendimentoService = require('./atendimentoService');
const atendimentoRepository = require('../repositories/atendimentoRepository');
const mensagemRepository = require('../repositories/mensagemRepository');
const empresaService = require('./empresaService');
const whatsapp = require('./whatsappCloudService');

const TEXTO_CNPJ =
  'Para iniciar o atendimento, informe o CNPJ da empresa que deseja atender.';

const TEXTO_DESCRICAO =
  'Descreva a sua solicitação e em seguida será atendido por um de nossos analistas.';

const TEXTO_EMPRESA_NAO_ENCONTRADA =
  'Não localizamos esse CNPJ em nossa base. Por favor, entre em contato com o setor comercial pelo WhatsApp (DDD) 99999-9999.';

const TEXTO_EMPRESA_INATIVA =
  'A empresa informada está com cadastro inativo. Por favor, entre em contato com o setor comercial pelo WhatsApp (DDD) 99999-9999.';

function normalizarTexto(texto) {
  return String(texto || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizarCnpj(cnpj) {
  return String(cnpj || '').replace(/\D/g, '');
}

function extrairResposta(message) {
  if (message.type === 'text') {
    return {
      tipo: 'texto',
      texto: message.text?.body || ''
    };
  }

  if (message.type === 'interactive') {
    const interactive = message.interactive || {};

    if (interactive.type === 'list_reply') {
      return {
        tipo: 'setor',
        id: interactive.list_reply?.id || ''
      };
    }

    if (interactive.type === 'button_reply') {
      return {
        tipo: 'setor',
        id: interactive.button_reply?.id || ''
      };
    }
  }

  return { tipo: 'nao_suportado' };
}

function extrairNome(value, message) {
  const contato = value.contacts?.find(
    item => item.wa_id === message.from
  );

  return contato?.profile?.name || 'Cliente WhatsApp';
}

async function obterSetorPorId(id) {
  const numero = Number(String(id).replace('setor_', ''));

  if (!Number.isInteger(numero) || numero < 1) {
    return null;
  }

  return setorRepository.buscarPorId(numero);
}

async function processarMensagem(value, message, io = null) {
  const telefone = message.from;
  const whatsappId = message.from;
  const nomeCliente = extrairNome(value, message);
  const resposta = extrairResposta(message);
  const texto = resposta.texto?.trim() || '';
  const textoNormalizado = normalizarTexto(texto);

  if (!telefone || !message.id) {
    return;
  }

  let sessao = await sessaoRepository.buscarPorTelefone(telefone);

  /*
   * Comandos para reiniciar o fluxo.
   * O usuário volta para a identificação por CNPJ.
   */
  if (
    resposta.tipo === 'texto' &&
    ['menu', 'inicio', 'comecar'].includes(textoNormalizado)
  ) {
    sessao = await sessaoRepository.salvar({
      telefone,
      whatsappId,
      nomeCliente,
      estado: 'aguardando_cnpj',
      setorId: null,
      empresaId: null,
      ultimaMensagemId: message.id
    });

    await whatsapp.enviarTexto(telefone, TEXTO_CNPJ);
    return;
  }

  /*
   * Se o cliente já possui atendimento ativo, novas mensagens entram na
   * conversa existente em vez de reiniciar o cadastro de CNPJ.
   */
  if (!sessao) {
    const atendimentoAberto = await atendimentoRepository.buscarAbertoPorTelefone(telefone);
    if (atendimentoAberto) {
      const conteudo = resposta.tipo === 'texto'
        ? texto
        : (resposta.tipo === 'setor' ? `Opção selecionada: ${resposta.id}` : '[Tipo de mensagem não suportado]');
      const mensagemSalva = await mensagemRepository.criar({
        atendimentoId: atendimentoAberto.id,
        remetenteTipo: 'usuario',
        direcao: 'entrada',
        tipo: resposta.tipo === 'nao_suportado' ? message.type || 'desconhecido' : 'texto',
        conteudo,
        identificadorExterno: message.id,
        dadosExtras: { whatsapp: true, tipoOriginal: message.type }
      });
      if (mensagemSalva && io) {
        const evento = { tipo: 'nova_mensagem', atendimentoId: Number(atendimentoAberto.id), setorId: Number(atendimentoAberto.setor_id), analistaId: atendimentoAberto.analista_id ? Number(atendimentoAberto.analista_id) : null, em: new Date().toISOString() };
        io.to('supervisores').emit('atendimentos:atualizar', evento);
        if (evento.setorId) io.to(`setor:${evento.setorId}`).emit('atendimentos:atualizar', evento);
        if (evento.analistaId) io.to(`usuario:${evento.analistaId}`).emit('atendimentos:atualizar', evento);
      }
      return;
    }
  }

  /*
   * Primeira mensagem do cliente.
   * Antes de mostrar os setores, o sistema precisa identificar
   * a empresa através do CNPJ.
   */
  if (!sessao) {
    await sessaoRepository.salvar({
      telefone,
      whatsappId,
      nomeCliente,
      estado: 'aguardando_cnpj',
      setorId: null,
      empresaId: null,
      ultimaMensagemId: message.id
    });

    await whatsapp.enviarTexto(telefone, TEXTO_CNPJ);
    return;
  }

  /*
   * Evita processar novamente o mesmo evento enviado pelo webhook.
   */
  if (sessao.ultima_mensagem_id === message.id) {
    return;
  }

  /*
   * ETAPA 1 — IDENTIFICAÇÃO DA EMPRESA
   */
  if (sessao.estado === 'aguardando_cnpj') {
    if (resposta.tipo !== 'texto' || !texto) {
      await sessaoRepository.atualizarEstado(
        telefone,
        'aguardando_cnpj',
        null,
        null,
        message.id
      );

      await whatsapp.enviarTexto(
        telefone,
        'Por favor, envie o CNPJ da empresa em uma mensagem de texto.'
      );

      return;
    }

    const cnpj = normalizarCnpj(texto);

    if (cnpj.length !== 14) {
      await sessaoRepository.atualizarEstado(
        telefone,
        'aguardando_cnpj',
        null,
        null,
        message.id
      );

      await whatsapp.enviarTexto(
        telefone,
        'O CNPJ informado não possui um formato válido. Envie os 14 números do CNPJ.'
      );

      return;
    }

    let empresa;

    try {
      empresa = await empresaService.identificarPorCnpj(cnpj);
    } catch (erro) {
      if (erro.message === 'CNPJ_INVALIDO') {
        await whatsapp.enviarTexto(
          telefone,
          'O CNPJ informado não possui um formato válido. Envie os 14 números do CNPJ.'
        );

        return;
      }

      if (erro.message === 'EMPRESA_NAO_ENCONTRADA') {
        await sessaoRepository.atualizarEstado(
          telefone,
          'aguardando_cnpj',
          null,
          null,
          message.id
        );

        await whatsapp.enviarTexto(
          telefone,
          TEXTO_EMPRESA_NAO_ENCONTRADA
        );

        return;
      }

      throw erro;
    }

    /*
     * A empresa foi encontrada, mas precisa estar ativa.
     */
    if (empresa.status !== 'Ativa') {
      await sessaoRepository.atualizarEstado(
        telefone,
        'aguardando_cnpj',
        null,
        null,
        message.id
      );

      await whatsapp.enviarTexto(
        telefone,
        TEXTO_EMPRESA_INATIVA
      );

      return;
    }

    /*
     * Empresa encontrada e ativa.
     * Guarda a empresa na sessão e libera o menu de setores.
     */
    await sessaoRepository.atualizarEstado(
      telefone,
      'aguardando_setor',
      null,
      empresa.id,
      message.id
    );

    await whatsapp.enviarTexto(
      telefone,
      `Empresa identificada com sucesso: ${empresa.nome_fantasia || empresa.razao_social}.`
    );

    await whatsapp.enviarMenuSetores(telefone);
    return;
  }

  /*
   * ETAPA 2 — ESCOLHA DO SETOR
   */
  if (sessao.estado === 'aguardando_setor') {
    if (!sessao.empresa_id) {
      await sessaoRepository.atualizarEstado(
        telefone,
        'aguardando_cnpj',
        null,
        null,
        message.id
      );

      await whatsapp.enviarTexto(telefone, TEXTO_CNPJ);
      return;
    }

    if (resposta.tipo !== 'setor') {
      await sessaoRepository.atualizarEstado(
        telefone,
        'aguardando_setor',
        null,
        sessao.empresa_id,
        message.id
      );

      await whatsapp.enviarTexto(
        telefone,
        'Por favor, selecione um dos setores disponíveis no menu.'
      );

      await whatsapp.enviarMenuSetores(telefone);
      return;
    }

    const setor = await obterSetorPorId(resposta.id);

    if (!setor || setor.ativo === false) {
      await sessaoRepository.atualizarEstado(
        telefone,
        'aguardando_setor',
        null,
        sessao.empresa_id,
        message.id
      );

      await whatsapp.enviarTexto(
        telefone,
        'Não foi possível identificar esse setor. Selecione uma opção do menu.'
      );

      await whatsapp.enviarMenuSetores(telefone);
      return;
    }

    await sessaoRepository.atualizarEstado(
      telefone,
      'aguardando_descricao',
      setor.id,
      sessao.empresa_id,
      message.id
    );

    await whatsapp.enviarTexto(
      telefone,
      TEXTO_DESCRICAO
    );

    return;
  }

  /*
   * ETAPA 3 — DESCRIÇÃO E CRIAÇÃO DO ATENDIMENTO
   */
  if (sessao.estado === 'aguardando_descricao') {
    if (resposta.tipo !== 'texto' || !texto) {
      await whatsapp.enviarTexto(
        telefone,
        'Por favor, envie sua solicitação em uma mensagem de texto.'
      );

      return;
    }

    if (!sessao.empresa_id) {
      await sessaoRepository.atualizarEstado(
        telefone,
        'aguardando_cnpj',
        null,
        null,
        message.id
      );

      await whatsapp.enviarTexto(telefone, TEXTO_CNPJ);
      return;
    }

    const setor = await setorRepository.buscarPorId(
      sessao.setor_id
    );

    if (!setor || setor.ativo === false) {
      await sessaoRepository.atualizarEstado(
        telefone,
        'aguardando_setor',
        null,
        sessao.empresa_id,
        message.id
      );

      await whatsapp.enviarTexto(
        telefone,
        'Esse setor não está disponível no momento. Selecione outro setor.'
      );

      await whatsapp.enviarMenuSetores(telefone);
      return;
    }

    /*
     * Cria o atendimento vinculado à empresa identificada.
     */
    const resultado = await atendimentoService.abrirAtendimento({
      telefone,
      whatsappId,
      nome: nomeCliente,
      setorId: setor.id,
      empresaId: sessao.empresa_id,
      descricao: texto,
      whatsappMessageId: message.id
    });

    await sessaoRepository.remover(telefone);

    await whatsapp.enviarTexto(
      telefone,
      `Sua solicitação foi registrada!\n` +
      `Protocolo: ${resultado.atendimento.protocolo}\n` +
      `Setor: ${resultado.setor.nome}\n\n` +
      'Um de nossos analistas dará continuidade ao atendimento por aqui.'
    );
  }
}

async function processarWebhook(payload, io = null) {
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};

      // Eventos de status de mensagens não iniciam atendimento.
      for (const message of value.messages || []) {
        await processarMensagem(value, message, io);
      }
    }
  }
}

module.exports = {
  processarWebhook
};