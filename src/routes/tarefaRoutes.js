
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const router = express.Router();

const auth = require("../middlewares/authMiddleware");
const perfis = require("../middlewares/permissionMiddleware");
const c = require("../controllers/tarefaController");

const dir = path.join(process.cwd(), "storage", "tarefas");

fs.mkdirSync(dir, { recursive: true });

const upload = multer({
    storage: multer.diskStorage({
        destination: dir,
        filename: (req, file, cb) => {
            cb(
                null,
                `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`
            );
        }
    }),

    limits: {
        fileSize: 50 * 1024 * 1024
    },

    fileFilter: (req, file, cb) => {
        const permitidos = [
            "application/pdf",
            "image/jpeg",
            "image/png"
        ];

        if (!permitidos.includes(file.mimetype)) {
            return cb(null, false);
        }

        cb(null, true);
    }
});

// Tratamento dos erros de upload
function uploadTarefa(req, res, next) {
    upload.single("arquivo")(req, res, (erro) => {
        if (erro instanceof multer.MulterError) {
            if (erro.code === "LIMIT_FILE_SIZE") {
                return res.status(413).json({
                    mensagem: "O arquivo ultrapassa o limite de 50 MB."
                });
            }

            return res.status(400).json({
                mensagem: "Erro ao enviar o arquivo."
            });
        }

        if (erro) return next(erro);

        next();
    });
}

// Autenticação e permissões
router.use(auth, perfis("analista", "supervisor"));

// Tarefas
router.get("/", c.listar);
router.get("/realizadas", c.realizadas);

router.post("/", c.criar);
router.patch("/:id", c.atualizar);
router.patch("/:id/finalizar", c.finalizar);
router.patch("/:id/reabrir", c.reabrir);

// Anexar arquivo
router.post("/:id/anexos", uploadTarefa, (req, res, next) => {
    if (!req.file) {
        return res.status(400).json({
            mensagem: "Arquivo inválido. Envie PDF, JPG, JPEG ou PNG de até 50 MB."
        });
    }

    c.anexar(req, res, next);
});

// Visualizar anexo
router.get(
    "/anexos/:anexoId/visualizar",
    c.visualizarAnexo
);

// Baixar anexo
router.get(
    "/anexos/:anexoId",
    c.baixarAnexo
);

// Remover anexo
router.delete(
    "/anexos/:anexoId",
    c.removerAnexo
);

module.exports = router;
