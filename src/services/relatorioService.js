const repository = require("../repositories/relatorioRepository");

const configuracoes = {
  logs: {
    titulo: "Tabela de Logs",
    colunas: [
      ["ID", "id"], ["Atendimento", "atendimento_id"], ["Protocolo", "protocolo"],
      ["Cliente", "cliente_nome"], ["Usuário responsável", "usuario_sistema_nome"],
      ["Ação", "acao"], ["Status do atendimento", "atendimento_status"],
      ["Valor anterior", "valor_anterior"], ["Valor novo", "valor_novo"],
      ["Observação", "observacao"], ["Data e hora", "criado_em"]
    ],
    buscar: repository.listarLogs
  },
  historico: {
    titulo: "Histórico de atendimentos",
    colunas: [
      ["ID", "id"], ["Protocolo", "protocolo"], ["Status", "status"],
      ["Cliente", "cliente_nome"], ["Telefone", "cliente_telefone"],
      ["Empresa (CNPJ)", "empresa_cnpj"], ["Setor", "setor_nome"],
      ["Analista", "analista_nome"], ["Descrição", "descricao"],
      ["Criado em", "criado_em"], ["Iniciado em", "iniciado_em"],
      ["Finalizado em", "finalizado_em"], ["Arquivado", "arquivado"]
    ],
    buscar: repository.listarHistoricoAtendimentos
  },
  usuarios: {
    titulo: "Gerenciar usuários",
    colunas: [
      ["ID", "id"], ["Nome", "nome"], ["E-mail", "email"],
      ["Login", "username"], ["Perfil", "perfil"], ["Setor", "setor_nome"],
      ["Ativo", "ativo"], ["Criado em", "criado_em"], ["Último acesso", "ultimo_acesso_em"]
    ],
    buscar: repository.listarUsuarios
  }
};

async function obterDados(tipo, filtros = {}) {
  const configuracao = configuracoes[tipo];
  if (!configuracao) {
    const erro = new Error("Tipo de relatório inválido.");
    erro.status = 400;
    throw erro;
  }
  const linhas = await configuracao.buscar(filtros);
  return { titulo: configuracao.titulo, colunas: configuracao.colunas, linhas };
}

module.exports = { obterDados };
