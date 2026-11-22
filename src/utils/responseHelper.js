export const sendSuccess = (
  res,
  statusCode = 200,
  message = "Success",
  data = null,
  pagination,
) => {
  const response = {
    statusCode,
    message,
    data,
  };

  if (data !== null && data !== undefined) {
    response.data = data;
  }

  if (pagination !== undefined) {
    response.pagination = pagination;
  }

  return res.status(statusCode).json(response);
};
