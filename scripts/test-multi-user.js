#!/usr/bin/env node

/**
 * Multi-User Authentication Test Script
 * Tests the multi-user functionality of the Last.fm MCP server
 */

const serverUrl = process.env.SERVER_URL || 'http://localhost:8787';

/**
 * Make an MCP request with a specific connection ID
 */
async function makeMCPRequest(connectionId, method, params = {}) {
  const response = await fetch(serverUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Connection-ID': connectionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Math.floor(Math.random() * 1000),
      method,
      params,
    }),
  });

  return response.json();
}

/**
 * Test unauthenticated access
 */
async function testUnauthenticatedAccess() {
  console.log('🔐 Testing unauthenticated access...');
  
  const connectionId = 'test-unauth-' + Date.now();
  
  // Try to access protected tool
  const result = await makeMCPRequest(connectionId, 'tools/call', {
    name: 'get_recent_tracks',
    arguments: { username: 'test' }
  });
  
  if (result.error && result.error.code === -32001) {
    console.log('✅ Unauthenticated access properly blocked');
    console.log(`   Error: ${result.error.message}`);
    return true;
  } else {
    console.log('❌ Unauthenticated access not properly blocked');
    console.log('   Result:', result);
    return false;
  }
}

/**
 * Test auth_status tool for different connection states
 */
async function testAuthStatusTool() {
  console.log('🔍 Testing auth_status tool...');
  
  const connectionId = 'test-auth-status-' + Date.now();
  
  // Test unauthenticated auth_status
  const unauthResult = await makeMCPRequest(connectionId, 'tools/call', {
    name: 'auth_status',
    arguments: {}
  });
  
  if (unauthResult.result && unauthResult.result.content[0].text.includes('Not Authenticated')) {
    console.log('✅ auth_status returns correct unauthenticated status');
    console.log(`   Connection ID in response: ${unauthResult.result.content[0].text.includes(connectionId) ? 'Yes' : 'No'}`);
    return true;
  } else {
    console.log('❌ auth_status not working correctly for unauthenticated users');
    console.log('   Result:', unauthResult);
    return false;
  }
}

/**
 * Test connection isolation
 */
async function testConnectionIsolation() {
  console.log('🔄 Testing connection isolation...');
  
  const connectionA = 'test-isolation-a-' + Date.now();
  const connectionB = 'test-isolation-b-' + Date.now();
  
  // Make requests from different connections
  const [resultA, resultB] = await Promise.all([
    makeMCPRequest(connectionA, 'tools/call', {
      name: 'ping',
      arguments: { message: 'Hello from A' }
    }),
    makeMCPRequest(connectionB, 'tools/call', {
      name: 'ping', 
      arguments: { message: 'Hello from B' }
    })
  ]);
  
  const messageA = resultA.result?.content[0]?.text || '';
  const messageB = resultB.result?.content[0]?.text || '';
  
  if (messageA.includes('Hello from A') && messageB.includes('Hello from B')) {
    console.log('✅ Connection isolation working - each gets their own response');
    return true;
  } else {
    console.log('❌ Connection isolation failed');
    console.log('   Connection A result:', messageA);
    console.log('   Connection B result:', messageB);
    return false;
  }
}

/**
 * Test concurrent requests
 */
async function testConcurrentRequests() {
  console.log('⚡ Testing concurrent requests...');
  
  const connections = Array.from({ length: 5 }, (_, i) => `test-concurrent-${i}-${Date.now()}`);
  
  // Send multiple concurrent requests
  const promises = connections.map((connectionId, index) =>
    makeMCPRequest(connectionId, 'tools/call', {
      name: 'server_info',
      arguments: {}
    })
  );
  
  const results = await Promise.all(promises);
  
  // Check that all requests succeeded
  const allSucceeded = results.every(result => 
    result.result && result.result.content[0].text.includes('Last.fm MCP Server')
  );
  
  if (allSucceeded) {
    console.log('✅ All concurrent requests succeeded');
    console.log(`   Processed ${results.length} concurrent requests`);
    return true;
  } else {
    console.log('❌ Some concurrent requests failed');
    results.forEach((result, index) => {
      if (!result.result) {
        console.log(`   Connection ${connections[index]} failed:`, result);
      }
    });
    return false;
  }
}

/**
 * Test tools list functionality
 */
async function testToolsList() {
  console.log('🛠️ Testing tools list...');
  
  const connectionId = 'test-tools-' + Date.now();
  
  const result = await makeMCPRequest(connectionId, 'tools/list');
  
  if (result.result && result.result.tools && result.result.tools.length > 0) {
    console.log('✅ Tools list working');
    console.log(`   Found ${result.result.tools.length} tools`);
    return true;
  } else {
    console.log('❌ Tools list failed');
    console.log('   Result:', result);
    return false;
  }
}

/**
 * Test authentication error messages
 */
async function testAuthErrorMessages() {
  console.log('📢 Testing authentication error messages...');
  
  const connectionId = 'test-auth-error-' + Date.now();
  
  const result = await makeMCPRequest(connectionId, 'tools/call', {
    name: 'get_collection_stats',
    arguments: {}
  });
  
  if (result.error && result.error.message.includes('Authentication required')) {
    console.log('✅ Authentication error messages working');
    
    // Check if connection-specific login URL is provided
    const hasConnectionSpecificUrl = result.error.message.includes(connectionId);
    console.log(`   Connection-specific URL: ${hasConnectionSpecificUrl ? 'Yes' : 'No'}`);
    return true;
  } else {
    console.log('❌ Authentication error messages not working');
    console.log('   Result:', result);
    return false;
  }
}

/**
 * Main test runner
 */
async function runTests() {
  console.log('🚀 Starting Multi-User Authentication Tests\n');
  console.log(`Server URL: ${serverUrl}\n`);
  
  const tests = [
    { name: 'Unauthenticated Access', fn: testUnauthenticatedAccess },
    { name: 'Auth Status Tool', fn: testAuthStatusTool },
    { name: 'Connection Isolation', fn: testConnectionIsolation },
    { name: 'Concurrent Requests', fn: testConcurrentRequests },
    { name: 'Tools List', fn: testToolsList },
    { name: 'Auth Error Messages', fn: testAuthErrorMessages },
  ];
  
  const results = [];
  
  for (const test of tests) {
    try {
      const passed = await test.fn();
      results.push({ name: test.name, passed });
      console.log(''); // Empty line between tests
    } catch (error) {
      console.log(`❌ ${test.name} threw an error:`, error.message);
      results.push({ name: test.name, passed: false, error: error.message });
      console.log(''); // Empty line between tests
    }
  }
  
  // Summary
  console.log('📊 Test Results Summary:');
  console.log('========================');
  
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  
  results.forEach(result => {
    const status = result.passed ? '✅' : '❌';
    console.log(`${status} ${result.name}`);
    if (result.error) {
      console.log(`     Error: ${result.error}`);
    }
  });
  
  console.log(`\n🎯 Overall: ${passed}/${total} tests passed`);
  
  if (passed === total) {
    console.log('🎉 All tests passed! Multi-user authentication is working correctly.');
    process.exit(0);
  } else {
    console.log('⚠️  Some tests failed. Please review the results above.');
    process.exit(1);
  }
}

// Run tests if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch(error => {
    console.error('Test runner failed:', error);
    process.exit(1);
  });
}

export { runTests }; 