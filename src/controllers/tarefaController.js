const fs = require("fs"); const path = require("path"); const repo = require("../repositories/tarefaRepository");
function dataValida(d) { if (!d) return true; if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false; const x = new Date(`${d}T00:00:00Z`); return !Number.isNaN(x.getTime()) && x.toISOString().slice(0, 10) === d; }
function validar(body) { const titulo = String(body.titulo || "").trim(), observacao = String(body.observacao || "").trim(), dataPrevista = body.dataPrevista || null; if (!titulo || titulo.length > 64 || !observacao || !dataValida(dataPrevista)) throw Object.assign(new Error("Confira título, observação e data prevista."), { status: 400 }); return { titulo, observacao, dataPrevista }; }
async function listar(req, res, next) { try { res.json({ tarefas: await repo.listarPorUsuario(req.usuarioSistema.id, false) }); } catch (e) { next(e) } }
async function realizadas(req, res, next) { try { res.json({ tarefas: await repo.listarPorUsuario(req.usuarioSistema.id, true) }); } catch (e) { next(e) } }
async function criar(req, res, next) { try { const dados = validar(req.body); const tarefa = await repo.criar({ usuarioId: req.usuarioSistema.id, ...dados }); res.status(201).json({ tarefa }); } catch (e) { next(e) } }
async function atualizar(req, res, next) { try { const dados = validar(req.body); const tarefa = await repo.atualizar({ id: Number(req.params.id), usuarioId: req.usuarioSistema.id, ...dados }); if (!tarefa) return res.status(404).json({ mensagem: "Tarefa não encontrada ou não está em digitação." }); res.json({ tarefa }); } catch (e) { next(e) } }
async function finalizar(req, res, next) { try { const t = await repo.alterarStatus(Number(req.params.id), req.usuarioSistema.id, "realizada"); if (!t) return res.status(404).json({ mensagem: "Tarefa não encontrada." }); res.json({ tarefa: t }); } catch (e) { next(e) } }
async function reabrir(req, res, next) { try { const t = await repo.alterarStatus(Number(req.params.id), req.usuarioSistema.id, "em_digitacao"); if (!t) return res.status(404).json({ mensagem: "Tarefa não encontrada." }); res.json({ tarefa: t }); } catch (e) { next(e) } }
async function anexar(req, res, next) { try { const tarefa = await repo.buscar(Number(req.params.id), req.usuarioSistema.id); if (!tarefa || tarefa.status !== "em_digitacao") { if (req.file) fs.unlinkSync(req.file.path); return res.status(404).json({ mensagem: "Tarefa não encontrada ou não está em digitação." }); } const anexo = await repo.adicionarAnexo({ tarefaId: tarefa.id, nomeOriginal: req.file.originalname, nomeArquivo: req.file.filename, mimeType: req.file.mimetype, tamanho: req.file.size }); res.status(201).json({ anexo }); } catch (e) { next(e) } }
async function baixarAnexo(req, res, next) { try { const a = await repo.buscarAnexo(Number(req.params.anexoId), req.usuarioSistema.id); if (!a) return res.status(404).json({ mensagem: "Anexo não encontrado." }); res.download(path.join(process.cwd(), "storage", "tarefas", a.nome_arquivo), a.nome_original); } catch (e) { next(e) } }

async function visualizarAnexo(req, res, next) {
    try {
        const a = await repo.buscarAnexo(
            Number(req.params.anexoId),
            req.usuarioSistema.id
        );

        if (!a) {
            return res.status(404).json({
                mensagem: "Anexo não encontrado."
            });
        }

        const arquivo = path.join(
            process.cwd(),
            "storage",
            "tarefas",
            path.basename(a.nome_arquivo)
        );

        if (!fs.existsSync(arquivo)) {
            return res.status(404).json({
                mensagem: "Arquivo não encontrado no armazenamento."
            });
        }

        if (!["application/pdf", "image/jpeg", "image/png"].includes(a.mime_type)) {
            return res.status(415).json({
                mensagem: "Tipo de arquivo não permitido para visualização."
            });
        }

        res.setHeader("Content-Type", a.mime_type);
        res.setHeader(
            "Content-Disposition",
            `inline; filename*=UTF-8''${encodeURIComponent(a.nome_original)}`
        );
        res.setHeader("X-Content-Type-Options", "nosniff");

        res.sendFile(arquivo);
    } catch (e) {
        next(e);
    }
}

async function removerAnexo(req, res, next) {
    try {
        const id = Number(req.params.anexoId);
        const usuarioId = req.usuarioSistema.id;

        const anexo = await repo.buscarAnexo(id, usuarioId);

        if (!anexo) {
            return res.status(404).json({
                mensagem: "Anexo não encontrado."
            });
        }

        const removido = await repo.removerAnexo(id, usuarioId);

        if (!removido) {
            return res.status(404).json({
                mensagem: "Anexo não encontrado."
            });
        }

        const arquivo = path.join(
            process.cwd(),
            "storage",
            "tarefas",
            path.basename(removido.nome_arquivo)
        );

        try {
            await fs.promises.unlink(arquivo);
        } catch (erroArquivo) {
            if (erroArquivo.code !== "ENOENT") {
                console.error("Erro ao remover arquivo:", erroArquivo);
            }
        }

        res.json({
            mensagem: "Anexo removido com sucesso."
        });
    } catch (e) {
        next(e);
    }
}

module.exports = {
    listar,
    realizadas,
    criar,
    atualizar,
    finalizar,
    reabrir,
    anexar,
    baixarAnexo,
    visualizarAnexo,
    removerAnexo
};