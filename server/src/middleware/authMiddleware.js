// Verifies the JWT on protected routes and attaches
// { id, email, name, householdId, role } to req.user.
import jwt from "jsonwebtoken";

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Token mancante" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // Token emessi prima del multi-famiglia non hanno householdId: forza re-login.
    if (!payload.householdId) {
      return res
        .status(401)
        .json({ error: "Sessione scaduta, effettua di nuovo l'accesso" });
    }
    req.user = {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      householdId: payload.householdId,
      role: payload.role,
    };
    next();
  } catch {
    return res.status(401).json({ error: "Token non valido o scaduto" });
  }
}
