const express = require('express');
const axios = require('axios');
const auth = require('../middleware/auth');
const Recharge = require('../models/recharge');

const router = express.Router();

async function getAccessToken() {
  const { CONSUMER_KEY, CONSUMER_SECRET, SAFARICOM_API_URL } = process.env;
  const url = `${SAFARICOM_API_URL}/oauth2/v1/generate?grant_type=client_credentials`;
  
  const credentials = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
  
  try {
    const response = await axios.post(url, null, {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
    });
    return response.data.access_token;
  } catch (error) {
    console.error('Error generating access token:', error);
    throw error;
  }
}

router.post('/', auth, async (req, res) => {
  const { receiverMsisdn, amount, servicePin } = req.body;

  const generateTransactionId = () => {
    const timestamp = Date.now().toString();
    const randomStr = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `TXN${timestamp}${randomStr}`;
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


    const formattedReceiverMsisdn = receiverMsisdn.replace(/^(?:254|\+254|0)/, '');
    const formattedSenderMsisdn = req.user.phone.replace(/^(?:254|\+254|0)/, '');

    try {
    const transactionId = generateTransactionId();

  const token = await getAccessToken();

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

    const { data } = response;
    const { responseId, responseStatus, responseDesc } = data;


    // Save to database first
    const recharge = new Recharge({
      senderMsisdn: formattedSenderMsisdn,
      receiverMsisdn: formattedReceiverMsisdn,
      amount: amount,
      transactionId: transactionId,
      status: responseStatus
    });

    await recharge.save();

    // Then send response
    return res.json({
      success: true,
      responseId,
      responseStatus,
      transactionId,
      responseDesc,
    });

  } catch (err) {
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

    // Generic error
    console.error('Recharge error:', err);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: err.message
    });
  }
  
});


router.get('/statistics', auth, async (req, res) => {
  try {
    // Get current date
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    // Get monthly recharge total
    const monthlyTotal = await Recharge.aggregate([
      {
        $match: {
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

    // Get unique receivers this month (new clients)
    const uniqueReceivers = await Recharge.distinct("receiverMsisdn", {
      createdAt: {
        $gte: startOfMonth,
        $lte: endOfMonth
      },
      status: "200"
    });

    // Get monthly data for the chart
    const monthlyData = await Recharge.aggregate([
      {
        $match: {
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

// Add to routes/recharge.js
router.get('/transactions', auth, async (req, res) => {
  try {
    const { page = 1, pageSize = 10, search = '', range = 'month' } = req.query;
    const skip = (page - 1) * pageSize;

    // Build date range filter
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

    // Build search filter
    const searchFilter = search ? {
      $or: [
        { senderMsisdn: { $regex: search, $options: 'i' } },
        { receiverMsisdn: { $regex: search, $options: 'i' } },
        { transactionId: { $regex: search, $options: 'i' } }
      ]
    } : {};

    const transactions = await Recharge.find({
      ...dateFilter,
      ...searchFilter
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(pageSize));

    const total = await Recharge.countDocuments({
      ...dateFilter,
      ...searchFilter
    });

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


module.exports = router;