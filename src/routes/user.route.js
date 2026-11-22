import { Router } from "express";
import * as userController from "../controllers/user.controller.js";
import {
  validate,
  createUserRules,
  updateUserRules,
  idParamRules,
  userRoleParamRules,
} from "../middlewares/validate.js";
import { requirePermission } from "../middlewares/permission.middleware.js";

const router = Router();
const requireRoleManagement = requirePermission("USER_ROLE_MANAGE");

router.get("/", requirePermission("USER_READ"), userController.getAllUser);
router.get("/roles", requireRoleManagement, userController.getRoles);
router.get(
  "/:id/roles",
  requireRoleManagement,
  validate(idParamRules),
  userController.getUserRoles,
);
router.put(
  "/:id/roles/:roleName",
  requireRoleManagement,
  validate(userRoleParamRules),
  userController.grantRole,
);
router.delete(
  "/:id/roles/:roleName",
  requireRoleManagement,
  validate(userRoleParamRules),
  userController.revokeRole,
);
router.get(
  "/:id",
  requirePermission("USER_READ"),
  validate(idParamRules),
  userController.getUserById,
);
router.post(
  "/",
  requirePermission("USER_CREATE"),
  validate(createUserRules),
  userController.addUser,
);
router.put(
  "/:id",
  requirePermission("USER_UPDATE"),
  validate([...idParamRules, ...updateUserRules]),
  userController.updateUser,
);
router.delete(
  "/:id",
  requirePermission("USER_DELETE"),
  validate(idParamRules),
  userController.deleteUser,
);

export default router;
