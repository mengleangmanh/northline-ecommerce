// Always runs after protect, so req.user is already loaded.
// Hiding admin buttons in React is cosmetic - this is the real gate.
export function admin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next()
  return res.status(403).json({ message: 'Admin access only' })
}

export default admin
