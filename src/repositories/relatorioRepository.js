const db = require("../config/database");

function adicionarLike(condicoes, parametros, expressao, valor) {
  const texto = String(valor || "").trim();
  if (!texto) return;
  parametros.push(`%${texto}%`);
  condicoes.push(`${expressao} ILIKE $${parametros.length}`);
}

async function listarLogs(filtros = {}) {
  const condicoes = [];
  const parametros = [];

  // Cada filtro é identificado pelo nome do campo da tela. Isso evita
  // divergências quando a ordem das colunas ou dos inputs for alterada.
  const filtrosTexto = {
    data: "to_char(h.criado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI:SS')",
    atendimento: "('#' || h.atendimento_id::text || ' ' || COALESCE(a.protocolo, 'Sem protocolo'))",
    cliente: "COALESCE(u.nome, 'Não informado')",
    usuario: "COALESCE(hs.nome, 'Sistema')",
    acao: "(CASE h.acao WHEN 'atribuicao' THEN 'Atribuição de atendimento' WHEN 'desatribuicao' THEN 'Devolução à fila' WHEN 'assumir' THEN 'Atendimento assumido' WHEN 'alteracao_status' THEN 'Alteração de status' ELSE COALESCE(h.acao, 'Ação não informada') END)",
    detalhes: "concat_ws(' · ', h.observacao, CASE WHEN h.valor_anterior IS NOT NULL THEN 'Antes: ' || replace(replace(h.valor_anterior::text, ': ', ':'), ', ', ',') END, CASE WHEN h.valor_novo IS NOT NULL THEN 'Depois: ' || replace(replace(h.valor_novo::text, ': ', ':'), ', ', ',') END)"
  };

  for (const [campo, expressao] of Object.entries(filtrosTexto)) {
    let valor = filtros[campo];

    // Compatibilidade com relatórios gerados por versões anteriores,
    // que enviavam os filtros de logs como uma lista posicional.
    if ((valor === undefined || valor === null || valor === "") && Array.isArray(filtros.colunas)) {
      const indiceLegado = Object.keys(filtrosTexto).indexOf(campo);
      valor = filtros.colunas[indiceLegado];
    }

    adicionarLike(condicoes, parametros, expressao, valor);
  }

  const where = condicoes.length ? `WHERE ${condicoes.join(" AND ")}` : "";
  const resultado = await db.query(
    `SELECT h.id, h.atendimento_id, a.protocolo,
            a.status AS atendimento_status, h.usuario_sistema_id,
            hs.nome AS usuario_sistema_nome, h.acao,
            h.valor_anterior, h.valor_novo, h.observacao, h.criado_em,
            u.nome AS cliente_nome
       FROM wb_historico_atendimentos h
       JOIN wb_atendimentos a ON a.id = h.atendimento_id
       LEFT JOIN wb_usuarios_sistema hs ON hs.id = h.usuario_sistema_id
       JOIN wb_usuarios u ON u.id = a.usuario_id
       ${where}
      ORDER BY h.criado_em DESC, h.id DESC`,
    parametros
  );
  return resultado.rows;
}

async function listarHistoricoAtendimentos(filtros = {}) {
  const condicoes = ["(a.status = 'realizado' OR a.arquivado = TRUE)"];
  const parametros = [];
  adicionarLike(condicoes, parametros, "a.id::text", filtros.id);
  adicionarLike(condicoes, parametros, "COALESCE(a.protocolo, '')", filtros.protocolo);
  adicionarLike(condicoes, parametros, "COALESCE(u.nome, '')", filtros.cliente);
  adicionarLike(condicoes, parametros, "COALESCE(an.nome, '')", filtros.analista);
  adicionarLike(condicoes, parametros, "COALESCE(s.nome, '')", filtros.setor);
  if (filtros.data) {
    parametros.push(String(filtros.data));
    condicoes.push(`to_char(a.finalizado_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') = $${parametros.length}`);
  }

  const resultado = await db.query(
    `SELECT a.id, a.protocolo, a.status, a.descricao,
            a.criado_em, a.iniciado_em, a.finalizado_em, a.arquivado,
            u.nome AS cliente_nome, u.telefone AS cliente_telefone,
            s.nome AS setor_nome, an.nome AS analista_nome, e.cnpj AS empresa_cnpj
       FROM wb_atendimentos a
       JOIN wb_usuarios u ON u.id = a.usuario_id
       JOIN wb_setores s ON s.id = a.setor_id
       LEFT JOIN wb_usuarios_sistema an ON an.id = a.analista_id
       LEFT JOIN wb_empresas e ON e.id = a.empresa_id
      WHERE ${condicoes.join(" AND ")}
      ORDER BY COALESCE(a.finalizado_em, a.atualizado_em, a.criado_em) DESC, a.id DESC`,
    parametros
  );
  return resultado.rows;
}

async function listarUsuarios(filtros = {}) {
  const condicoes = ["u.perfil = 'analista'"];
  const parametros = [];
  const termo = String(filtros.busca || "").trim();
  if (termo) {
    parametros.push(`%${termo}%`);
    condicoes.push(`(u.nome ILIKE $${parametros.length} OR u.username ILIKE $${parametros.length} OR u.email ILIKE $${parametros.length} OR COALESCE(s.nome, '') ILIKE $${parametros.length})`);
  }
  if (filtros.situacao === "ativo") condicoes.push("u.ativo = TRUE");
  if (filtros.situacao === "inativo") condicoes.push("u.ativo = FALSE");
  if (filtros.setor && filtros.setor !== "todos") {
    parametros.push(filtros.setor);
    condicoes.push(`u.setor_id::text = $${parametros.length}`);
  }

  const resultado = await db.query(
    `SELECT u.id, u.nome, u.email, u.username, u.perfil,
            s.nome AS setor_nome, u.ativo, u.criado_em, u.ultimo_acesso_em
       FROM wb_usuarios_sistema u
       LEFT JOIN wb_setores s ON s.id = u.setor_id
      WHERE ${condicoes.join(" AND ")}
      ORDER BY u.nome ASC`,
    parametros
  );
  return resultado.rows;
}

module.exports = { listarLogs, listarHistoricoAtendimentos, listarUsuarios };
