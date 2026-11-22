import { Router } from "express";
import { uploadDocs, uploadImg } from "../middlewares/upload.middleware.js";
import { idParamRules, validate } from "../middlewares/validate.js";
import * as uploadController from "../controllers/upload.controller.js";

const router = Router();

router.get("/:id/url", validate(idParamRules), uploadController.getFileUrl);
router.post("/", uploadImg.single("image"), uploadController.uploadImage);
router.post(
  "/documents",
  uploadDocs.array("files", 5),
  uploadController.uploadDocuments,
);
router.delete("/:id", validate(idParamRules), uploadController.deleteUpload);

export default router;
