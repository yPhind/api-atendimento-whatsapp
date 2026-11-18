const atendimentoService = require("../services/atendimentoService");
const atendimentoRepository = require("../repositories/atendimentoRepository");
const empresaService = require("../services/empresaService");
const mensagemRepository = require("../repositories/mensagemRepository");
const whatsappCloudService = require("../services/whatsappCloudService");
const notificarAtendimento = require("../realtime/notificarAtendimento");



async function consultarEmpresaCnpj(req, res, next) {
  try {
    const cnpj = String(req.params.cnpj || "").replace(/\D/g, "");
    if (cnpj.length !== 14) return res.status(400).json({ mensagem: "Informe um CNPJ com 14 dígitos." });
    const empresa = await require("../repositories/empresaRepository").buscarPorCnpj(cnpj);
    return res.json({ encontrada: Boolean(empresa), empresa });
  } catch (e) { next(e); }
}


async function abrirManual(req, res, next) {
  try {
    const usuario = req.usuarioSistema;
    const nome = String(req.body.nome || "").trim();
    const telefone = String(req.body.telefone || "").replace(/\D/g, "");
    const cnpj = String(req.body.cnpj || "").replace(/\D/g, "");
    const descricao = String(req.body.descricao || "").trim();

    const setorId = usuario.perfil === "supervisor"
      ? Number(req.body.setorId)
      : Number(usuario.setor_id ?? usuario.setorId);

    if (nome.length < 2 || nome.length > 150) {
      return res.status(400).json({
        mensagem: "Informe o nome do cliente."
      });
    }

    if (telefone.length < 10 || telefone.length > 15) {
      return res.status(400).json({
        mensagem: "Informe um telefone válido."
      });
    }

    if (cnpj.length !== 14 || !descricao || descricao.length > 4000) {
      return res.status(400).json({
        mensagem: "CNPJ e descrição do atendimento são obrigatórios."
      });
    }

    if (!Number.isInteger(setorId) || setorId <= 0) {
      return res.status(400).json({
        mensagem: "Selecione um setor válido."
      });
    }

    const { empresa } = await empresaService.localizarOuCadastrar({
      cnpj,
      razaoSocial: req.body.razaoSocial,
      nomeFantasia: req.body.nomeFantasia
    });

    const criado = await atendimentoService.abrirAtendimento({
      nome,
      telefone,
      whatsappId: telefone,
      setorId,
      empresaId: Number(empresa.id),
      descricao,
      remetenteTipo: usuario.perfil,
      remetenteId: Number(usuario.id),
      direcao: "interna"
    });

    const atendimento = await atendimentoService.assumirAtendimento({
      atendimentoId: Number(criado.atendimento.id),
      analistaId: Number(usuario.id),
      setorId: usuario.perfil === "supervisor" ? null : setorId,
      usuarioSistemaId: Number(usuario.id)
    });

    notificarAtendimento(req, atendimento, "atendimento_aberto_manual");

    const conversa = await atendimentoService.obterConversa(
      Number(atendimento.id)
    );

    return res.status(201).json({
      mensagem: "Atendimento aberto e atribuído a você.",
      atendimento: conversa.atendimento
    });

  } catch (erro) {
    if (erro.message === "CNPJ_INVALIDO") {
      return res.status(400).json({
        mensagem: "CNPJ inválido. Confira os 14 dígitos."
      });
    }

    if (erro.message === "DADOS_EMPRESA_OBRIGATORIOS") {
      return res.status(400).json({
        mensagem: "Informe a razão social para cadastrar a empresa."
      });
    }

    if (erro.message === "Empresa inativa.") {
      return res.status(409).json({
        mensagem: "A empresa está inativa e não pode receber novos atendimentos."
      });
    }

    if (erro.message === "Setor não encontrado ou inativo.") {
      return res.status(400).json({
        mensagem: "O setor selecionado não existe ou está inativo."
      });
    }

    return next(erro);
  }
}


