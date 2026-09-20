import { Router } from "express";
import multer from "multer";
import { prisma } from "../db/prisma.js";
import { ensureAuthenticated } from "../middleware/auth.js";
import { uploadAttachment, deleteAttachment } from "../services/cloudinary.js";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE }
});

export const attachmentsRouter = Router();
attachmentsRouter.use(ensureAuthenticated);

attachmentsRouter.post("/upload", upload.single("file"), async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file provided" });

    const result = await uploadAttachment(file.buffer, file.originalname);

    const attachment = await prisma.attachment.create({
      data: {
        fileName: file.originalname,
        fileType: file.mimetype,
        fileSize: result.bytes,
        cloudinaryUrl: result.url,
        cloudinaryId: result.publicId
      }
    });

    res.status(201).json({
      id: attachment.id,
      fileName: attachment.fileName,
      fileType: attachment.fileType,
      fileSize: attachment.fileSize,
      cloudinaryUrl: attachment.cloudinaryUrl
    });
  } catch (error) {
    next(error);
  }
});

attachmentsRouter.delete("/:id", async (req, res, next) => {
  try {
    const attachment = await prisma.attachment.findUnique({
      where: { id: req.params.id }
    });

    if (!attachment) return res.status(404).json({ error: "Attachment not found" });

    await deleteAttachment(attachment.cloudinaryId);
    await prisma.attachment.delete({ where: { id: attachment.id } });

    res.json({ ok: true, id: attachment.id });
  } catch (error) {
    next(error);
  }
});
