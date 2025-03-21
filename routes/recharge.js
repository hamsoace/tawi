const express = require('express');
const axios = require('axios');
const auth = require('../middleware/auth');
const Recharge = require('../models/recharge');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const AfricasTalking = require('africastalking');
const mongoose = require('mongoose');


const router = express.Router();

const africasTalking = AfricasTalking({
  apiKey: process.env.AT_API_KEY,
  username: process.env.AT_USERNAME || 'sandbox'
});

const airtime = africasTalking.AIRTIME;


async function getAccessToken() {
  const { CONSUMER_KEY, CONSUMER_SECRET, SAFARICOM_API_URL } = process.env;
  const url = `${SAFARICOM_API_URL}/oauth2/v1/generate?grant_type=client_credentials`;
  
  const credentials = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`, 'utf8').toString('base64');
  
  try {
    const response = await axios.post(url, null, {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
    });
    console.log('Access Token Response:', response.data);
    return response.data.access_token;
  } catch (error) {
    console.error('Detailed Access Token Error:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      headers: error.config?.headers
    });
    throw error;
  }
}

const upload = multer({
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext != '.csv') {
      return cb(new Error('Only CSV files are allowed'), false);
    }
    cb(null, true);
  }
})

router.post('/', auth, async (req, res) => {
  const { receiverMsisdn, amount, servicePin } = req.body;

  if (!req.user || !req.user._id) {
    return res.status(400).json({
      success: false,
      error: 'User not authenticated properly'
    });
  }

  const generateTransactionId = () => {
         const timestamp = Date.now().toString();     
         const randomStr = Math.random().toString(36).substring(2, 8).toUpperCase();     
         return `TXN${timestamp}${randomStr}`;   
        };

  // Helper function to format phone numbers
  const formatPhoneNumber = (phone) => {
    // Remove any spaces, hyphens, or other characters
    let cleaned = phone.replace(/\D/g, '');
    // Remove leading 0, +254, or 254
    cleaned = cleaned.replace(/^(0|\+254|254)/, '');
    // Add 254 prefix
    return `254${cleaned}`;
  };

  // Validate required fields
  if (!receiverMsisdn || !amount || !servicePin) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields'
    });
  }

  if (!req.user || !req.user.phone) {
    return res.status(400).json({
      success: false,
      error: 'Sender phone number not found in token'
    });
  }

  const phoneRegex = /^(?:254|\+254|0)?([7-9]\d{8})$/;
  
  if (!phoneRegex.test(receiverMsisdn)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid receiver phone number format'
    });
  }

  if (!phoneRegex.test(req.user.phone)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid sender phone number format'
    });
  }

  // Format both phone numbers consistently
  const formattedReceiverMsisdn = formatPhoneNumber(receiverMsisdn);
  const formattedSenderMsisdn = formatPhoneNumber(req.user.phone);

  try {
    const transactionId = generateTransactionId();
    const token = await getAccessToken();

    // Log the exact payload being sent to Safaricom
    console.log('Request payload:', {
      senderMsisdn: formattedSenderMsisdn,
      receiverMsisdn: formattedReceiverMsisdn,
      amount,
      servicePin: Buffer.from(servicePin, 'utf8').toString('base64'),
    });

    const response = await axios.post(
      `${process.env.SAFARICOM_API_URL}/v1/pretups/api/recharge`,
      {
        senderMsisdn: formattedSenderMsisdn,
        receiverMsisdn: formattedReceiverMsisdn,
        amount,
        servicePin: Buffer.from(servicePin, 'utf8').toString('base64'),
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      }
    );

    // Log the response from Safaricom
    console.log('Safaricom API Response:', response.data);

    const { data } = response;
    const { responseId, responseStatus, responseDesc } = data;

    // Save to database
    const recharge = new Recharge({
      userId: req.user._id, // Add user reference
      senderMsisdn: formattedSenderMsisdn,
      receiverMsisdn: formattedReceiverMsisdn,
      amount: amount,
      transactionId: transactionId,
      status: responseStatus
    });

    await recharge.save();

    return res.json({
      success: true,
      responseId,
      responseStatus,
      transactionId,
      responseDesc,
    });
  } catch (err) {
    // Enhanced error logging
    console.error('Recharge error:', {
      error: err.message,
      response: err.response?.data,
      status: err.response?.status,
      senderMsisdn: formattedSenderMsisdn,
      receiverMsisdn: formattedReceiverMsisdn
    });

    if (err.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: err.message
      });
    }

    // Check if it's a Safaricom API error
    if (err.response?.data) {
      return res.status(err.response.status || 500).json({
        success: false,
        error: err.response.data.error || 'Safaricom API error',
        details: err.response.data
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: err.message
    });
  }
});

router.post('/bulk-recharge', auth, upload.single('csvFile'), async (req, res) => {
  const generateTransactionId = () => {
    const timestamp = Date.now().toString();     
    const randomStr = Math.random().toString(36).substring(2, 8).toUpperCase();     
    return `TXN${timestamp}${randomStr}`;   
   };
   
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No CSV file uploaded' });
  }

  if (!req.body.servicePin || req.body.servicePin.length !== 4 || !/^\d{4}$/.test(req.body.servicePin)) {
    return res.status(400).json({ success: false, error: 'Invalid service PIN' });
  }

  const formatPhoneNumber = (phone) => {
    let cleaned = phone.replace(/\D/g, '');
    cleaned = cleaned.replace(/^(0|\+254|254)/, '');
    return `254${cleaned}`;
  };

  const results = [];
  const errors = [];

  try {
    await new Promise((resolve, reject) => {
      fs.createReadStream(req.file.path)
        .pipe(csv({ headers: ['receiverMsisdn', 'amount'], skipLines: 0 }))
        .on('data', async (data) => {
          // Validate each row
          if (!data.receiverMsisdn || isNaN(data.amount) || Number(data.amount) <= 0) {
            errors.push({
              row: data,
              error: !data.receiverMsisdn ? 'Missing receiverMsisdn' :
                     isNaN(data.amount) || Number(data.amount) <= 0 ? 'Invalid amount' :
                     'Unknown error'
            });
            return;
          }

          try {
            const formattedReceiverMsisdn = formatPhoneNumber(data.receiverMsisdn);
            const transactionId = generateTransactionId();
            const token = await getAccessToken();

            const response = await axios.post(
              `${process.env.SAFARICOM_API_URL}/v1/pretups/api/recharge`,
              {
                senderMsisdn: formatPhoneNumber(req.user.phone),
                receiverMsisdn: formattedReceiverMsisdn,
                amount: data.amount,
                servicePin: Buffer.from(req.body.servicePin, 'utf8').toString('base64'),
              },
              { headers: { 'Authorization': `Bearer ${token}` } }
            );

            results.push({
              receiverMsisdn: formattedReceiverMsisdn,
              amount: data.amount,
              transactionId: transactionId,
              status: response.data.responseStatus,
              responseDesc: response.data.responseDesc
            });
          } catch (error) {
            errors.push({
              row: data,
              receiverMsisdn: data.receiverMsisdn,
              amount: data.amount,
              error: error.message,
              details: error.response?.data
            });
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });

    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      totalProcessed: results.length + errors.length,
      successfulTransactions: results.length,
      failedTransactions: errors.length,
      results,
      errors
    });

  } catch (error) {
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(500).json({ success: false, error: 'Error processing bulk recharge', details: error.message });
  }
});



// Updated statistics route
router.get('/statistics', auth, async (req, res) => {
  try {
    const userId = req.user.id; 
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    // Fixed ObjectId creation and query structure
    const monthlyTotal = await Recharge.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId), // Added 'new' keyword
          createdAt: {
            $gte: startOfMonth,
            $lte: endOfMonth
          },
          status: "200"
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" }
        }
      }
    ]);

    // Fixed ObjectId creation
    const uniqueReceivers = await Recharge.distinct("receiverMsisdn", {
      userId: new mongoose.Types.ObjectId(userId), // Added 'new' keyword
      createdAt: {
        $gte: startOfMonth,
        $lte: endOfMonth
      },
      status: "200"
    });

    // Added user filter to monthly data
    const monthlyData = await Recharge.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId), // Added user filter
          status: "200"
        }
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" }
          },
          total: { $sum: "$amount" }
        }
      },
      {
        $sort: {
          "_id.year": 1,
          "_id.month": 1
        }
      }
    ]);

    res.json({
      success: true,
      statistics: {
        monthlyTotal: monthlyTotal[0]?.total || 0,
        newClients: uniqueReceivers.length,
        monthlyData: monthlyData
      }
    });
  } catch (error) {
    console.error('Error getting statistics:', error);
    res.status(500).json({
      success: false,
      error: 'Error getting statistics'
    });
  }
});

// Updated transactions route
router.get('/transactions', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, pageSize = 10, search = '', range = 'month' } = req.query;
    const skip = (page - 1) * pageSize;

    // Date range filter
    const dateFilter = {};
    const now = new Date();
    switch (range) {
      case 'quarter':
        dateFilter.createdAt = {
          $gte: new Date(now.getFullYear(), now.getMonth() - 3, 1),
          $lte: now
        };
        break;
      case 'year':
        dateFilter.createdAt = {
          $gte: new Date(now.getFullYear(), 0, 1),
          $lte: now
        };
        break;
      default: // month
        dateFilter.createdAt = {
          $gte: new Date(now.getFullYear(), now.getMonth(), 1),
          $lte: now
        };
    }

    // Search filter
    const searchFilter = search ? {
      $or: [
        { senderMsisdn: { $regex: search, $options: 'i' } },
        { receiverMsisdn: { $regex: search, $options: 'i' } },
        { transactionId: { $regex: search, $options: 'i' } }
      ]
    } : {};

    // Corrected base query construction
    const baseQuery = {
      userId: new mongoose.Types.ObjectId(userId), // Added 'new' keyword
      ...dateFilter,
      ...searchFilter
    };

    // Use baseQuery in both find and count
    const transactions = await Recharge.find(baseQuery)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(pageSize));

    const total = await Recharge.countDocuments(baseQuery); // Fixed syntax

    res.json({
      success: true,
      transactions,
      total,
      pages: Math.ceil(total / pageSize)
    });
  } catch (error) {
    console.error('Error getting transactions:', error);
    res.status(500).json({
      success: false,
      error: 'Error getting transactions'
    });
  }
});

// Add this new route to your existing router
router.post('/airtime', auth, async (req, res) => {
  const { receiverMsisdn, amount, currencyCode = 'KES' } = req.body;

  // Reuse your existing phone number formatting function
  const formatPhoneNumber = (phone) => {
      let cleaned = phone.replace(/\D/g, '');
      cleaned = cleaned.replace(/^(0|\+254|254)/, '');
      return `254${cleaned}`;
  };

  // Validate required fields
  if (!receiverMsisdn || !amount) {
      return res.status(400).json({
          success: false,
          error: 'Missing required fields'
      });
  }

  // Reuse your existing phone validation regex
  const phoneRegex = /^(?:254|\+254|0)?([7-9]\d{8})$/;
  
  if (!phoneRegex.test(receiverMsisdn)) {
      return res.status(400).json({
          success: false,
          error: 'Invalid receiver phone number format'
      });
  }

  try {
      const formattedReceiverMsisdn = formatPhoneNumber(receiverMsisdn);
      const transactionId = generateTransactionId(); // Reuse your existing function

      const options = {
          recipients: [{
              phoneNumber: formattedReceiverMsisdn,
              amount,
              currencyCode
          }]
      };

      // Send airtime and get response
      const response = await airtime.send(options);
      
      // Log the response
      console.log('Africa\'s Talking API Response:', response);

      // Save to database using your existing Recharge model
      const recharge = new Recharge({
          senderMsisdn: req.user.phone, // Assuming this comes from auth
          receiverMsisdn: formattedReceiverMsisdn,
          amount: amount,
          transactionId: transactionId,
          status: response.responses[0].status === "Success" ? "200" : "400",
          provider: 'AfricasTalking' // Add this field to your schema if needed
      });

      await recharge.save();

      return res.json({
          success: true,
          responseId: response.responses[0].phoneNumber,
          responseStatus: response.responses[0].status,
          transactionId,
          responseDesc: response.responses[0].errorMessage || 'Success',
          details: response
      });

  } catch (err) {
      // Enhanced error logging (following your existing pattern)
      console.error('Airtime recharge error:', {
          error: err.message,
          response: err.response?.data,
          status: err.response?.status,
          receiverMsisdn
      });

      if (err.name === 'ValidationError') {
          return res.status(400).json({
              success: false,
              error: 'Validation error',
              details: err.message
          });
      }

      // Check if it's an Africa's Talking API error
      if (err.response?.data) {
          return res.status(err.response.status || 500).json({
              success: false,
              error: 'Africa\'s Talking API error',
              details: err.response.data
          });
      }

      return res.status(500).json({
          success: false,
          error: 'Internal server error',
          details: err.message
      });
  }
});

router.post('/airtime/validate', async (req, res) => {
  const { transactionId, phoneNumber, amount, currencyCode, status } = req.body;

  // Log the incoming validation request
  console.log('Airtime Validation Callback:', req.body);

  // Check for required fields
  if (!transactionId || !phoneNumber || !amount || !currencyCode) {
      return res.status(400).json({
          success: false,
          error: 'Missing required fields'
      });
  }

  // Optionally, you can validate the phone number here if needed
  const formattedPhone = formatPhoneNumber(phoneNumber);
  const phoneRegex = /^(?:254|\+254|0)?([7-9]\d{8})$/;

  if (!phoneRegex.test(formattedPhone)) {
      return res.status(400).json({
          success: false,
          error: 'Invalid phone number format'
      });
  }

  // If everything is valid, you can return a validation response
  return res.json({
      success: true,
      message: 'Validation successful',
      transactionId,
      phoneNumber: formattedPhone,
      amount,
      currencyCode,
      status: 'Validated'
  });
});

router.post('/airtime/status', async (req, res) => {
    const { transactionId, phoneNumber, status, errorMessage } = req.body;

    // Log the incoming status callback
    console.log('Airtime Status Callback:', req.body);

    // Check for required fields
    if (!transactionId || !phoneNumber || !status) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields'
        });
    }

    // Optionally, you can perform some additional checks or logging here
    const formattedPhone = formatPhoneNumber(phoneNumber);
    const phoneRegex = /^(?:254|\+254|0)?([7-9]\d{8})$/;

    if (!phoneRegex.test(formattedPhone)) {
        return res.status(400).json({
            success: false,
            error: 'Invalid phone number format'
        });
    }

    // Based on the status, update your database or perform any necessary actions
    if (status === 'Success') {
        // Update the transaction status in your database to successful
        const recharge = await Recharge.findOne({ transactionId });
        if (recharge) {
            recharge.status = '200'; // Assuming '200' indicates success
            await recharge.save();
        }
    } else {
        // Update the transaction status to failed or other statuses
        const recharge = await Recharge.findOne({ transactionId });
        if (recharge) {
            recharge.status = '400'; // Assuming '400' indicates failure
            recharge.errorMessage = errorMessage || 'Transaction failed';
            await recharge.save();
        }
    }

    return res.json({
        success: true,
        message: 'Status processed successfully',
        transactionId,
        phoneNumber: formattedPhone,
        status,
        errorMessage
    });
});



module.exports = router;