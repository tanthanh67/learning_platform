import { Router } from "express";
import * as classController from "../controllers/class.controller.js";
import {
  createClassRules,
  idParamRules,
  updateClassRules,
  validate,
  classListQueryRules,
} from "../middlewares/validate.js";
import {
  requireAnyPermission,
  requirePermission,
} from "../middlewares/permission.middleware.js";

const router = Router();
const requireMentorAssignment = requirePermission("CLASS_ASSIGN_MENTOR");

const requireMentorAssignmentIfProvided = (req, res, next) => {
  if (req.body?.mentorId === undefined) {
    return next();
  }

  return requireMentorAssignment(req, res, next);
};

router.get(
  "/",
  requireAnyPermission("CLASS_READ_ALL", "CLASS_READ_OWN"),
  validate(classListQueryRules),
  classController.getAllClasses,
);
router.get(
  "/:id",
  requireAnyPermission("CLASS_READ_ALL", "CLASS_READ_OWN"),
  validate(idParamRules),
  classController.getClassById,
);
router.post(
  "/",
  requirePermission("CLASS_CREATE"),
  validate(createClassRules),
  requireMentorAssignmentIfProvided,
  classController.createClass,
);
router.put(
  "/:id",
  requirePermission("CLASS_UPDATE"),
  validate([...idParamRules, ...updateClassRules]),
  requireMentorAssignmentIfProvided,
  classController.updateClass,
);
router.delete(
  "/:id",
  requirePermission("CLASS_DELETE"),
  validate(idParamRules),
  classController.deleteClass,
);
router.get(
  "/:id/analytics",
  requireAnyPermission("CLASS_READ_ALL", "CLASS_READ_OWN"),
  validate(idParamRules),
  classController.getClassAnalytics,
);

export default router;
