import * as classService from "../services/class.service.js";
import { getClassAnalytics as loadClassAnalytics } from "../services/classAccess.service.js";
import catchAsync from "../utils/catchAsync.js";
import { sendSuccess } from "../utils/responseHelper.js";

export const getAllClasses = catchAsync(async (req, res) => {
  const { page = "1", limit = "10", sortBy, order } = req.query;
  const currentPage = Number(page);
  const pageSize = Number(limit);

  const { items, total } = await classService.getAllClasses(
    { page: currentPage, limit: pageSize, sortBy, order },
    req.user.id,
  );

  return sendSuccess(res, 200, "Classes retrieved successfully", items, {
    page: currentPage,
    limit: pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
});

export const getClassById = catchAsync(async (req, res) => {
  const foundClass = await classService.getClassById(
    req.params.id,
    req.user.id,
  );

  return sendSuccess(res, 200, "Class retrieved successfully", foundClass);
});

export const createClass = catchAsync(async (req, res) => {
  const newClass = await classService.createClass(req.body);

  return sendSuccess(res, 201, "Class created successfully", newClass);
});

export const updateClass = catchAsync(async (req, res) => {
  const updatedClass = await classService.updateClass(req.params.id, req.body);

  return sendSuccess(res, 200, "Class updated successfully", updatedClass);
});

export const deleteClass = catchAsync(async (req, res) => {
  const deletedClass = await classService.deleteClass(req.params.id);

  return sendSuccess(res, 200, "Class deleted successfully", deletedClass);
});

export const getClassAnalytics = catchAsync(async (req, res) => {
  const analytics = await loadClassAnalytics(req.params.id, req.user.id);

  return sendSuccess(
    res,
    200,
    "Class analytics retrieved successfully",
    analytics,
  );
});
