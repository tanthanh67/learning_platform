import {
  ConflictError,
  NotFoundError,
  BadRequestError,
} from "../core/error.response.js";
import * as lessonRepository from "../repository/lesson.repository.js";
import * as lessonProgressRepository from "../repository/lessonProgress.repository.js";
import * as uploadRepository from "../repository/upload.repository.js";
import * as uploadService from "./upload.service.js";
import {
  ensureCanView,
  ensureMember,
  ensureMentor,
  getClassAccess,
} from "./classAccess.service.js";

const findLessonWithAccess = async (lessonId, userId) => {
  const lesson = await lessonRepository.findById(lessonId);
  if (!lesson) {
    throw new NotFoundError("Lesson not found");
  }

  const access = await getClassAccess(lesson.class_id, userId);
  return { lesson, access };
};

const ensureOrderAvailable = async (classId, lessonOrder, currentLessonId) => {
  const sameOrderLesson = await lessonRepository.findByOrder(
    classId,
    lessonOrder,
  );
  if (sameOrderLesson && sameOrderLesson.id !== currentLessonId) {
    throw new ConflictError("Lesson order already exists in this class");
  }
};

export const getLessonsByClass = async (classId, userId) => {
  const access = await getClassAccess(classId, userId);
  ensureCanView(access);

  return lessonRepository.findByClassId(classId, userId);
};

export const createLesson = async (
  classId,
  userId,
  { title, content, order },
) => {
  const access = await getClassAccess(classId, userId);
  ensureMentor(access);

  await ensureOrderAvailable(classId, order);

  return lessonRepository.create({
    classId,
    title,
    content,
    lessonOrder: order,
    createdBy: userId,
  });
};

export const getLessonById = async (lessonId, userId) => {
  const { lesson, access } = await findLessonWithAccess(lessonId, userId);
  ensureCanView(access);

  const attachments = await lessonRepository.findMetadataByLessonId(lesson.id);
  return { ...lesson, attachments };
};

export const getLessonForAttachmentUpload = async (lessonId, userId) => {
  const { lesson, access } = await findLessonWithAccess(lessonId, userId);
  ensureMentor(access);
  return lesson;
};

export const uploadLessonAttachment = async (lessonId, userId, file) => {
  if (!file?.size) {
    throw new BadRequestError("A non-empty file is required");
  }

  const { key } = await uploadService.uploadR2(file, "lessons");

  try {
    const upload = await uploadRepository.create({
      key,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      uploadedBy: userId,
      lessonId,
    });

    return {
      id: upload.id,
      original_name: upload.original_name,
      mime_type: upload.mime_type,
      size_bytes: upload.size_bytes,
      created_at: upload.created_at,
    };
  } catch (error) {
    try {
      await uploadService.deleteImgFromR2(key);
    } catch (cleanupError) {
      console.error("Failed to clean up lesson attachment", cleanupError);
    }
    throw error;
  }
};

export const getLessonAttachmentUrl = async (
  lessonId,
  attachmentId,
  userId,
) => {
  const { lesson, access } = await findLessonWithAccess(lessonId, userId);
  ensureCanView(access);

  const upload = await uploadRepository.findById(attachmentId);
  if (!upload || upload.lesson_id !== lesson.id) {
    throw new NotFoundError("Attachment not found in this lesson");
  }

  return uploadService.createFileDownload(upload);
};

export const updateLesson = async (
  lessonId,
  userId,
  { title, content, order },
) => {
  const { lesson, access } = await findLessonWithAccess(lessonId, userId);
  ensureMentor(access);

  if (order !== undefined && order !== lesson.lesson_order) {
    await ensureOrderAvailable(lesson.class_id, order, lesson.id);
  }

  return lessonRepository.update(lesson.id, {
    title,
    content,
    lessonOrder: order,
  });
};

export const deleteLesson = async (lessonId, userId) => {
  const { lesson, access } = await findLessonWithAccess(lessonId, userId);
  ensureMentor(access);

  return lessonRepository.deleteById(lesson.id);
};

export const completeLesson = async (lessonId, userId) => {
  const { lesson, access } = await findLessonWithAccess(lessonId, userId);
  ensureMember(access);

  const progress = await lessonProgressRepository.create(lesson.id, userId);
  return progress ?? lessonProgressRepository.findOne(lesson.id, userId);
};

export const getClassProgress = async (classId, userId) => {
  const access = await getClassAccess(classId, userId);
  ensureMember(access);

  const { total_lessons: totalLessons, completed_lessons: completedLessons } =
    await lessonProgressRepository.countByClass(classId, userId);

  const progress =
    totalLessons === 0
      ? 0
      : Math.round((completedLessons / totalLessons) * 100);

  return { totalLessons, completedLessons, progress };
};
