import { UnauthorizedError } from "../core/error.response.js";
import * as authSessionRepository from "../repository/authSession.repository.js";
import { verifyToken } from "../utils/jwt.helper.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing or invalid authorization header");
  }

  const token = authHeader.split(" ")[1];
  let decoded;

  try {
    decoded = verifyToken(token);
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      throw new UnauthorizedError("Token has expired");
    }
    throw new UnauthorizedError("Invalid token");
  }

  const payload = decoded?.payload;
  if (
    decoded?.type !== "access" ||
    !Number.isSafeInteger(payload?.id) ||
    payload.id <= 0 ||
    payload.id > 2147483647 ||
    typeof payload.sessionId !== "string" ||
    !UUID_PATTERN.test(payload.sessionId)
  ) {
    throw new UnauthorizedError("Invalid access token");
  }

  const session = await authSessionRepository.findActive(
    payload.sessionId,
    payload.id,
  );
  if (!session) {
    throw new UnauthorizedError("Session has expired or been revoked");
  }

  req.user = payload;
  return next();
};