async function listarFila(req, res, next) {
  try {
    const usuario = req.usuarioSistema;
    let setorId;

    if (usuario.perfil === "supervisor") {
      const setorInformado = req.query.setorId;

      // Sem setor informado, o supervisor visualiza todos.
      if (setorInformado === undefined || setorInformado === "") {
        setorId = null;
      } else {
        setorId = Number(setorInformado);

        if (!Number.isInteger(setorId) || setorId <= 0) {
          return res.status(400).json({
            mensagem: "Informe um setor válido."
          });
        }
      }
    } else {
      setorId = Number(usuario.setorId);

      if (!Number.isInteger(setorId) || setorId <= 0) {
        return res.status(400).json({
          mensagem: "Seu usuário não possui um setor válido."
        });
      }
    }

    const fila = await atendimentoService.obterFila(setorId);
    res.json(fila);
  } catch (erro) {
    next(erro);
  }
}


async function listarMeusAtendimentos(req, res, next) {
  try {
    const usuario = req.usuarioSistema;

    const atendimentos = await atendimentoRepository.listarDoAnalista(
      Number(usuario.id)
    );

    res.json(atendimentos);
  } catch (erro) {
    next(erro);
  }
}

async function listarAtendimentosSupervisor(req, res, next) {
  try {
    const atendimentos =
      await atendimentoService.obterTodosParaSupervisor();

    res.json(atendimentos);
  } catch (erro) {
    next(erro);
  }
}

async function replicarAtendimento(req, res, next) {
  try {
    const usuario = req.usuarioSistema;
    const atendimentoId = Number(req.params.id);
    const setorId = Number(req.body.setorId);
    const analistaDestinoId = req.body.analistaId ? Number(req.body.analistaId) : null;
    const descricao = String(req.body.descricao || "").trim();
    if (descricao.length > 4000) return res.status(400).json({ mensagem: "A observação deve ter no máximo 4.000 caracteres." });
    if (!Number.isInteger(atendimentoId) || atendimentoId <= 0 || !Number.isInteger(setorId) || setorId <= 0) {
      return res.status(400).json({ mensagem: "Atendimento ou setor inválido." });
    }
    if (usuario.perfil !== "supervisor" && req.body.analistaId) {
      return res.status(403).json({ mensagem: "Somente o supervisor pode escolher o analista responsável." });
    }
    const resultado = await atendimentoService.replicarAtendimento({
      atendimentoId, setorId, descricao, analistaDestinoId,
      usuarioSistemaId: Number(usuario.id), perfil: usuario.perfil,
      setorUsuarioId: Number(usuario.setorId ?? usuario.setor_id)
    });
    notificarAtendimento(req, resultado.atendimento, "atendimento_replicado");
    return res.status(201).json({ mensagem: "Atendimento replicado com sucesso.", atendimento: resultado.atendimento, atendimentoOrigemId: resultado.atendimentoOrigemId });
  } catch (erro) {
    const respostas = {
      ATENDIMENTO_NAO_ENCONTRADO: [404, "Atendimento não encontrado."],
      ATENDIMENTO_ARQUIVADO: [409, "Não é possível replicar um atendimento arquivado."],
      SETOR_NAO_ENCONTRADO: [404, "Setor não encontrado ou inativo."],
      SEM_PERMISSAO: [403, "Você não tem permissão para replicar este atendimento."],
      ANALISTA_NAO_ENCONTRADO: [404, "Analista não encontrado."],
      USUARIO_NAO_E_ANALISTA: [400, "O usuário selecionado não é um analista."],
      ANALISTA_INATIVO: [409, "O analista selecionado está inativo."],
      ANALISTA_OUTRO_SETOR: [400, "O analista selecionado não pertence ao setor escolhido."],
      ATENDIMENTO_NAO_DISPONIVEL: [409, "Não foi possível atribuir o atendimento replicado."]
    };
    if (respostas[erro.message]) {
      const [status, mensagem] = respostas[erro.message];
      return res.status(status).json({ mensagem });
    }
    return next(erro);
  }
}

