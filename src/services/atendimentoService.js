const { randomUUID } = require("crypto");

const usuarioRepository = require("../repositories/usuarioRepository");
const atendimentoRepository = require("../repositories/atendimentoRepository");
const mensagemRepository = require("../repositories/mensagemRepository");
const setorRepository = require("../repositories/setorRepository");
const empresaRepository = require("../repositories/empresaRepository");
const usuarioSistemaRepository = require("../repositories/usuarioSistemaRepository");
const historicoAtendimentoRepository = require("../repositories/historicoAtendimentoRepository");


async function abrirAtendimento({
  nome,
  telefone,
  whatsappId,
  setorId,
  empresaId,
  descricao,
  remetenteTipo = "usuario",
  remetenteId = null,
  direcao = "entrada",
  atendimentoOrigemId = null
}) {
  if (!telefone || !setorId || !empresaId || !descricao?.trim()) {
    throw new Error(
      "Telefone, setor, empresa e descrição são obrigatórios."
    );
  }

  const setor = await setorRepository.buscarPorId(setorId);

  if (!setor || setor.ativo === false) {
    throw new Error("Setor não encontrado ou inativo.");
  }

  const empresa = await empresaRepository.buscarPorId(empresaId);

  if (!empresa) {
    throw new Error("Empresa não encontrada.");
  }

  if (empresa.status !== "Ativa") {
    throw new Error("Empresa inativa.");
  }

  const usuario = await usuarioRepository.criar({
    nome,
    telefone,
    whatsappId,
    empresaId
  });

  const protocolo = `WB-${randomUUID().slice(0, 8).toUpperCase()}`;

  const atendimento = await atendimentoRepository.criar({
    usuarioId: usuario.id,
    setorId: setor.id,
    empresaId,
    descricao: descricao.trim(),
    protocolo,
    atendimentoOrigemId
  });

  // A descrição de atendimentos internos/manuais é uma observação operacional,
  // não uma mensagem a ser exibida ou enviada na conversa com o cliente.
  // Somente solicitações recebidas pelo fluxo do WhatsApp entram na conversa.
  if (direcao === "entrada") {
    await mensagemRepository.criar({
      atendimentoId: atendimento.id,
      remetenteTipo,
      remetenteId,
      direcao,
      tipo: "texto",
      conteudo: descricao.trim()
    });
  }

  return {
    atendimento,
    usuario,
    setor,
    empresa
  };
}

async function obterFila(setorId = null) {
  if (setorId !== null) {
    const setor = await setorRepository.buscarPorId(setorId);

    if (!setor) {
      throw new Error("Setor não encontrado ou inativo.");
    }
  }

  return atendimentoRepository.listarFila(setorId);
}

async function obterTodosParaSupervisor() {
  return atendimentoRepository.listarTodosParaSupervisor();
}

async function obterAtendimentosHistorico() {
  return atendimentoRepository.listarHistorico();
}

async function obterConversa(atendimentoId) {
  const atendimento = await atendimentoRepository.buscarPorId(atendimentoId);

  if (!atendimento) {
    throw new Error("Atendimento não encontrado.");
  }

  const mensagens = await mensagemRepository.listarPorAtendimento(
    atendimentoId
  );

  return { atendimento, mensagens };
}

