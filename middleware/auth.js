const jwt = require('jsonwebtoken');
const User = require('../models/user');


const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        error: 'No authentication token, access denied' 
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    req.user = user; // Attach user to request object
    next();
  } catch (err) {
    res.status(401).json({ success: false, error: 'Invalid token, access denied' });
  }
};

module.exports = auth;