async function assumir(req, res, next) {
  try {
    const usuario = req.usuarioSistema;
    const atendimentoId = Number(req.params.id);
    const isSupervisor = usuario.perfil === "supervisor";

    if (!Number.isInteger(atendimentoId) || atendimentoId <= 0) {
      return res.status(400).json({
        mensagem: "Identificador de atendimento inválido."
      });
    }

    const setorId = isSupervisor ? null : Number(usuario.setorId);

    if (!isSupervisor && (!Number.isInteger(setorId) || setorId <= 0)) {
      return res.status(400).json({
        mensagem: "Seu usuário não possui um setor válido."
      });
    }

    const atendimento = await atendimentoService.assumirAtendimento({
      atendimentoId,
      analistaId: Number(usuario.id),
      setorId,
      usuarioSistemaId: Number(usuario.id)
    });

    if (!atendimento) {
      return res.status(409).json({
        mensagem: "Atendimento indisponível ou fora do seu setor."
      });
    }

    notificarAtendimento(req, atendimento, "atendimento_assumido");
    res.json({
      mensagem: "Atendimento assumido.",
      atendimento
    });
  } catch (erro) {
    next(erro);
  }
}

async function atribuirParaAnalista(req, res, next) {
  try {
    const atendimentoId = Number(req.params.id);
    const analistaId = Number(req.body.analistaId);

    if (
      !Number.isInteger(atendimentoId) ||
      atendimentoId <= 0 ||
      !Number.isInteger(analistaId) ||
      analistaId <= 0
    ) {
      return res.status(400).json({
        mensagem: "Atendimento ou analista inválido."
      });
    }

    const usuario = req.usuarioSistema;

    const atendimento = await atendimentoService.atribuirParaAnalista({
      atendimentoId,
      analistaId,
      usuarioSistemaId: Number(usuario.id)
    });

    notificarAtendimento(req, atendimento, "atendimento_atribuido");
    res.json({
      mensagem: "Atendimento atribuído com sucesso.",
      atendimento
    });
  } catch (erro) {
    switch (erro.message) {
      case "ATENDIMENTO_NAO_ENCONTRADO":
        return res.status(404).json({
          mensagem: "Atendimento não encontrado."
        });

      case "ATENDIMENTO_ARQUIVADO":
        return res.status(409).json({
          mensagem: "Não é possível atribuir um atendimento arquivado."
        });

      case "ATENDIMENTO_FINALIZADO":
        return res.status(409).json({
          mensagem: "Não é possível atribuir um atendimento finalizado."
        });

      case "ANALISTA_NAO_ENCONTRADO":
        return res.status(404).json({
          mensagem: "Analista não encontrado."
        });

      case "USUARIO_NAO_E_ANALISTA":
        return res.status(400).json({
          mensagem: "O usuário selecionado não é um analista."
        });

      case "ANALISTA_INATIVO":
        return res.status(409).json({
          mensagem: "O analista selecionado está inativo."
        });

      case "ANALISTA_OUTRO_SETOR":
        return res.status(403).json({
          mensagem: "O analista pertence a outro setor."
        });

      case "ATENDIMENTO_NAO_DISPONIVEL":
        return res.status(409).json({
          mensagem: "O atendimento não está mais disponível para atribuição."
        });

      case "ATENDIMENTO_NAO_ENCONTRADO":
        return res.status(404).json({
          mensagem: "Atendimento não encontrado."
        });

      case "ATENDIMENTO_ARQUIVADO":
        return res.status(409).json({
          mensagem: "Não é possível alterar o status de um atendimento arquivado."
        });

      case "SEM_PERMISSAO":
        return res.status(403).json({
          mensagem: "Você não tem permissão para alterar este atendimento."
        });

      case "ATENDIMENTO_NAO_DISPONIVEL":
        return res.status(409).json({
          mensagem: "O atendimento não está mais disponível."
        });

      case "ATENDIMENTO_NAO_ENCONTRADO":
        return res.status(404).json({
          mensagem: "Atendimento não encontrado."
        });

      case "ATENDIMENTO_ARQUIVADO":
        return res.status(409).json({
          mensagem: "Não é possível assumir um atendimento arquivado."
        });

      case "ATENDIMENTO_NAO_DISPONIVEL":
        return res.status(409).json({
          mensagem: "Atendimento indisponível. Ele pode já ter sido assumido por outro analista."
        });

      default:
        next(erro);
    }
  }
}


