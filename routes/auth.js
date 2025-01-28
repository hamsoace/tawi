const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/user');
const auth = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { phone, pin } = req.body;

  try {
    if (!phone || !pin) {
      return res.status(400).json({
        success: false,
        error: 'Phone and PIN are required',
      });
    }

    const normalizePhone = (phoneNumber) => {
      let cleaned = phoneNumber.replace(/\D/g, '');
      cleaned = cleaned.replace(/^(0|\+254|254)/, '');
      return cleaned;
    };

    const normalizedInputPhone = normalizePhone(phone);

    const user = await User.findOne({
      $or: [
        { phone: normalizedInputPhone },
        { phone: `0${normalizedInputPhone}` },
        { phone: `254${normalizedInputPhone}` },
        { phone: `+254${normalizedInputPhone}` },
      ],
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid phone or PIN',
      });
    }

    const isValidPin = await user.comparePin(pin);
    if (!isValidPin) {
      return res.status(401).json({
        success: false,
        error: 'Invalid phone or PIN',
      });
    }

    const token = jwt.sign(
      {
        userId: user._id,
        phone: user.phone,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.status(200).json({
      success: true,
      token,
      user: {
        phone: user.phone,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({
      success: false,
      error: 'Error logging in',
    });
  }
});

router.post('/register', async (req, res) => {
  try {
    const { username, phone, pin, userType } = req.body;

    if (!username || !phone || !pin || !userType) {
      return res.status(400).json({
        success: false,
        error: 'Username, phone, PIN, and user type are required',
      });
    }

    const normalizePhone = (phoneNumber) => {
      let cleaned = phoneNumber.replace(/\D/g, '');
      cleaned = cleaned.replace(/^(0|\+254|254)/, '');
      return cleaned;
    };
    const normalizedPhone = normalizePhone(phone);

    const existingUser = await User.findOne({
      $or: [{ phone: normalizedPhone }, { username: username }],
    });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'User already exists with this phone number or username',
      });
    }

    const requesterRole = req.user?.role || 'admin';

    const allowedRoles = {
      admin: ['admin', 'branchManager', 'dsa', 'retailer'],
      branchManager: ['dsa', 'retailer'],
      dsa: ['retailer'],
      retailer: [],
    };

    if (!allowedRoles[requesterRole]?.includes(userType)) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to register this user type',
      });
    }

    const user = new User({
      username,
      phone: normalizedPhone,
      pin,
      userType,
    });
    await user.save();

    const token = jwt.sign(
      {
        userId: user._id,
        phone: user.phone,
        role: userType,
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user: {
        username: user.username,
        phone: user.phone,
        userType: user.userType,
      },
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({
      success: false,
      error: 'Error registering user',
    });
  }
});

router.post('/change-pin', auth, async (req, res) => {
  const { currentPin, newPin } = req.body;

  try {
    // Input validation
    if (!currentPin || !newPin) {
      return res.status(400).json({
        success: false,
        error: 'Current PIN and new PIN are required'
      });
    }

    // Validate new PIN format
    if (!/^\d{4}$/.test(newPin)) {
      return res.status(400).json({
        success: false,
        error: 'New PIN must be 4 digits'
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    console.log('User from req:', req.user);

    
    // Verify current PIN
    const isValidPin = await user.comparePin(currentPin);
    if (!isValidPin) {
      return res.status(401).json({
        success: false,
        error: 'Current PIN is incorrect'
      });
    }

    // Update PIN (will be hashed by pre-save middleware)
    user.pin = newPin;
    await user.save();

    res.status(201).json({
      success: true,
      message: 'PIN updated successfully'
    });
  } catch (err) {
    console.error('Change PIN error:', err);
    res.status(500).json({
      success: false,
      error: 'Error changing PIN'
    });
  }
});

module.exports = router;