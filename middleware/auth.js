const jwt = require('jsonwebtoken');
const User = require('../models/user');


const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      throw new Error();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);

    if (!user) {
      throw new Error();
    }

    // Add formatted phone number to the user object
    req.user = {
      ...user.toObject(),
      formattedPhone: user.getFormattedPhone('safaricom'),
      role: decoded.role,
    };
    
    next();
  } catch (err) {
    res.status(401).json({ error: 'Please authenticate.' });
  }
};

module.exports = auth;