async function alterarSetorAtendimento(req, res, next) {
  try {
    const atendimentoId = Number(req.params.id);
    const setorId = Number(req.body.setorId);
    const usuario = req.usuarioSistema;

    if (!Number.isInteger(atendimentoId) || atendimentoId <= 0 || !Number.isInteger(setorId) || setorId <= 0) {
      return res.status(400).json({ mensagem: "Atendimento ou setor inválido." });
    }

    const resultado = await atendimentoService.alterarSetorAtendimento({
      atendimentoId, setorId, usuarioSistemaId: Number(usuario.id)
    });

    notificarAtendimento(req, resultado.atendimento, "atendimento_setor_alterado", resultado.setorAnteriorId);
    return res.json({ mensagem: "Setor alterado. O atendimento voltou à fila do novo setor.", atendimento: resultado.atendimento });
  } catch (erro) {
    const respostas = {
      ATENDIMENTO_NAO_ENCONTRADO: [404, "Atendimento não encontrado."],
      ATENDIMENTO_ARQUIVADO: [409, "Não é possível alterar o setor de um atendimento arquivado."],
      ATENDIMENTO_FINALIZADO: [409, "Não é possível alterar o setor de um atendimento realizado."],
      SETOR_NAO_ENCONTRADO: [404, "Setor não encontrado ou inativo."],
      SETOR_IGUAL: [400, "Selecione um setor diferente do atual."],
      ATENDIMENTO_NAO_DISPONIVEL: [409, "O atendimento não está mais disponível para alteração."]
    };
    if (respostas[erro.message]) {
      const [status, mensagem] = respostas[erro.message];
      return res.status(status).json({ mensagem });
    }
    return next(erro);
  }
}

async function alterarStatus(req, res, next) {
  try {
    const usuario = req.usuarioSistema;
    const atendimentoId = Number(req.params.id);
    const { status } = req.body;
    const isSupervisor = usuario.perfil === "supervisor";

    const statusPermitidos = ["aguardando", "em_atendimento", "pendente", "realizado"];

    if (
      !Number.isInteger(atendimentoId) ||
      atendimentoId <= 0 ||
      !statusPermitidos.includes(status)
    ) {
      return res.status(400).json({
        mensagem: "Atendimento ou status inválido."
      });
    }

    const atendimento = await atendimentoService.alterarStatus({
      atendimentoId,
      analistaId: Number(usuario.id),
      status,
      isSupervisor,
      usuarioSistemaId: Number(usuario.id)
    });

    if (!atendimento) {
      return res.status(404).json({
        mensagem: "Atendimento não encontrado ou sem permissão."
      });
    }

    notificarAtendimento(req, atendimento, "status_alterado");
    res.json({
      mensagem: "Status atualizado.",
      atendimento
    });
  } catch (erro) {
    if (erro.message === "SEM_PERMISSAO") return res.status(403).json({ mensagem: "Você não tem permissão para alterar este atendimento." });
    if (erro.message === "ATENDIMENTO_NAO_ENCONTRADO") return res.status(404).json({ mensagem: "Atendimento não encontrado." });
    if (erro.message === "ATENDIMENTO_ARQUIVADO") return res.status(409).json({ mensagem: "Não é possível alterar um atendimento arquivado." });
    if (erro.message === "ATENDIMENTO_NAO_DISPONIVEL") return res.status(409).json({ mensagem: "O atendimento não está mais disponível." });
    return next(erro);
  }
}