async function atribuirParaAnalista({
  atendimentoId,
  analistaId,
  usuarioSistemaId
}) {

  const atendimento = await atendimentoRepository.buscarPorId(atendimentoId);

  if (!atendimento) {
    throw new Error("ATENDIMENTO_NAO_ENCONTRADO");
  }

  if (atendimento.arquivado) {
    throw new Error("ATENDIMENTO_ARQUIVADO");
  }

  if (atendimento.status === "realizado") {
    throw new Error("ATENDIMENTO_FINALIZADO");
  }

  const analista = await usuarioSistemaRepository.buscarPorId(analistaId);

  if (!analista) {
    throw new Error("ANALISTA_NAO_ENCONTRADO");
  }

  if (analista.perfil !== "analista") {
    throw new Error("USUARIO_NAO_E_ANALISTA");
  }

  if (!analista.ativo) {
    throw new Error("ANALISTA_INATIVO");
  }

  if (Number(analista.setor_id) !== Number(atendimento.setor_id)) {
    throw new Error("ANALISTA_OUTRO_SETOR");
  }

  const resultado = await atendimentoRepository.atribuirParaAnalista({
    atendimentoId,
    analistaId
  });

  if (!resultado) {
    throw new Error("ATENDIMENTO_NAO_DISPONIVEL");
  }

  await historicoAtendimentoRepository.registrar({
    atendimentoId,
    usuarioSistemaId,
    acao: "atribuicao",
    valorAnterior: {
      analista_id: atendimento.analista_id || null,
      analista_nome: atendimento.analista_nome || null
    },
    valorNovo: {
      analista_id: resultado.analista_id,
      analista_nome: analista.nome
    },
    observacao: "Chamado atribuído pelo supervisor."
  });

  return resultado;
}

async function alterarStatus({
  atendimentoId,
  analistaId,
  status,
  isSupervisor = false,
  usuarioSistemaId
}) {
  const atendimento = await atendimentoRepository.buscarPorId(atendimentoId);

  if (!atendimento) {
    throw new Error("ATENDIMENTO_NAO_ENCONTRADO");
  }

  if (atendimento.arquivado) {
    throw new Error("ATENDIMENTO_ARQUIVADO");
  }

  if (!isSupervisor && (!atendimento.analista_id || Number(atendimento.analista_id) !== Number(analistaId))) {
    throw new Error("SEM_PERMISSAO");
  }
  if (!isSupervisor && atendimento.status === "aguardando") {
    throw new Error("SEM_PERMISSAO");
  }

  const resultado = await atendimentoRepository.alterarStatus({
    atendimentoId,
    analistaId,
    status,
    isSupervisor
  });

  if (!resultado) {
    throw new Error("ATENDIMENTO_NAO_DISPONIVEL");
  }

  await historicoAtendimentoRepository.registrar({
    atendimentoId,
    usuarioSistemaId,
    acao: "alteracao_status",
    valorAnterior: {
      status: atendimento.status
    },
    valorNovo: {
      status: resultado.status
    },
    observacao: `Status alterado de "${atendimento.status}" para "${resultado.status}".`
  });

  return resultado;
}

async function editarAtendimento({ atendimentoId, nome, descricao, setorId, usuarioSistemaId, perfil, analistaId }) {
  const atendimento = await atendimentoRepository.buscarPorId(atendimentoId);
  if (!atendimento) throw new Error("ATENDIMENTO_NAO_ENCONTRADO");
  if (atendimento.arquivado || atendimento.status === "realizado") throw new Error("ATENDIMENTO_ARQUIVADO");
  if (perfil !== "supervisor" && (!atendimento.analista_id || Number(atendimento.analista_id) !== Number(analistaId))) {
    throw new Error("SEM_PERMISSAO");
  }
  const setor = await setorRepository.buscarPorId(setorId);
  if (!setor || setor.ativo === false) throw new Error("SETOR_NAO_ENCONTRADO");
  const nomeLimpo = String(nome || "").trim();
  const descricaoLimpa = String(descricao || "").trim();
  if (nomeLimpo.length < 2 || nomeLimpo.length > 150) throw new Error("NOME_INVALIDO");
  if (!descricaoLimpa || descricaoLimpa.length > 4000) throw new Error("DESCRICAO_INVALIDA");
  await usuarioRepository.atualizarNome({ usuarioId: atendimento.usuario_id, nome: nomeLimpo });
  const atualizado = await atendimentoRepository.editarDados({ atendimentoId, setorId, descricao: descricaoLimpa });
  if (!atualizado) throw new Error("ATENDIMENTO_NAO_ENCONTRADO");
  await historicoAtendimentoRepository.registrar({
    atendimentoId, usuarioSistemaId, acao: "edicao_atendimento",
    valorAnterior: { nome: atendimento.usuario_nome, descricao: atendimento.descricao, setor_id: atendimento.setor_id },
    valorNovo: { nome: nomeLimpo, descricao: descricaoLimpa, setor_id: setor.id, setor_nome: setor.nome },
    observacao: "Dados do atendimento editados. Se o setor mudou, o chamado voltou à fila do novo setor."
  });
  return atendimentoRepository.buscarPorId(atendimentoId);
}

