#!/usr/bin/env node

const http = require('http');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  const data = Buffer.from(line);
  
  const req = http.request({
    hostname: 'localhost',
    port: 8787,
    path: '/',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  }, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      // Handle empty responses (like 204 No Content for notifications)
      if (body.trim() === '') {
        // For notifications, don't output anything
        return;
      }
      
      try {
        const jsonResponse = JSON.parse(body);
        process.stdout.write(JSON.stringify(jsonResponse) + '\n');
      } catch (err) {
        console.error('Error parsing JSON response:', err);
        console.error('Response body:', body);
      }
    });
  });
  
  req.on('error', (err) => {
    console.error('Proxy error:', err);
    process.exit(1);
  });
  
  req.write(data);
  req.end();
});

// Handle process termination
process.on('SIGINT', () => {
  process.exit(0);
});

process.on('SIGTERM', () => {
  process.exit(0);
}); 