async function editarAtendimento(req, res, next) {
  try {
    const usuario = req.usuarioSistema;
    const atendimentoId = Number(req.params.id);
    const setorId = Number(req.body.setorId);
    if (!Number.isInteger(atendimentoId) || atendimentoId <= 0 || !Number.isInteger(setorId) || setorId <= 0) {
      return res.status(400).json({ mensagem: "Atendimento ou setor inválido." });
    }
    const atendimento = await atendimentoService.editarAtendimento({
      atendimentoId,
      nome: req.body.nome,
      descricao: req.body.descricao,
      setorId,
      usuarioSistemaId: Number(usuario.id),
      perfil: usuario.perfil,
      analistaId: Number(usuario.id)
    });
    notificarAtendimento(req, atendimento, "atendimento_editado");
    return res.json({ mensagem: "Atendimento atualizado com sucesso.", atendimento });
  } catch (erro) {
    const respostas = {
      ATENDIMENTO_NAO_ENCONTRADO: [404, "Atendimento não encontrado."],
      ATENDIMENTO_ARQUIVADO: [409, "Atendimentos realizados ou arquivados não podem ser editados."],
      SEM_PERMISSAO: [403, "Você só pode editar atendimentos sob sua responsabilidade."],
      SETOR_NAO_ENCONTRADO: [400, "O setor selecionado não existe ou está inativo."],
      NOME_INVALIDO: [400, "Informe um nome de cliente entre 2 e 150 caracteres."],
      DESCRICAO_INVALIDA: [400, "Informe o motivo do atendimento (máximo de 4.000 caracteres)."]
    };
    if (respostas[erro.message]) {
      const [status, mensagem] = respostas[erro.message];
      return res.status(status).json({ mensagem });
    }
    return next(erro);
  }
}

async function obterConversa(req, res, next) {
  try {
    const usuario = req.usuarioSistema;
    const atendimentoId = Number(req.params.id);

    if (!Number.isInteger(atendimentoId) || atendimentoId <= 0) {
      return res.status(400).json({
        mensagem: "Identificador inválido."
      });
    }

    const resultado = await atendimentoService.obterConversa(atendimentoId);
    const atendimento = resultado.atendimento;

    if (
      usuario.perfil !== "supervisor" &&
      (
        Number(atendimento.setor_id) !== Number(usuario.setorId) ||
        Number(atendimento.analista_id) !== Number(usuario.id)
      )
    ) {
      return res.status(403).json({
        mensagem: "Você não tem acesso a este atendimento."
      });
    }

    res.json(resultado);
  } catch (erro) {
    next(erro);
  }
}


async function enviarMensagemInterna(req, res, next) {
  try {
    const usuario = req.usuarioSistema;
    const atendimentoId = Number(req.params.id);
    const conteudo = req.body.conteudo?.trim();
    const isSupervisor = usuario.perfil === "supervisor";

    if (
      !Number.isInteger(atendimentoId) ||
      atendimentoId <= 0 ||
      !conteudo
    ) {
      return res.status(400).json({
        mensagem: "Atendimento e conteúdo são obrigatórios."
      });
    }

    const atendimento = await atendimentoRepository.buscarPorId(
      atendimentoId
    );

    if (!atendimento) {
      return res.status(404).json({
        mensagem: "Atendimento não encontrado."
      });
    }

    const semPermissaoAnalista =
      !isSupervisor &&
      (
        Number(atendimento.setor_id) !== Number(usuario.setorId) ||
        Number(atendimento.analista_id) !== Number(usuario.id)
      );

    if (
      atendimento.arquivado ||
      atendimento.status === "realizado" ||
      semPermissaoAnalista
    ) {
      return res.status(403).json({
        mensagem: "Não é permitido enviar mensagem neste atendimento."
      });
    }

    // Enviar pela Cloud API primeiro. Só registramos como enviada depois que
    // a Meta aceitar a solicitação, evitando mostrar mensagens não enviadas.
    let respostaMeta;
    try {
      respostaMeta = await whatsappCloudService.enviarTexto(
        String(atendimento.usuario_telefone || "").replace(/\D/g, ""),
        conteudo
      );
    } catch (erroMeta) {
      const detalhe = erroMeta.response?.data?.error?.message || erroMeta.message;
      console.error("Falha ao enviar mensagem pela WhatsApp Cloud API:", detalhe);
      return res.status(502).json({
        mensagem: `A Meta não aceitou o envio. Confira a configuração da API, o telefone e a janela de atendimento. Detalhe: ${detalhe}`
      });
    }

    const mensagem = await mensagemRepository.criar({
      atendimentoId,
      remetenteTipo: usuario.perfil,
      remetenteId: Number(usuario.id),
      direcao: "saida",
      conteudo,
      identificadorExterno: respostaMeta.messages?.[0]?.id || null,
      dadosExtras: { origem: "painel", meta: respostaMeta }
    });

    notificarAtendimento(req, atendimento, "nova_mensagem");
    res.status(201).json(mensagem);
  } catch (erro) {
    next(erro);
  }
}

