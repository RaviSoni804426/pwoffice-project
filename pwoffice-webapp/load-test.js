const http = require('http');

const CONCURRENCY = 20; // Number of concurrent requests
const TOTAL_REQUESTS = 200; // Total requests to send
const TARGET_URL = 'http://localhost:3000/api/health';

console.log(`Starting stress load test on ${TARGET_URL}...`);
console.log(`Parameters: Concurrency = ${CONCURRENCY}, Total Requests = ${TOTAL_REQUESTS}`);

const startTimestamp = Date.now();
let completedRequests = 0;
let successRequests = 0;
let failedRequests = 0;
let latencies = [];

function sendRequest() {
  if (completedRequests >= TOTAL_REQUESTS) {
    return;
  }

  const reqStart = Date.now();
  
  const req = http.get(TARGET_URL, (res) => {
    const duration = Date.now() - reqStart;
    latencies.push(duration);
    
    completedRequests++;
    if (res.statusCode === 200) {
      successRequests++;
    } else {
      failedRequests++;
    }

    res.resume(); // consume response data to free memory
    
    if (completedRequests < TOTAL_REQUESTS) {
      sendRequest();
    } else {
      printReport();
    }
  });

  req.on('error', (e) => {
    const duration = Date.now() - reqStart;
    latencies.push(duration);
    
    completedRequests++;
    failedRequests++;
    console.error(`Request error: ${e.message}`);
    
    if (completedRequests < TOTAL_REQUESTS) {
      sendRequest();
    } else {
      printReport();
    }
  });
}

function printReport() {
  // Check if we are done with all requests
  if (completedRequests < TOTAL_REQUESTS) return;

  const totalDuration = (Date.now() - startTimestamp) / 1000;
  const rps = (completedRequests / totalDuration).toFixed(2);
  const avgLatency = (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2);
  const minLatency = Math.min(...latencies);
  const maxLatency = Math.max(...latencies);

  console.log(`\n================ LOAD TEST REPORT ================`);
  console.log(`Target URL:         ${TARGET_URL}`);
  console.log(`Total Requests:     ${completedRequests}`);
  console.log(`Successful (200 OK): ${successRequests}`);
  console.log(`Failed/Errors:      ${failedRequests}`);
  console.log(`Total Time Taken:   ${totalDuration.toFixed(2)} seconds`);
  console.log(`Requests per Second:${rps} rps`);
  console.log(`Average Latency:    ${avgLatency} ms`);
  console.log(`Min Latency:        ${minLatency} ms`);
  console.log(`Max Latency:        ${maxLatency} ms`);
  console.log(`==================================================\n`);
  process.exit(0);
}

// Start the initial concurrent requests pool
for (let i = 0; i < CONCURRENCY; i++) {
  sendRequest();
}
