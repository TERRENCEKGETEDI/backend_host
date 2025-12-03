const axios = require('axios');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'test_jwt_secret_key';
const BASE_URL = 'http://localhost:5000/api';

// Create a test admin token
const adminUser = {
  id: 'fb2132d3-2a08-4096-ac45-b99cd98a1891', // Using the ID from the existing token
  role: 'admin'
};

const token = jwt.sign(adminUser, JWT_SECRET, { expiresIn: '1h' });

console.log('=== COMPREHENSIVE ADMIN STATS TEST ===');
console.log('Using admin token:', token.substring(0, 50) + '...');

async function testAllStatsEndpoints() {
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  const tests = [
    {
      name: 'Basic Stats Endpoint',
      url: '/admin/stats',
      description: 'Tests basic user and activity statistics'
    },
    {
      name: 'Enhanced Stats Endpoint',
      url: '/admin/stats/enhanced?period=monthly',
      description: 'Tests enhanced analytics with time-series data'
    },
    {
      name: 'Enhanced Stats with Date Range',
      url: '/admin/stats/enhanced?startDate=2025-11-01&endDate=2025-11-30',
      description: 'Tests enhanced analytics with custom date range'
    },
    {
      name: 'Drilldown - Users',
      url: '/admin/stats/drilldown?type=users',
      description: 'Tests detailed user data retrieval'
    },
    {
      name: 'Drilldown - Activity',
      url: '/admin/stats/drilldown?type=activity',
      description: 'Tests detailed activity log data retrieval'
    }
  ];

  const results = [];

  for (const test of tests) {
    try {
      console.log(`\n--- Testing: ${test.name} ---`);
      console.log(`URL: ${test.url}`);
      console.log(`Description: ${test.description}`);
      
      const response = await axios.get(`${BASE_URL}${test.url}`, { headers });
      
      console.log(`✅ SUCCESS - Status: ${response.status}`);
      console.log(`Response size: ${JSON.stringify(response.data).length} characters`);
      
      // Log some sample data for verification
      if (response.data && typeof response.data === 'object') {
        const keys = Object.keys(response.data);
        console.log(`Response contains: ${keys.join(', ')}`);
        
        if (response.data.userTimeSeries) {
          console.log(`User time series entries: ${response.data.userTimeSeries.length}`);
        }
        if (response.data.incidentTimeSeries) {
          console.log(`Incident time series entries: ${response.data.incidentTimeSeries.length}`);
        }
        if (response.data.activityTimeSeries) {
          console.log(`Activity time series entries: ${response.data.activityTimeSeries.length}`);
        }
        if (response.data.totalUsers !== undefined) {
          console.log(`Total users: ${response.data.totalUsers}`);
        }
      }
      
      results.push({
        test: test.name,
        status: 'SUCCESS',
        statusCode: response.status,
        dataSize: JSON.stringify(response.data).length
      });
      
    } catch (error) {
      console.log(`❌ FAILED - Status: ${error.response?.status || 'Network Error'}`);
      console.log(`Error: ${error.response?.data?.error || error.message}`);
      
      if (error.response?.data?.stack) {
        console.log('Stack trace:', error.response.data.stack);
      }
      
      results.push({
        test: test.name,
        status: 'FAILED',
        statusCode: error.response?.status || 'Network Error',
        error: error.response?.data?.error || error.message
      });
    }
  }

  console.log('\n=== FINAL TEST RESULTS ===');
  let successCount = 0;
  let failCount = 0;
  
  results.forEach(result => {
    const status = result.status === 'SUCCESS' ? '✅' : '❌';
    console.log(`${status} ${result.test}: ${result.status}`);
    if (result.status === 'SUCCESS') {
      successCount++;
    } else {
      failCount++;
      console.log(`   Error: ${result.error}`);
    }
  });
  
  console.log(`\nSummary: ${successCount} successful, ${failCount} failed`);
  console.log(`Success Rate: ${((successCount / results.length) * 100).toFixed(1)}%`);
  
  return { successCount, failCount, results };
}

// Run tests
testAllStatsEndpoints().then(results => {
  console.log('\n=== TEST COMPLETE ===');
  process.exit(results.failCount === 0 ? 0 : 1);
}).catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});