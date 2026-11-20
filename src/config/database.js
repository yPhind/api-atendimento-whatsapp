// Compatibilidade temporária para módulos antigos.
// O pool principal agora é sempre o banco wbatendimento.
const { atendimento } = require("./databases");
module.exports = atendimento;