async function assumirAtendimento({
  atendimentoId,
  analistaId,
  setorId,
  usuarioSistemaId
}) {
  const atendimento = await atendimentoRepository.buscarPorId(atendimentoId);

  if (!atendimento) {
    throw new Error("ATENDIMENTO_NAO_ENCONTRADO");
  }

  if (atendimento.arquivado) {
    throw new Error("ATENDIMENTO_ARQUIVADO");
  }

  const resultado = await atendimentoRepository.assumir({
    atendimentoId,
    analistaId,
    setorId
  });

  if (!resultado) {
    throw new Error("ATENDIMENTO_NAO_DISPONIVEL");
  }

  const analista = await usuarioSistemaRepository.buscarPorId(analistaId);

  await historicoAtendimentoRepository.registrar({
    atendimentoId,
    usuarioSistemaId,
    acao: "assumir",
    valorAnterior: {
      analista_id: atendimento.analista_id || null,
      status: atendimento.status
    },
    valorNovo: {
      analista_id: resultado.analista_id,
      status: resultado.status,
      analista_nome: analista?.nome || null
    },
    observacao: "Atendimento assumido pelo analista."
  });

  return resultado;
}

async function devolverParaFila({
  atendimentoId,
  usuarioSistemaId,
  perfil,
  setorId,
  analistaId
}) {
  const atendimento =
    await atendimentoRepository.buscarPorId(atendimentoId);

  if (!atendimento) {
    throw new Error("ATENDIMENTO_NAO_ENCONTRADO");
  }

  if (atendimento.arquivado) {
    throw new Error("ATENDIMENTO_ARQUIVADO");
  }

  if (atendimento.status === "realizado") {
    throw new Error("ATENDIMENTO_FINALIZADO");
  }

  if (perfil !== "supervisor" && (
    Number(atendimento.analista_id) !== Number(analistaId) ||
    Number(atendimento.setor_id) !== Number(setorId)
  )) {
    throw new Error("SEM_PERMISSAO");
  }

  if (!atendimento.analista_id) {
    throw new Error("ATENDIMENTO_SEM_ANALISTA");
  }

  const resultado =
    await atendimentoRepository.devolverParaFila(
      atendimentoId
    );

  if (!resultado) {
    throw new Error("ATENDIMENTO_NAO_DISPONIVEL");
  }

  await historicoAtendimentoRepository.registrar({
    atendimentoId,
    usuarioSistemaId,
    acao: "desatribuicao",

    valorAnterior: {
      analista_id: atendimento.analista_id,
      analista_nome: atendimento.analista_nome || null,
      status: atendimento.status
    },

    valorNovo: {
      analista_id: null,
      status: "aguardando"
    },

    observacao:
      `Chamado devolvido para a fila por ${perfil === "supervisor" ? "supervisor" : "analista"}.`
  });

  return resultado;
}


