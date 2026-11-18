const db = require("../config/database");

async function criar({
  atendimentoId,
  remetenteTipo,
  remetenteId = null,
  direcao,
  tipo = "texto",
  conteudo = null,
  midiaUrl = null,
  identificadorExterno = null,
  dadosExtras = {}
}) {
  const resultado = await db.query(
    `INSERT INTO wb_mensagens (
       atendimento_id,
       remetente_tipo,
       remetente_id,
       direcao,
       tipo,
       conteudo,
       midia_url,
       identificador_externo,
       dados_extras
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (identificador_externo)
       DO NOTHING
     RETURNING *`,
    [
      atendimentoId,
      remetenteTipo,
      remetenteId,
      direcao,
      tipo,
      conteudo,
      midiaUrl,
      identificadorExterno,
      JSON.stringify(dadosExtras)
    ]
  );

  return resultado.rows[0] || null;
}

async function listarPorAtendimento(atendimentoId) {
  const resultado = await db.query(
    `SELECT *
     FROM wb_mensagens
     WHERE atendimento_id = $1
     ORDER BY criado_em ASC, id ASC`,
    [atendimentoId]
  );

  return resultado.rows;
}

module.exports = {
  criar,
  listarPorAtendimento
};