async function devolverParaFila(req, res, next) {
  try {
    const usuario = req.usuarioSistema;
    const atendimentoId = Number(req.params.id);

    if (!Number.isInteger(atendimentoId) || atendimentoId <= 0) {
      return res.status(400).json({
        mensagem: "Identificador de atendimento inválido."
      });
    }

    const atendimento =
      await atendimentoService.devolverParaFila({
        atendimentoId,
        usuarioSistemaId: Number(usuario.id),
        perfil: usuario.perfil,
        setorId: Number(usuario.setorId ?? usuario.setor_id),
        analistaId: Number(usuario.id)
      });

    notificarAtendimento(req, atendimento, "atendimento_devolvido_fila");
    res.json({
      mensagem: "Atendimento devolvido para a fila.",
      atendimento
    });
  } catch (erro) {
    switch (erro.message) {
      case "ATENDIMENTO_NAO_ENCONTRADO":
        return res.status(404).json({
          mensagem: "Atendimento não encontrado."
        });

      case "ATENDIMENTO_ARQUIVADO":
        return res.status(409).json({
          mensagem:
            "Não é possível alterar um atendimento arquivado."
        });

      case "ATENDIMENTO_FINALIZADO":
        return res.status(409).json({
          mensagem:
            "Não é possível devolver um atendimento finalizado."
        });

      case "SEM_PERMISSAO":
        return res.status(403).json({ mensagem: "Você só pode devolver à fila atendimentos sob sua responsabilidade e do seu setor." });

      case "ATENDIMENTO_SEM_ANALISTA":
        return res.status(409).json({
          mensagem:
            "O atendimento já está sem analista."
        });

      case "ATENDIMENTO_NAO_DISPONIVEL":
        return res.status(409).json({
          mensagem:
            "O atendimento não está mais disponível."
        });

      default:
        next(erro);
    }
  }
}

async function listarHistorico(req, res, next) {
  try {
    const atendimentos = await atendimentoService.obterAtendimentosHistorico();
    res.json({ atendimentos });
  } catch (erro) {
    next(erro);
  }
}

async function obterConversaHistorica(req, res, next) {
  const atendimentoId = Number(req.params.id);

  if (!Number.isInteger(atendimentoId) || atendimentoId <= 0) {
    return res.status(400).json({
      mensagem: "Identificador de atendimento inválido."
    });
  }

  try {
    const resultado = await atendimentoService.obterConversa(atendimentoId);
    const atendimento = resultado.atendimento;

    if (
      atendimento.status !== "realizado" &&
      atendimento.arquivado !== true
    ) {
      return res.status(404).json({
        mensagem: "Atendimento não encontrado no histórico."
      });
    }

    return res.json(resultado);
  } catch (erro) {
    if (erro.message === "Atendimento não encontrado.") {
      return res.status(404).json({ mensagem: erro.message });
    }
    return next(erro);
  }
}

async function listarLogs(req, res, next) {
  try {
    const historico = await atendimentoService.obterHistoricoCompleto();
    res.json({ logs: historico });
  } catch (erro) {
    next(erro);
  }
}

module.exports = {
  consultarEmpresaCnpj,
  abrirManual,
  replicarAtendimento,
  listarFila,
  listarMeusAtendimentos,
  listarAtendimentosSupervisor,
  assumir,
  atribuirParaAnalista,
  alterarSetorAtendimento,
  alterarStatus,
  editarAtendimento,
  obterConversa,
  enviarMensagemInterna,
  devolverParaFila,
  listarHistorico,
  obterConversaHistorica,
  listarLogs
};