async function alterarSetorAtendimento({ atendimentoId, setorId, usuarioSistemaId }) {
  const atendimento = await atendimentoRepository.buscarPorId(atendimentoId);
  if (!atendimento) throw new Error("ATENDIMENTO_NAO_ENCONTRADO");
  if (atendimento.arquivado) throw new Error("ATENDIMENTO_ARQUIVADO");
  if (atendimento.status === "realizado") throw new Error("ATENDIMENTO_FINALIZADO");

  const setor = await setorRepository.buscarPorId(setorId);
  if (!setor || setor.ativo === false) throw new Error("SETOR_NAO_ENCONTRADO");
  if (Number(atendimento.setor_id) === Number(setorId)) throw new Error("SETOR_IGUAL");

  const resultado = await atendimentoRepository.alterarSetor({ atendimentoId, setorId });
  if (!resultado) throw new Error("ATENDIMENTO_NAO_DISPONIVEL");

  await historicoAtendimentoRepository.registrar({
    atendimentoId,
    usuarioSistemaId,
    acao: "alteracao_setor",
    valorAnterior: { setor_id: atendimento.setor_id, setor_nome: atendimento.setor_nome, analista_id: atendimento.analista_id || null, status: atendimento.status },
    valorNovo: { setor_id: resultado.setor_id, setor_nome: setor.nome, analista_id: null, status: "aguardando" },
    observacao: "Setor alterado pelo supervisor; atendimento devolvido à fila do novo setor."
  });

  return { atendimento: resultado, setorAnteriorId: Number(atendimento.setor_id) };
}

async function replicarAtendimento({ atendimentoId, setorId, descricao, analistaDestinoId = null, usuarioSistemaId, perfil, setorUsuarioId }) {
  const origem = await atendimentoRepository.buscarPorId(atendimentoId);
  if (!origem) throw new Error("ATENDIMENTO_NAO_ENCONTRADO");
  if (origem.arquivado) throw new Error("ATENDIMENTO_ARQUIVADO");
  if (perfil !== "supervisor" && (
    Number(origem.setor_id) !== Number(setorUsuarioId) ||
    Number(origem.analista_id) !== Number(usuarioSistemaId)
  )) throw new Error("SEM_PERMISSAO");

  const setor = await setorRepository.buscarPorId(Number(setorId));
  if (!setor || setor.ativo === false) throw new Error("SETOR_NAO_ENCONTRADO");
  if (perfil !== "supervisor" && Number(setor.id) !== Number(setorUsuarioId)) {
    // Analistas podem direcionar a réplica a outro setor, mas não atribuí-la a um analista.
    // A validação de setor do usuário é deliberadamente não aplicada aqui.
  }

  const novo = await abrirAtendimento({
    nome: origem.usuario_nome,
    telefone: origem.usuario_telefone,
    whatsappId: origem.usuario_telefone,
    setorId: Number(setorId),
    empresaId: Number(origem.empresa_id),
    descricao: String(descricao || "").trim() || origem.descricao,
    remetenteTipo: perfil,
    remetenteId: Number(usuarioSistemaId),
    direcao: "interna",
    atendimentoOrigemId: Number(origem.id)
  });

  let atendimento = await atendimentoRepository.buscarPorId(novo.atendimento.id);
  if (perfil === "supervisor" && analistaDestinoId) {
    atendimento = await atribuirParaAnalista({
      atendimentoId: Number(novo.atendimento.id),
      analistaId: Number(analistaDestinoId),
      usuarioSistemaId: Number(usuarioSistemaId)
    });
  }

  await historicoAtendimentoRepository.registrar({
    atendimentoId: Number(novo.atendimento.id),
    usuarioSistemaId: Number(usuarioSistemaId),
    acao: "replicar_atendimento",
    valorAnterior: { atendimento_origem_id: Number(origem.id) },
    valorNovo: { atendimento_id: Number(novo.atendimento.id), setor_id: Number(setorId), analista_id: atendimento?.analista_id || null },
    observacao: `Atendimento replicado a partir do chamado #${origem.id}.`
  });

  return { atendimento, atendimentoOrigemId: Number(origem.id) };
}

async function obterHistoricoCompleto() {
  return historicoAtendimentoRepository.listarTodos();
}

module.exports = {
  abrirAtendimento,
  obterFila,
  obterTodosParaSupervisor,
  obterAtendimentosHistorico,
  obterConversa,
  atribuirParaAnalista,
  alterarStatus,
  editarAtendimento,
  assumirAtendimento,
  devolverParaFila,
  alterarSetorAtendimento,
  replicarAtendimento,
  obterHistoricoCompleto
};